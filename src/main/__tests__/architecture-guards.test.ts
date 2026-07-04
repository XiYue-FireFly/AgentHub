import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = join(__dirname, '..', '..')

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'out' || entry === 'dist' || entry === '__tests__') continue
      collectSourceFiles(full, acc)
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      acc.push(full)
    }
  }
  return acc
}

describe('architecture guards', () => {
  it('keeps renderer and preload code from importing main-process modules', () => {
    const roots = [join(SRC_ROOT, 'renderer'), join(SRC_ROOT, 'preload')]
    const offenders: string[] = []
    const importMainPattern = /\bfrom\s+['"][^'"]*(?:\.\.\/)+main(?:\/|['"])|import\([^)]*['"][^'"]*(?:\.\.\/)+main(?:\/|['"])/

    for (const root of roots) {
      for (const file of collectSourceFiles(root)) {
        const content = readFileSync(file, 'utf-8')
        if (importMainPattern.test(content)) {
          offenders.push(relative(SRC_ROOT, file))
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps new ipcMain.handle registrations inside the IPC layer', () => {
    const offenders: string[] = []
    const allowedOutsideIpc = new Set([
      'main' + sep + 'index.ts',
      'main' + sep + 'runtime' + sep + 'app-event-log.ts'
    ])

    for (const file of collectSourceFiles(join(SRC_ROOT, 'main'))) {
      const rel = relative(SRC_ROOT, file)
      if (!readFileSync(file, 'utf-8').includes('ipcMain.handle')) continue
      if (rel.startsWith('main' + sep + 'ipc' + sep)) continue
      if (allowedOutsideIpc.has(rel)) continue
      offenders.push(rel)
    }

    expect(offenders).toEqual([])
  })

  it('keeps IPC path traversal checks on resolved paths instead of raw path substrings', () => {
    const offenders: string[] = []
    const rawPathIncludesTraversal = /\b(?:path|filePath|rootPath|workspaceRoot|relPath|relativePath|resolvedPath)\.includes\(['"]\.\.['"]\)/

    for (const file of collectSourceFiles(join(SRC_ROOT, 'main', 'ipc'))) {
      const content = readFileSync(file, 'utf-8')
      if (rawPathIncludesTraversal.test(content)) {
        offenders.push(relative(SRC_ROOT, file))
      }
    }

    expect(offenders).toEqual([])
  })
})
