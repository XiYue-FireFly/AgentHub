import { describe, expect, it } from 'vitest'
import { WORKBENCH_VIEW_MODES, isWorkbenchViewMode } from '../viewModes'

describe('workbench view modes', () => {
  it('accepts every routable workbench view', () => {
    expect(WORKBENCH_VIEW_MODES).toEqual(['chat', 'write', 'tasks', 'requirements', 'settings', 'workflows'])
    for (const mode of WORKBENCH_VIEW_MODES) {
      expect(isWorkbenchViewMode(mode)).toBe(true)
    }
  })

  it('rejects unknown or malformed view values', () => {
    expect(isWorkbenchViewMode('providers')).toBe(false)
    expect(isWorkbenchViewMode('')).toBe(false)
    expect(isWorkbenchViewMode(null)).toBe(false)
  })
})
