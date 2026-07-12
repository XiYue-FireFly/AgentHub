import { EventEmitter } from "events"
import { AgentRegistry } from "./registry"
import { EventPipeline } from "./pipeline"
import { KeywordRouter } from "./router"
import { getProviderManager, isProviderRuntimeUsable } from "../providers/manager"
import { buildProviderClient, type CallOptions, type StreamCallbacks } from "../providers/client"
import { appendAppEventLog } from "../runtime/app-event-log"
import type { DispatchEnvelope, PromptDispatchLineage } from "../../shared/prompt-contract"
import {
  canonicalProviderPayload,
  childDispatchLineage,
  createDispatchEnvelope,
  createDispatchId,
  verifyDispatchEnvelope
} from "../runtime/dispatch-envelope"
import type {
  AgentDecisionCheckpointResult,
  AgentDecisionCheckpointState
} from "../agentic/user-decision-transport"
import {
  continueAgentDecisionEvent,
  parseAgentDecisionRequestEvent
} from "../agentic/user-decision-transport"
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
import {
  normalizeAcpPermissionOptions,
  type AcpPermissionRequest,
  type AcpPermissionResolution
} from "./adapters/acp-client"
import {
  assertCapabilityTransport,
  shouldRequestAcpPermission,
  type DispatchCapabilityMode
} from './dispatch-capabilities'
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { getSkillManager } from "../skills/manager"
import { buildSkillBlock } from "../skills/inject"
import { runAgenticHttp } from "../agentic/executor"
import type { UserDecisionAdapter } from "../agentic/user-decision-adapter"
import { createExecutionTracker } from "../runtime/execution-tracker"
import { isHttpAgenticEnabled } from "../agentic/capabilities"
import { getApprovalConfig, ApprovalRequest, GuardedTool, assessApprovalRisk, approvalReason } from "../agentic/approval"
import { getRunTimeoutMs } from "../runtime/run-preferences"
import { readLocalModelConfig } from "../runtime/local-models"
import { compactChatMessages, compactTextByTokenBudget } from "../runtime/token-economy"
// --- /AgentHub skills + native agentic ---

export type DispatchMode = "auto" | "broadcast" | "chain" | "orchestrate"

/** stdio 路径无法像 HTTP 那样下发 reasoning 参数，开启 thinking 时改用 prompt 指令对齐行为。 */
const STDIO_THINKING_DIRECTIVE =
  "[Reasoning mode] Think through the problem step by step and weigh edge cases before answering. " +
  "Do not print raw chain-of-thought; provide the well-reasoned final result."

const ORCHESTRATE_EXECUTION_CONCURRENCY = 3

const AGENT_CANCELLED = Symbol("agent-cancelled")

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

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

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function acpPermissionArgs(req: any): Record<string, unknown> {
  return recordOrNull(req?.args)
    || recordOrNull(req?.raw?.toolCall?.rawInput)
    || recordOrNull(req?.raw?.toolCall?.input)
    || recordOrNull(req?.raw?.tool_call?.rawInput)
    || recordOrNull(req?.raw?.tool_call?.input)
    || recordOrNull(req?.raw?.rawInput)
    || recordOrNull(req?.raw?.input)
    || recordOrNull(req?.raw)
    || {}
}

function cancelledAcpPermission(): AcpPermissionResolution {
  return { outcome: 'cancelled' }
}

function selectedAcpPermission(
  resolution: unknown,
  options: AcpPermissionRequest['options']
): AcpPermissionResolution {
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return cancelledAcpPermission()
  const proto = Object.getPrototypeOf(resolution)
  if (proto !== Object.prototype && proto !== null) return cancelledAcpPermission()
  const ownKeys = Reflect.ownKeys(resolution)
  if (ownKeys.length !== 2 || !ownKeys.includes('outcome') || !ownKeys.includes('optionId')) {
    return cancelledAcpPermission()
  }
  const outcome = Object.getOwnPropertyDescriptor(resolution, 'outcome')
  const optionId = Object.getOwnPropertyDescriptor(resolution, 'optionId')
  if (!outcome || !optionId || !('value' in outcome) || !('value' in optionId)) return cancelledAcpPermission()
  if (outcome.value !== 'selected' || typeof optionId.value !== 'string') return cancelledAcpPermission()
  return options.some(option => option.optionId === optionId.value)
    ? { outcome: 'selected', optionId: optionId.value }
    : cancelledAcpPermission()
}

function uniquelyAllowedAcpPermission(options: AcpPermissionRequest['options']): AcpPermissionResolution {
  const allowOnce = options.filter(option => option.kind === 'allow_once')
  return allowOnce.length === 1
    ? { outcome: 'selected', optionId: allowOnce[0].optionId }
    : cancelledAcpPermission()
}

function isDeniedAcpPermissionOption(option: AcpPermissionRequest['options'][number] | undefined): boolean {
  return option?.kind?.startsWith('deny') === true
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
  /** Internal Workbench Turn identity used for cancellation admission. */
  __turnId?: string
  latestDispatchEnvelope?: DispatchEnvelope
}

export interface DispatchHandle<T> {
  taskId: string
  result: Promise<T>
  cancel(reason?: string): Promise<void>
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
  /** Root Prompt lineage. All internal execution has an explicit root or audit-only fallback. */
  lineage: PromptDispatchLineage
  parentDispatchId?: string
  attachments?: readonly unknown[]
  contextLayers?: readonly string[]
  signal?: AbortSignal
  deadline?: number
  parentRunId?: string
  branchId?: string
  sessionKey?: string
  budgetReservationId?: string
  visibility?: 'chat' | 'run'
  capabilityMode?: DispatchCapabilityMode
  userDecisionAdapter?: UserDecisionAdapter
}

/** Public dispatch compatibility shape. `startDispatch` always requires a lineage. */
export type DispatchInputOptions = Omit<DispatchOptions, 'lineage'> & {
  lineage?: PromptDispatchLineage
}

type LocalAgentSendResult = {
  content: string
  error?: string
  decisionCheckpoint?: {
    state: AgentDecisionCheckpointState
    result: AgentDecisionCheckpointResult
  }
}

export interface ApprovalStreamRequest {
  id: string
  stepId: string
  tool: GuardedTool
  toolName: string
  label?: string
  detail?: string
  action?: 'write_file' | 'run_command'
  target?: string
  risk?: string
  reason?: string
  preview?: string
}

export type StreamEvent =
  | { kind: "start"; taskId: string; agentId: string; providerId: string; modelId: string; mode: "content" | "thinking"; routeReason?: string }
  | { kind: "delta"; taskId: string; agentId: string; providerId: string; modelId: string; channel: "content" | "thinking"; text: string }
  | { kind: "done"; taskId: string; agentId: string; providerId: string; modelId: string; content: string; thinking?: string; summary?: { level?: string; budget?: number; preview?: string }; durationMs: number; usage?: any; routeReason?: string }
  | { kind: "error"; taskId: string; agentId: string; providerId?: string; modelId?: string; error: string; code?: string }
  // agentic 活动步骤（stdio stream-json / 未来 HTTP act-observe 解析所得）；UI 按 step.id upsert
  | { kind: "activity"; taskId: string; agentId: string; step: { id: string; kind?: string; tool?: string; label?: string; detail?: string; output?: string; status: string } }
  // 写/执行审批请求（'ask' 策略命中时发出）；DecisionService owns resolution.
  | { kind: "approval"; taskId: string; agentId: string; status?: "pending" | "approved" | "denied"; auditOnly?: boolean; request: ApprovalStreamRequest }
  // 编排模式（Orchestrator）
  | { kind: "orchestrate:plan"; taskId: string; leadAgentId?: string; subtasks: Array<{ id: string; title: string; detail?: string; agentId?: string }> }
  | { kind: "orchestrate:subtask"; taskId: string; subtaskId: string; agentId?: string; status: "pending" | "running" | "done" | "error"; content?: string }
  | { kind: "orchestrate:verdict"; taskId: string; subtaskId: string; pass: boolean; note?: string; attempt: number }
  | { kind: "orchestrate:synthesizing"; taskId: string }
  | { kind: "orchestrate:final"; taskId: string; content: string }
  | { kind: "orchestrate:error"; taskId: string; error: string }

