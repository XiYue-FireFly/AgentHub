/**
 * SkillManager —— 技能注册 + 按 agent 的安装状态（单例，落盘 store key `skills.v1`）。
 * 形态镜像 WorkspaceManager（src/main/hub/workspace.ts）。
 *
 * 不变量：
 *   - 落盘形状 { version: 1, skills: SkillDef[], installs: Record<agentId, skillId[]> }
 *   - remove(skillId) 同时从所有 agent 的 installs 中清除该 skill
 *   - install/uninstall 的 agentId 传 '*' = 对所有 manifest 已知 agent 批量操作（集体安装）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { store } from '../store'
import { AGENTS } from '../hub/agents'
import { getWorkspaceManager } from '../hub/workspace'
import { SkillCategory, SkillDef, SkillInput, SkillInstalls, inferSkillCategory, normalizeSkillCategory } from './types'
import type { LocalSkillCandidate } from '../runtime/types'

const STORAGE_KEY = 'skills.v1'

interface PersistedShape {
  version: 1
  skills: SkillDef[]
  installs: SkillInstalls
}

type CategorizedLocalSkillCandidate = LocalSkillCandidate & { category: SkillCategory }

function emptyState(): PersistedShape {
  return { version: 1, skills: [], installs: {} }
}

let counter = 0
function genId(): string {
  counter += 1
  return 'skill-' + Date.now().toString(36) + '-' + counter.toString(36)
}

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function normalizeStoredSkill(raw: any): SkillDef {
  return {
    id: String(raw.id),
    name: clampStr(raw.name, 120).trim() || 'Untitled skill',
    category: raw.category ? normalizeSkillCategory(raw.category) : inferSkillCategory([raw.tags, raw.name, raw.description, raw.source]),
    description: clampStr(raw.description, 400).trim(),
    instructions: clampStr(raw.instructions, 40000),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t: unknown) => clampStr(t, 40)).filter(Boolean).slice(0, 12) : [],
    source: clampStr(raw.source, 400) || 'paste',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
}

export class SkillManager {
  private read(): PersistedShape {
    const raw = store.get(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return emptyState()
    const skills = Array.isArray(raw.skills) ? raw.skills.filter((s: any) => s && typeof s.id === 'string').map(normalizeStoredSkill) : []
    const installs = (raw.installs && typeof raw.installs === 'object') ? raw.installs : {}
    return { version: 1, skills, installs }
  }

  private write(s: PersistedShape): void {
    store.set(STORAGE_KEY, s)
  }

  list(): SkillDef[] {
    return this.read().skills
  }

  get(id: string): SkillDef | undefined {
    return this.read().skills.find(s => s.id === id)
  }

  add(input: SkillInput): SkillDef {
    const s = this.read()
    const now = Date.now()
    const skill: SkillDef = {
      id: genId(),
      name: clampStr(input.name, 120).trim() || 'Untitled skill',
      category: input.category ? normalizeSkillCategory(input.category) : inferSkillCategory([input.tags, input.name, input.description, input.source]),
      description: clampStr(input.description, 400).trim(),
      instructions: clampStr(input.instructions, 40000),
      tags: Array.isArray(input.tags) ? input.tags.map(t => clampStr(t, 40)).filter(Boolean).slice(0, 12) : [],
      source: clampStr(input.source, 400) || 'paste',
      createdAt: now,
      updatedAt: now
    }
    s.skills.push(skill)
    this.write(s)
    return skill
  }

  update(id: string, patch: Partial<SkillInput>): SkillDef | undefined {
    const s = this.read()
    const skill = s.skills.find(x => x.id === id)
    if (!skill) return undefined
    if (patch.name !== undefined) skill.name = clampStr(patch.name, 120).trim() || skill.name
    if (patch.category !== undefined) skill.category = normalizeSkillCategory(patch.category)
    if (patch.description !== undefined) skill.description = clampStr(patch.description, 400).trim()
    if (patch.instructions !== undefined) skill.instructions = clampStr(patch.instructions, 40000)
    if (patch.tags !== undefined) skill.tags = patch.tags.map(t => clampStr(t, 40)).filter(Boolean).slice(0, 12)
    if (patch.source !== undefined) skill.source = clampStr(patch.source, 400)
    skill.updatedAt = Date.now()
    this.write(s)
    return skill
  }

  remove(id: string): boolean {
    const s = this.read()
    const before = s.skills.length
    s.skills = s.skills.filter(x => x.id !== id)
    if (s.skills.length === before) return false
    // 从所有 agent 的安装表中清除
    for (const agentId of Object.keys(s.installs)) {
      s.installs[agentId] = (s.installs[agentId] || []).filter(sid => sid !== id)
    }
    this.write(s)
    return true
  }

  getInstalls(): SkillInstalls {
    return this.read().installs
  }

  isInstalled(agentId: string, skillId: string): boolean {
    return (this.read().installs[agentId] || []).includes(skillId)
  }

  /** agentId 传 '*' = 对所有 manifest 已知 agent 安装（集体安装）。 */
  install(agentId: string, skillId: string): SkillInstalls {
    const s = this.read()
    if (!s.skills.some(x => x.id === skillId)) return s.installs // 未知技能，no-op
    const targets = agentId === '*' ? AGENTS.map(a => a.id) : [agentId]
    for (const t of targets) {
      const cur = s.installs[t] || []
      if (!cur.includes(skillId)) cur.push(skillId)
      s.installs[t] = cur
    }
    this.write(s)
    return s.installs
  }

  /** agentId 传 '*' = 对所有 agent 卸载（集体卸载）。 */
  uninstall(agentId: string, skillId: string): SkillInstalls {
    const s = this.read()
    const targets = agentId === '*' ? Object.keys(s.installs) : [agentId]
    for (const t of targets) {
      s.installs[t] = (s.installs[t] || []).filter(sid => sid !== skillId)
    }
    this.write(s)
    return s.installs
  }

  /** 目标 agent 已安装的技能（按注册顺序）。 */
  installedFor(agentId: string): SkillDef[] {
    const s = this.read()
    const ids = new Set(s.installs[agentId] || [])
    return s.skills.filter(x => ids.has(x.id))
  }

  scanLocal(): CategorizedLocalSkillCandidate[] {
    const roots = localSkillRoots()
    const out: CategorizedLocalSkillCandidate[] = []
    const seen = new Set<string>()
    for (const root of roots) {
      if (!existsSync(root.path)) continue
      for (const skillPath of findSkillFiles(root.path)) {
        const key = skillPath.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const parsed = parseSkillMarkdown(skillPath, root.agentSource)
        if (parsed) out.push(parsed)
      }
    }
    return out.sort((a, b) => a.agentSource.localeCompare(b.agentSource) || a.name.localeCompare(b.name))
  }

  importLocal(sourcePath: string): SkillDef {
    const candidate = this.scanLocal().find(item => item.sourcePath === sourcePath)
    if (!candidate) throw new Error(`Local skill not found: ${sourcePath}`)
    const existing = this.list().find(skill => skill.source === candidate.sourcePath)
    if (existing) return existing
    return this.add({
      name: candidate.name,
      category: candidate.category,
      description: candidate.description,
      instructions: candidate.instructions,
      tags: candidate.tags,
      source: candidate.sourcePath
    })
  }
}

