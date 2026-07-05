const MAX_EVENTS = 5000

type WorkbenchRuntimeEvent = {
  id?: string
  threadId: string
  turnId: string
  seq: number
  kind: string
  agentId?: string
  payload?: any
}

export type RuntimeAgentStatusUpdate = {
  agentId: string
  status: 'busy' | 'idle'
  runKey: string
}

/**
 * Merge two lists of runtime events, deduplicating by id or threadId:seq key.
 * Maintains sorted order by seq and caps at MAX_EVENTS.
 */
export function mergeRuntimeEventLists<Event extends WorkbenchRuntimeEvent>(base: Event[], incoming: Event[]): Event[] {
  if (incoming.length === 0) return base
  if (canAppendWithoutBaseScan(base, incoming)) {
    return capRuntimeEvents([...base, ...incoming])
  }
  const seen = new Set(base.map(event => event.id || `${event.threadId}:${event.seq}`))
  const additions = incoming.filter(event => {
    const key = event.id || `${event.threadId}:${event.seq}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (additions.length === 0) return base
  const last = base[base.length - 1]
  const ordered = !last || additions.every(event => event.seq > last.seq)
  const merged = ordered ? [...base, ...additions] : [...base, ...additions].sort((a, b) => a.seq - b.seq)
  return capRuntimeEvents(merged)
}

function eventDedupeKey(event: WorkbenchRuntimeEvent): string {
  return event.id || `${event.threadId}:${event.seq}`
}

function canAppendWithoutBaseScan<Event extends WorkbenchRuntimeEvent>(base: Event[], incoming: Event[]): boolean {
  const last = base[base.length - 1]
  if (!last) return false
  const seenIncoming = new Set<string>()
  for (const event of incoming) {
    if (event.seq <= last.seq) return false
    if (event.id) return false
    const key = eventDedupeKey(event)
    if (seenIncoming.has(key)) return false
    seenIncoming.add(key)
  }
  return true
}

function capRuntimeEvents<Event extends WorkbenchRuntimeEvent>(events: Event[]): Event[] {
  if (events.length > MAX_EVENTS) return events.slice(events.length - MAX_EVENTS)
  return events
}

/**
 * Check if a runtime event should be buffered (agent:delta or agent:activity).
 */
export function isBufferedRuntimeEvent(event: WorkbenchRuntimeEvent): boolean {
  return event.kind === 'agent:delta' || event.kind === 'agent:activity'
}

export function runtimeAgentStatusFromEvent(event: WorkbenchRuntimeEvent): RuntimeAgentStatusUpdate | null {
  if (event.kind !== 'agent:start' && event.kind !== 'agent:done' && event.kind !== 'agent:error') return null
  const agentId = event.agentId || event.payload?.agentId
  if (!agentId) return null
  const runKey = [
    event.turnId,
    agentId,
    event.payload?.scheduleStepId || event.payload?.taskId || event.payload?.scheduleRole || event.payload?.role || 'run'
  ].join(':')
  return {
    agentId,
    status: event.kind === 'agent:start' ? 'busy' : 'idle',
    runKey
  }
}

export function isTaskHistoryEvent(event: WorkbenchRuntimeEvent): boolean {
  return event.kind === 'turn:created' ||
    event.kind === 'turn:status' ||
    event.kind === 'agent:done' ||
    event.kind === 'agent:error' ||
    event.kind === 'agent:activity' ||
    event.kind === 'orchestrate' ||
    event.kind === 'run:created' ||
    event.kind === 'run:status'
}

/**
 * Check if this is the first stream delta for a given agent/turn/channel combination.
 * Used to trigger immediate flush on first content delta.
 */
export function shouldFlushFirstStreamDelta(event: WorkbenchRuntimeEvent, seenKeys: Set<string>): boolean {
  if (event.kind !== 'agent:delta' || event.payload?.channel === 'thinking') return false
  const key = [
    event.threadId,
    event.turnId,
    event.agentId || event.payload?.agentId || 'agent',
    event.payload?.channel || 'content'
  ].join(':')
  if (seenKeys.has(key)) return false
  seenKeys.add(key)
  return true
}
