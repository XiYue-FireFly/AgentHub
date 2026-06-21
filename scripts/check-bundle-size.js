/**
 * Bundle size check script.
 *
 * Reads the built renderer assets and reports sizes.
 * Fails if any asset exceeds the configured budget.
 *
 * Run: node scripts/check-bundle-size.js
 */

const fs = require('fs')
const path = require('path')

const BUDGETS = {
  js: 900 * 1024,  // 900KB gzipped for JS
  css: 300 * 1024, // 300KB gzipped for CSS
  total: 1200 * 1024 // 1.2MB total
}

const RENDERER_DIR = path.join(__dirname, '..', 'out', 'renderer', 'assets')

function checkBundleSize() {
  if (!fs.existsSync(RENDERER_DIR)) {
    console.log('Build assets not found. Run `npm run build` first.')
    process.exit(1)
  }

  const files = fs.readdirSync(RENDERER_DIR)
  let totalSize = 0
  let jsSize = 0
  let cssSize = 0
  const report = []

  for (const file of files) {
    const filePath = path.join(RENDERER_DIR, file)
    const stat = fs.statSync(filePath)
    const size = stat.size
    totalSize += size

    if (file.endsWith('.js')) {
      jsSize += size
      report.push({ file, size, type: 'JS' })
    } else if (file.endsWith('.css')) {
      cssSize += size
      report.push({ file, size, type: 'CSS' })
    }
  }

  console.log('\n=== Bundle Size Report ===\n')
  for (const item of report) {
    const kb = (item.size / 1024).toFixed(1)
    const status = item.type === 'JS' && item.size > BUDGETS.js ? ' ⚠ OVER BUDGET' :
                   item.type === 'CSS' && item.size > BUDGETS.css ? ' ⚠ OVER BUDGET' : ' ✓'
    console.log(`  ${item.file}: ${kb} KB${status}`)
  }

  console.log(`\n  Total JS: ${(jsSize / 1024).toFixed(1)} KB (budget: ${(BUDGETS.js / 1024).toFixed(0)} KB)`)
  console.log(`  Total CSS: ${(cssSize / 1024).toFixed(1)} KB (budget: ${(BUDGETS.css / 1024).toFixed(0)} KB)`)
  console.log(`  Total: ${(totalSize / 1024).toFixed(1)} KB (budget: ${(BUDGETS.total / 1024).toFixed(0)} KB)`)

  const overBudget = jsSize > BUDGETS.js || cssSize > BUDGETS.css || totalSize > BUDGETS.total
  if (overBudget) {
    console.log('\n  ⚠ BUNDLE SIZE OVER BUDGET')
    process.exit(1)
  } else {
    console.log('\n  ✓ Within budget')
    process.exit(0)
  }
}

checkBundleSize()
