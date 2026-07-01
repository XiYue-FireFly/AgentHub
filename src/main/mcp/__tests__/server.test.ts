import { describe, it, expect, beforeEach } from 'vitest'
import { createMcpServer } from '../server'

describe('MCP Server', () => {
  let server: ReturnType<typeof createMcpServer>

  beforeEach(() => {
    server = createMcpServer({ cwd: process.cwd() })
  })

  describe('handleInitialize', () => {
    it('should return server info', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {},
        id: 1
      })

      expect(response).not.toBeNull()
      expect(response!.result).toBeDefined()
      expect(response!.result.protocolVersion).toBe('2024-11-05')
      expect(response!.result.serverInfo.name).toBe('AgentHub MCP Server')
    })
  })

  describe('handleToolsList', () => {
    it('should list all system tools', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2
      })

      expect(response).not.toBeNull()
      expect(response!.result.tools.length).toBe(8)
      expect(response!.result.tools[0].name).toBe('fs_read')
    })
  })

  describe('handleToolsCall', () => {
    it('should execute system_info tool', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'system_info',
          arguments: { detailed: false }
        },
        id: 3
      })

      expect(response).not.toBeNull()
      expect(response!.result.content[0].type).toBe('text')
      const info = JSON.parse(response!.result.content[0].text)
      expect(info.platform).toBeDefined()
    })

    it('should execute fs_list tool', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'fs_list',
          arguments: { path: '.' }
        },
        id: 4
      })

      expect(response).not.toBeNull()
      expect(response!.result.content[0].type).toBe('text')
    })

    it('should return error for unknown tool', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {}
        },
        id: 5
      })

      expect(response).not.toBeNull()
      expect(response!.result.isError).toBe(true)
    })
  })

  describe('ping', () => {
    it('should respond to ping', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'ping',
        id: 6
      })

      expect(response).not.toBeNull()
      expect(response!.result).toEqual({})
    })
  })

  describe('notifications', () => {
    it('should handle initialized notification', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      })

      expect(response).toBeNull()
    })
  })
})
