import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..', '..')

describe('version register', () => {
  it('matches package version, build version, and branch baseline', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'))
    const versionMd = readFileSync(join(REPO_ROOT, 'VERSION.md'), 'utf-8')
    const match = versionMd.match(/^Current code version:\s*(\S+)/m)
    const branchBaselines = versionMd
      .split(/\r?\n/)
      .filter(line => line.startsWith('Current branch baseline:'))

    expect(match?.[1]).toBe(pkg.version)
    expect(branchBaselines).toEqual(['Current branch baseline: main'])
    expect(pkg.build?.buildVersion).toBe(pkg.version)
  })
})
