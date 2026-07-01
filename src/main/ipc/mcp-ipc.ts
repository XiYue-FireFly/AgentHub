/**
 * MCP IPC handlers.
 *
 * Extracted from index.ts to isolate MCP-related IPC registrations.
 */

import { ipcMain } from 'electron'
import { listMcpServers, listMcpServerTools, removeMcpServer, scanLocalMcpServers, setMcpEnabled, testMcpServer, upsertMcpServer } from '../runtime/mcp'
import { getMcpSystemConfig, setMcpSystemConfig, setMcpEnabled as setMcpSystemEnabled } from '../mcp/config'

export function registerMcpIpc(): void {
  // MCP 服务器管理 IPC
  ipcMain.handle("mcp:list", (_event, workspaceId?: string | null) => listMcpServers(workspaceId))
  ipcMain.handle("mcp:scanLocal", (_event, workspaceId?: string | null) => scanLocalMcpServers(workspaceId))
  ipcMain.handle("mcp:upsert", (_event, input: any) => upsertMcpServer(input))
  ipcMain.handle("mcp:remove", (_event, id: string) => removeMcpServer(id))
  ipcMain.handle("mcp:setEnabled", (_event, id: string, enabled: boolean, workspaceId?: string | null) => setMcpEnabled(id, enabled, workspaceId))
  ipcMain.handle("mcp:test", (_event, id: string, workspaceId?: string | null) => testMcpServer(id, workspaceId))
  ipcMain.handle("mcp:listTools", (_event, id: string, workspaceId?: string | null) => listMcpServerTools(id, workspaceId))

  // MCP 系统级控制配置 IPC
  ipcMain.handle("mcp:getSystemConfig", () => getMcpSystemConfig())
  ipcMain.handle("mcp:setSystemConfig", (_event, config: any) => setMcpSystemConfig(config))
  ipcMain.handle("mcp:setSystemEnabled", (_event, enabled: boolean) => setMcpSystemEnabled(enabled))
}
