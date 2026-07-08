import { EventEmitter } from "events"
import { AgentRegistry } from "./registry"
import { EventPipeline } from "./pipeline"
import { KeywordRouter } from "./router"
import { getProviderManager, isProviderRuntimeUsable } from "../providers/manager"
import { buildProviderClient } from "../providers/client"
import { appendAppEventLog } from "../runtime/app-event-log"
import { agentSystemPrompt } from "./agents"
import { buildAgentRuntimeSystemPrompt, buildAgentTaskPrompt, RuntimeMemoryEntry } from "./agent-runtime"
import { decompositionPrompt, parsePlan, synthesisPrompt, verifyPrompt, parseVerdict, retryPrompt, ORCHESTRATOR_LEAD_SYSTEM } from "./orchestrator"
import { AgentRouteBinding, ChatCompletionMessage, ThinkingConfig } from "../providers/types"
import type {
  LocalAgentAdapterLifecycle,
  LocalAgentAvailabilityResult,
  ModelSelection
} from "../runtime/types"
import { getWorkspaceManager } from "./workspace"
import { homedir } from "node:os"
import { acpMcpServersForWorkspace } from "../runtime/mcp"
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { getSkillManager } from "../skills/manager"
import { buildSkillBlock } from "../skills/inject"
import { runAgenticHttp } from "../agentic/executor"
import { createExecutionTracker } from "../runtime/execution-tracker"
import { isHttpAgenticEnabled } from "../agentic/capabilities"
import { getApprovalConfig, ApprovalRequest, GuardedTool, savePendingApproval, resolvePendingApproval, expireStalePendingApprovals, assessApprovalRisk, approvalReason, type PersistedPendingApproval } from "../agentic/approval"
import { getRunTimeoutMs } from "../runtime/run-preferences"
import { pushNotification } from "../runtime/notifications"
import { readLocalModelConfig } from "../runtime/local-models"
import { compactChatMessages, compactTextByTokenBudget } from "../runtime/token-economy"
// --- /AgentHub skills + native agentic ---

export type DispatchMode = "auto" | "broadcast" | "chain" | "orchestrate"

/** stdio 路径无法像 HTTP 那样下发 reasoning 参数，开启 thinking 时改用 prompt 指令对齐行为。 */
const STDIO_THINKING_DIRECTIVE =
  "[Reasoning mode] Think through the problem step by step and weigh edge cases before answering. " +
  "Do not print raw chain-of-thought; provide the well-reasoned final result."

/** 'ask' 审批等待上限：超时自动拒绝，避免回环永久挂起（用户也可取消任务）。 */
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

const AGENT_CANCELLED = Symbol("agent-cancelled")

/** 宽松判断 thinking 是否开启（兼容 {enabled} / {level} 等形态）。 */
function thinkingRequested(th: any): boolean {
  if (!th || typeof th !== "object") return false
  if (th.enabled === false) return false
  return th.enabled === true || (typeof th.level === "string" && th.level !== "off" && th.level !== "none") || !!th.budgetTokens || !!th.budget
}

function flattenMessagesForLocalAgent(messages: ChatCompletionMessage[]): string {
  const lines = messages
    .filter(message => message.role !== "system" && message.role !== "tool")
    .map(message => {
      const role = message.role === "assistant" ? "Assistant" : "User"
      return `${role}:\n${message.content.trim()}`
    })
    .filter(Boolean)
  if (lines.length <= 1) return messages[messages.length - 1]?.content || ""
  return [
    "[AgentHub 会话历史]",
    "下面是同一线程内的模型对话上下文，请延续这些上下文回答最后一个用户请求。",
    "",
    ...lines
  ].join("\n\n")
}

function compactMessagesForDerivedPrompt(opts: DispatchOptions, prompt: string): ChatCompletionMessage[] | undefined {
  if (!opts.messages?.length) return [{ role: "user", content: prompt }]
  if (opts.preserveCurrentMessage) {
    const history = compactChatMessages(opts.messages.slice(0, -1), {
      maxTokens: 3_000,
      keepRecentMessages: 2,
      perHistoricalMessageTokens: 700,
      currentMessageTokens: 1_200
    }) as ChatCompletionMessage[]
    return [
      ...history,
      { role: "user", content: prompt } as ChatCompletionMessage
    ]
  }
  return compactChatMessages([
    ...opts.messages.slice(0, -1),
    { role: "user", content: prompt } as ChatCompletionMessage
  ], {
    maxTokens: 8_000,
    keepRecentMessages: 3,
    perHistoricalMessageTokens: 900,
    currentMessageTokens: 5_000
  }) as ChatCompletionMessage[]
}

function compactOrchestrateMessages(opts: DispatchOptions, prompt: string, maxTokens = 6_000): ChatCompletionMessage[] {
  const base = opts.messages?.length ? opts.messages.slice(0, -1) : []
  if (opts.preserveCurrentMessage) {
    const history = compactChatMessages(base, {
      maxTokens: Math.max(0, maxTokens - 3_000),
      keepRecentMessages: 2,
      perHistoricalMessageTokens: 600,
      currentMessageTokens: 1_200
    }) as ChatCompletionMessage[]
    return [
      ...history,
      { role: "user", content: prompt } as ChatCompletionMessage
    ]
  }
  return compactChatMessages([
    ...base,
    { role: "user", content: prompt } as ChatCompletionMessage
  ], {
    maxTokens,
    keepRecentMessages: 3,
    perHistoricalMessageTokens: 700,
    currentMessageTokens: Math.max(3_000, Math.floor(maxTokens * 0.65))
  }) as ChatCompletionMessage[]
}

function compactOrchestrateText(text: string, maxTokens = 2_500): string {
  return compactTextByTokenBudget(text, maxTokens, {
    headTokens: Math.floor(maxTokens * 0.68),
    tailTokens: Math.floor(maxTokens * 0.2),
    marker: "[... orchestrator context omitted by token economy ...]"
  }).text
}

function localModelConfigAgentId(agentId: string): string {
  const normalized = agentId.trim().toLowerCase()
  if (normalized === "codex-cli" || normalized === "codex-code") return "codex"
  if (normalized === "gemini-cli") return "gemini"
  if (normalized === "claude-cli" || normalized === "claude-code") return "claude"
  return agentId
}

function localCliModelLabelForAgent(agentId: string): { providerId: "local-cli"; modelId: string } | null {
  try {
    const config = readLocalModelConfig(localModelConfigAgentId(agentId))
    const modelId = typeof config?.modelId === "string" ? config.modelId.trim() : ""
    if (!modelId || config?.status === "missing" || config?.status === "error") return null
    return { providerId: "local-cli", modelId }
  } catch {
    return null
  }
}

function fallbackContentFromActivitySteps(steps: any[]): string {
  const candidates = steps
    .filter(step => step && step.status === "done" && typeof step.output === "string" && step.output.trim())
    .filter(step => {
      const haystack = `${step.kind || ""} ${step.tool || ""} ${step.label || ""}`
      return /\b(agent|task|subagent)\b/i.test(haystack)
    })
    .map(step => step.output.trim())
    .filter(output => !/^(No files found|No matches found|\(Bash completed with no output\))$/i.test(output))
  if (candidates.length === 0) return ""
  return candidates
    .slice(-3)
    .map((output, index, list) => list.length === 1 ? output : `## Sub-agent output ${index + 1}\n\n${output}`)
    .join("\n\n")
}

export function providerDirectAgentId(providerId: string): string {
  return `provider:${providerId}`
}

export interface DispatchTask {
  id: string
  text: string
  mode: DispatchMode
  targetAgent?: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  results: Map<string, string>
  thinking: Map<string, string>
  errors: Map<string, string>
  usage: Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>
  thinkingSummary: Map<string, { enabled: boolean; level?: string; budget?: number; preview?: string }>
  error?: string
  createdAt: Date
}

