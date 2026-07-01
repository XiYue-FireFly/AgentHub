/**
 * MCP Configuration
 *
 * 管理 MCP 系统级控制的配置
 */

import { store } from '../store'

// ============================================================
// Types
// ============================================================

export interface McpSystemConfig {
  version: number
  enabled: boolean
  /** 允许的工具类别 */
  allowedCategories: ('read' | 'write' | 'exec')[]
  /** 默认审批策略 */
  defaultPolicy: 'allow' | 'ask' | 'deny'
  /** 超时设置 */
  timeoutMs: number
}

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = 'mcp.system.v1'

const DEFAULT_CONFIG: McpSystemConfig = {
  version: 1,
  enabled: true,  // 默认开启
  allowedCategories: ['read', 'write', 'exec'],
  defaultPolicy: 'allow',
  timeoutMs: 120_000
}

// ============================================================
// Config Management
// ============================================================

export function getMcpSystemConfig(): McpSystemConfig {
  const raw = store.get(STORAGE_KEY)
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CONFIG }
  }

  return {
    version: (raw as any).version ?? DEFAULT_CONFIG.version,
    enabled: (raw as any).enabled ?? DEFAULT_CONFIG.enabled,
    allowedCategories: (raw as any).allowedCategories ?? DEFAULT_CONFIG.allowedCategories,
    defaultPolicy: (raw as any).defaultPolicy ?? DEFAULT_CONFIG.defaultPolicy,
    timeoutMs: (raw as any).timeoutMs ?? DEFAULT_CONFIG.timeoutMs
  }
}

export function setMcpSystemConfig(config: Partial<McpSystemConfig>): void {
  const current = getMcpSystemConfig()
  const updated: McpSystemConfig = {
    ...current,
    ...config,
    version: 1
  }
  store.set(STORAGE_KEY, updated)
}

export function setMcpEnabled(enabled: boolean): void {
  setMcpSystemConfig({ enabled })
}

export function isMcpEnabled(): boolean {
  return getMcpSystemConfig().enabled
}

/**
 * 生成 ACP MCP 服务器配置
 */
export function mcpLaunchConfig(cwd: string): any {
  const config = getMcpSystemConfig()

  if (!config.enabled) {
    return null
  }

  return {
    name: 'agenthub-system',
    command: process.execPath,
    args: [getMcpServerPath()],
    env: {
      AGENTHUB_MCP_CWD: cwd
    }
  }
}

/**
 * 获取 MCP 服务器入口文件路径
 */
function getMcpServerPath(): string {
  // 开发环境
  if (process.env.NODE_ENV === 'development') {
    return require('path').join(__dirname, 'server-entry.js')
  }

  // 生产环境
  return require('path').join(
    require('electron').app.getAppPath(),
    'out',
    'main',
    'mcp-server.js'
  )
}
