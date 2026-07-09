/**
 * Wave4+: WebDAV adapter for encrypted config sync packages.
 *
 * Uses HTTPS + Basic auth only. Password is never written to logs.
 * Push uploads the encrypted envelope; pull downloads then imports via config-sync.
 */

import { encryptSyncPayload, buildSyncPlainPayload, decryptSyncPayload, parseSyncEnvelope, SYNC_KEYS } from './config-sync'

export interface WebDavConfig {
  /** Base collection URL ending with / e.g. https://dav.example/remote.php/dav/files/u/agenthub/ */
  url: string
  username: string
  /** Plain password in memory only (store layer may encrypt at rest) */
  password: string
  /** Remote object name inside the collection */
  remoteFileName?: string
  enabled?: boolean
  /** Auto push interval minutes (0 = off) */
  autoSyncMinutes?: number
}

export interface WebDavStoredConfig {
  url: string
  username: string
  /** Prefer encrypted secret form from store; may be plain in tests */
  password: string
  remoteFileName?: string
  enabled?: boolean
  autoSyncMinutes?: number
}

export interface WebDavResult {
  ok: boolean
  status?: number
  error?: string
  bytes?: number
  remoteUrl?: string
  restored?: string[]
  keys?: string[]
}

const DEFAULT_REMOTE_FILE = 'agenthub-sync-latest.json'
const WEBDAV_CONFIG_KEY = 'sync.webdav.v1'

export function webdavConfigStoreKey(): string {
  return WEBDAV_CONFIG_KEY
}

export function normalizeWebDavConfig(input: Partial<WebDavConfig> | null | undefined): WebDavConfig | null {
  if (!input || typeof input !== 'object') return null
  const url = String(input.url || '').trim()
  const username = String(input.username || '').trim()
  const password = String(input.password || '')
  if (!url || !username) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const base = url.endsWith('/') ? url : url + '/'
  return {
    url: base,
    username,
    password,
    remoteFileName: sanitizeRemoteName(input.remoteFileName || DEFAULT_REMOTE_FILE),
    enabled: Boolean(input.enabled),
    autoSyncMinutes: clampMinutes(input.autoSyncMinutes)
  }
}

function sanitizeRemoteName(name: string): string {
  const base = String(name || DEFAULT_REMOTE_FILE).replace(/[/\\]/g, '')
  if (!base || base.includes('..')) return DEFAULT_REMOTE_FILE
  return base.endsWith('.json') ? base.slice(0, 180) : `${base.slice(0, 160)}.json`
}

function clampMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(24 * 60, Math.max(5, Math.floor(n)))
}

function remoteObjectUrl(config: WebDavConfig): string {
  return new URL(config.remoteFileName || DEFAULT_REMOTE_FILE, config.url).toString()
}

function authHeader(config: WebDavConfig): string {
  return 'Basic ' + Buffer.from(`${config.username}:${config.password}`, 'utf-8').toString('base64')
}

function validateConfig(config: WebDavConfig | null): string | null {
  if (!config) return 'Invalid WebDAV config (HTTPS url + username required)'
  if (!config.password) return 'WebDAV password is required'
  return null
}

/**
 * PROPFIND or GET test — confirms credentials and reachability.
 */
export async function testWebDav(configInput: Partial<WebDavConfig>): Promise<WebDavResult> {
  const config = normalizeWebDavConfig(configInput)
  const err = validateConfig(config)
  if (err || !config) return { ok: false, error: err || 'invalid config' }

  const remoteUrl = remoteObjectUrl(config)
  try {
    // Prefer HEAD/GET on collection parent; fall back to PROPFIND
    const res = await fetch(config.url, {
      method: 'PROPFIND',
      headers: {
        Authorization: authHeader(config),
        Depth: '0',
        'Content-Type': 'application/xml',
        'User-Agent': 'AgentHub-WebDAV/1.0'
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      signal: AbortSignal.timeout(20_000)
    })
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      // Some servers reject PROPFIND on collection — try GET remote (may 404 if empty)
      const getRes = await fetch(remoteUrl, {
        method: 'GET',
        headers: { Authorization: authHeader(config), 'User-Agent': 'AgentHub-WebDAV/1.0' },
        signal: AbortSignal.timeout(20_000)
      })
      if (getRes.status === 401 || getRes.status === 403) {
        return { ok: false, status: getRes.status, error: 'Authentication failed', remoteUrl }
      }
      // 404 means auth ok but file missing — still success for connectivity
      if (getRes.status === 404 || getRes.ok) {
        return { ok: true, status: getRes.status, remoteUrl }
      }
      return { ok: false, status: getRes.status, error: `HTTP ${getRes.status}`, remoteUrl }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'Authentication failed', remoteUrl }
    }
    if (!res.ok && res.status !== 207) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, remoteUrl }
    }
    return { ok: true, status: res.status, remoteUrl }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), remoteUrl }
  }
}

