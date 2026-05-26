import http, { IncomingMessage, ServerResponse } from 'http'
import { app } from 'electron'
import { extname, join, normalize } from 'path'
import { readFile, stat } from 'fs/promises'
import { apiDef, type Api } from '@shared/api'
import { newAbortHandler } from '@shared/api/apiUtils/abortHandler'
import { isServerStreamingError, ServerStreaming } from '@shared/api/apiUtils/streaming'
import { DEFAULT_CONFIG, type Config } from '@shared/config/config'
import { getConfig } from '../config/config'
import { createServer as createMagicPotApi } from '../api/serverIpc'
import { WebAuthStore } from './authStore'
import { renderLoginHtml } from './loginHtml'
import { PublicWebUser } from './types'

type ServerRuntime = {
  configKey: string
  server: http.Server
  auth: WebAuthStore
  api: Api
}

type WebContext = {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  auth: WebAuthStore
  api: Api
  config: Config
  token: string | null
}

type AuthedContext = WebContext & {
  user: PublicWebUser
}

const WEB_COOKIE = 'mp_web_session'
const WEB_PREFIX = '/__magicpot'
let runtime: ServerRuntime | null = null

const ADMIN_ONLY_RPC_METHODS = new Set<string>([
  'svcState.saveConfig',
  'svcState.setUserDataDirectory',
  'svcQApp.saveQAppCfg',
  'svcQApp.deleteQAppCfg',
  'svcQApp.deleteQApp',
  'svcQApp.renameQAppCfg',
  'svcCustomSkill.saveCustomSkill',
  'svcCustomSkill.deleteCustomSkill',
  'svcCustomSkill.batchSaveCustomSkills',
  'svcTargetScheme.saveTargetScheme',
  'svcTargetScheme.deleteTargetScheme',
  'svcTargetScheme.saveTargetHistoryTarget',
  'svcTargetScheme.deleteTargetHistoryTarget'
])

function webConfig(config: Config) {
  return config.web_server_config || DEFAULT_CONFIG.web_server_config
}

function configKey(config: Config): string {
  return JSON.stringify(webConfig(config))
}

function rendererRoot(): string {
  return normalize(join(__dirname, '../renderer'))
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sendError(res: ServerResponse, status: number, error: unknown): void {
  sendJson(res, status, { error: { message: errorMessage(error) } })
}

function serializeForJson(value: unknown): unknown {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return {
      __type: 'Uint8Array',
      base64: Buffer.from(value).toString('base64')
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

function reviveJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveJson)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.__type === 'Uint8Array' && typeof record.base64 === 'string') {
      return Buffer.from(record.base64, 'base64')
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, reviveJson(item)]))
  }
  return value
}

function sendHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location })
  res.end()
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=')
        return index === -1
          ? [item, '']
          : [item.slice(0, index), decodeURIComponent(item.slice(index + 1))]
      })
  )
}

function tokenFromRequest(req: IncomingMessage): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  return parseCookies(req)[WEB_COOKIE] || null
}

