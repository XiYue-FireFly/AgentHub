import { describe, expect, it } from 'vitest'
import {
  listBuiltinMarketplace,
  listMarketplace,
  getMarketplacePlugin,
  validateRegistryUrl
} from '../plugin-marketplace'

describe('plugin-marketplace', () => {
  it('lists builtin catalog with >=1 entry', () => {
    const list = listBuiltinMarketplace()
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0].repositoryUrl.startsWith('https://')).toBe(true)
    expect(list[0].publisher).toBeTruthy()
  })

  it('validates registry URL allowlist', () => {
    expect(validateRegistryUrl('https://github.com/org/catalog.json').valid).toBe(true)
    expect(validateRegistryUrl('http://github.com/org/catalog.json').valid).toBe(false)
    expect(validateRegistryUrl('https://evil.example/catalog.json').valid).toBe(false)
  })

  it('listMarketplace returns builtin when no remote url', async () => {
    const result = await listMarketplace()
    expect(result.ok).toBe(true)
    expect(result.plugins.length).toBeGreaterThanOrEqual(1)
    expect(getMarketplacePlugin('echobird-superpowers', result.plugins)?.name).toBeTruthy()
  })
})
