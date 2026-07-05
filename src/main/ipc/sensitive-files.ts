import { basename, extname } from 'node:path'

const SENSITIVE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.keystore', '.jks', '.ssh', '.ovpn', '.kdbx'
])

const SENSITIVE_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.npmrc',
  '.netrc',
  '.pypirc'
])

export function isSensitiveTextFilePath(filePath: string): boolean {
  const fileName = basename(filePath || '').toLowerCase()
  const ext = extname(fileName)
  if (SENSITIVE_EXTENSIONS.has(ext)) return true
  if (SENSITIVE_FILENAMES.has(fileName)) return true
  if (fileName.startsWith('.env.')) return true
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:$|[._-]|[a-z0-9])/.test(fileName)) return true
  return false
}
