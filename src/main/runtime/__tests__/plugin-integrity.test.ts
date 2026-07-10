import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanPlugins, verifyPluginIntegrity } from '../plugin-manager'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-plugin-integrity-'))
  roots.push(root)
  return root
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('plugin integrity (Wave4 P1)', () => {
  it('marks plugins without SHA256SUMS as unsigned and enabled', () => {
    const root = tempRoot()
    const pluginDir = join(root, '.agenthub', 'plain-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({
      name: 'Plain',
      version: '1.0.0',
      contributes: { commands: [{ id: 'x', label: 'X' }] }
    }), 'utf-8')

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(integrity.status).toBe('unsigned')

    const plugins = scanPlugins(root).filter(p => p.source === 'local')
    expect(plugins).toHaveLength(1)
    expect(plugins[0].integrity?.status).toBe('unsigned')
    expect(plugins[0].enabled).toBe(true)
  })

  it('verifies matching SHA256SUMS as ok', () => {
    const root = tempRoot()
    const pluginDir = join(root, '.agenthub', 'signed-plugin')
    mkdirSync(pluginDir, { recursive: true })
    const manifest = JSON.stringify({
      name: 'Signed',
      version: '1.0.0',
      contributes: { prompts: [{ id: 'p', name: 'P', body: 'hi' }] }
    })
    writeFileSync(join(pluginDir, 'manifest.json'), manifest, 'utf-8')
    const hash = sha256(manifest)
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${hash}  manifest.json\n`, 'utf-8')

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(integrity.status).toBe('ok')
    expect(integrity.checkedFiles).toBe(1)

    const plugins = scanPlugins(root).filter(p => p.source === 'local')
    expect(plugins[0].integrity?.status).toBe('ok')
    expect(plugins[0].enabled).toBe(true)
  })

  it('disables plugins when content is tampered', () => {
    const root = tempRoot()
    const pluginDir = join(root, '.agenthub', 'tampered-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({
      name: 'Tampered',
      version: '1.0.0'
    }), 'utf-8')
    // Wrong hash on purpose
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${'ab'.repeat(32)}  manifest.json\n`, 'utf-8')

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(integrity.status).toBe('mismatch')
    expect(integrity.failedFiles).toContain('manifest.json')

    const plugins = scanPlugins(root).filter(p => p.source === 'local')
    expect(plugins[0].enabled).toBe(false)
    expect(plugins[0].integrity?.status).toBe('mismatch')
  })

  it('reports missing files listed in SHA256SUMS', () => {
    const root = tempRoot()
    const pluginDir = join(root, '.agenthub', 'missing-plugin')
    mkdirSync(pluginDir, { recursive: true })
    const manifest = JSON.stringify({ name: 'Missing', version: '1.0.0' })
    writeFileSync(join(pluginDir, 'manifest.json'), manifest, 'utf-8')
    // Cover manifest correctly; list an extra file that does not exist
    writeFileSync(
      join(pluginDir, 'SHA256SUMS'),
      `${sha256(manifest)}  manifest.json\n${'cd'.repeat(32)}  gone.txt\n`,
      'utf-8'
    )

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(integrity.status).toBe('missing')
    expect(integrity.failedFiles).toContain('gone.txt')
  })

  it('rejects path traversal entries in SHA256SUMS', () => {
    const root = tempRoot()
    const pluginDir = join(root, '.agenthub', 'escape-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify({ name: 'Escape', version: '1.0.0' }), 'utf-8')
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${'ef'.repeat(32)}  ../outside.txt\n`, 'utf-8')

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(['mismatch', 'missing', 'error']).toContain(integrity.status)
    expect(integrity.failedFiles?.length).toBeGreaterThan(0)
  })

  it('fails when SKILL.md exists but is not listed in SHA256SUMS', () => {
    const root = tempRoot()
    const pluginDir = join(root, '.agenthub', 'partial-sums')
    const skillDir = join(pluginDir, 'skills', 'sneaky')
    mkdirSync(skillDir, { recursive: true })
    const manifest = JSON.stringify({ name: 'Partial', version: '1.0.0' })
    writeFileSync(join(pluginDir, 'manifest.json'), manifest, 'utf-8')
    writeFileSync(join(skillDir, 'SKILL.md'), '# sneaky\n', 'utf-8')
    // Only cover manifest — skill intentionally omitted
    writeFileSync(join(pluginDir, 'SHA256SUMS'), `${sha256(manifest)}  manifest.json\n`, 'utf-8')

    const integrity = verifyPluginIntegrity(pluginDir)
    expect(integrity.status).toBe('mismatch')
    expect(integrity.failedFiles?.some(f => f.includes('SKILL.md'))).toBe(true)
  })
})
