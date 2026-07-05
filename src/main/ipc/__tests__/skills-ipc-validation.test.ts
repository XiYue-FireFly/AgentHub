import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'
import type { SkillDefLike, SkillInputLike, SkillInstallsLike } from '../../../shared/ipc-contract'

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

const validSkillInput: SkillInputLike = {
  name: 'Review Helper',
  category: { id: 'coding', label: 'Coding' },
  description: 'Reviews code',
  instructions: 'Review the diff and report concrete issues.',
  tags: ['review', 'coding'],
  source: 'paste'
}

const skillDef: SkillDefLike = {
  id: 'skill-1',
  name: validSkillInput.name,
  category: { id: 'coding', label: 'Coding' },
  description: validSkillInput.description || '',
  instructions: validSkillInput.instructions,
  tags: validSkillInput.tags || [],
  source: validSkillInput.source || 'paste',
  createdAt: 1,
  updatedAt: 1
}

const installs: SkillInstallsLike = { codex: ['skill-1'] }

describe('skills IPC runtime validation', () => {
  it('rejects invalid skills payloads before side effects', async () => {
    const listHandler = vi.fn(async () => [skillDef])
    const addHandler = vi.fn(async () => skillDef)
    const updateHandler = vi.fn(async () => skillDef)
    const removeHandler = vi.fn(async () => true)
    const installHandler = vi.fn(async () => installs)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('skills:list', listHandler)
    typedHandle('skills:add', addHandler)
    typedHandle('skills:update', updateHandler)
    typedHandle('skills:remove', removeHandler)
    typedHandle('skills:install', installHandler)

    expect(() => electronMock.handlers.get('skills:list')?.({}, 'extra')).toThrow(
      new IpcPayloadValidationError('skills:list', 'expected no arguments')
    )
    expect(() => electronMock.handlers.get('skills:add')?.({}, {
      ...validSkillInput,
      name: ''
    })).toThrow(new IpcPayloadValidationError('skills:add', 'input.name must not be empty'))
    expect(() => electronMock.handlers.get('skills:add')?.({}, {
      ...validSkillInput,
      instructions: 'x'.repeat(40_001)
    })).toThrow(new IpcPayloadValidationError('skills:add', 'input.instructions must be at most 40000 characters'))
    expect(() => electronMock.handlers.get('skills:add')?.({}, {
      ...validSkillInput,
      tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`)
    })).toThrow(new IpcPayloadValidationError('skills:add', 'input.tags must contain at most 12 items'))
    expect(() => electronMock.handlers.get('skills:update')?.({}, 'skill-1', {
      category: 42
    })).toThrow(new IpcPayloadValidationError('skills:update', 'patch.category must be a string or object'))
    expect(() => electronMock.handlers.get('skills:update')?.({}, 'skill-1', {
      tags: null
    })).toThrow(new IpcPayloadValidationError('skills:update', 'patch.tags must be an array'))
    expect(() => electronMock.handlers.get('skills:remove')?.({}, '')).toThrow(
      new IpcPayloadValidationError('skills:remove', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('skills:install')?.({}, 'codex', '')).toThrow(
      new IpcPayloadValidationError('skills:install', 'skillId must not be empty')
    )

    expect(listHandler).not.toHaveBeenCalled()
    expect(addHandler).not.toHaveBeenCalled()
    expect(updateHandler).not.toHaveBeenCalled()
    expect(removeHandler).not.toHaveBeenCalled()
    expect(installHandler).not.toHaveBeenCalled()
  })

  it('passes valid skills payloads through unchanged', async () => {
    const builtinsHandler = vi.fn(async () => [validSkillInput])
    const scanHandler = vi.fn(async () => [])
    const addHandler = vi.fn(async () => skillDef)
    const updateHandler = vi.fn(async () => skillDef)
    const removeHandler = vi.fn(async () => true)
    const getInstallsHandler = vi.fn(async () => installs)
    const installHandler = vi.fn(async () => installs)
    const uninstallHandler = vi.fn(async () => ({}))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('skills:builtins', builtinsHandler)
    typedHandle('skills:scanLocal', scanHandler)
    typedHandle('skills:add', addHandler)
    typedHandle('skills:update', updateHandler)
    typedHandle('skills:remove', removeHandler)
    typedHandle('skills:getInstalls', getInstallsHandler)
    typedHandle('skills:install', installHandler)
    typedHandle('skills:uninstall', uninstallHandler)

    const patch = { category: 'coding', description: '', tags: ['review'] }

    await expect(electronMock.handlers.get('skills:builtins')?.({})).resolves.toEqual([validSkillInput])
    await expect(electronMock.handlers.get('skills:scanLocal')?.({})).resolves.toEqual([])
    await expect(electronMock.handlers.get('skills:add')?.({}, validSkillInput)).resolves.toBe(skillDef)
    await expect(electronMock.handlers.get('skills:update')?.({}, 'skill-1', patch)).resolves.toBe(skillDef)
    await expect(electronMock.handlers.get('skills:remove')?.({}, 'skill-1')).resolves.toBe(true)
    await expect(electronMock.handlers.get('skills:getInstalls')?.({})).resolves.toBe(installs)
    await expect(electronMock.handlers.get('skills:install')?.({}, '*', 'skill-1')).resolves.toBe(installs)
    await expect(electronMock.handlers.get('skills:uninstall')?.({}, 'codex', 'skill-1')).resolves.toEqual({})

    expect(builtinsHandler).toHaveBeenCalledWith({})
    expect(scanHandler).toHaveBeenCalledWith({})
    expect(addHandler).toHaveBeenCalledWith({}, validSkillInput)
    expect(updateHandler).toHaveBeenCalledWith({}, 'skill-1', patch)
    expect(removeHandler).toHaveBeenCalledWith({}, 'skill-1')
    expect(getInstallsHandler).toHaveBeenCalledWith({})
    expect(installHandler).toHaveBeenCalledWith({}, '*', 'skill-1')
    expect(uninstallHandler).toHaveBeenCalledWith({}, 'codex', 'skill-1')
  })
})
