import { apiDef, type Api } from '@shared/api'
import { browserPath, browserWinBridge } from './browserPolyfills'

type RpcEnvelope = {
  data?: unknown
  error?: string | { message?: string }
  done?: boolean
}

function isWebRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    !window.api &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  )
}

function reviveJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveJson)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.__type === 'Uint8Array' && typeof record.base64 === 'string') {
      const binary = atob(record.base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return bytes
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, reviveJson(item)]))
  }
  return value
}

function serializeForJson(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let binary = ''
    for (let index = 0; index < value.length; index += 1) {
      binary += String.fromCharCode(value[index])
    }
    return {
      __type: 'Uint8Array',
      base64: btoa(binary)
    }
  }
  if (Array.isArray(value)) {
    return value.map(serializeForJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        serializeForJson(item)
      ])
    )
  }
  return value
}

async function rpcCall(serviceName: string, methodName: string, req: unknown): Promise<unknown> {
  const response = await fetch('/__magicpot/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serializeForJson({ serviceName, methodName, req }))
  })
  const payload = (await response.json().catch(() => ({}))) as RpcEnvelope
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message || ''
    throw new Error(message || 'MagicPot Web RPC failed')
  }
  return reviveJson(payload.data)
}

async function rpcStream(
  serviceName: string,
  methodName: string,
  req: unknown,
  resp: {
    onData: (data: unknown) => void
    abortReceiver?: { onAbort: (handler: () => void) => void }
  }
): Promise<void> {
  const controller = new AbortController()
  resp.abortReceiver?.onAbort(() => controller.abort())
  const response = await fetch('/__magicpot/api/rpc-stream', {
    method: 'POST',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serializeForJson({ serviceName, methodName, req }))
  })
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as RpcEnvelope
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message || ''
    throw new Error(message || 'MagicPot Web stream failed')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      const payload = JSON.parse(line) as RpcEnvelope
      if (payload.error) {
        const message =
          typeof payload.error === 'string' ? payload.error : payload.error.message || ''
        throw new Error(message || 'MagicPot Web stream failed')
      }
      if (payload.done) return
      if ('data' in payload) resp.onData(reviveJson(payload.data))
    }
  }
}

function createWebApi(): Api {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [serviceName, serviceDef] of Object.entries(apiDef)) {
    result[serviceName] = {}
    for (const [methodName, methodDef] of Object.entries(serviceDef)) {
      if (methodDef.type === 'unary') {
        result[serviceName][methodName] = (req: unknown) => rpcCall(serviceName, methodName, req)
      } else if (methodDef.type === 'serverStreaming') {
        result[serviceName][methodName] = (
          req: unknown,
          resp: {
            onData: (data: unknown) => void
            abortReceiver?: { onAbort: (handler: () => void) => void }
          }
        ) => rpcStream(serviceName, methodName, req, resp)
      }
    }
  }
  return result as unknown as Api
}

if (isWebRuntime()) {
  const noop = () => undefined
  const unsubscribe = () => noop
  window.__MAGICPOT_WEB_RUNTIME__ = true
  window.api = createWebApi()
  window.path = window.path || browserPath
  window.win = window.win || browserWinBridge
  window.electron = window.electron || {
    ipcRenderer: {
      invoke: async () => undefined,
      on: unsubscribe,
      once: unsubscribe,
      addListener: unsubscribe,
      removeListener: noop,
      removeAllListeners: noop,
      off: noop,
      send: noop,
      postMessage: noop
    }
  }
  window.electronFile = window.electronFile || {
    getPathForFile: () => ''
  }
}
