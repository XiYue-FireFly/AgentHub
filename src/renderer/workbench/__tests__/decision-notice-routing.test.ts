import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('global pending-decision notice routing', () => {
  it('derives the non-Chat notice from the oldest global nonterminal decision', () => {
    const layout = readFileSync(join(process.cwd(), 'src/renderer/workbench/WorkbenchLayout.tsx'), 'utf8')
    const content = readFileSync(join(process.cwd(), 'src/renderer/workbench/WorkbenchMainContent.tsx'), 'utf8')

    expect(layout).toContain('const pendingDecisions = useMemo')
    expect(layout).toContain('const oldestPendingDecision = pendingDecisions[0] ?? null')
    expect(layout).toContain('pendingDecisionItem={oldestPendingDecision}')
    expect(layout).toContain('pendingDecisionCount={pendingDecisions.length}')
    expect(layout).toContain('await selectThread(threadId)')
    expect(layout).toContain("result.warning === 'remember_failed'")
    expect(layout).toContain('setDecisionNotice(')
    expect(layout).toContain('decisionNotice={decisionNotice}')
    expect(content).toContain('pendingDecisionItem = null')
    expect(content).toContain('pendingDecisionCount = 0')
    expect(content).toContain('threadId={pendingDecisionItem?.threadId ?? null}')
    expect(content).toContain('count={pendingDecisionCount}')
    expect(content).toContain('decisionNotice?: string | null')
  })
})