export async function webdavPut(configInput: Partial<WebDavConfig>, body: string): Promise<WebDavResult> {
  const config = normalizeWebDavConfig(configInput)
  const err = validateConfig(config)
  if (err || !config) return { ok: false, error: err || 'invalid config' }
  const remoteUrl = remoteObjectUrl(config)
  try {
    const res = await fetch(remoteUrl, {
      method: 'PUT',
      headers: {
        Authorization: authHeader(config),
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'AgentHub-WebDAV/1.0'
      },
      body,
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      return { ok: false, status: res.status, error: `PUT failed: HTTP ${res.status}`, remoteUrl }
    }
    return { ok: true, status: res.status, bytes: Buffer.byteLength(body, 'utf-8'), remoteUrl }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), remoteUrl }
  }
}

export async function webdavGet(configInput: Partial<WebDavConfig>): Promise<WebDavResult & { body?: string }> {
  const config = normalizeWebDavConfig(configInput)
  const err = validateConfig(config)
  if (err || !config) return { ok: false, error: err || 'invalid config' }
  const remoteUrl = remoteObjectUrl(config)
  try {
    const res = await fetch(remoteUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader(config),
        Accept: 'application/json',
        'User-Agent': 'AgentHub-WebDAV/1.0'
      },
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 404) return { ok: false, status: 404, error: 'Remote sync package not found', remoteUrl }
    if (!res.ok) return { ok: false, status: res.status, error: `GET failed: HTTP ${res.status}`, remoteUrl }
    const body = await res.text()
    return { ok: true, status: res.status, body, bytes: Buffer.byteLength(body, 'utf-8'), remoteUrl }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), remoteUrl }
  }
}

/**
 * Encrypt current store and PUT to WebDAV.
 */
export async function webdavPushEncrypted(
  configInput: Partial<WebDavConfig>,
  storeGetAll: () => Record<string, unknown>,
  appVersion: string,
  passphrase: string
): Promise<WebDavResult> {
  try {
    const plain = buildSyncPlainPayload(storeGetAll, appVersion)
    if (Object.keys(plain.store).length === 0) return { ok: false, error: 'No exportable configuration keys' }
    const envelope = encryptSyncPayload(plain, passphrase)
    const body = JSON.stringify(envelope)
    const put = await webdavPut(configInput, body)
    if (!put.ok) return put
    return { ...put, keys: envelope.keys }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * GET remote package, decrypt, write allowlisted keys.
 */
export async function webdavPullImport(
  configInput: Partial<WebDavConfig>,
  passphrase: string,
  storeSet: (key: string, value: unknown) => void
): Promise<WebDavResult> {
  const got = await webdavGet(configInput)
  if (!got.ok || !got.body) return { ok: false, error: got.error, status: got.status, remoteUrl: got.remoteUrl }
  try {
    const env = parseSyncEnvelope(got.body)
    const plain = decryptSyncPayload(env, passphrase)
    const restored: string[] = []
    for (const [key, value] of Object.entries(plain.store)) {
      if ((SYNC_KEYS as readonly string[]).includes(key)) {
        storeSet(key, value)
        restored.push(key)
      }
    }
    return { ok: true, restored, keys: restored, remoteUrl: got.remoteUrl, bytes: got.bytes }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), remoteUrl: got.remoteUrl }
  }
}

/** Redact password for UI/logs. */
export function redactWebDavConfig(config: WebDavStoredConfig | null | undefined): Omit<WebDavStoredConfig, 'password'> & { passwordSet: boolean } {
  if (!config) return { url: '', username: '', passwordSet: false }
  return {
    url: config.url || '',
    username: config.username || '',
    remoteFileName: config.remoteFileName,
    enabled: config.enabled,
    autoSyncMinutes: config.autoSyncMinutes,
    passwordSet: Boolean(config.password)
  }
}
