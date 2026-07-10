import { basename, extname } from 'node:path'

const SENSITIVE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.keystore', '.jks', '.ssh', '.ovpn', '.kdbx',
  // F-W5: common secret containers
  '.p8', '.ppk', '.asc', '.gpg', '.pgp'
])

const SENSITIVE_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.env.staging',
  '.npmrc',
  '.netrc',
  '.pypirc',
  // cloud / CI credentials basenames
  'credentials',
  'credentials.json',
  'service-account.json',
  'serviceaccount.json',
  'secrets.yaml',
  'secrets.yml',
  'secrets.json',
  'secret.yaml',
  'secret.yml',
  'authorized_keys',
  'known_hosts',
  'kubeconfig'
])

/** Directory markers: any file under these path segments is sensitive (F-W5) */
const SENSITIVE_DIR_MARKERS = [
  '/.aws/',
  '/.ssh/',
  '/.gnupg/',
  '/.docker/',
  '/.kube/',
  '/secrets/',
  '/.secrets/'
]

export function isSensitiveTextFilePath(filePath: string): boolean {
  const raw = filePath || ''
  const lowerPath = ('/' + raw.replace(/\\/g, '/').toLowerCase() + '/').replace(/\/+/g, '/')
  const fileName = basename(raw).toLowerCase()
  const ext = extname(fileName)

  if (SENSITIVE_EXTENSIONS.has(ext)) return true
  if (SENSITIVE_FILENAMES.has(fileName)) return true
  if (fileName.startsWith('.env.')) return true
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:$|[._-]|[a-z0-9])/.test(fileName)) return true

  // AWS config/credentials under ~/.aws
  if ((fileName === 'config' || fileName === 'credentials') && lowerPath.includes('/.aws/')) return true

  // Any file nested under known secret directories
  if (SENSITIVE_DIR_MARKERS.some(marker => lowerPath.includes(marker))) return true

  // Explicit token/secret basenames
  if (/(^|[._-])(access[_-]?token|api[_-]?key|private[_-]?key|secret[_-]?key)([._-]|$)/.test(fileName)) {
    return true
  }

  return false
}
