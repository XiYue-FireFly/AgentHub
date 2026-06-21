#!/usr/bin/env node
/**
 * check-large-files: enforce single-file line limits.
 *
 * Default limit: 3000 lines (per ccgui convention).
 * Usage: node scripts/check-large-files.js [--limit 3000] [--src src]
 *
 * Exit code 0 = all files within limit.
 * Exit code 1 = one or more files exceed limit.
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 3000
const srcIdx = args.indexOf('--src')
const SRC_DIR = srcIdx >= 0 ? args[srcIdx + 1] : 'src'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '__tests__'])
const SKIP_FILES = new Set(['globals.css']) // Design token file is expected to be large
const EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, results)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (!EXTENSIONS.has(ext)) continue
      if (SKIP_FILES.has(entry.name)) continue
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n').length
      if (lines > LIMIT) {
        results.push({ path: fullPath, lines, limit: LIMIT })
      }
    }
  }
  return results
}

const violations = walk(SRC_DIR)

if (violations.length > 0) {
  console.error(`\n❌ ${violations.length} file(s) exceed the ${LIMIT}-line limit:\n`)
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${v.path}: ${v.lines} lines (limit: ${v.limit})`)
  }
  console.error(`\nConsider splitting large files into smaller, focused modules.\n`)
  process.exit(1)
} else {
  console.log(`✅ All files in ${SRC_DIR}/ are within the ${LIMIT}-line limit.`)
  process.exit(0)
}
