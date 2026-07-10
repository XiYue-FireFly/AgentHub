import { describe, expect, it } from 'vitest'
import { buildSupportBundle, serializeSupportBundle } from '../support-bundle'

describe('support-bundle (IT-3)', () => {
  it('builds redacted bundle without secrets', () => {
    const bundle = buildSupportBundle({
      appVersion: '2.0.0',
      platform: 'win32',
      nodeVersion: 'v24.0.0',
      diagnosticsOverall: 'healthy',
      diagnosticChecks: [{ id: 'disk', status: 'pass', message: 'ok' }],
      providers: [
        { id: 'openai', enabled: true, name: 'OpenAI' },
        { id: 'local', enabled: false }
      ],
      providerDoctorOverall: 'warn',
      pluginScan: [
        { id: 'a', enabled: true, integrity: { status: 'ok' }, signature: { status: 'none' } },
        { id: 'b', enabled: false, integrity: { status: 'mismatch' }, signature: { status: 'invalid' } }
      ],
      threadCount: 3,
      turnCount: 10,
      recentEventKinds: ['turn:created', 'stream'],
      headlessRunCount: 2,
      extra: { branch: 'feat/w4-impl' }
    }, new Date('2026-07-10T12:00:00.000Z'))

    expect(bundle.kind).toBe('agenthub-support-bundle-v1')
    expect(bundle.appVersion).toBe('2.0.0')
    expect(bundle.providers.total).toBe(2)
    expect(bundle.providers.enabled).toBe(1)
    expect(bundle.plugins.integrity.ok).toBe(1)
    expect(bundle.plugins.integrity.mismatch).toBe(1)
    expect(bundle.workbench.threadCount).toBe(3)
    expect(bundle.extra.branch).toBe('feat/w4-impl')

    const json = serializeSupportBundle(bundle)
    expect(json).toContain('agenthub-support-bundle-v1')
    expect(json).not.toMatch(/sk-[a-zA-Z0-9]{10,}/)
    expect(json).not.toContain('apiKey')
  })

  it('handles empty input safely', () => {
    const bundle = buildSupportBundle()
    expect(bundle.providers.total).toBe(0)
    expect(bundle.plugins.total).toBe(0)
    expect(bundle.diagnostics.overall).toBe('unknown')
  })

  it('redacts secrets injected via extra', () => {
    const bundle = buildSupportBundle({
      extra: {
        apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
        password: 'hunter2',
        note: 'safe-note',
        token: 'Bearer abc'
      }
    })
    const json = serializeSupportBundle(bundle)
    expect(json).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(json).not.toContain('hunter2')
    expect(json).not.toContain('apiKey')
    expect(json).toContain('safe-note')
  })
})
