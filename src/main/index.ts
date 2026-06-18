import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, dialog, WebContents } from "electron"
import { basename, extname, join, resolve } from "path"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs"
import { HubServer } from "./hub/server"
import { AgentRegistry } from "./hub/registry"
import { EventPipeline } from "./hub/pipeline"
import { KeywordRouter } from "./hub/router"
import { Dispatcher, StreamEvent } from "./hub/dispatcher"
import { store } from "./store"
import { detectAgentsAsync } from "./hub/agent-detector"
import { getProviderManager } from "./providers/manager"
import { getLocalProxy } from "./routing/proxy"
import { locateAgentCandidates } from "./hub/agent-locator"
import { takeoverStatus, takeoverApply, takeoverRestore } from "./routing/takeover"
import { syncRegistryFromBindings } from "./hub/agent-connections"
import { routePreview } from "./hub/route-preview"
import { MemoryCategory, MemoryLibrary } from "./memory-library"
import { getWorkspaceManager, WorkspaceNotFoundError, WorkspacePathInvalidError } from "./hub/workspace"
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { getSkillManager } from "./skills/manager"
import { BUILTIN_SKILLS } from "./skills/types"
import { getCapabilityMatrix } from "./agentic/capabilities"
import { getAgenticConfig } from "./agentic/config"
import { getApprovalConfig, GuardedTool, ApprovalPolicy } from "./agentic/approval"
import { ChatCompletionMessage } from "./providers/types"
// --- /AgentHub skills + native agentic ---
import { getWorkbenchRuntimeStore } from "./runtime/store"
import { DispatchPreset, ModelSelection, SchedulePreview, ScheduleStep, WorkbenchAttachment, WorkbenchTurn } from "./runtime/types"
import { listSchedules, previewSchedule } from "./runtime/schedules"
import { configureLocalAgent, detectLocalAgentStatuses, getCachedLocalAgentStatuses, refreshLocalAgentStatusCache } from "./runtime/local-agents"
import { readLocalModelConfig, scanLocalModels } from "./runtime/local-models"
import { getRunTimeoutMs, setRunTimeoutMs, RUN_TIMEOUT_DEFAULTS } from "./runtime/run-preferences"
import { buildAgentOptions } from "./runtime/agent-options"
import { listWorkbenchCommands, runWorkbenchCommand } from "./runtime/commands"
import { eccCommandStatus, updateEccCommands } from "./runtime/ecc-commands"
import { getTerminalRuntime } from "./runtime/terminal"
import {
  gitBranches,
  gitCheckoutBranch,
  gitCommit,
  gitCommitDetails,
  gitCommitDiff,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiff,
  gitDiffs,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitRenameBranch,
  gitRevertAll,
  gitRevertFile,
  gitStageAll,
  gitStageFile,
  gitStatus,
  gitSync,
  gitUnstageFile,
  gitUpdateBranch,
  runGitQuery
} from "./runtime/git"
import { listMcpServers, removeMcpServer, scanLocalMcpServers, setMcpEnabled, testMcpServer, upsertMcpServer } from "./runtime/mcp"
import { createWorktree, listWorktrees, openWorktree, removeWorktree, syncWorktree } from "./runtime/worktrees"
import { clearThreadTodos, deleteThreadTodo, listThreadTodos, setThreadTodos, syncTodosFromMarkdown, upsertThreadTodo } from "./runtime/todos"
import { checkUpdates, openUpdateDownload, setUpdateChannel, updateStatus } from "./runtime/updates"
import { usageStats } from "./runtime/usage-stats"
import { buildContextProjection } from "./runtime/context-ledger"
import { installAppMenu } from "./menu"

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hub: HubServer | null = null
const registry = new AgentRegistry()
const pipeline = new EventPipeline()
const router = new KeywordRouter()
const providerMgr = getProviderManager()
let dispatcher: Dispatcher | null = null
const proxy = getLocalProxy()
let memoryLibrary: MemoryLibrary | null = null
const runtimeStore = getWorkbenchRuntimeStore()
const taskToTurn = new Map<string, string>()
const TEXT_ATTACHMENT_BYTES = 96 * 1024
const IMAGE_DATA_URL_BYTES = 2 * 1024 * 1024
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".mdx", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".xml", ".svg",
  ".py", ".go", ".rs", ".java", ".kt", ".cs", ".cpp", ".c", ".h", ".hpp", ".sql", ".sh", ".ps1"
])
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"])

function attachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function mimeForPath(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  if (ext === ".bmp") return "image/bmp"
  if (ext === ".svg") return "image/svg+xml"
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".json") return "application/json"
  if (ext === ".md" || ext === ".markdown") return "text/markdown"
  if (TEXT_ATTACHMENT_EXTENSIONS.has(ext)) return "text/plain"
  return undefined
}

