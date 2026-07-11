/**
 * AgentHub 原生 agentic 工具回环（HTTP 路径）。
 *
 * 把「读/写/列文件、执行命令」做成工具喂给 provider 模型，按 finishReason==='tool_calls'
 * 执行工具、回灌 role:'tool' 结果、循环，直到模型收尾或达上限/取消。每步发 activity 事件，
 * 复用既有步骤卡 UI，让纯 HTTP 模型也呈现「真在工作区动手」的全链路。
 *
 * provider 覆盖：openai-compatible / anthropic / gemini 三种线格式的工具下发与 tool_call
 * 回灌均已在 client.ts 实现，故三者都能触发 tool_calls 并进入回环。模型若不调用工具则
 * loop 第一轮即收尾（等价纯聊天，零回归）。
 */
import { buildProviderClient, ResolvedCall } from '../providers/client'
import { ChatCompletionMessage, ThinkingConfig } from '../providers/types'
import { AGENTIC_TOOLS, executeTool, ToolContext } from './tools'
import { ApprovalPolicy, ApprovalRequest, GuardedTool, guardedToolFor, assessApprovalRisk, approvalReason, type ApprovalRisk } from './approval'
import type { ExecutionTracker } from '../runtime/execution-tracker'

export interface AgenticActivityStep {
  id: string
  kind?: string
  tool?: string
  label?: string
  detail?: string
  output?: string
  status: string
}

export interface AgenticEmit {
  delta: (channel: 'content' | 'thinking', text: string) => void
  activity: (step: AgenticActivityStep) => void
}

export interface RunAgenticParams {
  /** 用户任务文本（原始） */
  userText: string
  /** Standard model conversation history. Last item should be the current user request. */
  messages?: ChatCompletionMessage[]
  /** 系统提示（dispatcher 已拼入技能注入块 + 工作区 bootstrap 项目上下文） */
  systemPrompt: string
  resolved: ResolvedCall
  thinking: ThinkingConfig
  /** 工作区根目录；null = 无工作区（降级只读，禁止写/执行） */
  root: string | null
  isCancelled: () => boolean
  signal?: AbortSignal
  emit: AgenticEmit
  maxRounds?: number
  /** 派发的 agentId（用于审批请求标注）；缺省 'agent' */
  agentId?: string
  /** 受管工具（write/exec）策略查询；缺省一律 'allow'（零回归，与 0.3.0 行为一致）。
   *  可选 risk 参数：auto 预设下用于把 high/critical 升级为 ask。 */
  policyFor?: (tool: GuardedTool, risk?: ApprovalRisk) => ApprovalPolicy
  /** 'ask' 策略时请求用户逐次审批；返回 true=放行。缺省视为拒绝（无 UI 可弹时不放行写/执行）。 */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>
  /** 可选的执行追踪器，用于记录工具调用和生成报告 */
  tracker?: ExecutionTracker
}

const DEFAULT_MAX_ROUNDS = 8

function labelFor(name: string, args: any): string {
  if (name === 'fs_read') return 'Read · ' + (args.path ?? '')
  if (name === 'fs_write') return 'Write · ' + (args.path ?? '')
  if (name === 'fs_list') return 'List · ' + (args.path ?? '.')
  if (name === 'exec') return 'Bash · ' + String(args.command ?? '').slice(0, 60)
  return name
}

function summarizeArgs(name: string, args: any): string {
  if (name === 'fs_write') {
    const content = typeof args.content === 'string' ? args.content : ''
    const preview = content.length > 1200 ? content.slice(0, 1200) + '\n... (truncated)' : content
    return [
      `Action: write file`,
      `Path: ${args.path ?? ''}`,
      `Content length: ${content.length} chars`,
      preview ? `Preview:\n${preview}` : ''
    ].filter(Boolean).join('\n')
  }
  if (name === 'exec') return [
    `Action: run command`,
    `Command: ${args.command ?? ''}`
  ].join('\n')
  if (name === 'fs_read') return `Action: read file\nPath: ${args.path ?? ''}`
  if (name === 'fs_list') return `Action: list directory\nPath: ${args.path ?? '.'}`
  return args.path ?? ''
}

