import "./startup-paths"
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification } from "electron"
import { join, resolve } from "path"
import { pathToFileURL } from "url"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { randomBytes } from "crypto"
import type { DecisionOwner } from "../shared/decision-contract"
import { promptLineageFromEnvelope } from "../shared/prompt-contract"
import { isProviderDirectSelection } from "../shared/utils"
import { HubServer } from "./hub/server"
import { HubPromptDecisionChannel } from "./hub/prompt-decision-channel"
import { AgentRegistry } from "./hub/registry"
import { EventPipeline } from "./hub/pipeline"
import { KeywordRouter, RouteDecision } from "./hub/router"
import { Dispatcher } from "./hub/dispatcher"
import { installTaskTurnTracking } from "./hub/task-turn-tracking"
import { store } from "./store"
import { detectAgentsAsync } from "./hub/agent-detector"
import { getProviderManager } from "./providers/manager"
import { getLocalProxy } from "./routing/proxy"
import { syncRegistryFromBindings } from "./hub/agent-connections"
import { MemoryLibrary } from "./memory-library"
import { getWorkspaceManager } from "./hub/workspace"
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { ChatCompletionMessage, ThinkingConfig } from "./providers/types"
// --- /AgentHub skills + native agentic ---
import { getWorkbenchRuntimeStore } from "./runtime/store"
import { completeE2eRestartRecoveryTurn, installE2eDecisionFixture } from "./runtime/e2e-decision-fixture"
import { ThreadExecutionCoordinator } from "./runtime/thread-execution-coordinator"
import { WorkbenchTurnRunner } from "./runtime/workbench-turn-runner"
import { createPromptPreparationComposition } from "./runtime/prompt-preparation-composition"
import {
  invokeProductionPromptCandidateModel,
  resolveProductionPromptCandidateIdentity
} from "./runtime/prompt-candidate-provider"
import { hubPromptCacheContext, promptCacheContext } from "./runtime/prompt-cache-context"
import { RuntimeProducerTracker } from "./runtime/producer-tracker"
import {
  createSharedRuntimeDisposeForShutdown,
  drainRuntimeProducersForShutdown,
  finalizeRuntimePersistenceForShutdown,
  runShutdownStepWithDeadline
} from "./runtime/shutdown-quiescence"
import { createWillQuitHandler } from "./runtime/will-quit"
import { DecisionService } from "./runtime/decision-service"
import { ToolDecisionAdapter } from "./runtime/decision-adapters/tool-decision-adapter"
import { AcpDecisionAdapter } from "./runtime/decision-adapters/acp-decision-adapter"
import { PluginDecisionAdapter } from "./runtime/decision-adapters/plugin-decision-adapter"
import { GuardDecisionAdapter } from "./runtime/decision-adapters/guard-decision-adapter"
import { createUserDecisionAdapter } from "./agentic/user-decision-adapter"
import { getApprovalConfig } from "./agentic/approval"
import { ModelSelection, WorkbenchAttachment, WorkbenchTurn } from "./runtime/types"
import { degradeFusionIfUnavailable, dispatchPreparedTurn } from "./runtime/multi-model-dispatch"
import { MultiModelLoopRunner, type LoopDispatchGateway } from "./runtime/multi-model-loop"
import { resolveDistinctFusionRoutes } from "./runtime/multi-model-routes"
import { dispatchBudgetReservations } from "./runtime/budget-reservations"
import { refreshLocalAgentStatusCache } from "./runtime/local-agents"
import { buildAgentOptions } from "./runtime/agent-options"
import { getTerminalRuntime } from "./runtime/terminal"
import { disposeAllTerminalSessions } from "./ipc/terminal-pty-ipc"
import { upsertThreadTodo } from "./runtime/todos"
import { buildContextProjection } from "./runtime/context-ledger"
import { analyzePromptForDispatch } from "./runtime/prompt-optimizer"
import { applyRouteDecisionToPlan } from "./runtime/dispatch-planner"
import { executeQueuedWorkbenchTurnDispatch, resolveQueuedWorkbenchTurnDispatch } from "./runtime/workbench-turn-execution"
import { estimateDispatchBudget } from "./runtime/budget-center"
import { resolvePluginPreDispatchHooks } from "./runtime/plugin-contributions"
import { workspaceContextPrompt } from "./runtime/workspace-context"
import { compactChatMessages, compactTextByTokenBudget, estimateMessagesTokens } from "./runtime/token-economy"
import { runPreDispatchHooks } from "./hooks/hook-engine"
// keyboard-shortcuts imports moved to src/main/ipc/workflow-ipc.ts
// diagnostics, backup imports moved to src/main/ipc/workflow-ipc.ts
// notifications, onboarding imports moved to src/main/ipc/workflow-ipc.ts
// github, slash-commands imports moved to src/main/ipc/workflow-ipc.ts
// memory-graph imports no longer needed in index.ts
// project-map imports moved to src/main/ipc/workflow-ipc.ts
import { appendAppEventLog, installGlobalAppEventLogging } from "./runtime/app-event-log"
import { registerAllIpcHandlers } from "./ipc"
import { registerProviderIpc } from "./ipc/provider-ipc"
import { registerModelsIpc } from "./ipc/models-ipc"
import { installWebviewGuards } from "./security/webview-guards"
import { hub as hubLog, window_ as windowLog, pipeline as pipelineLog, proxy as proxyLog } from "./logger"
import {
  runCustomScheduleTurn
} from "./runtime/schedule-helpers"

installGlobalAppEventLogging()
appendAppEventLog('app:main-loaded', { version: app.getVersion?.() })
import { installAppMenu } from "./menu"

function resolveAppVersionFromMain(): string {
  try { return app.getVersion() } catch { return '1.0.0' }
}

const workbenchWindows = new Set<BrowserWindow>()
let lastFocusedWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hub: HubServer | null = null
const registry = new AgentRegistry()
const pipeline = new EventPipeline()
const router = new KeywordRouter()
const providerMgr = getProviderManager()
let dispatcher: Dispatcher | null = null
let dispatcherReadyResolve: (() => void) | null = null
const dispatcherReadyPromise = new Promise<void>(resolve => {
  dispatcherReadyResolve = resolve
})
const proxy = getLocalProxy()
let memoryLibrary: MemoryLibrary | null = null
const runtimeStore = getWorkbenchRuntimeStore()
const decisionService = new DecisionService({ runtimeStore })
const toolDecisionAdapter = new ToolDecisionAdapter({
  decisionService,
  approvalConfig: getApprovalConfig()
})
const acpDecisionAdapter = new AcpDecisionAdapter({ decisionService })
const pluginDecisionAdapter = new PluginDecisionAdapter({ decisionService })
const guardDecisionAdapter = new GuardDecisionAdapter({ decisionService })
const runtimeProducers = new RuntimeProducerTracker()
const hubPromptDecisionChannels = new Map<string, HubPromptDecisionChannel>()
const promptPreparationComposition = createPromptPreparationComposition({
  decisionService,
  // Hub Prompt decisions are wired with the Hub protocol in its own ingress
  // path. Workbench preparation must not fabricate a websocket decision.
  hubDecisionPort: {
    async decide(input) {
      const sessionId = input.owner?.type === "hub" ? input.owner.sessionId : ""
      const channel = hubPromptDecisionChannels.get(sessionId)
      return channel ? channel.decide(input) : { kind: "decision-required" as const }
    }
  },
  invokeCandidateModel: invokeProductionPromptCandidateModel,
  audit: event => appendAppEventLog(event.kind, event.payload)
})
interface PluginPreDispatchResult {
  attachments: WorkbenchAttachment[]
  workspaceRoot: string | null
  optimization: ReturnType<typeof analyzePromptForDispatch>
  outcome: Awaited<ReturnType<typeof runPreDispatchHooks>>
}