function prepareAttachment(filePath: string): WorkbenchAttachment {
  const stats = statSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const mime = mimeForPath(filePath)
  const base: WorkbenchAttachment = {
    id: attachmentId(),
    kind: IMAGE_ATTACHMENT_EXTENSIONS.has(ext) ? "image" : TEXT_ATTACHMENT_EXTENSIONS.has(ext) ? "text" : "file",
    name: basename(filePath),
    path: filePath,
    mime,
    size: stats.size,
    createdAt: Date.now()
  }

  if (base.kind === "text") {
    try {
      const buffer = readFileSync(filePath)
      base.text = buffer.subarray(0, TEXT_ATTACHMENT_BYTES).toString("utf8")
      if (buffer.byteLength > TEXT_ATTACHMENT_BYTES) base.text += "\n\n[AgentHub: file truncated for context]"
    } catch (e: any) {
      base.text = `[AgentHub: failed to read file: ${e?.message || String(e)}]`
    }
  } else if (base.kind === "image" && stats.size <= IMAGE_DATA_URL_BYTES) {
    try {
      const buffer = readFileSync(filePath)
      base.dataUrl = `data:${mime || "application/octet-stream"};base64,${buffer.toString("base64")}`
    } catch {
      // The path remains useful even when preview data is unavailable.
    }
  }

  return base
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
      const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`
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
      if (att.dataUrl) lines.push(`Inline preview data URL: ${att.dataUrl.slice(0, 4096)}${att.dataUrl.length > 4096 ? "...[truncated]" : ""}`)
    } else if (att.text) {
      lines.push("Content:")
      lines.push("```")
      lines.push(att.text)
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
  const done = events.filter(event => event.kind === "agent:done" && event.payload?.content)
  if (done.length === 0) return ""
  if (done.length === 1) return String(done[0].payload.content).trim()
  return done.map(event => {
    const label = event.agentId || event.payload?.agentId || "agent"
    return `### ${label}\n${String(event.payload.content).trim()}`
  }).join("\n\n")
}

function isProviderDirectSelection(selection: ModelSelection | undefined | null, targetAgent?: string): selection is ModelSelection {
  return !targetAgent && selection?.source === "provider" && !!selection.providerId && !!selection.modelId
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
  return compactModelMessages(messages)
}

function compactModelMessages(messages: ChatCompletionMessage[], maxChars = 48_000): ChatCompletionMessage[] {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0)
  const compacted = [...messages]
  while (compacted.length > 1 && total > maxChars) {
    const removed = compacted.shift()
    total -= removed?.content.length || 0
  }
  return compacted
}

function orderedCustomLayers(steps: ScheduleStep[]): ScheduleStep[][] {
  const remaining = new Map(steps.filter(step => step.agentId && step.agentId !== "auto" && step.agentId !== "all").map(step => [step.id, step]))
  const done = new Set<string>()
  const layers: ScheduleStep[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(step => (step.dependsOn ?? []).every(dep => done.has(dep) || !remaining.has(dep)))
    const fallback = remaining.values().next().value
    const layer = ready.length ? ready : (fallback ? [fallback] : [])
    if (!layer.length) break
    layers.push(layer)
    for (const step of layer) {
      remaining.delete(step.id)
      done.add(step.id)
    }
  }
  return layers
}

async function runCustomScheduleTurn(input: {
  dispatcher: Dispatcher
  prompt: string
  schedule: SchedulePreview
  workspaceId: string | null
  turnId: string
  threadId: string
  messages: ChatCompletionMessage[]
  isCancelled: () => boolean
  thinking?: any
  modelSelection?: ModelSelection
}): Promise<{ status: "completed" | "failed" | "cancelled"; error?: string }> {
  const layers = orderedCustomLayers(input.schedule.steps)
  let context = input.prompt
  const outputs: Array<{ step: ScheduleStep; content: string; error?: string }> = []
  for (const layer of layers) {
    if (input.isCancelled()) return { status: "cancelled" }
    const results = await Promise.all(layer.map(async step => {
      if (input.isCancelled()) return { step, content: "", error: "cancelled", status: "cancelled" as const }
      const role = `${step.label} / ${step.role}`
      const stepPrompt = [
        `[AgentHub Custom Schedule]`,
        `Current step: ${role}`,
        step.dependsOn?.length ? `Depends on: ${step.dependsOn.join(", ")}` : "",
        "",
        context
      ].filter(Boolean).join("\n")
      const task = await input.dispatcher.dispatch(stepPrompt, "auto", step.agentId, {
        thinking: input.thinking,
        workspaceId: input.workspaceId,
        modelSelection: input.modelSelection,
        turnId: input.turnId,
        threadId: `${input.threadId}:custom:${step.id}`,
        conversationText: stepPrompt,
        messages: [
          ...input.messages.slice(0, -1),
          { role: "user", content: stepPrompt } as ChatCompletionMessage
        ]
      })
      const content = task.results.get(step.agentId) || ""
      const error = task.errors.get(step.agentId) || task.error
      return { step, content, error, status: task.status }
    }))
    outputs.push(...results.map(result => ({ step: result.step, content: result.content, error: result.error })))
    const cancelled = results.find(result => result.status === "cancelled")
    if (cancelled || input.isCancelled()) return { status: "cancelled", error: cancelled?.error }
    const failed = results.find(result => result.status === "failed" || result.error)
    if (failed) return { status: "failed", error: failed.error || `${failed.step.label} failed` }
    context = [
      input.prompt,
      "",
      "[Upstream Custom Schedule Outputs]",
      ...outputs.map(item => `## ${item.step.label} (${item.step.agentId})\n${item.content || "(no text output)"}`)
    ].join("\n\n")
  }
  return { status: "completed" }
}

runtimeStore.on("event", (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("runtime:event", event)
  }
})

function memory(): MemoryLibrary {
  if (!memoryLibrary) memoryLibrary = new MemoryLibrary(app.getPath("userData"))
  return memoryLibrary
}

function appAssetPath(fileName: string): string {
  const packaged = join(process.resourcesPath, "build", fileName)
  if (app.isPackaged && existsSync(packaged)) return packaged

  const fromAppPath = join(app.getAppPath(), "build", fileName)
  if (existsSync(fromAppPath)) return fromAppPath

  return join(process.cwd(), "build", fileName)
}

function safeBrowserUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ["http:", "https:", "file:"].includes(parsed.protocol)
  } catch {
    return false
  }
}

