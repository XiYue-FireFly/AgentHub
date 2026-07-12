import { describe, expect, it } from 'vitest'
import {
  assessApprovalRisk,
  approvalReason
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
