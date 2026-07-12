import { describe, expect, it } from 'vitest'
import { deriveTaskItems } from '../utils/taskItems'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const baseThread = {
  id: 'thread-1',
  workspaceId: 'ws-1',
  title: 'Thread',
  createdAt: 1,
  updatedAt: 1
} satisfies WorkbenchThread

function event(input: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'turnId' | 'threadId' | 'kind'>): RuntimeEvent {
  return {
    id: input.id || `${input.turnId}-${input.kind}-${input.seq || 1}`,
    threadId: input.threadId,
    turnId: input.turnId,
    seq: input.seq || 1,
    kind: input.kind,
    agentId: input.agentId,
    payload: input.payload || {},
    createdAt: input.createdAt || 1
  }
}

describe('deriveTaskItems', () => {
  it('derives results, usage, errors, steps, duration, and agents from runtime data', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [{
        id: 'turn-1',
        threadId: 'thread-1',
        prompt: 'Build the feature',
        mode: 'lead-workers',
        targetAgent: 'codex',
        status: 'completed',
        taskIds: ['task-1'],
        createdAt: Date.UTC(2026, 0, 1, 8, 0, 0),
        completedAt: Date.UTC(2026, 0, 1, 8, 0, 3)
      }],
      runs: [{
        id: 'run-1',
        turnId: 'turn-1',
        agentId: 'codex',
        role: 'target',
        status: 'completed',
        startedAt: Date.UTC(2026, 0, 1, 8, 0, 0),
        endedAt: Date.UTC(2026, 0, 1, 8, 0, 2)
      }],
      activeThreadId: 'thread-1'
    }

    const tasks = deriveTaskItems(snapshot, {
      'thread-1': [
        event({
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 1,
          kind: 'agent:activity',
          agentId: 'codex',
          payload: { step: { id: 'step-1', kind: 'tool', tool: 'Write', label: 'Write file', status: 'running' } }
        }),
        event({
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 2,
          kind: 'agent:activity',
          agentId: 'codex',
          payload: { step: { id: 'step-1', kind: 'tool', tool: 'Write', label: 'Write file', output: 'ok', status: 'done' } }
        }),
        event({
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 3,
          kind: 'agent:done',
          agentId: 'codex',
          payload: {
            content: 'Implemented',
            usage: { prompt_tokens: 12, completion_tokens: 4 },
            modelId: 'gpt-test'
          }
        })
      ]
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'turn-1',
      threadId: 'thread-1',
      threadTitle: 'Thread',
      workspaceId: 'ws-1',
      text: 'Build the feature',
      mode: 'lead-workers',
      status: 'completed',
      agents: ['codex'],
      durationMs: 3000,
      results: { codex: 'Implemented' },
      usage: { codex: { prompt_tokens: 12, completion_tokens: 4, modelId: 'gpt-test' } }
    })
    expect(tasks[0].steps?.codex).toEqual([
      { id: 'step-1', kind: 'tool', tool: 'Write', label: 'Write file', output: 'ok', status: 'done' }
    ])
  })

  it('maps an interrupted terminal Turn to a terminal task card with run duration', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [{
        id: 'turn-interrupted',
        threadId: 'thread-1',
        prompt: 'Resume later',
        mode: 'auto',
        status: 'interrupted',
        taskIds: [],
        createdAt: 10
      }],
      runs: [{
        id: 'run-interrupted',
        turnId: 'turn-interrupted',
        agentId: 'codex',
        role: 'target',
        status: 'interrupted',
        startedAt: 10,
        endedAt: 25
      }],
      activeThreadId: 'thread-1'
    }

    expect(deriveTaskItems(snapshot, {})[0]).toMatchObject({
      status: 'cancelled',
      durationMs: 15
    })
  })

  it('does not derive a terminal duration for an awaiting-decision Turn from stale timestamps', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [{
        id: 'turn-waiting',
        threadId: 'thread-1',
        prompt: 'Approve the next step',
        mode: 'auto',
        status: 'awaiting-decision',
        taskIds: [],
        createdAt: 10,
        completedAt: 30
      }],
      runs: [{
        id: 'run-waiting',
        turnId: 'turn-waiting',
        agentId: 'codex',
        role: 'target',
        status: 'awaiting-decision',
        startedAt: 10,
        endedAt: 20
      }],
      activeThreadId: 'thread-1'
    }

    expect(deriveTaskItems(snapshot, {})[0]).toMatchObject({
      status: 'running',
      durationMs: null
    })
  })

  it('uses an explicit terminal event duration while a Turn awaits a decision', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [{
        id: 'turn-waiting',
        threadId: 'thread-1',
        prompt: 'Approve the next step',
        mode: 'auto',
        status: 'awaiting-decision',
        taskIds: [],
        createdAt: 10
      }],
      runs: [],
      activeThreadId: 'thread-1'
    }
    const terminalEvent = event({
      threadId: 'thread-1',
      turnId: 'turn-waiting',
      kind: 'agent:done',
      payload: { durationMs: 7 }
    })

    expect(deriveTaskItems(snapshot, { 'thread-1': [terminalEvent] })[0].durationMs).toBe(7)
  })

  it('ignores a non-terminal event duration while a Turn awaits a decision', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [{
        id: 'turn-waiting',
        threadId: 'thread-1',
        prompt: 'Approve the next step',
        mode: 'auto',
        status: 'awaiting-decision',
        taskIds: [],
        createdAt: 10
      }],
      runs: [],
      activeThreadId: 'thread-1'
    }
    const activityEvent = event({
      threadId: 'thread-1',
      turnId: 'turn-waiting',
      kind: 'agent:activity',
      payload: { durationMs: 9 }
    })

    expect(deriveTaskItems(snapshot, { 'thread-1': [activityEvent] })[0].durationMs).toBeNull()
  })

  it('includes non-selected threads when their full event lists are supplied', () => {
    const thread2 = { ...baseThread, id: 'thread-2', title: 'Thread 2', createdAt: 2, updatedAt: 2 }
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread, thread2],
      turns: [
        { id: 'turn-1', threadId: 'thread-1', prompt: 'First', mode: 'auto', status: 'completed', taskIds: [], createdAt: 10, completedAt: 15 },
        { id: 'turn-2', threadId: 'thread-2', prompt: 'Second', mode: 'auto', status: 'failed', taskIds: [], createdAt: 20, completedAt: 25 }
      ],
      runs: [
        { id: 'run-1', turnId: 'turn-1', agentId: 'codex', role: 'target', status: 'completed', startedAt: 10, endedAt: 15 },
        { id: 'run-2', turnId: 'turn-2', agentId: 'claude', role: 'target', status: 'failed', startedAt: 20, endedAt: 25 }
      ],
      activeThreadId: 'thread-1'
    }

    const tasks = deriveTaskItems(snapshot, {
      'thread-1': [event({ threadId: 'thread-1', turnId: 'turn-1', kind: 'agent:done', agentId: 'codex', payload: { content: 'ok' } })],
      'thread-2': [event({ threadId: 'thread-2', turnId: 'turn-2', kind: 'agent:error', agentId: 'claude', payload: { error: 'boom' } })]
    })

    expect(tasks.map(task => task.id)).toEqual(['turn-2', 'turn-1'])
    expect(tasks[0]).toMatchObject({ status: 'failed', agents: ['claude'], errors: { claude: 'boom' } })
    expect(tasks[1]).toMatchObject({ status: 'completed', agents: ['codex'], results: { codex: 'ok' } })
  })

  it('summarizes orchestrate final and error events as task output', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [
        { id: 'turn-1', threadId: 'thread-1', prompt: 'Plan', mode: 'orchestrate', status: 'completed', taskIds: [], createdAt: 10, completedAt: 12 },
        { id: 'turn-2', threadId: 'thread-1', prompt: 'Fail plan', mode: 'orchestrate', status: 'failed', taskIds: [], createdAt: 20, completedAt: 22 }
      ],
      runs: [],
      activeThreadId: 'thread-1'
    }

    const tasks = deriveTaskItems(snapshot, {
      'thread-1': [
        event({ threadId: 'thread-1', turnId: 'turn-1', kind: 'orchestrate', payload: { kind: 'orchestrate:final', content: 'final answer' } }),
        event({ threadId: 'thread-1', turnId: 'turn-2', kind: 'orchestrate', payload: { kind: 'orchestrate:error', error: 'planner failed' } })
      ]
    })

    expect(tasks[1].results).toEqual({ orchestrate: 'final answer' })
    expect(tasks[0].errors).toEqual({ orchestrate: 'planner failed' })
  })

  it('filters hidden turns and internal run-only outputs from task cards', () => {
    const snapshot: WorkbenchSnapshot = {
      threads: [baseThread],
      turns: [
        { id: 'turn-1', threadId: 'thread-1', prompt: 'Visible', mode: 'firefly-custom', status: 'completed', taskIds: [], createdAt: 10, completedAt: 12 },
        { id: 'turn-2', threadId: 'thread-1', prompt: 'Hidden', mode: 'auto', status: 'completed', taskIds: [], createdAt: 20, completedAt: 22 }
      ],
      runs: [],
      hiddenTaskTurnIds: ['turn-2'],
      activeThreadId: 'thread-1'
    }

    const tasks = deriveTaskItems(snapshot, {
      'thread-1': [
        event({ threadId: 'thread-1', turnId: 'turn-1', kind: 'turn:summary', agentId: 'budget-guard', payload: { content: 'guard' } }),
        event({ threadId: 'thread-1', turnId: 'turn-1', kind: 'agent:done', agentId: 'claude', payload: { content: 'internal review', visibility: 'run' } }),
        event({ threadId: 'thread-1', turnId: 'turn-1', kind: 'agent:done', agentId: 'claude', payload: { content: 'final answer', visibility: 'chat' } })
      ]
    })

    expect(tasks.map(task => task.id)).toEqual(['turn-1'])
    expect(tasks[0].agents).toEqual(['claude'])
    expect(tasks[0].results).toEqual({ claude: 'final answer' })
  })
})

describe('TasksScreen workspace grouping wiring', () => {
  it('renders workspace groups and passes workspace scoped clearing through WorkbenchMainContent', () => {
    const tasksScreen = readFileSync(join(process.cwd(), 'src/renderer/screens/Tasks.tsx'), 'utf8')
    const mainContent = readFileSync(join(process.cwd(), 'src/renderer/workbench/WorkbenchMainContent.tsx'), 'utf8')
    const layout = readFileSync(join(process.cwd(), 'src/renderer/workbench/WorkbenchLayout.tsx'), 'utf8')

    expect(tasksScreen).toContain('groupTasksByWorkspace')
    expect(tasksScreen).toContain('onClearCompleted(group.workspaceId)')
    expect(tasksScreen).toContain('隐藏任务不会删除对话内容')
    expect(mainContent).toContain('workspaces={workspaces}')
    expect(layout).toContain('allSnapshot')
    expect(layout).toContain('deriveTaskItems(allSnapshot, taskEventsByThread)')
    expect(layout).toContain('window.electronAPI.tasks.clearCompleted(targetWorkspaceId)')
  })
})
