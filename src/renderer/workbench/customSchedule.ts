export type CustomScheduleTemplateKind = 'five' | 'parallel' | 'executor'

export const CUSTOMIZABLE_SCHEDULE_PRESETS: DispatchPreset[] = [
  'auto',
  'broadcast',
  'chain',
  'orchestrate',
  'lead-workers',
  'parallel-review',
  'firefly-custom',
  'custom'
]

const CORE_AGENT_PREFERENCES = ['claude', 'codex', 'minimax-code']
const EXECUTOR_PREFERENCES = ['codex', 'minimax-code', 'claude']
const SCHEDULE_ROLES = ['lead', 'worker', 'reviewer', 'synthesizer', 'target', 'router', 'executor', 'gatekeeper'] as const
const SCHEDULE_MODES = ['auto', 'broadcast', 'chain', 'orchestrate'] as const
const ARTIFACT_MODES = ['summary', 'full', 'files', 'custom'] as const
const APPROVAL_POLICIES = ['inherit', 'auto', 'ask', 'require', 'skip'] as const

type ScheduleStep = SchedulePreview['steps'][number]
type GraphValidationResult = { ok: true; errors: [] } | { ok: false; errors: string[] }

function readyAgentIds(agentIds: string[]): string[] {
  return [...new Set(agentIds.map(id => String(id || '').trim()).filter(Boolean))]
}

function pickAgent(available: string[], preferred: string[], avoid?: string): string {
  return preferred.find(id => id !== avoid && available.includes(id)) ||
    available.find(id => id !== avoid) ||
    available[0] ||
    'auto'
}

function isScheduleRole(value: unknown): value is ScheduleStep['role'] {
  return typeof value === 'string' && (SCHEDULE_ROLES as readonly string[]).includes(value)
}

function isScheduleMode(value: unknown): value is ScheduleStep['mode'] {
  return typeof value === 'string' && (SCHEDULE_MODES as readonly string[]).includes(value)
}

