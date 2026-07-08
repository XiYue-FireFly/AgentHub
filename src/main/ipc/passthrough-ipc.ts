import { BrowserWindow, app, type IpcMainInvokeEvent } from 'electron'
import { configureLocalAgent, getCachedLocalAgentStatuses, refreshLocalAgentStatusCache } from '../runtime/local-agents'
import { invalidateAgentCache } from './agent-loop-ipc'
import { readLocalModelConfig, scanLocalModels } from '../runtime/local-models'
import { getRunTimeoutMs, setRunTimeoutMs, RUN_TIMEOUT_DEFAULTS } from '../runtime/run-preferences'
import { buildAgentOptions } from '../runtime/agent-options'
import { clearWorkbenchGoal, getWorkbenchGoal, setWorkbenchGoal } from '../runtime/goals'
import { listSchedules, previewSchedule } from '../runtime/schedules'
import { listWorkbenchCommands, runWorkbenchCommand } from '../runtime/commands'
import { eccCommandStatus, updateEccCommands } from '../runtime/ecc-commands'
import { clearThreadTodos, deleteThreadTodo, listThreadTodos, setThreadTodos, syncTodosFromMarkdown, upsertThreadTodo } from '../runtime/todos'
import { checkUpdates, downloadUpdate, installUpdate, openUpdateDownload, setUpdateChannel, updateStatus } from '../runtime/updates'
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
import { getBudgetConfig, checkBudget, updateBudgetConfig, estimateDispatchBudget } from '../runtime/budget-center'
import { registerModelsIpc } from './models-ipc'
import { buildInlineEditPrompt, validateEditResult, applyInlineEdit } from '../runtime/inline-edit'
import { appEventLogPath, readRecentAppEventLogs } from '../runtime/app-event-log'
import { runReleaseChecks } from '../runtime/release-workspace'
import { listMcpServers } from '../runtime/mcp'
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
import { typedHandle } from './typed-ipc'

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
  getActiveWindow?: () => BrowserWindow | null
  openWorkbench?: () => BrowserWindow
}

