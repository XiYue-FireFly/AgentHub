/**
 * MCP Server - JSON-RPC 分发
 *
 * 传输无关的 MCP 服务器实现
 */

import { executeSystemTool, type SystemToolName, type SystemToolContext, SYSTEM_TOOL_SCHEMAS } from './system-tools'

// ============================================================
// Types
// ============================================================

export interface McpServerOptions {
  cwd: string
  readOnly?: boolean
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: any
  id?: number | string | null
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
  id: number | string | null
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
  id?: number | string | null  // 通知通常无 id，但类型上允许检查
}

// ============================================================
// MCP Server Implementation
// ============================================================

export class McpServer {
  private readonly ctx: SystemToolContext
  private initialized = false

  constructor(options: McpServerOptions) {
    this.ctx = {
      cwd: options.cwd,
      readOnly: options.readOnly || false
    }
  }

  async handleRequest(request: JsonRpcRequest | JsonRpcNotification): Promise<JsonRpcResponse | null> {
    // 处理通知（无 id）
    if (request.id === undefined || request.id === null) {
      await this.handleNotification(request)
      return null
    }

    try {
      const result = await this.dispatch(request.method, request.params)
      return {
        jsonrpc: '2.0',
        result,
        id: request.id
      }
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        error: {
          code: error.code || -32603,
          message: error.message || 'Internal error',
          data: error.data
        },
        id: request.id
      }
    }
  }

  private async handleNotification(request: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    switch (request.method) {
      case 'notifications/initialized':
        this.initialized = true
        break
      case 'notifications/cancelled':
        // 处理取消请求
        break
    }
  }

  private async dispatch(method: string, params?: any): Promise<any> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(params)
      case 'tools/list':
        return this.handleToolsList()
      case 'tools/call':
        return this.handleToolsCall(params)
      case 'ping':
        return {}
      default:
        throw { code: -32601, message: `Method not found: ${method}` }
    }
  }

  private handleInitialize(params?: any): any {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'AgentHub MCP Server',
        version: '0.6.0'
      }
    }
  }

  private handleToolsList(): any {
    return {
      tools: SYSTEM_TOOL_SCHEMAS.map(schema => ({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema
      }))
    }
  }

  private async handleToolsCall(params?: any): Promise<any> {
    if (!params?.name) {
      throw { code: -32602, message: 'Missing tool name' }
    }

    const toolName = params.name as SystemToolName
    const args = params.arguments || {}

    const result = await executeSystemTool(toolName, args, this.ctx)

    return {
      content: [
        {
          type: 'text',
          text: result.ok ? result.output : `Error: ${result.error}\n${result.output}`
        }
      ],
      isError: !result.ok
    }
  }
}

/**
 * 创建 MCP 服务器实例
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  return new McpServer(options)
}
