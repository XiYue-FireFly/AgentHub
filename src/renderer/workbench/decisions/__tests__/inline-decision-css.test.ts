import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/renderer/globals.css'), 'utf8')

function rule(selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))
  return match?.[1] || ''
}

describe('inline decision CSS contract', () => {
  it('keeps decisions in normal full-width flow without an overlay stack', () => {
    const decision = rule('.wb-decision-bar')
    expect(decision).toContain('width: 100%')
    expect(decision).toContain('max-width: 100%')
    expect(decision).toContain('overflow-x: hidden')
    expect(decision).not.toMatch(/position\s*:\s*fixed/)
    expect(decision).not.toMatch(/z-index\s*:/)
  })

  it('gives decision controls a visible focus treatment and 32px minimum target', () => {
    expect(rule('.wb-decision-bar button')).toContain('min-height: 32px')
    expect(rule('.wb-decision-bar button:focus-visible')).toContain('outline')
    expect(rule('.wb-decision-option')).toContain('min-height: 32px')
    expect(rule('.wb-decision-remember')).toContain('min-height: 32px')
    expect(rule('.wb-decision-option.tone-danger')).toContain('var(--wb-red)')
  })

  it('uses a single-column decision layout under 720px and includes a dark-mode treatment', () => {
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.wb-decision-options\s*\{[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?\.wb-decision-bar/)
  })
})
