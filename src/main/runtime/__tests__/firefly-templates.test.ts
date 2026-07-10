import { describe, expect, it } from 'vitest'
import { getFireflyTemplate, listFireflyTemplates } from '../firefly-templates'

describe('firefly-templates (Wave4 P3)', () => {
  it('lists at least 3 built-in templates', () => {
    const list = listFireflyTemplates()
    expect(list.length).toBeGreaterThanOrEqual(3)
    const ids = list.map(t => t.id)
    expect(ids).toContain('firefly-five-role')
    expect(ids).toContain('pair-review')
    expect(ids).toContain('solo-tdd')
  })

  it('returns template by id with roles and schedule graph', () => {
    const t = getFireflyTemplate('firefly-five-role')
    expect(t).not.toBeNull()
    expect(t!.roles).toEqual(['router', 'main', 'reviewer', 'executor', 'gatekeeper'])
    expect(t!.schedule.nodes.length).toBe(5)
    expect(t!.schedule.edges.length).toBe(4)
    expect(t!.defaultMode).toBe('orchestrate')
  })

  it('returns null for unknown id', () => {
    expect(getFireflyTemplate('no-such-template')).toBeNull()
  })

  it('returns deep copies so callers cannot mutate builtins', () => {
    const a = listFireflyTemplates()
    a[0].name = 'mutated'
    a[0].roles.push('extra')
    const b = listFireflyTemplates()
    expect(b[0].name).not.toBe('mutated')
    expect(b[0].roles).not.toContain('extra')
  })
})
