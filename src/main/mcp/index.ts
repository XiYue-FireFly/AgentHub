/**
 * MCP Module Index
 *
 * 导出所有 MCP 相关的功能
 */

export { createMcpServer, McpServer } from './server'
export type { McpServerOptions, JsonRpcRequest, JsonRpcResponse } from './server'

export {
  executeSystemTool,
  systemToolsOpenAi,
  guardedCategoryForTool,
  SYSTEM_TOOL_SCHEMAS
} from './system-tools'
export type { SystemToolName, SystemToolContext, SystemToolResult } from './system-tools'

export {
  getMcpSystemConfig,
  setMcpSystemConfig,
  setMcpEnabled,
  isMcpEnabled,
  mcpLaunchConfig
} from './config'
export type { McpSystemConfig } from './config'
