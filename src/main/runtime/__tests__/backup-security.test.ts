import { describe, expect, it, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'

const tmpDir = join(process.cwd(), 'test-tmp-backup-security')

describe('backup security', () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
    mkdirSync(tmpDir, { recursive: true })
  })

  it('backup does not contain plaintext API keys', async () => {
    const { createBackup } = await import('../backup')

    const encryptedApiKey = 'encrypted:sk-abc123def456'
    const storeData = {
      'providers.config.v1': {
        providers: [
          { id: 'openai', name: 'OpenAI', apiKey: encryptedApiKey },
          { id: 'anthropic', name: 'Anthropic', apiKey: 'encrypted:sk-ant-xyz789' }
        ]
      },
      'appearance.v1': { theme: 'dark' }
    }

    const result = createBackup(() => storeData, tmpDir, '1.0.0')
    expect(result.error).toBeUndefined()

    // Read the backup file
    const backupPath = join(tmpDir, 'backups', result.filename)
    expect(existsSync(backupPath)).toBe(true)

    const content = readFileSync(backupPath, 'utf-8')
    const backup = JSON.parse(content)

    // API keys should remain in encrypted form
    const provider = backup.store['providers.config.v1'].providers[0]
    expect(provider.apiKey).toBe(encryptedApiKey)
    expect(provider.apiKey).not.toBe('sk-abc123def456')  // Should not be decrypted
  })

  it('backup preserves all store keys as-is', async () => {
    const { createBackup } = await import('../backup')

    const storeData = {
      'providers.config.v1': {
        providers: [{ id: 'test', apiKey: 'encrypted:key123' }]
      },
      'runtime.mcp.v1': { servers: [] },
      'appearance.v1': { theme: 'light' }
    }

    const result = createBackup(() => storeData, tmpDir, '1.0.0')
    expect(result.error).toBeUndefined()
    expect(result.keys).toContain('providers.config.v1')
    expect(result.keys).toContain('runtime.mcp.v1')
    expect(result.keys).toContain('appearance.v1')

    // Read the backup file
    const backupPath = join(tmpDir, 'backups', result.filename)
    const content = readFileSync(backupPath, 'utf-8')
    const backup = JSON.parse(content)

    // All values should be preserved exactly as-is
    expect(backup.store['providers.config.v1']).toEqual(storeData['providers.config.v1'])
    expect(backup.store['runtime.mcp.v1']).toEqual(storeData['runtime.mcp.v1'])
    expect(backup.store['appearance.v1']).toEqual(storeData['appearance.v1'])
  })
})
