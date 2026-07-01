import { describe, it, expect, beforeEach } from 'vitest'
import {
  getMcpSystemConfig,
  setMcpSystemConfig,
  setMcpEnabled,
  isMcpEnabled
} from '../config'

describe('MCP Config', () => {
  beforeEach(() => {
    // Reset to default
    setMcpSystemConfig({
      version: 1,
      enabled: true,
      allowedCategories: ['read', 'write', 'exec'],
      defaultPolicy: 'allow',
      timeoutMs: 120_000
    })
  })

  describe('getMcpSystemConfig', () => {
    it('should return default config', () => {
      const config = getMcpSystemConfig()
      expect(config.version).toBe(1)
      expect(config.enabled).toBe(true)
      expect(config.allowedCategories).toEqual(['read', 'write', 'exec'])
      expect(config.defaultPolicy).toBe('allow')
    })
  })

  describe('setMcpSystemConfig', () => {
    it('should update config', () => {
      setMcpSystemConfig({ enabled: false })
      const config = getMcpSystemConfig()
      expect(config.enabled).toBe(false)
    })

    it('should partial update', () => {
      setMcpSystemConfig({ defaultPolicy: 'ask' })
      const config = getMcpSystemConfig()
      expect(config.defaultPolicy).toBe('ask')
      expect(config.enabled).toBe(true) // unchanged
    })
  })

  describe('setMcpEnabled', () => {
    it('should enable/disable MCP', () => {
      setMcpEnabled(false)
      expect(isMcpEnabled()).toBe(false)

      setMcpEnabled(true)
      expect(isMcpEnabled()).toBe(true)
    })
  })

  describe('isMcpEnabled', () => {
    it('should return current enabled state', () => {
      expect(isMcpEnabled()).toBe(true)
    })
  })
})
