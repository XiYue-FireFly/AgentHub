import { describe, expect, it, vi } from 'vitest'
import { Dispatcher } from '../dispatcher'
import type { PromptDispatchLineage } from '../../../shared/prompt-contract'

const rootLineage: PromptDispatchLineage = {
  origin: 'workbench:create',
  policy: 'optimize',
  rootInputId: 'input-1',
  rootEnvelopeId: 'envelope-1',
  rootPreparedTextHash: 'prepared-hash-1'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function dispatcherWithBlockedAgent() {
  const dispatcher = new Dispatcher({ getAll: () => [] } as any, { process: async () => {} } as any)
  const gate = deferred<void>()
  const seenLineages: PromptDispatchLineage[] = []
  ;(dispatcher as any).resolveTargets = () => [{ agentId: 'codex' }]
  ;(dispatcher as any).sendToAgent = async (task: any, _agentId: string, _text: string, options: any) => {
    seenLineages.push(options.lineage)
    await gate.promise
    if (task.status !== 'cancelled') task.results.set('codex', 'done')
    return task.status === 'cancelled' ? { content: '', error: 'cancelled' } : { content: 'done' }
  }
  return { dispatcher, gate, seenLineages }
}

describe('Dispatcher.startDispatch', () => {
  it('returns a stable task id before the branch settles', async () => {
    const { dispatcher, gate, seenLineages } = dispatcherWithBlockedAgent()
    const handle = dispatcher.startDispatch('hello', 'auto', 'codex', { lineage: rootLineage })
    expect(handle.taskId).toMatch(/^task-/)
    expect(dispatcher.getRecentTasks().some(task => task.id === handle.taskId)).toBe(true)
    gate.resolve()
    await expect(handle.result).resolves.toMatchObject({ id: handle.taskId, status: 'completed' })
    expect(seenLineages).toEqual([rootLineage])
  })

  it('links an AbortSignal and settles cancellation once', async () => {
    const { dispatcher, gate } = dispatcherWithBlockedAgent()
    const controller = new AbortController()
    const finished = vi.fn()
    dispatcher.on('task:finished', finished)
    const handle = dispatcher.startDispatch('hello', 'auto', 'codex', {
      lineage: rootLineage,
      signal: controller.signal
    })
    controller.abort('turn cancelled')
    gate.resolve()
    await expect(handle.result).resolves.toMatchObject({ status: 'cancelled', error: 'turn cancelled' })
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('cancels at an absolute deadline and clears the timer', async () => {
    vi.useFakeTimers()
    try {
      const { dispatcher, gate } = dispatcherWithBlockedAgent()
      const handle = dispatcher.startDispatch('hello', 'auto', 'codex', {
        lineage: rootLineage,
        deadline: Date.now() + 100
      })
      await vi.advanceTimersByTimeAsync(101)
      gate.resolve()
      await expect(handle.result).resolves.toMatchObject({ status: 'cancelled' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