const workbenchTurnRunner = new WorkbenchTurnRunner<PluginPreDispatchResult>({
  runtimeStore,
  promptPreparation: {
    promptPreparationService: promptPreparationComposition.promptPreparationService,
    cacheContext: ({ submission, thread, turn }) => {
      const workspaceRoot = thread.workspaceId
        ? getWorkspaceManager().getById(thread.workspaceId)?.rootPath ?? null
        : null
      const modelSelection = turn.modelSelection ?? submission.input.modelSelection
      const candidateIdentity = resolveProductionPromptCandidateIdentity(modelSelection)
      return promptCacheContext({
        locale: "en-US",
        workspaceRoot,
        contextProjection: turn.contextProjection ?? {
          threadId: thread.id,
          workspaceId: thread.workspaceId
        },
        plugins: [],
        skills: [],
        attachments: turn.attachments ?? submission.input.attachments ?? [],
        providerId: candidateIdentity.providerId,
        modelId: candidateIdentity.modelId
      })
    }
  },
  preDispatch: approvePluginPreDispatch,
  execute: executeQueuedWorkbenchTurn,
  cancel: async turnId => { await dispatcher?.cancelTurn(turnId) }
})
const threadExecutionCoordinator = new ThreadExecutionCoordinator({
  runtimeStore,
  runner: workbenchTurnRunner
})
let stopTaskTurnTracking: (() => Promise<void>) | null = null
const IMAGE_DATA_URL_BYTES = 2 * 1024 * 1024
const MODEL_HISTORY_MAX_TOKENS = 24_000
const MODEL_CURRENT_MESSAGE_MAX_TOKENS = 12_000
const ATTACHMENT_TEXT_MAX_TOKENS = 4_000

function hasInlineTextAttachment(attachments?: WorkbenchAttachment[]): boolean {
  return attachments?.some(att => !!att.text && !att.path) ?? false
}

function liveWorkbenchWindows(): BrowserWindow[] {
  return [...workbenchWindows].filter(win => !win.isDestroyed())
}

function getActiveWorkbenchWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && workbenchWindows.has(focused) && !focused.isDestroyed()) return focused
  if (lastFocusedWindow && !lastFocusedWindow.isDestroyed()) return lastFocusedWindow
  return liveWorkbenchWindows()[0] ?? null
}

function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  lastFocusedWindow = win
}

function broadcastToWorkbenchWindows(channel: string, payload: unknown): void {
  for (const win of liveWorkbenchWindows()) {
    win.webContents.send(channel, payload)
  }
}

function sendToActiveWindow(action: string, params: Record<string, string> = {}): void {
  const win = getActiveWorkbenchWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send("app:menu-command", { action, params })
}