function normalizeStep(step: ScheduleStep): ScheduleStep {
  const dependsOn = step.dependsOn?.filter(Boolean)
  const next: ScheduleStep = {
    ...step,
    id: String(step.id || `step-${Date.now().toString(36)}`),
    label: String(step.label || step.id || 'Step'),
    agentId: String(step.agentId || 'auto'),
    role: isScheduleRole(step.role) ? step.role : 'worker',
    mode: isScheduleMode(step.mode) ? step.mode : 'auto'
  }
  if (dependsOn?.length) next.dependsOn = dependsOn
  return next
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`
}

function defaultGraphLayout(index: number): { x: number; y: number } {
  return { x: 28 + (index % 2) * 180, y: 32 + Math.floor(index / 2) * 116 }
}

export function scheduleGraphFromSteps(schedule: SchedulePreview): ScheduleGraph {
  const existingLayout = schedule.graph?.layout || {}
  const steps = (schedule.steps || []).map(normalizeStep)
  const stepIds = new Set(steps.map(step => step.id))
  const nodes = steps.map(step => {
    const graphNode = schedule.graph?.nodes.find(node => node.id === step.id)
    const node: ScheduleGraphNode = {
      id: step.id,
      label: step.label || step.labelEn || step.labelZh || step.id,
      agentId: step.agentId,
      role: step.role,
      mode: step.mode,
      approvalPolicy: graphNode?.approvalPolicy || 'inherit'
    }
    if (graphNode?.promptTemplate) node.promptTemplate = graphNode.promptTemplate
    return node
  })
  const edges = steps.flatMap(step => (step.dependsOn || [])
    .filter(dep => dep && dep !== step.id && stepIds.has(dep))
    .map(dep => ({
      id: edgeId(dep, step.id),
      from: dep,
      to: step.id,
      artifactMode: schedule.graph?.edges.find(edge => edge.from === dep && edge.to === step.id)?.artifactMode || 'summary'
    })))
  return {
    version: 1,
    nodes,
    edges,
    layout: Object.fromEntries(nodes.map((node, index) => [
      node.id,
      existingLayout[node.id] || defaultGraphLayout(index)
    ]))
  }
}

export function validateScheduleGraph(graph: ScheduleGraph | undefined | null): GraphValidationResult {
  const errors: string[] = []
  if (!graph || graph.version !== 1) {
    return { ok: false, errors: ['Schedule graph version must be 1.'] }
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) errors.push('Schedule graph needs at least one node.')
  if (!Array.isArray(graph.edges)) errors.push('Schedule graph edges must be an array.')

  const nodeIds = new Set<string>()
  for (const node of graph.nodes || []) {
    if (!node.id?.trim()) errors.push('Every graph node needs an id.')
    if (node.id && nodeIds.has(node.id)) errors.push(`Duplicate graph node id: ${node.id}`)
    if (node.id) nodeIds.add(node.id)
    if (!node.label?.trim()) errors.push(`Node ${node.id || '(unknown)'} needs a label.`)
    if (!node.agentId?.trim()) errors.push(`Node ${node.id || '(unknown)'} needs an agentId.`)
    if (!isScheduleRole(node.role)) errors.push(`Node ${node.id || '(unknown)'} has an invalid role.`)
    if (!isScheduleMode(node.mode)) errors.push(`Node ${node.id || '(unknown)'} has an invalid mode.`)
    if (node.approvalPolicy && !(APPROVAL_POLICIES as readonly string[]).includes(node.approvalPolicy)) {
      errors.push(`Node ${node.id || '(unknown)'} has an invalid approval policy.`)
    }
  }

  const edgeIds = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges || []) {
    if (!edge.id?.trim()) errors.push('Every graph edge needs an id.')
    if (edge.id && edgeIds.has(edge.id)) errors.push(`Duplicate graph edge id: ${edge.id}`)
    if (edge.id) edgeIds.add(edge.id)
    if (!nodeIds.has(edge.from)) errors.push(`Edge ${edge.id || '(unknown)'} references missing source node ${edge.from}.`)
    if (!nodeIds.has(edge.to)) errors.push(`Edge ${edge.id || '(unknown)'} references missing target node ${edge.to}.`)
    if (edge.from === edge.to) errors.push(`Edge ${edge.id || '(unknown)'} cannot point to itself.`)
    if (!(ARTIFACT_MODES as readonly string[]).includes(edge.artifactMode)) {
      errors.push(`Edge ${edge.id || '(unknown)'} has an invalid artifact mode.`)
    }
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to) {
      adjacency.set(edge.from, [...(adjacency.get(edge.from) || []), edge.to])
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const next of adjacency.get(nodeId) || []) {
      if (visit(next)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  for (const nodeId of nodeIds) {
    if (visit(nodeId)) {
      errors.push('Schedule graph cannot contain cycles.')
      break
    }
  }

  for (const nodeId of Object.keys(graph.layout || {})) {
    if (!nodeIds.has(nodeId)) errors.push(`Graph layout contains unknown node ${nodeId}.`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] }
}

function topologicalNodes(graph: ScheduleGraph): ScheduleGraphNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const incoming = new Map(graph.nodes.map(node => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to])
  }
  const queue = graph.nodes.filter(node => (incoming.get(node.id) || 0) === 0)
  const ordered: ScheduleGraphNode[] = []
  while (queue.length) {
    const node = queue.shift()!
    ordered.push(node)
    for (const nextId of outgoing.get(node.id) || []) {
      incoming.set(nextId, (incoming.get(nextId) || 0) - 1)
      if ((incoming.get(nextId) || 0) === 0) {
        const next = byId.get(nextId)
        if (next) queue.push(next)
      }
    }
  }
  return ordered.length === graph.nodes.length ? ordered : graph.nodes
}

export function compileScheduleGraph(schedule: SchedulePreview): SchedulePreview {
  const graph = schedule.graph || scheduleGraphFromSteps(schedule)
  const validation = validateScheduleGraph(graph)
  if (!validation.ok) {
    throw new Error(validation.errors[0] || 'Invalid schedule graph.')
  }
  const depsByNode = new Map<string, string[]>()
  for (const edge of graph.edges) {
    depsByNode.set(edge.to, [...(depsByNode.get(edge.to) || []), edge.from])
  }
  const steps: ScheduleStep[] = topologicalNodes(graph).map(node => {
    const step: ScheduleStep = {
      id: node.id,
      label: node.label,
      agentId: node.agentId,
      role: node.role,
      mode: node.mode
    }
    const dependsOn = depsByNode.get(node.id)
    if (dependsOn?.length) step.dependsOn = dependsOn
    return step
  })
  return { ...schedule, steps, graph }
}

export function normalizeScheduleForStorage(schedule: SchedulePreview): SchedulePreview {
  return compileScheduleGraph({
    ...schedule,
    graph: schedule.graph || scheduleGraphFromSteps(schedule)
  })
}

export function withCompiledScheduleGraph(schedule: SchedulePreview, graph: ScheduleGraph): SchedulePreview {
  return compileScheduleGraph({ ...schedule, graph })
}

export function isConcreteScheduleAgent(agentId: string | undefined | null): boolean {
  return !!agentId && agentId !== 'auto' && agentId !== 'all'
}

export function customScheduleHasRunnableSteps(schedule: SchedulePreview): boolean {
  return schedule.steps.some(step => isConcreteScheduleAgent(step.agentId))
}

export function sanitizeCustomSchedule(schedule: SchedulePreview, availableAgentIds: string[]): SchedulePreview {
  const available = readyAgentIds(availableAgentIds)
  const allowed = new Set(available)
  const fallback = available[0] || 'auto'
  const graph = schedule.graph || scheduleGraphFromSteps(schedule)
  const sanitizedGraph: ScheduleGraph = {
    ...graph,
    nodes: graph.nodes.map(node => ({
      ...node,
      agentId: isConcreteScheduleAgent(node.agentId) && allowed.has(node.agentId) ? node.agentId : fallback
    }))
  }
  return compileScheduleGraph({ ...schedule, graph: sanitizedGraph })
}

export function defaultCustomSchedule(): SchedulePreview {
  return normalizeScheduleForStorage({
    preset: 'custom',
    label: 'Custom schedule',
    labelZh: '自定义调度',
    labelEn: 'Custom schedule',
    description: 'Run with the agent nodes and dependencies you edit.',
    descriptionZh: '按照你编辑的 Agent 节点和依赖关系执行。',
    descriptionEn: 'Run with the agent nodes and dependencies you edit.',
    steps: [
      { id: 'custom-1', label: 'Implement / analyze', labelZh: '实现 / 分析', labelEn: 'Implement / analyze', agentId: 'auto', role: 'worker', mode: 'auto' },
      { id: 'custom-2', label: 'Review / synthesize', labelZh: '评审 / 汇总', labelEn: 'Review / synthesize', agentId: 'auto', role: 'reviewer', mode: 'auto', dependsOn: ['custom-1'] }
    ]
  })
}

export function defaultSmartFiveRoleSchedule(availableAgentIds: string[] = []): SchedulePreview {
  const available = readyAgentIds(availableAgentIds)
  const main = pickAgent(available, CORE_AGENT_PREFERENCES)
  const router = pickAgent(available, CORE_AGENT_PREFERENCES, main)
  const reviewer = pickAgent(available, CORE_AGENT_PREFERENCES, router)
  const executor = pickAgent(available, EXECUTOR_PREFERENCES, reviewer)
  const gatekeeper = pickAgent(available, CORE_AGENT_PREFERENCES, executor)
  return normalizeScheduleForStorage({
    preset: 'firefly-custom',
    label: 'Smart five-role',
    labelZh: '智能五角色',
    labelEn: 'Smart five-role',
    description: 'Run one agent after another: router, main, reviewer, executor, then gatekeeper releases one final answer.',
    descriptionZh: '按路由、主 Agent、评审、执行、门禁顺序运行，最后统一输出。',
    descriptionEn: 'Run one agent after another: router, main, reviewer, executor, then gatekeeper releases one final answer.',
    steps: [
      { id: 'router', label: 'Router / state', labelZh: '路由 / 状态', labelEn: 'Router / state', agentId: router, role: 'router', mode: 'auto' },
      { id: 'main', label: 'Main / chat', labelZh: '主 Agent / 对话', labelEn: 'Main / chat', agentId: main, role: 'lead', mode: 'auto', dependsOn: ['router'] },
      { id: 'reviewer', label: 'Reviewer / safety', labelZh: '评审 / 安全', labelEn: 'Reviewer / safety', agentId: reviewer, role: 'reviewer', mode: 'auto', dependsOn: ['main'] },
      { id: 'executor', label: 'Executor / actions', labelZh: '执行 / 操作', labelEn: 'Executor / actions', agentId: executor, role: 'executor', mode: 'auto', dependsOn: ['reviewer'] },
      { id: 'gatekeeper', label: 'Gatekeeper / final', labelZh: '门禁 / 最终', labelEn: 'Gatekeeper / final', agentId: gatekeeper, role: 'gatekeeper', mode: 'auto', dependsOn: ['executor'] }
    ]
  })
}

export function isStoredSchedule(value: unknown, preset?: DispatchPreset): value is SchedulePreview {
  if (!value || typeof value !== 'object') return false
  const item = value as SchedulePreview
  if (preset && item.preset !== preset) return false
  return Array.isArray(item.steps) && item.steps.every(step => !!step && typeof step.id === 'string' && typeof step.agentId === 'string')
}

export function normalizeStoredSchedule(value: unknown, preset?: DispatchPreset): SchedulePreview | null {
  if (!isStoredSchedule(value, preset)) return null
  try {
    return normalizeScheduleForStorage(value)
  } catch {
    return null
  }
}

export function normalizeStoredScheduleOverrides(value: unknown): Partial<Record<DispatchPreset, SchedulePreview>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Partial<Record<DispatchPreset, unknown>>
  const next: Partial<Record<DispatchPreset, SchedulePreview>> = {}
  for (const preset of CUSTOMIZABLE_SCHEDULE_PRESETS) {
    if (preset === 'custom' || preset === 'firefly-custom') continue
    const schedule = normalizeStoredSchedule(record[preset], preset)
    if (schedule) next[preset] = schedule
  }
  return next
}

export function buildCustomScheduleTemplate(
  kind: CustomScheduleTemplateKind,
  base: SchedulePreview,
  availableAgentIds: string[]
): SchedulePreview | null {
  const available = readyAgentIds(availableAgentIds)
  if (available.length === 0) return null

  if (kind === 'five') {
    const main = pickAgent(available, CORE_AGENT_PREFERENCES)
    const router = pickAgent(available, CORE_AGENT_PREFERENCES, main)
    const reviewer = pickAgent(available, CORE_AGENT_PREFERENCES, router)
    const executor = pickAgent(available, EXECUTOR_PREFERENCES, reviewer)
    const gatekeeper = pickAgent(available, CORE_AGENT_PREFERENCES, executor)
    return normalizeScheduleForStorage({
      ...base,
      label: 'Five-role template',
      steps: [
        { id: 'router', label: 'Router / state', agentId: router, role: 'router', mode: 'auto' },
        { id: 'main', label: 'Main / chat', agentId: main, role: 'lead', mode: 'auto', dependsOn: ['router'] },
        { id: 'reviewer', label: 'Reviewer / safety', agentId: reviewer, role: 'reviewer', mode: 'auto', dependsOn: ['main'] },
        { id: 'executor', label: 'Executor / actions', agentId: executor, role: 'executor', mode: 'auto', dependsOn: ['reviewer'] },
        { id: 'gatekeeper', label: 'Gatekeeper / final', agentId: gatekeeper, role: 'gatekeeper', mode: 'auto', dependsOn: ['executor'] }
      ]
    })
  }

  if (kind === 'parallel') {
    const first = pickAgent(available, EXECUTOR_PREFERENCES)
    const second = pickAgent(available, CORE_AGENT_PREFERENCES, first)
    const gatekeeper = pickAgent(available, CORE_AGENT_PREFERENCES, second)
    return normalizeScheduleForStorage({
      ...base,
      label: 'Parallel review template',
      steps: [
        { id: 'review-a', label: 'Review A', agentId: first, role: 'reviewer', mode: 'auto' },
        { id: 'review-b', label: 'Review B', agentId: second, role: 'reviewer', mode: 'auto' },
        { id: 'gatekeeper', label: 'Gatekeeper', agentId: gatekeeper, role: 'gatekeeper', mode: 'auto', dependsOn: ['review-a', 'review-b'] }
      ]
    })
  }

  const reviewer = pickAgent(available, CORE_AGENT_PREFERENCES)
  const executor = pickAgent(available, EXECUTOR_PREFERENCES, reviewer)
  const gatekeeper = pickAgent(available, CORE_AGENT_PREFERENCES, executor)
  return normalizeScheduleForStorage({
    ...base,
    label: 'Executor gate template',
    steps: [
      { id: 'reviewer', label: 'Risk Review', agentId: reviewer, role: 'reviewer', mode: 'auto' },
      { id: 'executor', label: 'Executor', agentId: executor, role: 'executor', mode: 'auto', dependsOn: ['reviewer'] },
      { id: 'gatekeeper', label: 'Gatekeeper', agentId: gatekeeper, role: 'gatekeeper', mode: 'auto', dependsOn: ['executor'] }
    ]
  })
}
