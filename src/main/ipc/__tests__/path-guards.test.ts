import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPathInsideBase, resolvePathWithinAllowedBases, resolveWorkspaceRelativePath } from '../path-guards'

describe('IPC path guards', () => {
  const root = resolve(process.cwd(), 'tmp-workspace')
  const userData = resolve(process.cwd(), 'tmp-user-data')
  const home = resolve(process.cwd(), 'tmp-home')

  it('allows legal file names that contain two dots', () => {
    expect(resolveWorkspaceRelativePath(root, 'release..notes.md')).toBe(resolve(root, 'release..notes.md'))
    expect(resolveWorkspaceRelativePath(root, 'docs/v1..2/notes.md')).toBe(resolve(root, 'docs/v1..2/notes.md'))
    expect(resolvePathWithinAllowedBases('project..demo/README.md', root, [root, userData, home]))
      .toBe(resolve(root, 'project..demo/README.md'))
  })

  it('rejects relative and absolute traversal outside the allowed roots', () => {
    expect(resolveWorkspaceRelativePath(root, '../secret.txt')).toBeNull()
    expect(resolveWorkspaceRelativePath(root, 'docs/../../secret.txt')).toBeNull()
    expect(resolveWorkspaceRelativePath(root, resolve(root, 'inside.txt'))).toBeNull()
    expect(() => resolvePathWithinAllowedBases('../secret.txt', root, [root, userData]))
      .toThrow('Access denied')
    expect(() => resolvePathWithinAllowedBases(resolve(root, '..', 'secret.txt'), root, [root, userData]))
      .toThrow('Access denied')
  })

  it('does not allow path-prefix lookalikes outside the base', () => {
    expect(isPathInsideBase(resolve(root, 'file.txt'), root)).toBe(true)
    expect(isPathInsideBase(`${root}-copy`, root)).toBe(false)
  })
})