function materializeAttachments(attachments: WorkbenchAttachment[], workspaceId: string | null): WorkbenchAttachment[] {
  if (!attachments.length) return []
  const workspace = workspaceId ? getWorkspaceManager().getById(workspaceId) : null
  const root = workspace?.rootPath || app.getPath("userData")
  const attachmentDir = join(root, ".agenthub-attachments")
  return attachments.map(att => {
    if (att.path || !att.dataUrl?.startsWith("data:")) return att
    const match = att.dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/)
    if (!match) return att
    const mime = match[1] || att.mime || "application/octet-stream"
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : mime === "image/png" ? "png" : "bin"
    try {
      const data = Buffer.from(match[2], "base64")
      if (data.byteLength > IMAGE_DATA_URL_BYTES) return att
      mkdirSync(attachmentDir, { recursive: true })
      const safeName = (att.name || `attachment.${ext}`).replace(new RegExp(`[<>:"/\\\\|?*${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, "g"), "_").slice(0, 80)
      const fileName = `${Date.now().toString(36)}-${randomBytes(4).toString('hex').slice(0, 5)}-${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`
      const filePath = join(attachmentDir, fileName)
      writeFileSync(filePath, data)
      return { ...att, path: filePath, mime, size: att.size || data.byteLength }
    } catch {
      return att
    }
  })
}

function attachmentContextBlock(attachments?: WorkbenchAttachment[]): string {
  if (!attachments?.length) return ""
  const sections = attachments.map((att, index) => {
    const head = `Attachment ${index + 1}: ${att.name} (${att.kind}${att.mime ? `, ${att.mime}` : ""}${att.size ? `, ${att.size} bytes` : ""})`
    const lines = [head]
    if (att.path) lines.push(`Path: ${att.path}`)
    if (att.kind === "image") {
      lines.push("Use the local image path above as visual context. If the agent supports image input, inspect the image directly; otherwise reason from the filename/path and ask for clarification only if needed.")
      if (att.dataUrl) lines.push(`Inline preview data URL: ${att.dataUrl.slice(0, 8192)}${att.dataUrl.length > 8192 ? "...[truncated]" : ""}`)
    } else if (att.text) {
      const content = att.path
        ? compactTextByTokenBudget(att.text, ATTACHMENT_TEXT_MAX_TOKENS, {
          headTokens: Math.floor(ATTACHMENT_TEXT_MAX_TOKENS * 0.72),
          tailTokens: Math.floor(ATTACHMENT_TEXT_MAX_TOKENS * 0.18),
          marker: `[... attachment content omitted by token economy; original ${att.text.length} chars. Use the file path above or ask for a narrower excerpt if needed ...]`
        }).text
        : att.text
      lines.push("Content:")
      lines.push("```")
      lines.push(content)
      lines.push("```")
    }
    return lines.join("\n")
  })
  return [
    "[AgentHub Context Attachments]",
    "The user attached the following context. Treat these as part of the current turn and preserve file paths when referencing them.",
    "",
    ...sections
  ].join("\n\n")
}

function promptWithAttachments(prompt: string, attachments?: WorkbenchAttachment[]): string {
  const block = attachmentContextBlock(attachments)
  return [block, `[User Request]\n${prompt}`].filter(Boolean).join("\n\n")
}

function finalAssistantContentForTurn(turn: WorkbenchTurn): string {
  const events = runtimeStore.eventsSince(turn.threadId, 0).filter(event => event.turnId === turn.id)
  const orchestrated = [...events].reverse().find(event => event.kind === "orchestrate" && event.payload?.kind === "orchestrate:final")
  if (orchestrated?.payload?.content) return String(orchestrated.payload.content).trim()
  const internalAgents = new Set(["prompt-optimizer", "budget-guard", "dispatch-planner", "router"])
  const done = events.filter(event => event.kind === "agent:done" && event.payload?.content && event.payload?.visibility !== "run" && !internalAgents.has(event.agentId || ""))
  if (done.length === 0) return ""
  if (done.length === 1) return String(done[0].payload.content).trim()
  return done.map(event => {
    const label = event.agentId || event.payload?.agentId || "agent"
    return `### ${label}\n${String(event.payload.content).trim()}`
  }).join("\n\n")
}

function modelMessagesForTurn(threadId: string, currentPrompt: string, attachments?: WorkbenchAttachment[], excludeTurnId?: string): ChatCompletionMessage[] {
  const snapshot = runtimeStore.snapshot(undefined)
  const completedTurns = snapshot.turns
    .filter(turn => turn.threadId === threadId && turn.id !== excludeTurnId && turn.status === "completed")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-8)
  const messages: ChatCompletionMessage[] = []
  for (const previous of completedTurns) {
    messages.push({ role: "user", content: promptWithAttachments(previous.effectivePrompt || previous.prompt, previous.attachments) })
    const assistant = finalAssistantContentForTurn(previous)
    if (assistant) messages.push({ role: "assistant", content: assistant })
  }
  messages.push({ role: "user", content: promptWithAttachments(currentPrompt, attachments) })
  const preserveCurrentMessage = hasInlineTextAttachment(attachments)
  return compactModelMessages(messages, MODEL_HISTORY_MAX_TOKENS, preserveCurrentMessage)
}

function compactModelMessages(messages: ChatCompletionMessage[], maxTokens = MODEL_HISTORY_MAX_TOKENS, preserveCurrentMessage = false): ChatCompletionMessage[] {
  if (preserveCurrentMessage && messages.length > 0) {
    const current = messages[messages.length - 1]
    const currentTokens = estimateMessagesTokens([current])
    const historyBudget = Math.max(0, maxTokens - currentTokens)
    const history = messages.slice(0, -1)
    const compactedHistory = historyBudget > 0
      ? compactChatMessages(history, {
        maxTokens: historyBudget,
        keepRecentMessages: 3,
        perHistoricalMessageTokens: 1_200,
        currentMessageTokens: 2_000
      }) as ChatCompletionMessage[]
      : []
    return [...compactedHistory, current]
  }
  const compacted = compactChatMessages(messages, {
    maxTokens,
    keepRecentMessages: 4,
    perHistoricalMessageTokens: 1_600,
    currentMessageTokens: MODEL_CURRENT_MESSAGE_MAX_TOKENS
  }) as ChatCompletionMessage[]
  while (compacted.length > 1 && estimateMessagesTokens(compacted) > maxTokens) {
    compacted.shift()
  }
  return compacted
}

function recentUserPrompts(threadId: string, excludeTurnId?: string): string[] {
  return runtimeStore.snapshot(undefined).turns
    .filter(turn => turn.threadId === threadId && turn.id !== excludeTurnId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-10)
    .map(turn => turn.effectivePrompt || turn.prompt)
}

function availableRouteAgents(agentIds?: string[]) {
  const allowed = agentIds?.length ? new Set(agentIds) : null
  return registry.getAll().filter(agent => !allowed || allowed.has(agent.id)).map(a => ({
    id: a.id,
    name: a.name,
    status: a.status,
    mode: a.mode,
    protocol: a.protocol,
    adapter: a.adapter,
    capabilities: a.capabilities,
    lastActive: a.lastActive,
    errorCount: a.errorCount
  }))
}

// MED-04: Cache route stats to avoid expensive full-history scan on every routing decision
let routeStatsCache: { stats: Record<string, { success: number; failure: number; avgDurationMs?: number }>; timestamp: number } | null = null
const ROUTE_STATS_CACHE_TTL = 5000

function routeStatsFromHistory(): Record<string, { success: number; failure: number; avgDurationMs?: number }> {
  if (routeStatsCache && Date.now() - routeStatsCache.timestamp < ROUTE_STATS_CACHE_TTL) {
    return routeStatsCache.stats
  }
  const stats: Record<string, { success: number; failure: number; totalDuration: number; durationCount: number; avgDurationMs?: number }> = {}
  const events = runtimeStore.snapshot(undefined).threads.flatMap(thread => runtimeStore.eventsSince(thread.id, 0))
  for (const event of events) {
    if (!event.agentId || (!event.kind.startsWith("agent:") && event.kind !== "run:status")) continue
    const entry = stats[event.agentId] || { success: 0, failure: 0, totalDuration: 0, durationCount: 0 }
    if (event.kind === "agent:done") entry.success += 1
    if (event.kind === "agent:error") entry.failure += 1
    if (typeof event.payload?.durationMs === "number") {
      entry.totalDuration += event.payload.durationMs
      entry.durationCount += 1
    }
    stats[event.agentId] = entry
  }
  const result = Object.fromEntries(Object.entries(stats).map(([id, item]) => [
    id,
    {
      success: item.success,
      failure: item.failure,
      avgDurationMs: item.durationCount ? Math.round(item.totalDuration / item.durationCount) : undefined
    }
  ]))
  routeStatsCache = { stats: result, timestamp: Date.now() }
  return result
}

async function makeRouteDecision(threadId: string, turnId: string, prompt: string, agentIds?: string[]): Promise<RouteDecision> {
  const decision = router.routeWeighted({
    text: prompt,
    recentUserMessages: recentUserPrompts(threadId, turnId),
    availableAgents: availableRouteAgents(agentIds),
    memories: memory().selectContextEntries(prompt, { limit: 24, tokenBudget: 8_000 }),
    stats: routeStatsFromHistory()
  })
  await runtimeStore.appendSystemEvent(threadId, turnId, "route:decision", "router", {
    ...decision,
    privacy: "router received recent user prompts only; assistant/main outputs were excluded"
  })
  return decision
}

async function emitMemoryCandidates(threadId: string, turnId: string, prompt: string, content: string): Promise<void> {
  const candidates = memory().importConversation(`turn:${turnId}`, [`User: ${prompt}`, content ? `Assistant: ${content}` : ""].filter(Boolean).join("\n\n"), { includeRaw: false })
  for (const candidate of candidates.slice(0, 5)) {
    await runtimeStore.appendSystemEvent(threadId, turnId, "memory:candidate", "memory", {
      id: candidate.id,
      category: candidate.category,
      title: candidate.title,
      summary: candidate.summary,
      confidence: candidate.confidence,
      tags: candidate.tags
    })
  }
}

// Schedule helpers moved to runtime/schedule-helpers.ts

function syncPlanTodosFromEvent(event: any): void {
  if (event.kind !== "orchestrate" || event.payload?.kind !== "orchestrate:plan") return
  const subtasks = Array.isArray(event.payload?.subtasks) ? event.payload.subtasks : []
  if (subtasks.length === 0) return
  subtasks.forEach((task: any, index: number) => {
    const rawTaskId = String(task.id || task.title || task.detail || index)
    const stableTaskId = rawTaskId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || String(index)
    upsertThreadTodo({
      threadId: event.threadId,
      id: `orchestrate-${event.turnId}-${stableTaskId}`,
      content: String(task.title || task.detail || task.id || "Subtask"),
      source: { kind: "agent" as const, turnId: event.turnId }
    })
  })
}

runtimeStore.on("event", (event) => {
  syncPlanTodosFromEvent(event)
  if (event.kind === "decision:requested" && event.payload?.source === "guard") {
    showWindowsNotification("AgentHub needs your choice", "A high-risk guard warning is waiting for Continue or Stop.")
  } else if (event.kind === "turn:status") {
    if (event.payload?.status === "completed") showWindowsNotification("AgentHub", "Task completed.")
    if (event.payload?.status === "failed") showWindowsNotification("AgentHub", String(event.payload?.error || "Task failed.").slice(0, 120))
  }
  broadcastToWorkbenchWindows("runtime:event", event)
})

function memory(): MemoryLibrary {
  if (!memoryLibrary) memoryLibrary = new MemoryLibrary(app.getPath("userData"))
  return memoryLibrary
}

async function dispatchableLocalAgentIds(): Promise<string[]> {
  return buildAgentOptions(await refreshLocalAgentStatusCache()).map(agent => agent.agentId)
}

function trustedDecisionOwnerForTurn(turnId: string): Extract<DecisionOwner, { type: 'turn' }> | null {
  const turn = runtimeStore.getTurn(turnId)
  const thread = turn ? runtimeStore.getThread(turn.threadId) : undefined
  const webContentsId = turn?.ownerWebContentsId
  if (!turn || !thread) return null
  if (typeof webContentsId !== 'number' || !Number.isInteger(webContentsId) || webContentsId < 1) return null
  return {
    type: 'turn' as const,
    threadId: thread.id,
    turnId: turn.id,
    workspaceId: thread.workspaceId,
    webContentsId
  }
}

async function approvePluginPreDispatch(input: {
  submission: import('./runtime/types').QueuedThreadSubmission
  thread: import('./runtime/types').WorkbenchThread
  turn: WorkbenchTurn
  isStillActive: () => boolean
}): Promise<PluginPreDispatchResult> {
  const workspaceId = input.thread.workspaceId
  const workspaceRoot = workspaceId
    ? getWorkspaceManager().getById(workspaceId)?.rootPath ?? null
    : null
  const attachments = materializeAttachments(
    Array.isArray(input.submission.input.attachments) ? input.submission.input.attachments : [],
    workspaceId
  )
  const promptEnvelope = input.turn.promptEnvelope
  if (!promptEnvelope?.effectivePrompt) {
    throw new Error('A finalized Prompt envelope is required before plugin pre-dispatch.')
  }
  const optimization = analyzePromptForDispatch({
    prompt: promptEnvelope.effectivePrompt,
    workspaceRoot,
    attachments
  })
  const outcome = await runPreDispatchHooks(
    resolvePluginPreDispatchHooks({ workspaceRoot }),
    { threadId: input.thread.id, prompt: promptEnvelope.effectivePrompt, workspace: workspaceRoot || undefined }
  )
  const preDispatch = { attachments, workspaceRoot, optimization, outcome }
  if (outcome.denied) throw new Error(outcome.denied)
  for (const approval of outcome.approvalRequests) {
    if (!input.isStillActive()) return preDispatch
    const approved = await pluginDecisionAdapter.request({
      owner: trustedDecisionOwnerForTurn(input.turn.id),
      pluginId: approval.pluginId,
      hookId: approval.hookId,
      message: approval.message,
      idempotencyKey: `plugin-pre-dispatch:${input.turn.id}:${approval.pluginId}:${approval.hookId}`
    })
    if (!input.isStillActive()) return preDispatch
    if (!approved) throw new Error(approval.message)
  }
  return preDispatch
}

async function executeQueuedWorkbenchTurn(input: {
  submission: import('./runtime/types').QueuedThreadSubmission
  thread: import('./runtime/types').WorkbenchThread
  turn: WorkbenchTurn
  signal: AbortSignal
  isStillActive: () => boolean
  preDispatch: PluginPreDispatchResult
}): Promise<void> {
  if (await completeE2eRestartRecoveryTurn(runtimeStore, input.turn)) return
  if (!dispatcher) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      dispatcherReadyPromise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Dispatcher not ready after timeout')), 15000)
      })
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId)
    })
  }
  const activeDispatcher = dispatcher!
  const { submission, thread, turn } = input
  const payload = submission.input
  const promptEnvelope = turn.promptEnvelope
  if (!promptEnvelope?.envelopeId || !promptEnvelope.effectivePrompt) {
    throw new Error('A finalized Prompt envelope is required before routing.')
  }
  const usableLocalAgentIds = await dispatchableLocalAgentIds()
  const workspaceId = thread.workspaceId
  const { attachments, workspaceRoot, optimization, outcome: preDispatchOutcome } = input.preDispatch
  const routing = resolveQueuedWorkbenchTurnDispatch({
    payload,
    availableAgentIds: usableLocalAgentIds,
    attachments,
    optimization
  })
  const { requestedMode, directTarget, providerDirect, directRun, turnModelSelection, dispatchPlan: dispatchPlanBase } = routing
  const scheduleForTurn = dispatchPlanBase.schedule
  const pluginContext = preDispatchOutcome.additionalContext.length
    ? ['[Plugin PreDispatch Context]', ...preDispatchOutcome.additionalContext].join('\n\n')
    : ''
  const dispatchUserPrompt = [promptEnvelope.effectivePrompt, workspaceContextPrompt(workspaceId), pluginContext]
    .filter(Boolean)
    .join('\n\n')
  const contextProjection = buildContextProjection({
    thread,
    workspaceId,
    prompt: dispatchUserPrompt,
    attachments,
    snapshot: runtimeStore.snapshot(undefined),
    events: runtimeStore.eventsSince(thread.id, 0),
    memories: memory().selectContextEntries(dispatchUserPrompt, { limit: 8, tokenBudget: 3_000 }),
    pinnedBlocks: [optimization.contextBlock]
  })
  const messages = modelMessagesForTurn(thread.id, dispatchUserPrompt, attachments)
  const dispatchPrompt = messages.at(-1)?.content || promptWithAttachments(dispatchUserPrompt, attachments)
  const budgetEstimate = estimateDispatchBudget({
    prompt: dispatchPrompt,
    attachments: [],
    customSchedule: scheduleForTurn,
    modelSelection: turnModelSelection,
    targetAgent: directTarget || null
  })
  if (!budgetEstimate.check.allowed) {
    throw new Error(budgetEstimate.check.reason || 'Budget guardrail blocked this dispatch.')
  }
  await runtimeStore.appendSystemEvent(thread.id, turn.id, 'turn:summary', 'prompt-optimizer', {
    intent: optimization.intent,
    matchedSkills: optimization.matchedSkills,
    matchedPlugins: optimization.matchedPlugins,
    contextProjection,
    pluginPreDispatch: {
      additionalContextCount: preDispatchOutcome.additionalContext.length,
      warnings: preDispatchOutcome.warnings
    }
  })
  await runtimeStore.appendSystemEvent(thread.id, turn.id, 'turn:summary', 'budget-guard', {
    totalTokens: budgetEstimate.totalTokens,
    estimatedRequests: budgetEstimate.estimatedRequests,
    estimatedCostUsd: budgetEstimate.estimatedCostUsd,
    hasUnpriced: budgetEstimate.hasUnpriced,
    warning: budgetEstimate.check.warning
  })
  const routeDecision = !directRun && dispatchPlanBase.routeAgentIds?.length
    ? await makeRouteDecision(thread.id, turn.id, promptEnvelope.effectivePrompt, dispatchPlanBase.routeAgentIds)
    : undefined
  const plan = applyRouteDecisionToPlan(dispatchPlanBase, routeDecision)
  await runtimeStore.appendSystemEvent(thread.id, turn.id, 'turn:summary', 'dispatch-planner', {
    strategy: plan.strategy,
    requestedMode,
    effectiveMode: plan.effectiveMode,
    dispatchMode: plan.dispatchMode,
    schedule: plan.schedule ? {
      preset: plan.schedule.preset,
      label: plan.schedule.label,
      steps: plan.schedule.steps.map(step => ({ id: step.id, role: step.role, agentId: step.agentId, dependsOn: step.dependsOn }))
    } : undefined,
    reasons: plan.reasons,
    selectedAgentId: routeDecision?.selectedAgentId
  })
  const preserveCurrentMessage = hasInlineTextAttachment(attachments)
  const lineage = promptLineageFromEnvelope(promptEnvelope)
  const contextLayers = [
    workspaceId ? 'workspace' : 'no-workspace',
    contextProjection ? 'context-projection' : ''
  ].filter(Boolean)
  const decisionOwner = trustedDecisionOwnerForTurn(turn.id)
  const userDecisionAdapter = decisionOwner
    ? createUserDecisionAdapter({ decisionService, owner: decisionOwner })
    : undefined
  // The preflight above can take time (attachments, plugins, routing and
  // planning). Cancellation may settle the durable Turn while it is running;
  // never hand a stale submission to a provider or dispatcher.
  if (!input.isStillActive()) return
  const dispatchOrdinary = () => executeQueuedWorkbenchTurnDispatch({
      routing,
      plan,
      dispatcher: activeDispatcher,
      prompt: dispatchPrompt,
      providerOptions: {
        thinking: payload.thinking as ThinkingConfig | undefined,
        workspaceId,
        turnId: turn.id,
        threadId: thread.id,
        conversationText: dispatchPrompt,
        messages,
        preserveCurrentMessage,
        lineage,
        attachments,
        contextLayers,
        userDecisionAdapter
      },
      dispatchOptions: {
        thinking: payload.thinking as ThinkingConfig | undefined,
        modelSelection: turnModelSelection,
        workspaceId,
        turnId: turn.id,
        threadId: thread.id,
        conversationText: dispatchPrompt,
        messages,
        preserveCurrentMessage,
        lineage,
        attachments,
        contextLayers,
        userDecisionAdapter
      },
      runSchedule: () => runCustomScheduleTurn({
          dispatcher: activeDispatcher,
          prompt: dispatchPrompt,
          schedule: plan.schedule!,
          workspaceId,
          turnId: turn.id,
          threadId: thread.id,
          messages,
          isCancelled: () => runtimeStore.getTurn(turn.id)?.status === 'cancelled',
          thinking: payload.thinking as ThinkingConfig | undefined,
          modelSelection: turnModelSelection,
           preserveCurrentMessage,
           userDecisionAdapter,
           routeDecision,
           recentUserMessages: recentUserPrompts(thread.id, turn.id),
           emitMemoryCandidates,
           guardDecisionAdapter,
            guardDecisionOwner: trustedDecisionOwnerForTurn(turn.id),
            lineage
      })
    })
  const fusionConfig = turn.multiModelFusion ?? payload.multiModelFusion ?? {
    enabled: false,
    maxCandidates: 3 as const,
    maxRounds: 3 as const,
    allowExecutor: true
  }
  const execution = dispatchPreparedTurn({
    envelope: promptEnvelope,
    fusion: fusionConfig
  }, {
    dispatchOrdinary: async envelope => {
      if (envelope.effectivePrompt !== promptEnvelope.effectivePrompt) {
        throw new Error('Prepared Prompt envelope changed before ordinary dispatch.')
      }
      return dispatchOrdinary()
    },
    runFusion: async (envelope, config) => {
      const routes = resolveDistinctFusionRoutes({
        getBindings: () => providerMgr.getBindings(),
        resolveBinding: agentId => providerMgr.resolveBinding(agentId)
      })
      const availability = await degradeFusionIfUnavailable({
        envelope,
        routeCount: routes.length,
        emitDegraded: async event => {
          await runtimeStore.appendSystemEvent(
            thread.id,
            turn.id,
            'turn:summary',
            'multi-model-loop',
            event
          )
        }
      }, async fallbackEnvelope => {
        if (fallbackEnvelope.effectivePrompt !== promptEnvelope.effectivePrompt) {
          throw new Error('Prepared Prompt envelope changed before degraded ordinary dispatch.')
        }
        return dispatchOrdinary()
      })
      if (availability.kind === 'degraded') {
        return availability.result
      }

      const loopGateway: LoopDispatchGateway = {
        start(request) {
          const handle = activeDispatcher.startDispatch(
            request.prompt,
            'auto',
            request.route.agentId,
            {
              workspaceId,
              turnId: request.options.turnId,
              threadId: request.options.threadId,
              parentRunId: request.options.parentRunId,
              branchId: request.branchId,
              sessionKey: request.options.sessionKey,
              signal: request.options.signal,
              deadline: request.options.deadline,
              budgetReservationId: request.options.budgetReservationId,
              visibility: request.options.visibility,
              capabilityMode: request.options.capabilityMode,
              userDecisionAdapter,
              lineage: request.options.lineage,
              parentDispatchId: request.options.lineage.parentDispatchId,
              messages: request.options.messages,
              conversationText: request.options.conversationText,
              attachments,
              contextLayers,
              streamMeta: {
                visibility: 'run',
                optimizationCount: 0,
                role: request.role,
                origin: request.origin,
                gatedRelease: false
              }
            }
          )
          return {
            taskId: handle.taskId,
            cancel: handle.cancel,
            result: handle.result.then(task => {
              if (!task.latestDispatchEnvelope) {
                throw new Error('Dispatcher send boundary did not return a verified DispatchEnvelope.')
              }
              return {
                status: task.status === 'completed'
                  ? 'completed' as const
                  : task.status === 'cancelled'
                    ? 'cancelled' as const
                    : 'failed' as const,
                content: task.results.get(request.route.agentId) || [...task.results.values()].join('\n\n'),
                error: task.error || task.errors.get(request.route.agentId),
                dispatchEnvelope: task.latestDispatchEnvelope
              }
            })
          }
        }
      }

      let finalRelease: Promise<boolean> | undefined
      const loop = new MultiModelLoopRunner({
        gateway: loopGateway,
        reservations: dispatchBudgetReservations,
        emit: event => {
          if (event.kind === 'multi-model:final') {
            finalRelease = runtimeStore.completeTurnWithFinalEvent(turn.id, {
              agentId: 'multi-model-loop',
              payload: {
                kind: event.kind,
                content: event.content || '',
                visibility: 'chat',
                gatedRelease: true,
                metadata: event.metadata
              }
            })
            return
          }
          void runtimeStore.appendSystemEvent(
            thread.id,
            turn.id,
            event.kind as any,
            'multi-model-loop',
            { ...event, visibility: 'run', gatedRelease: false }
          ).catch(error => {
            console.error('[multi-model-loop] Failed to persist internal event', error)
          })
        },
        estimateRound: candidateCount => ({
          tokens: budgetEstimate.totalTokens * (candidateCount + 2),
          costUsd: budgetEstimate.estimatedCostUsd === null
            ? null
            : budgetEstimate.estimatedCostUsd * (candidateCount + 2),
          requests: candidateCount + 2
        }),
        estimateSingle: () => ({
          tokens: budgetEstimate.totalTokens,
          costUsd: budgetEstimate.estimatedCostUsd,
          requests: 1
        })
      })
      const result = await loop.run({
        runId: turn.id,
        envelope: promptEnvelope,
        lineage,
        routes,
        turnId: turn.id,
        threadId: thread.id,
        signal: input.signal,
        messages,
        conversationText: dispatchPrompt,
        deadline: Date.now() + 10 * 60 * 1000,
        branchTimeoutMs: 2 * 60 * 1000,
        maxCandidates: config.maxCandidates,
        maxRounds: config.maxRounds,
        // Side-effect execution stays disabled until a future structured Judge
        // decision is paired with explicit user/Turn authorization. A persisted
        // Fusion preference or lexical intent classification cannot authorize it.
        requiresExecution: false
      })
      if (!finalRelease) throw new Error('Multi-model Loop did not publish a gated final result.')
      const released = await finalRelease
      return {
        id: `multi-model-loop:${turn.id}`,
        status: released ? 'completed' as const : 'cancelled' as const,
        results: new Map([['multi-model-loop', result.content]]),
        errors: new Map<string, string>(),
        fusionReleased: true
      }
    }
  })
  const sanitizeError = (error: unknown): string | undefined => {
    if (!error) return undefined
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/[A-Z]:\\[^\s]+/gi, '<path>').replace(/\/home\/[^\s]+/g, '<path>')
  }
  const settlement = execution.then(async (task: any) => {
    // Fusion publishes and completes atomically through the single gated final
    // event above; a second transition would duplicate completion/memory work.
    if (task?.fusionReleased === true) return
    if (plan.schedule && !('id' in task)) {
      await runtimeStore.transitionTurnStatus(turn.id, ['running'], task.status, { error: sanitizeError(task.error) })
      return
    }
    const status = task.status === 'cancelled' ? 'cancelled' : task.status === 'failed' ? 'failed' : 'completed'
    const settled = await runtimeStore.transitionTurnStatus(turn.id, ['running'], status, {
      taskId: task.id,
      error: sanitizeError(task.error)
    })
    if (status === 'completed' && settled) {
      await emitMemoryCandidates(thread.id, turn.id, payload.prompt, Array.from(task.results.values()).join('\n\n'))
    }
  }).catch(async error => {
    await runtimeStore.transitionTurnStatus(turn.id, ['running'], 'failed', { error: sanitizeError(error) })
  })
  await runtimeProducers.track(settlement)
}

