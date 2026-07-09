import { describe, expect, it } from 'vitest'
import { isSensitiveTextFilePath } from '../sensitive-files'

describe('sensitive IPC text file guard', () => {
  it('blocks secret-bearing filenames and extensions', () => {
    expect(isSensitiveTextFilePath('/workspace/.env')).toBe(true)
    expect(isSensitiveTextFilePath('/workspace/.env.production')).toBe(true)
    expect(isSensitiveTextFilePath('/workspace/.npmrc')).toBe(true)
    expect(isSensitiveTextFilePath('/workspace/.netrc')).toBe(true)
    expect(isSensitiveTextFilePath('/home/user/.ssh/id_rsa')).toBe(true)
    expect(isSensitiveTextFilePath('/home/user/.ssh/id_rsa.pub')).toBe(true)
    expect(isSensitiveTextFilePath('/home/user/.ssh/id_rsa_backup')).toBe(true)
    expect(isSensitiveTextFilePath('/home/user/.ssh/id_ed25519')).toBe(true)
    expect(isSensitiveTextFilePath('/workspace/cert.pem')).toBe(true)
    expect(isSensitiveTextFilePath('/workspace/private.key')).toBe(true)
  })

  it('blocks F-W5 expanded cloud/credential paths', () => {
    expect(isSensitiveTextFilePath('/home/user/.aws/credentials')).toBe(true)
    expect(isSensitiveTextFilePath('/home/user/.aws/config')).toBe(true)
    expect(isSensitiveTextFilePath('C:/Users/x/.kube/config')).toBe(true)
    expect(isSensitiveTextFilePath('/proj/secrets/db.yaml')).toBe(true)
    expect(isSensitiveTextFilePath('/proj/service-account.json')).toBe(true)
    expect(isSensitiveTextFilePath('/keys/token.p8')).toBe(true)
  })

  it('allows ordinary text and markdown files', () => {
    expect(isSensitiveTextFilePath('/workspace/README.md')).toBe(false)
    expect(isSensitiveTextFilePath('/workspace/src/env.ts')).toBe(false)
    expect(isSensitiveTextFilePath('/workspace/release..notes.md')).toBe(false)
    expect(isSensitiveTextFilePath('/workspace/config.json')).toBe(false)
  })
})
