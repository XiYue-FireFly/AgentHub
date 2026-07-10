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
import {
  exportEncryptedConfig,
  listSyncPackages,
  previewSyncPackage,
  importEncryptedConfig,
  deleteSyncPackage
} from '../runtime/config-sync'
import {
  webdavConfigStoreKey,
  redactWebDavConfig,
  testWebDav,
  webdavPushEncrypted,
  webdavPullImport,
  type WebDavStoredConfig
} from '../runtime/webdav-sync'
import { listNotifications, getUnreadCount, pushNotification, markRead, markAllRead, deleteNotification, clearAllNotifications } from '../runtime/notifications'
import { encryptSecret, decryptSecret } from '../store'
import { getOnboardingState, shouldShowOnboarding, completeStep, skipAllOnboarding, resetOnboarding, getNextStep } from '../runtime/onboarding'
import { listSlashCommands, getSlashCommand, saveSlashCommand, deleteSlashCommand, resolveSlashCommand, validateShortcut, checkConflict } from '../runtime/slash-commands'
import { buildProjectMap, searchProjectFiles } from '../runtime/project-map'
import { listMcpServers } from '../runtime/mcp'
import { listPullRequests, listIssues, getCurrentBranchPr, checkGhCli } from '../runtime/github-integration'
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
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

  // Wave4 P2: encrypted multi-machine sync packages
  typedHandle("sync:export", (_e, passphrase) =>
    exportEncryptedConfig(() => deps.store?.getAll?.() || {}, app.getPath('userData'), resolveAppVersionFromMain(), passphrase)
  )
  typedHandle("sync:list", () => listSyncPackages(app.getPath('userData')))
  typedHandle("sync:preview", (_e, filename) => previewSyncPackage(app.getPath('userData'), filename))
  typedHandle("sync:import", (_e, filename, passphrase) =>
    importEncryptedConfig(app.getPath('userData'), filename, passphrase, (key, value) => deps.store?.set?.(key, value))
  )
  typedHandle("sync:delete", (_e, filename) => deleteSyncPackage(app.getPath('userData'), filename))

  // Wave4+: WebDAV auto-sync adapter
  const webdavKey = webdavConfigStoreKey()
  function readWebDavStored(): WebDavStoredConfig | null {
    const raw = deps.store?.get?.(webdavKey)
    if (!raw || typeof raw !== 'object') return null
    return {
      url: String(raw.url || ''),
      username: String(raw.username || ''),
      password: raw.password ? decryptSecret(String(raw.password)) : '',
      remoteFileName: raw.remoteFileName,
      enabled: Boolean(raw.enabled),
      autoSyncMinutes: typeof raw.autoSyncMinutes === 'number' ? raw.autoSyncMinutes : 0
    }
  }
  function resolveWebDavConfig(override?: { url?: string; username?: string; password?: string; remoteFileName?: string; enabled?: boolean; autoSyncMinutes?: number }) {
    const stored = readWebDavStored()
    return {
      url: override?.url ?? stored?.url ?? '',
      username: override?.username ?? stored?.username ?? '',
      password: (override?.password && override.password.length > 0) ? override.password : (stored?.password || ''),
      remoteFileName: override?.remoteFileName ?? stored?.remoteFileName,
      enabled: override?.enabled ?? stored?.enabled,
      autoSyncMinutes: override?.autoSyncMinutes ?? stored?.autoSyncMinutes
    }
  }

  typedHandle("sync:webdavGetConfig", () => redactWebDavConfig(readWebDavStored()))
  typedHandle("sync:webdavSetConfig", (_e, config) => {
    const prev = readWebDavStored()
    const passwordPlain = (config.password && config.password.length > 0)
      ? config.password
      : (prev?.password || '')
    let passwordStored = ''
    if (passwordPlain) {
      try {
        passwordStored = encryptSecret(passwordPlain)
      } catch {
        // Tests / environments without safeStorage: store empty and rely on session override
        passwordStored = ''
      }
    }
    const next: WebDavStoredConfig = {
      url: String(config.url || '').trim(),
      username: String(config.username || '').trim(),
      password: passwordStored || (prev?.password && !(config.password === '') ? prev.password : ''),
      remoteFileName: config.remoteFileName,
      enabled: Boolean(config.enabled),
      autoSyncMinutes: typeof config.autoSyncMinutes === 'number' ? config.autoSyncMinutes : 0
    }
    // If encrypt failed but user provided password, keep plaintext only in-memory is not possible; store as plain with warning for headless tests
    if (passwordPlain && !passwordStored) {
      next.password = passwordPlain
    }
    deps.store?.set?.(webdavKey, next)
    return redactWebDavConfig({ ...next, password: passwordPlain || decryptSecret(String(next.password || '')) })
  })
  typedHandle("sync:webdavTest", async (_e, config) => testWebDav(resolveWebDavConfig(config || undefined)))
  typedHandle("sync:webdavPush", async (_e, passphrase, config) =>
    webdavPushEncrypted(
      resolveWebDavConfig(config || undefined),
      () => deps.store?.getAll?.() || {},
      resolveAppVersionFromMain(),
      passphrase
    )
  )
  typedHandle("sync:webdavPull", async (_e, passphrase, config) =>
    webdavPullImport(
      resolveWebDavConfig(config || undefined),
      passphrase,
      (key, value) => deps.store?.set?.(key, value)
    )
  )

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
  typedHandle("projectMap:build", (_e, rootPath, maxDepth) => {
    const root = resolveRegisteredWorkspaceRoot(rootPath)
    if (!root) return null
    return buildProjectMap(root, maxDepth)
  })
  typedHandle("projectMap:search", (_e, map, query) => searchProjectFiles(map, query))

  // GitHub — bind git/gh cwd to active (or first) registered workspace
  const resolveGithubCwd = (): string | undefined => {
    try {
      const mgr = deps.getWorkspaceManager?.()
      if (!mgr) return undefined
      const activeId = mgr.getActive?.()
      const active = activeId ? mgr.getById?.(activeId) : null
      const candidate = active?.rootPath || mgr.list?.()?.[0]?.rootPath
      if (!candidate) return undefined
      return resolveRegisteredWorkspaceRoot(candidate) || undefined
    } catch {
      return undefined
    }
  }

  typedHandle("github:checkCli", () => checkGhCli())
  typedHandle("github:listPrs", async (_e, state, limit) => listPullRequests(state, limit, resolveGithubCwd()))
  typedHandle("github:listIssues", async (_e, state, limit) => listIssues(state, limit, resolveGithubCwd()))
  typedHandle("github:currentBranchPr", () => getCurrentBranchPr(resolveGithubCwd()))
}
