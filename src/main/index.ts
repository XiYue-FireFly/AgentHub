import "./startup-paths"
import { app, BrowserWindow, Tray, Menu, nativeImage, Notification } from "electron"
import { join, resolve } from "path"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { randomBytes } from "crypto"
import { isProviderDirectSelection } from "../shared/utils"
import { HubServer } from "./hub/server"
import { AgentRegistry } from "./hub/registry"
import { EventPipeline } from "./hub/pipeline"
import { KeywordRouter, RouteDecision } from "./hub/router"
import { Dispatcher, StreamEvent } from "./hub/dispatcher"
import { store } from "./store"
import { detectAgentsAsync } from "./hub/agent-detector"
import { getProviderManager } from "./providers/manager"
import { getLocalProxy } from "./routing/proxy"
import { syncRegistryFromBindings } from "./hub/agent-connections"
import { MemoryLibrary } from "./memory-library"
import { getWorkspaceManager } from "./hub/workspace"
import { optionalWorkbenchWorkspace } from "./runtime/workspace-helpers"
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { ChatCompletionMessage, ThinkingConfig } from "./providers/types"
// --- /AgentHub skills + native agentic ---
import { getWorkbenchRuntimeStore } from "./runtime/store"
import { ModelSelection, WorkbenchAttachment, WorkbenchTurn } from "./runtime/types"
import { refreshLocalAgentStatusCache } from "./runtime/local-agents"
import { resolveGuardApproval, cancelGuardApprovalsForTurn, clearAllGuardApprovals } from "./runtime/guard-approval-service"
import { getWorkbenchGoal, promptWithGoalContext } from "./runtime/goals"
import { buildAgentOptions } from "./runtime/agent-options"
import { getTerminalRuntime } from "./runtime/terminal"
import { disposeAllTerminalSessions } from "./ipc/terminal-pty-ipc"
import { upsertThreadTodo } from "./runtime/todos"
import { buildContextProjection } from "./runtime/context-ledger"
import { optimizePromptForDispatch } from "./runtime/prompt-optimizer"
import { applyRouteDecisionToPlan, planDispatch } from "./runtime/dispatch-planner"
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
import { typedHandle } from "./ipc/typed-ipc"
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
const taskToTurn = new Map<string, string>()
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
    messages.push({ role: "user", content: promptWithAttachments(previous.prompt, previous.attachments) })
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
    .map(turn => turn.prompt)
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

function makeRouteDecision(threadId: string, turnId: string, prompt: string, agentIds?: string[]): RouteDecision {
  const decision = router.routeWeighted({
    text: prompt,
    recentUserMessages: recentUserPrompts(threadId, turnId),
    availableAgents: availableRouteAgents(agentIds),
    memories: memory().selectContextEntries(prompt, { limit: 24, tokenBudget: 8_000 }),
    stats: routeStatsFromHistory()
  })
  runtimeStore.appendSystemEvent(threadId, turnId, "route:decision", "router", {
    ...decision,
    privacy: "router received recent user prompts only; assistant/main outputs were excluded"
  })
  return decision
}

// Guard-verdict lifecycle is now in runtime/guard-approval-service.ts.

