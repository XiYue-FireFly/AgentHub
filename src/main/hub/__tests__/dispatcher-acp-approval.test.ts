import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dispatcher, type DispatchTask } from '../dispatcher'

const approvalMock = vi.hoisted(() => ({
  policyForWithRisk: vi.fn(),
  policyFor: vi.fn(),
  assessApprovalRisk: vi.fn(),
  approvalReason: vi.fn(() => 'Approval required')
}))

vi.mock('../../agentic/approval', () => ({
  getApprovalConfig: () => ({
    policyFor: approvalMock.policyFor,
    policyForWithRisk: approvalMock.policyForWithRisk
  }),
  savePendingApproval: vi.fn(),
  resolvePendingApproval: vi.fn(),
  expireStalePendingApprovals: vi.fn(() => 0),
  assessApprovalRisk: approvalMock.assessApprovalRisk,
  approvalReason: approvalMock.approvalReason
}))

function makeTask(): DispatchTask {
  return {
    id: 'task-acp',
    text: 'Run',
    mode: 'auto',
    targetAgent: 'codex',
    status: 'running',
    results: new Map(),
    thinking: new Map(),
    errors: new Map(),
    usage: new Map(),
    thinkingSummary: new Map(),
    createdAt: new Date('2026-07-11T00:00:00.000Z')
  }
}

afterEach(() => {
  approvalMock.policyForWithRisk.mockReset()
  approvalMock.policyFor.mockReset()
  approvalMock.assessApprovalRisk.mockReset()
  approvalMock.approvalReason.mockClear()
})

describe('Dispatcher ACP approval risk handling', () => {
  it('uses policyForWithRisk with canonical exec risk and nested ACP rawInput', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('critical')
    approvalMock.policyForWithRisk.mockReturnValue('deny')
    const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)

    const approved = await (dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'exec',
      toolName: 'run_command',
      label: 'Run command',
      detail: 'npm test',
      raw: {
        toolCall: {
          toolCallId: 'call-1',
          rawInput: { command: 'npm test' }
        }
      }
    })

    expect(approved).toBe(false)
    expect(approvalMock.assessApprovalRisk).toHaveBeenCalledWith('exec', { command: 'npm test' })
    expect(approvalMock.policyForWithRisk).toHaveBeenCalledWith('codex', 'exec', 'critical')
    expect(approvalMock.policyFor).not.toHaveBeenCalled()
  })

  it('uses canonical fs_write risk for ACP write aliases', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('high')
    approvalMock.policyForWithRisk.mockReturnValue('allow')
    const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)

    const approved = await (dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'write',
      toolName: 'delete_file',
      args: { path: 'src/old.ts' },
      raw: { toolCall: { toolCallId: 'call-2' } }
    })

    expect(approved).toBe(true)
    expect(approvalMock.assessApprovalRisk).toHaveBeenCalledWith('fs_write', { path: 'src/old.ts' })
    expect(approvalMock.policyForWithRisk).toHaveBeenCalledWith('codex', 'write', 'high')
  })

  it('fails closed for unclassified ACP permission requests', async () => {
    const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: null,
      readOnly: false,
      toolName: 'custom_plugin_action',
      raw: { toolCall: { toolCallId: 'call-3' } }
    })).resolves.toBe(false)
    expect(approvalMock.policyForWithRisk).not.toHaveBeenCalled()
  })
})
