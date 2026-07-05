import { useSddDraftStore, type SddTrace } from './sdd-draft-store'

type PlanTodoSource = ThreadTodoSource & {
  kind: 'plan'
}

export function isSddPlanTodo(todo: ThreadTodo): boolean {
  const source = todo.source
  return source?.kind === 'plan' && !!source.draftId && !!source.workspaceRoot
}

export function sddPlanTodoStatusFromRuntimeEvent(event: Pick<RuntimeEvent, 'kind' | 'turnId' | 'payload'>): ThreadTodoStatus | null {
  if (event.kind !== 'turn:status') return null
  const status = event.payload?.status
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'cancelled') return 'pending'
  return null
}

export function findSddPlanTodosForRuntimeEvent(
  todos: ThreadTodo[],
  event: Pick<RuntimeEvent, 'kind' | 'turnId' | 'payload'>
): Array<{ todo: ThreadTodo; status: ThreadTodoStatus }> {
  const status = sddPlanTodoStatusFromRuntimeEvent(event)
  if (!status || !event.turnId) return []
  return todos
    .filter(todo => isSddPlanTodo(todo) && todo.source?.turnId === event.turnId && todo.status !== status)
    .map(todo => ({ todo, status }))
}

export async function persistSddPlanDispatch(todo: ThreadTodo, turnId: string): Promise<SddTrace | null> {
  const source = todo.source
  if (source?.kind !== 'plan' || !source.workspaceRoot || !source.draftId || !turnId) return null

  const trace = await window.electronAPI.sdd.getTrace(source.workspaceRoot, source.draftId)
  if (!trace) return null

  const planItem = findTracePlanItem(trace, todo)
  if (!planItem) return null

  const nextTrace: SddTrace = {
    ...trace,
    planItems: trace.planItems.map(item =>
      item === planItem
        ? { ...item, status: item.status === 'completed' ? item.status : 'in_progress', turnId }
        : item
    ),
    timestamp: new Date().toISOString()
  }

  await window.electronAPI.sdd.saveTrace(source.workspaceRoot, source.draftId, nextTrace)
  const activeDraft = useSddDraftStore.getState().activeDraft
  if (activeDraft?.id === source.draftId && activeDraft.workspaceRoot === source.workspaceRoot) {
    useSddDraftStore.getState().setTrace(nextTrace)
  }
  return nextTrace
}

export async function persistSddPlanTodoStatus(todo: ThreadTodo, status: ThreadTodoStatus): Promise<SddTrace | null> {
  const source = todo.source
  if (source?.kind !== 'plan' || !source.workspaceRoot || !source.draftId) return null

  const trace = await window.electronAPI.sdd.getTrace(source.workspaceRoot, source.draftId)
  if (!trace) return null

  const planItem = findTracePlanItem(trace, todo)
  if (!planItem) return null

  const nextPlanItems = trace.planItems.map(item =>
    item === planItem
      ? {
          ...item,
          status,
          turnId: source.turnId || item.turnId
        }
      : item
  )
  const nextTrace: SddTrace = {
    ...trace,
    planItems: nextPlanItems,
    derivedStatuses: deriveTraceStatuses(trace, nextPlanItems),
    timestamp: new Date().toISOString()
  }

  await window.electronAPI.sdd.saveTrace(source.workspaceRoot, source.draftId, nextTrace)
  const activeDraft = useSddDraftStore.getState().activeDraft
  if (activeDraft?.id === source.draftId && activeDraft.workspaceRoot === source.workspaceRoot) {
    useSddDraftStore.getState().setTrace(nextTrace)
  }
  return nextTrace
}

export async function persistSddPlanCommitEvidence(input: {
  workspaceRoot: string
  draftId: string
  planItemId: string
  commit: GitCommitDetails
  turnId?: string
  threadId?: string
}): Promise<SddTrace | null> {
  if (!input.workspaceRoot || !input.draftId || !input.planItemId || !input.commit?.sha) return null

  const trace = await window.electronAPI.sdd.getTrace(input.workspaceRoot, input.draftId)
  if (!trace) return null

  const planItemId = input.planItemId.toUpperCase()
  const nextPlanItems = trace.planItems.map(item => {
    if (item.id.toUpperCase() !== planItemId) return item
    const existing = item.commits ?? []
    const existingIndex = existing.findIndex(commit => commit.sha === input.commit.sha)
    if (existingIndex >= 0) {
      const existingCommit = existing[existingIndex]
      if (!input.threadId || existingCommit.threadId === input.threadId) return item
      return {
        ...item,
        commits: existing.map((commit, index) =>
          index === existingIndex && !commit.threadId
            ? { ...commit, threadId: input.threadId, turnId: input.turnId || commit.turnId || item.turnId }
            : commit
        )
      }
    }
    return {
      ...item,
      commits: [
        ...existing,
        {
          sha: input.commit.sha,
          shortSha: input.commit.shortSha || input.commit.sha.slice(0, 12),
          summary: input.commit.summary,
          files: input.commit.files.map(file => ({
            path: file.path,
            oldPath: file.oldPath,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions
          })),
          linkedAt: new Date().toISOString(),
          turnId: input.turnId || item.turnId,
          threadId: input.threadId
        }
      ]
    }
  })

  if (nextPlanItems === trace.planItems || nextPlanItems.every((item, index) => item === trace.planItems[index])) {
    return null
  }

  const nextTrace: SddTrace = {
    ...trace,
    planItems: nextPlanItems,
    timestamp: new Date().toISOString()
  }

  await window.electronAPI.sdd.saveTrace(input.workspaceRoot, input.draftId, nextTrace)
  const activeDraft = useSddDraftStore.getState().activeDraft
  if (activeDraft?.id === input.draftId && activeDraft.workspaceRoot === input.workspaceRoot) {
    useSddDraftStore.getState().setTrace(nextTrace)
  }
  return nextTrace
}

