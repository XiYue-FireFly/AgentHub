/**
 * Workspace Files: fast file tree and search for @ mentions in Composer.
 *
 * Provides file listing, fuzzy search, and content snippet extraction
 * for the Composer's @file reference feature.
 */

import { promises as fs } from 'node:fs'
import { join, extname } from 'node:path'

export interface FileEntry {
  path: string
  relativePath: string
  name: string
  extension: string
  isDirectory: boolean
  sizeBytes: number
  /** Truncated preview for text files */
  preview?: string
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage',
  '.cache', '.turbo', '.parcel-cache', '__pycache__', '.venv', 'venv'
])

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx',
  '.css', '.scss', '.less', '.html', '.xml', '.yaml', '.yml', '.toml',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat',
  '.sql', '.graphql', '.gitignore', '.dockerignore',
  '.txt'
])

/**
 * List files in a workspace directory (non-recursive, fast).
 */
export async function listWorkspaceFiles(rootPath: string, maxEntries = 200): Promise<FileEntry[]> {
  try {
    const stat = await fs.stat(rootPath)
    if (!stat.isDirectory()) return []
  } catch { /* path missing or inaccessible */ return [] }
  const entries: FileEntry[] = []
  try {
    const items = await fs.readdir(rootPath, { withFileTypes: true })
    for (const item of items) {
      if (entries.length >= maxEntries) break
      if (IGNORE_DIRS.has(item.name)) continue
      if (item.name.startsWith('.') && item.name !== '.env' && item.name !== '.gitignore') continue
      const fullPath = join(rootPath, item.name)
      try {
        const stat = await fs.stat(fullPath)
        entries.push({
          path: fullPath,
          relativePath: item.name,
          name: item.name,
          extension: extname(item.name).toLowerCase(),
          isDirectory: item.isDirectory(),
          sizeBytes: stat.size
        })
      } catch { /* skip inaccessible */ }
    }
  } catch { /* directory read failed */ }
  return entries.sort((a, b) => (a.isDirectory === b.isDirectory) ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1)
}

/**
 * Search files by name (fuzzy match). Used for @ mentions.
 */
export async function searchWorkspaceFiles(rootPath: string, query: string, maxResults = 20): Promise<FileEntry[]> {
  const allFiles = await listWorkspaceFiles(rootPath, 500)
  const needle = query.trim().toLowerCase()
  if (!needle) return allFiles.slice(0, maxResults)
  return allFiles
    .map(f => ({ file: f, score: fuzzyFileScore(needle, f.name.toLowerCase(), f.relativePath.toLowerCase()) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(item => item.file)
}

/**
 * Read a text file preview (first N lines).
 */
export async function readFilePreview(filePath: string, maxLines = 30): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) return { ok: false, error: 'Is a directory' }
    if (stat.size > 1_000_000) return { ok: false, error: 'File too large (>1MB)' }
    const ext = extname(filePath).toLowerCase()
    if (!TEXT_EXTENSIONS.has(ext)) return { ok: false, error: `Binary file (${ext})` }
    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').slice(0, maxLines)
    return { ok: true, content: lines.join('\n') + (content.split('\n').length > maxLines ? '\n... (truncated)' : '') }
  } catch {
    return { ok: false, error: 'File not found' }
  }
}

function fuzzyFileScore(query: string, name: string, path: string): number {
  if (name === query) return 1000
  if (name.startsWith(query)) return 900
  if (name.includes(query)) return 800
  if (path.includes(query)) return 700
  // Fuzzy: chars in order
  let qi = 0
  for (let i = 0; i < name.length && qi < query.length; i++) {
    if (name[i] === query[qi]) qi++
  }
  return qi === query.length ? 500 - (name.length - query.length) : 0
}