export async function runAgenticHttp(p: RunAgenticParams): Promise<{ content: string; usage?: any; error?: string }> {
  const client = buildProviderClient(p.resolved)
  const ctx: ToolContext = { root: p.root || process.cwd(), readOnly: !p.root, signal: p.signal }
  const isStopped = () => p.signal?.aborted === true || p.isCancelled()
  const messages: ChatCompletionMessage[] = p.messages?.length
    ? p.messages.map(message => ({ ...message }))
    : [{ role: 'user', content: p.userText }]
  const maxRounds = p.maxRounds ?? DEFAULT_MAX_ROUNDS
  let fullContent = ''
  let lastUsage: any = undefined
  let stepSeq = 0

  for (let round = 0; round < maxRounds; round++) {
    if (isStopped()) break
    let roundContent = ''
    let toolCalls: any[] | undefined
    let finishReason: string | undefined
    try {
      let settleCallback!: () => void
      let rejectCallback!: (error: unknown) => void
      const callbackCompletion = new Promise<void>((resolve, reject) => {
        settleCallback = resolve
        rejectCallback = reject
      })
      let source: Promise<void>
      try {
        source = Promise.resolve(client.stream(
          { messages, systemPrompt: p.systemPrompt, thinkingOverride: p.thinking, tools: AGENTIC_TOOLS, toolChoice: 'auto', signal: p.signal },
          {
            onContent: (delta) => {
              if (isStopped()) return
              roundContent += delta
              p.emit.delta('content', delta)
            },
            onThinking: (delta) => {
              if (!isStopped()) p.emit.delta('thinking', delta)
            },
            onDone: (final) => {
              if (isStopped()) {
                settleCallback()
                return
              }
              finishReason = final.finishReason
              toolCalls = final.toolCalls
              if (final.usage) lastUsage = final.usage
              settleCallback()
            },
            onError: (err) => {
              if (isStopped()) settleCallback()
              else rejectCallback(err)
            }
          }
        ))
      } catch (error) {
        source = Promise.reject(error)
      }
      void source.catch(rejectCallback)
      const [callbackResult, sourceResult] = await Promise.allSettled([callbackCompletion, source])
      if (isStopped()) break
      if (callbackResult.status === 'rejected') throw callbackResult.reason
      if (sourceResult.status === 'rejected') throw sourceResult.reason
    } catch (e: any) {
      return { content: fullContent, usage: lastUsage, error: e?.message || String(e) }
    }
    fullContent += roundContent
    if (isStopped()) break

    if (finishReason === 'tool_calls' && toolCalls && toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: roundContent,
        tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function?.name, arguments: tc.function?.arguments || '{}' } }))
      })
      for (const tc of toolCalls) {
        if (isStopped()) break
        const name = tc.function?.name || 'unknown'
        let parsed: any = {}
        try { parsed = JSON.parse(tc.function?.arguments || '{}') } catch { parsed = {} }
        const stepId = 'tool-' + (++stepSeq)
        const label = labelFor(name, parsed)
        const detail = summarizeArgs(name, parsed)

        // 写/执行审批门禁：只读工具（fs_read/fs_list）guarded=null，不门禁。
        // deny/ask-denied 也要回灌一条 role:'tool' 结果，否则下一轮请求缺 tool_call 应答会 400。
        // 修正（参照 codex AskForApproval::Never）：
        //   - 'allow' 必须立即直通，绝不进入 ask 分支（"完全审核/全部允许"模式语义）
        //   - 'ask' 没有 requestApproval 回调时直接放行而非死等（避免渲染层未挂时永久 block）
        const guarded = guardedToolFor(name)
        if (guarded) {
          // 先评估风险，让 auto 预设能据此把 high/critical 升级为 ask
          const risk = assessApprovalRisk(name, parsed)
          const policy = p.policyFor ? p.policyFor(guarded, risk) : 'allow'
          if (policy === 'deny') {
            const out = `Rejected by approval policy: '${guarded}' is denied for this agent.`
            if (p.tracker) p.tracker.endTool(stepId, 'declined', out)
            p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, output: out, status: 'error' })
            messages.push({ role: 'tool', tool_call_id: tc.id, content: out })
            continue
          }
          // policy === 'allow' → 直接进入执行，与 codex Full Access / Never 一致
          if (policy === 'ask') {
            // 没有审批通道（如测试场景）按 fail-closed 处理：用户明确选了「每次询问」，
            // 缺少审批回调不应悄悄放行，而应拒绝并回灌模型让其换方式（安全侧兜底）。
            // 完整 UI 场景下 dispatcher 始终提供 requestApproval 回调，不会触发此分支。
            if (!p.requestApproval) {
              const out = 'Rejected: approval policy is "ask" but no approval channel available.'
              if (p.tracker) p.tracker.endTool(stepId, 'declined', out)
              p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, output: out, status: 'error' })
              messages.push({ role: 'tool', tool_call_id: tc.id, content: out })
              continue
            }
            // 先发 awaiting 态供步骤卡标注「等待审批」，再 await 用户决策
            p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, status: 'awaiting' })
            const target = name === 'exec' ? String((parsed as any)?.command ?? '') : String((parsed as any)?.path ?? '')
            const action: 'write_file' | 'run_command' = name === 'exec' ? 'run_command' : 'write_file'
            const preview = name === 'fs_write' ? String((parsed as any)?.content ?? '').slice(0, 2000) : target
            const reason = approvalReason(name, risk, target)
            const approved = await p.requestApproval({
              stepId, agentId: p.agentId || 'agent', tool: guarded, toolName: name,
              label, detail, action, target, risk, reason, preview
            })
            if (isStopped()) break
            if (!approved) {
              const out = 'Rejected by user (approval denied).'
              if (p.tracker) p.tracker.endTool(stepId, 'declined', out)
              p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, output: out, status: 'error' })
              messages.push({ role: 'tool', tool_call_id: tc.id, content: out })
              continue
            }
          }
        }

        if (isStopped()) break
        p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, status: 'running' })
        if (p.tracker) p.tracker.startTool(stepId, name, detail)
        const result = await executeTool(name, parsed, ctx)
        if (isStopped()) break
        if (p.tracker) {
          p.tracker.endTool(stepId, result.ok ? 'succeeded' : 'failed', result.output)
          if (name === 'fs_write' && result.ok && parsed.path) {
            p.tracker.recordFileModification(String(parsed.path))
          }
        }
        p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, output: result.output, status: result.ok ? 'done' : 'error' })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result.output })
      }
      continue
    }
    break
  }

  return { content: fullContent, usage: lastUsage }
}
