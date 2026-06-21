/**
 * Workflow/Feature IPC handlers.
 *
 * Extracted from index.ts to isolate workflow, shortcut, diagnostic,
 * backup, notification, onboarding, and other feature IPC registrations.
 */

import { ipcMain } from 'electron'
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

interface WorkflowIpcDeps {
  resolveAppVersionFromMain: () => string
  getWorkspaceManager: () => any
  store?: any
  memory?: () => any
  providerMgr?: any
  registry?: any
}

export function registerWorkflowIpc(deps: WorkflowIpcDeps): void {
  const { resolveAppVersionFromMain, getWorkspaceManager } = deps

  // Workflows
  ipcMain.handle("workflows:list", (_e, category?: string) => listWorkflows(category as any))
  ipcMain.handle("workflows:get", (_e, id: string) => getWorkflow(id))
  ipcMain.handle("workflows:upsert", (_e, input: any) => upsertWorkflow(input))
  ipcMain.handle("workflows:delete", (_e, id: string) => deleteWorkflow(id))
  ipcMain.handle("workflows:search", (_e, query: string) => searchWorkflows(query))
  ipcMain.handle("workflows:seed", () => { seedDefaultWorkflows(); return listWorkflows() })

  // Keyboard Shortcuts
  ipcMain.handle("shortcuts:list", (_e, category?: string) => listShortcuts(category as any))
  ipcMain.handle("shortcuts:get", (_e, id: string) => getShortcut(id))
  ipcMain.handle("shortcuts:update", (_e, id: string, key: string) => updateShortcut(id, key))
  ipcMain.handle("shortcuts:reset", (_e, id: string) => resetShortcut(id))
  ipcMain.handle("shortcuts:resetAll", () => resetAllShortcuts())
  ipcMain.handle("shortcuts:conflicts", () => detectConflicts())

  // Diagnostics
  ipcMain.handle("diagnostics:run", async () => {
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
  ipcMain.handle("backup:create", () => createBackup(() => deps.store?.getAll?.() || {}, app.getPath('userData'), resolveAppVersionFromMain()))
  ipcMain.handle("backup:list", () => listBackups(app.getPath('userData')))
  ipcMain.handle("backup:restore", (_e, filename: string) => restoreBackup(app.getPath('userData'), filename, (k: string, v: any) => deps.store?.set?.(k, v)))
  ipcMain.handle("backup:delete", (_e, filename: string) => deleteBackup(app.getPath('userData'), filename))

  // Notifications
  ipcMain.handle("notifications:list", (_e, unreadOnly?: boolean) => listNotifications(unreadOnly))
  ipcMain.handle("notifications:unreadCount", () => getUnreadCount())
  ipcMain.handle("notifications:push", (_e, input: any) => pushNotification(input))
  ipcMain.handle("notifications:markRead", (_e, id: string) => markRead(id))
  ipcMain.handle("notifications:markAllRead", () => markAllRead())
  ipcMain.handle("notifications:delete", (_e, id: string) => deleteNotification(id))
  ipcMain.handle("notifications:clearAll", () => clearAllNotifications())

  // Onboarding
  ipcMain.handle("onboarding:getState", () => getOnboardingState())
  ipcMain.handle("onboarding:shouldShow", () => shouldShowOnboarding())
  ipcMain.handle("onboarding:completeStep", (_e, step: string, skipped?: boolean) => completeStep(step as any, skipped))
  ipcMain.handle("onboarding:skipAll", () => skipAllOnboarding())
  ipcMain.handle("onboarding:reset", () => resetOnboarding())
  ipcMain.handle("onboarding:nextStep", () => getNextStep())

  // Slash Commands
  ipcMain.handle("slashCommands:list", () => listSlashCommands())
  ipcMain.handle("slashCommands:get", (_e, shortcut: string) => getSlashCommand(shortcut))
  ipcMain.handle("slashCommands:save", (_e, input: any) => saveSlashCommand(input))
  ipcMain.handle("slashCommands:delete", (_e, shortcut: string) => deleteSlashCommand(shortcut))
  ipcMain.handle("slashCommands:resolve", (_e, shortcut: string, params: any) => resolveSlashCommand(shortcut, params))
  ipcMain.handle("slashCommands:validate", (_e, shortcut: string) => validateShortcut(shortcut))
  ipcMain.handle("slashCommands:conflict", (_e, shortcut: string) => checkConflict(shortcut))

  // Project Map
  ipcMain.handle("projectMap:build", (_e, rootPath: string, maxDepth?: number) => buildProjectMap(rootPath, maxDepth))
  ipcMain.handle("projectMap:search", (_e, map: any, query: string) => searchProjectFiles(map, query))

  // GitHub
  ipcMain.handle("github:checkCli", () => checkGhCli())
  ipcMain.handle("github:listPrs", async (_e, state?: string, limit?: number) => listPullRequests(state as any, limit))
  ipcMain.handle("github:listIssues", async (_e, state?: string, limit?: number) => listIssues(state as any, limit))
  ipcMain.handle("github:currentBranchPr", () => getCurrentBranchPr())
}
