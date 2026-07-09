/**
 * Wave4 P2: password-encrypted config export/import for multi-machine migration.
 *
 * Uses scrypt + AES-256-GCM. Provider keys stay in store encryption form.
 * Wrong passphrase cannot decrypt. Import is atomic (tmp + rename for files).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export const SYNC_KIND = 'agenthub-sync-v1' as const
export const SYNC_PAYLOAD_VERSION = 1 as const

/** Keys included in cross-machine sync packages (aligned with backup allowlist). */
export const SYNC_KEYS = [
  'providers.config.v1',
  'runtime.mcp.v1',
  'agentic.approval.v1',
  'agentic.config.v1',
  'prompts.library.v1',
  'workflows.library.v1',
  'usage.pricing.v1',
  'appearance.v1',
  'workbench.runtime.v1'
] as const

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16
const IV_LEN = 12

export interface SyncPackageEnvelope {
  version: typeof SYNC_PAYLOAD_VERSION
  kind: typeof SYNC_KIND
  createdAt: string
  appVersion: string
  salt: string
  iv: string
  tag: string
  ciphertext: string
  /** Non-sensitive preview of keys sealed inside */
  keys: string[]
}

export interface SyncPlainPayload {
  version: typeof SYNC_PAYLOAD_VERSION
  createdAt: string
  appVersion: string
  store: Record<string, unknown>
}

export interface SyncExportResult {
  ok: boolean
  filename?: string
  path?: string
  keys?: string[]
  error?: string
}

export interface SyncImportResult {
  ok: boolean
  restored?: string[]
  error?: string
}

export interface SyncPreviewResult {
  ok: boolean
  keys?: string[]
  createdAt?: string
  appVersion?: string
  error?: string
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
}

function assertPassphrase(passphrase: string): string | null {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    return 'Passphrase must be at least 8 characters'
  }
  if (passphrase.length > 256) return 'Passphrase is too long'
  return null
}

/**
 * Build plaintext sync payload from store snapshot (sensitive keys stay as stored).
 */
export function buildSyncPlainPayload(
  storeGetAll: () => Record<string, unknown>,
  appVersion: string
): SyncPlainPayload {
  const all = storeGetAll() || {}
  const store: Record<string, unknown> = {}
  for (const key of SYNC_KEYS) {
    if (all[key] !== undefined) store[key] = all[key]
  }
  return {
    version: SYNC_PAYLOAD_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: appVersion || '0.0.0',
    store
  }
}

/**
 * Encrypt a plain payload with user passphrase → envelope JSON-serializable object.
 */
export function encryptSyncPayload(plain: SyncPlainPayload, passphrase: string): SyncPackageEnvelope {
  const err = assertPassphrase(passphrase)
  if (err) throw new Error(err)

  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf-8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: SYNC_PAYLOAD_VERSION,
    kind: SYNC_KIND,
    createdAt: plain.createdAt,
    appVersion: plain.appVersion,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keys: Object.keys(plain.store)
  }
}

/**
 * Decrypt envelope with passphrase. Throws or returns error on wrong passphrase.
 */
export function decryptSyncPayload(envelope: SyncPackageEnvelope, passphrase: string): SyncPlainPayload {
  const err = assertPassphrase(passphrase)
  if (err) throw new Error(err)
  if (!envelope || envelope.kind !== SYNC_KIND || envelope.version !== SYNC_PAYLOAD_VERSION) {
    throw new Error('Invalid sync package format')
  }

  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  if (salt.length !== SALT_LEN || iv.length !== IV_LEN || tag.length !== 16) {
    throw new Error('Invalid sync package crypto parameters')
  }

  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    const plainBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const parsed = JSON.parse(plainBuf.toString('utf-8')) as SyncPlainPayload
    if (!parsed?.store || typeof parsed.store !== 'object') {
      throw new Error('Decrypted payload missing store')
    }
    return parsed
  } catch (e: any) {
    if (e?.message === 'Decrypted payload missing store') throw e
    throw new Error('Decryption failed: wrong passphrase or corrupted package')
  }
}

