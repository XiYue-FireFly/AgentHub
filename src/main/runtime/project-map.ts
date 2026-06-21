/**
 * Project Map: workspace code knowledge graph (lightweight version).
 *
 * Builds a tree of the workspace file structure with metadata.
 * Used for project overview and context-aware suggestions.
 *
 * Phase 3.3 of AGENTHUB_ITERATION_GOAL.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

export interface ProjectNode {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  sizeBytes?: number
  children?: ProjectNode[]
  /** File language based on extension */
  language?: string
}

export interface ProjectMap {
  root: string
  nodes: ProjectNode[]
  stats: {
    totalFiles: number
    totalDirectories: number
    totalSize: number
    languages: Record<string, number>
  }
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.css': 'CSS',
  '.html': 'HTML',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header'
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage', '.cache'])

/**
 * Build a project map from a workspace root directory.
 */
export function buildProjectMap(rootPath: string, maxDepth = 4): ProjectMap | null {
  if (!existsSync(rootPath)) return null

  const stats = { totalFiles: 0, totalDirectories: 0, totalSize: 0, languages: {} as Record<string, number> }

  function scan(dir: string, depth: number): ProjectNode[] {
    if (depth > maxDepth) return []
    const nodes: ProjectNode[] = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue

        const fullPath = join(dir, entry.name)
        try {
          if (entry.isDirectory()) {
            stats.totalDirectories++
            const children = scan(fullPath, depth + 1)
            nodes.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
              children
            })
          } else {
            const stat = statSync(fullPath)
            const ext = extname(entry.name).toLowerCase()
            const language = LANGUAGE_MAP[ext] || ext.slice(1) || 'unknown'
            stats.totalFiles++
            stats.totalSize += stat.size
            stats.languages[language] = (stats.languages[language] || 0) + 1
            nodes.push({
              name: entry.name,
              path: fullPath,
              type: 'file',
              extension: ext,
              sizeBytes: stat.size,
              language
            })
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* skip unreadable */ }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  const nodes = scan(rootPath, 0)
  return { root: rootPath, nodes, stats }
}

/**
 * Flatten the tree into a list of file paths.
 */
export function flattenProjectMap(map: ProjectMap): string[] {
  const paths: string[] = []
  function walk(nodes: ProjectNode[]) {
    for (const node of nodes) {
      if (node.type === 'file') paths.push(node.path)
      if (node.children) walk(node.children)
    }
  }
  walk(map.nodes)
  return paths
}

/**
 * Search for files by name pattern.
 */
export function searchProjectFiles(map: ProjectMap, query: string): ProjectNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const results: ProjectNode[] = []
  function walk(nodes: ProjectNode[]) {
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(needle)) results.push(node)
      if (node.children) walk(node.children)
    }
  }
  walk(map.nodes)
  return results.slice(0, 50)
}