function setSessionCookie(res: ServerResponse, token: string, expiresAt: string): void {
  res.setHeader(
    'Set-Cookie',
    `${WEB_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(
      expiresAt
    ).toUTCString()}`
  )
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader(
    'Set-Cookie',
    `${WEB_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  )
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return reviveJson(raw ? JSON.parse(raw) : {}) as T
}

async function requireUser(ctx: WebContext): Promise<AuthedContext | null> {
  const user = await ctx.auth.resolveSession(ctx.token)
  if (!user) {
    sendJson(ctx.res, 401, { error: '请先登录' })
    return null
  }
  return { ...ctx, user }
}

async function requireAdmin(ctx: WebContext): Promise<AuthedContext | null> {
  const authed = await requireUser(ctx)
  if (!authed) return null
  if (authed.user.role !== 'admin') {
    sendJson(ctx.res, 403, { error: '需要管理员权限' })
    return null
  }
  return authed
}

function pathParts(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
}

async function handleAuth(ctx: WebContext, action: string): Promise<void> {
  if (ctx.req.method === 'GET' && action === 'bootstrap') {
    sendJson(ctx.res, 200, {
      needsAdmin: !ctx.auth.hasUsers(),
      allowRegistration: webConfig(ctx.config).allow_registration
    })
    return
  }

  if (ctx.req.method === 'GET' && action === 'me') {
    const user = await ctx.auth.resolveSession(ctx.token)
    if (!user) {
      sendJson(ctx.res, 401, { error: '请先登录' })
      return
    }
    sendJson(ctx.res, 200, { user })
    return
  }

  if (ctx.req.method === 'PATCH' && action === 'me') {
    const authed = await requireUser(ctx)
    if (!authed) return
    const body = await readJson<{ username?: string }>(ctx.req)
    const user = await ctx.auth.updateUser(authed.user.id, { username: body.username })
    sendJson(ctx.res, 200, { user })
    return
  }

  if (ctx.req.method === 'POST' && action === 'me' && pathParts(ctx.url)[4] === 'password') {
    const authed = await requireUser(ctx)
    if (!authed) return
    const body = await readJson<{ password?: string }>(ctx.req)
    await ctx.auth.setPassword(authed.user.id, body.password || '', ctx.token || undefined)
    sendJson(ctx.res, 200, {})
    return
  }

  if (ctx.req.method === 'POST' && action === 'register') {
    const body = await readJson<{ email?: string; password?: string; username?: string }>(ctx.req)
    await ctx.auth.register(
      body.email || '',
      body.password || '',
      webConfig(ctx.config).allow_registration,
      body.username
    )
    const result = await ctx.auth.login(
      body.email || '',
      body.password || '',
      webConfig(ctx.config).session_ttl_hours
    )
    setSessionCookie(ctx.res, result.token, result.expiresAt)
    sendJson(ctx.res, 200, { user: result.user })
    return
  }

  if (ctx.req.method === 'POST' && action === 'login') {
    const body = await readJson<{ email?: string; password?: string }>(ctx.req)
    const result = await ctx.auth.login(
      body.email || '',
      body.password || '',
      webConfig(ctx.config).session_ttl_hours
    )
    setSessionCookie(ctx.res, result.token, result.expiresAt)
    sendJson(ctx.res, 200, { user: result.user })
    return
  }

  if (ctx.req.method === 'POST' && action === 'logout') {
    if (ctx.token) await ctx.auth.logout(ctx.token)
    clearSessionCookie(ctx.res)
    sendJson(ctx.res, 200, {})
    return
  }

  sendJson(ctx.res, 404, { error: 'Not found' })
}

function serviceMethod(ctx: AuthedContext, serviceName: string, methodName: string) {
  const serviceDef = apiDef[serviceName as keyof Api]
  const methodDef = serviceDef?.[methodName]
  const service = ctx.api[serviceName as keyof Api] as Record<string, unknown> | undefined
  const method = service?.[methodName]
  if (!methodDef || typeof method !== 'function') return null
  return {
    type: methodDef.type,
    method: method.bind(service) as (...args: unknown[]) => Promise<unknown>
  }
}

async function handleRpc(ctx: AuthedContext, stream: boolean): Promise<void> {
  if (ctx.req.method !== 'POST') {
    sendJson(ctx.res, 405, { error: 'Method not allowed' })
    return
  }
  const body = await readJson<{ serviceName?: string; methodName?: string; req?: unknown }>(ctx.req)
  const serviceName = body.serviceName || ''
  const methodName = body.methodName || ''
  if (ctx.user.role !== 'admin' && ADMIN_ONLY_RPC_METHODS.has(`${serviceName}.${methodName}`)) {
    sendJson(ctx.res, 403, { error: '当前账号没有该操作权限' })
    return
  }
  const found = serviceMethod(ctx, serviceName, methodName)
  if (!found) {
    sendJson(ctx.res, 404, { error: 'RPC method not found' })
    return
  }
  if (stream !== (found.type === 'serverStreaming')) {
    sendJson(ctx.res, 400, { error: 'RPC method transport mismatch' })
    return
  }

  await ctx.auth.recordUsage(ctx.user.id, 'rpc.call', { serviceName, methodName, stream })

  if (!stream) {
    try {
      const result = serializeForJson(await found.method(body.req))
      sendJson(ctx.res, 200, { data: result })
    } catch (error) {
      sendError(ctx.res, 500, error)
    }
    return
  }

  ctx.res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  })
  const [abortSender, abortReceiver] = newAbortHandler()
  ctx.req.on('close', () => abortSender.abort())
  const resp: ServerStreaming<unknown> = {
    abortReceiver,
    onData: (data) => {
      ctx.res.write(`${JSON.stringify({ data: serializeForJson(data) })}\n`)
    }
  }
  try {
    await found.method(body.req, resp)
    ctx.res.write(`${JSON.stringify({ done: true })}\n`)
  } catch (error) {
    const message = isServerStreamingError(error) ? error.message : errorMessage(error)
    ctx.res.write(`${JSON.stringify({ error: { message } })}\n`)
  } finally {
    ctx.res.end()
  }
}

async function handleAdmin(ctx: WebContext): Promise<void> {
  const admin = await requireAdmin(ctx)
  if (!admin) return

  const parts = pathParts(ctx.url)
  if (ctx.req.method === 'GET' && parts[3] === 'overview') {
    sendJson(ctx.res, 200, ctx.auth.getAdminOverview())
    return
  }

  if (ctx.req.method === 'GET' && parts[3] === 'users' && parts[5] === 'history') {
    sendJson(ctx.res, 200, { usage: ctx.auth.getUserHistory(parts[4]) })
    return
  }

  if (ctx.req.method === 'PATCH' && parts[3] === 'users') {
    const body = await readJson<{
      username?: string
      role?: 'admin' | 'user'
      disabled?: boolean
    }>(ctx.req)
    const user = await ctx.auth.updateUser(parts[4], body)
    sendJson(ctx.res, 200, { user })
    return
  }

  if (ctx.req.method === 'POST' && parts[3] === 'users' && parts[5] === 'password') {
    const body = await readJson<{ password?: string }>(ctx.req)
    await ctx.auth.setPassword(parts[4], body.password || '')
    sendJson(ctx.res, 200, {})
    return
  }

  if (ctx.req.method === 'DELETE' && parts[3] === 'users') {
    await ctx.auth.deleteUser(parts[4], admin.user.id)
    sendJson(ctx.res, 200, {})
    return
  }

  sendJson(ctx.res, 404, { error: 'Not found' })
}

function injectWebBridge(html: string, user: PublicWebUser): string {
  const boot = `<script>window.__MAGICPOT_WEB_RUNTIME__=true;window.__MAGICPOT_WEB__=${JSON.stringify({ user })};</script>`
  return html.replace('</head>', `${boot}</head>`)
}

async function sendRendererIndex(ctx: AuthedContext): Promise<void> {
  const indexPath = join(rendererRoot(), 'index.html')
  const html = await readFile(indexPath, 'utf8')
  sendHtml(ctx.res, injectWebBridge(html, ctx.user))
}

async function sendStaticFile(ctx: AuthedContext): Promise<void> {
  const root = rendererRoot()
  const relativePath = decodeURIComponent(ctx.url.pathname).replace(/^\/+/, '') || 'index.html'
  const filePath = normalize(join(root, relativePath))
  if (!filePath.startsWith(root)) {
    sendJson(ctx.res, 403, { error: 'Forbidden' })
    return
  }
  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      await sendRendererIndex(ctx)
      return
    }
    if (filePath.endsWith('.html')) {
      const html = await readFile(filePath, 'utf8')
      sendHtml(ctx.res, injectWebBridge(html, ctx.user))
      return
    }
    const body = await readFile(filePath)
    ctx.res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Content-Length': body.byteLength,
      'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000'
    })
    ctx.res.end(body)
  } catch {
    await sendRendererIndex(ctx)
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: WebAuthStore,
  api: Api
): Promise<void> {
  try {
    const host = req.headers.host || '127.0.0.1'
    const url = new URL(req.url || '/', `http://${host}`)
    const ctx: WebContext = {
      req,
      res,
      url,
      auth,
      api,
      config: getConfig(),
      token: tokenFromRequest(req)
    }

    if (url.pathname === '/login') {
      const user = await auth.resolveSession(ctx.token)
      if (user) redirect(res, '/')
      else sendHtml(res, renderLoginHtml())
      return
    }

    if (url.pathname.startsWith(`${WEB_PREFIX}/api/auth/`)) {
      await handleAuth(ctx, pathParts(url)[3])
      return
    }

    if (url.pathname.startsWith(`${WEB_PREFIX}/api/admin/`)) {
      await handleAdmin(ctx)
      return
    }

    const user = await auth.resolveSession(ctx.token)
    if (!user) {
      if (url.pathname.startsWith(WEB_PREFIX)) {
        sendJson(res, 401, { error: '请先登录' })
        return
      }
      redirect(res, '/login')
      return
    }
    const authed: AuthedContext = { ...ctx, user }

    if (url.pathname === `${WEB_PREFIX}/api/rpc`) {
      await handleRpc(authed, false)
      return
    }
    if (url.pathname === `${WEB_PREFIX}/api/rpc-stream`) {
      await handleRpc(authed, true)
      return
    }

    await sendStaticFile(authed)
  } catch (error) {
    console.error('[MagicPotWeb] request failed', error)
    sendError(res, 500, error)
  }
}

export async function startMagicPotWebServer(config: Config): Promise<void> {
  const cfg = webConfig(config)
  if (!cfg.enable_server) {
    await stopMagicPotWebServer()
    return
  }
  const nextKey = configKey(config)
  if (runtime?.configKey === nextKey) return

  await stopMagicPotWebServer()

  const auth = new WebAuthStore(app.getPath('userData'))
  await auth.init()
  const api = createMagicPotApi()
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, auth, api)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(cfg.port, cfg.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  runtime = { configKey: nextKey, server, auth, api }
  console.log(`[MagicPotWeb] listening at http://${cfg.host}:${cfg.port}`)
}

export async function stopMagicPotWebServer(): Promise<void> {
  const current = runtime
  runtime = null
  if (!current) return
  await new Promise<void>((resolve) => current.server.close(() => resolve()))
  console.log('[MagicPotWeb] stopped')
}
