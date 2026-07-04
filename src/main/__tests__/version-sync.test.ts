import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..', '..')

describe('version register', () => {
  it('matches package version and build version', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'))
    const versionMd = readFileSync(join(REPO_ROOT, 'VERSION.md'), 'utf-8')
    const match = versionMd.match(/^Current code version:\s*(\S+)/m)

    expect(match?.[1]).toBe(pkg.version)
    expect(pkg.build?.buildVersion).toBe(pkg.version)
  })
})
