import { describe, expect, it } from 'vitest'
import { diagnoseProviders } from '../provider-doctor'

describe('provider-doctor (IT-2)', () => {
  it('marks ready enabled providers as ok', () => {
    const report = diagnoseProviders([
      {
        id: 'openai',
        name: 'OpenAI',
        enabled: true,
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o' }]
      }
    ], new Date('2026-07-10T00:00:00.000Z'))
    expect(report.overall).toBe('ok')
    expect(report.summary.enabled).toBe(1)
    expect(report.providers[0].findings.some(f => f.code === 'ready')).toBe(true)
    expect(report.checkedAt).toBe('2026-07-10T00:00:00.000Z')
  })

  it('errors on missing key and invalid url', () => {
    const report = diagnoseProviders([
      { id: 'p1', enabled: true, apiKey: '', baseUrl: 'not-a-url', models: [] },
      { id: 'p2', enabled: true, apiKey: 'enc:v1:abc', apiKeyLocked: true, models: [{ id: 'm' }] }
    ])
    expect(report.overall).toBe('error')
    expect(report.summary.error).toBeGreaterThanOrEqual(1)
    const codes = report.providers.flatMap(p => p.findings.map(f => f.code))
    expect(codes).toContain('missing_api_key')
    expect(codes).toContain('invalid_base_url')
    expect(codes).toContain('api_key_locked')
  })

  it('warns on insecure non-local http and empty models', () => {
    const report = diagnoseProviders([
      {
        id: 'proxy',
        enabled: true,
        apiKey: 'sk-xxxx',
        baseUrl: 'http://example.com/v1',
        models: []
      }
    ])
    expect(report.overall).toBe('warn')
    const codes = report.providers[0].findings.map(f => f.code)
    expect(codes).toContain('insecure_base_url')
    expect(codes).toContain('no_models')
  })

  it('treats disabled providers as ok/disabled without requiring keys', () => {
    const report = diagnoseProviders([{ id: 'off', enabled: false }])
    expect(report.providers[0].severity).toBe('ok')
    expect(report.providers[0].findings.some(f => f.code === 'disabled')).toBe(true)
  })
})
