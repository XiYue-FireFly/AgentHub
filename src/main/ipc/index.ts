/**
 * IPC Registration Hub.
 *
 * Centralizes all IPC handler registrations from domain-specific modules.
 * This is the single entry point for all IPC setup.
 */

import { registerGitIpc } from './git-ipc'
import { registerMemoryIpc } from './memory-ipc'
import { registerProviderIpc } from './provider-ipc'
import { registerMcpIpc } from './mcp-ipc'
import { registerWorkflowIpc } from './workflow-ipc'

interface IpcRegistrationDeps {
  memory: () => any
  providerMgr: any
  registerAgentsFromBindings: () => void
  resolveAppVersionFromMain: () => string
  getWorkspaceManager: () => any
  store: any
  registry: any
}

/**
 * Register all domain-specific IPC handlers.
 * This replaces the ~200 inline ipcMain.handle calls in index.ts.
 */
export function registerAllIpcHandlers(deps: IpcRegistrationDeps): void {
  // Git operations (22 handlers)
  registerGitIpc()

  // Memory operations (16 handlers)
  registerMemoryIpc(deps.memory)

  // Provider & Routing operations (17 handlers)
  registerProviderIpc({
    providerMgr: deps.providerMgr,
    registerAgentsFromBindings: deps.registerAgentsFromBindings
  })

  // MCP operations (7 handlers)
  registerMcpIpc()

  // Workflow/Feature operations (40+ handlers)
  registerWorkflowIpc({
    resolveAppVersionFromMain: deps.resolveAppVersionFromMain,
    getWorkspaceManager: deps.getWorkspaceManager,
    store: deps.store,
    memory: deps.memory,
    providerMgr: deps.providerMgr,
    registry: deps.registry
  })
}
