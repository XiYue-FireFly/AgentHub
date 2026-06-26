import { ipcMain, BrowserWindow, app } from 'electron'
import { configureLocalAgent, getCachedLocalAgentStatuses, refreshLocalAgentStatusCache } from '../runtime/local-agents'
import { readLocalModelConfig, scanLocalModels } from '../runtime/local-models'
import { getRunTimeoutMs, setRunTimeoutMs, RUN_TIMEOUT_DEFAULTS } from '../runtime/run-preferences'
import { buildAgentOptions } from '../runtime/agent-options'
import { clearWorkbenchGoal, getWorkbenchGoal, setWorkbenchGoal } from '../runtime/goals'
import { listSchedules, previewSchedule } from '../runtime/schedules'
import { listWorkbenchCommands, runWorkbenchCommand } from '../runtime/commands'
import { eccCommandStatus, updateEccCommands } from '../runtime/ecc-commands'
import { clearThreadTodos, deleteThreadTodo, listThreadTodos, setThreadTodos, syncTodosFromMarkdown, upsertThreadTodo } from '../runtime/todos'
import { checkUpdates, openUpdateDownload, setUpdateChannel, updateStatus } from '../runtime/updates'
import { listPrompts, getPrompt, upsertPrompt, deletePrompt, searchPrompts, getSlashCommands, incrementUseCount, seedDefaultPrompts } from '../runtime/prompt-library'
import {
  deleteUsagePricingRule,
  listUsagePricingRules,
  upsertUsagePricingRule,
  usageRecordDetail,
  usageRecords,
  usageStats
} from '../runtime/usage-stats'
import { scoreMemoryQuality, detectMemoryConflicts } from '../runtime/memory-studio'
import { substituteVariables, evaluateCondition, saveRunRecord, loadRunHistory, getWorkflowRunHistory } from '../runtime/workflow-center'
import { listTeamPresets, saveTeamPreset, deleteTeamPreset, getDefaultFireflyTeam } from '../runtime/team-builder'
import { detectTechStack, generateWorkspaceSummary } from '../runtime/project-knowledge-enhanced'
import { runDiagnosticSuite } from '../runtime/diagnostics-suite'
import { createFireflyState, completeRole, getRoleContext, isComplete, getFinalOutput } from '../runtime/firefly-state-machine'
import { buildModelList, listGlobalModels, updateModelRoute, testModelRoute, exportCodexCatalog, toggleModelFavorite, toggleModelHidden, getModelFavorites, getModelHidden } from '../runtime/models-center'
import { getBudgetConfig, checkBudget, updateBudgetConfig } from '../runtime/budget-center'
import { buildInlineEditPrompt, validateEditResult, applyInlineEdit } from '../runtime/inline-edit'
import { appEventLogPath } from '../runtime/app-event-log'
import { DispatchPreset } from '../runtime/types'
import { runReleaseChecks } from '../runtime/release-workspace'
import { listMcpServers } from '../runtime/mcp'

interface PassthroughDeps {
  memory: () => any
  store: any
  runtimeStore: any
  dispatcher: any
  registry: any
  providerMgr: any
  resolveAppVersionFromMain: () => string
  registerAgentsFromBindings: () => void
  getWorkspaceManager: () => any
  getMainWindow: () => BrowserWindow | null
}

