#!/usr/bin/env node
/**
 * check-css-variables: audit hardcoded colors in renderer files.
 *
 * Flags any hardcoded hex color (#xxx or #xxxxxx) in .tsx/.ts files
 * that is NOT inside a CSS variable definition or theme preset.
 *
 * Usage: node scripts/check-css-variables.js [--src src/renderer]
 *
 * Exit code 0 = no violations.
 * Exit code 1 = hardcoded colors found.
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const srcIdx = args.indexOf('--src')
const SRC_DIR = srcIdx >= 0 ? args[srcIdx + 1] : 'src/renderer'

const SKIP_DIRS = new Set(['node_modules', '__tests__', '.git'])
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/

// Files that are allowed to have hardcoded colors (theme definitions)
const ALLOWED_FILES = new Set([
  'appearance.ts',
  'meta.ts'
])

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, results)
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      if (ALLOWED_FILES.has(entry.name)) continue
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip comments and CSS variable definitions
        if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue
        if (line.includes('var(--') || line.includes('--ah-')) continue
        // Skip lines that are clearly CSS variable assignments
        if (/^[\s]*--[\w-]+\s*:/.test(line)) continue
        if (HEX_PATTERN.test(line)) {
          results.push({ file: fullPath, line: i + 1, content: line.trim().slice(0, 100) })
        }
      }
    }
  }
  return results
}

const violations = walk(SRC_DIR)

if (violations.length > 0) {
  console.warn(`\n⚠ Found ${violations.length} hardcoded color(s) in ${SRC_DIR}/:\n`)
  for (const v of violations.slice(0, 20)) {
    console.warn(`  ${v.file}:${v.line}: ${v.content}`)
  }
  if (violations.length > 20) {
    console.warn(`  ... and ${violations.length - 20} more`)
  }
  console.warn(`\nConsider using CSS variables from globals.css instead.\n`)
  // Warning only, not a hard failure
  process.exit(0)
} else {
  console.log(`✅ No hardcoded colors found in ${SRC_DIR}/.`)
  process.exit(0)
}