export interface DispatchOptions {
  thinking?: ThinkingConfig
  modelSelection?: ModelSelection
  systemPrompt?: string
  /** Standard model conversation history. Used by HTTP/API agents directly and flattened for local CLI agents. */
  messages?: ChatCompletionMessage[]
  /** Current user turn text. Lets local agents flatten full history even when dispatch text already includes attachments. */
  conversationText?: string
  /** 工作区 ID：传 null = 不绑定（沿用 home）。stdIO 派发按此取 cwd。 */
  workspaceId?: string | null
  /** Workbench runtime turn id. Used only by the desktop runtime event store. */
  turnId?: string
  /** Stable conversation id for native local runtimes that support persistent sessions. */
  threadId?: string
  /** Metadata copied onto all stream events for this dispatch task. */
  streamMeta?: Record<string, any>
  /** True when the current turn contains inline text attachments that cannot be recovered from a file path. */
  preserveCurrentMessage?: boolean
}

export type StreamEvent =
  | { kind: "start"; taskId: string; agentId: string; providerId: string; modelId: string; mode: "content" | "thinking"; routeReason?: string }
  | { kind: "delta"; taskId: string; agentId: string; providerId: string; modelId: string; channel: "content" | "thinking"; text: string }
  | { kind: "done"; taskId: string; agentId: string; providerId: string; modelId: string; content: string; thinking?: string; summary?: { level?: string; budget?: number; preview?: string }; durationMs: number; usage?: any; routeReason?: string }
  | { kind: "error"; taskId: string; agentId: string; providerId?: string; modelId?: string; error: string; code?: string }
  // agentic 活动步骤（stdio stream-json / 未来 HTTP act-observe 解析所得）；UI 按 step.id upsert
  | { kind: "activity"; taskId: string; agentId: string; step: { id: string; kind?: string; tool?: string; label?: string; detail?: string; output?: string; status: string } }
  // 写/执行审批请求（'ask' 策略命中时发出）；渲染层弹窗 → agentic:resolveApproval 回传决策
  | { kind: "approval"; taskId: string; agentId: string; request: {
      id: string; tool: GuardedTool; toolName: string;
      label?: string; detail?: string;
      action?: 'write_file' | 'run_command'; target?: string;
      risk?: string; reason?: string; preview?: string
    } }
  // 编排模式（Orchestrator）
  | { kind: "orchestrate:plan"; taskId: string; leadAgentId?: string; subtasks: Array<{ id: string; title: string; detail?: string; agentId?: string }> }
  | { kind: "orchestrate:subtask"; taskId: string; subtaskId: string; agentId?: string; status: "pending" | "running" | "done" | "error"; content?: string }
  | { kind: "orchestrate:verdict"; taskId: string; subtaskId: string; pass: boolean; note?: string; attempt: number }
  | { kind: "orchestrate:synthesizing"; taskId: string }
  | { kind: "orchestrate:final"; taskId: string; content: string }
  | { kind: "orchestrate:error"; taskId: string; error: string }

export class Dispatcher extends EventEmitter {
  private tasks: Map<string, DispatchTask> = new Map()
  private taskCounter = 0
  /** 'ask' 审批待决池：requestId → {resolve,timer}。requestId 以 `appr-<taskId>-` 前缀便于按任务清理。 */
  private pendingApprovals: Map<string, { resolve: (v: boolean) => void; timer: ReturnType<typeof setTimeout> }> = new Map()
  private approvalSeq = 0
  private activeAgentStops = new Map<string, () => void>()
  private streamMetaByTask = new Map<string, Record<string, any>>()
  private busyCount = new Map<string, number>()

  constructor(
    private registry: AgentRegistry,
    private pipeline: EventPipeline,
    private memoryProvider: (taskText?: string) => RuntimeMemoryEntry[] = () => []
  ) {
    super()
    // On startup, mark any leftover pending approvals from previous session as stale.
    // If any were recovered, surface a notification so the user knows their prior
    // turn was interrupted (the agent loop is gone, so they can retry manually).
    try {
      const expired = expireStalePendingApprovals()
      if (expired > 0) {
        pushNotification({
          title: '审批请求已失效',
          body: `上次会话有 ${expired} 个未决审批因重启而失效，相关任务已停止。可重新发起以继续。`,
          category: 'approval'
        })
      }
    } catch { /* non-critical */ }
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    if (event === "stream" && args[0]?.taskId) {
      const meta = this.streamMetaByTask.get(args[0].taskId)
      if (meta) args[0] = { ...args[0], ...meta }
    }
    return super.emit(event, ...args)
  }

