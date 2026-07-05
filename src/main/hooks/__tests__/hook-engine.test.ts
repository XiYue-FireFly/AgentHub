import { describe, it, expect } from 'vitest'
import {
  hasHooksForPhase,
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPreDispatchHooks,
  runObserverHooks,
  hookMatchesTool,
  type ResolvedHook
} from '../hook-engine'

describe('HookEngine', () => {
  describe('hasHooksForPhase', () => {
    it('should return false for empty hooks', () => {
      expect(hasHooksForPhase([], 'PreToolUse')).toBe(false)
    })

    it('should return false for undefined hooks', () => {
      expect(hasHooksForPhase(undefined, 'PreToolUse')).toBe(false)
    })

    it('should return true when hooks exist for phase', () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreToolUse', run: () => {} }
      ]
      expect(hasHooksForPhase(hooks, 'PreToolUse')).toBe(true)
    })

    it('should return false when hooks exist for different phase', () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PostToolUse', run: () => {} }
      ]
      expect(hasHooksForPhase(hooks, 'PreToolUse')).toBe(false)
    })
  })

  describe('hookMatchesTool', () => {
    it('should match any tool when no matcher or toolNames', () => {
      const hook: ResolvedHook = { phase: 'PreToolUse', run: () => {} }
      expect(hookMatchesTool(hook, 'read')).toBe(true)
      expect(hookMatchesTool(hook, 'write')).toBe(true)
    })

    it('should match specific tool names', () => {
      const hook: ResolvedHook = { phase: 'PreToolUse', toolNames: ['read', 'write'], run: () => {} }
      expect(hookMatchesTool(hook, 'read')).toBe(true)
      expect(hookMatchesTool(hook, 'write')).toBe(true)
      expect(hookMatchesTool(hook, 'exec')).toBe(false)
    })

    it('should match with glob pattern', () => {
      const hook: ResolvedHook = { phase: 'PreToolUse', matcher: 'fs_*', run: () => {} }
      expect(hookMatchesTool(hook, 'fs_read')).toBe(true)
      expect(hookMatchesTool(hook, 'fs_write')).toBe(true)
      expect(hookMatchesTool(hook, 'exec')).toBe(false)
    })

    it('should match with alternation pattern', () => {
      const hook: ResolvedHook = { phase: 'PreToolUse', matcher: 'read|write', run: () => {} }
      expect(hookMatchesTool(hook, 'read')).toBe(true)
      expect(hookMatchesTool(hook, 'write')).toBe(true)
      expect(hookMatchesTool(hook, 'exec')).toBe(false)
    })
  })

  describe('runPreToolUseHooks', () => {
    it('should pass through when no hooks', async () => {
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = await runPreToolUseHooks([], { call, context })
      expect(result.call).toEqual(call)
      expect(result.denied).toBeUndefined()
      expect(result.autoApproved).toBe(false)
    })

    it('should allow tool call when hook returns allow', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreToolUse', run: () => ({ decision: 'allow' }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = await runPreToolUseHooks(hooks, { call, context })
      expect(result.autoApproved).toBe(true)
      expect(result.denied).toBeUndefined()
    })

    it('should deny tool call when hook returns deny', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreToolUse', run: () => ({ decision: 'deny', message: 'not allowed' }) }
      ]
      const call = { toolName: 'exec', arguments: { command: 'rm -rf /' } }
      const context = { threadId: 'thread-1' }
      const result = await runPreToolUseHooks(hooks, { call, context })
      expect(result.denied).toBe('not allowed')
      expect(result.autoApproved).toBe(false)
    })

    it('should rewrite arguments when hook returns arguments', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreToolUse', run: () => ({ arguments: { path: '/safe/path' } }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = await runPreToolUseHooks(hooks, { call, context })
      expect(result.call.arguments).toEqual({ path: '/safe/path' })
    })

    it('should warn and continue when a hook throws', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreToolUse', run: () => { throw new Error('broken pre hook') } },
        { phase: 'PreToolUse', run: () => ({ decision: 'allow' }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = await runPreToolUseHooks(hooks, { call, context })
      expect(result.autoApproved).toBe(true)
      expect(result.denied).toBeUndefined()
      expect(result.warnings).toEqual(['PreToolUse hook failed: broken pre hook'])
    })

    it('should warn and continue when a hook times out', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreToolUse', timeoutMs: 1, run: () => new Promise(() => {}) },
        { phase: 'PreToolUse', run: () => ({ arguments: { path: '/after-timeout' } }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = await runPreToolUseHooks(hooks, { call, context })
      expect(result.call.arguments).toEqual({ path: '/after-timeout' })
      expect(result.warnings).toEqual(['PreToolUse hook failed: PreToolUse hook timed out'])
    })
  })

  describe('runPostToolUseHooks', () => {
    it('should pass through when no hooks', async () => {
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = { output: 'content', isError: false }
      const outcome = await runPostToolUseHooks([], { call, context, result })
      expect(outcome.output).toBe('content')
      expect(outcome.isError).toBe(false)
    })

    it('should modify output when hook returns output', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PostToolUse', run: () => ({ output: 'modified' }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = { output: 'original', isError: false }
      const outcome = await runPostToolUseHooks(hooks, { call, context, result })
      expect(outcome.output).toBe('modified')
    })

    it('should mark as error when hook returns isError', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PostToolUse', run: () => ({ isError: true }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = { output: 'content', isError: false }
      const outcome = await runPostToolUseHooks(hooks, { call, context, result })
      expect(outcome.isError).toBe(true)
    })

    it('should warn and continue when a hook throws', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PostToolUse', run: () => { throw new Error('broken post hook') } },
        { phase: 'PostToolUse', run: () => ({ output: 'modified after warning' }) }
      ]
      const call = { toolName: 'read', arguments: { path: '/test' } }
      const context = { threadId: 'thread-1' }
      const result = { output: 'original', isError: false }
      const outcome = await runPostToolUseHooks(hooks, { call, context, result })
      expect(outcome.output).toBe('modified after warning')
      expect(outcome.warnings).toEqual(['PostToolUse hook failed: broken post hook'])
    })
  })

  describe('runPreDispatchHooks', () => {
    it('should pass through when no hooks', async () => {
      const result = await runPreDispatchHooks([], { threadId: 'thread-1', prompt: 'test' })
      expect(result.denied).toBeUndefined()
      expect(result.additionalContext).toEqual([])
    })

    it('should deny dispatch when hook returns deny', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreDispatch', run: () => ({ decision: 'deny', message: 'blocked' }) }
      ]
      const result = await runPreDispatchHooks(hooks, { threadId: 'thread-1', prompt: 'test' })
      expect(result.denied).toBe('blocked')
    })

    it('should add additional context', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreDispatch', run: () => ({ additionalContext: 'extra info' }) }
      ]
      const result = await runPreDispatchHooks(hooks, { threadId: 'thread-1', prompt: 'test' })
      expect(result.additionalContext).toEqual(['extra info'])
    })

    it('should warn and continue when a hook throws', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PreDispatch', run: () => { throw new Error('broken dispatch hook') } },
        { phase: 'PreDispatch', run: () => ({ additionalContext: 'still added' }) }
      ]
      const result = await runPreDispatchHooks(hooks, { threadId: 'thread-1', prompt: 'test' })
      expect(result.denied).toBeUndefined()
      expect(result.additionalContext).toEqual(['still added'])
      expect(result.warnings).toEqual(['PreDispatch hook failed: broken dispatch hook'])
    })
  })

  describe('runObserverHooks', () => {
    it('should warn and continue when a hook throws', async () => {
      const hooks: ResolvedHook[] = [
        { phase: 'PostDispatch', run: () => { throw new Error('broken observer hook') } },
        { phase: 'PostDispatch', run: () => ({ message: 'observer warning' }) }
      ]
      const result = await runObserverHooks(hooks, {
        phase: 'PostDispatch',
        threadId: 'thread-1',
        prompt: 'test',
        result: { ok: true }
      })
      expect(result.warnings).toEqual([
        'PostDispatch hook failed: broken observer hook',
        'observer warning'
      ])
    })
  })
})