function localSkillRoots(): Array<{ path: string; agentSource: string }> {
  const home = homedir()
  const roots = [
    { path: join(home, '.codex', 'skills'), agentSource: 'codex' },
    { path: join(home, '.agents', 'skills'), agentSource: 'agents' },
    { path: join(home, '.claude', 'skills'), agentSource: 'claude' },
    { path: join(home, '.opencode', 'skills'), agentSource: 'opencode' },
    { path: join(home, '.codex', 'plugins', 'cache'), agentSource: 'codex-plugin' }
  ]
  const activeWorkspaceId = getWorkspaceManager().getActive()
  const workspace = activeWorkspaceId ? getWorkspaceManager().getById(activeWorkspaceId) : null
  if (workspace?.rootPath) {
    roots.unshift(
      { path: join(workspace.rootPath, '.agenthub', 'skills'), agentSource: 'workspace' },
      { path: join(workspace.rootPath, '.agents', 'skills'), agentSource: 'workspace' },
      { path: join(workspace.rootPath, 'skills'), agentSource: 'workspace' }
    )
  }
  return roots
}

function findSkillFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return
    let entries: any[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const p = join(dir, entry.name)
      if (entry.isFile() && ['skill.md', 'skill.json'].includes(entry.name.toLowerCase())) out.push(p)
      else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(p, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

function parseSkillMarkdown(sourcePath: string, agentSource: string): CategorizedLocalSkillCandidate | null {
  let text = ''
  try {
    const st = statSync(sourcePath)
    if (!st.isFile() || st.size > 512 * 1024) return null
    text = readFileSync(sourcePath, 'utf-8')
  } catch {
    return null
  }
  if (sourcePath.toLowerCase().endsWith('skill.json')) return parseSkillJson(sourcePath, text, agentSource)
  const { frontmatter, body } = splitFrontmatter(text)
  const folderName = sourcePath.split(/[\\/]/).slice(-2, -1)[0] || 'Skill'
  const name = clampStr(frontmatter.name || titleFromMarkdown(body) || folderName, 120).trim() || folderName
  const description = clampStr(frontmatter.description || firstParagraph(body), 400).trim()
  const tags = parseTags(frontmatter.tags).slice(0, 12)
  const categoryInput = frontmatter.category || frontmatter.categories
  const category = categoryInput ? normalizeSkillCategory(categoryInput) : inferSkillCategory([tags, name, description, agentSource])
  return {
    id: stableCandidateId(sourcePath),
    name,
    category,
    description,
    instructions: clampStr(body.trim() || text.trim(), 40000),
    tags: [...new Set([agentSource, 'local', ...tags].filter(Boolean))],
    sourcePath,
    agentSource
  }
}

function parseSkillJson(sourcePath: string, text: string, agentSource: string): CategorizedLocalSkillCandidate | null {
  try {
    const raw = JSON.parse(text)
    const folderName = sourcePath.split(/[\\/]/).slice(-2, -1)[0] || 'Skill'
    const instructions = clampStr(raw.instructions || raw.prompt || raw.content || raw.description || '', 40000)
    const name = clampStr(raw.name || raw.id || folderName, 120).trim() || folderName
    const tags = parseTags(Array.isArray(raw.tags) ? raw.tags.join(',') : raw.tags)
    return {
      id: stableCandidateId(sourcePath),
      name,
      category: (raw.category || raw.categories) ? normalizeSkillCategory(Array.isArray(raw.category || raw.categories) ? (raw.category || raw.categories)[0] : raw.category || raw.categories) : inferSkillCategory([tags, name, raw.description, agentSource]),
      description: clampStr(raw.description || firstParagraph(instructions), 400).trim(),
      instructions,
      tags: [...new Set([agentSource, 'local', ...tags].filter(Boolean))],
      sourcePath,
      agentSource
    }
  } catch {
    return null
  }
}

function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: text }
  const raw = text.slice(3, end).trim()
  const frontmatter: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (match) frontmatter[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return { frontmatter, body: text.slice(end + 4).trimStart() }
}

function titleFromMarkdown(body: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
}

function firstParagraph(body: string): string {
  return body.split(/\n\s*\n/).map(x => x.replace(/^#+\s*/, '').trim()).find(Boolean) || ''
}

function parseTags(value: string | undefined): string[] {
  if (!value) return []
  return value.replace(/^\[|\]$/g, '').split(/[, ]+/).map(tag => tag.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
}

function stableCandidateId(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `local-skill-${(h >>> 0).toString(16)}`
}

let instance: SkillManager | null = null

export function getSkillManager(): SkillManager {
  if (!instance) instance = new SkillManager()
  return instance
}
