import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  normalizeWebDavConfig,
  redactWebDavConfig,
  testWebDav,
  webdavPushEncrypted,
  webdavPullImport,
  webdavPut,
  webdavGet
} from '../webdav-sync'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('webdav-sync', () => {
  it('normalizes HTTPS config and rejects non-https', () => {
    expect(normalizeWebDavConfig({ url: 'http://dav.example/', username: 'u', password: 'p' })).toBeNull()
    const cfg = normalizeWebDavConfig({ url: 'https://dav.example/files', username: 'u', password: 'p' })
    expect(cfg?.url.endsWith('/')).toBe(true)
    expect(cfg?.remoteFileName).toMatch(/\.json$/)
  })

  it('redacts password in view model', () => {
    const view = redactWebDavConfig({ url: 'https://x/', username: 'u', password: 'secret' })
    expect(view.passwordSet).toBe(true)
    expect((view as any).password).toBeUndefined()
  })

  it('push then pull round-trip with mocked fetch', async () => {
    let storedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'PUT') {
        storedBody = String(init?.body || '')
        return new Response(null, { status: 201 })
      }
      if (method === 'GET') {
        if (!storedBody) return new Response('missing', { status: 404 })
        return new Response(storedBody, { status: 200 })
      }
      if (method === 'PROPFIND') return new Response('<ok/>', { status: 207 })
      return new Response('nope', { status: 405 })
    }))

    const config = {
      url: 'https://dav.example/remote/',
      username: 'user',
      password: 'pass'
    }
    const store = {
      'appearance.v1': { themeMode: 'dark' },
      'workbench.runtime.v1': { x: 1 }
    }

    const push = await webdavPushEncrypted(config, () => store, '2.0.0', 'sync-pass-ok')
    expect(push.ok).toBe(true)
    expect(storedBody).toContain('agenthub-sync-v1')
    expect(storedBody).not.toContain('themeMode')

    const written: Record<string, unknown> = {}
    const pull = await webdavPullImport(config, 'sync-pass-ok', (k, v) => { written[k] = v })
    expect(pull.ok).toBe(true)
    expect(written['appearance.v1']).toEqual(store['appearance.v1'])
  })

  it('pull with wrong passphrase does not write keys', async () => {
    let storedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'PUT') {
        storedBody = String(init?.body || '')
        return new Response(null, { status: 201 })
      }
      if (method === 'GET') return new Response(storedBody, { status: 200 })
      return new Response('', { status: 207 })
    }))

    const config = { url: 'https://dav.example/remote/', username: 'u', password: 'p' }
    await webdavPushEncrypted(config, () => ({ 'appearance.v1': { a: 1 } }), '2.0.0', 'good-passphrase')
    const written: string[] = []
    const pull = await webdavPullImport(config, 'bad-passphrase!', (k) => written.push(k))
    expect(pull.ok).toBe(false)
    expect(written).toHaveLength(0)
  })

  it('testWebDav treats 404 on empty remote as connectivity success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method || '').toUpperCase() === 'PROPFIND') return new Response('', { status: 405 })
      return new Response('', { status: 404 })
    }))
    const result = await testWebDav({ url: 'https://dav.example/r/', username: 'u', password: 'p' })
    expect(result.ok).toBe(true)
  })

  it('webdavPut/Get low-level', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method || '').toUpperCase() === 'PUT') return new Response(null, { status: 204 })
      return new Response('{"hello":1}', { status: 200 })
    }))
    const cfg = { url: 'https://dav.example/r/', username: 'u', password: 'p' }
    expect((await webdavPut(cfg, '{"a":1}')).ok).toBe(true)
    const got = await webdavGet(cfg)
    expect(got.ok).toBe(true)
    expect(got.body).toContain('hello')
  })
})
