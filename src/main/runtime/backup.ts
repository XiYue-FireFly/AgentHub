/**
 * Backup: config and data backup/restore for AgentHub.
 *
 * Backs up store data (providers, MCP, memory, skills, etc.) to a
 * timestamped JSON file. Supports restore from a selected backup.
 * Backups are stored in the app's data directory under backups/.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

export interface BackupMeta {
  id: string
  filename: string
  createdAt: string
  sizeBytes: number
  /** Which store keys were included */
  keys: string[]
  version: string
}

export interface BackupData {
  version: 1
  createdAt: string
  appVersion: string
  store: Record<string, any>
}

const BACKUP_VERSION = '1.0.0'

/** Keys to include in backup (sensitive keys like API keys are encrypted in store). */
const BACKUP_KEYS = [
  'runtime.mcp.v1',
  'agentic.approval.v1',
  'agentic.config.v1',
  'prompts.library.v1',
  'workflows.library.v1',
  'usage.pricing.v1',
  'usage.ledger.v1',
  'appearance.v1',
  'workbench.runtime.v1'
]

/**
 * Create a backup of the current store state.
 * Returns the backup metadata.
 */
export function createBackup(
  storeGetAll: () => Record<string, any>,
  dataDir: string,
  appVersion: string
): BackupMeta {
  const backupDir = join(dataDir, 'backups')
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

  const allData = storeGetAll()
  const backupStore: Record<string, any> = {}
  const includedKeys: string[] = []

  for (const key of BACKUP_KEYS) {
    if (allData[key] !== undefined) {
      backupStore[key] = allData[key]
      includedKeys.push(key)
    }
  }

  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-')
  const filename = `agenthub-backup-${timestamp}.json`
  const filePath = join(backupDir, filename)

  const backup: BackupData = {
    version: 1,
    createdAt: now.toISOString(),
    appVersion,
    store: backupStore
  }

  const content = JSON.stringify(backup, null, 2)
  writeFileSync(filePath, content, 'utf-8')

  return {
    id: `backup-${now.getTime().toString(36)}`,
    filename,
    createdAt: now.toISOString(),
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
    keys: includedKeys,
    version: BACKUP_VERSION
  }
}

/**
 * List all available backups in the data directory.
 */
export function listBackups(dataDir: string): BackupMeta[] {
  const backupDir = join(dataDir, 'backups')
  if (!existsSync(backupDir)) return []

  const files = readdirSync(backupDir)
    .filter(f => f.startsWith('agenthub-backup-') && f.endsWith('.json'))
    .sort()
    .reverse()

  return files.map(filename => {
    const filePath = join(backupDir, filename)
    try {
      const stat = statSync(filePath)
      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      return {
        id: `backup-${stat.mtimeMs.toString(36)}`,
        filename,
        createdAt: data.createdAt || new Date(stat.mtimeMs).toISOString(),
        sizeBytes: stat.size,
        keys: Object.keys(data.store || {}),
        version: data.version?.toString() || 'unknown'
      }
    } catch {
      return {
        id: `backup-unknown`,
        filename,
        createdAt: new Date().toISOString(),
        sizeBytes: 0,
        keys: [],
        version: 'unknown'
      }
    }
  })
}

/**
 * Restore store data from a backup file.
 * Returns the keys that were restored.
 */
export function restoreBackup(
  dataDir: string,
  filename: string,
  storeSet: (key: string, value: any) => void
): { restored: string[]; error?: string } {
  const filePath = join(dataDir, 'backups', filename)
  if (!existsSync(filePath)) return { restored: [], error: `Backup file not found: ${filename}` }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const data: BackupData = JSON.parse(content)
    if (!data.store || typeof data.store !== 'object') {
      return { restored: [], error: 'Invalid backup: missing store data' }
    }

    const restored: string[] = []
    for (const [key, value] of Object.entries(data.store)) {
      if (BACKUP_KEYS.includes(key)) {
        storeSet(key, value)
        restored.push(key)
      }
    }
    return { restored }
  } catch (e: any) {
    return { restored: [], error: `Failed to read backup: ${e?.message}` }
  }
}

/**
 * Delete a backup file.
 */
export function deleteBackup(dataDir: string, filename: string): boolean {
  const filePath = join(dataDir, 'backups', filename)
  if (!existsSync(filePath)) return false
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}