function appAssetPath(fileName: string): string {
  const packaged = join(process.resourcesPath, "build", fileName)
  if (app.isPackaged && existsSync(packaged)) return packaged

  const fromAppPath = join(app.getAppPath(), "build", fileName)
  if (existsSync(fromAppPath)) return fromAppPath

  return join(process.cwd(), "build", fileName)
}

function showWindowsNotification(title: string, body: string): void {
  if (process.platform !== "win32" || !Notification.isSupported()) return
  try {
    new Notification({ title, body, silent: true }).show()
  } catch {
    // Ignore notification failures; the in-app timeline remains the source of truth.
  }
}

function createWindow(): BrowserWindow {
  const isDevRenderer = Boolean(process.env.ELECTRON_RENDERER_URL)
  const rendererEntryPath = join(__dirname, "../renderer/index.html")
  const trustedRendererUrl = process.env.ELECTRON_RENDERER_URL || pathToFileURL(rendererEntryPath).href
  const iconPath = appAssetPath(process.platform === "win32" ? "icon.ico" : "icon.png")
  windowLog.info(`create renderer=${process.env.ELECTRON_RENDERER_URL || "file"} dev=${isDevRenderer}`)
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "AgentHub",
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // P2-4: Enable sandbox for defense-in-depth. Preload only uses
      // contextBridge + ipcRenderer (both available in sandbox mode).
      sandbox: true,
      webviewTag: true
    },
    show: isDevRenderer,
    frame: false,
    backgroundColor: "#f7f8fb"
  })
  workbenchWindows.add(win)
  lastFocusedWindow = win
  installWebviewGuards(win.webContents, trustedRendererUrl)
  let hasShownMainWindow = isDevRenderer
  const revealMainWindow = (): void => {
    if (win.isDestroyed()) return
    revealWindow(win)
    hasShownMainWindow = true
    windowLog.info(`reveal visible=${win.isVisible()} focused=${win.isFocused()} minimized=${win.isMinimized()}`)
  }
  win.on("focus", () => {
    lastFocusedWindow = win
  })
  win.on("ready-to-show", () => {
    windowLog.info("ready-to-show")
    revealMainWindow()
  })
  win.webContents.once("did-finish-load", () => {
    windowLog.info("did-finish-load")
    if (!hasShownMainWindow) revealMainWindow()
  })
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return
    windowLog.error(`Failed to load renderer ${url}: ${code} ${description}`)
    revealMainWindow()
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    windowLog.error("Renderer process gone:", details)
    revealMainWindow()
  })
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const prefix = level >= 2 ? "error" : level === 1 ? "warn" : "log"
    console[prefix](`[Renderer:${prefix}] ${message} (${sourceId}:${line})`)
  })
  const revealTimer = setTimeout(() => {
    if (!hasShownMainWindow) revealMainWindow()
  }, isDevRenderer ? 1500 : 5000)
  revealTimer.unref?.()
  win.on("maximize", () => win.webContents.send("win:maximized", true))
  win.on("unmaximize", () => win.webContents.send("win:maximized", false))
  win.on("close", (event) => {
    if ((app as any).isQuitting) return
    const visibleWindows = liveWorkbenchWindows().filter(item => item.isVisible())
    const isLastVisibleWindow = visibleWindows.length <= 1 && visibleWindows[0] === win
    if (store.get("minimizeToTray") !== false && isLastVisibleWindow) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on("closed", () => {
    workbenchWindows.delete(win)
    if (lastFocusedWindow === win) lastFocusedWindow = liveWorkbenchWindows()[0] ?? null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(trustedRendererUrl)
  } else {
    win.loadFile(rendererEntryPath)
  }
  return win
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(appAssetPath(process.platform === "win32" ? "icon.ico" : "icon.png"))
  tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open AgentHub", click: () => ensureWindowVisible() },
    { type: "separator" },
    { label: "Status: Running", enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => { (app as any).isQuitting = true; app.quit() } }
  ])
  tray.setToolTip("AgentHub - Multi-Agent Workbench")
  tray.setContextMenu(contextMenu)
  tray.on("double-click", () => ensureWindowVisible())
}

