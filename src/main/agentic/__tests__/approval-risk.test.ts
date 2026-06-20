import { describe, expect, it } from 'vitest'
import {
  assessApprovalRisk,
  approvalReason,
  type ApprovalRisk,
  type PersistedPendingApproval
} from '../approval'

describe('P0-4 assessApprovalRisk', () => {
  it('rates destructive exec commands as critical', () => {
    expect(assessApprovalRisk('exec', { command: 'rm -rf /tmp/data' })).toBe('critical')
    expect(assessApprovalRisk('exec', { command: 'del /s /q C:\\temp' })).toBe('critical')
    expect(assessApprovalRisk('exec', { command: 'taskkill /F /IM node.exe' })).toBe('critical')
  })

  it('rates network/package exec commands as high', () => {
    expect(assessApprovalRisk('exec', { command: 'curl https://example.com' })).toBe('high')
    expect(assessApprovalRisk('exec', { command: 'npm install express' })).toBe('high')
    expect(assessApprovalRisk('exec', { command: 'wget http://example.com/file' })).toBe('high')
  })

  it('rates git push/commit as medium', () => {
    expect(assessApprovalRisk('exec', { command: 'git push origin main' })).toBe('medium')
    expect(assessApprovalRisk('exec', { command: 'git commit -m "test"' })).toBe('medium')
  })

  it('rates general exec as medium by default', () => {
    expect(assessApprovalRisk('exec', { command: 'ls -la' })).toBe('medium')
    expect(assessApprovalRisk('exec', { command: 'echo hello' })).toBe('medium')
  })

  it('rates file writes as medium', () => {
    expect(assessApprovalRisk('fs_write', { path: '/home/user/file.ts', content: 'x' })).toBe('medium')
  })

  it('rates writes to system paths as high', () => {
    expect(assessApprovalRisk('fs_write', { path: 'C:', content: 'x' })).toBe('high')
    expect(assessApprovalRisk('fs_write', { path: '/', content: 'x' })).toBe('high')
  })

  it('rates read-only tools as low', () => {
    expect(assessApprovalRisk('fs_read', { path: '/some/file' })).toBe('low')
  })
})

describe('P0-4 approvalReason', () => {
  it('generates correct reason for exec commands', () => {
    const reason = approvalReason('exec', 'high', 'curl https://example.com')
    expect(reason).toContain('System-altering')
    expect(reason).toContain('curl')
  })

  it('generates correct reason for file writes', () => {
    const reason = approvalReason('fs_write', 'medium', '/home/user/file.ts')
    expect(reason).toContain('Writing to file')
    expect(reason).toContain('/home/user/file.ts')
  })

  it('generates correct reason for critical destructive commands', () => {
    const reason = approvalReason('exec', 'critical', 'rm -rf /')
    expect(reason).toContain('Destructive')
  })
})

describe('P0-4 PersistedPendingApproval lifecycle', () => {
  // Note: full persistence tests require the electron store stub.
  // Here we test the data shape and status transitions directly.
  it('PersistedPendingApproval has correct shape', () => {
    const pa: PersistedPendingApproval = {
      id: 'appr-task1-1',
      request: {
        stepId: 'step1',
        agentId: 'codex',
        tool: 'write',
        toolName: 'fs_write',
        label: 'Write · /test/file.ts',
        detail: 'Action: write file\nPath: /test/file.ts',
        action: 'write_file',
        target: '/test/file.ts',
        risk: 'medium',
        reason: 'Writing to file: /test/file.ts',
        preview: 'const x = 1'
      },
      agentId: 'codex',
      createdAt: new Date().toISOString(),
      status: 'pending'
    }
    expect(pa.request.action).toBe('write_file')
    expect(pa.request.risk).toBe('medium')
    expect(pa.request.target).toBe('/test/file.ts')
    expect(pa.request.reason).toContain('Writing to file')
    expect(pa.request.preview).toBe('const x = 1')
    expect(pa.status).toBe('pending')
  })

  it('stale expired approval has correct shape', () => {
    const pa: PersistedPendingApproval = {
      id: 'appr-task1-2',
      request: {
        stepId: 'step2',
        agentId: 'codex',
        tool: 'exec',
        toolName: 'exec',
        label: 'Bash · npm test',
        detail: 'Action: run command\nCommand: npm test',
        action: 'run_command',
        target: 'npm test',
        risk: 'medium',
        reason: 'Command execution: npm test',
        preview: 'npm test'
      },
      agentId: 'codex',
      createdAt: new Date().toISOString(),
      staleAt: new Date().toISOString(),
      status: 'stale'
    }
    expect(pa.status).toBe('stale')
    expect(pa.staleAt).toBeDefined()
    expect(pa.request.risk).toBe('medium')
  })
})
