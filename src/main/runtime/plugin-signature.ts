/**
 * Wave4+: plugin publisher signatures (ed25519 over SHA256SUMS).
 *
 * SIGNATURE file format (text):
 *   publisher: <publisher-id>
 *   algorithm: ed25519
 *   signature: <base64>
 *
 * Trust store: ~/.agenthub/plugin-trust.json
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type PluginSignatureStatus =
  | 'none'
  | 'ok'
  | 'untrusted'
  | 'invalid'
  | 'error'

export interface PluginSignatureResult {
  status: PluginSignatureStatus
  publisher?: string
  message?: string
}

export interface TrustedPublisher {
  id: string
  name?: string
  /** SPKI PEM public key */
  publicKeyPem: string
  addedAt?: string
}

export interface PluginTrustStore {
  version: 1
  publishers: TrustedPublisher[]
}

export function defaultTrustStorePath(): string {
  return join(homedir(), '.agenthub', 'plugin-trust.json')
}

export function loadTrustStore(path = defaultTrustStorePath()): PluginTrustStore {
  if (!existsSync(path)) return { version: 1, publishers: [] }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (!data || data.version !== 1 || !Array.isArray(data.publishers)) {
      return { version: 1, publishers: [] }
    }
    return {
      version: 1,
      publishers: data.publishers
        .filter((p: any) => p && typeof p.id === 'string' && typeof p.publicKeyPem === 'string')
        .map((p: any) => ({
          id: String(p.id).slice(0, 128),
          name: typeof p.name === 'string' ? p.name.slice(0, 256) : undefined,
          publicKeyPem: String(p.publicKeyPem),
          addedAt: typeof p.addedAt === 'string' ? p.addedAt : undefined
        }))
    }
  } catch {
    return { version: 1, publishers: [] }
  }
}

export function saveTrustStore(store: PluginTrustStore, path = defaultTrustStorePath()): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  renameSync(tmp, path)
}

export function addTrustedPublisher(
  publisher: TrustedPublisher,
  path = defaultTrustStorePath()
): PluginTrustStore {
  const store = loadTrustStore(path)
  const next = store.publishers.filter(p => p.id !== publisher.id)
  next.push({
    id: publisher.id,
    name: publisher.name,
    publicKeyPem: publisher.publicKeyPem,
    addedAt: publisher.addedAt || new Date().toISOString()
  })
  const updated = { version: 1 as const, publishers: next }
  saveTrustStore(updated, path)
  return updated
}

export function removeTrustedPublisher(id: string, path = defaultTrustStorePath()): PluginTrustStore {
  const store = loadTrustStore(path)
  const updated = { version: 1 as const, publishers: store.publishers.filter(p => p.id !== id) }
  saveTrustStore(updated, path)
  return updated
}

export function parseSignatureFile(content: string): { publisher: string; algorithm: string; signature: string } | null {
  const fields: Record<string, string> = {}
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    fields[key] = value
  }
  if (!fields.publisher || !fields.signature) return null
  return {
    publisher: fields.publisher,
    algorithm: (fields.algorithm || 'ed25519').toLowerCase(),
    signature: fields.signature
  }
}

export function signSha256Sums(sumsContent: string | Buffer, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem)
  const sig = sign(null, Buffer.from(sumsContent), key)
  return sig.toString('base64')
}

export function generatePublisherKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }
}

/**
 * Verify SIGNATURE against SHA256SUMS using trust store.
 * No SIGNATURE → status none.
 */
export function verifyPluginSignature(
  pluginDir: string,
  trustStore: PluginTrustStore = loadTrustStore()
): PluginSignatureResult {
  const sigPath = join(pluginDir, 'SIGNATURE')
  const sumsPath = join(pluginDir, 'SHA256SUMS')
  if (!existsSync(sigPath)) {
    return { status: 'none', message: 'No SIGNATURE file' }
  }
  if (!existsSync(sumsPath)) {
    return { status: 'error', message: 'SIGNATURE present but SHA256SUMS missing' }
  }

  let parsed: ReturnType<typeof parseSignatureFile>
  try {
    parsed = parseSignatureFile(readFileSync(sigPath, 'utf-8'))
  } catch (e: any) {
    return { status: 'error', message: e?.message || String(e) }
  }
  if (!parsed) return { status: 'invalid', message: 'Malformed SIGNATURE file' }
  if (parsed.algorithm !== 'ed25519') {
    return { status: 'invalid', message: `Unsupported algorithm: ${parsed.algorithm}`, publisher: parsed.publisher }
  }

  const trusted = trustStore.publishers.find(p => p.id === parsed!.publisher)
  if (!trusted) {
    return {
      status: 'untrusted',
      publisher: parsed.publisher,
      message: `Publisher not in trust store: ${parsed.publisher}`
    }
  }

  try {
    const sums = readFileSync(sumsPath)
    const sig = Buffer.from(parsed.signature, 'base64')
    const key: KeyObject = createPublicKey(trusted.publicKeyPem)
    const ok = verify(null, sums, key, sig)
    if (!ok) {
      return { status: 'invalid', publisher: parsed.publisher, message: 'Signature verification failed' }
    }
    return { status: 'ok', publisher: parsed.publisher, message: `Signed by ${trusted.name || trusted.id}` }
  } catch (e: any) {
    return { status: 'error', publisher: parsed.publisher, message: e?.message || String(e) }
  }
}

export function writeSignatureFile(
  pluginDir: string,
  publisherId: string,
  privateKeyPem: string
): void {
  const sumsPath = join(pluginDir, 'SHA256SUMS')
  const sums = readFileSync(sumsPath)
  const signature = signSha256Sums(sums, privateKeyPem)
  const body = [
    `publisher: ${publisherId}`,
    'algorithm: ed25519',
    `signature: ${signature}`,
    ''
  ].join('\n')
  writeFileSync(join(pluginDir, 'SIGNATURE'), body, 'utf-8')
}