function ensureWindowVisible(): BrowserWindow {
  const win = getActiveWorkbenchWindow() || createWindow()
  revealWindow(win)
  return win
}

function openWorkbench(): BrowserWindow {
  const win = createWindow()
  revealWindow(win)
  return win
}

function registerAgentsFromBindings(): void {
  syncRegistryFromBindings(registry, providerMgr.getBindings())
}

async function initHub(): Promise<void> {
  registerAgentsFromBindings()
  pipeline.register({
    name: "rate-limiter",
    type: "guard",
    handle: async (event) => event
  })
  pipeline.register({
    name: "logger",
    type: "observe",
    handle: async (event) => {
      pipelineLog.debug(event.source + " -> " + event.target)
      return event
    }
  })
  dispatcher = new Dispatcher(
    registry,
    pipeline,
    (taskText = "") => memory().selectContextEntries(taskText, { limit: 12, tokenBudget: 4_000 }),
    {
      requestToolDecision: async ({ task, agentId, request, idempotencyKey, onRequested }) => {
        const owner = task.__turnId ? trustedDecisionOwnerForTurn(task.__turnId) : null
        if (!owner) return false
        return toolDecisionAdapter.request({
          owner,
          agentId,
          tool: request.tool,
          toolName: request.toolName,
          action: request.action,
          target: request.target,
          preview: request.preview,
          risk: request.risk,
          idempotencyKey
        }, {
          onRequested: decision => onRequested(decision.id)
        })
      },
      requestAcpPermissionDecision: async ({ task, agentId, request, idempotencyKey, onRequested }) => {
        const owner = task.__turnId ? trustedDecisionOwnerForTurn(task.__turnId) : null
        if (!owner) return { outcome: 'cancelled' }
        return acpDecisionAdapter.request({
          owner,
          agentId,
          title: request.label || `Allow ${request.toolName}?`,
          toolName: request.toolName,
          options: request.options,
          idempotencyKey
        }, {
          onRequested: decision => onRequested(decision.id)
        })
      },
      cancelDecisionTurn: turnId => decisionService.cancelTurn(turnId),
      cancelDecisionAgent: (turnId, agentId) => decisionService.cancelAgentDecisions(turnId, agentId)
    }
  )
  stopTaskTurnTracking = installTaskTurnTracking(dispatcher, runtimeStore)
  dispatcherReadyResolve?.()
  hub = new HubServer(registry)

  // HubServer mints every client ID; DecisionService treats that same opaque ID
  // as the trusted Hub decision session and never accepts a client-supplied alias.
  hub.on("client:connected", ({ id: sessionId }) => {
    decisionService.openHubSession(sessionId)
  })
  hub.on("client:disconnected", ({ sessionId }) => {
    hubPromptDecisionChannels.delete(sessionId)
    void decisionService.closeHubSession(sessionId).catch(error => {
      hubLog.error("[hub] Decision session cleanup failed:", error)
    })
  })

  hub.on("client:message", async ({ clientId, message }) => {
    try {
    if (message.type === "prompt:decision_resolve") {
      const channel = hubPromptDecisionChannels.get(clientId)
      if (!channel) return
      await channel.resolve(message, { type: "hub", sessionId: clientId })
      return
    }
    if (message.type === "chat:message") {
      if (!dispatcher) {
        hubLog.error("[hub] dispatcher not initialized, dropping message")
        return
      }
      const payload = message.payload || {}
      const originalPrompt = typeof payload.text === "string" ? payload.text.trim() : ""
      if (!originalPrompt) {
        hub?.sendToClient(clientId, { type: "chat:error", error: "Prompt text is required" })
        return
      }
      const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : null
      const workspaceRoot = workspaceId
        ? getWorkspaceManager().getById(workspaceId)?.rootPath ?? null
        : null
      const targetAgent = String(payload.targetAgent || "").trim() || undefined
      const modelSelection = payload.modelSelection as ModelSelection | undefined
      const candidateIdentity = resolveProductionPromptCandidateIdentity(modelSelection)
      const promptChannel = new HubPromptDecisionChannel({
        sessionId: clientId,
        supportsProtocol: payload.promptDecisionProtocol === true,
        decisions: decisionService,
        send: frame => { hub?.sendToClient(clientId, frame) }
      })
      hubPromptDecisionChannels.set(clientId, promptChannel)
      const prepared = await promptPreparationComposition.promptPreparationService.prepareRoot({
        origin: "hub:websocket",
        prompt: originalPrompt,
        cacheContext: hubPromptCacheContext({
          locale: typeof payload.locale === "string" ? payload.locale : undefined,
          workspaceRoot,
          providerId: candidateIdentity.providerId,
          modelId: candidateIdentity.modelId
        }),
        decisionOwner: { type: "hub", sessionId: clientId }
      })
      if (prepared.kind === "decision-required") {
        hub?.sendToClient(clientId, {
          type: "decision_required",
          code: "PROMPT_DECISION_REQUIRED",
          sessionId: clientId,
          candidates: prepared.candidates
        })
        return
      }
      if (prepared.kind === "cancelled") {
        hub?.sendToClient(clientId, { type: "chat:error", error: "Prompt preparation was cancelled" })
        return
      }
      if (prepared.kind === "failed") {
        hub?.sendToClient(clientId, { type: "chat:error", error: prepared.error })
        return
      }
      const effectivePrompt = prepared.envelope.effectivePrompt
      const lineage = promptLineageFromEnvelope(prepared.envelope)
      const task = !targetAgent && isProviderDirectSelection(modelSelection)
        ? await dispatcher.dispatchProviderDirect(effectivePrompt, modelSelection, {
          thinking: message.payload.thinking,
          workspaceId,
          messages: [{ role: "user", content: effectivePrompt }],
          lineage: promptLineageFromEnvelope(prepared.envelope)
        })
        : await dispatcher.dispatch(
          effectivePrompt,
          payload.mode || "auto",
          targetAgent,
          {
            thinking: payload.thinking,
            modelSelection: targetAgent ? undefined : modelSelection,
            workspaceId,
            lineage
          }
        )
      hub?.broadcast("chat:response", {
        taskId: task.id,
        status: task.status,
        results: Array.from(task.results.entries()).map(([agentId, content]) => ({
          agentId, content, thinking: task.thinking.get(agentId) || ""
        })),
        errors: Array.from(task.errors.entries()),
        thinkingSummary: Array.from(task.thinkingSummary.entries()),
        error: task.error
      })
      if (task.status === "completed") {
        const agents = Array.from(task.results.keys()).join(", ")
        if (agents) showWindowsNotification("AgentHub", "Task done by " + agents)
      }
    }
    } catch (err) {
      hubLog.error("[hub] client:message handler failed:", err)
      hub?.broadcast("chat:error", { error: String(err) })
    }
  })

  try {
    await detectAgentsAsync()
    hubLog.info("Initial agent detection complete")
  } catch (e) {
    hubLog.error("Initial detection failed:", e)
  }

  try {
    await proxy.start()
    proxyLog.info("Local Chat Completions:", proxy.getUrl())
  } catch (e) {
    proxyLog.error("Failed to start:", e)
  }

  hub.start()
}