function installWebviewGuards(contents: WebContents): void {
  contents.on("will-attach-webview", (event, webPreferences, params) => {
    const src = String(params.src || "")
    if (src && !safeBrowserUrl(src)) {
      event.preventDefault()
      return
    }
    delete (webPreferences as any).preload
    delete (webPreferences as any).preloadURL
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (safeBrowserUrl(url)) shell.openExternal(url).catch(() => {})
    return { action: "deny" }
  })
}

function createWindow(): void {
  const isDevRenderer = Boolean(process.env.ELECTRON_RENDERER_URL)
  const iconPath = appAssetPath(process.platform === "win32" ? "icon.ico" : "icon.png")
  console.log(`[Window] create renderer=${process.env.ELECTRON_RENDERER_URL || "file"} dev=${isDevRenderer}`)
  mainWindow = new BrowserWindow({
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
      sandbox: false,
      webviewTag: true
    },
    show: isDevRenderer,
    frame: false,
    backgroundColor: "#f7f8fb"
  })
  installWebviewGuards(mainWindow.webContents)
  installAppMenu(mainWindow)
  let hasShownMainWindow = isDevRenderer
  const revealMainWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    hasShownMainWindow = true
    console.log(`[Window] reveal visible=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} minimized=${mainWindow.isMinimized()}`)
  }
  mainWindow.on("ready-to-show", () => {
    console.log("[Window] ready-to-show")
    revealMainWindow()
  })
  mainWindow.webContents.once("did-finish-load", () => {
    console.log("[Window] did-finish-load")
    if (!hasShownMainWindow) revealMainWindow()
  })
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return
    console.error(`[Window] Failed to load renderer ${url}: ${code} ${description}`)
    revealMainWindow()
  })
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Window] Renderer process gone:", details)
    revealMainWindow()
  })
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const prefix = level >= 2 ? "error" : level === 1 ? "warn" : "log"
    console[prefix](`[Renderer:${prefix}] ${message} (${sourceId}:${line})`)
  })
  const revealTimer = setTimeout(() => {
    if (!hasShownMainWindow) revealMainWindow()
  }, isDevRenderer ? 1500 : 5000)
  revealTimer.unref?.()
  mainWindow.on("maximize", () => mainWindow?.webContents.send("win:maximized", true))
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("win:maximized", false))
  mainWindow.on("close", (event) => {
    if ((app as any).isQuitting) return
    if (store.get("minimizeToTray") !== false) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on("closed", () => {
    mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(appAssetPath("icon.png"))
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

function ensureWindowVisible(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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
      console.log("[Pipeline] " + event.source + " -> " + event.target)
      return event
    }
  })
  dispatcher = new Dispatcher(registry, pipeline, () => memory().getCatalog().entries.slice(0, 12))
  hub = new HubServer(registry)

  hub.on("client:message", async ({ clientId: _clientId, message }) => {
    if (message.type === "chat:message") {
      const task = await dispatcher!.dispatch(
        message.payload.text,
        message.payload.mode || "auto",
        message.payload.targetAgent,
        { thinking: message.payload.thinking, modelSelection: message.payload.modelSelection, workspaceId: message.payload.workspaceId ?? null }
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
        if (agents) {
          new Notification({ title: "AgentHub", body: "Task done by " + agents, silent: true }).show()
        }
      }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dispatch:stream", event)
    }
  })

  try {
    await detectAgentsAsync()
    console.log("[Hub] Initial agent detection complete")
  } catch (e) {
    console.error("[Hub] Initial detection failed:", e)
  }

  try {
    await proxy.start()
    console.log("[Proxy] Local Chat Completions:", proxy.getUrl())
  } catch (e) {
    console.error("[Proxy] Failed to start:", e)
  }

  hub.start()
}

ipcMain.handle("hub:status", () => ({
  running: hub !== null,
  url: hub?.getUrl() || "",
  proxyUrl: proxy.getUrl(),
  clientCount: hub?.getClientCount() || 0,
  agents: registry.getAll().map(a => ({
    id: a.id, name: a.name, status: a.status, capabilities: a.capabilities,
    providerId: a.providerId, modelId: a.modelId, errorCount: a.errorCount
  })),
  tasks: dispatcher?.getRecentTasks(10).map(t => ({
    id: t.id, text: t.text.slice(0, 50), mode: t.mode, status: t.status, createdAt: t.createdAt
  })) || []
}))

ipcMain.handle("hub:dispatch", async (_event, payload) => {
  return dispatcher?.dispatch(payload.text, payload.mode || "auto", payload.targetAgent, { thinking: payload.thinking, modelSelection: payload.modelSelection, workspaceId: payload.workspaceId ?? null })
})
ipcMain.handle("hub:routePreview", async (_event, text: string) => routePreview(text, registry, router))

function optionalWorkbenchWorkspace(workspaceId?: string | null): string | null {
  const id = workspaceId === undefined ? getWorkspaceManager().getActive() : workspaceId
  if (!id) return null
  if (!getWorkspaceManager().getById(id)) throw new WorkspaceNotFoundError(id)
  return id
}

ipcMain.handle("threads:list", (_event, workspaceId?: string | null) => runtimeStore.listThreads(workspaceId))
ipcMain.handle("threads:create", (_event, input: { workspaceId?: string | null; title?: string }) => {
  const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
  return runtimeStore.createThread({ ...input, workspaceId })
})
ipcMain.handle("threads:rename", (_event, threadId: string, title: string) => runtimeStore.renameThread(threadId, title))
ipcMain.handle("threads:delete", (_event, threadId: string) => runtimeStore.deleteThread(threadId))
ipcMain.handle("threads:select", (_event, threadId: string | null) => runtimeStore.selectThread(threadId))
ipcMain.handle("runtime:snapshot", (_event, workspaceId?: string | null) => runtimeStore.snapshot(workspaceId))
ipcMain.handle("runtime:eventsSince", (_event, threadId: string, seq = 0) => runtimeStore.eventsSince(threadId, seq))
ipcMain.handle("context:projection", (_event, input: { threadId?: string | null; workspaceId?: string | null; prompt?: string; attachments?: WorkbenchAttachment[]; writeDraft?: { title: string; content: string } | null; pinnedBlocks?: any[] }) => {
  const thread = input?.threadId ? runtimeStore.getThread(input.threadId) : undefined
  const workspaceId = thread ? thread.workspaceId : optionalWorkbenchWorkspace(input?.workspaceId)
  const snapshot = runtimeStore.snapshot(undefined)
  const events = thread ? runtimeStore.eventsSince(thread.id, 0) : []
  return buildContextProjection({
    thread,
    workspaceId,
    prompt: input?.prompt || "",
    attachments: Array.isArray(input?.attachments) ? input.attachments : [],
    snapshot,
    events,
    memories: memory().listEntries().slice(0, 8),
    pinnedBlocks: Array.isArray(input?.pinnedBlocks) ? input.pinnedBlocks : [],
    writeDraft: input?.writeDraft ?? null
  })
})

ipcMain.handle("git:query", async (_event, input: { workspaceId?: string | null; threadId?: string | null; query?: string }) => {
  const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
  if (!workspaceId) throw new Error("Git 需要先选择工作目录。")
  const thread = input?.threadId ? runtimeStore.getThread(input.threadId) : undefined
  const { thread: targetThread, turn } = runtimeStore.createTurn({
    threadId: thread?.id ?? null,
    workspaceId,
    prompt: `/git ${input?.query || "status"}`.trim(),
    mode: "auto",
    targetAgent: null
  })
  const result = await runGitQuery(workspaceId, input?.query || "status")
  runtimeStore.appendSystemEvent(targetThread.id, turn.id, "agent:done", "system", {
    kind: "git:query",
    content: result,
    modelId: "git",
    providerId: "local-git"
  })
  runtimeStore.setTurnStatus(turn.id, "completed", { taskId: `git:${turn.id}` })
  return { threadId: targetThread.id, turnId: turn.id, command: input?.query || "status", content: result }
})
ipcMain.handle("turns:create", async (_event, payload: { threadId?: string | null; workspaceId?: string | null; prompt: string; mode?: DispatchPreset; targetAgent?: string | null; thinking?: any; modelSelection?: ModelSelection; attachments?: WorkbenchAttachment[]; customSchedule?: SchedulePreview }) => {
  if (!dispatcher) throw new Error("Dispatcher is not ready")
  const mode = payload.mode || "auto"
  const directTarget = payload.targetAgent?.trim() || undefined
  const providerDirect = isProviderDirectSelection(payload.modelSelection, directTarget)
  const effectiveMode = providerDirect ? "auto" : mode
  const dispatchMode = directTarget || providerDirect ? "auto" : runtimeStore.dispatcherMode(mode)
  const existingThread = payload.threadId ? runtimeStore.getThread(payload.threadId) : undefined
  const workspaceId = existingThread
    ? existingThread.workspaceId
    : optionalWorkbenchWorkspace(payload.workspaceId)
  const attachments = materializeAttachments(Array.isArray(payload.attachments) ? payload.attachments : [], workspaceId)
  const { thread, turn } = runtimeStore.createTurn({
    threadId: payload.threadId ?? null,
    workspaceId,
    prompt: payload.prompt,
    mode: effectiveMode,
    targetAgent: directTarget || null,
    modelSelection: payload.modelSelection,
    thinking: payload.thinking,
    attachments,
    contextProjection: buildContextProjection({
      thread: existingThread,
      workspaceId,
      prompt: payload.prompt,
      attachments,
      snapshot: runtimeStore.snapshot(undefined),
      events: existingThread ? runtimeStore.eventsSince(existingThread.id, 0) : [],
      memories: memory().listEntries().slice(0, 8)
    }),
    customSchedule: providerDirect ? undefined : payload.customSchedule
  })
  const messages = modelMessagesForTurn(thread.id, payload.prompt, attachments)
  const dispatchPrompt = messages[messages.length - 1]?.content || promptWithAttachments(payload.prompt, attachments)
  const runner = providerDirect && payload.modelSelection
    ? dispatcher.dispatchProviderDirect(
      dispatchPrompt,
      payload.modelSelection,
      {
        thinking: payload.thinking,
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: turn.id,
        threadId: thread.id,
        conversationText: dispatchPrompt,
        messages
      }
    )
    : effectiveMode === "custom" && !directTarget && payload.customSchedule
    ? runCustomScheduleTurn({
        dispatcher,
        prompt: dispatchPrompt,
        schedule: payload.customSchedule,
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: turn.id,
        threadId: thread.id,
        messages,
        isCancelled: () => runtimeStore.getTurn(turn.id)?.status === "cancelled",
        thinking: payload.thinking,
        modelSelection: payload.modelSelection
      })
    : dispatcher.dispatch(
      dispatchPrompt,
      dispatchMode,
      directTarget,
      {
        thinking: payload.thinking,
        modelSelection: payload.modelSelection,
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: turn.id,
        threadId: thread.id,
        conversationText: dispatchPrompt,
        messages
      }
    )
  void runner
    .then((task: any) => {
      if (runtimeStore.getTurn(turn.id)?.status === "cancelled") return
      if (effectiveMode === "custom" && !("id" in task)) {
        runtimeStore.setTurnStatus(turn.id, task.status, { error: task.error })
        return
      }
      taskToTurn.set(task.id, turn.id)
      runtimeStore.attachTask(turn.id, task.id)
      const status = task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failed" : "completed"
      runtimeStore.setTurnStatus(turn.id, status, { taskId: task.id, error: task.error })
    })
    .catch((e: any) => {
      runtimeStore.setTurnStatus(turn.id, "failed", { error: e?.message || String(e) })
    })
  return { thread, turn }
})
ipcMain.handle("turns:cancel", (_event, turnId: string) => {
  const snapshot = runtimeStore.snapshot()
  const turn = snapshot.turns.find(t => t.id === turnId)
  if (!turn) return false
  for (const taskId of turn.taskIds) dispatcher?.cancel(taskId)
  runtimeStore.setTurnStatus(turnId, "cancelled")
  return true
})
ipcMain.handle("turns:cancelAgent", (_event, turnId: string, agentId: string) => {
  const snapshot = runtimeStore.snapshot()
  const turn = snapshot.turns.find(t => t.id === turnId)
  if (!turn) return false
  let cancelled = false
  for (const taskId of turn.taskIds) cancelled = !!dispatcher?.cancelAgent(taskId, agentId) || cancelled
  if (cancelled) {
    runtimeStore.setRunStatus(turnId, agentId, "cancelled", { error: "已暂停该 Agent。" })
    const remainingRunning = snapshot.runs.filter(run => run.turnId === turnId && run.agentId !== agentId && run.status === "running")
    if (turn.targetAgent === agentId || remainingRunning.length === 0) runtimeStore.setTurnStatus(turnId, "cancelled")
  }
  return cancelled
})
ipcMain.handle("turns:retry", async (_event, turnId: string) => {
  const snapshot = runtimeStore.snapshot()
  const turn = snapshot.turns.find(t => t.id === turnId)
  if (!turn) throw new Error(`Turn not found: ${turnId}`)
  const thread = runtimeStore.getThread(turn.threadId)
  if (!thread) throw new Error(`Thread not found: ${turn.threadId}`)
  if (!dispatcher) throw new Error("Dispatcher is not ready")
  const created = runtimeStore.createTurn({
    threadId: thread.id,
    workspaceId: thread.workspaceId,
    prompt: turn.prompt,
    mode: turn.mode,
    targetAgent: turn.targetAgent || null,
    attachments: turn.attachments ?? [],
    modelSelection: turn.modelSelection,
    thinking: turn.thinking,
    contextProjection: turn.contextProjection,
    customSchedule: turn.customSchedule
  })
  const retryMessages = modelMessagesForTurn(thread.id, turn.prompt, turn.attachments, turn.id)
  const retryPrompt = retryMessages[retryMessages.length - 1]?.content || promptWithAttachments(turn.prompt, turn.attachments)
  const retryProviderDirect = isProviderDirectSelection(turn.modelSelection, turn.targetAgent || undefined)
  const retryRunner = retryProviderDirect && turn.modelSelection
    ? dispatcher.dispatchProviderDirect(retryPrompt, turn.modelSelection, {
      workspaceId: thread.workspaceId,
      turnId: created.turn.id,
      threadId: thread.id,
      conversationText: retryPrompt,
      messages: retryMessages,
      modelSelection: turn.modelSelection,
      thinking: turn.thinking
    })
    : turn.mode === "custom" && !turn.targetAgent && turn.customSchedule
    ? runCustomScheduleTurn({
        dispatcher,
        prompt: retryPrompt,
        schedule: turn.customSchedule,
        workspaceId: thread.workspaceId,
        modelSelection: turn.modelSelection,
        turnId: created.turn.id,
        threadId: thread.id,
        messages: retryMessages,
        isCancelled: () => runtimeStore.getTurn(created.turn.id)?.status === "cancelled",
        thinking: turn.thinking
      })
    : dispatcher.dispatch(retryPrompt, turn.targetAgent ? "auto" : runtimeStore.dispatcherMode(turn.mode), turn.targetAgent || undefined, {
      workspaceId: thread.workspaceId,
      turnId: created.turn.id,
      threadId: thread.id,
      conversationText: retryPrompt,
      messages: retryMessages,
      modelSelection: turn.modelSelection,
      thinking: turn.thinking
    })
  void retryRunner
    .then((task: any) => {
      if (runtimeStore.getTurn(created.turn.id)?.status === "cancelled") return
      if (turn.mode === "custom" && !("id" in task)) {
        runtimeStore.setTurnStatus(created.turn.id, task.status, { error: task.error })
        return
      }
      taskToTurn.set(task.id, created.turn.id)
      runtimeStore.attachTask(created.turn.id, task.id)
      const status = task.status === "cancelled" ? "cancelled" : task.status === "failed" ? "failed" : "completed"
      runtimeStore.setTurnStatus(created.turn.id, status, { taskId: task.id, error: task.error })
    })
    .catch((e: any) => {
      runtimeStore.setTurnStatus(created.turn.id, "failed", { error: e?.message || String(e) })
    })
  return created
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
ipcMain.handle("schedules:list", () => listSchedules())
ipcMain.handle("schedules:runPreview", (_event, preset: DispatchPreset) => previewSchedule(preset))
ipcMain.handle("commands:list", () => listWorkbenchCommands())
ipcMain.handle("commands:run", (_event, input: { id?: string; text?: string }) => runWorkbenchCommand(input))
ipcMain.handle("ecc:status", () => eccCommandStatus())
ipcMain.handle("ecc:update", () => updateEccCommands())
ipcMain.handle("terminal:run", (_event, input: { workspaceId?: string | null; command: string }) => getTerminalRuntime().run(input))
ipcMain.handle("terminal:cancel", (_event, runId: string) => getTerminalRuntime().cancel(runId))
ipcMain.handle("terminal:history", () => getTerminalRuntime().history())
ipcMain.handle("tasks:delete", (_event, taskId: string) => {
  runtimeStore.deleteTask(taskId)
  const current = memory().loadRuntimeState()
  memory().saveRuntimeState({ messages: current.messages, tasks: current.tasks.filter((task: any) => task.id !== taskId) })
  return true
})
ipcMain.handle("tasks:clearCompleted", () => {
  runtimeStore.clearCompletedTasks()
  const current = memory().loadRuntimeState()
  const running = current.tasks.filter((task: any) => task.status === "running")
  memory().saveRuntimeState({ messages: current.messages, tasks: running })
  return true
})
ipcMain.handle("git:status", (_event, workspaceId?: string | null) => gitStatus(workspaceId))
ipcMain.handle("git:branches", (_event, workspaceId?: string | null) => gitBranches(workspaceId))
ipcMain.handle("git:checkoutBranch", (_event, workspaceId: string | null, branch: string) => gitCheckoutBranch(workspaceId, branch))
ipcMain.handle("git:createBranch", (_event, workspaceId: string | null, branch: string, checkout?: boolean) => gitCreateBranch(workspaceId, branch, checkout !== false))
ipcMain.handle("git:renameBranch", (_event, workspaceId: string | null, oldName: string, newName: string) => gitRenameBranch(workspaceId, oldName, newName))
ipcMain.handle("git:deleteBranch", (_event, workspaceId: string | null, branch: string, force?: boolean) => gitDeleteBranch(workspaceId, branch, !!force))
ipcMain.handle("git:log", (_event, workspaceId?: string | null, limit?: number) => gitLog(workspaceId, limit))
ipcMain.handle("git:diff", (_event, workspaceId?: string | null, filePath?: string) => gitDiff(workspaceId, filePath))
ipcMain.handle("git:diffs", (_event, workspaceId?: string | null) => gitDiffs(workspaceId))
ipcMain.handle("git:commitDetails", (_event, workspaceId: string | null, sha: string) => gitCommitDetails(workspaceId, sha))
ipcMain.handle("git:commitDiff", (_event, workspaceId: string | null, sha: string, filePath?: string) => gitCommitDiff(workspaceId, sha, filePath))
ipcMain.handle("git:stageFile", (_event, workspaceId: string | null, filePath: string) => gitStageFile(workspaceId, filePath))
ipcMain.handle("git:stageAll", (_event, workspaceId: string | null) => gitStageAll(workspaceId))
ipcMain.handle("git:unstageFile", (_event, workspaceId: string | null, filePath: string) => gitUnstageFile(workspaceId, filePath))
ipcMain.handle("git:revertFile", (_event, workspaceId: string | null, filePath: string) => gitRevertFile(workspaceId, filePath))
ipcMain.handle("git:revertAll", (_event, workspaceId: string | null) => gitRevertAll(workspaceId))
ipcMain.handle("git:commit", (_event, workspaceId: string | null, message: string, filePaths?: string[]) => gitCommit(workspaceId, message, filePaths))
ipcMain.handle("git:fetch", (_event, workspaceId: string | null, remote?: string) => gitFetch(workspaceId, remote))
ipcMain.handle("git:pull", (_event, workspaceId: string | null, remote?: string, branch?: string) => gitPull(workspaceId, remote, branch))
ipcMain.handle("git:push", (_event, workspaceId: string | null, remote?: string, branch?: string) => gitPush(workspaceId, remote, branch))
ipcMain.handle("git:sync", (_event, workspaceId: string | null) => gitSync(workspaceId))
ipcMain.handle("git:updateBranch", (_event, workspaceId: string | null, branch: string) => gitUpdateBranch(workspaceId, branch))
ipcMain.handle("mcp:list", (_event, workspaceId?: string | null) => listMcpServers(workspaceId))
ipcMain.handle("mcp:scanLocal", (_event, workspaceId?: string | null) => scanLocalMcpServers(workspaceId))
ipcMain.handle("mcp:upsert", (_event, input: any) => upsertMcpServer(input))
ipcMain.handle("mcp:remove", (_event, id: string) => removeMcpServer(id))
ipcMain.handle("mcp:setEnabled", (_event, id: string, enabled: boolean) => setMcpEnabled(id, enabled))
ipcMain.handle("mcp:test", (_event, id: string, workspaceId?: string | null) => testMcpServer(id, workspaceId))
ipcMain.handle("worktrees:list", (_event, parentWorkspaceId?: string | null) => listWorktrees(parentWorkspaceId))
ipcMain.handle("worktrees:create", (_event, input: { parentWorkspaceId: string; branch?: string; path?: string }) => createWorktree(input))
ipcMain.handle("worktrees:remove", (_event, id: string, force?: boolean) => removeWorktree(id, !!force))
ipcMain.handle("worktrees:sync", (_event, id: string) => syncWorktree(id))
ipcMain.handle("worktrees:open", (_event, id: string) => openWorktree(id))
ipcMain.handle("memory:search", (_event, query: string, category?: MemoryCategory) => memory().searchEntries(query, category))
ipcMain.handle("memory:delete", (_event, id: string) => memory().deleteEntry(id))
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
ipcMain.handle("browser:open", (_event, input: { workspaceId?: string | null; url?: string }) => ({
  id: `browser-${Date.now().toString(36)}`,
  workspaceId: input?.workspaceId ?? null,
  url: input?.url || "about:blank",
  title: "",
  canGoBack: false,
  canGoForward: false
}))
ipcMain.handle("browser:capture", (_event, attachment: any) => ({
  url: String(attachment?.url || ""),
  title: String(attachment?.title || ""),
  text: String(attachment?.text || "").slice(0, 12000),
  headings: Array.isArray(attachment?.headings) ? attachment.headings.map(String).slice(0, 24) : [],
  links: Array.isArray(attachment?.links)
    ? attachment.links.map((link: any) => ({ text: String(link?.text || ""), href: String(link?.href || "") })).slice(0, 40)
    : [],
  forms: Array.isArray(attachment?.forms) ? attachment.forms.map(String).slice(0, 10) : [],
  capturedAt: Number(attachment?.capturedAt || Date.now())
}))
ipcMain.handle("usage:stats", (_event, range?: any, view?: any) => usageStats(range, view))

ipcMain.handle("hub:rescan", async () => {
  const agents = await detectAgentsAsync()
  return agents.map(d => ({
    id: d.id, name: d.name, found: d.found, 
    capabilities: d.capabilities, providerId: d.providerId, modelId: d.modelId,
    baseUrl: d.baseUrl, reachable: d.reachable, error: d.error
  }))
})

ipcMain.handle("hub:cancel", async (_event, taskId: string) => dispatcher?.cancel(taskId))
ipcMain.handle("store:get", async (_event, key: string) => store.get(key))
ipcMain.handle("store:set", async (_event, key: string, value: any) => { store.set(key, value); return true })
ipcMain.handle("memory:catalog", async () => memory().getCatalog())
ipcMain.handle("memory:list", async (_event, category?: MemoryCategory) => memory().listEntries(category))
ipcMain.handle("memory:addEntry", async (_event, entry) => memory().upsertEntry(entry))
ipcMain.handle("memory:loadState", async () => memory().loadRuntimeState())
ipcMain.handle("memory:saveState", async (_event, state) => memory().saveRuntimeState(state))

ipcMain.handle("providers:get", async () => providerMgr.getConfig())
ipcMain.handle("providers:upsert", async (_e, p) => { providerMgr.upsertProvider(p); registerAgentsFromBindings(); return providerMgr.getConfig() })
ipcMain.handle("providers:delete", async (_e, id) => { const ok = providerMgr.deleteProvider(id); if (ok) registerAgentsFromBindings(); return ok })
ipcMain.handle("providers:setEnabled", async (_e, id, enabled) => { providerMgr.setProviderEnabled(id, enabled); return providerMgr.getConfig() })
ipcMain.handle("providers:setKey", async (_e, id, key) => {
  providerMgr.setProviderApiKey(id, key)
  if (key) await providerMgr.fetchModels(id).catch(() => null)
  registerAgentsFromBindings()
  // 配好 Key 后自动拉取模型列表（后台进行，不阻塞返回）
  return providerMgr.getConfig()
})
ipcMain.handle("providers:fetchModels", async (_e, id) => {
  const r = await providerMgr.fetchModels(id)
  return { ...r, config: providerMgr.getConfig() }
})
ipcMain.handle("providers:health", async (_e, id) => providerMgr.checkProviderHealth(id))
ipcMain.handle("providers:healthAll", async () => {
  const results: any = {}
  for (const p of providerMgr.getProviders()) {
    results[p.id] = await providerMgr.checkProviderHealth(p.id)
  }
  return results
})
ipcMain.handle("routing:setBinding", async (_e, b) => { providerMgr.upsertBinding(b); registerAgentsFromBindings(); return providerMgr.getBindings() })
ipcMain.handle("routing:removeBinding", async (_e, agentId) => { providerMgr.removeBinding(agentId); registerAgentsFromBindings(); return providerMgr.getBindings() })
ipcMain.handle("routing:setFallback", async (_e, chain) => { providerMgr.setFallbackChain(chain); return providerMgr.getConfig().routing })
ipcMain.handle("routing:setStrategy", async (_e, s) => { providerMgr.setStrategy(s); return providerMgr.getConfig().routing })
ipcMain.handle("routing:setBindingThinking", async (_e, agentId, t) => { providerMgr.setBindingThinking(agentId, t); return providerMgr.getBindings() })
ipcMain.handle("routing:setProviderThinking", async (_e, id, t) => { providerMgr.setProviderThinking(id, t); return providerMgr.getConfig() })
ipcMain.handle("routing:activeBinding", async (_e, agentId) => { providerMgr.setActiveBinding(agentId); return providerMgr.getConfig().activeBindingId })
ipcMain.handle("proxy:info", async () => ({
  url: proxy.getUrl(),
  openaiUrl: proxy.getUrl(),
  anthropicUrl: proxy.getOrigin(),
  running: proxy.isRunning(),
  external: proxy.isExternal()
}))
ipcMain.handle("takeover:status", async () => takeoverStatus())
ipcMain.handle("takeover:apply", async (_e, app2: string, modelRef: string) =>
  takeoverApply(app2, modelRef, proxy.getUrl(), proxy.getOrigin()))
ipcMain.handle("takeover:restore", async (_e, app2: string) => takeoverRestore(app2))
// 每个 Agent 返回全部已检测安装（桌面版/终端版，按路径去重）
ipcMain.handle("agents:locate", async () => locateAgentCandidates())

ipcMain.handle("app:openExternal", async (_e, url: string) => {
  if (/^https?:\/\//.test(url) || /^mailto:/.test(url)) await shell.openExternal(url)
})
ipcMain.handle("app:pickFolder", async () => {
  if (!mainWindow) return null
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})
ipcMain.handle("app:pickFiles", async () => {
  if (!mainWindow) return []
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Context files and images", extensions: ["txt", "md", "markdown", "json", "yaml", "yml", "ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "cs", "cpp", "c", "h", "css", "html", "png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf"] },
      { name: "All files", extensions: ["*"] }
    ]
  })
  if (r.canceled || r.filePaths.length === 0) return []
  return r.filePaths.map(filePath => prepareAttachment(filePath))
})