export function registerPassthroughIpc(deps: PassthroughDeps): void {
  const { memory, store, runtimeStore, registry, providerMgr, resolveAppVersionFromMain, registerAgentsFromBindings, getWorkspaceManager, getMainWindow } = deps

  // Window controls
  ipcMain.handle("win:minimize", () => { getMainWindow()?.minimize() })
  ipcMain.handle("win:maximizeToggle", () => {
    const win = getMainWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle("win:isMaximized", () => getMainWindow()?.isMaximized() ?? false)
  ipcMain.handle("win:close", () => {
    if (store.get("minimizeToTray") !== false) getMainWindow()?.hide()
    else getMainWindow()?.close()
  })

  ipcMain.handle("localAgents:detect", () => refreshLocalAgentStatusCache())
  ipcMain.handle("localAgents:status", () => getCachedLocalAgentStatuses())
  ipcMain.handle("localAgents:options", () => buildAgentOptions(getCachedLocalAgentStatuses()))
  ipcMain.handle("localAgents:configure", (_event, agentId: string, patch: { binary?: string; args?: string; protocol?: "stdio-plain" | "acp" }) => {
    const result = configureLocalAgent(agentId, patch)
    registerAgentsFromBindings()
    return result
  })
  ipcMain.handle("localModels:scan", (_event, agentId?: string | null) => scanLocalModels(agentId))
  ipcMain.handle("localModels:readConfig", (_event, agentId: string) => readLocalModelConfig(agentId))

  ipcMain.handle("settings:getRunTimeout", () => ({ value: getRunTimeoutMs(), ...RUN_TIMEOUT_DEFAULTS }))
  ipcMain.handle("settings:setRunTimeout", (_event, value: number) => ({ value: setRunTimeoutMs(value), ...RUN_TIMEOUT_DEFAULTS }))

  ipcMain.handle("goals:get", (_event, threadId?: string | null) => getWorkbenchGoal(threadId))
  ipcMain.handle("goals:set", (_event, threadId: string, goal: string, loopLimit?: number) => setWorkbenchGoal(threadId, goal, loopLimit))
  ipcMain.handle("goals:clear", (_event, threadId: string) => clearWorkbenchGoal(threadId))

  ipcMain.handle("schedules:list", () => listSchedules())
  ipcMain.handle("schedules:runPreview", (_event, preset: DispatchPreset) => previewSchedule(preset))

  ipcMain.handle("commands:list", () => listWorkbenchCommands())
  ipcMain.handle("commands:run", (_event, input: { id?: string; text?: string }) => runWorkbenchCommand(input))

  ipcMain.handle("ecc:status", () => eccCommandStatus())
  ipcMain.handle("ecc:update", () => updateEccCommands())

  ipcMain.handle("todos:list", (_event, threadId: string) => listThreadTodos(threadId))
  ipcMain.handle("todos:set", (_event, threadId: string, todos: any[]) => setThreadTodos(threadId, todos))
  ipcMain.handle("todos:upsert", (_event, input: { threadId: string; id?: string; content: string; status?: any; source?: any }) => upsertThreadTodo(input))
  ipcMain.handle("todos:delete", (_event, threadId: string, todoId: string) => deleteThreadTodo(threadId, todoId))
  ipcMain.handle("todos:clear", (_event, threadId: string) => clearThreadTodos(threadId))
  ipcMain.handle("todos:syncFromMarkdown", (_event, threadId: string, markdown: string) => syncTodosFromMarkdown(threadId, markdown))

  ipcMain.handle("updates:status", () => updateStatus())
  ipcMain.handle("updates:check", (_event, channel?: "stable" | "preview") => checkUpdates(channel))
  ipcMain.handle("updates:setChannel", (_event, channel: "stable" | "preview") => setUpdateChannel(channel))
  ipcMain.handle("updates:openDownload", () => openUpdateDownload())

  ipcMain.handle("usage:stats", (_event, range?: any, view?: any) => usageStats(range, view))
  ipcMain.handle("usage:records", (_event, filter?: any, page?: any, pageSize?: any) => usageRecords(filter || {}, page, pageSize))
  ipcMain.handle("usage:recordDetail", (_event, id: string) => usageRecordDetail(String(id || "")))
  ipcMain.handle("usage:pricing:list", () => listUsagePricingRules())
  ipcMain.handle("usage:pricing:upsert", (_event, rule: any) => upsertUsagePricingRule(rule || {}))
  ipcMain.handle("usage:pricing:delete", (_event, idOrModelId: string, providerId?: string) => deleteUsagePricingRule(String(idOrModelId || ""), providerId))

  ipcMain.handle("prompts:list", (_e, category?: string) => listPrompts(category as any))
  ipcMain.handle("prompts:get", (_e, id: string) => getPrompt(id))
  ipcMain.handle("prompts:upsert", (_e, input: any) => upsertPrompt(input))
  ipcMain.handle("prompts:delete", (_e, id: string) => deletePrompt(id))
  ipcMain.handle("prompts:search", (_e, query: string) => searchPrompts(query))
  ipcMain.handle("prompts:slashCommands", () => getSlashCommands())
  ipcMain.handle("prompts:incrementUse", (_e, id: string) => incrementUseCount(id))
  ipcMain.handle("prompts:seedDefaults", () => seedDefaultPrompts())

  ipcMain.handle("memory:scoreQuality", (_e, entry: any) => scoreMemoryQuality(entry))
  ipcMain.handle("memory:detectConflicts", (_e, entries: any[]) => detectMemoryConflicts(entries))

  ipcMain.handle("workflow:substituteVars", (_e, template: string, vars: any[]) => substituteVariables(template, vars))
  ipcMain.handle("workflow:evaluateCondition", (_e, condition: string, vars: any[]) => evaluateCondition(condition, vars))
  ipcMain.handle("workflow:saveRun", (_e, record: any) => { saveRunRecord(record); return true })
  ipcMain.handle("workflow:runHistory", () => loadRunHistory())
  ipcMain.handle("workflow:runHistoryFor", (_e, workflowId: string) => getWorkflowRunHistory(workflowId))

  ipcMain.handle("teams:list", () => listTeamPresets())
  ipcMain.handle("teams:save", (_e, input: any) => saveTeamPreset(input))
  ipcMain.handle("teams:delete", (_e, id: string) => deleteTeamPreset(id))
  ipcMain.handle("teams:defaultFirefly", (_e, agentIds: string[]) => getDefaultFireflyTeam(agentIds))

  ipcMain.handle("knowledge:detectTechStack", (_e, rootPath: string) => detectTechStack(rootPath))
  ipcMain.handle("knowledge:generateSummary", (_e, rootPath: string, entries: any[]) => generateWorkspaceSummary(rootPath, entries))

  ipcMain.handle("firefly:createState", () => createFireflyState())
  ipcMain.handle("firefly:completeRole", (_e, state: any, role: string, output: string) => completeRole(state, role as any, output))
  ipcMain.handle("firefly:getRoleContext", (_e, state: any, role: string, prompt: string, memory?: string, project?: string) => getRoleContext(state, role as any, prompt, memory, project))
  ipcMain.handle("firefly:isComplete", (_e, state: any) => isComplete(state))
  ipcMain.handle("firefly:getOutput", (_e, state: any) => getFinalOutput(state))

  ipcMain.handle("models:list", (_e, providers?: any[]) => Array.isArray(providers) ? buildModelList(providers) : listGlobalModels())
  ipcMain.handle("models:routeSettings:get", () => providerMgr.getModelRouteSettings())
  ipcMain.handle("models:routeSettings:set", (_e, patch: any) => providerMgr.setModelRouteSettings(patch || {}))
  ipcMain.handle("models:updateRoute", (_e, providerId: string, modelId: string, patch: any) => updateModelRoute(providerId, modelId, patch || {}))
  ipcMain.handle("models:test", (_e, input: { providerId: string; modelId: string; upstreamModel?: string }) => testModelRoute(input))
  ipcMain.handle("models:exportCodexCatalog", () => exportCodexCatalog())
  ipcMain.handle("models:toggleFavorite", (_e, providerId: string, modelId: string) => toggleModelFavorite(providerId, modelId))
  ipcMain.handle("models:toggleHidden", (_e, providerId: string, modelId: string) => toggleModelHidden(providerId, modelId))
  ipcMain.handle("models:favorites", () => [...getModelFavorites()])
  ipcMain.handle("models:hidden", () => [...getModelHidden()])

  ipcMain.handle("budget:get", () => getBudgetConfig())
  ipcMain.handle("budget:update", (_e, patch: any) => updateBudgetConfig(patch))
  ipcMain.handle("budget:check", (_e, dailySpent: number, monthlySpent: number, requestTokens: number) => checkBudget(getBudgetConfig(), dailySpent, monthlySpent, requestTokens))

  ipcMain.handle("inlineEdit:buildPrompt", (_e, request: any) => buildInlineEditPrompt(request))
  ipcMain.handle("inlineEdit:validate", (_e, original: string, replacement: string) => validateEditResult(original, replacement))
  ipcMain.handle("inlineEdit:apply", (_e, content: string, startLine: number, endLine: number, replacement: string) => applyInlineEdit(content, startLine, endLine, replacement))

  ipcMain.handle("routes:explain", async (_event, turnId: string) => {
    const snapshot = runtimeStore.snapshot(undefined)
    const turn = snapshot.turns.find((item: any) => item.id === turnId)
    if (!turn) return []
    return runtimeStore.eventsSince(turn.threadId, 0)
      .filter((event: any) => event.turnId === turnId && event.kind === "route:decision")
      .map((event: any) => event.payload)
  })
  ipcMain.handle("logs:path", () => ({ path: appEventLogPath() }))

  ipcMain.handle("diagnostics:runSuite", async () => {
    return runDiagnosticSuite({
      appVersion: resolveAppVersionFromMain(),
      hasProviders: ((providerMgr?.getConfig?.()?.providers?.length ?? 0) > 0),
      hasAgents: (registry.getAll().length > 0),
      hasMcpServers: listMcpServers().length > 0,
      hasMemoryEntries: (memory()?.listEntries?.()?.length ?? 0) > 0,
      hasWorkspace: !!getWorkspaceManager()?.getActive()
    })
  })

  ipcMain.handle("release:checks", async () => {
    const { execFile } = require("child_process")
    const { join } = require("path")
    const { existsSync } = require("fs")
    const appVersion = resolveAppVersionFromMain()
    let gitClean = false
    let hasChangelog = false
    let hasGitTag = false
    const cwd = app.isPackaged ? app.getAppPath() : join(__dirname, "..", "..")
    try {
      const status = await new Promise<string>((resolve, reject) => {
        execFile("git", ["status", "--porcelain"], { cwd, encoding: "utf-8", timeout: 10000, windowsHide: true }, (err: any, stdout: string) => err ? reject(err) : resolve(stdout))
      })
      gitClean = status.trim().length === 0
      hasChangelog = existsSync(join(cwd, "CHANGELOG.md"))
      try {
        const tagOutput = await new Promise<string>((resolve, reject) => {
          execFile("git", ["tag", "-l", "v" + appVersion], { cwd, encoding: "utf-8", timeout: 5000, windowsHide: true }, (err: any, stdout: string) => err ? reject(err) : resolve(stdout))
        })
        hasGitTag = tagOutput.trim().length > 0
      } catch { hasGitTag = false }
    } catch { /* git not available */ }
    // LOW-04: Actually execute typecheck, test, and build
    const runCommand = (cmd: string, args: string[], timeoutMs: number): Promise<boolean> => {
      return new Promise((resolve) => {
        execFile(cmd, args, { cwd, encoding: "utf-8", timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err: any) => {
          resolve(!err)
        })
      })
    }
    const [typecheckPass, testPass, buildPass] = await Promise.all([
      runCommand('npx', ['tsc', '-b', '--noEmit'], 120000),
      runCommand('npx', ['vitest', 'run'], 120000),
      runCommand('npx', ['electron-vite', 'build'], 120000)
    ])
    return runReleaseChecks({
      appVersion,
      typecheckPass,
      testPass,
      buildPass,
      hasChangelog,
      hasGitTag,
      gitClean
    })
  })
}