// Hub, threads, runtime, context, git:query handlers moved to ipc/hub-threads-ipc.ts
// prompts, conversation, workspaceFiles, plugins, release, terminalAi, ai:quickComplete,
// browser:summarize/extractText/analyzePrompt, inlineEdit, routes, logs,
// models, budget, memory:studio, workflow, teams, knowledge, plugins:enhanced,
// diagnostics, firefly, proxy, takeover, agents, app, win, workspaces,
// skills, agentic, execution — all moved to src/main/ipc/ modules
// (registered via registerAllIpcHandlers in app.whenReady)


// MED-06: Whitelist of allowed deep link actions to prevent arbitrary action injection
const DEEP_LINK_ACTIONS = new Set(['open', 'thread', 'settings', 'agents', 'providers', 'models', 'memory', 'workflows'])

function parseDeepLink(url: string): { action: string; params: Record<string, string> } | null {
  if (!url || !url.startsWith('agenthub://')) return null
  try {
    const stripped = url.startsWith('agenthub://') ? url.slice('agenthub://'.length).replace(/^[/]+/, '') : url
    const [actionPath, query] = stripped.split('?')
    const action = actionPath.split('/')[0] || 'open'
    if (!DEEP_LINK_ACTIONS.has(action)) return null
    const params: Record<string, string> = {}
    if (query) {
      for (const part of query.split('&')) {
        const [k, v] = part.split('=')
        if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : ''
      }
    }
    return { action, params }
  } catch {
    return null
  }
}

