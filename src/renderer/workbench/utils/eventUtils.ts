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

/**
 * Merge two lists of runtime events, deduplicating by id or threadId:seq key.
 * Maintains sorted order by seq and caps at MAX_EVENTS.
 */
export function mergeRuntimeEventLists<Event extends WorkbenchRuntimeEvent>(base: Event[], incoming: Event[]): Event[] {
  if (incoming.length === 0) return base
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
  if (merged.length > MAX_EVENTS) return merged.slice(merged.length - MAX_EVENTS)
  return merged
}

/**
 * Check if a runtime event should be buffered (agent:delta or agent:activity).
 */
export function isBufferedRuntimeEvent(event: WorkbenchRuntimeEvent): boolean {
  return event.kind === 'agent:delta' || event.kind === 'agent:activity'
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