// 工作区：CRUD + 活动态；落盘在 store.workspaces.v1（与 providers.config.v1 同级）
ipcMain.handle("workspaces:list", () => getWorkspaceManager().list())
ipcMain.handle("workspaces:create", (_e, input: { name: string; rootPath: string }) => {
  try { return getWorkspaceManager().create(input) } catch (e) { throw serialiseWsError(e) }
})
ipcMain.handle("workspaces:update", (_e, id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) => {
  try { return getWorkspaceManager().update(id, patch) } catch (e) { throw serialiseWsError(e) }
})
ipcMain.handle("workspaces:remove", (_e, id: string) => {
  try { return getWorkspaceManager().remove(id) } catch (e) { throw serialiseWsError(e) }
})
ipcMain.handle("workspaces:getActive", () => getWorkspaceManager().getActive())
ipcMain.handle("workspaces:setActive", (_e, id: string | null) => {
  try { getWorkspaceManager().setActive(id); return getWorkspaceManager().getActive() } catch (e) { throw serialiseWsError(e) }
})

function serialiseWsError(e: unknown): Error {
  if (e instanceof WorkspaceNotFoundError || e instanceof WorkspacePathInvalidError) {
    const err = new Error(e.message); (err as any).code = (e as any).code; return err
  }
  return e as Error
}

