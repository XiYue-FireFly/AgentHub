import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('RequirementsTab workspace root wiring', () => {
  const source = readFileSync(resolve(__dirname, 'RequirementsTab.tsx'), 'utf8')

  it('resolves workspaceId to a workspace root before opening SDD requirements', () => {
    expect(source).toContain('window.electronAPI.workspaces.list()')
    expect(source).toContain('workspace.id === workspaceId')
    expect(source).toContain('?.rootPath ?? null')
    expect(source).toContain('<SddRequirementsList workspaceRoot={workspaceRoot} />')
    expect(source).not.toContain('<SddRequirementsList workspaceRoot={workspaceId} />')
  })
})
