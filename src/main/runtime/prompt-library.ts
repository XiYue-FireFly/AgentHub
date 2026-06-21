/**
 * Prompt Library: store and retrieve reusable prompts.
 *
 * Prompts are user-created templates that can be inserted into the Composer.
 * Each prompt has a name, body, optional tags, and category.
 * Persisted via store key `prompts.library.v1`.
 */

import { store } from '../store'

const STORAGE_KEY = 'prompts.library.v1'

export type PromptCategory = 'general' | 'coding' | 'review' | 'research' | 'writing' | 'custom'

export interface PromptEntry {
  id: string
  name: string
  body: string
  category: PromptCategory
  tags: string[]
  /** Whether this prompt appears in the quick-access slash menu */
  isSlashCommand: boolean
  /** Optional shortcut: e.g. "/review" */
  shortcut?: string
  createdAt: string
  updatedAt: string
  useCount: number
}

export interface PromptLibraryData {
  version: 1
  prompts: PromptEntry[]
}

function emptyLibrary(): PromptLibraryData {
  return { version: 1, prompts: [] }
}

function readLibrary(): PromptLibraryData {
  const raw: any = store.get(STORAGE_KEY)
  if (!raw || typeof raw !== 'object') return emptyLibrary()
  const prompts = Array.isArray(raw.prompts) ? raw.prompts.map(normalizePrompt).filter(Boolean) : []
  return { version: 1, prompts }
}

function writeLibrary(data: PromptLibraryData): void {
  store.set(STORAGE_KEY, data)
}

function normalizePrompt(raw: any): PromptEntry | null {
  if (!raw || typeof raw !== 'object' || !raw.id || !raw.name) return null
  return {
    id: String(raw.id),
    name: String(raw.name),
    body: String(raw.body || ''),
    category: ['general', 'coding', 'review', 'research', 'writing', 'custom'].includes(raw.category) ? raw.category : 'general',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    isSlashCommand: !!raw.isSlashCommand,
    shortcut: raw.shortcut ? String(raw.shortcut) : undefined,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    useCount: typeof raw.useCount === 'number' ? raw.useCount : 0
  }
}

export function listPrompts(category?: PromptCategory): PromptEntry[] {
  const lib = readLibrary()
  return category ? lib.prompts.filter(p => p.category === category) : lib.prompts
}

export function getPrompt(id: string): PromptEntry | null {
  return readLibrary().prompts.find(p => p.id === id) || null
}

export function getSlashCommands(): PromptEntry[] {
  return readLibrary().prompts.filter(p => p.isSlashCommand && p.shortcut)
}

export function upsertPrompt(input: Partial<PromptEntry> & { name: string; body: string }): PromptEntry {
  const lib = readLibrary()
  const now = new Date().toISOString()
  const id = input.id || `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const existing = lib.prompts.findIndex(p => p.id === id)
  const entry: PromptEntry = {
    id,
    name: input.name,
    body: input.body,
    category: input.category || 'general',
    tags: input.tags || [],
    isSlashCommand: input.isSlashCommand ?? false,
    shortcut: input.shortcut,
    createdAt: existing >= 0 ? lib.prompts[existing].createdAt : now,
    updatedAt: now,
    useCount: existing >= 0 ? lib.prompts[existing].useCount : 0
  }
  if (existing >= 0) lib.prompts[existing] = entry
  else lib.prompts.push(entry)
  writeLibrary(lib)
  return entry
}

export function deletePrompt(id: string): boolean {
  const lib = readLibrary()
  const before = lib.prompts.length
  lib.prompts = lib.prompts.filter(p => p.id !== id)
  if (lib.prompts.length !== before) { writeLibrary(lib); return true }
  return false
}

export function incrementUseCount(id: string): void {
  const lib = readLibrary()
  const prompt = lib.prompts.find(p => p.id === id)
  if (prompt) {
    prompt.useCount++
    prompt.updatedAt = new Date().toISOString()
    writeLibrary(lib)
  }
}

export function searchPrompts(query: string): PromptEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return readLibrary().prompts
  return readLibrary().prompts.filter(p =>
    p.name.toLowerCase().includes(needle) ||
    p.body.toLowerCase().includes(needle) ||
    p.tags.some(t => t.toLowerCase().includes(needle)) ||
    (p.shortcut || '').toLowerCase().includes(needle)
  )
}

/** Seed default prompts for first-run experience. */
export function seedDefaultPrompts(): void {
  const lib = readLibrary()
  if (lib.prompts.length > 0) return
  const defaults: Array<Omit<PromptEntry, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>> = [
    { name: 'Code Review', body: 'Review the following code for correctness, readability, and potential issues:\n\n```\n{{code}}\n```\n\nFocus on: bugs, security, performance, naming.', category: 'review', tags: ['review', 'code'], isSlashCommand: true, shortcut: '/review' },
    { name: 'Explain Code', body: 'Explain what the following code does, its purpose, and how it works:\n\n```\n{{code}}\n```', category: 'coding', tags: ['explain', 'code'], isSlashCommand: true, shortcut: '/explain' },
    { name: 'Research Topic', body: 'Research and summarize the following topic. Include key concepts, best practices, and common pitfalls:\n\nTopic: {{topic}}', category: 'research', tags: ['research', 'summary'], isSlashCommand: true, shortcut: '/research' },
    { name: 'Write Tests', body: 'Write comprehensive tests for the following code. Include edge cases and error handling:\n\n```\n{{code}}\n```', category: 'coding', tags: ['test', 'tdd'], isSlashCommand: true, shortcut: '/test' }
  ]
  for (const d of defaults) upsertPrompt(d)
}
