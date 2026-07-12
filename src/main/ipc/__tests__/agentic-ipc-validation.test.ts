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

const approvalConfig = {
  version: 1 as const,
  preset: 'custom' as const,
  default: { write: 'ask' as const, exec: 'allow' as const },
  overrides: {}
}

describe('agentic IPC runtime validation', () => {
  it('rejects invalid agentic payloads before side effects', async () => {
    const capabilitiesHandler = vi.fn(async () => [])
    const setEnabledHandler = vi.fn(async () => [])
    const setModeHandler = vi.fn(async () => 'selected' as const)
    const presetHandler = vi.fn(async () => approvalConfig)
    const defaultHandler = vi.fn(async () => approvalConfig)
    const overrideHandler = vi.fn(async () => approvalConfig)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('agentic:capabilities', capabilitiesHandler)
    typedHandle('agentic:setEnabled', setEnabledHandler)
    typedHandle('agentic:setMode', setModeHandler)
    typedHandle('agentic:setApprovalPreset', presetHandler)
    typedHandle('agentic:setApprovalDefault', defaultHandler)
    typedHandle('agentic:setApprovalOverride', overrideHandler)

    expect(() => electronMock.handlers.get('agentic:capabilities')?.({}, 'extra')).toThrow(
      new IpcPayloadValidationError('agentic:capabilities', 'expected no arguments')
    )
    expect(() => electronMock.handlers.get('agentic:setEnabled')?.({}, '', true)).toThrow(
      new IpcPayloadValidationError('agentic:setEnabled', 'agentId must not be empty')
    )
    expect(() => electronMock.handlers.get('agentic:setEnabled')?.({}, 'codex', 'true')).toThrow(
      new IpcPayloadValidationError('agentic:setEnabled', 'on must be a boolean')
    )
    expect(() => electronMock.handlers.get('agentic:setMode')?.({}, 'manual')).toThrow(
      new IpcPayloadValidationError('agentic:setMode', 'mode must be one of: all, selected')
    )
    expect(() => electronMock.handlers.get('agentic:setApprovalPreset')?.({}, 'danger')).toThrow(
      new IpcPayloadValidationError('agentic:setApprovalPreset', 'preset must be one of: read-only, auto, full-access, ask-all, custom')
    )
    expect(() => electronMock.handlers.get('agentic:setApprovalDefault')?.({}, 'delete', 'ask')).toThrow(
      new IpcPayloadValidationError('agentic:setApprovalDefault', 'tool must be one of: write, exec')
    )
    expect(() => electronMock.handlers.get('agentic:setApprovalOverride')?.({}, 'codex', 'write', 'sometimes')).toThrow(
      new IpcPayloadValidationError('agentic:setApprovalOverride', 'policy must be one of: allow, ask, deny')
    )
    expect(capabilitiesHandler).not.toHaveBeenCalled()
    expect(setEnabledHandler).not.toHaveBeenCalled()
    expect(setModeHandler).not.toHaveBeenCalled()
    expect(presetHandler).not.toHaveBeenCalled()
    expect(defaultHandler).not.toHaveBeenCalled()
    expect(overrideHandler).not.toHaveBeenCalled()
  })

  it('passes valid agentic payloads through unchanged', async () => {
    const getEnabledHandler = vi.fn(async () => ['codex'])
    const setEnabledHandler = vi.fn(async () => ['codex'])
    const setModeHandler = vi.fn(async () => 'selected' as const)
    const presetHandler = vi.fn(async () => approvalConfig)
    const defaultHandler = vi.fn(async () => approvalConfig)
    const overrideHandler = vi.fn(async () => approvalConfig)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('agentic:getEnabled', getEnabledHandler)
    typedHandle('agentic:setEnabled', setEnabledHandler)
    typedHandle('agentic:setMode', setModeHandler)
    typedHandle('agentic:setApprovalPreset', presetHandler)
    typedHandle('agentic:setApprovalDefault', defaultHandler)
    typedHandle('agentic:setApprovalOverride', overrideHandler)

    await expect(electronMock.handlers.get('agentic:getEnabled')?.({})).resolves.toEqual(['codex'])
    await expect(electronMock.handlers.get('agentic:setEnabled')?.({}, 'codex', true)).resolves.toEqual(['codex'])
    await expect(electronMock.handlers.get('agentic:setMode')?.({}, 'selected')).resolves.toBe('selected')
    await expect(electronMock.handlers.get('agentic:setApprovalPreset')?.({}, 'custom')).resolves.toBe(approvalConfig)
    await expect(electronMock.handlers.get('agentic:setApprovalDefault')?.({}, 'write', 'ask')).resolves.toBe(approvalConfig)
    await expect(electronMock.handlers.get('agentic:setApprovalOverride')?.({}, 'codex', 'exec', null)).resolves.toBe(approvalConfig)

    expect(getEnabledHandler).toHaveBeenCalledWith({})
    expect(setEnabledHandler).toHaveBeenCalledWith({}, 'codex', true)
    expect(setModeHandler).toHaveBeenCalledWith({}, 'selected')
    expect(presetHandler).toHaveBeenCalledWith({}, 'custom')
    expect(defaultHandler).toHaveBeenCalledWith({}, 'write', 'ask')
    expect(overrideHandler).toHaveBeenCalledWith({}, 'codex', 'exec', null)
  })
})
