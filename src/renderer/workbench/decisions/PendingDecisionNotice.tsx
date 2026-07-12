import React from 'react'

export function PendingDecisionNotice({
  view,
  count,
  threadId,
  onOpenThread
}: {
  view: string
  count: number
  threadId: string | null
  onOpenThread: (threadId: string) => void
}) {
  if (view === 'chat' || count < 1 || !threadId) return null
  return (
    <div className="wb-pending-decision-notice" role="status" aria-live="polite">
      <span>{count} pending decision{count === 1 ? '' : 's'}</span>
      <button type="button" onClick={() => onOpenThread(threadId)}>Open decision in chat</button>
    </div>
  )
}
