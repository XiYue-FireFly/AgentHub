import type { PendingDecision } from '../../../shared/decision-contract'
import { runtimeDecisionItem, type DecisionItem } from './decisionAdapters'

export function reconcileDecisionQueue(
  current: readonly DecisionItem[],
  authoritative: readonly PendingDecision[]
): DecisionItem[] {
  const drafts = current.filter((item): item is Extract<DecisionItem, { origin: 'draft' }> => item.origin === 'draft')
  const runtime = authoritative.flatMap(pending => {
    const item = runtimeDecisionItem(pending)
    return item ? [item] : []
  })
  return sortDecisionItems([...drafts, ...runtime])
}

export function selectActiveDecision(
  items: readonly DecisionItem[],
  threadId: string | null | undefined
): DecisionItem | null {
  if (!threadId) return null
  const activeItems = sortDecisionItems(items)
    .filter(item => item.threadId === threadId && item.state === 'active')
  return activeItems.find(item => item.origin === 'runtime') ?? activeItems[0] ?? null
}

export function pendingCountsByThread(items: readonly DecisionItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    if (item.state !== 'terminal') counts[item.threadId] = (counts[item.threadId] ?? 0) + 1
    return counts
  }, {})
}

function sortDecisionItems(items: readonly DecisionItem[]): DecisionItem[] {
  return [...items].sort((left, right) => (
    left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  ))
}
