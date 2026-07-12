import { describe, expect, it } from 'vitest'
import { READ_ONLY_AGENTIC_TOOLS, executeTool } from '../../agentic/tools'
import {
  assertCapabilityTransport,
  shouldRequestAcpPermission
} from '../dispatch-capabilities'

describe('dispatch capability helpers', () => {
  it('exposes only filesystem read schemas for read-only agentic branches', () => {
    const names = READ_ONLY_AGENTIC_TOOLS.map(tool => tool.function.name)

    expect(names).toEqual(['fs_read', 'fs_list'])
    expect(names).not.toContain('fs_write')
    expect(names).not.toContain('exec')
  })

  it('rejects forged mutation calls even when a workspace is available', async () => {
    const context = { root: process.cwd(), readOnly: true }

    await expect(executeTool('fs_write', { path: 'x.txt', content: 'x' }, context)).resolves.toEqual({
      ok: false,
      output: 'Rejected: read-only capability forbids file writes.'
    })
    await expect(executeTool('exec', { command: 'echo x' }, context)).resolves.toEqual({
      ok: false,
      output: 'Rejected: read-only capability forbids command execution.'
    })
  })

  it('rejects read-only mode for stdio-plain because it cannot enforce that capability', () => {
    expect(() => assertCapabilityTransport('stdio-plain', 'read-only')).toThrow(
      'READ_ONLY_TRANSPORT_UNSUPPORTED: stdio-plain cannot enforce read-only execution'
    )

    try {
      assertCapabilityTransport('stdio-plain', 'read-only')
    } catch (error) {
      expect(error).toMatchObject({ code: 'READ_ONLY_TRANSPORT_UNSUPPORTED' })
    }
  })

  it.each([
    ['stdio-ndjson', 'local-cli'],
    [undefined, 'local-cli']
  ])('fails closed for read-only %s/local provider routes', (protocol, providerId) => {
    expect(() => assertCapabilityTransport(protocol, 'read-only', providerId)).toThrow(
      /READ_ONLY_TRANSPORT_UNSUPPORTED/
    )

    try {
      assertCapabilityTransport(protocol, 'read-only', providerId)
    } catch (error) {
      expect(error).toMatchObject({ code: 'READ_ONLY_TRANSPORT_UNSUPPORTED' })
    }
  })

  it('allows normal and enforceable read-only transports', () => {
    expect(() => assertCapabilityTransport('stdio-plain')).not.toThrow()
    expect(() => assertCapabilityTransport('stdio-ndjson', 'normal', 'local-cli')).not.toThrow()
    expect(() => assertCapabilityTransport(undefined, 'normal', 'local-cli')).not.toThrow()
    expect(() => assertCapabilityTransport('http', 'read-only')).not.toThrow()
    expect(() => assertCapabilityTransport('acp', 'read-only')).not.toThrow()
    expect(() => assertCapabilityTransport('custom', 'read-only')).not.toThrow()
    expect(() => assertCapabilityTransport(undefined, 'read-only')).not.toThrow()
  })

  it('requests ACP permission except when dispatch is read-only', () => {
    expect(shouldRequestAcpPermission()).toBe(true)
    expect(shouldRequestAcpPermission('normal')).toBe(true)
    expect(shouldRequestAcpPermission('read-only')).toBe(false)
  })
})