function handleDeepLink(url: string): void {
  const link = parseDeepLink(url)
  if (!link) return
  const win = getActiveWorkbenchWindow()
  if (win) {
    revealWindow(win)
    win.webContents.send('app:deep-link', link)
  } else {
    pendingDeepLink = link
  }
}

let pendingDeepLink: { action: string; params: Record<string, string> } | null = null

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('agenthub', process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('agenthub')
}

const skipSingleInstanceLock = process.env.AGENTHUB_E2E === '1'
const gotLock = skipSingleInstanceLock || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else if (!skipSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(a => a.startsWith('agenthub://'))
    if (url) handleDeepLink(url)
    else ensureWindowVisible()
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

const initialDeepLink = process.argv.find(a => a.startsWith('agenthub://'))
if (initialDeepLink) pendingDeepLink = parseDeepLink(initialDeepLink)

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("dev.agenthub.desktop")
  await decisionService.sweepOrphans()
  registerProviderIpc({ providerMgr, registerAgentsFromBindings })
  registerModelsIpc({ providerMgr })
  providerMgr.unlockSecrets()   // app ready 后解密落盘的 apiKey 到内存（safeStorage 此时可用）
  try {
    await initHub()
  } catch (e: any) {
    console.error('[AgentHub] initHub failed:', e?.message || String(e))
  }

  // Register domain-specific IPC handlers (extracted from monolithic index.ts)
  // Keep settings, workspace, provider, and diagnostic IPC available even if
  // Hub/Dispatcher startup fails; dispatch-only handlers already guard later.
  registerAllIpcHandlers({
    memory: memory,
    providerMgr: providerMgr,
    registerAgentsFromBindings: registerAgentsFromBindings,
    resolveAppVersionFromMain,
    getWorkspaceManager,
    store,
    registry,
    runtimeStore,
    dispatcher,
    hub,
    router,
    proxy,
    runtimeProducers,
    decisionService,
    threadExecutionCoordinator,
    promptPreparationService: promptPreparationComposition.promptPreparationService,
    getMainWindow: getActiveWorkbenchWindow,
    getActiveWindow: getActiveWorkbenchWindow,
    openWorkbench,
    isLiveWorkbenchWindow: window => workbenchWindows.has(window) && !window.isDestroyed()
  })
  await threadExecutionCoordinator.recover()

  installAppMenu({ sendToActiveWindow, openWorkbench: () => { openWorkbench() } })
  const firstWindow = createWindow()
  await installE2eDecisionFixture({
    runtimeStore,
    decisionService,
    webContentsId: firstWindow.webContents.id
  })
  createTray()

  if (pendingDeepLink) {
    firstWindow.webContents.once("did-finish-load", () => {
      firstWindow.webContents.send("app:deep-link", pendingDeepLink)
      pendingDeepLink = null
    })
  }
}).catch(e => {
  console.error('[AgentHub] Fatal startup error:', e)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  ensureWindowVisible()
})

