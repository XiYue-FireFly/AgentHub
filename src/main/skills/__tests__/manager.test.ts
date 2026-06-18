import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BUILTIN_SKILLS } from '../types'

/**
 * SkillManager 单测 — 覆盖：add/list、单独安装/卸载、'*' 集体安装、remove 级联清除安装表。
 * 经 vi.mock 把 store 换成内存对象（与 workspace.test.ts 同套路），与 electron 解耦。
 */

let store: Record<string, any>
let workspaceRoot: string | null = null

vi.mock('../../store', () => ({
  store: {
    get: (k: string) => store[k],
    set: (k: string, v: any) => { store[k] = v }
  }
}))

vi.mock('../../hub/workspace', () => ({
  getWorkspaceManager: () => ({
    getActive: () => 'workspace-1',
    getById: () => workspaceRoot ? { id: 'workspace-1', rootPath: workspaceRoot } : null
  })
}))

vi.mock('../../runtime/ecc-commands', () => ({ listEccCommands: () => [] }))
vi.mock('../../runtime/local-agents', () => ({
  detectLocalAgentStatuses: () => [],
  getCachedLocalAgentStatuses: () => []
}))
vi.mock('../../runtime/schedules', () => ({ listSchedules: () => [] }))

beforeEach(() => {
  store = {}
  workspaceRoot = null
})

describe('SkillManager', () => {
  it('add/list 读写一致', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'do A', tags: ['x'] })
    expect(s.id).toBeTruthy()
    expect(s.category.id).toBe('general')
    expect(m.list().map(x => x.name)).toContain('A')
    expect(m.get(s.id)?.instructions).toBe('do A')
  })

  it('built-in template category is saved when added', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add(BUILTIN_SKILLS[0])
    expect(s.category).toMatchObject({ id: 'coding' })
    expect(store['skills.v1'].skills[0].category).toMatchObject({ id: 'coding' })
  })

  it('ECC workflow builtin can be added, installed, and injected', async () => {
    const { getSkillManager } = await import('../manager')
    const { buildSkillBlock } = await import('../inject')
    const m = getSkillManager()
    const template = BUILTIN_SKILLS.find(skill => skill.source === 'ecc')
    expect(template).toMatchObject({
      name: 'ECC Workflow',
      category: { id: 'planning' },
      tags: expect.arrayContaining(['builtin', 'ecc', 'planning', 'testing', 'review', 'verification'])
    })
    const s = m.add(template!)
    expect(s.category).toMatchObject({ id: 'planning' })
    expect(s.source).toBe('ecc')

    m.install('codex', s.id)
    expect(m.installedFor('codex').map(skill => skill.id)).toEqual([s.id])
    expect(buildSkillBlock(m.installedFor('codex'))).toContain('ECC Workflow')
  })

  it('legacy skills without category remain readable', async () => {
    store['skills.v1'] = {
      version: 1,
      skills: [
        { id: 'legacy', name: 'Legacy', description: '', instructions: 'old', tags: [], source: 'paste', createdAt: 1, updatedAt: 1 }
      ],
      installs: {}
    }
    const { getSkillManager } = await import('../manager')
    expect(getSkillManager().get('legacy')?.category).toMatchObject({ id: 'general' })
  })

  it('单独安装/卸载 只影响目标 agent', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('codex', s.id)
    expect(m.isInstalled('codex', s.id)).toBe(true)
    expect(m.isInstalled('claude', s.id)).toBe(false)
    expect(m.installedFor('codex').map(x => x.id)).toEqual([s.id])
    m.uninstall('codex', s.id)
    expect(m.isInstalled('codex', s.id)).toBe(false)
  })

  it("'*' 集体安装覆盖所有 manifest agent", async () => {
    const { getSkillManager } = await import('../manager')
    const { AGENTS } = await import('../../hub/agents')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('*', s.id)
    for (const a of AGENTS) expect(m.isInstalled(a.id, s.id)).toBe(true)
  })

  it('install 未知技能为 no-op；不重复安装', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    m.install('codex', 'nope')
    expect(m.getInstalls().codex || []).not.toContain('nope')
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('codex', s.id)
    m.install('codex', s.id)
    expect((m.getInstalls().codex || []).filter(id => id === s.id)).toHaveLength(1)
  })

  it('remove 级联从安装表清除', async () => {
    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const s = m.add({ name: 'A', instructions: 'x' })
    m.install('*', s.id)
    expect(m.remove(s.id)).toBe(true)
    expect(m.list()).toHaveLength(0)
    expect(m.installedFor('codex')).toHaveLength(0)
  })

  it('scanLocal / importLocal 读取 category frontmatter 并导入', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'agenthub-skill-'))
    workspaceRoot = tempRoot
    const skillDir = join(tempRoot, '.agenthub', 'skills', 'writer')
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: Writer',
      'description: Draft writing helper',
      'category: writing',
      'tags: [docs, polish]',
      '---',
      '',
      '# Writer',
      'Write clearly.'
    ].join('\n'), 'utf-8')

    const { getSkillManager } = await import('../manager')
    const m = getSkillManager()
    const local = m.scanLocal()
    const candidate = local.find(item => item.sourcePath === skillPath)
    expect(candidate?.name).toBe('Writer')
    expect(candidate?.category.id).toBe('writing')

    const imported = m.importLocal(skillPath)
    expect(imported.category.id).toBe('writing')
    expect(store['skills.v1'].skills.find((skill: any) => skill.id === imported.id)?.category).toMatchObject({ id: 'writing' })
    expect(imported.tags).toContain('docs')
  })

  it('workbench skill commands expose category metadata', async () => {
    const { getSkillManager } = await import('../manager')
    const { listWorkbenchCommands } = await import('../../runtime/commands')
    const skill = getSkillManager().add({ name: 'Research Helper', category: 'research', instructions: 'Find sources' })
    const command = listWorkbenchCommands().find(item => item.id === `skill:${skill.id}`)
    expect(command?.payload?.category).toMatchObject({ id: 'research' })
  })
})
