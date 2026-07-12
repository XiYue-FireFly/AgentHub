/* ============================================================
   编排模式端到端测试（runOrchestrate 控制流）
   用假 ProviderClient 按提示词确定性地模拟真实 LLM：
     分解→产出 JSON 计划 / 子任务→产出答案 / 校验→PASS|FAIL / 汇总→最终答案。
   既验证正常链路，也锁定失败外显契约（见 docs/DESIGN.md §8「失败外显」）。
   ============================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRegistry } from '../registry'
import { HttpAgentAdapter } from '../adapters/base'
import { ORCHESTRATOR_LEAD_SYSTEM } from '../orchestrator'

type Kind = 'decompose' | 'verify' | 'synthesis' | 'subtask'
type ReplyValue = string | { content?: string; error?: string }
type Reply = ReplyValue | Promise<ReplyValue>

type TestBinding = {
  agentId: string
  providerId?: string
  protocol?: 'http' | 'stdio-plain' | 'acp'
}

const h = vi.hoisted(() => {
  const state: {
    bindings: TestBinding[]
    responder: (c: { agentId: string; kind: Kind; prompt: string; system?: string }) => Reply
    calls: Array<{ agentId: string; kind: Kind; prompt: string; system?: string; messages?: Array<{ role: string; content: string }> }>
  } = {
    bindings: [{ agentId: 'codex' }, { agentId: 'claude' }],
    responder: () => '',
    calls: []
  }
  return { state }
})

vi.mock('../../providers/manager', () => ({
  getProviderManager: () => ({
    getBindings: () => h.state.bindings,
    getBinding: (id: string) => {
      const binding = h.state.bindings.find(b => b.agentId === id)
      return binding
        ? { ...binding, providerId: binding.providerId || 'openai', modelId: 'gpt-test' }
        : undefined
    },
    resolveBinding: (id: string) =>
      h.state.bindings.find(b => b.agentId === id)
        ? {
            provider: { id: 'openai', name: 'OpenAI', kind: 'openai' },
            model: { id: 'gpt-test', supportsThinking: false },
            binding: { agentId: id },
            thinking: { mode: 'off', level: 'medium' }
          }
        : null
  })
}))

vi.mock('../../providers/client', () => ({
  buildProviderClient: (resolved: any) => ({
    stream: (opts: any, cb: any) => {
      const agentId = resolved?.binding?.agentId
      const system: string | undefined = opts.systemPrompt
      const prompt: string = opts.messages?.[opts.messages.length - 1]?.content ?? ''
      let kind: Kind = 'subtask'
      if (system === ORCHESTRATOR_LEAD_SYSTEM) {
        if (prompt.includes('Break the following task')) kind = 'decompose'
        else if (prompt.includes('You are a strict reviewer')) kind = 'verify'
        else if (prompt.includes('Synthesize their outputs')) kind = 'synthesis'
      }
      h.state.calls.push({ agentId, kind, prompt, system, messages: opts.messages })
      Promise.resolve(h.state.responder({ agentId, kind, prompt, system })).then(r => {
        const out = typeof r === 'string' ? { content: r } : r
        if (out.error) { cb.onError?.(new Error(out.error)); return }
        if (out.content) cb.onContent?.(out.content)
        cb.onDone?.({ content: out.content ?? '', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      }, error => cb.onError?.(error))
    }
  })
}))

// 必须在 vi.mock 之后再 import 被测模块
import { Dispatcher, StreamEvent } from '../dispatcher'

function makeDispatcher() {
  const registry = new AgentRegistry()
  // HTTP 适配器 → sendToAgent 走 HTTP 路径（protocol === 'http'）
  registry.register(new HttpAgentAdapter('codex', 'Codex'), ['coding'])
  registry.register(new HttpAgentAdapter('claude', 'Claude'), ['analysis'])
  const pipeline = { process: async () => {} } as any
  const dispatcher = new Dispatcher(registry, pipeline)
  const events: StreamEvent[] = []
  dispatcher.on('stream', (e: StreamEvent) => events.push(e))
  return { dispatcher, events, registry }
}

interface LocalCallTracker {
  active: number
  maxActive: number
  calls: Array<{ agentId: string; kind: Kind; prompt: string }>
}

interface LocalReply {
  content: string
  delayMs?: number
  gate?: Promise<void>
  onCancel?: () => void
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class BusyCheckingAcpAdapter {
  binary = 'fake-acp'
  protocol = 'acp' as const
  mode = 'interactive' as const
  status: 'idle' | 'busy' | 'error' = 'idle'
  onOutput: ((chunk: string) => void) | null = null
  onError: ((error: Error) => void) | null = null
  private active = 0
  private currentCancel: (() => void) | null = null

  constructor(
    readonly id: string,
    readonly name: string,
    private tracker: LocalCallTracker,
    private responder: (call: { agentId: string; kind: Kind; prompt: string }) => LocalReply
  ) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  send(): void {}
  cancel(): void { this.currentCancel?.() }

  getLifecycle() {
    return { protocol: this.protocol, mode: this.mode, status: this.status, running: this.active > 0 }
  }

  async runPrompt(prompt: string, _cwd: string, handlers: { onChunk: (text: string) => void }): Promise<string> {
    if (this.active > 0) throw new Error(`${this.id} is busy`)
    let kind: Kind = 'subtask'
    if (prompt.includes('Break the following task')) kind = 'decompose'
    else if (prompt.includes('You are a strict reviewer')) kind = 'verify'
    else if (prompt.includes('Synthesize their outputs')) kind = 'synthesis'
    const reply = this.responder({ agentId: this.id, kind, prompt })
    this.active++
    this.status = 'busy'
    this.tracker.active++
    this.tracker.maxActive = Math.max(this.tracker.maxActive, this.tracker.active)
    this.tracker.calls.push({ agentId: this.id, kind, prompt })
    this.currentCancel = reply.onCancel || null
    try {
      if (reply.delayMs) await new Promise(resolve => setTimeout(resolve, reply.delayMs))
      if (reply.gate) await reply.gate
      handlers.onChunk(reply.content)
      return 'end_turn'
    } finally {
      this.currentCancel = null
      this.active--
      this.status = 'idle'
      this.tracker.active--
    }
  }
}

function makeLocalDispatcher(
  responder: (call: { agentId: string; kind: Kind; prompt: string }) => LocalReply,
  pipeline: { process: (prompt: string, agentId: string) => Promise<void> } = { process: async () => {} }
) {
  const registry = new AgentRegistry()
  const tracker: LocalCallTracker = { active: 0, maxActive: 0, calls: [] }
  registry.register(new BusyCheckingAcpAdapter('codex', 'Codex', tracker, responder) as any, ['coding'])
  registry.register(new BusyCheckingAcpAdapter('claude', 'Claude', tracker, responder) as any, ['analysis'])
  h.state.bindings = [
    { agentId: 'codex', providerId: 'local-cli', protocol: 'acp' },
    { agentId: 'claude', providerId: 'local-cli', protocol: 'acp' }
  ]
  const dispatcher = new Dispatcher(registry, pipeline as any)
  const events: StreamEvent[] = []
  dispatcher.on('stream', (event: StreamEvent) => events.push(event))
  return { dispatcher, events, tracker }
}

class DeferredStartStdioAdapter {
  binary = 'fake-stdio'
  protocol = 'stdio-plain' as const
  mode = 'oneshot' as const
  status: 'idle' | 'busy' | 'error' = 'idle'
  onOutput: ((chunk: string) => void) | null = null
  onError: ((error: Error) => void) | null = null
  sendCalls = 0

  constructor(
    readonly id: string,
    readonly name: string,
    private startEntered: ReturnType<typeof deferred<void>>,
    private startGate: ReturnType<typeof deferred<void>>
  ) {}

  async start(): Promise<void> {
    this.startEntered.resolve()
    await this.startGate.promise
  }

  async stop(): Promise<void> { this.status = 'idle' }
  send(): void { this.sendCalls++ }

  getLifecycle() {
    return { protocol: this.protocol, mode: this.mode, status: this.status, running: false }
  }
}

function makeDeferredStartStdioDispatcher(
  startEntered: ReturnType<typeof deferred<void>>,
  startGate: ReturnType<typeof deferred<void>>
) {
  const registry = new AgentRegistry()
  const adapter = new DeferredStartStdioAdapter('codex', 'Codex', startEntered, startGate)
  registry.register(adapter as any, ['coding'])
  h.state.bindings = [{ agentId: 'codex', providerId: 'local-cli', protocol: 'stdio-plain' }]
  const dispatcher = new Dispatcher(registry, { process: async () => {} } as any)
  const events: StreamEvent[] = []
  dispatcher.on('stream', event => events.push(event))
  return { dispatcher, adapter, events }
}

const byKind = (events: StreamEvent[], kind: string) => events.filter(e => e.kind === kind)

// 标准两子任务计划：1→codex，2→claude
const PLAN = JSON.stringify({
  subtasks: [
    { id: '1', title: '后端', detail: '写登录 API', agent: 'codex' },
    { id: '2', title: '文档', detail: '写 README', agent: 'claude' }
  ]
})

beforeEach(() => {
  h.state.bindings = [{ agentId: 'codex' }, { agentId: 'claude' }]
  h.state.calls = []
  h.state.responder = () => ''
})

describe('runOrchestrate 端到端', () => {
  it('指定 targetAgent 时强制直连，不能被 orchestrate/lead-workers 路径抢走', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ agentId }) => agentId === 'claude' ? 'Claude 直连回答' : '不应调用'

    const task = await dispatcher.dispatch('只让 Claude 回答', 'orchestrate', 'claude')

    expect(task.status).toBe('completed')
    expect(task.results.get('claude')).toBe('Claude 直连回答')
    expect(h.state.calls.map(call => call.agentId)).toEqual(['claude'])
    expect(events.some(event => event.kind.startsWith('orchestrate:'))).toBe(false)
  })

  it('正常链路：分解→并行子任务→校验通过→汇总', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind, agentId }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '最终合成结果'
      return agentId === 'codex' ? '子任务1输出' : '子任务2输出'  // subtask
    }

    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')

    expect(task.status).toBe('completed')
    // 计划事件：先空 plan 占位，再带 2 个子任务
    const plans = byKind(events, 'orchestrate:plan') as any[]
    expect(plans.length).toBeGreaterThanOrEqual(2)
    const finalPlan = plans[plans.length - 1]
    expect(finalPlan.subtasks.map((s: any) => s.id)).toEqual(['1', '2'])
    expect(finalPlan.subtasks.find((s: any) => s.id === '1').agentId).toBe('codex')
    expect(finalPlan.subtasks.find((s: any) => s.id === '2').agentId).toBe('claude')
    // 两子任务都 running→done
    const subEvents = byKind(events, 'orchestrate:subtask') as any[]
    expect(subEvents.filter(e => e.subtaskId === '1' && e.status === 'done')).toHaveLength(1)
    expect(subEvents.filter(e => e.subtaskId === '2' && e.status === 'done')).toHaveLength(1)
    // 校验通过
    const verdicts = byKind(events, 'orchestrate:verdict') as any[]
    expect(verdicts.every(v => v.pass === true)).toBe(true)
    expect(verdicts).toHaveLength(2)
    // 汇总 + 最终
    expect(byKind(events, 'orchestrate:synthesizing')).toHaveLength(1)
    const final = byKind(events, 'orchestrate:final') as any[]
    expect(final).toHaveLength(1)
    expect(final[0].content).toBe('最终合成结果')
    expect(task.results.get('orchestrate')).toBe('最终合成结果')
  })

  it('编排派生 prompt 仍保留同线程模型历史', async () => {
    const { dispatcher } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '最终合成结果'
      return '子任务输出'
    }

    await dispatcher.dispatch('继续处理登录问题', 'orchestrate', undefined, {
      conversationText: '继续处理登录问题',
      messages: [
        { role: 'user', content: '上一轮：登录按钮无响应' },
        { role: 'assistant', content: '已定位到表单提交事件。' },
        { role: 'user', content: '继续处理登录问题' }
      ]
    } as any)

    const first = h.state.calls[0]
    expect(first.messages?.map(message => message.content)).toContain('上一轮：登录按钮无响应')
    expect(first.messages?.map(message => message.content)).toContain('已定位到表单提交事件。')
    expect(first.messages?.at(-1)?.content).toContain('继续处理登录问题')
    expect(first.messages?.at(-1)?.content).toContain('Break the following task')
  })

  it('计划解析失败 → 回退为单子任务（整任务作为一个子任务）', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') return '我无法给出 JSON'  // parsePlan → null
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return 'OK'
      return '兜底子任务输出'
    }
    const task = await dispatcher.dispatch('随便做点什么', 'orchestrate')
    expect(task.status).toBe('completed')
    const finalPlan = (byKind(events, 'orchestrate:plan') as any[]).pop()
    expect(finalPlan.subtasks).toHaveLength(1)
    expect(finalPlan.subtasks[0].agentId).toBeTruthy()  // 必须被指派
  })

  it('校验未过 → 重试一次后通过（有界修复回环）', async () => {
    const { dispatcher, events } = makeDispatcher()
    let verifyCount1 = 0
    h.state.responder = ({ kind, prompt }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'synthesis') return '汇总'
      if (kind === 'verify') {
        // 仅子任务1第一次 FAIL；子任务2 一直 PASS
        if (prompt.includes('后端')) { verifyCount1++; return verifyCount1 === 1 ? 'FAIL: 缺少错误处理' : 'PASS' }
        return 'PASS'
      }
      // subtask：retryPrompt 含 "A previous attempt"
      return prompt.includes('A previous attempt') ? '修复后的输出' : '初版输出'
    }
    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    expect(task.status).toBe('completed')
    const sub1Running = (byKind(events, 'orchestrate:subtask') as any[]).filter(e => e.subtaskId === '1' && e.status === 'running')
    expect(sub1Running.length).toBe(2)  // 两次尝试
    const v1 = (byKind(events, 'orchestrate:verdict') as any[]).filter(e => e.subtaskId === '1')
    expect(v1.map(v => v.pass)).toEqual([false, true])
    expect(v1.map(v => v.attempt)).toEqual([1, 2])
  })

  it('校验两次均未过 → 子任务标记失败原因并仍进入汇总', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind, prompt }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'synthesis') return '尽力汇总'
      if (kind === 'verify') return prompt.includes('后端') ? 'FAIL: 还是不行' : 'PASS'
      return '某输出'
    }
    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    expect(task.status).toBe('completed')
    const v1 = (byKind(events, 'orchestrate:verdict') as any[]).filter(e => e.subtaskId === '1')
    expect(v1).toHaveLength(2)
    expect(v1[1]).toMatchObject({ pass: false, attempt: 2 })
    expect(byKind(events, 'orchestrate:final')).toHaveLength(1)
  })

  it('执行层将同时运行的子任务限制在明确上限内', async () => {
    const { dispatcher } = makeDispatcher()
    const fiveTaskPlan = JSON.stringify({
      subtasks: Array.from({ length: 5 }, (_, index) => ({
        id: String(index + 1),
        title: `任务 ${index + 1}`,
        detail: `执行任务 ${index + 1}`,
        agent: index % 2 === 0 ? 'codex' : 'claude'
      }))
    })
    let activeWorkers = 0
    let maxActiveWorkers = 0
    h.state.responder = async ({ kind }) => {
      if (kind === 'decompose') return fiveTaskPlan
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '汇总完成'
      activeWorkers++
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers)
      await new Promise(resolve => setTimeout(resolve, 20))
      activeWorkers--
      return '子任务输出'
    }

    const task = await dispatcher.dispatch('执行五个子任务', 'orchestrate')

    expect(task.status).toBe('completed')
    expect(maxActiveWorkers).toBeGreaterThan(1)
    expect(maxActiveWorkers).toBeLessThanOrEqual(3)
  })

  it('校验 agent 报错时保留原错误且不重新运行 worker', async () => {
    const { dispatcher, events } = makeDispatcher()
    const verifyError = 'review service unavailable'
    let workerCalls = 0
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') {
        return JSON.stringify({ subtasks: [{ id: '1', title: '实现', detail: '完成实现', agent: 'claude' }] })
      }
      if (kind === 'verify') return { error: verifyError }
      if (kind === 'synthesis') return '包含失败说明的汇总'
      workerCalls++
      return 'worker 输出'
    }

    const task = await dispatcher.dispatch('完成一项实现', 'orchestrate')

    expect(workerCalls).toBe(1)
    expect(task.errors.get('codex')).toBe(verifyError)
    const workerTerminals = (byKind(events, 'orchestrate:subtask') as any[]).filter(event => (
      event.subtaskId === '1' && (event.status === 'done' || event.status === 'error')
    ))
    expect(workerTerminals.filter(event => event.status === 'done')).toHaveLength(1)
    expect(workerTerminals.filter(event => event.status === 'error')).toHaveLength(0)
  })

  it('同一 local agent 的两个子任务串行完成且 verifier 共用该队列', async () => {
    const sameAgentPlan = JSON.stringify({
      subtasks: [
        { id: '1', title: '任务一', detail: '执行一', agent: 'codex' },
        { id: '2', title: '任务二', detail: '执行二', agent: 'codex' }
      ]
    })
    const { dispatcher, events, tracker } = makeLocalDispatcher(({ kind }) => {
      if (kind === 'decompose') return { content: sameAgentPlan }
      if (kind === 'verify') return { content: 'PASS', delayMs: 10 }
      if (kind === 'synthesis') return { content: '本地汇总' }
      return { content: '本地子任务输出', delayMs: 15 }
    })

    const task = await dispatcher.dispatch('让同一个本地 agent 完成两项任务', 'orchestrate')

    const done = (byKind(events, 'orchestrate:subtask') as any[]).filter(event => event.status === 'done')
    expect(done.map(event => event.subtaskId).sort()).toEqual(['1', '2'])
    expect(tracker.calls.filter(call => call.kind === 'subtask')).toHaveLength(2)
    expect(tracker.calls.filter(call => call.kind === 'verify')).toHaveLength(2)
    expect(tracker.maxActive).toBe(1)
    expect(task.errors.size).toBe(0)
  })

  it('不同 local agent 保持并行且并发 verifier 不会收到 busy', async () => {
    const localPlan = JSON.stringify({
      subtasks: [
        { id: '1', title: '任务一', detail: '执行一', agent: 'codex' },
        { id: '2', title: '任务二', detail: '执行二', agent: 'claude' }
      ]
    })
    const { dispatcher, events, tracker } = makeLocalDispatcher(({ agentId, kind }) => {
      if (kind === 'decompose') return { content: localPlan }
      if (kind === 'verify') return { content: 'PASS', delayMs: 50 }
      if (kind === 'synthesis') return { content: '本地汇总' }
      return { content: `${agentId} 子任务输出`, delayMs: agentId === 'codex' ? 10 : 25 }
    })

    const task = await dispatcher.dispatch('让两个本地 agent 并行完成任务', 'orchestrate')

    expect(tracker.maxActive).toBeGreaterThanOrEqual(2)
    expect(tracker.calls.filter(call => call.kind === 'subtask' && call.agentId === 'codex')).toHaveLength(1)
    expect(tracker.calls.filter(call => call.kind === 'subtask' && call.agentId === 'claude')).toHaveLength(1)
    expect(tracker.calls.filter(call => call.kind === 'verify')).toHaveLength(2)
    expect((byKind(events, 'orchestrate:verdict') as any[]).filter(event => event.pass)).toHaveLength(2)
    expect(task.errors.size).toBe(0)
  })

  it('任务取消后不把同一 local agent 队列中的下一子任务交给 adapter', async () => {
    const firstWorkerGate = deferred<void>()
    const firstWorkerEntered = deferred<void>()
    const bothWorkersQueued = deferred<void>()
    const sameAgentPlan = JSON.stringify({
      subtasks: [
        { id: '1', title: '任务一', detail: '执行一', agent: 'codex' },
        { id: '2', title: '任务二', detail: '执行二', agent: 'codex' }
      ]
    })
    let workerCalls = 0
    const { dispatcher, tracker, events } = makeLocalDispatcher(({ kind }) => {
      if (kind === 'decompose') return { content: sameAgentPlan }
      if (kind === 'verify') return { content: 'PASS' }
      if (kind === 'synthesis') return { content: '不应汇总' }
      workerCalls++
      if (workerCalls === 1) {
        firstWorkerEntered.resolve()
        return {
          content: '第一个输出',
          gate: firstWorkerGate.promise,
          onCancel: () => firstWorkerGate.resolve()
        }
      }
      return { content: '第二个输出' }
    })
    let taskId = ''
    let runningWorkers = 0
    dispatcher.on('task:created', task => { taskId = task.id })
    dispatcher.on('stream', event => {
      if (event.kind === 'orchestrate:subtask' && event.status === 'running') {
        runningWorkers++
        if (runningWorkers === 2) bothWorkersQueued.resolve()
      }
    })

    const dispatchPromise = dispatcher.dispatch('测试取消本地队列', 'orchestrate')
    await firstWorkerEntered.promise
    await bothWorkersQueued.promise
    expect(dispatcher.cancel(taskId)).toBe(true)
    firstWorkerGate.resolve()
    const task = await dispatchPromise

    const adapterWorkerCalls = tracker.calls.filter(call => call.kind === 'subtask')
    expect(task.status).toBe('cancelled')
    expect(adapterWorkerCalls).toHaveLength(1)
    expect(events.filter(event => event.taskId === taskId && event.kind === 'error' && event.code === 'AGENT_CANCELLED')).toHaveLength(1)
    expect(adapterWorkerCalls[0].prompt).toContain('执行一')
  })

  it('任务在 local pipeline 中取消后不再调用 ACP adapter', async () => {
    const pipelineEntered = deferred<void>()
    const pipelineGate = deferred<void>()
    const workerMarker = 'PIPELINE-CANCEL-WORKER'
    const plan = JSON.stringify({
      subtasks: [{ id: '1', title: '等待任务', detail: workerMarker, agent: 'codex' }]
    })
    const pipeline = {
      process: async (prompt: string) => {
        if (!prompt.includes(workerMarker)) return
        pipelineEntered.resolve()
        await pipelineGate.promise
      }
    }
    const { dispatcher, tracker, events } = makeLocalDispatcher(({ kind }) => {
      if (kind === 'decompose') return { content: plan }
      if (kind === 'verify') return { content: 'PASS' }
      if (kind === 'synthesis') return { content: '不应汇总' }
      return { content: '不应进入 adapter' }
    }, pipeline)
    let taskId = ''
    dispatcher.on('task:created', task => { taskId = task.id })

    const dispatchPromise = dispatcher.dispatch('测试 pipeline 取消竞态', 'orchestrate')
    await pipelineEntered.promise
    expect(dispatcher.cancel(taskId)).toBe(true)
    pipelineGate.resolve()
    const task = await dispatchPromise

    expect(task.status).toBe('cancelled')
    expect(tracker.calls.filter(call => call.kind === 'subtask')).toHaveLength(0)
    expect(events.filter(event => event.taskId === taskId && event.kind === 'error' && event.code === 'AGENT_CANCELLED')).toHaveLength(1)
  })

  it('stdio adapter start 尚未完成时取消任务不会继续 send', async () => {
    vi.useFakeTimers()
    try {
      const startEntered = deferred<void>()
      const startGate = deferred<void>()
      const { dispatcher, adapter, events } = makeDeferredStartStdioDispatcher(startEntered, startGate)
      let taskId = ''
      dispatcher.on('task:created', task => { taskId = task.id })

      const dispatchPromise = dispatcher.dispatch('测试 stdio start 取消竞态', 'auto', 'codex')
      await startEntered.promise
      expect(dispatcher.cancel(taskId)).toBe(true)
      startGate.resolve()
      const task = await dispatchPromise
      await vi.advanceTimersByTimeAsync(250)

      expect(task.status).toBe('cancelled')
      expect(adapter.sendCalls).toBe(0)
      expect(events.filter(event => event.taskId === taskId && event.kind === 'error' && event.code === 'AGENT_CANCELLED')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // ---- 失败外显契约（docs/DESIGN.md §8）----

  it('子任务 provider 报错 → 必须发 orchestrate:subtask error（不得伪装成 done 空内容）', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind, agentId }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return '汇总'
      // 子任务1（codex）执行时 provider 报错
      if (agentId === 'codex') return { error: 'HTTP 401 Unauthorized' }
      return '子任务2输出'
    }
    await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    const sub1 = (byKind(events, 'orchestrate:subtask') as any[]).filter(e => e.subtaskId === '1')
    // 失败外显：子任务1必须出现 error 状态，且不得出现 done（空内容）伪装成功
    expect(sub1.some(e => e.status === 'error')).toBe(true)
    expect(sub1.some(e => e.status === 'done')).toBe(false)
  })

  it('未绑定任何 agent → 必须发 orchestrate:error 且任务失败', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.bindings = []
    const task = await dispatcher.dispatch('做点事', 'orchestrate')
    expect(task.status).toBe('failed')
    expect(byKind(events, 'orchestrate:error')).toHaveLength(1)
  })

  it('汇总阶段 provider 报错 → 不得静默以空内容标记完成', async () => {
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') return PLAN
      if (kind === 'verify') return 'PASS'
      if (kind === 'synthesis') return { error: 'HTTP 500' }
      return '子任务输出'
    }
    const task = await dispatcher.dispatch('修复登录 bug 并写文档', 'orchestrate')
    // 汇总失败应外显为 error，而非 completed + 空 final
    const finals = byKind(events, 'orchestrate:final') as any[]
    const errs = byKind(events, 'orchestrate:error') as any[]
    expect(errs.length === 1 || (finals.length === 1 && finals[0].content.length > 0)).toBe(true)
    if (errs.length) expect(task.status).toBe('failed')
  })

  it('preserves cancellation when orchestrate is cancelled during decomposition', async () => {
    const decompositionEntered = deferred<void>()
    const decompositionGate = deferred<ReplyValue>()
    const { dispatcher, events } = makeDispatcher()
    h.state.responder = ({ kind }) => {
      if (kind === 'decompose') {
        decompositionEntered.resolve()
        return decompositionGate.promise
      }
      return ''
    }
    let taskId = ''
    dispatcher.on('task:created', task => { taskId = task.id })

    const running = dispatcher.dispatch('cancel during decomposition', 'orchestrate')
    await decompositionEntered.promise
    expect(dispatcher.cancel(taskId)).toBe(true)
    decompositionGate.resolve(PLAN)
    const task = await running
    await dispatcher.stopAndDrain()

    expect(task.status).toBe('cancelled')
    expect(events.filter(event => event.taskId === taskId && event.kind === 'error' && event.code === 'AGENT_CANCELLED')).toHaveLength(1)
  })

  it('keeps scoped agent cancellation tombstoned across queued roles without stopping another agent', async () => {
    const codexGate = deferred<void>()
    const codexEntered = deferred<void>()
    const claudeGate = deferred<void>()
    const claudeEntered = deferred<void>()
    const queuedCodexRole = deferred<void>()
    const plan = JSON.stringify({
      subtasks: [
        { id: 'codex-worker', title: 'Codex worker', detail: 'CODEX-FIRST', agent: 'codex' },
        { id: 'codex-reviewer', title: 'Codex reviewer', detail: 'CODEX-QUEUED', agent: 'codex' },
        { id: 'claude-worker', title: 'Claude worker', detail: 'CLAUDE-CONTINUES', agent: 'claude' }
      ]
    })
    let codexWorkerCalls = 0
    const { dispatcher, tracker, events } = makeLocalDispatcher(({ agentId, kind }) => {
      if (kind === 'decompose') return { content: plan }
      if (kind === 'verify') return { content: 'PASS' }
      if (kind === 'synthesis') return { content: 'summary' }
      if (agentId === 'codex') {
        codexWorkerCalls++
        if (codexWorkerCalls === 1) {
          codexEntered.resolve()
          return { content: 'first codex output', gate: codexGate.promise, onCancel: () => codexGate.resolve() }
        }
        return { content: 'later codex output' }
      }
      claudeEntered.resolve()
      return { content: 'claude output', gate: claudeGate.promise }
    })
    let codexRunningRoles = 0
    dispatcher.on('stream', event => {
      if (event.kind === 'orchestrate:subtask' && event.agentId === 'codex' && event.status === 'running') {
        codexRunningRoles++
        if (codexRunningRoles === 2) queuedCodexRole.resolve()
      }
    })

    const turnId = 'turn-scoped-agent-cancel'
    const running = dispatcher.dispatch(
      'scoped cancel with queued role',
      'orchestrate',
      undefined,
      { turnId }
    )
    await Promise.all([codexEntered.promise, claudeEntered.promise, queuedCodexRole.promise])
    const eventCountAtCancel = events.length
    expect(dispatcher.cancelAgentForTurn(turnId, 'codex')).toBe(true)
    claudeGate.resolve()
    codexGate.resolve()
    await running

    expect(codexWorkerCalls).toBe(1)
    expect(tracker.calls.filter(call => call.kind === 'subtask' && call.agentId === 'codex')).toHaveLength(1)
    expect(tracker.calls.filter(call => call.kind === 'subtask' && call.agentId === 'claude')).toHaveLength(1)
    const cancelledSubtaskTerminals = events.slice(eventCountAtCancel).filter((event): event is Extract<StreamEvent, { kind: 'orchestrate:subtask' }> => (
      event.kind === 'orchestrate:subtask'
      && event.agentId === 'codex'
      && event.status === 'error'
    ))
    expect(cancelledSubtaskTerminals.map(event => event.subtaskId).sort()).toEqual([
      'codex-reviewer',
      'codex-worker'
    ])
    expect(cancelledSubtaskTerminals.every(event => event.content === '已暂停该 Agent。')).toBe(true)
    expect(events.slice(eventCountAtCancel).filter(event => (
      event.kind === 'orchestrate:subtask'
      && event.agentId === 'codex'
      && event.status === 'done'
    ))).toHaveLength(0)
    expect(events.slice(eventCountAtCancel).filter(event => (
      'agentId' in event
      && event.agentId === 'codex'
      && ['start', 'delta', 'activity', 'done'].includes(event.kind)
    ))).toHaveLength(0)
    expect(events.some(event => (
      'agentId' in event && event.agentId === 'claude' && event.kind === 'done'
    ))).toBe(true)
    expect(events.some(event => (
      event.kind === 'orchestrate:subtask'
      && event.agentId === 'claude'
      && event.status === 'done'
    ))).toBe(true)

    const future = await dispatcher.dispatch(
      'future codex task',
      'auto',
      'codex',
      { turnId: 'turn-future-codex' }
    )
    expect(future.status).toBe('completed')
    expect(codexWorkerCalls).toBe(2)
  })

  it('does not turn a completed sibling worker into error when the lead verifier is cancelled', async () => {
    const verifierEntered = deferred<void>()
    const verifierGate = deferred<void>()
    const plan = JSON.stringify({
      subtasks: [
        { id: 'claude-worker', title: 'Claude worker', detail: 'CLAUDE-COMPLETES', agent: 'claude' }
      ]
    })
    const { dispatcher, events } = makeLocalDispatcher(({ agentId, kind }) => {
      if (kind === 'decompose') return { content: plan }
      if (kind === 'verify') {
        verifierEntered.resolve()
        return { content: 'PASS', gate: verifierGate.promise, onCancel: () => verifierGate.resolve() }
      }
      if (kind === 'synthesis') return { content: 'should not synthesize' }
      return { content: `${agentId} worker output` }
    })
    const turnId = 'turn-cancel-lead-during-verify'

    const running = dispatcher.dispatch(
      'cancel lead after sibling completion',
      'orchestrate',
      undefined,
      { turnId }
    )
    await verifierEntered.promise
    expect(dispatcher.cancelAgentForTurn(turnId, 'codex')).toBe(true)
    verifierGate.resolve()
    const task = await running

    const siblingTerminals = events.filter((event): event is Extract<StreamEvent, { kind: 'orchestrate:subtask' }> => (
      event.kind === 'orchestrate:subtask'
      && event.subtaskId === 'claude-worker'
      && (event.status === 'done' || event.status === 'error')
    ))
    expect(siblingTerminals.filter(event => event.status === 'done')).toHaveLength(1)
    expect(siblingTerminals.filter(event => event.status === 'error')).toHaveLength(0)
    expect(events.filter(event => (
      event.kind === 'error'
      && event.agentId === 'codex'
      && event.code === 'AGENT_CANCELLED'
    ))).toHaveLength(1)
    expect(task.errors.get('codex')).toBe('已暂停该 Agent。')
    expect(task.status).toBe('failed')
  })

  it('tombstones a cancelled Turn before later tasks can attach to it', async () => {
    const codexGate = deferred<void>()
    const codexEntered = deferred<void>()
    let codexCalls = 0
    let claudeCalls = 0
    const { dispatcher } = makeLocalDispatcher(({ agentId }) => {
      if (agentId === 'codex') {
        codexCalls++
        codexEntered.resolve()
        return {
          content: 'cancelled codex output',
          gate: codexGate.promise,
          onCancel: () => codexGate.resolve()
        }
      }
      claudeCalls++
      return { content: 'future claude output' }
    })
    const turnId = 'turn-cancel-before-attach'

    const first = dispatcher.dispatch('first task', 'auto', 'codex', { turnId })
    await codexEntered.promise
    expect(dispatcher.cancelTurn(turnId)).toBe(true)
    codexGate.resolve()
    expect((await first).status).toBe('cancelled')

    await expect(dispatcher.dispatch('late task', 'auto', 'claude', { turnId }))
      .rejects.toMatchObject({ code: 'AGENT_CANCELLED' })
    expect(codexCalls).toBe(1)
    expect(claudeCalls).toBe(0)

    const future = await dispatcher.dispatch(
      'future Turn task',
      'auto',
      'claude',
      { turnId: 'turn-after-cancel' }
    )
    expect(future.status).toBe('completed')
    expect(claudeCalls).toBe(1)
  })

  it('does not poison another target task when cancelling one Agent for a Turn', async () => {
    const codexGate = deferred<void>()
    const codexEntered = deferred<void>()
    const claudeGate = deferred<void>()
    const claudeEntered = deferred<void>()
    const { dispatcher, events } = makeLocalDispatcher(({ agentId }) => {
      if (agentId === 'codex') {
        codexEntered.resolve()
        return {
          content: 'cancelled codex output',
          gate: codexGate.promise,
          onCancel: () => codexGate.resolve()
        }
      }
      claudeEntered.resolve()
      return { content: 'claude survives', gate: claudeGate.promise }
    })
    const turnId = 'turn-scoped-cross-target'
    const codexTask = dispatcher.dispatch('codex role', 'auto', 'codex', { turnId })
    const claudeTask = dispatcher.dispatch('claude role', 'auto', 'claude', { turnId })
    await Promise.all([codexEntered.promise, claudeEntered.promise])

    expect(dispatcher.cancelAgentForTurn(turnId, 'codex')).toBe(true)
    claudeGate.resolve()
    codexGate.resolve()
    const [codex, claude] = await Promise.all([codexTask, claudeTask])

    expect(codex.status).toBe('cancelled')
    expect(claude.status).toBe('completed')
    expect(claude.results.get('claude')).toBe('claude survives')
    expect(claude.errors.has('codex')).toBe(false)
    expect(events.some(event => (
      event.taskId === claude.id
      && 'agentId' in event
      && event.agentId === 'codex'
    ))).toBe(false)

    await expect(dispatcher.dispatch('late codex role', 'auto', 'codex', { turnId }))
      .rejects.toMatchObject({ code: 'AGENT_CANCELLED' })
    expect((await dispatcher.dispatch(
      'codex on future Turn',
      'auto',
      'codex',
      { turnId: 'turn-scoped-cross-target-future' }
    )).status).toBe('completed')
  })
})