export interface DispatcherToolDecisionInput {
  task: DispatchTask
  agentId: string
  request: ApprovalRequest
  idempotencyKey: string
  onRequested(requestId: string): void
}

export interface DispatcherAcpPermissionDecisionInput {
  task: DispatchTask
  agentId: string
  request: AcpPermissionRequest
  idempotencyKey: string
  onRequested(requestId: string): void
}

export interface DispatcherDecisionAdapter {
  requestToolDecision?(input: DispatcherToolDecisionInput): Promise<boolean>
  requestAcpPermissionDecision?(input: DispatcherAcpPermissionDecisionInput): Promise<AcpPermissionResolution>
  cancelDecisionTurn?(turnId: string): Promise<void>
  cancelDecisionAgent?(turnId: string, agentId: string): Promise<void>
}

export interface DispatcherDecisionCancellationOptions {
  decisionAlreadyCancelled?: boolean
}

export class Dispatcher extends EventEmitter {
  private tasks: Map<string, DispatchTask> = new Map()
  private inFlightTaskIds = new Set<string>()
  private stableTaskIds = new WeakMap<DispatchTask, string>()
  private finishedTasks = new WeakSet<DispatchTask>()
  private cancelledTerminalTaskIds = new Set<string>()
  private taskObserverErrors = new Map<string, unknown>()
  private taskCounter = 0
  private approvalSeq = 0
  private activeAgentStops = new Map<string, Set<() => void>>()
  private cancelledAgents = new WeakMap<DispatchTask, Set<string>>()
  private cancelledAgentTerminals = new WeakMap<DispatchTask, Set<string>>()
  private cancelledOrchestrateSubtaskTerminals = new WeakMap<DispatchTask, Set<string>>()
  private cancelledTurnIds = new Set<string>()
  private cancelledAgentsByTurn = new Map<string, Set<string>>()
  private streamMetaByTask = new Map<string, Record<string, any>>()
  private busyCount = new Map<string, number>()
  private localAgentQueues = new Map<string, Promise<void>>()
  private pendingTaskRemovals = new Map<string, "delete" | "clear" | "prune">()
  private shutdownState: "open" | "closing" | "closed" = "open"
  private shutdownDrainPromise: Promise<void> | null = null
  private dispatchOperations = new Set<Promise<void>>()
  private sourceOperations = new Set<Promise<unknown>>()

  private dispatchLineage(opts: DispatchOptions): PromptDispatchLineage {
    const lineage = opts.lineage
    return opts.parentDispatchId
      ? Object.freeze({ ...lineage, parentDispatchId: opts.parentDispatchId })
      : lineage
  }

  private normalizeDispatchOptions(opts: DispatchInputOptions = {}): DispatchOptions {
    return {
      ...opts,
      lineage: opts.lineage || {
        origin: 'internal:model-diagnostic',
        policy: 'internal'
      }
    }
  }

  async redispatchDecisionCheckpoint(input: {
    task: DispatchTask
    state: AgentDecisionCheckpointState
    result: AgentDecisionCheckpointResult
    opts: DispatchOptions
  }): Promise<{ content: string; error?: string }> {
    const { state, result, opts } = input
    if (!opts.turnId || state.turnId !== opts.turnId) {
      throw new Error('Decision checkpoint must resume inside the same turnId.')
    }
    if (state.threadId !== opts.threadId || state.sessionId !== result.sessionId) {
      throw new Error('Decision checkpoint session/context mismatch.')
    }
    const resumePayload = JSON.stringify({
      type: 'decision_checkpoint_resume',
      version: 1,
      sessionId: state.sessionId,
      checkpointId: state.checkpointId,
      context: state.context,
      result
    })
    return this.sendToAgent(
      input.task,
      state.agentId,
      resumePayload,
      {
        ...opts,
        turnId: state.turnId,
        threadId: state.threadId,
        parentDispatchId: state.dispatchEnvelope.dispatchId,
        messages: undefined,
        conversationText: resumePayload,
        lineage: childDispatchLineage(
          state.lineage,
          state.dispatchEnvelope.dispatchId,
          'internal:agentic-round'
        )
      }
    )
  }

  private prepareDispatchEnvelope(input: {
    opts: DispatchOptions
    providerId: string
    modelId: string
    protocol: string
    systemPrompt?: string
    messages: readonly unknown[]
    tools?: readonly unknown[]
    toolChoice?: unknown
    thinking?: unknown
  }): DispatchEnvelope {
    const payload = canonicalProviderPayload({
      providerId: input.providerId,
      modelId: input.modelId,
      protocol: input.protocol,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      tools: input.tools || [],
      toolChoice: input.toolChoice,
      thinking: input.thinking,
      attachments: input.opts.attachments || [],
      contextLayers: input.opts.contextLayers || []
    })
    const envelope = createDispatchEnvelope({
      dispatchId: createDispatchId(),
      lineage: this.dispatchLineage(input.opts),
      payload
    })
    appendAppEventLog("dispatch:prepared", {
      dispatchId: envelope.dispatchId,
      providerId: envelope.providerId,
      modelId: envelope.modelId,
      canonicalPayloadHash: envelope.canonicalPayloadHash,
      origin: envelope.origin,
      policy: envelope.policy,
      rootInputId: envelope.rootInputId,
      rootEnvelopeId: envelope.rootEnvelopeId,
      rootPreparedTextHash: envelope.rootPreparedTextHash,
      parentDispatchId: envelope.parentDispatchId
    })
    return envelope
  }

  constructor(
    private registry: AgentRegistry,
    private pipeline: EventPipeline,
    private memoryProvider: (taskText?: string) => RuntimeMemoryEntry[] = () => [],
    private decisionAdapter: DispatcherDecisionAdapter = {}
  ) {
    super()
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    if (event === "stream" && args[0]?.taskId) {
      const isShutdownTerminal = args[0]?.kind === "error" && args[0]?.code === "AGENT_CANCELLED"
      const isApprovalResolution = args[0]?.kind === "approval" && args[0]?.status !== "pending"
      if (this.shutdownState !== "open" && !isShutdownTerminal && !isApprovalResolution) return false
      const task = this.tasks.get(args[0].taskId)
      const agentId = args[0]?.agentId
      if (task && agentId && this.isScopedAgentCancelled(task, agentId)) {
        const isOrchestrateSubtaskTerminal = args[0]?.kind === "orchestrate:subtask"
          && args[0]?.status === "error"
          && typeof args[0]?.subtaskId === "string"
        if (isShutdownTerminal) {
          const terminals = this.cancelledAgentTerminals.get(task) ?? new Set<string>()
          if (terminals.has(agentId)) return false
          terminals.add(agentId)
          this.cancelledAgentTerminals.set(task, terminals)
        } else if (isOrchestrateSubtaskTerminal) {
          const terminals = this.cancelledOrchestrateSubtaskTerminals.get(task) ?? new Set<string>()
          const terminalKey = `${agentId}:${args[0].subtaskId}`
          if (terminals.has(terminalKey)) return false
          terminals.add(terminalKey)
          this.cancelledOrchestrateSubtaskTerminals.set(task, terminals)
          args[0] = { ...args[0], content: "已暂停该 Agent。" }
        } else if (!isApprovalResolution) {
          return false
        }
      }
      const meta = this.streamMetaByTask.get(args[0].taskId)
      if (meta) args[0] = { ...args[0], ...meta }
      if (args[0]?.kind === "error" && args[0]?.code === "AGENT_CANCELLED") {
        this.cancelledTerminalTaskIds.add(args[0].taskId)
      }
    }
    if (event !== "task:created" && event !== "stream" && event !== "task:finished" && event !== "task:removed") {
      return super.emit(event, ...args)
    }
    const listeners = this.rawListeners(event)
    for (const listener of listeners) {
      try {
        Reflect.apply(listener, this, args)
      } catch (error) {
        const taskId = event === "task:created" ? args[0]?.id : event === "stream" ? args[0]?.taskId : undefined
        if (taskId && !this.taskObserverErrors.has(taskId)) this.taskObserverErrors.set(taskId, error)
        console.error(`[dispatcher] ${String(event)} observer failed`, error)
      }
    }
    return listeners.length > 0
  }