export function parseSyncEnvelope(raw: string | object): SyncPackageEnvelope {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!data || typeof data !== 'object') throw new Error('Invalid sync package JSON')
  const env = data as SyncPackageEnvelope
  if (env.kind !== SYNC_KIND) throw new Error('Not an AgentHub sync package')
  if (env.version !== SYNC_PAYLOAD_VERSION) throw new Error(`Unsupported sync package version: ${env.version}`)
  if (typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.tag !== 'string' || typeof env.ciphertext !== 'string') {
    throw new Error('Sync package missing crypto fields')
  }
  return env
}

export function previewSyncEnvelope(envelope: SyncPackageEnvelope): SyncPreviewResult {
  return {
    ok: true,
    keys: Array.isArray(envelope.keys) ? envelope.keys : [],
    createdAt: envelope.createdAt,
    appVersion: envelope.appVersion
  }
}

function syncDir(dataDir: string): string {
  return join(dataDir, 'sync-exports')
}

function safeFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return false
  return /^agenthub-sync-.+\.json$/i.test(filename)
}

/**
 * Encrypt current store and write to dataDir/sync-exports/.
 */
export function exportEncryptedConfig(
  storeGetAll: () => Record<string, unknown>,
  dataDir: string,
  appVersion: string,
  passphrase: string
): SyncExportResult {
  try {
    const passErr = assertPassphrase(passphrase)
    if (passErr) return { ok: false, error: passErr }

    const plain = buildSyncPlainPayload(storeGetAll, appVersion)
    if (Object.keys(plain.store).length === 0) {
      return { ok: false, error: 'No exportable configuration keys found' }
    }
    const envelope = encryptSyncPayload(plain, passphrase)
    const dir = syncDir(dataDir)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `agenthub-sync-${timestamp}.json`
    const filePath = join(dir, filename)
    const content = JSON.stringify(envelope, null, 2)
    const tmpPath = filePath + '.tmp'
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, filePath)

    return {
      ok: true,
      filename,
      path: filePath,
      keys: envelope.keys
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function listSyncPackages(dataDir: string): Array<{ filename: string; createdAt: string; sizeBytes: number; keys: string[] }> {
  try {
    const dir = syncDir(dataDir)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => safeFilename(f))
      .sort()
      .reverse()
      .map(filename => {
        const filePath = join(dir, filename)
        try {
          const stat = statSync(filePath)
          const env = parseSyncEnvelope(readFileSync(filePath, 'utf-8'))
          return {
            filename,
            createdAt: env.createdAt || new Date(stat.mtimeMs).toISOString(),
            sizeBytes: stat.size,
            keys: env.keys || []
          }
        } catch {
          return { filename, createdAt: new Date().toISOString(), sizeBytes: 0, keys: [] }
        }
      })
  } catch {
    return []
  }
}

export function previewSyncPackage(dataDir: string, filename: string): SyncPreviewResult {
  if (!safeFilename(filename)) return { ok: false, error: 'Invalid sync package filename' }
  const filePath = join(syncDir(dataDir), filename)
  if (!existsSync(filePath)) return { ok: false, error: `Sync package not found: ${filename}` }
  try {
    const env = parseSyncEnvelope(readFileSync(filePath, 'utf-8'))
    return previewSyncEnvelope(env)
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * Import encrypted package and write allowed keys via storeSet.
 * Does not partially apply: decrypt fully first, then set keys.
 */
export function importEncryptedConfig(
  dataDir: string,
  filename: string,
  passphrase: string,
  storeSet: (key: string, value: unknown) => void
): SyncImportResult {
  if (!safeFilename(filename)) return { ok: false, error: 'Invalid sync package filename' }
  const filePath = join(syncDir(dataDir), filename)
  if (!existsSync(filePath)) return { ok: false, error: `Sync package not found: ${filename}` }

  try {
    const env = parseSyncEnvelope(readFileSync(filePath, 'utf-8'))
    const plain = decryptSyncPayload(env, passphrase)
    const restored: string[] = []
    for (const [key, value] of Object.entries(plain.store)) {
      if ((SYNC_KEYS as readonly string[]).includes(key)) {
        storeSet(key, value)
        restored.push(key)
      }
    }
    return { ok: true, restored }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function deleteSyncPackage(dataDir: string, filename: string): boolean {
  if (!safeFilename(filename)) return false
  const filePath = join(syncDir(dataDir), filename)
  if (!existsSync(filePath)) return false
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}


