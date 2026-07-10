import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addTrustedPublisher,
  generatePublisherKeyPair,
  loadTrustStore,
  verifyPluginSignature,
  writeSignatureFile
} from '../plugin-signature'
import { verifyPluginIntegrity } from '../plugin-manager'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-sig-'))
  roots.push(dir)
  return dir
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('plugin-signature', () => {
  it('verifies ed25519 signature over SHA256SUMS with trust store', () => {
    const pluginDir = tempDir()
    const trustPath = join(tempDir(), 'trust.json')
    const keys = generatePublisherKeyPair()
    addTrustedPublisher({ id: 'acme', name: 'Acme', publicKeyPem: keys.publicKeyPem }, trustPath)

    const manifest = JSON.stringify({ name: 'Signed Plugin', version: '1.0.0' })
    writeFileSync(join(pluginDir, 'manifest.json'), manifest, 'utf-8')
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${sha256(manifest)}  manifest.json\n`, 'utf-8')
    writeSignatureFile(pluginDir, 'acme', keys.privateKeyPem)

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(integrity.status).toBe('ok')

    const sig = verifyPluginSignature(pluginDir, loadTrustStore(trustPath))
    expect(sig.status).toBe('ok')
    expect(sig.publisher).toBe('acme')
  })

  it('reports untrusted publisher', () => {
    const pluginDir = tempDir()
    const trustPath = join(tempDir(), 'trust-empty.json')
    const keys = generatePublisherKeyPair()
    const manifest = JSON.stringify({ name: 'X', version: '1.0.0' })
    writeFileSync(join(pluginDir, 'manifest.json'), manifest, 'utf-8')
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${sha256(manifest)}  manifest.json\n`, 'utf-8')
    writeSignatureFile(pluginDir, 'unknown-pub', keys.privateKeyPem)

    const sig = verifyPluginSignature(pluginDir, loadTrustStore(trustPath))
    expect(sig.status).toBe('untrusted')
  })

  it('detects invalid signature after tamper', () => {
    const pluginDir = tempDir()
    const trustPath = join(tempDir(), 'trust.json')
    const keys = generatePublisherKeyPair()
    addTrustedPublisher({ id: 'acme', publicKeyPem: keys.publicKeyPem }, trustPath)

    const manifest = JSON.stringify({ name: 'X', version: '1.0.0' })
    writeFileSync(join(pluginDir, 'manifest.json'), manifest, 'utf-8')
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${sha256(manifest)}  manifest.json\n`, 'utf-8')
    writeSignatureFile(pluginDir, 'acme', keys.privateKeyPem)

    // Tamper sums without re-signing
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${'ab'.repeat(32)}  manifest.json\n`, 'utf-8')
    const sig = verifyPluginSignature(pluginDir, loadTrustStore(trustPath))
    expect(sig.status).toBe('invalid')
  })

  it('returns none when SIGNATURE missing', () => {
    const pluginDir = tempDir()
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'manifest.json'), '{}', 'utf-8')
    expect(verifyPluginSignature(pluginDir).status).toBe('none')
  })
})
