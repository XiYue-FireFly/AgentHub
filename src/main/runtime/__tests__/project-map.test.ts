import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildProjectMap, flattenProjectMap, searchProjectFiles } from '../project-map'

describe('project-map', () => {
  function makeTestDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agenthub-pm-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'main.ts'), 'console.log("hello")')
    writeFileSync(join(dir, 'src', 'utils.ts'), 'export const x = 1')
    writeFileSync(join(dir, 'package.json'), '{"name":"test"}')
    writeFileSync(join(dir, 'README.md'), '# Test')
    mkdirSync(join(dir, 'src', 'components'))
    writeFileSync(join(dir, 'src', 'components', 'App.tsx'), '<div>App</div>')
    return dir
  }

  it('builds project map from directory', () => {
    const dir = makeTestDir()
    const map = buildProjectMap(dir)
    expect(map).not.toBeNull()
    expect(map!.stats.totalFiles).toBe(5)
    expect(map!.stats.totalDirectories).toBe(2)
    expect(map!.stats.languages['TypeScript']).toBe(2)
  })

  it('flattens tree to file list', () => {
    const dir = makeTestDir()
    const map = buildProjectMap(dir)!
    const files = flattenProjectMap(map)
    expect(files.length).toBe(5)
    expect(files.some(f => f.endsWith('main.ts'))).toBe(true)
  })

  it('searches files by name', () => {
    const dir = makeTestDir()
    const map = buildProjectMap(dir)!
    const results = searchProjectFiles(map, 'main')
    expect(results.length).toBe(1)
    expect(results[0].name).toBe('main.ts')
  })

  it('ignores node_modules', () => {
    const dir = makeTestDir()
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'dep.js'), '// ignored')
    const map = buildProjectMap(dir)!
    expect(map.stats.totalFiles).toBe(5) // dep.js not counted
  })

  it('returns null for non-existent directory', () => {
    expect(buildProjectMap('/nonexistent/path')).toBeNull()
  })
})
