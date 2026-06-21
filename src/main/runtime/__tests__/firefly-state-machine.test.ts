import { describe, expect, it } from 'vitest'
import { createFireflyState, advanceRole, completeRole, blockChain, getRoleContext, isComplete, getFinalOutput } from '../firefly-state-machine'

describe('firefly-state-machine', () => {
  it('creates initial state', () => {
    const state = createFireflyState()
    expect(state.phase).toBe('idle')
    expect(state.currentRole).toBeNull()
    expect(state.approvedActions).toEqual([])
    expect(state.blockedByGuard).toBe(false)
  })

  it('advances through all roles in order', () => {
    let state = createFireflyState()
    state = advanceRole(state)
    expect(state.currentRole).toBe('router')
    expect(state.phase).toBe('router_decision')

    state = advanceRole(state)
    expect(state.currentRole).toBe('main')
    expect(state.phase).toBe('main_candidate')

    state = advanceRole(state)
    expect(state.currentRole).toBe('reviewer')
    expect(state.phase).toBe('review_verdict')

    state = advanceRole(state)
    expect(state.currentRole).toBe('executor')
    expect(state.phase).toBe('executor_actions')

    state = advanceRole(state)
    expect(state.currentRole).toBe('gatekeeper')
    expect(state.phase).toBe('gatekeeper_verdict')

    state = advanceRole(state)
    expect(state.currentRole).toBeNull()
    expect(state.phase).toBe('final_release')
  })

  it('records role output and advances', () => {
    let state = createFireflyState()
    state = advanceRole(state) // router
    state = completeRole(state, 'router', '{"taskType":"coding"}')
    expect(state.routerOutput).toBe('{"taskType":"coding"}')
    expect(state.currentRole).toBe('main')
  })

  it('blocks chain on guard verdict', () => {
    let state = createFireflyState()
    state = advanceRole(state) // router
    state = advanceRole(state) // main
    state = blockChain(state, ['Dangerous command detected'])
    expect(state.phase).toBe('blocked')
    expect(state.blockedByGuard).toBe(true)
    expect(state.guardReasons).toEqual(['Dangerous command detected'])
    expect(isComplete(state)).toBe(true)
  })

  it('completes chain with final output', () => {
    let state = createFireflyState()
    // Debug: verify initial state
    expect(state.currentRole).toBeNull()
    expect(state.phase).toBe('idle')
    // advanceRole is called internally by completeRole
    state = completeRole(state, 'router', 'decision')
    expect(state.routerOutput).toBe('decision')
    expect(state.currentRole).toBe('main')
    expect(state.phase).toBe('main_candidate')
    state = completeRole(state, 'main', 'candidate output')
    expect(state.mainOutput).toBe('candidate output')
    state = completeRole(state, 'reviewer', 'PASS')
    state = completeRole(state, 'executor', 'executed')
    state = completeRole(state, 'gatekeeper', 'Final answer')
    expect(state.phase).toBe('final_release')
    expect(getFinalOutput(state)).toBe('Final answer')
  })

  it('provides correct context isolation for each role', () => {
    const state = createFireflyState()
    state.mainOutput = 'Main agent candidate'

    const routerCtx = getRoleContext(state, 'router', 'User prompt', 'Memory', 'Project')
    expect(routerCtx.messages).toEqual(['User prompt'])
    expect(routerCtx.constraints.some(c => c.includes('Do NOT generate code'))).toBe(true)

    const mainCtx = getRoleContext(state, 'main', 'User prompt', 'Memory', 'Project')
    expect(mainCtx.messages).toContain('User prompt')
    expect(mainCtx.messages).toContain('Memory')
    expect(mainCtx.messages).toContain('Project')

    const reviewerCtx = getRoleContext(state, 'reviewer', 'User prompt')
    expect(reviewerCtx.messages.some(m => m.includes('Main agent candidate'))).toBe(true)
    expect(reviewerCtx.constraints.some(c => c.includes('Do NOT generate alternative'))).toBe(true)

    const executorCtx = getRoleContext(state, 'executor', 'User prompt')
    expect(executorCtx.messages).toEqual(['No approved actions to execute.'])

    const gatekeeperCtx = getRoleContext(state, 'gatekeeper', 'User prompt')
    expect(gatekeeperCtx.constraints.some(c => c.includes('Do NOT expose internal'))).toBe(true)
  })

  it('executor gets approved actions in context', () => {
    const state = createFireflyState()
    state.approvedActions = ['write file.ts', 'run tests']
    const ctx = getRoleContext(state, 'executor', 'User prompt')
    expect(ctx.messages[0]).toContain('write file.ts')
    expect(ctx.messages[0]).toContain('run tests')
  })
})
