import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('decision runtime migration', () => {
  it('routes primary decisions through DecisionService and removes legacy resolution channels', () => {
    const mainIndex = read('src/main/index.ts')
    const dispatcher = read('src/main/hub/dispatcher.ts')

    expect(mainIndex).toContain('new ToolDecisionAdapter')
    expect(mainIndex).toContain('requestToolDecision: async')
    expect(dispatcher).toContain('this.decisionAdapter.requestToolDecision')
    expect(dispatcher).not.toContain('resolveApproval(')
    expect(read('src/main/runtime/schedule-helpers.ts')).toContain('GuardDecisionAdapter')
    expect(read('src/main/hub/adapters/acp-client.ts')).not.toContain('opts[0]')
    expect(existsSync(join(process.cwd(), 'src/main/runtime/guard-approval-service.ts'))).toBe(false)
    expect(read('src/preload/index.ts')).not.toContain("typedInvoke('turns:resolveGuard'")
    expect(read('src/preload/index.ts')).not.toContain("typedInvoke('agentic:resolveApproval'")
    expect(read('src/preload/index.ts')).not.toContain("typedInvoke('agentic:getPendingApprovalIds'")
    expect(read('src/renderer/workbench/WorkbenchLayout.tsx')).not.toContain('<ApprovalDialog')
    expect(read('src/renderer/workbench/ThreadView.tsx')).not.toContain('onResolveGuard')
  })
})