  on(event: "stream", listener: (e: StreamEvent) => void): this
  on(event: "task:created", listener: (task: DispatchTask) => void): this
  on(event: "task:finished", listener: (task: DispatchTask) => void): this
  on(event: "task:removed", listener: (event: { taskId: string; reason: "delete" | "clear" | "prune" }) => void): this
  on(event: string, listener: (...args: any[]) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener)
  }

  beginShutdown(): void {
    if (this.shutdownState !== "open") return
    this.shutdownState = "closing"
    for (const [taskId, task] of this.tasks) {
      if (task.status === "pending") {
        task.status = "cancelled"
        task.error = "Dispatcher is shutting down."
      } else if (task.status === "running") {
        this.cancel(taskId)
      }
    }
    for (const stops of [...this.activeAgentStops.values()]) {
      for (const stop of [...stops]) {
        try { stop() } catch { /* best-effort cancellation; drain still awaits tracked operations */ }
      }
    }
  }

  stopAndDrain(): Promise<void> {
    this.beginShutdown()
    if (this.shutdownDrainPromise) return this.shutdownDrainPromise
    this.shutdownDrainPromise = (async () => {
      while (this.dispatchOperations.size > 0 || this.sourceOperations.size > 0) {
        await Promise.allSettled([
          ...this.dispatchOperations,
          ...this.sourceOperations
        ])
      }
      this.shutdownState = "closed"
    })()
    return this.shutdownDrainPromise
  }

  private shutdownAdmissionError(): Error {
    return Object.assign(new Error("Dispatcher is shutting down and cannot accept new dispatches."), {
      code: "DISPATCHER_SHUTDOWN"
    })
  }

  private isScopedAgentCancelled(task: DispatchTask, agentId: string): boolean {
    if (this.cancelledAgents.get(task)?.has(agentId) === true) return true
    const turnId = task.__turnId
    return !!turnId && this.cancelledAgentsByTurn.get(turnId)?.has(agentId) === true
  }

  private isTaskTurnCancelled(task: DispatchTask): boolean {
    return !!task.__turnId && this.cancelledTurnIds.has(task.__turnId)
  }

  private isAgentCancelled(task: DispatchTask, agentId: string): boolean {
    return task.status === "cancelled"
      || this.isTaskTurnCancelled(task)
      || this.isScopedAgentCancelled(task, agentId)
  }

  private agentCancelledError(): Error {
    return Object.assign(new Error("已暂停该 Agent。"), { code: "AGENT_CANCELLED" })
  }

  private throwIfAgentCancelled(task: DispatchTask, agentId: string): void {
    if (this.isAgentCancelled(task, agentId)) throw this.agentCancelledError()
  }

  private markTaskAgentCancelled(task: DispatchTask, agentId: string): boolean {
    const cancelled = this.cancelledAgents.get(task) ?? new Set<string>()
    if (cancelled.has(agentId)) return false
    cancelled.add(agentId)
    this.cancelledAgents.set(task, cancelled)
    task.errors.set(agentId, "已暂停该 Agent。")
    return true
  }

  private startDispatchOperation<T>(run: () => Promise<T>): Promise<T> {
    let finish!: () => void
    const marker = new Promise<void>(resolve => { finish = resolve })
    this.dispatchOperations.add(marker)
    let operation: Promise<T>
    try {
      operation = run()
    } catch (error) {
      this.dispatchOperations.delete(marker)
      finish()
      return Promise.reject(error)
    }
    void operation.then(
      () => {
        this.dispatchOperations.delete(marker)
        finish()
      },
      () => {
        this.dispatchOperations.delete(marker)
        finish()
      }
    )
    return operation
  }

  startDispatch(
    text: string,
    mode: DispatchMode = 'auto',
    targetAgent: string | undefined,
    opts: DispatchOptions
  ): DispatchHandle<DispatchTask> {
    if (this.shutdownState !== 'open') throw this.shutdownAdmissionError()
    if (opts.modelSelection?.source === "provider") {
      throw new Error("Provider model selections must run through provider direct dispatch, not local agent routing.")
    }
    if (opts.turnId && this.cancelledTurnIds.has(opts.turnId)) throw this.agentCancelledError()
    if (opts.turnId && targetAgent && this.cancelledAgentsByTurn.get(opts.turnId)?.has(targetAgent)) {
      throw this.agentCancelledError()
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
    if (opts.turnId) task.__turnId = opts.turnId
    ;(task as any).__lineage = opts.lineage
    this.stableTaskIds.set(task, taskId)
    this.tasks.set(taskId, task)
    this.inFlightTaskIds.add(taskId)
    const branchMeta = opts.branchId ? {
      ...(opts.streamMeta || {}),
      parentRunId: opts.parentRunId,
      branchId: opts.branchId,
      sessionKey: opts.sessionKey,
      budgetReservationId: opts.budgetReservationId,
      rootInputId: opts.lineage.rootInputId,
      rootEnvelopeId: opts.lineage.rootEnvelopeId,
      rootPreparedTextHash: opts.lineage.rootPreparedTextHash,
      parentDispatchId: opts.lineage.parentDispatchId,
      visibility: opts.visibility || 'run'
    } : opts.streamMeta
    if (branchMeta) this.streamMetaByTask.set(task.id, branchMeta)
    this.emit("task:created", this.taskSnapshot(task, taskId))

    const branchAbortController = new AbortController()
    const cancelBranch = (reason: string) => {
      if (!branchAbortController.signal.aborted) branchAbortController.abort(reason)
      this.cancel(taskId, reason)
    }
    const branchOptions: DispatchOptions = { ...opts, signal: branchAbortController.signal }
    const unbind = this.bindBranchCancellation(taskId, opts, cancelBranch)
    const result = this.startDispatchOperation(() => this.executeDispatchTask(task, text, effectiveMode, targetAgent, branchOptions))
      .finally(unbind)
    return Object.freeze({
      taskId,
      result,
      cancel: async (reason = 'cancelled') => {
        cancelBranch(reason)
      }
    })
  }

  /**
   * Dispatch a prompt. Returns the task object; results stream via "stream" events.
   * Legacy callers receive the internal audit-only lineage when they have not yet
   * entered through the prepared Prompt boundary.
   */
  dispatch(text: string, mode: DispatchMode = "auto", targetAgent?: string, opts: DispatchInputOptions = {}): Promise<DispatchTask> {
    try {
      return this.startDispatch(text, mode, targetAgent, this.normalizeDispatchOptions(opts)).result
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private async executeDispatchTask(
    task: DispatchTask,
    text: string,
    effectiveMode: DispatchMode,
    targetAgent: string | undefined,
    opts: DispatchOptions
  ): Promise<DispatchTask> {
    if (task.status === "cancelled"
      || this.isTaskTurnCancelled(task)
      || (!!targetAgent && this.isAgentCancelled(task, targetAgent))) {
      return this.finishCancelledBeforeStart(task, targetAgent || "dispatcher")
    }
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
      if ((task as any).status !== "cancelled") {
        task.status = "failed"
        task.error = e.message
      }
    }
    return this.finishTask(task, task.id)
  }

  private bindBranchCancellation(
    taskId: string,
    opts: DispatchOptions,
    cancelBranch: (reason: string) => void
  ): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => cancelBranch(String(opts.signal?.reason || 'cancelled'))
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (opts.deadline !== undefined) {
      timer = setTimeout(
        () => cancelBranch('branch deadline exceeded'),
        Math.max(0, opts.deadline - Date.now())
      )
    }
    return () => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  dispatchProviderDirect(text: string, selection: ModelSelection, opts: DispatchInputOptions = {}): Promise<DispatchTask> {
    const normalized = this.normalizeDispatchOptions(opts)
    if (this.shutdownState !== "open") return Promise.reject(this.shutdownAdmissionError())
    const agentId = providerDirectAgentId(selection.providerId)
    if (normalized.turnId && (this.cancelledTurnIds.has(normalized.turnId)
      || this.cancelledAgentsByTurn.get(normalized.turnId)?.has(agentId))) {
      return Promise.reject(this.agentCancelledError())
    }
    return this.startDispatchOperation(() => this.dispatchProviderDirectOpen(text, selection, normalized))
  }

  private async dispatchProviderDirectOpen(text: string, selection: ModelSelection, opts: DispatchOptions): Promise<DispatchTask> {
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
    if (opts.turnId) task.__turnId = opts.turnId
    this.stableTaskIds.set(task, taskId)
    this.tasks.set(taskId, task)
    this.inFlightTaskIds.add(taskId)
    if (opts.streamMeta) this.streamMetaByTask.set(task.id, opts.streamMeta)
    try {
      this.emit("task:created", this.taskSnapshot(task, taskId))
      this.throwTaskObserverError(taskId)
      if (task.status === "cancelled" || this.isAgentCancelled(task, agentId)) {
        return this.finishCancelledBeforeStart(task, agentId, providerId, modelId)
      }
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
      return this.finishTask(task)
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
      return this.finishTask(task)
    }
    if (!model) {
      const err = `Selected model not found: ${providerId}/${modelId}`
      task.status = "failed"
      task.error = err
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
      return this.finishTask(task)
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
    let client: ReturnType<typeof buildProviderClient>
    try {
      client = buildProviderClient(resolved)
    } catch (error: any) {
      const err = error?.message || String(error)
      task.status = "failed"
      task.error = err
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err })
      return this.finishTask(task)
    }
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
    this.emit("stream", { kind: "start", taskId, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, mode: "content", routeReason })
    this.throwTaskObserverError(taskId)

    try {
      const abortController = new AbortController()
      const dispatchEnvelope = this.prepareDispatchEnvelope({
        opts,
        providerId: provider.id,
        modelId: effectiveModel.id,
        protocol: provider.capabilities.protocol,
        systemPrompt,
        messages,
        thinking: resolved.thinking
      })
      verifyDispatchEnvelope(dispatchEnvelope, canonicalProviderPayload({
        providerId: provider.id,
        modelId: effectiveModel.id,
        protocol: provider.capabilities.protocol,
        systemPrompt,
        messages,
        thinking: resolved.thinking,
        attachments: opts.attachments || [],
        contextLayers: opts.contextLayers || []
      }))
      task.latestDispatchEnvelope = dispatchEnvelope
      await this.withAgentTimeout(task, agentId, () => this.waitForProviderStream(
        client,
        { messages, systemPrompt, thinkingOverride: resolved.thinking, signal: abortController.signal, dispatchEnvelope, attachments: opts.attachments, contextLayers: opts.contextLayers },
        {
          onContent: (delta) => {
            if (this.isAgentCancelled(task, agentId)) return
            content += delta
            this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, channel: "content", text: delta })
          },
          onThinking: (delta) => {
            if (this.isAgentCancelled(task, agentId)) return
            thinkingTxt += delta
            this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: provider.id, modelId: requestModelId, upstreamModelId, channel: "thinking", text: delta })
          },
          onDone: (final) => {
            if (this.isAgentCancelled(task, agentId)) return
            summary = final.thinking
            usage = final.usage
          }
        }
      ), () => abortController.abort(), model.timeoutMs)
      this.throwIfAgentCancelled(task, agentId)
      this.throwTaskObserverError(taskId)
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
    return this.finishTask(task, taskId)
    } catch (error: any) {
      if (!this.finishedTasks.has(task) && task.status !== "cancelled") {
        const err = error?.message || String(error)
        task.status = "failed"
        task.error = err
        task.errors.set(agentId, err)
        this.emit("stream", { kind: "error", taskId, agentId, providerId, modelId, error: err, code: error?.code })
      }
      return task
    } finally {
      this.finishTask(task, taskId)
    }
  }

  private isLocalBinding(binding: AgentRouteBinding | undefined | null): boolean {
    return binding?.protocol === "stdio-plain" || binding?.protocol === "stdio-ndjson" || binding?.protocol === "acp" || binding?.providerId === "local-cli"
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
    if ((expectedProtocol === "stdio-plain" || expectedProtocol === "stdio-ndjson" || expectedProtocol === "acp") && lifecycle.protocol !== expectedProtocol) {
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
    if ((expectedProtocol === "stdio-plain" || expectedProtocol === "stdio-ndjson" || expectedProtocol === "acp") && !String(agentInfo.adapter.binary || "").trim()) {
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

  private async withLocalAgentQueue<T>(agentId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.localAgentQueues.get(agentId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    this.localAgentQueues.set(agentId, current)
    await previous.catch(() => {})
    try {
      return await run()
    } finally {
      release()
      if (this.localAgentQueues.get(agentId) === current) this.localAgentQueues.delete(agentId)
    }
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
      const parts = await mapWithConcurrency(plan.subtasks, ORCHESTRATE_EXECUTION_CONCURRENCY, async (st) => {
        if ((task as any).status === "cancelled") return { title: st.title, agentId: st.agentId, content: "", error: "cancelled" }
        let content = ""
        let lastNote: string | undefined
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if ((task as any).status === "cancelled") break
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "running" })
          let workerTerminalEmitted = false
          const emitWorkerTerminal = (status: "done" | "error", terminalContent: string) => {
            if (workerTerminalEmitted) return
            workerTerminalEmitted = true
            this.emit("stream", {
              kind: "orchestrate:subtask",
              taskId: task.id,
              subtaskId: st.id,
              agentId: st.agentId,
              status,
              content: terminalContent
            })
          }
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
              emitWorkerTerminal("error", r.error)
              return { title: st.title, agentId: st.agentId, content: "", error: r.error }
            }
            content = r.content
            emitWorkerTerminal("done", content)
            // 校验：用 lead 作为 verify agent；verify 自身报错时终止当前子任务，避免误当作歧义 verdict 重跑 worker。
            const verifyDetail = opts.preserveCurrentMessage ? (st.detail || "") : compactOrchestrateText(st.detail || "", 1_500)
            const verifyText = verifyPrompt(st.title, verifyDetail, compactOrchestrateText(content, 3_000))
            const verifyResult = await this.sendToAgent(task, leadId, verifyText, {
              ...opts,
              systemPrompt: ORCHESTRATOR_LEAD_SYSTEM,
              conversationText: verifyText,
              messages: compactOrchestrateMessages(opts, verifyText)
            })
            if (verifyResult.error) {
              return {
                title: st.title,
                agentId: st.agentId,
                content,
                error: "校验阶段失败: " + verifyResult.error
              }
            }
            const v = parseVerdict(verifyResult.content)
            this.emit("stream", { kind: "orchestrate:verdict", taskId: task.id, subtaskId: st.id, pass: v.pass, note: v.note, attempt })
            if (v.pass) return { title: st.title, agentId: st.agentId, content }
            lastNote = v.note
            if (attempt >= MAX_ATTEMPTS) return { title: st.title, agentId: st.agentId, content, error: "校验未通过: " + (v.note || "结果不达标") }
          } catch (e: any) {
            const err = e?.message || String(e)
            emitWorkerTerminal("error", err)
            return { title: st.title, agentId: st.agentId, content: "", error: err }
          }
        }
        return { title: st.title, agentId: st.agentId, content }
      })

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
    if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
    const mgr = getProviderManager()
    const binding = mgr.getBinding(agentId)
    assertCapabilityTransport(binding?.protocol, opts.capabilityMode, binding?.providerId)
    const resolved = mgr.resolveBinding(agentId)
    // Local transports are usable only when the current binding explicitly asks for them.
    // This prevents a stale registry adapter from hijacking an HTTP/API route.
    if (this.isLocalBinding(binding)) {
      const localResult = await this.withLocalAgentQueue<LocalAgentSendResult>(agentId, async () => {
        if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
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
      })
      if (localResult.decisionCheckpoint) {
        return this.redispatchDecisionCheckpoint({
          task,
          state: localResult.decisionCheckpoint.state,
          result: localResult.decisionCheckpoint.result,
          opts
        })
      }
      return localResult
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
    try {
    const messages: ChatCompletionMessage[] = opts.messages?.length
      ? opts.messages
      : [{ role: "user", content: text }]
    const client = buildProviderClient(effectiveResolved)
    const systemPrompt = this.systemPromptFor(agentId, opts.systemPrompt, text, opts.workspaceId)
    const thinking = opts.thinking || effectiveResolved.thinking

    // --- AgentHub native agentic (Claude-B 新增): 开启后 HTTP agent 走工具回环，真在工作区动手 ---
    if (isHttpAgenticEnabled(agentId)) {
      return await this.runAgenticHttpBranch(task, agentId, text, messages, systemPrompt, thinking, effectiveResolved, opts)
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
      if (this.isAgentCancelled(task, agentId)) return { content, error: "已暂停该 Agent。" }
      const abortController = new AbortController()
      const dispatchEnvelope = this.prepareDispatchEnvelope({
        opts,
        providerId: effectiveResolved.provider.id,
        modelId: effectiveResolved.model.id,
        protocol: effectiveResolved.provider.capabilities.protocol,
        systemPrompt,
        messages,
        thinking
      })
      verifyDispatchEnvelope(dispatchEnvelope, canonicalProviderPayload({
        providerId: effectiveResolved.provider.id,
        modelId: effectiveResolved.model.id,
        protocol: effectiveResolved.provider.capabilities.protocol,
        systemPrompt,
        messages,
        thinking,
        attachments: opts.attachments || [],
        contextLayers: opts.contextLayers || []
      }))
      task.latestDispatchEnvelope = dispatchEnvelope
      await this.withAgentTimeout(task, agentId, () => this.waitForProviderStream(
        client,
        { messages, systemPrompt, thinkingOverride: thinking, signal: abortController.signal, dispatchEnvelope, attachments: opts.attachments, contextLayers: opts.contextLayers },
        {
          onContent: (delta) => {
            if (this.isAgentCancelled(task, agentId)) return
            content += delta
            this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: effectiveResolved.provider.id, modelId: effectiveModelId, upstreamModelId: effectiveUpstreamModelId, channel: "content", text: delta })
          },
          onThinking: (delta) => {
            if (this.isAgentCancelled(task, agentId)) return
            thinkingTxt += delta
            this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: effectiveResolved.provider.id, modelId: effectiveModelId, upstreamModelId: effectiveUpstreamModelId, channel: "thinking", text: delta })
          },
          onDone: (final) => {
            if (this.isAgentCancelled(task, agentId)) return
            summary = final.thinking
            usage = final.usage
          }
        }
      ), () => abortController.abort(), effectiveResolved.model.timeoutMs)
      this.throwIfAgentCancelled(task, agentId)
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
    }
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
    if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
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
    const abortController = new AbortController()
    let operationActive = true
    const canEmitOperationEvent = () => operationActive
      && !abortController.signal.aborted
      && !this.isAgentCancelled(task, agentId)
    try {
      const res = await this.withAgentTimeout(task, agentId, () => this.trackSourceOperation(runAgenticHttp({
        userText,
        messages,
        systemPrompt,
        resolved,
        thinking,
        root,
        agentId,
        policyFor: (tool, risk) => getApprovalConfig().policyForWithRisk(agentId, tool, risk ?? 'low'),
        requestApproval: (req) => this.requestApprovalFor(task, agentId, req),
        isCancelled: () => this.isAgentCancelled(task, agentId),
        signal: abortController.signal,
        lineage: this.dispatchLineage(opts),
        parentDispatchId: opts.parentDispatchId,
        attachments: opts.attachments,
        contextLayers: opts.contextLayers,
        requestUserDecision: opts.userDecisionAdapter?.forAgent(agentId, opts.signal),
        capabilityMode: opts.capabilityMode,
        onDispatchEnvelope: envelope => { task.latestDispatchEnvelope = envelope },
        tracker,
        emit: {
          delta: (channel, textDelta) => {
            if (canEmitOperationEvent()) {
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel, text: textDelta })
            }
          },
          activity: (step) => {
            if (canEmitOperationEvent()) {
              this.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
            }
          }
        }
      })), () => abortController.abort())
      operationActive = false
      this.throwIfAgentCancelled(task, agentId)
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
      if (e === AGENT_CANCELLED || e?.code === "AGENT_CANCELLED") {
        return { content: "", error: "已暂停该 Agent。" }
      }
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message, code: e?.code, durationMs: Date.now() - start })
      return { content: "", error: e.message }
    } finally {
      operationActive = false
    }
    // Note: busyCount is managed by sendToAgent, not here
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

  /**
   * Cancel every current task for a Turn and reject tasks created for the same
   * Turn later. The tombstone is written before transports are stopped so
   * synchronous stop callbacks cannot race a new dispatch admission.
   */
  preCancelTurn(turnId: string): boolean {
    const newlyCancelled = !this.cancelledTurnIds.has(turnId)
    this.cancelledTurnIds.add(turnId)
    return newlyCancelled
  }

  cancelTurn(
    turnId: string,
    options: DispatcherDecisionCancellationOptions = {}
  ): boolean | Promise<boolean> {
    const newlyCancelled = this.preCancelTurn(turnId)
    const stop = (): boolean => this.cancelTurnAfterDecision(turnId, newlyCancelled)
    if (options.decisionAlreadyCancelled || !this.decisionAdapter.cancelDecisionTurn) return stop()
    return this.decisionAdapter.cancelDecisionTurn(turnId).then(stop, stop)
  }

  private cancelTurnAfterDecision(turnId: string, newlyCancelled: boolean): boolean {
    let matched = false
    for (const task of this.tasks.values()) {
      if (task.__turnId !== turnId) continue
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") continue
      matched = true
      if (task.status === "pending") {
        task.status = "cancelled"
        task.error = "已暂停该任务。"
      } else {
        this.cancel(task.id)
      }
    }
    return newlyCancelled || matched
  }

  /**
   * Tombstones an Agent before a durable approval is settled. This is
   * intentionally side-effect free: transport stopping remains in
   * cancelAgentForTurn after decision and runtime cancellation complete.
   */
  preCancelAgentForTurn(turnId: string, agentId: string): boolean {
    const cancelled = this.cancelledAgentsByTurn.get(turnId) ?? new Set<string>()
    const newlyCancelled = !cancelled.has(agentId)
    cancelled.add(agentId)
    this.cancelledAgentsByTurn.set(turnId, cancelled)
    return newlyCancelled
  }

  /** Cancel one Agent across current and future tasks belonging to a Turn. */
  cancelAgentForTurn(
    turnId: string,
    agentId: string,
    options: DispatcherDecisionCancellationOptions = {}
  ): boolean | Promise<boolean> {
    const newlyCancelled = this.preCancelAgentForTurn(turnId, agentId)
    const stop = (): boolean => this.cancelAgentForTurnAfterDecision(turnId, agentId, newlyCancelled)
    if (options.decisionAlreadyCancelled || !this.decisionAdapter.cancelDecisionAgent) return stop()
    return this.decisionAdapter.cancelDecisionAgent(turnId, agentId).then(stop, stop)
  }

  private cancelAgentForTurnAfterDecision(
    turnId: string,
    agentId: string,
    newlyCancelled: boolean
  ): boolean {
    let matched = false
    for (const task of this.tasks.values()) {
      if (task.__turnId !== turnId) continue
      if (task.status !== "pending" && task.status !== "running") continue
      if (task.targetAgent && task.targetAgent !== agentId) continue
      matched = true
      if (task.targetAgent === agentId) {
        if (task.status === "pending") {
          task.status = "cancelled"
          task.error = "已暂停该 Agent。"
        } else {
          this.cancel(task.id)
        }
      } else if (task.status === "running") {
        this.cancelAgent(task.id, agentId)
      } else {
        this.markTaskAgentCancelled(task, agentId)
      }
    }
    return newlyCancelled || matched
  }

  cancel(taskId: string, reason = 'cancelled'): boolean {
    const task = this.tasks.get(taskId)
    if (!task || (task.status !== 'pending' && task.status !== 'running')) return false
    task.status = 'cancelled'
    task.error ||= reason
    for (const [key, stops] of [...this.activeAgentStops]) {
      if (!key.startsWith(`${taskId}:`)) continue
      for (const stop of [...stops]) stop()
    }
    return true
  }

  cancelAgent(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "running") return false
    if (!this.markTaskAgentCancelled(task, agentId)) return true
    const stops = this.activeAgentStops.get(`${taskId}:${agentId}`)
    for (const stop of [...(stops ?? [])]) {
      try { stop() } catch { /* continue cancelling the remaining transports */ }
    }
    this.emit("stream", { kind: "error", taskId, agentId, error: "已暂停该 Agent。", code: "AGENT_CANCELLED" })
    return true
  }

  private async withAgentTimeout<T>(
    task: DispatchTask,
    agentId: string,
    run: () => Promise<T>,
    onStop?: () => void | Promise<void>,
    timeoutOverrideMs?: number
  ): Promise<T> {
    this.throwIfAgentCancelled(task, agentId)
    const timeoutMs = timeoutOverrideMs && timeoutOverrideMs > 0 ? timeoutOverrideMs : getRunTimeoutMs()
    const key = `${task.id}:${agentId}`
    let timer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    return new Promise<T>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        const stops = this.activeAgentStops.get(key)
        stops?.delete(stopOperation)
        if (stops?.size === 0) this.activeAgentStops.delete(key)
        fn()
      }
      const stopOperation = () => {
        this.trackBestEffortStop(onStop)
        finish(() => reject(Object.assign(new Error("已暂停该 Agent。"), { code: "AGENT_CANCELLED" })))
      }
      const stops = this.activeAgentStops.get(key) ?? new Set<() => void>()
      stops.add(stopOperation)
      this.activeAgentStops.set(key, stops)
      if (this.isAgentCancelled(task, agentId)) {
        stopOperation()
        return
      }
      timer = setTimeout(() => {
        this.trackBestEffortStop(onStop)
        const message = `已超过超时限制（${Math.round(timeoutMs / 1000)} 秒）`
        task.errors.set(agentId, message)
        finish(() => reject(Object.assign(new Error(message), { code: "AGENT_TIMEOUT" })))
      }, timeoutMs)
      let source: Promise<T>
      try {
        this.throwIfAgentCancelled(task, agentId)
        source = run()
      } catch (error) {
        finish(() => reject(error))
        return
      }
      source.then(
        value => finish(() => this.isAgentCancelled(task, agentId)
          ? reject(this.agentCancelledError())
          : resolve(value)),
        error => finish(() => reject(error))
      )
    })
  }

  private waitForProviderStream(
    client: ReturnType<typeof buildProviderClient>,
    options: CallOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        settled = true
        options.signal?.removeEventListener("abort", onAbort)
      }
      const finish = (complete: () => void) => {
        if (settled || options.signal?.aborted) return
        settled = true
        options.signal?.removeEventListener("abort", onAbort)
        complete()
      }
      if (options.signal?.aborted) {
        settled = true
      } else {
        options.signal?.addEventListener("abort", onAbort, { once: true })
      }
      let source: Promise<void>
      try {
        source = this.trackSourceOperation(Promise.resolve(client.stream(options, {
          onContent: (delta) => {
            if (!settled && !options.signal?.aborted) callbacks.onContent?.(delta)
          },
          onThinking: (delta) => {
            if (!settled && !options.signal?.aborted) callbacks.onThinking?.(delta)
          },
          onToolCallDelta: (toolCalls) => {
            if (!settled && !options.signal?.aborted) callbacks.onToolCallDelta?.(toolCalls)
          },
          onDone: (final) => {
            finish(() => {
              callbacks.onDone?.(final)
              resolve()
            })
          },
          onError: (error) => {
            finish(() => {
              callbacks.onError?.(error)
              reject(error)
            })
          }
        })))
      } catch (error) {
        finish(() => reject(error))
        return
      }
      void source.catch(error => finish(() => reject(error)))
    })
  }

  private trackSourceOperation<T>(source: Promise<T>): Promise<T> {
    this.sourceOperations.add(source)
    void source.then(
      () => this.sourceOperations.delete(source),
      () => this.sourceOperations.delete(source)
    )
    return source
  }

  private trackBestEffortStop(stop?: () => void | Promise<void>): void {
    if (!stop) return
    try {
      const operation = stop()
      if (operation && typeof operation.then === "function") {
        void this.trackSourceOperation(Promise.resolve(operation)).catch(() => undefined)
      }
    } catch {
      // Cancellation remains best-effort, but async work must still be observed and drained.
    }
  }

  /** Emits audit-only compatibility events around the durable DecisionService request. */
  private async requestApprovalFor(
    task: DispatchTask,
    agentId: string,
    req: ApprovalRequest,
    source: 'tool' | 'acp' = 'tool'
  ): Promise<boolean> {
    if (this.isScopedAgentCancelled(task, agentId)
      || this.finishedTasks.has(task)
      || task.status === 'completed'
      || task.status === 'failed'
      || task.status === 'cancelled') {
      return false
    }
    const requestToolDecision = this.decisionAdapter.requestToolDecision
    if (!requestToolDecision) return false
    let streamRequest: ApprovalStreamRequest | null = null
    const onRequested = (requestId: string): void => {
      if (streamRequest || !requestId.trim()) return
      streamRequest = {
        id: requestId, stepId: req.stepId, tool: req.tool, toolName: req.toolName,
        label: req.label, detail: req.detail,
        action: req.action, target: req.target,
        risk: req.risk, reason: req.reason, preview: req.preview
      }
      this.emit("stream", {
        kind: "approval", taskId: task.id, agentId, status: "pending", auditOnly: true, request: streamRequest
      })
    }
    let approved = false
    try {
      approved = await requestToolDecision({
        task,
        agentId,
        request: req,
        idempotencyKey: `${source}:${task.id}:${agentId}:${req.stepId}`,
        onRequested
      })
    } catch {
      approved = false
    }
    if (!streamRequest) return false
    this.emit("stream", {
      kind: "approval",
      taskId: task.id,
      agentId,
      status: approved ? 'approved' : 'denied',
      auditOnly: true,
      request: streamRequest
    })
    return approved
  }

  /** ACP decisions preserve the exact protocol option ID while emitting audit-only compatibility events. */
  private async requestAcpDecisionFor(
    task: DispatchTask,
    agentId: string,
    permission: AcpPermissionRequest,
    audit: ApprovalRequest
  ): Promise<AcpPermissionResolution> {
    if (this.isScopedAgentCancelled(task, agentId)
      || this.finishedTasks.has(task)
      || task.status === 'completed'
      || task.status === 'failed'
      || task.status === 'cancelled'
      || permission.options.length === 0) {
      return cancelledAcpPermission()
    }
    const requestAcpPermissionDecision = this.decisionAdapter.requestAcpPermissionDecision
    if (!requestAcpPermissionDecision) return cancelledAcpPermission()

    let streamRequest: ApprovalStreamRequest | null = null
    const onRequested = (requestId: string): void => {
      if (streamRequest || !requestId.trim()) return
      streamRequest = {
        id: requestId,
        stepId: audit.stepId,
        tool: audit.tool,
        toolName: audit.toolName,
        label: audit.label,
        detail: audit.detail,
        action: audit.action,
        target: audit.target,
        risk: audit.risk,
        reason: audit.reason,
        preview: audit.preview
      }
      this.emit('stream', {
        kind: 'approval', taskId: task.id, agentId, status: 'pending', auditOnly: true, request: streamRequest
      })
    }

    let resolution: AcpPermissionResolution = cancelledAcpPermission()
    try {
      resolution = selectedAcpPermission(await requestAcpPermissionDecision({
        task,
        agentId,
        request: permission,
        idempotencyKey: `acp:${task.id}:${agentId}:${audit.stepId}`,
        onRequested
      }), permission.options)
    } catch {
      resolution = cancelledAcpPermission()
    }
    if (!streamRequest) return resolution

    const selected = resolution.outcome === 'selected'
      ? permission.options.find(option => option.optionId === resolution.optionId)
      : undefined
    this.emit('stream', {
      kind: 'approval',
      taskId: task.id,
      agentId,
      status: selected && !isDeniedAcpPermissionOption(selected) ? 'approved' : 'denied',
      auditOnly: true,
      request: streamRequest
    })
    return resolution
  }

  getTask(taskId: string): DispatchTask | undefined {
    return this.tasks.get(taskId)
  }

  private finishCancelledBeforeStart(task: DispatchTask, agentId: string, providerId?: string, modelId?: string): DispatchTask {
    const stableTaskId = this.stableTaskIds.get(task) ?? task.id
    const error = task.error || "已暂停该 Agent。"
    task.status = "cancelled"
    task.error = error
    task.errors.set(agentId, error)
    this.emit("stream", { kind: "error", taskId: stableTaskId, agentId, providerId, modelId, error, code: "AGENT_CANCELLED" })
    return this.finishTask(task, stableTaskId)
  }

  private throwTaskObserverError(taskId: string): void {
    const error = this.taskObserverErrors.get(taskId)
    if (!error) return
    this.taskObserverErrors.delete(taskId)
    throw error instanceof Error ? error : new Error(String(error))
  }

  private taskSnapshot(task: DispatchTask, stableTaskId = this.stableTaskIds.get(task) ?? task.id): DispatchTask {
    return Object.freeze({
      ...task,
      id: stableTaskId,
      results: new Map(task.results),
      errors: new Map(task.errors),
      thinking: new Map(task.thinking),
      usage: new Map(task.usage),
      thinkingSummary: new Map(task.thinkingSummary),
      createdAt: new Date(task.createdAt)
    })
  }

  private emitTaskLifecycle(event: "task:finished" | "task:removed", payload: DispatchTask | { taskId: string; reason: "delete" | "clear" | "prune" }): void {
    this.emit(event, Object.freeze({ ...payload }))
  }

  private requestTaskRemoval(taskId: string, reason: "delete" | "clear" | "prune"): void {
    const priority = { prune: 1, clear: 2, delete: 3 } as const
    const current = this.pendingTaskRemovals.get(taskId)
    if (!current || priority[reason] > priority[current]) this.pendingTaskRemovals.set(taskId, reason)
  }

  private finishTask(task: DispatchTask, stableTaskId = this.stableTaskIds.get(task) ?? task.id): DispatchTask {
    if (this.finishedTasks.has(task)) return task
    this.finishedTasks.add(task)
    if (task.status === "cancelled" && !this.cancelledTerminalTaskIds.has(stableTaskId)) {
      const error = task.error || "已暂停该 Agent。"
      this.emit("stream", {
        kind: "error",
        taskId: stableTaskId,
        agentId: task.targetAgent || "dispatcher",
        error,
        code: "AGENT_CANCELLED"
      })
    }
    this.streamMetaByTask.delete(stableTaskId)
    try {
      this.emitTaskLifecycle("task:finished", this.taskSnapshot(task, stableTaskId))
    } finally {
      this.inFlightTaskIds.delete(stableTaskId)
      const pendingRemoval = this.pendingTaskRemovals.get(stableTaskId)
      if (pendingRemoval) {
        this.pendingTaskRemovals.delete(stableTaskId)
        this.removeTask(stableTaskId, pendingRemoval)
      } else {
        this.pruneTasks()
      }
      this.cancelledTerminalTaskIds.delete(stableTaskId)
      this.taskObserverErrors.delete(stableTaskId)
      this.stableTaskIds.delete(task)
    }
    return task
  }

  private removeTask(taskId: string, reason: "delete" | "clear" | "prune"): void {
    if (!this.tasks.delete(taskId)) return
    this.pendingTaskRemovals.delete(taskId)
    this.streamMetaByTask.delete(taskId)
    this.emitTaskLifecycle("task:removed", { taskId, reason })
  }

  getRecentTasks(limit = 20): DispatchTask[] {
    this.pruneTasks()
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  /** 删除指定任务（幂等操作，不存在也不报错） */
  deleteTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    if (this.inFlightTaskIds.has(taskId)) {
      this.requestTaskRemoval(taskId, "delete")
      if (task.status === "pending") task.status = "cancelled"
      else if (task.status === "running") {
        try { this.cancel(taskId) } catch { /* non-critical */ }
      }
      return
    }
    this.removeTask(taskId, "delete")
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
      if (this.inFlightTaskIds.has(id)) this.requestTaskRemoval(id, "clear")
      else this.removeTask(id, "clear")
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
        if (this.inFlightTaskIds.has(id)) this.requestTaskRemoval(id, "prune")
        else this.removeTask(id, "prune")
      } else if (task.status === 'running' && now - task.createdAt.getTime() > ONE_HOUR) {
        if (this.inFlightTaskIds.has(id)) {
          this.requestTaskRemoval(id, "prune")
          try { this.cancel(id) } catch { /* non-critical */ }
        }
        else {
          // Force mark very old running tasks as failed and remove
          task.status = 'failed'
          this.removeTask(id, "prune")
        }
      }
    }
  }

  /** Stdio路径: 通过本地 CLI 子进程向 agent 发 prompt, 收集 stdout 作为 stream 内容.
   * oneshot 适配器（codex exec / claude --print）以进程退出为完成信号;
   * interactive 适配器保留输出静默判定; 任务被取消时 kill 子进程.
   * 注意: stdio 不依赖 HTTP provider, resolved 可为 null.
   */
  private async sendToAgentStdio(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions, resolved: any, adapter: any, binding?: any): Promise<LocalAgentSendResult> {
    if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
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
    let pendingDecisionCheckpoint: {
      state: AgentDecisionCheckpointState
      result: AgentDecisionCheckpointResult
    } | undefined
    let awaitingUserDecision = false
    let protocolEvents = Promise.resolve()
    const decisionAbortController = new AbortController()
    const stopTransport = () => {
      decisionAbortController.abort()
      return adapter.stop()
    }
    const cleanup = () => {
      decisionAbortController.abort()
      adapter.onOutput = null
      adapter.onError = null
      adapter.onActivity = null
      adapter.onUsage = null
      adapter.onProtocolEvent = null
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
      const dispatchEnvelope = this.prepareDispatchEnvelope({
        opts,
        providerId,
        modelId,
        protocol: 'stdio',
        messages: [{ role: 'user', content: agentPrompt }],
        thinking: opts.thinking
      })
      // pipeline 看到的是最终 prompt（包含工作区提示）
      this.throwIfAgentCancelled(task, agentId)
      await this.pipeline.process(agentPrompt, agentId)
      if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
      await this.withAgentTimeout(task, agentId, () => new Promise<void>((resolveP, rejectP) => {
        let lastOutputAt = Date.now()
        const onChunk = (chunk: string) => {
          if (self.isAgentCancelled(task, agentId)) return
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
          if (settled || !step || self.isAgentCancelled(task, agentId)) return
          lastOutputAt = Date.now()
          sawActivity = true
          activitySteps.push(step)
          self.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
        }
        adapter.onOutput = onChunk
        adapter.onError = onErr
        adapter.onActivity = onAct
        adapter.onUsage = (nextUsage: any) => { usage = nextUsage }
        if (adapter.protocol === 'stdio-ndjson') {
          adapter.onProtocolEvent = (event: unknown) => {
            protocolEvents = protocolEvents.then(async () => {
              if (settled || self.isAgentCancelled(task, agentId)) return
              const decisionEvent = parseAgentDecisionRequestEvent(event)
              if (!decisionEvent) return
              const continuation = adapter.decisionContinuation
              if (
                decisionEvent.continuation.mode !== continuation ||
                (continuation === 'live' && typeof adapter.resumeDecision !== 'function') ||
                (continuation === 'checkpoint' && !opts.turnId)
              ) {
                return
              }
              const checkpointState = decisionEvent.continuation.mode === 'checkpoint' && opts.turnId
                ? {
                    version: 1 as const,
                    turnId: opts.turnId,
                    threadId: opts.threadId,
                    agentId,
                    sessionId: decisionEvent.sessionId,
                    checkpointId: decisionEvent.continuation.checkpointId,
                    requestId: decisionEvent.requestId,
                    lineage: self.dispatchLineage(opts),
                    dispatchEnvelope,
                    context: {
                      prompt: agentPrompt,
                      conversationText: opts.conversationText,
                      messages: opts.messages?.map(message => ({ ...message }))
                    }
                  }
                : undefined
              awaitingUserDecision = true
              try {
                await continueAgentDecisionEvent({
                  protocol: 'stdio-ndjson',
                  event,
                  requestUserDecision: opts.userDecisionAdapter?.forAgent(agentId, decisionAbortController.signal),
                  checkpointState,
                  resumeLive: typeof adapter.resumeDecision === 'function'
                    ? result => adapter.resumeDecision(result)
                    : undefined,
                  redispatchCheckpoint: async ({ state, result }) => {
                    pendingDecisionCheckpoint = { state, result }
                    await adapter.stop()
                  }
                })
              } finally {
                awaitingUserDecision = false
              }
            }).catch(error => onErr(error instanceof Error ? error : new Error(String(error))))
          }
        }
        adapter.start().then(() => {
          if (self.isAgentCancelled(task, agentId)) {
            onErr(Object.assign(new Error("已暂停该 Agent。"), { code: "AGENT_CANCELLED" }))
            return
          }
          try {
            verifyDispatchEnvelope(dispatchEnvelope, canonicalProviderPayload({
              providerId,
              modelId,
              protocol: 'stdio',
              messages: [{ role: 'user', content: agentPrompt }],
              thinking: opts.thinking,
              attachments: opts.attachments || [],
              contextLayers: opts.contextLayers || []
            }))
            task.latestDispatchEnvelope = dispatchEnvelope
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
          const checkpointReady = pendingDecisionCheckpoint !== undefined
          const quietDone = hasOutput && idle > IDLE_AFTER_OUTPUT_MS               // 有输出后久静默 → 兜底完成
          const stalledNoOutput = spawnedOnce && !hasOutput && elapsed > STARTUP_SILENCE_MS // 始终无输出 → 卡死
          const timedOut = elapsed > TIMEOUT_MS
          const cancelled = self.isAgentCancelled(task, agentId)
          const completedTransport = !awaitingUserDecision && (procGone || checkpointReady || quietDone || stalledNoOutput)
          if (completedTransport || timedOut || cancelled) {
            settled = true
            clearInterval(poll)
            cleanup()
            if (cancelled || timedOut || stalledNoOutput) {
              this.trackBestEffortStop(stopTransport)
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
      }), stopTransport)
      this.throwIfAgentCancelled(task, agentId)
      await protocolEvents
      if (pendingDecisionCheckpoint) {
        return { content, decisionCheckpoint: pendingDecisionCheckpoint }
      }
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
      try { await stopTransport() } catch { /* noop */ }
      this.registry.setStatus(agentId, "idle")
    }
  }

  /**
   * ACP 路径：常驻 server，靠 session/prompt 的 stopReason 判完成（不像 stdio oneshot 靠进程退出）。
   * session/update 通知经 adapter.runPrompt 的 handlers 透传为 delta(content/thinking) + activity 步骤。
   * 取消：轮询 task.status，cancelled 时发 session/cancel。每轮结束 stop() 杀掉 server（第一阶段不复用）。
   */
  private async sendToAgentAcp(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions, adapter: any): Promise<{ content: string; error?: string }> {
    if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
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
    const dispatchEnvelope = this.prepareDispatchEnvelope({
      opts,
      providerId,
      modelId,
      protocol: 'acp',
      messages: [{ role: 'user', content: agentPrompt }],
      thinking: opts.thinking
    })

    const cancelPoll = setInterval(() => {
      if (this.isAgentCancelled(task, agentId)) { try { adapter.cancel() } catch { /* noop */ } }
    }, 300)

    try {
      this.throwIfAgentCancelled(task, agentId)
      await this.pipeline.process(agentPrompt, agentId)
      if (this.isAgentCancelled(task, agentId)) return { content: "", error: "已暂停该 Agent。" }
      const stopReason: string = await this.withAgentTimeout(task, agentId, () => {
        verifyDispatchEnvelope(dispatchEnvelope, canonicalProviderPayload({
          providerId,
          modelId,
          protocol: 'acp',
          messages: [{ role: 'user', content: agentPrompt }],
          thinking: opts.thinking,
          attachments: opts.attachments || [],
          contextLayers: opts.contextLayers || []
        }))
        task.latestDispatchEnvelope = dispatchEnvelope
        return adapter.runPrompt(agentPrompt, cwd, {
        onChunk: (t: string) => {
          if (this.isAgentCancelled(task, agentId)) return
          content += t
          this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: t })
        },
        onThought: (t: string) => {
          if (!this.isAgentCancelled(task, agentId)) {
            this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "thinking", text: t })
          }
        },
        onActivity: (step: any) => {
          if (!this.isAgentCancelled(task, agentId)) {
            this.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
          }
        },
        onRequestPermission: (req: any) => !shouldRequestAcpPermission(opts.capabilityMode)
          ? cancelledAcpPermission()
          : this.requestAcpPermission(task, agentId, req)
        }, mcpServers, sessionKey)
      }, () => {
        if (typeof adapter.cancelAndStopAfterGrace === "function") return adapter.cancelAndStopAfterGrace()
        try { adapter.cancel() } catch { /* noop */ }
      })
      if (this.isAgentCancelled(task, agentId)) return { content, error: "已暂停该 Agent。" }
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

  private async requestAcpPermission(
    task: DispatchTask,
    agentId: string,
    req: AcpPermissionRequest
  ): Promise<AcpPermissionResolution> {
    const permission: AcpPermissionRequest = {
      ...req,
      options: normalizeAcpPermissionOptions(req?.options)
    }
    if (this.isAgentCancelled(task, agentId)) return cancelledAcpPermission()
    if (!permission.tool) {
      return permission.readOnly ? uniquelyAllowedAcpPermission(permission.options) : cancelledAcpPermission()
    }
    const stepId = String(
      permission.raw?.toolCall?.toolCallId ||
      permission.raw?.toolCall?.id ||
      permission.raw?.toolCallId ||
      `acp-perm-${task.id}-${++this.approvalSeq}`
    )
    const tool = permission.tool as GuardedTool
    const toolName = permission.toolName || (tool === "exec" ? "exec" : "fs_write")
    const label = permission.label || toolName
    const detail = permission.detail || ""
    const rawArgs = acpPermissionArgs(permission)
    const riskToolName = tool === "exec" ? "exec" : "fs_write"
    const risk = assessApprovalRisk(riskToolName, rawArgs)
    const policy = getApprovalConfig().policyForWithRisk(agentId, tool, risk)

    if (policy === "allow") return uniquelyAllowedAcpPermission(permission.options)

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
      return cancelledAcpPermission()
    }

    this.emit("stream", {
      kind: "activity",
      taskId: task.id,
      agentId,
      step: { id: stepId, kind: "tool", tool: toolName, label, detail, status: "awaiting" }
    })
    const action: 'write_file' | 'run_command' = tool === 'exec' ? 'run_command' : 'write_file'
    const targetValue = tool === 'exec'
      ? (rawArgs.command ?? rawArgs.cmd ?? detail)
      : (rawArgs.path ?? rawArgs.file_path ?? rawArgs.filepath ?? detail)
    const target = String(targetValue || label || toolName)
    const reason = approvalReason(riskToolName, risk, target)
    const preview = detail || ''
    const resolution = await this.requestAcpDecisionFor(task, agentId, permission, {
      stepId, agentId, tool, toolName, label, detail,
      action, target, risk, reason, preview
    })
    const selected = resolution.outcome === 'selected'
      ? permission.options.find(option => option.optionId === resolution.optionId)
      : undefined
    if (!selected || isDeniedAcpPermissionOption(selected)) {
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
    return resolution
  }
}