function emitMemoryCandidates(threadId: string, turnId: string, prompt: string, content: string) {
  const candidates = memory().importConversation(`turn:${turnId}`, [`User: ${prompt}`, content ? `Assistant: ${content}` : ""].filter(Boolean).join("\n\n"), { includeRaw: false })
  for (const candidate of candidates.slice(0, 5)) {
    runtimeStore.appendSystemEvent(threadId, turnId, "memory:candidate", "memory", {
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
  if (event.kind === "guard:verdict" && event.payload?.requiresUserDecision) {
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
  installWebviewGuards(win.webContents)
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
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
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
  dispatcher = new Dispatcher(registry, pipeline, (taskText = "") => memory().selectContextEntries(taskText, { limit: 12, tokenBudget: 4_000 }))
  dispatcherReadyResolve?.()
  hub = new HubServer(registry)

  hub.on("client:message", async ({ clientId: _clientId, message }) => {
    try {
    if (message.type === "chat:message") {
      if (!dispatcher) {
        hubLog.error("[hub] dispatcher not initialized, dropping message")
        return
      }
      const targetAgent = String(message.payload.targetAgent || "").trim() || undefined
      const modelSelection = message.payload.modelSelection as ModelSelection | undefined
      const task = !targetAgent && isProviderDirectSelection(modelSelection)
        ? await dispatcher.dispatchProviderDirect(message.payload.text, modelSelection, {
          thinking: message.payload.thinking,
          workspaceId: message.payload.workspaceId ?? null,
          messages: [{ role: "user", content: message.payload.text }]
        })
        : await dispatcher.dispatch(
          message.payload.text,
          message.payload.mode || "auto",
          targetAgent,
          { thinking: message.payload.thinking, modelSelection: targetAgent ? undefined : modelSelection, workspaceId: message.payload.workspaceId ?? null }
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

  dispatcher.on("task:created", (task) => {
    const turnId = (task as any).__turnId
    if (turnId) {
      taskToTurn.set(task.id, turnId)
      runtimeStore.attachTask(turnId, task.id)
    }
  })

  dispatcher.on("stream", (event: StreamEvent) => {
    const turnId = taskToTurn.get(event.taskId)
    if (turnId) {
      runtimeStore.appendStreamEvent(turnId, event)
      ;(event as any).__runtimeTurnId = turnId
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

typedHandle("turns:create", async (_event, payload) => {
  if (!dispatcher) {
    await Promise.race([
      dispatcherReadyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Dispatcher not ready after timeout")), 15000))
    ])
  }
  const activeDispatcher = dispatcher!
  const mode = payload.mode || "auto"
  const requestedDirectTarget = payload.targetAgent?.trim() || undefined
  const usableLocalAgentIds = await dispatchableLocalAgentIds()
  const directTarget = requestedDirectTarget && usableLocalAgentIds.includes(requestedDirectTarget)
    ? requestedDirectTarget
    : undefined
  const providerDirect = !directTarget && isProviderDirectSelection(payload.modelSelection)
  const localDirect = !!directTarget
  const directRun = providerDirect || localDirect
  const turnModelSelection = providerDirect ? payload.modelSelection : directTarget ? undefined : payload.modelSelection
  const existingThread = payload.threadId ? runtimeStore.getThread(payload.threadId) : undefined
  const workspaceId = existingThread
    ? existingThread.workspaceId
    : optionalWorkbenchWorkspace(payload.workspaceId)
  const attachments = materializeAttachments(Array.isArray(payload.attachments) ? payload.attachments : [], workspaceId)
  const activeGoal = existingThread ? getWorkbenchGoal(existingThread.id) : null
  const dispatchUserPrompt = promptWithGoalContext(payload.prompt, activeGoal)
  const promptOptimization = optimizePromptForDispatch({
    prompt: dispatchUserPrompt,
    workspaceRoot: workspaceId ? getWorkspaceManager().getById(workspaceId)?.rootPath : null,
    attachments
  })
  const dispatchPlanBase = planDispatch({
    requestedMode: mode,
    directRun,
    directTarget,
    customSchedule: payload.customSchedule,
    availableAgentIds: usableLocalAgentIds,
    attachments,
    optimization: promptOptimization
  })
  const effectiveMode = dispatchPlanBase.effectiveMode
  const dispatchMode = dispatchPlanBase.dispatchMode
  const scheduleForTurn = dispatchPlanBase.schedule
  const workspaceRoot = workspaceId ? getWorkspaceManager().getById(workspaceId)?.rootPath : null
  const preserveCurrentMessage = hasInlineTextAttachment(attachments)
  const preDispatchOutcome = await runPreDispatchHooks(
    resolvePluginPreDispatchHooks({ workspaceRoot }),
    {
      threadId: existingThread?.id || "new",
      prompt: promptOptimization.optimizedPrompt,
      workspace: workspaceRoot || undefined
    }
  )
  if (preDispatchOutcome.denied) {
    throw new Error(preDispatchOutcome.denied)
  }
  const pluginContext = preDispatchOutcome.additionalContext.length
    ? ["[Plugin PreDispatch Context]", ...preDispatchOutcome.additionalContext].join("\n\n")
    : ""
  const workspaceContext = workspaceContextPrompt(workspaceId)
  const optimizedDispatchUserPrompt = [promptOptimization.optimizedPrompt, workspaceContext, pluginContext].filter(Boolean).join("\n\n")
  const previewMessages = existingThread
    ? modelMessagesForTurn(existingThread.id, optimizedDispatchUserPrompt, attachments)
    : [{ role: "user" as const, content: promptWithAttachments(optimizedDispatchUserPrompt, attachments) }]
  const dispatchPrompt = previewMessages[previewMessages.length - 1]?.content || promptWithAttachments(optimizedDispatchUserPrompt, attachments)
  const budgetEstimate = estimateDispatchBudget({
    prompt: dispatchPrompt,
    attachments: [],
    customSchedule: scheduleForTurn,
    modelSelection: turnModelSelection,
    targetAgent: directTarget || null
  })
  if (!budgetEstimate.check.allowed) {
    throw new Error(budgetEstimate.check.reason || "Budget guardrail blocked this dispatch.")
  }
  const { thread, turn } = runtimeStore.createTurn({
    threadId: payload.threadId ?? null,
    workspaceId,
    prompt: payload.prompt,
    mode: effectiveMode,
    targetAgent: directTarget || null,
    modelSelection: turnModelSelection,
    thinking: payload.thinking,
    attachments,
    contextProjection: buildContextProjection({
      thread: existingThread,
      workspaceId,
      prompt: optimizedDispatchUserPrompt,
      attachments,
      snapshot: runtimeStore.snapshot(undefined),
      events: existingThread ? runtimeStore.eventsSince(existingThread.id, 0) : [],
      memories: memory().selectContextEntries(optimizedDispatchUserPrompt, { limit: 8, tokenBudget: 3_000 }),
      pinnedBlocks: [promptOptimization.contextBlock]
    }),
    customSchedule: scheduleForTurn
  })
  runtimeStore.appendSystemEvent(thread.id, turn.id, "turn:summary", "prompt-optimizer", {
    intent: promptOptimization.intent,
    matchedSkills: promptOptimization.matchedSkills,
    matchedPlugins: promptOptimization.matchedPlugins,
    pluginPreDispatch: {
      additionalContextCount: preDispatchOutcome.additionalContext.length,
      warnings: preDispatchOutcome.warnings
    }
  })
  runtimeStore.appendSystemEvent(thread.id, turn.id, "turn:summary", "budget-guard", {
    totalTokens: budgetEstimate.totalTokens,
    estimatedRequests: budgetEstimate.estimatedRequests,
    estimatedCostUsd: budgetEstimate.estimatedCostUsd,
    hasUnpriced: budgetEstimate.hasUnpriced,
    warning: budgetEstimate.check.warning
  })
  const routeDecision = !directRun && dispatchPlanBase.routeAgentIds?.length
    ? makeRouteDecision(thread.id, turn.id, optimizedDispatchUserPrompt, dispatchPlanBase.routeAgentIds)
    : undefined
  const dispatchPlan = applyRouteDecisionToPlan(dispatchPlanBase, routeDecision)
  runtimeStore.appendSystemEvent(thread.id, turn.id, "turn:summary", "dispatch-planner", {
    strategy: dispatchPlan.strategy,
    requestedMode: mode,
    effectiveMode: dispatchPlan.effectiveMode,
    dispatchMode: dispatchPlan.dispatchMode,
    schedule: dispatchPlan.schedule ? {
      preset: dispatchPlan.schedule.preset,
      label: dispatchPlan.schedule.label,
      steps: dispatchPlan.schedule.steps.map(step => ({ id: step.id, role: step.role, agentId: step.agentId, dependsOn: step.dependsOn }))
    } : undefined,
    reasons: dispatchPlan.reasons,
    selectedAgentId: routeDecision?.selectedAgentId
  })
  const messages = modelMessagesForTurn(thread.id, optimizedDispatchUserPrompt, attachments)
  const runner = providerDirect && turnModelSelection
    ? activeDispatcher.dispatchProviderDirect(
      dispatchPrompt,
      turnModelSelection,
      {
        thinking: payload.thinking as ThinkingConfig | undefined,
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: turn.id,
        threadId: thread.id,
        conversationText: dispatchPrompt,
        messages,
        preserveCurrentMessage
      }
    )
    : !directTarget && scheduleForTurn
    ? runCustomScheduleTurn({
        dispatcher: activeDispatcher,
        prompt: dispatchPrompt,
        schedule: scheduleForTurn,
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: turn.id,
        threadId: thread.id,
        messages,
        isCancelled: () => runtimeStore.getTurn(turn.id)?.status === "cancelled",
        thinking: payload.thinking as ThinkingConfig | undefined,
        modelSelection: turnModelSelection,
        preserveCurrentMessage,
        routeDecision,
        recentUserMessages: recentUserPrompts(thread.id, turn.id),
        emitMemoryCandidates
      })
    : activeDispatcher.dispatch(
      dispatchPrompt,
      dispatchMode,
      directTarget,
      {
        thinking: payload.thinking as ThinkingConfig | undefined,
        modelSelection: turnModelSelection,
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: turn.id,
        threadId: thread.id,
        conversationText: dispatchPrompt,
        messages,
        preserveCurrentMessage
      }
    )
  void runner
    .then((task: any) => {
      if (runtimeStore.getTurn(turn.id)?.status === "cancelled") return
      if (scheduleForTurn && !("id" in task)) {
        runtimeStore.setTurnStatus(turn.id, task.status, { error: task.error })
        return
      }
      taskToTurn.set(task.id, turn.id)
      runtimeStore.attachTask(turn.id, task.id)
      const status = task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failed" : "completed"
      runtimeStore.setTurnStatus(turn.id, status, { taskId: task.id, error: task.error })
      if (status === "completed") {
        const content = Array.from(task.results.values()).join("\n\n")
        emitMemoryCandidates(thread.id, turn.id, payload.prompt, content)
      }
    })
    .catch((e: any) => {
      runtimeStore.setTurnStatus(turn.id, "failed", { error: e?.message || String(e) })
    })
  return { thread, turn }
})
typedHandle("turns:cancel", (_event, turnId) => {
  const snapshot = runtimeStore.snapshot()
  const turn = snapshot.turns.find(t => t.id === turnId)
  if (!turn) return false
  cancelGuardApprovalsForTurn(turnId)
  for (const taskId of turn.taskIds) dispatcher?.cancel(taskId)
  runtimeStore.setTurnStatus(turnId, "cancelled")
  return true
})
typedHandle("turns:cancelAgent", (_event, turnId, agentId) => {
  const snapshot = runtimeStore.snapshot()
  const turn = snapshot.turns.find(t => t.id === turnId)
  if (!turn) return false
  let cancelled = false
  for (const taskId of turn.taskIds) cancelled = !!dispatcher?.cancelAgent(taskId, agentId) || cancelled
  if (cancelled) {
    runtimeStore.setRunStatus(turnId, agentId, "cancelled", { error: "已暂停该 Agent。" })
    // LOW-03: Re-fetch snapshot to get updated run statuses after cancel
    const freshSnapshot = runtimeStore.snapshot()
    const remainingRunning = freshSnapshot.runs.filter(run => run.turnId === turnId && run.agentId !== agentId && run.status === "running")
    if (turn.targetAgent === agentId || remainingRunning.length === 0) runtimeStore.setTurnStatus(turnId, "cancelled")
  }
  return cancelled
})
typedHandle("turns:resolveGuard", (_event, requestId, approved) => resolveGuardApproval(requestId, approved))
typedHandle("turns:retry", async (_event, turnId) => {
  const snapshot = runtimeStore.snapshot()
  const turn = snapshot.turns.find(t => t.id === turnId)
  if (!turn) throw new Error(`Turn not found: ${turnId}`)
  const thread = runtimeStore.getThread(turn.threadId)
  if (!thread) throw new Error(`Thread not found: ${turn.threadId}`)
  if (!dispatcher) {
    await Promise.race([
      dispatcherReadyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Dispatcher not ready after timeout")), 15000))
    ])
  }
  const activeDispatcher = dispatcher!
  const retryRequestedTargetAgent = turn.targetAgent || undefined
  const retryUsableLocalAgentIds = await dispatchableLocalAgentIds()
  const retryTargetAgent = retryRequestedTargetAgent && retryUsableLocalAgentIds.includes(retryRequestedTargetAgent)
    ? retryRequestedTargetAgent
    : undefined
  const retryProviderDirect = !retryTargetAgent && isProviderDirectSelection(turn.modelSelection)
  const retryDirectRun = retryProviderDirect || !!retryTargetAgent
  const retryModelSelection = retryProviderDirect ? turn.modelSelection : retryTargetAgent ? undefined : turn.modelSelection
  const retryUserPrompt = promptWithGoalContext(turn.prompt, getWorkbenchGoal(thread.id))
  const retryOptimization = optimizePromptForDispatch({
    prompt: retryUserPrompt,
    workspaceRoot: thread.workspaceId ? getWorkspaceManager().getById(thread.workspaceId)?.rootPath : null,
    attachments: turn.attachments ?? []
  })
  const retryPlanBase = planDispatch({
    requestedMode: turn.mode,
    directRun: retryDirectRun,
    directTarget: retryTargetAgent,
    customSchedule: turn.customSchedule,
    availableAgentIds: retryUsableLocalAgentIds,
    attachments: turn.attachments ?? [],
    optimization: retryOptimization
  })
  const retryWorkspaceRoot = thread.workspaceId ? getWorkspaceManager().getById(thread.workspaceId)?.rootPath : null
  const retryPreserveCurrentMessage = hasInlineTextAttachment(turn.attachments)
  const retryPreDispatchOutcome = await runPreDispatchHooks(
    resolvePluginPreDispatchHooks({ workspaceRoot: retryWorkspaceRoot }),
    {
      threadId: thread.id,
      prompt: retryOptimization.optimizedPrompt,
      workspace: retryWorkspaceRoot || undefined
    }
  )
  if (retryPreDispatchOutcome.denied) {
    throw new Error(retryPreDispatchOutcome.denied)
  }
  const retryPluginContext = retryPreDispatchOutcome.additionalContext.length
    ? ["[Plugin PreDispatch Context]", ...retryPreDispatchOutcome.additionalContext].join("\n\n")
    : ""
  const retryWorkspaceContext = workspaceContextPrompt(thread.workspaceId)
  const retryOptimizedPrompt = [retryOptimization.optimizedPrompt, retryWorkspaceContext, retryPluginContext].filter(Boolean).join("\n\n")
  const retryPreviewMessages = modelMessagesForTurn(thread.id, retryOptimizedPrompt, turn.attachments, turn.id)
  const retryPreviewPrompt = retryPreviewMessages[retryPreviewMessages.length - 1]?.content || promptWithAttachments(retryOptimizedPrompt, turn.attachments)
  const retryBudgetEstimate = estimateDispatchBudget({
    prompt: retryPreviewPrompt,
    attachments: [],
    customSchedule: retryPlanBase.schedule,
    modelSelection: retryModelSelection,
    targetAgent: retryTargetAgent || null
  })
  if (!retryBudgetEstimate.check.allowed) {
    throw new Error(retryBudgetEstimate.check.reason || "Budget guardrail blocked this dispatch.")
  }
  const created = runtimeStore.createTurn({
    threadId: thread.id,
    workspaceId: thread.workspaceId,
    prompt: turn.prompt,
    mode: retryPlanBase.effectiveMode,
    targetAgent: retryTargetAgent || null,
    attachments: turn.attachments ?? [],
    modelSelection: retryModelSelection,
    thinking: turn.thinking,
    contextProjection: turn.contextProjection,
    customSchedule: retryPlanBase.schedule
  })
  runtimeStore.appendSystemEvent(thread.id, created.turn.id, "turn:summary", "prompt-optimizer", {
    intent: retryOptimization.intent,
    matchedSkills: retryOptimization.matchedSkills,
    matchedPlugins: retryOptimization.matchedPlugins,
    pluginPreDispatch: {
      additionalContextCount: retryPreDispatchOutcome.additionalContext.length,
      warnings: retryPreDispatchOutcome.warnings
    }
  })
  runtimeStore.appendSystemEvent(thread.id, created.turn.id, "turn:summary", "budget-guard", {
    totalTokens: retryBudgetEstimate.totalTokens,
    estimatedRequests: retryBudgetEstimate.estimatedRequests,
    estimatedCostUsd: retryBudgetEstimate.estimatedCostUsd,
    hasUnpriced: retryBudgetEstimate.hasUnpriced,
    warning: retryBudgetEstimate.check.warning
  })
  const retryRouteDecision = !retryDirectRun && retryPlanBase.routeAgentIds?.length
    ? makeRouteDecision(thread.id, created.turn.id, retryOptimizedPrompt, retryPlanBase.routeAgentIds)
    : undefined
  const retryPlan = applyRouteDecisionToPlan(retryPlanBase, retryRouteDecision)
  runtimeStore.appendSystemEvent(thread.id, created.turn.id, "turn:summary", "dispatch-planner", {
    strategy: retryPlan.strategy,
    requestedMode: turn.mode,
    effectiveMode: retryPlan.effectiveMode,
    dispatchMode: retryPlan.dispatchMode,
    schedule: retryPlan.schedule ? {
      preset: retryPlan.schedule.preset,
      label: retryPlan.schedule.label,
      steps: retryPlan.schedule.steps.map(step => ({ id: step.id, role: step.role, agentId: step.agentId, dependsOn: step.dependsOn }))
    } : undefined,
    reasons: retryPlan.reasons,
    selectedAgentId: retryRouteDecision?.selectedAgentId
  })
  const retryMessages = modelMessagesForTurn(thread.id, retryOptimizedPrompt, turn.attachments, turn.id)
  const retryPrompt = retryMessages[retryMessages.length - 1]?.content || promptWithAttachments(retryOptimizedPrompt, turn.attachments)
  const retrySchedule = retryPlan.schedule
  const retryRunner = retryProviderDirect && retryModelSelection
    ? activeDispatcher.dispatchProviderDirect(retryPrompt, retryModelSelection, {
      workspaceId: thread.workspaceId,
      turnId: created.turn.id,
      threadId: thread.id,
      conversationText: retryPrompt,
      messages: retryMessages,
      modelSelection: retryModelSelection,
      preserveCurrentMessage: retryPreserveCurrentMessage,
      thinking: turn.thinking
    })
    : !retryTargetAgent && retrySchedule
    ? runCustomScheduleTurn({
        dispatcher: activeDispatcher,
        prompt: retryPrompt,
        schedule: retrySchedule,
        workspaceId: thread.workspaceId,
        modelSelection: retryModelSelection,
        turnId: created.turn.id,
        threadId: thread.id,
        messages: retryMessages,
        isCancelled: () => runtimeStore.getTurn(created.turn.id)?.status === "cancelled",
        thinking: turn.thinking,
        preserveCurrentMessage: retryPreserveCurrentMessage,
        routeDecision: retryRouteDecision,
        recentUserMessages: recentUserPrompts(thread.id, created.turn.id),
        emitMemoryCandidates
      })
    : activeDispatcher.dispatch(retryPrompt, retryTargetAgent ? "auto" : retryPlan.dispatchMode, retryTargetAgent, {
      workspaceId: thread.workspaceId,
      turnId: created.turn.id,
      threadId: thread.id,
      conversationText: retryPrompt,
      messages: retryMessages,
      modelSelection: retryModelSelection,
      preserveCurrentMessage: retryPreserveCurrentMessage,
      thinking: turn.thinking
    })
  void retryRunner
    .then((task: any) => {
      if (runtimeStore.getTurn(created.turn.id)?.status === "cancelled") return
      if (retrySchedule && !("id" in task)) {
        runtimeStore.setTurnStatus(created.turn.id, task.status, { error: task.error })
        return
      }
      taskToTurn.set(task.id, created.turn.id)
      runtimeStore.attachTask(created.turn.id, task.id)
      const status = task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failed" : "completed"
      runtimeStore.setTurnStatus(created.turn.id, status, { taskId: task.id, error: task.error })
      if (status === "completed") {
        const content = Array.from(task.results.values()).join("\n\n")
        emitMemoryCandidates(thread.id, created.turn.id, turn.prompt, content)
      }
    })
    .catch((e: any) => {
      runtimeStore.setTurnStatus(created.turn.id, "failed", { error: e?.message || String(e) })
    })
  return created
})

// IPC handlers for localAgents, localModels, settings, goals, schedules, commands,
// ecc, terminal, tasks, worktrees, todos, updates, browser, usage, hub, store,
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
    getMainWindow: getActiveWorkbenchWindow,
    getActiveWindow: getActiveWorkbenchWindow,
    openWorkbench
  })

  installAppMenu({ sendToActiveWindow, openWorkbench: () => { openWorkbench() } })
  const firstWindow = createWindow()
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
  store.flush()
})

let willQuitCleanupStarted = false
app.on("will-quit", (event) => {
  if (willQuitCleanupStarted) return
  willQuitCleanupStarted = true
  event.preventDefault()

  const STOP_TIMEOUT_MS = 5000
  const cleanup = async (): Promise<void> => {
    // Kill any still-running terminal children so we don't orphan shell processes.
    try { getTerminalRuntime().dispose() } catch { /* non-critical */ }
    // 清理所有 PTY 终端会话
    try { disposeAllTerminalSessions() } catch { /* non-critical */ }
    // 清理所有待处理的 guard approvals，避免 Promise 和 timer 泄漏
    try { clearAllGuardApprovals() } catch { /* non-critical */ }
    // registry.stopAll 可能卡在 stdio agent 不响应；加超时防止阻塞退出
    await Promise.race([
      registry.stopAll().catch(() => {}),
      new Promise<void>(resolve => setTimeout(resolve, STOP_TIMEOUT_MS))
    ])
    try { hub?.stop() } catch { /* noop */ }
    try { proxy.stop() } catch { /* noop */ }
  }

  cleanup().finally(() => app.exit(0))
})