// --- AgentHub skills + native agentic（Claude-B 新增）：技能 CRUD / 安装 + 能力矩阵 / agentic 开关 ---
ipcMain.handle("skills:list", () => getSkillManager().list())
ipcMain.handle("skills:builtins", () => BUILTIN_SKILLS)
ipcMain.handle("skills:scanLocal", () => getSkillManager().scanLocal())
ipcMain.handle("skills:importLocal", (_e, sourcePath: string) => getSkillManager().importLocal(sourcePath))
ipcMain.handle("skills:refreshLocal", () => getSkillManager().scanLocal())
ipcMain.handle("skills:add", (_e, input) => getSkillManager().add(input))
ipcMain.handle("skills:update", (_e, id: string, patch) => getSkillManager().update(id, patch))
ipcMain.handle("skills:remove", (_e, id: string) => getSkillManager().remove(id))
ipcMain.handle("skills:getInstalls", () => getSkillManager().getInstalls())
ipcMain.handle("skills:install", (_e, agentId: string, skillId: string) => getSkillManager().install(agentId, skillId))
ipcMain.handle("skills:uninstall", (_e, agentId: string, skillId: string) => getSkillManager().uninstall(agentId, skillId))
ipcMain.handle("agentic:capabilities", () => getCapabilityMatrix())
ipcMain.handle("agentic:getEnabled", () => getAgenticConfig().getEnabled())
ipcMain.handle("agentic:setEnabled", (_e, agentId: string, on: boolean) => getAgenticConfig().setEnabled(agentId, on))
ipcMain.handle("agentic:getMode", () => getAgenticConfig().getMode())
ipcMain.handle("agentic:setMode", (_e, mode: 'all' | 'selected') => getAgenticConfig().setMode(mode))
// 写/执行审批门禁：策略读写 + 运行时决策回传
ipcMain.handle("agentic:getApprovalConfig", () => getApprovalConfig().getConfig())
ipcMain.handle("agentic:setApprovalDefault", (_e, tool: GuardedTool, policy: ApprovalPolicy) => getApprovalConfig().setDefault(tool, policy))
ipcMain.handle("agentic:setApprovalOverride", (_e, agentId: string, tool: GuardedTool, policy: ApprovalPolicy | null) => getApprovalConfig().setOverride(agentId, tool, policy))
ipcMain.handle("agentic:resolveApproval", (_e, requestId: string, approved: boolean) => dispatcher?.resolveApproval(requestId, approved) ?? false)
// --- /AgentHub skills + native agentic ---

