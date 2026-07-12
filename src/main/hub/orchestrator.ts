/* ============================================================
   编排模式（Orchestrator）— 纯函数 helper
   lead agent 把请求分解为子任务 → 各 agent 执行 → lead 汇总。
   这里只放可单测的纯逻辑（提示词构造 + 计划解析）；编排控制流在 dispatcher.runOrchestrate。
   ============================================================ */

export interface PlanSubtask {
  id: string
  title: string
  detail?: string
  /** lead 建议的 agent（可选；dispatcher 会用 routeScores 兜底指派） */
  agentId?: string
}

export interface OrchestratePlan {
  subtasks: PlanSubtask[]
}

const KNOWN_AGENTS = ['codex', 'claude', 'hermes', 'openclaw', 'marvis', 'minimax-code']
export const MAX_ORCHESTRATE_SUBTASKS = 5
const MAX_PLAN_ID_LENGTH = 64
const MAX_PLAN_TITLE_LENGTH = 80
const MAX_PLAN_DETAIL_LENGTH = 4000
const MAX_PLAN_AGENT_ID_LENGTH = 64

/** lead 分解/汇总时的系统提示 */
export const ORCHESTRATOR_LEAD_SYSTEM =
  'You are the lead orchestrator agent in AgentHub. You break a user request into a small set of concrete, ' +
  'independent subtasks that specialist agents can each handle, then synthesize their outputs into one answer. ' +
  'Be concise and practical.'

/** 让 lead 输出 JSON 计划的用户消息 */
export function decompositionPrompt(userText: string, agents: string[] = KNOWN_AGENTS): string {
  return [
    'Break the following task into 2-5 concrete subtasks that specialist agents can work on independently.',
    'Available agents: ' + agents.join(', ') + '.',
    'Reply with ONLY a JSON object (no prose, no markdown fences) of the form:',
    '{"subtasks":[{"id":"1","title":"short title","detail":"what to do","agent":"<one of the agents, or omit>"}]}',
    '',
    'TASK:',
    userText
  ].join('\n')
}

/** 从 lead 输出中稳健解析计划：剥离 ``` 代码围栏、截取首个 {…}、校验 subtasks。失败返回 null。 */
export function parsePlan(raw: string, knownAgents: string[] = KNOWN_AGENTS): OrchestratePlan | null {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: any
  try { obj = JSON.parse(s.slice(start, end + 1)) } catch { return null }
  const arr = Array.isArray(obj?.subtasks) ? obj.subtasks : null
  if (!arr || arr.length === 0) return null
  const subtasks: PlanSubtask[] = []
  const seenRawIds = new Set<string>()
  const usedIds = new Set<string>()
  for (let i = 0; i < arr.length && subtasks.length < MAX_ORCHESTRATE_SUBTASKS; i++) {
    const x = arr[i]
    const rawId = String(x?.id ?? i + 1).trim() || String(i + 1)
    if (seenRawIds.has(rawId)) continue
    const agentRaw = (typeof x?.agent === 'string' ? x.agent : (typeof x?.agentId === 'string' ? x.agentId : ''))
      .trim()
      .slice(0, MAX_PLAN_AGENT_ID_LENGTH)
    const detail = (typeof x?.detail === 'string' ? x.detail : (typeof x?.title === 'string' ? x.title : ''))
      .slice(0, MAX_PLAN_DETAIL_LENGTH)
    const title = String(x?.title ?? detail ?? ('Subtask ' + (i + 1))).slice(0, MAX_PLAN_TITLE_LENGTH)
    if (!detail && !title) continue
    let id = rawId.slice(0, MAX_PLAN_ID_LENGTH)
    for (let collision = 2; usedIds.has(id); collision++) {
      const suffix = `~${collision}`
      id = rawId.slice(0, MAX_PLAN_ID_LENGTH - suffix.length) + suffix
    }
    seenRawIds.add(rawId)
    usedIds.add(id)
    subtasks.push({
      id,
      title,
      detail,
      agentId: knownAgents.includes(agentRaw) ? agentRaw : undefined
    })
  }
  return subtasks.length ? { subtasks } : null
}

/** lead 汇总各子任务输出的用户消息 */
export function synthesisPrompt(
  userText: string,
  parts: Array<{ title: string; agentId?: string; content: string; error?: string }>
): string {
  const blocks = parts.map((p, i) =>
    `### 子任务 ${i + 1}: ${p.title}${p.agentId ? ' [' + p.agentId + ']' : ''}\n` +
    (p.error ? '(执行失败: ' + p.error + ')' : (p.content || '(无输出)'))
  ).join('\n\n')
  return [
    'You orchestrated the subtasks below for the user request. Synthesize their outputs into one coherent final answer. ' +
    'Resolve overlaps and note any failures briefly. Answer in the user\'s language.',
    '',
    'USER REQUEST:',
    userText,
    '',
    'SUBTASK RESULTS:',
    blocks
  ].join('\n')
}

/** 让 verify agent 判定子任务结果是否达成目标的提示（要求单行 PASS / FAIL:原因） */
export function verifyPrompt(title: string, detail: string | undefined, result: string): string {
  return [
    'You are a strict reviewer. Decide whether the RESULT adequately accomplishes the SUBTASK.',
    'Reply with ONLY one line: "PASS" if it does, or "FAIL: <short reason>" if it does not.',
    '',
    'SUBTASK: ' + title + (detail ? ' — ' + detail : ''),
    '',
    'RESULT:',
    result || '(empty)'
  ].join('\n')
}

/** 解析 verify 输出：显式 PASS→通过；含 FAIL→不通过(带原因);其他模糊输出默认不通过（安全优先）。 */
export function parseVerdict(raw: string): { pass: boolean; note?: string } {
  const s = (raw || '').trim()
  if (/^\s*PASS\b/i.test(s)) return { pass: true }
  const fm = s.match(/FAIL\s*[:：]?\s*(.{0,200})/i)
  if (fm) return { pass: false, note: (fm[1] || '').trim() || undefined }
  return { pass: false, note: 'ambiguous verify output' }
}

/** 重试时把上一次失败原因拼到子任务提示前，引导修复 */
export function retryPrompt(detail: string, note: string | undefined): string {
  return [
    'A previous attempt at this subtask was judged inadequate' + (note ? (': ' + note) : '') + '.',
    'Redo it, fixing that problem.',
    '',
    detail
  ].join('\n')
}
