import type { Config } from '@shared/config/config'
import { initServerIpc } from './api/serverIpc'
import { initializeAgentKernelRuntime, refreshAgentKernelRuntime } from './agentKernel/runtime'
import { initComfyStateListener, stopComfyStateListener } from './comfy/state'
import { getConfig, initConfig, listenConfig } from './config/config'
import { startLLMProxyServer, stopLLMProxyServer } from './llmProxy/server'
import { HyperSvcImpl } from './api/svcHyperImpl'
import {
  readMagicPotMcpPlatformEnv,
  syncMagicPotMcpPlatformDesktopTransports,
  stopMagicPotMcpPlatformRuntime
} from './mcp/platform/runtime'
import { stopMcpClientManager, syncMcpClientManager } from './mcp/runtime'
import { initTaskQueue, stopTaskQueue } from './queue/taskQueue'
import { cleanupSubProcesses } from './subprocess/subprocess'
import { setConsoleTransportEnabled } from './utils/loggingOverride'
import { startMagicPotWebServer, stopMagicPotWebServer } from './webServer/webApiServer'
import { winController } from './winControls'

let localComfyAutoStartInFlight = false

async function runLifecycleStep(
  stepName: string,
  action: () => void | Promise<void>
): Promise<boolean> {
  try {
    await action()
    console.log(`[App] ${stepName}`)
    return true
  } catch (error) {
    console.error(`[App] ${stepName} failed`, error)
    return false
  }
}

function syncRuntimeServices(config?: Config): Promise<void> {
  return syncMcpClientManager(config)
}

async function refreshRuntimeServices(
  config: Config,
  mcpPlatformEnv: ReturnType<typeof readMagicPotMcpPlatformEnv>
): Promise<void> {
  await syncRuntimeServices(config)
  refreshAgentKernelRuntime()
  await syncMagicPotMcpPlatformDesktopTransports(mcpPlatformEnv)
}

function syncLlmProxyServer(config: Config): void {
  if (config.local_llm_server_config?.enable_server) {
    startLLMProxyServer()
  } else {
    stopLLMProxyServer()
  }
}

async function syncWebServer(config: Config): Promise<void> {
  await startMagicPotWebServer(config)
}

function ensureLocalComfyUIStarted(config: Config): void {
  if (config.use_remote_comfyui || localComfyAutoStartInFlight) {
    return
  }

  localComfyAutoStartInFlight = true
  const svc = new HyperSvcImpl()

  void svc
    .startComfyUI(
      {},
      {
        onData: (data) => {
          if (data.logLine) {
            console.log(data.logLine)
          }
        }
      }
    )
    .catch((error) => {
      console.error('[App] Local ComfyUI auto-start failed', error)
    })
    .finally(() => {
      localComfyAutoStartInFlight = false
    })
}

function startBackgroundTasks(): void {
  initTaskQueue().catch((error) => console.error('[App] TaskQueue init failed', error))
  initComfyStateListener()
  winController.initIpc()
  initServerIpc()
}

function registerRuntimeServiceManager(
  mcpPlatformEnv: ReturnType<typeof readMagicPotMcpPlatformEnv>
): void {
  listenConfig({
    id: 'runtime-service-manager',
    onEvent: async (config) => {
      await refreshRuntimeServices(config, mcpPlatformEnv)
      syncLlmProxyServer(config)
      await syncWebServer(config)
      ensureLocalComfyUIStarted(config)
    },
    onEnd: async () => {}
  })
}

export async function beforeShow() {
  const mcpPlatformEnv = readMagicPotMcpPlatformEnv()
  if (mcpPlatformEnv.enableStdioServer) {
    setConsoleTransportEnabled(false)
  }

  console.log('[App] beforeShow started')

  await runLifecycleStep('Config initialized', () => initConfig())

  console.log('[App] Launching background tasks...')

  startBackgroundTasks()
  ensureLocalComfyUIStarted(getConfig())

  await runLifecycleStep('Runtime services synced', async () => {
    await syncRuntimeServices()
    initializeAgentKernelRuntime()
    await syncMagicPotMcpPlatformDesktopTransports(mcpPlatformEnv)
  })

  await runLifecycleStep('LLM server started', () => startLLMProxyServer())
  await runLifecycleStep('MagicPot web server started', () => startMagicPotWebServer(getConfig()))
  registerRuntimeServiceManager(mcpPlatformEnv)

  console.log('[App] beforeShow finished')
}

export async function beforeQuit() {
  await runLifecycleStep('MagicPot web server stopped', () => stopMagicPotWebServer())
  await runLifecycleStep('LLM server stopped', () => stopLLMProxyServer())
  await runLifecycleStep('MCP clients stopped', () => stopMcpClientManager())
  await runLifecycleStep('MCP platform stopped', () => stopMagicPotMcpPlatformRuntime())
  await runLifecycleStep('Comfy listener stopped', () => stopComfyStateListener())
  await runLifecycleStep('Subprocess cleanup finished', async () => {
    console.log('[App] Cleaning subprocesses...')
    await cleanupSubProcesses()
  })
  await runLifecycleStep('Task queue cleanup finished', () => stopTaskQueue())
}
