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

    expect(approved).toEqual({ outcome: 'cancelled' })
    expect(approvalMock.assessApprovalRisk).toHaveBeenCalledWith('exec', { command: 'npm test' })
    expect(approvalMock.policyForWithRisk).toHaveBeenCalledWith('codex', 'exec', 'critical')
    expect(approvalMock.policyFor).not.toHaveBeenCalled()
  })

  it('passes structured ACP options through the trusted dispatcher callback', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('high')
    approvalMock.policyForWithRisk.mockReturnValue('ask')
    const requestAcpPermissionDecision = vi.fn(async ({ onRequested }: any) => {
      onRequested('decision-acp-1')
      return { outcome: 'selected', optionId: 'allow.once/exact' }
    })
    const dispatcher = new (Dispatcher as any)({}, { process: vi.fn() } as any, () => [], { requestAcpPermissionDecision })

    const resolution = await (dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'write',
      toolName: 'delete_file',
      args: { path: 'src/old.ts' },
      options: [
        { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
        { optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once' }
      ],
      raw: { toolCall: { toolCallId: 'call-2' } }
    })

    expect(resolution).toEqual({ outcome: 'selected', optionId: 'allow.once/exact' })
    expect(approvalMock.assessApprovalRisk).toHaveBeenCalledWith('fs_write', { path: 'src/old.ts' })
    expect(approvalMock.policyForWithRisk).toHaveBeenCalledWith('codex', 'write', 'high')
    expect(requestAcpPermissionDecision).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: 'task-acp' }),
      agentId: 'codex',
      idempotencyKey: 'acp:task-acp:codex:call-2',
      request: expect.objectContaining({
        options: [
          { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
          { optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once' }
        ]
      })
    }))
  })

  it('auto-selects only a uniquely recognized allow_once protocol option', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('low')
    approvalMock.policyForWithRisk.mockReturnValue('allow')
    const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'exec',
      toolName: 'run_command',
      args: { command: 'pwd' },
      options: [
        { optionId: 'first', kind: 'deny_once' },
        { optionId: 'allow.exact', kind: 'allow_once' }
      ],
      raw: { toolCall: { toolCallId: 'call-allow' } }
    })).resolves.toEqual({ outcome: 'selected', optionId: 'allow.exact' })

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'exec',
      toolName: 'run_command',
      args: { command: 'pwd' },
      options: [
        { optionId: 'allow.one', kind: 'allow_once' },
        { optionId: 'allow.two', kind: 'allow_once' }
      ],
      raw: { toolCall: { toolCallId: 'call-ambiguous' } }
    })).resolves.toEqual({ outcome: 'cancelled' })
  })

  it('keeps ACP audit events audit-only and records a selected deny option as denied', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('high')
    approvalMock.policyForWithRisk.mockReturnValue('ask')
    const requestAcpPermissionDecision = vi.fn(async ({ onRequested }: any) => {
      onRequested('decision-acp-deny')
      return { outcome: 'selected', optionId: 'deny.exact' }
    })
    const dispatcher = new (Dispatcher as any)({}, { process: vi.fn() } as any, () => [], { requestAcpPermissionDecision })
    const events: any[] = []
    dispatcher.on('stream', (event: any) => events.push(event))

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'write',
      toolName: 'delete_file',
      args: { path: 'src/old.ts' },
      options: [{ optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' }],
      raw: { toolCall: { toolCallId: 'call-deny' } }
    })).resolves.toEqual({ outcome: 'selected', optionId: 'deny.exact' })

    expect(events.filter(event => event.kind === 'approval')).toMatchObject([
      { status: 'pending', auditOnly: true, request: { id: 'decision-acp-deny' } },
      { status: 'denied', auditOnly: true, request: { id: 'decision-acp-deny' } }
    ])
  })

  it('keeps a manually selected allow_always protocol option exact and audit-approved', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('high')
    approvalMock.policyForWithRisk.mockReturnValue('ask')
    const requestAcpPermissionDecision = vi.fn(async ({ onRequested }: any) => {
      onRequested('decision-acp-allow-always')
      return { outcome: 'selected', optionId: 'allow.always/exact' }
    })
    const dispatcher = new (Dispatcher as any)({}, { process: vi.fn() } as any, () => [], { requestAcpPermissionDecision })
    const events: any[] = []
    dispatcher.on('stream', (event: any) => events.push(event))

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: 'write',
      toolName: 'delete_file',
      args: { path: 'src/old.ts' },
      options: [
        { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
        { optionId: 'allow.always/exact', name: 'Allow always', kind: 'allow_always' }
      ],
      raw: { toolCall: { toolCallId: 'call-allow-always' } }
    })).resolves.toEqual({ outcome: 'selected', optionId: 'allow.always/exact' })

    expect(events.filter(event => event.kind === 'approval')).toMatchObject([
      { status: 'pending', auditOnly: true, request: { id: 'decision-acp-allow-always' } },
      { status: 'approved', auditOnly: true, request: { id: 'decision-acp-allow-always' } }
    ])
  })

  it('does not create a second audit request when an idempotent ACP callback reuses the durable decision', async () => {
    approvalMock.assessApprovalRisk.mockReturnValue('high')
    approvalMock.policyForWithRisk.mockReturnValue('ask')
    let calls = 0
    const requestAcpPermissionDecision = vi.fn(async ({ onRequested }: any) => {
      if (calls++ === 0) onRequested('decision-acp-durable')
      return { outcome: 'selected', optionId: 'allow.once/exact' }
    })
    const dispatcher = new (Dispatcher as any)({}, { process: vi.fn() } as any, () => [], { requestAcpPermissionDecision })
    const events: any[] = []
    dispatcher.on('stream', (event: any) => events.push(event))
    const request = {
      tool: 'write',
      toolName: 'delete_file',
      args: { path: 'src/old.ts' },
      options: [{ optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once' }],
      raw: { toolCall: { toolCallId: 'call-idempotent' } }
    }

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', request))
      .resolves.toEqual({ outcome: 'selected', optionId: 'allow.once/exact' })
    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', request))
      .resolves.toEqual({ outcome: 'selected', optionId: 'allow.once/exact' })

    expect(events.filter(event => event.kind === 'approval')).toMatchObject([
      { status: 'pending', auditOnly: true, request: { id: 'decision-acp-durable' } },
      { status: 'approved', auditOnly: true, request: { id: 'decision-acp-durable' } }
    ])
  })

  it('fails closed for unclassified ACP permission requests', async () => {
    const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)

    await expect((dispatcher as any).requestAcpPermission(makeTask(), 'codex', {
      tool: null,
      readOnly: false,
      toolName: 'custom_plugin_action',
      raw: { toolCall: { toolCallId: 'call-3' } }
    })).resolves.toEqual({ outcome: 'cancelled' })
    expect(approvalMock.policyForWithRisk).not.toHaveBeenCalled()
  })
})