// P1-2: before-quit only flags quitting (sync, reliable); async cleanup moved
// to will-quit which natively supports event.preventDefault() + manual exit.
app.on("before-quit", () => {
  (app as any).isQuitting = true
})

let handleWillQuit: ReturnType<typeof createWillQuitHandler> | null = null
app.on("will-quit", (event) => {
  if (!handleWillQuit) {
    const STOP_TIMEOUT_MS = 5000
    const runtimeDispose = createSharedRuntimeDisposeForShutdown(
      reason => runtimeStore.dispose({ interruptReason: reason })
    )
    const cleanup = async (): Promise<void> => {
      threadExecutionCoordinator.dispose()
      const decisionShutdownPromise = decisionService.shutdown()
      runtimeProducers.close()
      const decisionShutdown = await runShutdownStepWithDeadline(
        () => decisionShutdownPromise,
        STOP_TIMEOUT_MS
      )
      if (decisionShutdown.status === "rejected") {
        logShutdownFailure("[AgentHub] Decision service shutdown failed", decisionShutdown.error)
      } else if (decisionShutdown.status === "timed-out") {
        logShutdownFailure("[AgentHub] Decision service shutdown deadline exceeded", decisionShutdown.error)
      }
      try { hub?.stop() } catch { /* noop */ }
      try { proxy.stop() } catch { /* noop */ }
      // Kill any still-running terminal children so we don't orphan shell processes.
      try { getTerminalRuntime().dispose() } catch { /* non-critical */ }
      // 清理所有 PTY 终端会话
      try { disposeAllTerminalSessions() } catch { /* non-critical */ }
      // 清理所有待处理的 guard approvals，避免 Promise 和 timer 泄漏
      await drainRuntimeProducersForShutdown({
        dispatcher,
        registry,
        runtimeProducers,
        stopTaskTurnTracking,
        timeoutMs: STOP_TIMEOUT_MS,
        finalTimeoutMs: STOP_TIMEOUT_MS,
        finalizationTimeoutMs: STOP_TIMEOUT_MS,
        interruptRuntimeWork: reason => runtimeDispose.interrupt(reason),
        onFailure: logShutdownFailure
      })
      // G2-MH8: final config flush must happen after the runtime actor has durably drained.
      await finalizeRuntimePersistenceForShutdown({
        dispose: () => runtimeDispose.finalize("Application shutdown"),
        flush: () => store.flush(),
        timeoutMs: STOP_TIMEOUT_MS,
        onFailure: logShutdownFailure
      })
    }

    const logShutdownFailure = (message: string, error: unknown): void => {
      try { console.error(message, error) } catch { /* logging must not reject shutdown */ }
    }
    handleWillQuit = createWillQuitHandler({
      cleanup,
      exit: () => app.exit(0),
      onFailure: logShutdownFailure
    })
  }
  void handleWillQuit(event)
})
