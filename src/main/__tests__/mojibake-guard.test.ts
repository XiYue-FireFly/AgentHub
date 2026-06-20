import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf-8')
}

// GBK-as-UTF8 garble sequences commonly produced by Windows codepage mismatches
const MOJIBAKE_PATTERNS = [
  /�/,             // Unicode replacement character
  /锟斤拷/,              // GBK '锟斤拷' artifact
  /鍒嬭|娴嬭瘯|浠ｇ爜|鎸囨/, // common GBK misread fragments
]

function hasMojibake(text: string, excludeLines: RegExp[] = []): string | null {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (excludeLines.some(re => re.test(line))) continue
    for (const pat of MOJIBAKE_PATTERNS) {
      if (pat.test(line)) {
        return `line ${i + 1}: ${line.slice(0, 120)}`
      }
    }
  }
  return null
}

// Lines that are intentional mojibake detectors or test assertions — excluded from the check
const DETECTOR_LINES = [
  /hasMojibake/,
  /process-decoder/,
  /text\.includes/,
  /\\\\u[0-9a-fA-F]{4}/,  // regex literals testing for garble
  /鍒\|/,
  /锟\|/,
  /not\.toMatch/,
]

describe('mojibake guard: core text strings', () => {
  it('memory-library.ts noise table and templates are clean UTF-8', () => {
    const src = readSource('memory-library.ts')
    const hit = hasMojibake(src, DETECTOR_LINES)
    expect(hit, `mojibake in memory-library.ts: ${hit}`).toBeNull()
  })

  it('schedules.ts template labels are clean UTF-8', () => {
    const src = readSource('runtime/schedules.ts')
    const hit = hasMojibake(src, DETECTOR_LINES)
    expect(hit, `mojibake in schedules.ts: ${hit}`).toBeNull()
  })

  it('memory-library.ts noise table still contains expected Chinese noise words', () => {
    const src = readSource('memory-library.ts')
    // These are the noise words that should be in the rejection list
    const requiredNoiseWords = ['测试', '随便', '收到', '继续', '你好', '您好']
    for (const word of requiredNoiseWords) {
      expect(src, `noise word "${word}" missing`).toContain(word)
    }
  })

  it('memory-library.ts noise table still contains expected English noise words', () => {
    const src = readSource('memory-library.ts')
    const requiredNoiseWords = ['test', 'testing', 'hello', 'ok']
    for (const word of requiredNoiseWords) {
      expect(src, `noise word "${word}" missing`).toContain(word)
    }
  })
})