export async function getSddPlanDispatchGitBaseline(workspaceId: string | null, todo: ThreadTodo): Promise<Partial<ThreadTodoSource>> {
  const source = todo.source
  if (source?.kind !== 'plan' || !source.workspaceRoot || !workspaceId) return {}
  try {
    const status = await window.electronAPI.git.status(workspaceId)
    if (!status?.isRepo || !samePath(status.rootPath, source.workspaceRoot)) return {}
    const rootPath = typeof status.rootPath === 'string' ? status.rootPath : ''
    if (!rootPath) return {}
    const log = await window.electronAPI.git.log(workspaceId, 1)
    return {
      gitRootAtDispatch: rootPath,
      gitHeadAtDispatch: log.entries[0]?.sha
    }
  } catch {
    return {}
  }
}

export async function persistSddPlanCompletedTurnGitEvidence(input: {
  workspaceId: string | null
  todo: ThreadTodo
  event: Pick<RuntimeEvent, 'threadId' | 'turnId' | 'kind' | 'payload'>
}): Promise<SddTrace | null> {
  const { workspaceId, todo, event } = input
  const source = todo.source
  if (!workspaceId || event.kind !== 'turn:status' || event.payload?.status !== 'completed') return null
  if (source?.kind !== 'plan' || !source.workspaceRoot || !source.draftId || !source.planItemId || !source.turnId) return null
  if (!event.turnId || event.turnId !== source.turnId) return null
  if (event.threadId !== todo.threadId || (source.threadId && source.threadId !== event.threadId)) return null
  if (!source.gitHeadAtDispatch || !source.gitRootAtDispatch) return null

  const commits = await commitsAfterDispatchBaseline(workspaceId, source)
  let nextTrace: SddTrace | null = null
  for (const commit of commits) {
    const saved = await persistSddPlanCommitEvidence({
      workspaceRoot: source.workspaceRoot,
      draftId: source.draftId,
      planItemId: source.planItemId,
      commit,
      turnId: source.turnId,
      threadId: event.threadId
    })
    if (saved) nextTrace = saved
  }
  return nextTrace
}

async function commitsAfterDispatchBaseline(workspaceId: string, source: ThreadTodoSource): Promise<GitCommitDetails[]> {
  const status = await window.electronAPI.git.status(workspaceId).catch(() => null)
  if (!status?.isRepo || !samePath(status.rootPath, source.workspaceRoot) || !samePath(status.rootPath, source.gitRootAtDispatch)) {
    return []
  }
  const log = await window.electronAPI.git.log(workspaceId, 80).catch(() => null)
  const entries = log?.entries ?? []
  const baselineIndex = entries.findIndex(entry => entry.sha === source.gitHeadAtDispatch)
  if (baselineIndex <= 0) return []
  if (baselineIndex !== 1) return []
  const commits: GitCommitDetails[] = []
  for (const entry of entries.slice(0, baselineIndex).reverse()) {
    const details = await window.electronAPI.git.commitDetails(workspaceId, entry.sha).catch(() => null)
    if (details) commits.push(details)
  }
  return commits
}

function findTracePlanItem(trace: SddTrace, todo: ThreadTodo): SddTrace['planItems'][number] | null {
  const source = todo.source as PlanTodoSource | undefined
  const planItemId = source?.planItemId?.toUpperCase()
  if (planItemId) {
    const direct = trace.planItems.find(item => item.id.toUpperCase() === planItemId)
    if (direct) return direct
  }

  const todoText = normalizePlanText(todo.content)
  return trace.planItems.find(item => normalizePlanText(item.text) === todoText) ?? null
}

function normalizePlanText(value: string): string {
  return String(value || '')
    .replace(/^(T-\d+|P-\d+)\s*[:：]\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function samePath(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return normalizePath(left) === normalizePath(right)
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

export function deriveTraceStatuses(
  trace: SddTrace,
  planItems: SddTrace['planItems']
): SddTrace['derivedStatuses'] {
  const derived: SddTrace['derivedStatuses'] = {}
  const planStatusById = new Map(planItems.map(item => [item.id, item.status]))

  for (const block of trace.requirementBlocks) {
    const relatedPlanIds = trace.coverage[block.id] ?? []
    const relatedStatuses = relatedPlanIds
      .map(planId => planStatusById.get(planId))
      .filter((status): status is ThreadTodoStatus => !!status)
    const allCriteriaChecked = block.acceptanceCriteria.length > 0 &&
      block.acceptanceCriteria.every(criterion => criterion.checked)

    if (allCriteriaChecked) {
      derived[block.id] = 'verified'
    } else if (relatedStatuses.length > 0 && relatedStatuses.every(status => status === 'completed')) {
      derived[block.id] = 'done'
    } else if (relatedStatuses.some(status => status === 'in_progress' || status === 'completed')) {
      derived[block.id] = 'building'
    } else if (relatedStatuses.length > 0) {
      derived[block.id] = 'planned'
    } else {
      derived[block.id] = block.status
    }
  }

  return derived
}
