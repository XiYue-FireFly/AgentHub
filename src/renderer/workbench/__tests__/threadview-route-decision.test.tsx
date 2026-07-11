// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, within } from '@testing-library/react'
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
        onResolveGuard={vi.fn()}
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
})