  on(event: "stream", listener: (e: StreamEvent) => void): this
  on(event: "task:created", listener: (task: DispatchTask) => void): this
  on(event: string, listener: (...args: any[]) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener)
  }

  /**
   * Dispatch a prompt. Returns the task object; results stream via "stream" events.
   * No demo / mock fallback: if no provider is bound the call fails immediately.
   */
  async dispatch(text: string, mode: DispatchMode = "auto", targetAgent?: string, opts: DispatchOptions = {}): Promise<DispatchTask> {
    if (opts.modelSelection?.source === "provider") {
      throw new Error("Provider model selections must run through provider direct dispatch, not local agent routing.")
    }
    const taskId = "task-" + (++this.taskCounter)
    const effectiveMode: DispatchMode = targetAgent ? "auto" : mode
    const task: DispatchTask = {
      id: taskId,
      text,
      mode: effectiveMode,
      targetAgent,
      status: "pending",
      results: new Map(),
      thinking: new Map(),
      errors: new Map(),
      usage: new Map(),
      thinkingSummary: new Map(),
      createdAt: new Date()
    }
    if (opts.turnId) (task as any).__turnId = opts.turnId
    this.tasks.set(task.id, task)
    if (opts.streamMeta) this.streamMetaByTask.set(task.id, opts.streamMeta)
    this.emit("task:created", task)

    task.status = "running"
    try {
      if (effectiveMode === "orchestrate") {
        await this.runOrchestrate(task, text, opts)
      } else {
        const targets = this.resolveTargets(task, effectiveMode, targetAgent)
        if (targets.length === 0) throw new Error("No available provider for the requested routing. Open Settings -> Providers to configure API keys.")

        if (effectiveMode === "chain") {
          let currentText = text
          for (const t of targets) {
            const res = await this.sendToAgent(task, t.agentId, currentText, opts)
            if ((task as any).status === "cancelled") break
            // 链式：上游失败则中断，不把空内容喂给下游（错误已记入 task.errors 并外显）
            if (res.error) break
            currentText = res.content
          }
        } else {
          await Promise.all(targets.map(t => this.sendToAgent(task, t.agentId, text, opts)))
        }

        if ((task as any).status !== "cancelled") task.status = task.errors.size > 0 ? "failed" : "completed"
      }
    } catch (e: any) {
      task.status = "failed"
      task.error = e.message
    }
    this.streamMetaByTask.delete(task.id)
    this.pruneTasks()
    return task
  }

  async dispatchProviderDirect(text: string, selection: ModelSelection, opts: DispatchOptions = {}): Promise<DispatchTask> {
    const taskId = "task-" + (++this.taskCounter)
    const providerId = selection.providerId
    const modelId = selection.modelId
    const agentId = providerDirectAgentId(providerId)
    const task: DispatchTask = {
      id: taskId,
      text,
      mode: "auto",
      targetAgent: agentId,
      status: "pending",
      results: new Map(),
      thinking: new Map(),
      errors: new Map(),
      usage: new Map(),
      thinkingSummary: new Map(),
      createdAt: new Date()
    }
    if (opts.turnId) (task as any).__turnId = opts.turnId
    this.tasks.set(task.id, task)
    if (opts.streamMeta) this.streamMetaByTask.set(task.id, opts.streamMeta)
    this.emit("task:created", task)
    task.status = "running"

    const mgr = getProviderManager()
    const fallbackProvider = mgr.getProvider(providerId)
    const directModel = fallbackProvider?.models.find(item => item.id === modelId)
    if (directModel?.enabled === false) {
      const err = `Selected model is disabled: ${providerId}/${modelId}`
      task.status = "failed"
      task.error = err
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
      this.streamMetaByTask.delete(task.id)
      return task
    }
    const routed = typeof (mgr as any).resolveModelRoute === "function"
      ? mgr.resolveModelRoute(providerId, modelId)
      : typeof (mgr as any).resolveGlobalModelRoute === "function"
        ? mgr.resolveGlobalModelRoute(modelId)
        : null
    const provider = routed?.provider || fallbackProvider
    const model = routed?.model || fallbackProvider?.models.find(item => item.id === modelId)
    if (!isProviderRuntimeUsable(provider)) {
      const err = `Selected model provider is unavailable: ${providerId}`
      task.status = "failed"
      task.error = err
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
      this.streamMetaByTask.delete(task.id)
      return task
    }
    if (!model) {
      const err = `Selected model not found: ${providerId}/${modelId}`
      task.status = "failed"
      task.error = err
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
      this.streamMetaByTask.delete(task.id)
      return task
    }

    const requestModelId = routed?.requestedModelId ?? modelId
    const upstreamModelId = routed?.upstreamModelId ?? model.upstreamModel ?? modelId
    const effectiveModel = { ...model, id: upstreamModelId }
    const binding: AgentRouteBinding = {
      agentId,
      providerId: provider.id,
      modelId: effectiveModel.id,
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: opts.thinking || provider.defaultThinking,
      maxOutputTokens: 8192,
      temperature: 0.2
    }
    const resolved = { provider, model: effectiveModel, binding, thinking: opts.thinking || provider.defaultThinking }
    const client = buildProviderClient(resolved)
    const messages: ChatCompletionMessage[] = opts.messages?.length
      ? opts.messages
      : [{ role: "user", content: text }]
    const systemPrompt = opts.systemPrompt || ""
    let content = ""
    let thinkingTxt = ""
    let summary: any = undefined
    let usage: any = undefined
    const start = Date.now()
    const routeReason = routed?.routeReason || "provider_direct"
    appendAppEventLog("model-route:provider-direct", {
      taskId: task.id,
      providerId: provider.id,
      requestedModelId: requestModelId,
      upstreamModelId,
      routeReason,
      modelSelection: selection
    })
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, mode: "content", routeReason })

    try {
      await this.withAgentTimeout(task, agentId, () => new Promise<void>((resolve, reject) => {
        client.stream(
          { messages, systemPrompt, thinkingOverride: resolved.thinking },
          {
            onContent: (delta) => {
              content += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, channel: "content", text: delta })
            },
            onThinking: (delta) => {
              thinkingTxt += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, channel: "thinking", text: delta })
            },
            onDone: (final) => {
              summary = final.thinking
              usage = final.usage
              resolve()
            },
            onError: (err) => reject(err)
          }
        )
      }), undefined, model.timeoutMs)
      task.results.set(agentId, content)
      task.thinking.set(agentId, thinkingTxt)
      if (summary) task.thinkingSummary.set(agentId, summary)
      if (usage) task.usage.set(agentId, usage)
      this.emit("stream", {
        kind: "done",
        taskId: task.id,
        agentId,
        providerId: provider.id,
        modelId: requestModelId,
        upstreamModelId,
        requestModelId,
        content,
        thinking: thinkingTxt,
        summary,
        usage,
        durationMs: Date.now() - start,
        routeReason
      })
      task.status = "completed"
    } catch (e: any) {
      const err = e?.message || String(e)
      appendAppEventLog("model-route:provider-direct:error", {
        taskId: task.id,
        providerId: provider.id,
        requestedModelId: requestModelId,
        upstreamModelId,
        routeReason,
        error: err,
        code: e?.code
      })
      task.status = e === AGENT_CANCELLED || e?.code === "AGENT_CANCELLED" ? "cancelled" : "failed"
      task.error = err
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, error: err, code: e?.code, durationMs: Date.now() - start })
    }
    this.streamMetaByTask.delete(task.id)
    this.pruneTasks()
    return task
  }

  private isLocalBinding(binding: AgentRouteBinding | undefined | null): boolean {
    return binding?.protocol === "stdio-plain" || binding?.protocol === "acp" || binding?.providerId === "local-cli"
  }

  private adapterLifecycle(adapter: any): LocalAgentAdapterLifecycle {
    if (typeof adapter?.getLifecycle === "function") return adapter.getLifecycle()
    return {
      protocol: adapter?.protocol || "http",
      mode: adapter?.mode || "oneshot",
      status: adapter?.status || "idle",
      running: !!adapter?.proc,
      exitCode: adapter?.exitCode ?? null,
      lastStderr: adapter?.lastStderr
    }
  }

  private localAgentAvailability(agentId: string, binding?: AgentRouteBinding | null): LocalAgentAvailabilityResult {
    const agentInfo = this.registry.get(agentId)
    if (!agentInfo?.adapter) {
      return {
        usable: false,
        agentId,
        code: "LOCAL_AGENT_ADAPTER_MISSING",
        message: `Local agent ${agentId} is configured but its adapter is not registered.`
      }
    }

    const lifecycle = this.adapterLifecycle(agentInfo.adapter)
    const expectedProtocol = binding?.protocol || (binding?.providerId === "local-cli" ? "stdio-plain" : lifecycle.protocol)
    if ((expectedProtocol === "stdio-plain" || expectedProtocol === "acp") && lifecycle.protocol !== expectedProtocol) {
      return {
        usable: false,
        agentId,
        code: "LOCAL_AGENT_PROTOCOL_MISMATCH",
        message: `Local agent ${agentId} is configured for ${expectedProtocol}, but the registered adapter is ${lifecycle.protocol}.`,
        lifecycle
      }
    }
    if (lifecycle.running || lifecycle.status === "busy" || agentInfo.status === "busy") {
      return {
        usable: false,
        agentId,
        code: "LOCAL_AGENT_BUSY",
        message: `Local agent ${agentId} is already running and cannot accept another dispatch yet.`,
        lifecycle
      }
    }
    if (lifecycle.status === "error" || agentInfo.status === "error") {
      return {
        usable: false,
        agentId,
        code: "LOCAL_AGENT_ERROR",
        message: `Local agent ${agentId} is in an error state. Reconfigure or restart the adapter before dispatching.`,
        lifecycle
      }
    }
    if ((expectedProtocol === "stdio-plain" || expectedProtocol === "acp") && !String(agentInfo.adapter.binary || "").trim()) {
      return {
        usable: false,
        agentId,
        code: "LOCAL_AGENT_BINARY_MISSING",
        message: `Local agent ${agentId} has no executable configured.`,
        lifecycle
      }
    }
    return { usable: true, agentId, lifecycle }
  }

  private usableBindings(bindings: AgentRouteBinding[]): AgentRouteBinding[] {
    return bindings.filter(binding => !this.isLocalBinding(binding) || this.localAgentAvailability(binding.agentId, binding).usable)
  }

  private resolveTargets(task: DispatchTask, mode: DispatchMode, targetAgent?: string): Array<{ agentId: string }> {
    const mgr = getProviderManager()
    const allBindings = mgr.getBindings()
    const bindings = this.usableBindings(allBindings)
    if (targetAgent) {
      const b = allBindings.find(x => x.agentId === targetAgent)
      return b ? [{ agentId: targetAgent }] : []
    }
    if (mode === "broadcast") {
      return bindings.map(b => ({ agentId: b.agentId }))
    }
    // auto: route by keyword
    const router = new KeywordRouter()
    const routed = router.route(task.text, this.registry.getAll().map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      mode: a.mode,
      protocol: a.protocol,
      adapter: a.adapter,
      capabilities: a.capabilities,
      lastActive: a.lastActive,
      errorCount: a.errorCount
    })))
    if (routed && bindings.find(b => b.agentId === routed)) return [{ agentId: routed }]
    return bindings.length > 0 ? [{ agentId: bindings[0].agentId }] : []
  }

  /**
   * 编排模式：lead agent 分解任务 → 各 agent 并行执行子任务 → lead 汇总。
   * 复用 sendToAgent 执行；额外发 orchestrate:* 事件供 UI 渲染（其内部 start/delta/done 事件
   * 渲染层在编排消息上忽略，只用 orchestrate:* 驱动 OrchestrateView）。
   */
  private async runOrchestrate(task: DispatchTask, text: string, opts: DispatchOptions): Promise<void> {
    try {
      const mgr = getProviderManager()
      const bindings = this.usableBindings(mgr.getBindings())
      if (bindings.length === 0) throw new Error("No agent bound. Open Settings -> Routing to bind an agent.")

      const router = new KeywordRouter()
      const available = this.registry.getAll().map(a => ({
        id: a.id, name: a.name, status: a.status, mode: a.mode, protocol: a.protocol,
        adapter: a.adapter, capabilities: a.capabilities, lastActive: a.lastActive, errorCount: a.errorCount
      }))
      const bound = new Set(bindings.map(b => b.agentId))
      const routed = router.route(text, available)
      const leadId = (routed && bound.has(routed)) ? routed : bindings[0].agentId

      this.emit("stream", { kind: "orchestrate:plan", taskId: task.id, leadAgentId: leadId, subtasks: [] })

      // 1. 分解（分解阶段 provider 报错 → 直接外显失败，不拿空内容硬跑）
      const planPrompt = decompositionPrompt(text)
      const planRes = await this.sendToAgent(task, leadId, planPrompt, {
        ...opts,
        systemPrompt: ORCHESTRATOR_LEAD_SYSTEM,
        conversationText: planPrompt,
        messages: compactMessagesForDerivedPrompt(opts, planPrompt)
      })
      if (planRes.error) throw new Error("分解阶段失败: " + planRes.error)
      let plan = parsePlan(planRes.content)
      if (!plan || plan.subtasks.length === 0) {
        plan = { subtasks: [{ id: "1", title: text.slice(0, 40), detail: text }] }
      }
      // 指派：lead 未指定或不可用时按 routeScores 选可用 agent，兜底用 lead
      for (const st of plan.subtasks) {
        if (!st.agentId || !bound.has(st.agentId)) {
          const scored = router.routeScores(st.detail || st.title, available).filter(s => bound.has(s.id))
          st.agentId = scored[0]?.id || leadId
        }
      }
      this.emit("stream", {
        kind: "orchestrate:plan", taskId: task.id, leadAgentId: leadId,
        subtasks: plan.subtasks.map(s => ({ id: s.id, title: s.title, detail: s.detail, agentId: s.agentId }))
      })

      // 2. 并行执行子任务（O3：测试 agent 校验 + 有界回环修复，最多 2 次尝试）
      const MAX_ATTEMPTS = 2
      const parts = await Promise.all(plan.subtasks.map(async (st) => {
        if ((task as any).status === "cancelled") return { title: st.title, agentId: st.agentId, content: "", error: "cancelled" }
        let content = ""
        let lastNote: string | undefined
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if ((task as any).status === "cancelled") break
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "running" })
          try {
            const rawPrompt = attempt === 1 ? (st.detail || st.title) : retryPrompt(st.detail || st.title, lastNote)
            const prompt = opts.preserveCurrentMessage ? rawPrompt : compactOrchestrateText(rawPrompt, 3_000)
            const r = await this.sendToAgent(task, st.agentId!, prompt, {
              ...opts,
              conversationText: prompt,
              messages: compactOrchestrateMessages(opts, prompt)
            })
            // 失败外显：provider 报错绝不伪装成 done(空内容)，发 error 状态并退出该子任务
            if (r.error) {
              this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: r.error })
              return { title: st.title, agentId: st.agentId, content: "", error: r.error }
            }
            content = r.content
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "done", content })
            // 校验：用 lead 作为 verify agent（verify 自身报错时 content 为空 → parseVerdict 宽松判过，避免死循环）
            const verifyDetail = opts.preserveCurrentMessage ? (st.detail || "") : compactOrchestrateText(st.detail || "", 1_500)
            const verifyText = verifyPrompt(st.title, verifyDetail, compactOrchestrateText(content, 3_000))
            const verifyRaw = (await this.sendToAgent(task, leadId, verifyText, {
              ...opts,
              systemPrompt: ORCHESTRATOR_LEAD_SYSTEM,
              conversationText: verifyText,
              messages: compactOrchestrateMessages(opts, verifyText)
            })).content
            const v = parseVerdict(verifyRaw)
            this.emit("stream", { kind: "orchestrate:verdict", taskId: task.id, subtaskId: st.id, pass: v.pass, note: v.note, attempt })
            if (v.pass) return { title: st.title, agentId: st.agentId, content }
            lastNote = v.note
            if (attempt >= MAX_ATTEMPTS) return { title: st.title, agentId: st.agentId, content, error: "校验未通过: " + (v.note || "结果不达标") }
          } catch (e: any) {
            const err = e?.message || String(e)
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: err })
            return { title: st.title, agentId: st.agentId, content: "", error: err }
          }
        }
        return { title: st.title, agentId: st.agentId, content }
      }))

      if ((task as any).status === "cancelled") return

      // 3. lead 汇总（汇总阶段 provider 报错 → 外显失败，不得静默以空内容标记完成）
      this.emit("stream", { kind: "orchestrate:synthesizing", taskId: task.id })
      const synthPrompt = synthesisPrompt(opts.preserveCurrentMessage ? text : compactOrchestrateText(text, 4_000), parts.map(part => ({
        ...part,
        content: compactOrchestrateText(part.content || "", 3_000),
        error: part.error ? compactOrchestrateText(part.error, 800) : part.error
      })))
      const synth = await this.sendToAgent(task, leadId, synthPrompt, {
        ...opts,
        systemPrompt: ORCHESTRATOR_LEAD_SYSTEM,
        conversationText: synthPrompt,
        messages: compactOrchestrateMessages(opts, synthPrompt, 8_000)
      })
      if (synth.error) throw new Error("汇总阶段失败: " + synth.error)
      this.emit("stream", { kind: "orchestrate:final", taskId: task.id, content: synth.content })
      task.results.set("orchestrate", synth.content)
      task.status = "completed"
    } catch (e: any) {
      this.emit("stream", { kind: "orchestrate:error", taskId: task.id, error: e?.message || String(e) })
      throw e
    }
  }

  private async sendToAgent(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions): Promise<{ content: string; error?: string }> {
    const mgr = getProviderManager()
    const binding = mgr.getBinding(agentId)
    const resolved = mgr.resolveBinding(agentId)
    // Local transports are usable only when the current binding explicitly asks for them.
    // This prevents a stale registry adapter from hijacking an HTTP/API route.
    if (this.isLocalBinding(binding)) {
      const availability = this.localAgentAvailability(agentId, binding)
      if (!availability.usable) {
        task.errors.set(agentId, availability.message)
        this.emit("stream", { kind: "error", taskId: task.id, agentId, error: availability.message, code: availability.code })
        return { content: "", error: availability.message }
      }
      const agentInfo = this.registry.get(agentId)!
      if (binding?.protocol === "acp" || (agentInfo.adapter as any).protocol === "acp") {
        return this.sendToAgentAcp(task, agentId, text, opts, agentInfo.adapter)
      }
      return this.sendToAgentStdio(task, agentId, text, opts, resolved, agentInfo.adapter, binding)
    }
    if (!resolved) {
      const err = "No available provider for agent " + agentId
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, error: err })
      return { content: "", error: err }
    }
    const effectiveResolved = this.applyModelSelection(resolved, opts.modelSelection)
    const effectiveModelId = (effectiveResolved as any).requestedModelId || effectiveResolved.model.id
    const effectiveUpstreamModelId = (effectiveResolved as any).upstreamModelId || effectiveResolved.model.id
    const effectiveRouteReason = (effectiveResolved as any).routeReason
    if (effectiveRouteReason || effectiveModelId !== effectiveUpstreamModelId) {
      appendAppEventLog("model-route:agent", {
        taskId: task.id,
        agentId,
        providerId: effectiveResolved.provider.id,
        requestedModelId: effectiveModelId,
        upstreamModelId: effectiveUpstreamModelId,
        routeReason: effectiveRouteReason
      })
    }
    this.registry.setStatus(agentId, "busy")
    this.busyCount.set(agentId, (this.busyCount.get(agentId) || 0) + 1)
    const messages: ChatCompletionMessage[] = opts.messages?.length
      ? opts.messages
      : [{ role: "user", content: text }]
    const client = buildProviderClient(effectiveResolved)
    const systemPrompt = this.systemPromptFor(agentId, opts.systemPrompt, text, opts.workspaceId)
    const thinking = opts.thinking || effectiveResolved.thinking

    // --- AgentHub native agentic (Claude-B 新增): 开启后 HTTP agent 走工具回环，真在工作区动手 ---
    if (isHttpAgenticEnabled(agentId)) {
      return this.runAgenticHttpBranch(task, agentId, text, messages, systemPrompt, thinking, effectiveResolved, opts)
    }
    // --- /AgentHub native agentic ---

    let content = ""
    let thinkingTxt = ""
    let summary: any = undefined
    let usage: any = undefined
    const start = Date.now()
    this.emit("stream", {
      kind: "start",
      taskId: task.id,
      agentId,
      providerId: effectiveResolved.provider.id,
      modelId: effectiveModelId,
      upstreamModelId: effectiveUpstreamModelId,
      mode: "content",
      routeReason: effectiveRouteReason
    })

    try {
      await this.pipeline.process(text, agentId)
      const abortController = new AbortController()
      await this.withAgentTimeout(task, agentId, () => new Promise<void>((resolve, reject) => {
        const existingStop = this.activeAgentStops.get(`${task.id}:${agentId}`)
        this.activeAgentStops.set(`${task.id}:${agentId}`, () => {
          abortController.abort()
          existingStop?.()
        })
        client.stream(
          { messages, systemPrompt, thinkingOverride: thinking, signal: abortController.signal },
          {
            onContent: (delta) => {
              content += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: effectiveResolved.provider.id, modelId: effectiveModelId, upstreamModelId: effectiveUpstreamModelId, channel: "content", text: delta })
            },
            onThinking: (delta) => {
              thinkingTxt += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: effectiveResolved.provider.id, modelId: effectiveModelId, upstreamModelId: effectiveUpstreamModelId, channel: "thinking", text: delta })
            },
            onDone: (final) => {
              summary = final.thinking
              usage = final.usage
              resolve()
            },
            onError: (err) => reject(err)
          }
        )
      }), undefined, effectiveResolved.model.timeoutMs)
      task.results.set(agentId, content)
      task.thinking.set(agentId, thinkingTxt)
      if (summary) task.thinkingSummary.set(agentId, summary)
      this.emit("stream", {
        kind: "done",
        taskId: task.id,
        agentId,
        providerId: effectiveResolved.provider.id,
        modelId: effectiveModelId,
        upstreamModelId: effectiveUpstreamModelId,
        requestModelId: effectiveModelId,
        content,
        thinking: thinkingTxt,
        summary,
        usage,
        durationMs: Date.now() - start,
        routeReason: effectiveRouteReason
      })
      task.usage.set(agentId, usage)
      return { content }
    } catch (e: any) {
      if (e === AGENT_CANCELLED || e?.code === "AGENT_CANCELLED") return { content, error: "已暂停该 Agent。" }
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId: effectiveResolved.provider.id, modelId: effectiveModelId, upstreamModelId: effectiveUpstreamModelId, error: e.message, code: e?.code, durationMs: Date.now() - start })
      return { content, error: e.message }
    } finally {
      const remaining = (this.busyCount.get(agentId) || 1) - 1
      if (remaining <= 0) {
        this.busyCount.delete(agentId)
        this.registry.setStatus(agentId, "idle")
      } else {
        this.busyCount.set(agentId, remaining)
      }
    }
  }

  private applyModelSelection(
    resolved: NonNullable<ReturnType<ReturnType<typeof getProviderManager>["resolveBinding"]>>,
    selection?: ModelSelection
  ): NonNullable<ReturnType<ReturnType<typeof getProviderManager>["resolveBinding"]>> & { requestedModelId?: string; upstreamModelId?: string; routeReason?: string } {
    if (!selection?.providerId || !selection.modelId) return resolved
    const mgr = getProviderManager()
    const routed = typeof (mgr as any).resolveModelRoute === "function"
      ? mgr.resolveModelRoute(selection.providerId, selection.modelId)
      : null
    const fallbackProvider = mgr.getProvider(selection.providerId)
    const provider = routed?.provider || fallbackProvider
    if (!routed || !isProviderRuntimeUsable(provider)) {
      if (!isProviderRuntimeUsable(fallbackProvider)) {
        throw new Error(`Selected model provider is unavailable: ${selection.providerId}`)
      }
    }
    if (!provider) throw new Error(`Selected model provider is unavailable: ${selection.providerId}`)
    const model = routed?.model || provider.models.find(item => item.id === selection.modelId)
    if (!model) throw new Error(`Selected model not found: ${selection.providerId}/${selection.modelId}`)
    if (model.enabled === false) throw new Error(`Selected model is disabled: ${selection.providerId}/${selection.modelId}`)
    const effectiveModel = { ...model, id: routed?.upstreamModelId || model.upstreamModel || model.id }
    return {
      ...resolved,
      provider,
      model: effectiveModel,
      binding: {
        ...resolved.binding,
        providerId: provider.id,
        modelId: effectiveModel.id
      },
      thinking: resolved.thinking,
      requestedModelId: routed?.requestedModelId || model.id,
      upstreamModelId: routed?.upstreamModelId || effectiveModel.id,
      routeReason: routed?.routeReason
    }
  }

  private systemPromptFor(agentId: string, overridePrompt?: string, taskText = "", workspaceId?: string | null): string {
    if (overridePrompt) return overridePrompt
    const matchedSkillsBlock = this.matchedSkillsBlockFor(taskText)
    const base = buildAgentRuntimeSystemPrompt(agentId, agentSystemPrompt(agentId), this.memoryContext(taskText), taskText, this.skillsBlockFor(agentId) + matchedSkillsBlock)
    const ws = this.workspaceContextFor(workspaceId)
    return ws ? base + "\n\n" + ws : base
  }

  private promptForAgent(agentId: string, text: string, workspaceId?: string | null): string {
    const matchedSkillsBlock = this.matchedSkillsBlockFor(text)
    const base = buildAgentTaskPrompt(agentId, text, this.memoryContext(text), this.skillsBlockFor(agentId) + matchedSkillsBlock)
    const ws = this.workspaceContextFor(workspaceId)
    // 项目上下文置顶（CLAUDE.md/AGENTS.md 约定），其后才是 runtime 指令 + 用户任务
    return ws ? ws + "\n\n" + base : base
  }

  // --- AgentHub workspace bootstrap：把工作区 bootstrapFiles 作为项目级上下文拼入 prompt（全 agent 通用） ---
  private workspaceContextFor(workspaceId?: string | null): string {
    try {
      return getWorkspaceManager().bootstrapContext(workspaceId ?? null)
    } catch {
      return ""
    }
  }
  // --- /AgentHub workspace bootstrap ---

  // --- AgentHub skills (Claude-B 新增): 取目标 agent 已装技能拼成注入块 ---
  private skillsBlockFor(agentId: string): string {
    try {
      return buildSkillBlock(getSkillManager().installedFor(agentId))
    } catch {
      return ""
    }
  }

  /**
   * 根据用户输入匹配相关的 skill，并将匹配到的 skill 指令注入到 prompt 中
   * 用于在用户发送请求时优先使用匹配的 skill
   */
  private matchedSkillsBlockFor(taskText: string): string {
    try {
      const matchedSkills = getSkillManager().findMatchingSkills(taskText)
      if (matchedSkills.length === 0) return ""
      return "\n\n[自动匹配的相关技能]\n" + matchedSkills.map(s => `## ${s.name}\n${s.instructions}`).join("\n\n")
    } catch {
      return ""
    }
  }
  // --- /AgentHub skills ---

  // --- AgentHub native agentic 工具回环（Claude-B 新增） ---
  // HTTP agent 开启 agentic 后：用 AgentHub 自带工具回环替代纯聊天流，让模型真在工作区
  // 读写文件、跑命令；每步发 activity 事件复用既有步骤卡。自管 start/done/error 与 registry。
  private async runAgenticHttpBranch(
    task: DispatchTask, agentId: string, userText: string, messages: ChatCompletionMessage[], systemPrompt: string,
    thinking: ThinkingConfig, resolved: any, opts: DispatchOptions
  ): Promise<{ content: string; error?: string }> {
    const providerId = resolved.provider.id
    const modelId = resolved.model.id
    let root: string | null = null
    const wsId = opts.workspaceId ?? null
    if (wsId) {
      try { root = getWorkspaceManager().getById(wsId)?.rootPath ?? null } catch { root = null }
    }
    const start = Date.now()
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    const tracker = createExecutionTracker(task.id)
    try {
      const res = await this.withAgentTimeout(task, agentId, () => runAgenticHttp({
        userText,
        messages,
        systemPrompt,
        resolved,
        thinking,
        root,
        agentId,
        policyFor: (tool, risk) => getApprovalConfig().policyForWithRisk(agentId, tool, risk ?? 'low'),
        requestApproval: (req) => this.requestApprovalFor(task, agentId, req),
        isCancelled: () => (task as any).status === "cancelled",
        tracker,
        emit: {
          delta: (channel, textDelta) => this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel, text: textDelta }),
          activity: (step) => this.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
        }
      }))
      tracker.persistReport()
      if (res.error) {
        task.errors.set(agentId, res.error)
        this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: res.error, durationMs: Date.now() - start })
        return { content: res.content || "", error: res.error }
      }
      task.results.set(agentId, res.content)
      if (res.usage) task.usage.set(agentId, res.usage)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content: res.content, usage: res.usage, durationMs: Date.now() - start })
      return { content: res.content }
    } catch (e: any) {
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message, code: e?.code, durationMs: Date.now() - start })
      return { content: "", error: e.message }
    } finally {
      const remaining = (this.busyCount.get(agentId) || 1) - 1
      if (remaining <= 0) {
        this.busyCount.delete(agentId)
        this.registry.setStatus(agentId, "idle")
      } else {
        this.busyCount.set(agentId, remaining)
      }
    }
  }
  // --- /AgentHub native agentic ---

  private memoryContext(taskText = ""): RuntimeMemoryEntry[] {
    try {
      return this.memoryProvider(taskText) || []
    } catch {
      return []
    }
  }

  private localPromptText(task: DispatchTask, text: string, messages?: ChatCompletionMessage[]): string {
    if (!messages?.length) return text
    return flattenMessagesForLocalAgent(messages)
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (task && task.status === "running") {
      task.status = "cancelled"
      for (const [key, stop] of this.activeAgentStops) {
        if (key.startsWith(`${taskId}:`)) stop()
      }
      // 清理该任务所有待决审批（拒绝放行），避免工具回环在 await 上永久挂起
      for (const [id, p] of this.pendingApprovals) {
        if (id.startsWith(`appr-${taskId}-`)) {
          clearTimeout(p.timer)
          this.pendingApprovals.delete(id)
          resolvePendingApproval(id, 'denied')
          p.resolve(false)
        }
      }
      return true
    }
    return false
  }

  cancelAgent(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "running") return false
    task.errors.set(agentId, "已暂停该 Agent。")
    const stop = this.activeAgentStops.get(`${taskId}:${agentId}`)
    if (stop) stop()
    this.emit("stream", { kind: "error", taskId, agentId, error: "已暂停该 Agent。", code: "AGENT_CANCELLED" })
    return true
  }

  private async withAgentTimeout<T>(
    task: DispatchTask,
    agentId: string,
    run: () => Promise<T>,
    onStop?: () => void,
    timeoutOverrideMs?: number
  ): Promise<T> {
    const timeoutMs = timeoutOverrideMs && timeoutOverrideMs > 0 ? timeoutOverrideMs : getRunTimeoutMs()
    const key = `${task.id}:${agentId}`
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    return new Promise<T>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.activeAgentStops.delete(key)
        fn()
      }
      this.activeAgentStops.set(key, () => {
        try { onStop?.() } catch { /* noop */ }
        finish(() => reject(Object.assign(new Error("已暂停该 Agent。"), { code: "AGENT_CANCELLED" })))
      })
      timer = setTimeout(() => {
        try { onStop?.() } catch { /* noop */ }
        const message = `已超过超时限制（${Math.round(timeoutMs / 1000)} 秒）`
        task.errors.set(agentId, message)
        finish(() => reject(Object.assign(new Error(message), { code: "AGENT_TIMEOUT" })))
      }, timeoutMs)
      run().then(value => finish(() => resolve(value)), error => finish(() => reject(error)))
    })
  }

  /** 渲染层审批决策回传：true=放行，false=拒绝。返回是否命中一个待决请求（用于 IPC 反馈）。 */
  resolveApproval(requestId: string, approved: boolean): boolean {
    const p = this.pendingApprovals.get(requestId)
    if (!p) return false
    clearTimeout(p.timer)
    this.pendingApprovals.delete(requestId)
    resolvePendingApproval(requestId, approved ? 'approved' : 'denied')
    p.resolve(approved)
    return true
  }

  /** 发起一次写/执行审批：emit approval 事件 + 注册待决 Promise（超时自动拒绝）+ 持久化。 */
  private requestApprovalFor(task: DispatchTask, agentId: string, req: ApprovalRequest): Promise<boolean> {
    const requestId = `appr-${task.id}-${++this.approvalSeq}`
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.delete(requestId)) {
          resolvePendingApproval(requestId, 'denied')
          resolve(false)
        }
      }, APPROVAL_TIMEOUT_MS)
      this.pendingApprovals.set(requestId, { resolve, timer })
      // Persist pending approval for cross-restart recovery
      const persisted: PersistedPendingApproval = {
        id: requestId,
        request: req,
        agentId,
        createdAt: new Date().toISOString(),
        status: 'pending'
      }
      savePendingApproval(persisted)
      this.emit("stream", {
        kind: "approval", taskId: task.id, agentId,
        request: {
          id: requestId, tool: req.tool, toolName: req.toolName,
          label: req.label, detail: req.detail,
          action: req.action, target: req.target,
          risk: req.risk, reason: req.reason, preview: req.preview
        }
      })
    })
  }

  getTask(taskId: string): DispatchTask | undefined {
    return this.tasks.get(taskId)
  }

  getRecentTasks(limit = 20): DispatchTask[] {
    this.pruneTasks()
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  /** 删除指定任务（幂等操作，不存在也不报错） */
  deleteTask(taskId: string): void {
    // 如果任务正在运行，先取消再删除
    const task = this.tasks.get(taskId)
    if (task && (task.status === 'running' || task.status === 'pending')) {
      try { this.cancel(taskId) } catch { /* non-critical */ }
    }
    this.tasks.delete(taskId)
    this.streamMetaByTask.delete(taskId)
  }

  /** 清除所有已完成/已取消/已失败的终端任务 */
  clearCompleted(): void {
    const toDelete: string[] = []
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
        toDelete.push(id)
      }
    }
    for (const id of toDelete) {
      this.tasks.delete(id)
      this.streamMetaByTask.delete(id)
    }
  }

  /** P2-1: Prune completed/cancelled/failed tasks when the map exceeds the cap. */
  private pruneTasks(maxTasks = 100): void {
    if (this.tasks.size <= maxTasks) return
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000
    const entries = Array.from(this.tasks.entries())
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())
    // Remove oldest terminal tasks first, then very old running tasks
    for (const [id, task] of entries) {
      if (this.tasks.size <= maxTasks) break
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
        this.tasks.delete(id)
      } else if (task.status === 'running' && now - task.createdAt.getTime() > ONE_HOUR) {
        // Force mark very old running tasks as failed and remove
        task.status = 'failed'
        this.tasks.delete(id)
      }
    }
  }

  /** Stdio路径: 通过本地 CLI 子进程向 agent 发 prompt, 收集 stdout 作为 stream 内容.
   * oneshot 适配器（codex exec / claude --print）以进程退出为完成信号;
   * interactive 适配器保留输出静默判定; 任务被取消时 kill 子进程.
   * 注意: stdio 不依赖 HTTP provider, resolved 可为 null.
   */
  private async sendToAgentStdio(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions, resolved: any, adapter: any, binding?: any): Promise<{ content: string; error?: string }> {
    this.registry.setStatus(agentId, "busy")
    let content = ""
    // stdio 直连本地 CLI：用绑定自身的 provider/model 做标注（而非 HTTP 回退结果，
    // 否则本地任务会被错标成 fallbackChain 里某个 HTTP provider）
    const localModelSelection = opts.modelSelection?.source === "local-cli" && opts.modelSelection.agentId === agentId
      ? opts.modelSelection
      : undefined
    const localConfigModel = localModelSelection ? null : localCliModelLabelForAgent(agentId)
    const providerId = localModelSelection ? "local-cli" : localConfigModel?.providerId ?? binding?.providerId ?? resolved?.provider?.id ?? "local-cli"
    const modelId = localModelSelection?.modelId ?? localConfigModel?.modelId ?? binding?.modelId ?? resolved?.model?.id ?? "stdio"
    let usage: any = undefined
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    const start = Date.now()
    const TIMEOUT_MS = getRunTimeoutMs()       // 硬超时
    const POLL_MS = 200
    // 启动后这么久仍无任何输出且进程未退出 → 判为卡死（GUI/交互式二进制，参见 #1 Marvis）
    const STARTUP_SILENCE_MS = 60 * 1000
    // 已产生输出后静默这么久且进程未退出 → 兜底视为已完成（应对输出完却不退出的 CLI）
    const IDLE_AFTER_OUTPUT_MS = 45 * 1000
    const self = this
    let settled = false
    let spawnedOnce = false
    let sawActivity = false
    const activitySteps: any[] = []
    const cleanup = () => {
      adapter.onOutput = null
      adapter.onError = null
      adapter.onActivity = null
      adapter.onUsage = null
      if (adapter.modelOverride !== undefined) adapter.modelOverride = null
    }
    try {
      if (localModelSelection && typeof adapter.supportsModelOverride === "function" && adapter.supportsModelOverride()) {
        adapter.modelOverride = localModelSelection.modelId
      }
      const promptText = this.localPromptText(task, text, opts.messages)
      let agentPrompt = this.promptForAgent(agentId, promptText, opts.workspaceId)
      // thinking 对齐：stdio 不能下发 reasoning 参数，开启时以指令注入（与 HTTP 路径行为一致）
      if (thinkingRequested(opts.thinking)) agentPrompt = STDIO_THINKING_DIRECTIVE + "\n\n" + agentPrompt
      // 工作区 → cwd：未指定/不存在 → 降级 home（不报错），并在 prompt 顶部打提示
      // 让 agent 知道它在 home 而非项目里，避免静默"在错地方改文件"。
      let cwd: string | null = null
      const wsId = opts.workspaceId ?? null
      if (wsId) {
        const ws = getWorkspaceManager().getById(wsId)
        if (ws?.rootPath) cwd = ws.rootPath
        else agentPrompt = '[AgentHub 提示] 指定的工作区不存在或已被删除；本次派发将在 home 目录运行（agent 看不到项目文件）。\n\n' + agentPrompt
      }
      // pipeline 看到的是最终 prompt（包含工作区提示）
      await this.pipeline.process(agentPrompt, agentId)
      await this.withAgentTimeout(task, agentId, () => new Promise<void>((resolveP, rejectP) => {
        let lastOutputAt = Date.now()
        const onChunk = (chunk: string) => {
          content += chunk
          lastOutputAt = Date.now()
          self.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: chunk })
        }
        const onErr = (err: Error) => {
          if (settled) return
          settled = true
          clearInterval(poll)
          cleanup()
          rejectP(err)
        }
        // agentic 活动步骤：透传成 stream 事件；同时刷新"有输出"时间戳，防止长任务被 60s 静默检测误杀
        const onAct = (step: any) => {
          if (settled || !step) return
          lastOutputAt = Date.now()
          sawActivity = true
          activitySteps.push(step)
          self.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
        }
        adapter.onOutput = onChunk
        adapter.onError = onErr
        adapter.onActivity = onAct
        adapter.onUsage = (nextUsage: any) => { usage = nextUsage }
        adapter.start().then(() => {
          try {
            adapter.send(agentPrompt, { cwd })
            spawnedOnce = true
          } catch (e) { onErr(e as Error) }
        }).catch(onErr)
        const poll = setInterval(() => {
          if (settled) return
          const lifecycle = self.adapterLifecycle(adapter)
          const idle = Date.now() - lastOutputAt
          const elapsed = Date.now() - start
          const hasOutput = content.length > 0 || sawActivity
          const procGone = spawnedOnce && !lifecycle.running                       // 进程退出 = oneshot 正常完成
          const quietDone = hasOutput && idle > IDLE_AFTER_OUTPUT_MS               // 有输出后久静默 → 兜底完成
          const stalledNoOutput = spawnedOnce && !hasOutput && elapsed > STARTUP_SILENCE_MS // 始终无输出 → 卡死
          const timedOut = elapsed > TIMEOUT_MS
          const cancelled = (task as any).status === "cancelled"
          if (procGone || quietDone || stalledNoOutput || timedOut || cancelled) {
            settled = true
            clearInterval(poll)
            cleanup()
            if (cancelled || timedOut || stalledNoOutput) {
              try { adapter.stop() } catch { /* noop */ }
            }
            // 卡死 / 超时 → 显式报错，绝不把卡住的 banner/动画当作“完成”静默返回
            if (stalledNoOutput) {
              rejectP(new Error(`本地 CLI 启动 ${Math.round(STARTUP_SILENCE_MS / 1000)}s 无任何输出，疑似无法用于非交互直连（GUI/REPL）。建议改用 HTTP 绑定。`))
              return
            }
            if (timedOut) {
              rejectP(Object.assign(new Error(`已超过超时限制（${Math.round(TIMEOUT_MS / 1000)} 秒）` + (hasOutput ? "，仅收到部分输出" : "")), { code: "AGENT_TIMEOUT" }))
              return
            }
            // 进程退出但 adapter 报告 error（非零退出码）→ 必须 reject，
            // 否则竞态会让 poll 在 onErr 之前 resolveP() 吞掉退出码错误。
            if (procGone && lifecycle.status === 'error') {
              // Include structured exit code and stderr for better diagnostics
              const code = lifecycle.exitCode
              const detail = lifecycle.lastStderr ? lifecycle.lastStderr.trim().slice(-300) : ''
              const exitInfo = code !== null ? ` (exit code: ${code})` : ''
              const errMsg = `${agentId} 进程异常退出${exitInfo}${detail ? '：' + detail : ''}${content ? '（已收集部分输出）' : ''}`
              rejectP(Object.assign(new Error(errMsg), { exitCode: code }))
              return
            }
            resolveP()  // procGone(正常) / quietDone / cancelled → 用已收集内容完成
          }
        }, POLL_MS)
      }), () => { try { adapter.stop() } catch { /* noop */ } })
      content = content || fallbackContentFromActivitySteps(activitySteps)
      task.results.set(agentId, content)
      if (usage) task.usage.set(agentId, usage)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, usage, durationMs: Date.now() - start })
      return { content }
    } catch (e: any) {
      if (e === AGENT_CANCELLED || e?.code === "AGENT_CANCELLED") return { content: "", error: "已暂停该 Agent。" }
      content = content || fallbackContentFromActivitySteps(activitySteps)
      const exitCode = adapter.exitCode ?? null
      const fullStderr = adapter.lastStderr || undefined
      if (content.trim() && exitCode !== null && e?.code !== "AGENT_TIMEOUT") {
        task.results.set(agentId, content)
        if (usage) task.usage.set(agentId, usage)
        this.emit("stream", {
          kind: "activity",
          taskId: task.id,
          agentId,
          step: {
            id: `${task.id}-${agentId}-exit-warning`,
            kind: "note",
            tool: "process_exit",
            label: "CLI exit warning",
            detail: e.message,
            output: fullStderr ? fullStderr.trim().slice(-800) : undefined,
            status: "done"
          }
        })
        this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, usage, durationMs: Date.now() - start })
        return { content }
      }
      task.errors.set(agentId, e.message)
      // Include structured exit code from adapter (if available) for better diagnostics
      this.emit("stream", {
        kind: "error",
        taskId: task.id,
        agentId,
        providerId,
        modelId,
        error: e.message,
        code: e?.code,
        exitCode,
        fullStderr,
        durationMs: Date.now() - start
      })
      return { content, error: e.message }
    } finally {
      try { await adapter.stop() } catch { /* noop */ }
      this.registry.setStatus(agentId, "idle")
    }
  }

  /**
   * ACP 路径：常驻 server，靠 session/prompt 的 stopReason 判完成（不像 stdio oneshot 靠进程退出）。
   * session/update 通知经 adapter.runPrompt 的 handlers 透传为 delta(content/thinking) + activity 步骤。
   * 取消：轮询 task.status，cancelled 时发 session/cancel。每轮结束 stop() 杀掉 server（第一阶段不复用）。
   */
  private async sendToAgentAcp(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions, adapter: any): Promise<{ content: string; error?: string }> {
    this.registry.setStatus(agentId, "busy")
    const localConfigModel = localCliModelLabelForAgent(agentId)
    const providerId = localConfigModel?.providerId ?? "local-acp"
    const modelId = localConfigModel?.modelId ?? "acp"
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    const start = Date.now()
    let content = ""

    // 工作区 → ACP session/new 的 cwd；未指定/不存在 → home（并在 prompt 顶部提示）
    let cwd = homedir()
    const wsId = opts.workspaceId ?? null
    let workspaceMissing = false
    if (wsId) {
      const ws = getWorkspaceManager().getById(wsId)
      if (ws?.rootPath) cwd = ws.rootPath
      else workspaceMissing = true
    }
    const mcpServers = acpMcpServersForWorkspace(opts.workspaceId ?? null)
    const sessionKey = opts.threadId ? `${agentId}:${opts.threadId}` : undefined
    const hasNativeContext = typeof adapter.hasReusableSession === "function" && adapter.hasReusableSession(sessionKey, cwd, mcpServers)

    // Reused ACP sessions keep their own model context. New sessions receive flattened history to restore continuity.
    const promptText = hasNativeContext ? text : this.localPromptText(task, text, opts.messages)
    let agentPrompt = this.promptForAgent(agentId, promptText, opts.workspaceId)
    if (thinkingRequested(opts.thinking)) agentPrompt = STDIO_THINKING_DIRECTIVE + "\n\n" + agentPrompt
    if (workspaceMissing) agentPrompt = '[AgentHub 提示] 指定的工作区不存在或已被删除；本次派发将在 home 目录运行（agent 看不到项目文件）。\n\n' + agentPrompt

    const cancelPoll = setInterval(() => {
      if ((task as any).status === "cancelled") { try { adapter.cancel() } catch { /* noop */ } }
    }, 300)

    try {
      await this.pipeline.process(agentPrompt, agentId)
      const stopReason: string = await this.withAgentTimeout(task, agentId, () => adapter.runPrompt(agentPrompt, cwd, {
        onChunk: (t: string) => { content += t; this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: t }) },
        onThought: (t: string) => this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "thinking", text: t }),
        onActivity: (step: any) => this.emit("stream", { kind: "activity", taskId: task.id, agentId, step }),
        onRequestPermission: (req: any) => this.requestAcpPermission(task, agentId, req)
      }, mcpServers, sessionKey), () => { try { adapter.cancel() } catch { /* noop */ } })
      if ((task as any).status === "cancelled") return { content }
      // refusal 且无任何内容 → 作为错误外显；否则按已收内容正常收尾
      if (stopReason === "refusal" && !content) {
        const err = "ACP agent 拒绝了本次请求（refusal）"
        task.errors.set(agentId, err)
        this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err, durationMs: Date.now() - start })
        return { content: "", error: err }
      }
      task.results.set(agentId, content)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, durationMs: Date.now() - start })
      return { content }
    } catch (e: any) {
      if (e === AGENT_CANCELLED || e?.code === "AGENT_CANCELLED") return { content, error: "已暂停该 Agent。" }
      const err = e?.message || String(e)
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err, code: e?.code, durationMs: Date.now() - start })
      return { content, error: err }
    } finally {
      clearInterval(cancelPoll)
      this.registry.setStatus(agentId, "idle")
    }
  }

  private async requestAcpPermission(task: DispatchTask, agentId: string, req: any): Promise<boolean> {
    if (!req?.tool) return true
    const stepId = String(
      req.raw?.toolCall?.toolCallId ||
      req.raw?.toolCall?.id ||
      req.raw?.toolCallId ||
      `acp-perm-${task.id}-${++this.approvalSeq}`
    )
    const tool = req.tool as GuardedTool
    const toolName = req.toolName || (tool === "exec" ? "exec" : "fs_write")
    const label = req.label || toolName
    const detail = req.detail || ""
    const policy = getApprovalConfig().policyFor(agentId, tool)

    if (policy === "allow") return true

    if (policy === "deny") {
      this.emit("stream", {
        kind: "activity",
        taskId: task.id,
        agentId,
        step: {
          id: stepId,
          kind: "tool",
          tool: toolName,
          label,
          detail,
          output: `Rejected by approval policy: '${tool}' is denied for this agent.`,
          status: "error"
        }
      })
      return false
    }

    this.emit("stream", {
      kind: "activity",
      taskId: task.id,
      agentId,
      step: { id: stepId, kind: "tool", tool: toolName, label, detail, status: "awaiting" }
    })
    const action: 'write_file' | 'run_command' = tool === 'exec' ? 'run_command' : 'write_file'
    const target = detail || label || toolName
    const risk = assessApprovalRisk(toolName, req.raw || {})
    const reason = approvalReason(toolName, risk, target)
    const preview = detail || ''
    const approved = await this.requestApprovalFor(task, agentId, {
      stepId, agentId, tool, toolName, label, detail,
      action, target, risk, reason, preview
    })
    if (!approved) {
      this.emit("stream", {
        kind: "activity",
        taskId: task.id,
        agentId,
        step: {
          id: stepId,
          kind: "tool",
          tool: toolName,
          label,
          detail,
          output: "Rejected by user (approval denied).",
          status: "error"
        }
      })
    }
    return approved
  }
}
