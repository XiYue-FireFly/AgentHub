import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSyncPlainPayload,
  encryptSyncPayload,
  decryptSyncPayload,
  exportEncryptedConfig,
  importEncryptedConfig,
  listSyncPackages,
  previewSyncPackage,
  parseSyncEnvelope
} from '../config-sync'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-config-sync-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('config-sync (Wave4 P2)', () => {
  const storeData = {
    'providers.config.v1': {
      providers: [{ id: 'p1', name: 'Test', apiKey: { ciphertext: 'enc-key', iv: 'iv' } }]
    },
    'appearance.v1': { themeMode: 'dark', language: 'zh' },
    'workbench.runtime.v1': { foo: 1 },
    'secret.should.skip': { nope: true }
  }

  it('encrypts and decrypts round-trip with correct passphrase', () => {
    const plain = buildSyncPlainPayload(() => storeData, '2.0.0')
    expect(plain.store['providers.config.v1']).toEqual(storeData['providers.config.v1'])
    expect(plain.store['secret.should.skip']).toBeUndefined()

    const env = encryptSyncPayload(plain, 'correct-horse-battery')
    expect(env.kind).toBe('agenthub-sync-v1')
    expect(env.ciphertext).toBeTruthy()
    expect(env.keys).toContain('appearance.v1')

    const restored = decryptSyncPayload(env, 'correct-horse-battery')
    expect(restored.store['appearance.v1']).toEqual(storeData['appearance.v1'])
    expect(restored.store['providers.config.v1']).toEqual(storeData['providers.config.v1'])
  })

  it('rejects wrong passphrase', () => {
    const plain = buildSyncPlainPayload(() => storeData, '2.0.0')
    const env = encryptSyncPayload(plain, 'correct-horse-battery')
    expect(() => decryptSyncPayload(env, 'wrong-passphrase!!')).toThrow(/wrong passphrase|Decryption failed/i)
  })

  it('rejects short passphrase', () => {
    const plain = buildSyncPlainPayload(() => storeData, '2.0.0')
    expect(() => encryptSyncPayload(plain, 'short')).toThrow(/at least 8/)
  })

  it('exports to file and imports keys atomically after decrypt', () => {
    const dataDir = tempDir()
    const exportResult = exportEncryptedConfig(() => storeData, dataDir, '2.0.0', 'export-pass-ok')
    expect(exportResult.ok).toBe(true)
    expect(exportResult.filename).toMatch(/^agenthub-sync-.+\.json$/)
    expect(existsSync(exportResult.path!)).toBe(true)

    const envelope = parseSyncEnvelope(readFileSync(exportResult.path!, 'utf-8'))
    expect(envelope.kind).toBe('agenthub-sync-v1')
    // Ciphertext must not contain plaintext theme string
    expect(envelope.ciphertext).not.toContain('themeMode')

    const listed = listSyncPackages(dataDir)
    expect(listed.some(i => i.filename === exportResult.filename)).toBe(true)

    const preview = previewSyncPackage(dataDir, exportResult.filename!)
    expect(preview.ok).toBe(true)
    expect(preview.keys).toContain('appearance.v1')

    const written: Record<string, unknown> = {}
    const importResult = importEncryptedConfig(
      dataDir,
      exportResult.filename!,
      'export-pass-ok',
      (key, value) => { written[key] = value }
    )
    expect(importResult.ok).toBe(true)
    expect(importResult.restored).toContain('providers.config.v1')
    expect(written['appearance.v1']).toEqual(storeData['appearance.v1'])
  })

  it('import with wrong passphrase does not write store keys', () => {
    const dataDir = tempDir()
    const exportResult = exportEncryptedConfig(() => storeData, dataDir, '2.0.0', 'export-pass-ok')
    const written: string[] = []
    const importResult = importEncryptedConfig(
      dataDir,
      exportResult.filename!,
      'bad-passphrase!',
      (key) => { written.push(key) }
    )
    expect(importResult.ok).toBe(false)
    expect(written).toHaveLength(0)
  })
})
