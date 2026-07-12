// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadView } from '../ThreadView'

afterEach(() => {
  cleanup()
  delete (window as any).electronAPI
})

describe('ThreadView route decisions', () => {
  it('renders a chat-visible route once inside its matching turn while keeping run-only routes hidden', () => {
    ;(window as any).electronAPI = {
      context: { projection: vi.fn(async () => null) }
    }
    const turns = [
      {
        id: 'turn-1',
        threadId: 'thread-1',
        prompt: 'First request',
        mode: 'auto',
        status: 'completed',
        taskIds: [],
        createdAt: 1
      },
      {
        id: 'turn-2',
        threadId: 'thread-1',
        prompt: 'Second request',
        mode: 'auto',
        status: 'completed',
        taskIds: [],
        createdAt: 2
      }
    ] as WorkbenchTurn[]
    const events = [
      {
        id: 'route-run-only',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 1,
        kind: 'route:decision',
        agentId: 'router',
        payload: { state: 'internal', selectedAgentId: 'claude', visibility: 'run' },
        createdAt: 3
      },
      {
        id: 'route-visible',
        threadId: 'thread-1',
        turnId: 'turn-2',
        seq: 2,
        kind: 'route:decision',
        agentId: 'router',
        payload: { state: 'review', selectedAgentId: 'codex' },
        createdAt: 4
      }
    ] as RuntimeEvent[]
    const view = render(
      <ThreadView
        thread={{ id: 'thread-1', workspaceId: 'workspace-1', title: 'Thread', createdAt: 1, updatedAt: 2 }}
        turns={turns}
        events={events}
        onRetry={vi.fn()}
        onCancelAgent={vi.fn()}
        openSetup={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateThread={vi.fn()}
        hasWorkspace
      />
    )

    const firstTurn = view.getByText('First request').closest('.wb-turn') as HTMLElement
    const secondTurn = view.getByText('Second request').closest('.wb-turn') as HTMLElement
    expect(within(firstTurn).queryByText('Route', { exact: true })).toBeNull()
    expect(within(secondTurn).getByText('Route', { exact: true })).toBeTruthy()
    expect(within(secondTurn).getByText('review -> codex', { exact: true })).toBeTruthy()
    expect(view.getAllByText('Route', { exact: true })).toHaveLength(1)
    expect(view.container.querySelectorAll('.wb-role-event.route')).toHaveLength(1)
  })

  it('renders a redacted interrupted-turn recovery card that reruns only the authoritative turn', () => {
    const rerunInterrupted = vi.fn(() => new Promise<void>(() => {}))
    ;(window as any).electronAPI = {
      context: { projection: vi.fn(async () => null) },
      turns: { rerunInterrupted }
    }
    const turn = {
      id: 'trusted-original-turn',
      threadId: 'thread-1',
      prompt: 'Interrupted request',
      mode: 'auto',
      status: 'interrupted',
      taskIds: [],
      createdAt: 1
    } as WorkbenchTurn
    const view = render(
      <ThreadView
        thread={{ id: 'thread-1', workspaceId: 'workspace-1', title: 'Thread', createdAt: 1, updatedAt: 2 }}
        turns={[turn]}
        events={[{
          id: 'stale-event',
          threadId: 'thread-1',
          turnId: 'trusted-original-turn',
          seq: 1,
          kind: 'decision:resolved',
          payload: {
            status: 'stale',
            recovery: {
              kind: 'rerun-turn',
              originalTurnId: 'OLD_COMMAND_MUST_NOT_RENDER',
              preview: 'OLD_COMMAND_MUST_NOT_RENDER'
            },
            preview: 'OLD_COMMAND_MUST_NOT_RENDER'
          },
          createdAt: 2
        } as RuntimeEvent]}
        onRetry={vi.fn()}
        onCancelAgent={vi.fn()}
        openSetup={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateThread={vi.fn()}
        hasWorkspace
      />
    )

    expect(view.getByText('Turn interrupted by restart')).toBeTruthy()
    expect(view.queryByText('OLD_COMMAND_MUST_NOT_RENDER')).toBeNull()
    const rerun = view.getByRole('button', { name: 'Rerun Turn' })
    expect(view.getAllByRole('button')).toHaveLength(1)

    fireEvent.click(rerun)
    fireEvent.click(rerun)
    expect(rerunInterrupted).toHaveBeenCalledWith('trusted-original-turn')
    expect(rerunInterrupted).toHaveBeenCalledTimes(1)
    expect(rerun.getAttribute('disabled')).not.toBeNull()
  })

  it('restores a rejected rerun control so the user can try again', async () => {
    const rejected = Promise.reject(new Error('rerun failed'))
    void rejected.catch(() => {})
    const rerunInterrupted = vi.fn(() => rejected)
    ;(window as any).electronAPI = {
      context: { projection: vi.fn(async () => null) },
      turns: { rerunInterrupted }
    }
    const view = render(
      <ThreadView
        thread={{ id: 'thread-1', workspaceId: 'workspace-1', title: 'Thread', createdAt: 1, updatedAt: 2 }}
        turns={[{
          id: 'trusted-original-turn',
          threadId: 'thread-1',
          prompt: 'Interrupted request',
          mode: 'auto',
          status: 'interrupted',
          taskIds: [],
          createdAt: 1
        } as WorkbenchTurn]}
        events={[]}
        onRetry={vi.fn()}
        onCancelAgent={vi.fn()}
        openSetup={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateThread={vi.fn()}
        hasWorkspace
      />
    )

    fireEvent.click(view.getByRole('button', { name: 'Rerun Turn' }))

    await waitFor(() => expect(view.getByText('Unable to rerun turn. Try again.')).toBeTruthy())
    expect(view.getByRole('button', { name: 'Rerun Turn' }).getAttribute('disabled')).toBeNull()
  })

  it('shows a settled rerun outcome after a successful response while the authoritative snapshot catches up', async () => {
    const rerunInterrupted = vi.fn(async () => ({}))
    ;(window as any).electronAPI = {
      context: { projection: vi.fn(async () => null) },
      turns: { rerunInterrupted }
    }
    const view = render(
      <ThreadView
        thread={{ id: 'thread-1', workspaceId: 'workspace-1', title: 'Thread', createdAt: 1, updatedAt: 2 }}
        turns={[{
          id: 'trusted-original-turn',
          threadId: 'thread-1',
          prompt: 'Interrupted request',
          mode: 'auto',
          status: 'interrupted',
          taskIds: [],
          createdAt: 1
        } as WorkbenchTurn]}
        events={[]}
        onRetry={vi.fn()}
        onCancelAgent={vi.fn()}
        openSetup={vi.fn()}
        onCreateProject={vi.fn()}
        onCreateThread={vi.fn()}
        hasWorkspace
      />
    )

    fireEvent.click(view.getByRole('button', { name: 'Rerun Turn' }))

    await waitFor(() => expect(view.getByRole('button', { name: 'Turn rerun' }).getAttribute('disabled')).not.toBeNull())
    expect(rerunInterrupted).toHaveBeenCalledTimes(1)
  })
})
