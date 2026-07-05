/**
 * Workflow/Feature IPC handlers.
 *
 * Extracted from index.ts to isolate workflow, shortcut, diagnostic,
 * backup, notification, onboarding, and other feature IPC registrations.
 */

import { app } from 'electron'
import { listWorkflows, getWorkflow, upsertWorkflow, deleteWorkflow, searchWorkflows, seedDefaultWorkflows } from '../runtime/workflows'
import { listShortcuts, getShortcut, updateShortcut, resetShortcut, resetAllShortcuts, detectConflicts } from '../runtime/keyboard-shortcuts'
import { runDiagnostics } from '../runtime/diagnostics'
import { createBackup, listBackups, restoreBackup, deleteBackup } from '../runtime/backup'
import { listNotifications, getUnreadCount, pushNotification, markRead, markAllRead, deleteNotification, clearAllNotifications } from '../runtime/notifications'
import { getOnboardingState, shouldShowOnboarding, completeStep, skipAllOnboarding, resetOnboarding, getNextStep } from '../runtime/onboarding'
import { listSlashCommands, getSlashCommand, saveSlashCommand, deleteSlashCommand, resolveSlashCommand, validateShortcut, checkConflict } from '../runtime/slash-commands'
import { buildProjectMap, searchProjectFiles } from '../runtime/project-map'
import { listMcpServers } from '../runtime/mcp'
import { listPullRequests, listIssues, getCurrentBranchPr, checkGhCli } from '../runtime/github-integration'
import { typedHandle } from './typed-ipc'

interface WorkflowIpcDeps {
  resolveAppVersionFromMain: () => string
  getWorkspaceManager: () => any
  store?: any
  memory?: () => any
  providerMgr?: any
  registry?: any
}

export function registerWorkflowIpc(deps: WorkflowIpcDeps): void {
  const { resolveAppVersionFromMain } = deps

  // Store access with key allowlist (defense-in-depth: block sensitive keys)
  const ALLOWED_STORE_KEY_PREFIXES = ['agenthub.', 'appearance.']
  const BLOCKED_STORE_KEY_PREFIXES = ['providers.', 'local.', 'routing.', 'runtime.mcp.', 'agentic.approval.', 'agentic.config.', 'usage.ledger.']
  function isStoreKeyAllowed(key: string): boolean {
    if (!key || typeof key !== 'string') return false
    if (BLOCKED_STORE_KEY_PREFIXES.some(p => key.startsWith(p))) return false
    return ALLOWED_STORE_KEY_PREFIXES.some(p => key.startsWith(p))
  }
  typedHandle("store:get", (_e, key, defaultValue) => {
    if (!isStoreKeyAllowed(key)) return defaultValue
    return deps.store?.get?.(key, defaultValue)
  })
  typedHandle("store:set", (_e, key, value) => {
    if (!isStoreKeyAllowed(key)) throw new Error(`Store key not allowed: ${key}`)
    deps.store?.set?.(key, value)
    return true
  })

  // Workflows
  typedHandle("workflows:list", (_e, category) => listWorkflows(category))
  typedHandle("workflows:get", (_e, id) => getWorkflow(id))
  typedHandle("workflows:upsert", (_e, input) => upsertWorkflow(input))
  typedHandle("workflows:delete", (_e, id) => deleteWorkflow(id))
  typedHandle("workflows:search", (_e, query) => searchWorkflows(query))
  typedHandle("workflows:seed", () => { seedDefaultWorkflows(); return listWorkflows() })

  // Keyboard Shortcuts
  typedHandle("shortcuts:list", (_e, category) => listShortcuts(category))
  typedHandle("shortcuts:get", (_e, id) => getShortcut(id))
  typedHandle("shortcuts:update", (_e, id, key) => updateShortcut(id, key))
  typedHandle("shortcuts:reset", (_e, id) => resetShortcut(id))
  typedHandle("shortcuts:resetAll", () => resetAllShortcuts())
  typedHandle("shortcuts:conflicts", () => detectConflicts())

  // Diagnostics
  typedHandle("diagnostics:run", async () => {
    const storeGet = deps.store?.get?.bind?.(deps.store) || (() => undefined)
    return runDiagnostics({
      storeGet,
      hasProviders: () => (deps.providerMgr?.getConfig?.()?.providers?.length ?? 0) > 0,
      hasAgents: () => (deps.registry?.getAll?.()?.length ?? 0) > 0,
      hasMcpServers: () => listMcpServers().length > 0,
      hasMemoryEntries: () => (deps.memory?.()?.listEntries?.()?.length ?? 0) > 0,
      hasWorkspace: () => !!deps.getWorkspaceManager?.()?.getActive(),
      appVersion: resolveAppVersionFromMain()
    })
  })

  // Backup
  typedHandle("backup:create", () => createBackup(() => deps.store?.getAll?.() || {}, app.getPath('userData'), resolveAppVersionFromMain()))
  typedHandle("backup:list", () => listBackups(app.getPath('userData')))
  typedHandle("backup:restore", (_e, filename) => restoreBackup(app.getPath('userData'), filename, (key, value) => deps.store?.set?.(key, value)))
  typedHandle("backup:delete", (_e, filename) => deleteBackup(app.getPath('userData'), filename))

  // Notifications
  typedHandle("notifications:list", (_e, unreadOnly) => listNotifications(unreadOnly))
  typedHandle("notifications:unreadCount", () => getUnreadCount())
  typedHandle("notifications:push", (_e, input) => pushNotification(input))
  typedHandle("notifications:markRead", (_e, id) => markRead(id))
  typedHandle("notifications:markAllRead", () => markAllRead())
  typedHandle("notifications:delete", (_e, id) => deleteNotification(id))
  typedHandle("notifications:clearAll", () => clearAllNotifications())

  // Onboarding
  typedHandle("onboarding:getState", () => getOnboardingState())
  typedHandle("onboarding:shouldShow", () => shouldShowOnboarding())
  typedHandle("onboarding:completeStep", (_e, step, skipped) => completeStep(step, skipped))
  typedHandle("onboarding:skipAll", () => skipAllOnboarding())
  typedHandle("onboarding:reset", () => resetOnboarding())
  typedHandle("onboarding:nextStep", () => getNextStep())

  // Slash Commands
  typedHandle("slashCommands:list", () => listSlashCommands())
  typedHandle("slashCommands:get", (_e, shortcut) => getSlashCommand(shortcut))
  typedHandle("slashCommands:save", (_e, input) => saveSlashCommand(input))
  typedHandle("slashCommands:delete", (_e, shortcut) => deleteSlashCommand(shortcut))
  typedHandle("slashCommands:resolve", (_e, shortcut, params) => resolveSlashCommand(shortcut, params))
  typedHandle("slashCommands:validate", (_e, shortcut) => validateShortcut(shortcut))
  typedHandle("slashCommands:conflict", (_e, shortcut) => checkConflict(shortcut))

  // Project Map
  typedHandle("projectMap:build", (_e, rootPath, maxDepth) => buildProjectMap(rootPath, maxDepth))
  typedHandle("projectMap:search", (_e, map, query) => searchProjectFiles(map, query))

  // GitHub
  typedHandle("github:checkCli", () => checkGhCli())
  typedHandle("github:listPrs", async (_e, state, limit) => listPullRequests(state, limit))
  typedHandle("github:listIssues", async (_e, state, limit) => listIssues(state, limit))
  typedHandle("github:currentBranchPr", () => getCurrentBranchPr())
}
