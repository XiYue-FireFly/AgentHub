import { describe, expect, it } from 'vitest'
import { clampInspectorWidth } from '../useResponsiveLayout'
import { toTransitionString, TRANSITIONS, useStagger } from '../useTransitions'

describe('useResponsiveLayout', () => {
  it('clampInspectorWidth respects minimum', () => {
    expect(clampInspectorWidth(100, 1920)).toBe(340) // min
  })

  it('clampInspectorWidth respects maximum', () => {
    expect(clampInspectorWidth(9999, 1920)).toBe(760) // max
  })

  it('clampInspectorWidth adapts to narrow viewport', () => {
    const clamped = clampInspectorWidth(500, 800)
    expect(clamped).toBeLessThanOrEqual(760)
    expect(clamped).toBeGreaterThanOrEqual(340)
  })

  it('clampInspectorWidth rounds to integer', () => {
    const result = clampInspectorWidth(456.7, 1920)
    expect(result).toBe(Math.round(result))
  })
})

describe('useTransitions', () => {
  it('toTransitionString formats correctly', () => {
    const result = toTransitionString(TRANSITIONS.slideIn)
    expect(result).toContain('transform, opacity')
    expect(result).toContain('200ms')
    expect(result).toContain('cubic-bezier')
  })

  it('toTransitionString includes delay when provided', () => {
    const result = toTransitionString({ ...TRANSITIONS.fadeIn, delay: 100 })
    expect(result).toContain('100ms')
  })

  it('TRANSITIONS has all required presets', () => {
    expect(TRANSITIONS.slideIn).toBeDefined()
    expect(TRANSITIONS.fadeIn).toBeDefined()
    expect(TRANSITIONS.scaleIn).toBeDefined()
    expect(TRANSITIONS.expand).toBeDefined()
    expect(TRANSITIONS.color).toBeDefined()
  })

  it('useStagger returns increasing delays', () => {
    const stagger = useStagger(10, 30, 300)
    expect(stagger(0)).toBe(0)
    expect(stagger(1)).toBe(30)
    expect(stagger(2)).toBe(60)
    expect(stagger(10)).toBe(300) // capped at maxDelay
  })
})