export function registerPassthroughIpc(deps: PassthroughDeps): void {
  const { memory, runtimeStore, registry, providerMgr, resolveAppVersionFromMain, registerAgentsFromBindings, getWorkspaceManager, getMainWindow } = deps
  const windowForEvent = (event: IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender) || deps.getActiveWindow?.() || getMainWindow()

  // Window controls
  typedHandle("win:minimize", (event) => { windowForEvent(event)?.minimize() })
  typedHandle("win:maximizeToggle", (event) => {
    const win = windowForEvent(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  typedHandle("win:isMaximized", (event) => windowForEvent(event)?.isMaximized() ?? false)
  typedHandle("win:close", (event) => {
    windowForEvent(event)?.close()
  })
  typedHandle("windows:openWorkbench", () => ({ id: deps.openWorkbench?.().id ?? -1 }))

  typedHandle("localAgents:detect", () => refreshLocalAgentStatusCache())
  typedHandle("localAgents:status", () => getCachedLocalAgentStatuses())
  typedHandle("localAgents:options", () => buildAgentOptions(getCachedLocalAgentStatuses()))
  typedHandle("localAgents:configure", async (_event, agentId, patch) => {
    const result = await configureLocalAgent(agentId, patch)
    invalidateAgentCache()
    registerAgentsFromBindings()
    return result
  })
  typedHandle("localModels:scan", (_event, agentId) => scanLocalModels(agentId))
  typedHandle("localModels:readConfig", (_event, agentId) => readLocalModelConfig(agentId))

  typedHandle("settings:getRunTimeout", () => ({ value: getRunTimeoutMs(), ...RUN_TIMEOUT_DEFAULTS }))
  typedHandle("settings:setRunTimeout", (_event, value) => ({ value: setRunTimeoutMs(value), ...RUN_TIMEOUT_DEFAULTS }))

  typedHandle("goals:get", (_event, threadId) => getWorkbenchGoal(threadId))
  typedHandle("goals:set", (_event, threadId, goal, loopLimit) => setWorkbenchGoal(threadId, goal, loopLimit))
  typedHandle("goals:clear", (_event, threadId) => clearWorkbenchGoal(threadId))

  typedHandle("schedules:list", () => listSchedules())
  typedHandle("schedules:runPreview", (_event, preset) => previewSchedule(preset))

  typedHandle("commands:list", () => listWorkbenchCommands())
  typedHandle("commands:run", (_event, input) => runWorkbenchCommand(input))

  typedHandle("ecc:status", () => eccCommandStatus())
  typedHandle("ecc:update", () => updateEccCommands())

  typedHandle("todos:list", (_event, threadId) => listThreadTodos(threadId))
  typedHandle("todos:set", (_event, threadId, todos) => setThreadTodos(threadId, todos))
  typedHandle("todos:upsert", (_event, input) => upsertThreadTodo(input))
  typedHandle("todos:delete", (_event, threadId, todoId) => deleteThreadTodo(threadId, todoId))
  typedHandle("todos:clear", (_event, threadId) => clearThreadTodos(threadId))
  typedHandle("todos:syncFromMarkdown", (_event, threadId, markdown, sourceContext) => syncTodosFromMarkdown(threadId, markdown, sourceContext))

  typedHandle("updates:status", () => updateStatus())
  typedHandle("updates:check", (_event, channel) => checkUpdates(channel))
  typedHandle("updates:setChannel", (_event, channel) => setUpdateChannel(channel))
  typedHandle("updates:download", () => downloadUpdate())
  typedHandle("updates:install", () => installUpdate())
  typedHandle("updates:openDownload", () => openUpdateDownload())

  typedHandle("usage:stats", (_event, range, view) => usageStats(range, view))
  typedHandle("usage:records", (_event, filter, page, pageSize) => usageRecords(filter || {}, page, pageSize))
  typedHandle("usage:recordDetail", (_event, id) => usageRecordDetail(String(id || "")))
  typedHandle("usage:pricing:list", () => listUsagePricingRules())
  typedHandle("usage:pricing:upsert", (_event, rule) => upsertUsagePricingRule(rule || {}))
  typedHandle("usage:pricing:delete", (_event, idOrModelId, providerId) => deleteUsagePricingRule(String(idOrModelId || ""), providerId))

  typedHandle("prompts:list", (_e, category) => listPrompts(category))
  typedHandle("prompts:get", (_e, id) => getPrompt(id))
  typedHandle("prompts:upsert", (_e, input) => upsertPrompt(input))
  typedHandle("prompts:delete", (_e, id) => deletePrompt(id))
  typedHandle("prompts:search", (_e, query) => searchPrompts(query))
  typedHandle("prompts:slashCommands", () => getSlashCommands())
  typedHandle("prompts:incrementUse", (_e, id) => incrementUseCount(id))
  typedHandle("prompts:seedDefaults", () => seedDefaultPrompts())

  typedHandle("memory:scoreQuality", (_e, entry) => scoreMemoryQuality(entry))
  typedHandle("memory:detectConflicts", (_e, entries) => detectMemoryConflicts(entries))

  typedHandle("workflow:substituteVars", (_e, template, vars) => substituteVariables(template, vars))
  typedHandle("workflow:evaluateCondition", (_e, condition, vars) => evaluateCondition(condition, vars))
  typedHandle("workflow:saveRun", (_e, record) => { saveRunRecord(record); return true })
  typedHandle("workflow:runHistory", () => loadRunHistory())
  typedHandle("workflow:runHistoryFor", (_e, workflowId) => getWorkflowRunHistory(workflowId))

  typedHandle("teams:list", () => listTeamPresets())
  typedHandle("teams:save", (_e, input) => saveTeamPreset(input))
  typedHandle("teams:delete", (_e, id) => deleteTeamPreset(id))
  typedHandle("teams:defaultFirefly", (_e, agentIds) => getDefaultFireflyTeam(agentIds))

  typedHandle("knowledge:detectTechStack", (_e, rootPath) => {
    const root = resolveRegisteredWorkspaceRoot(rootPath)
    if (!root) return {}
    return detectTechStack(root)
  })
  typedHandle("knowledge:generateSummary", (_e, rootPath, entries) => {
    const root = resolveRegisteredWorkspaceRoot(rootPath)
    if (!root) return ''
    return generateWorkspaceSummary(root, entries)
  })

  typedHandle("firefly:createState", () => createFireflyState())
  typedHandle("firefly:completeRole", (_e, state, role, output) => completeRole(state, role, output))
  typedHandle("firefly:getRoleContext", (_e, state, role, prompt, memory, project) => getRoleContext(state, role, prompt, memory, project))
  typedHandle("firefly:isComplete", (_e, state) => isComplete(state))
  typedHandle("firefly:getOutput", (_e, state) => getFinalOutput(state))

  registerModelsIpc({ providerMgr })

  typedHandle("budget:get", () => getBudgetConfig())
  typedHandle("budget:update", (_e, patch) => updateBudgetConfig(patch))
  typedHandle("budget:check", (_e, dailySpent, monthlySpent, requestTokens, requestCostUsd) => checkBudget(getBudgetConfig(), dailySpent, monthlySpent, requestTokens, requestCostUsd))
  typedHandle("budget:estimateDispatch", (_e, payload) => estimateDispatchBudget({
    prompt: payload.prompt,
    attachments: payload.attachments,
    customSchedule: payload.customSchedule,
    modelSelection: payload.modelSelection || null,
    targetAgent: payload.targetAgent || null
  }))

  typedHandle("inlineEdit:buildPrompt", (_e, request) => buildInlineEditPrompt(request))
  typedHandle("inlineEdit:validate", (_e, original, replacement) => validateEditResult(original, replacement))
  typedHandle("inlineEdit:apply", (_e, content, startLine, endLine, replacement) => applyInlineEdit(content, startLine, endLine, replacement))

  typedHandle("routes:explain", async (_event, turnId) => {
    const snapshot = runtimeStore.snapshot(undefined)
    const turn = snapshot.turns.find((item: any) => item.id === turnId)
    if (!turn) return []
    return runtimeStore.eventsSince(turn.threadId, 0)
      .filter((event: any) => event.turnId === turnId && event.kind === "route:decision")
      .map((event: any) => event.payload)
  })
  typedHandle("logs:path", () => ({ path: appEventLogPath() }))
  typedHandle("logs:recent", (_event, limit) => readRecentAppEventLogs(limit))

  typedHandle("diagnostics:runSuite", async () => {
    return runDiagnosticSuite({
      appVersion: resolveAppVersionFromMain(),
      hasProviders: ((providerMgr?.getConfig?.()?.providers?.length ?? 0) > 0),
      hasAgents: (registry.getAll().length > 0),
      hasMcpServers: listMcpServers().length > 0,
      hasMemoryEntries: (memory()?.listEntries?.()?.length ?? 0) > 0,
      hasWorkspace: !!getWorkspaceManager()?.getActive()
    })
  })

  typedHandle("release:checks", async () => {
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
