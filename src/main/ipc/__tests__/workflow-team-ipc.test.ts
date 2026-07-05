import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

const validWorkflowInput = {
  name: 'Code Review',
  description: 'Review code before merge',
  category: 'review' as const,
  steps: [
    { id: 'analyze', type: 'prompt' as const, label: 'Analyze', prompt: 'Analyze this change.' },
    { id: 'review', type: 'review' as const, label: 'Review', dependsOn: ['analyze'], requiresApproval: true }
  ],
  tags: ['review'],
  pinned: true
}

const validTeamInput = {
  name: 'Firefly',
  description: 'Default Firefly team',
  members: [
    { role: 'router' as const, agentId: 'codex' },
    { role: 'reviewer' as const, agentId: 'claude', systemPrompt: 'Review strictly.' }
  ]
}

describe('workflow and team IPC runtime validation', () => {
  it('rejects invalid workflow query and id payloads before side effects', async () => {
    const listHandler = vi.fn(async () => [])
    const getHandler = vi.fn(async () => null)
    const deleteHandler = vi.fn(async () => true)
    const searchHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workflows:list', listHandler)
    typedHandle('workflows:get', getHandler)
    typedHandle('workflows:delete', deleteHandler)
    typedHandle('workflows:search', searchHandler)

    expect(() => electronMock.handlers.get('workflows:list')?.({}, 'sales')).toThrow(
      new IpcPayloadValidationError('workflows:list', 'category must be one of: development, review, research, deployment, custom')
    )
    expect(() => electronMock.handlers.get('workflows:get')?.({}, '')).toThrow(
      new IpcPayloadValidationError('workflows:get', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('workflows:delete')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('workflows:delete', 'id must be a string')
    )
    expect(() => electronMock.handlers.get('workflows:search')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('workflows:search', 'query must be a string')
    )

    expect(listHandler).not.toHaveBeenCalled()
    expect(getHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
    expect(searchHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid workflow upsert payloads before side effects', async () => {
    const handler = vi.fn(async () => ({
      id: 'wf-1',
      ...validWorkflowInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      useCount: 0
    }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workflows:upsert', handler)

    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      name: ''
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.name must not be empty')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      category: 'ops'
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.category must be one of: development, review, research, deployment, custom')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      steps: Array.from({ length: 65 }, (_, index) => ({ id: `s-${index}`, type: 'prompt', label: `Step ${index}` }))
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.steps must contain at most 64 items')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      steps: [{ id: 'x', type: 'shell', label: 'Run shell' }]
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.steps[0].type must be one of: prompt, agent, skill, review, gate')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      steps: [{ id: 'x', type: 'prompt', label: 'X', dependsOn: [123] }]
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.steps[0].dependsOn[0] must be a string')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      steps: [{ id: 'x', type: 'prompt', label: 'X', dependsOn: Array.from({ length: 33 }, (_, index) => `s-${index}`) }]
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.steps[0].dependsOn must contain at most 32 items')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      steps: [{ id: 'x', type: 'prompt', label: 'X', prompt: 'x'.repeat(64 * 1024 + 1) }]
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.steps[0].prompt must be at most 65536 characters')
    )
    expect(() => electronMock.handlers.get('workflows:upsert')?.({}, {
      ...validWorkflowInput,
      tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`)
    })).toThrow(
      new IpcPayloadValidationError('workflows:upsert', 'input.tags must contain at most 32 items')
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('passes valid workflow payloads through unchanged', async () => {
    const upsertHandler = vi.fn(async () => ({
      id: 'wf-1',
      ...validWorkflowInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      useCount: 0
    }))
    const listHandler = vi.fn(async () => [])
    const searchHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workflows:upsert', upsertHandler)
    typedHandle('workflows:list', listHandler)
    typedHandle('workflows:search', searchHandler)

    await expect(electronMock.handlers.get('workflows:upsert')?.({}, validWorkflowInput)).resolves.toMatchObject({ id: 'wf-1' })
    await expect(electronMock.handlers.get('workflows:list')?.({}, 'review')).resolves.toEqual([])
    await expect(electronMock.handlers.get('workflows:search')?.({}, '')).resolves.toEqual([])

    expect(upsertHandler).toHaveBeenCalledWith({}, validWorkflowInput)
    expect(listHandler).toHaveBeenCalledWith({}, 'review')
    expect(searchHandler).toHaveBeenCalledWith({}, '')
  })

  it('rejects invalid team payloads before side effects', async () => {
    const saveHandler = vi.fn(async () => ({
      id: 'team-1',
      ...validTeamInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      useCount: 0
    }))
    const deleteHandler = vi.fn(async () => true)
    const defaultHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('teams:save', saveHandler)
    typedHandle('teams:delete', deleteHandler)
    typedHandle('teams:defaultFirefly', defaultHandler)

    expect(() => electronMock.handlers.get('teams:save')?.({}, {
      ...validTeamInput,
      members: [{ role: 'observer', agentId: 'codex' }]
    })).toThrow(
      new IpcPayloadValidationError('teams:save', 'input.members[0].role must be one of: main, router, reviewer, executor, gatekeeper, summarizer, expert')
    )
    expect(() => electronMock.handlers.get('teams:save')?.({}, {
      ...validTeamInput,
      members: Array.from({ length: 17 }, (_, index) => ({ role: 'expert', agentId: `agent-${index}` }))
    })).toThrow(
      new IpcPayloadValidationError('teams:save', 'input.members must contain at most 16 items')
    )
    expect(() => electronMock.handlers.get('teams:save')?.({}, {
      ...validTeamInput,
      members: [{ role: 'expert', agentId: 'codex', systemPrompt: 'x'.repeat(64 * 1024 + 1) }]
    })).toThrow(
      new IpcPayloadValidationError('teams:save', 'input.members[0].systemPrompt must be at most 65536 characters')
    )
    expect(() => electronMock.handlers.get('teams:delete')?.({}, '')).toThrow(
      new IpcPayloadValidationError('teams:delete', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('teams:defaultFirefly')?.({}, ['codex', 42])).toThrow(
      new IpcPayloadValidationError('teams:defaultFirefly', 'agentIds[1] must be a string')
    )
    expect(() => electronMock.handlers.get('teams:defaultFirefly')?.({}, Array.from({ length: 17 }, (_, index) => `agent-${index}`))).toThrow(
      new IpcPayloadValidationError('teams:defaultFirefly', 'agentIds must contain at most 16 items')
    )

    expect(saveHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
    expect(defaultHandler).not.toHaveBeenCalled()
  })

  it('passes valid team payloads through unchanged', async () => {
    const saveHandler = vi.fn(async () => ({
      id: 'team-1',
      ...validTeamInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      useCount: 0
    }))
    const defaultHandler = vi.fn(async () => validTeamInput.members)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('teams:save', saveHandler)
    typedHandle('teams:defaultFirefly', defaultHandler)

    await expect(electronMock.handlers.get('teams:save')?.({}, validTeamInput)).resolves.toMatchObject({ id: 'team-1' })
    await expect(electronMock.handlers.get('teams:defaultFirefly')?.({}, ['codex', 'claude'])).resolves.toEqual(validTeamInput.members)

    expect(saveHandler).toHaveBeenCalledWith({}, validTeamInput)
    expect(defaultHandler).toHaveBeenCalledWith({}, ['codex', 'claude'])
  })
})