ipcMain.handle("win:minimize", () => { mainWindow?.minimize() })
ipcMain.handle("win:maximizeToggle", () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle("win:isMaximized", () => mainWindow?.isMaximized() ?? false)
ipcMain.handle("win:close", () => {
  if (store.get("minimizeToTray") !== false) mainWindow?.hide()
  else mainWindow?.close()
})


function parseDeepLink(url: string): { action: string; params: Record<string, string> } | null {
  if (!url || !url.startsWith('agenthub://')) return null
  try {
    const stripped = url.startsWith('agenthub://') ? url.slice('agenthub://'.length).replace(/^[/]+/, '') : url
    const [actionPath, query] = stripped.split('?')
    const action = actionPath.split('/')[0] || 'open'
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
  if (mainWindow) {
    ensureWindowVisible()
    mainWindow.webContents.send('app:deep-link', link)
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

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
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
  providerMgr.unlockSecrets()   // app ready 后解密落盘的 apiKey 到内存（safeStorage 此时可用）
  createWindow()
  createTray()
  await initHub()
  if (pendingDeepLink) {
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("app:deep-link", pendingDeepLink)
      pendingDeepLink = null
    })
  }
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  ensureWindowVisible()
})

app.on("before-quit", async () => {
  (app as any).isQuitting = true
  await registry.stopAll()
  hub?.stop()
  proxy.stop()
})
