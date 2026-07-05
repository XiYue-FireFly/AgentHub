import { listMcpServers, listMcpServerTools, removeMcpServer, scanLocalMcpServers, setMcpEnabled, testMcpServer, upsertMcpServer } from '../runtime/mcp'
import { getMcpSystemConfig, setMcpSystemConfig, setMcpEnabled as setMcpSystemEnabled } from '../mcp/config'
import { typedHandle } from './typed-ipc'

export function registerMcpIpc(): void {
  typedHandle("mcp:list", (_event, workspaceId) => listMcpServers(workspaceId))
  typedHandle("mcp:scanLocal", (_event, workspaceId) => scanLocalMcpServers(workspaceId))
  typedHandle("mcp:upsert", (_event, input) => upsertMcpServer(input))
  typedHandle("mcp:remove", (_event, id) => removeMcpServer(id))
  typedHandle("mcp:setEnabled", (_event, id, enabled, workspaceId) => setMcpEnabled(id, enabled, workspaceId))
  typedHandle("mcp:test", (_event, id, workspaceId) => testMcpServer(id, workspaceId))
  typedHandle("mcp:listTools", (_event, id, workspaceId) => listMcpServerTools(id, workspaceId))
  typedHandle("mcp:getSystemConfig", () => getMcpSystemConfig())
  typedHandle("mcp:setSystemConfig", (_event, config) => setMcpSystemConfig(config))
  typedHandle("mcp:setSystemEnabled", (_event, enabled) => setMcpSystemEnabled(enabled))
}
