import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { promisify } from "node:util"
import { store } from "../store"
import { getWorkspaceManager } from "../hub/workspace"
import type { McpConfigState, McpServerConfig } from "./types"

const execFileAsync = promisify(execFile)
const STORAGE_KEY = "runtime.mcp.v1"

function emptyState(): McpConfigState {
  return { version: 1, servers: [], overrides: {} }
}

function readState(): McpConfigState {
  const raw = store.get(STORAGE_KEY)
  if (!raw || typeof raw !== "object") return emptyState()
  return {
    version: 1,
    servers: Array.isArray((raw as any).servers) ? (raw as any).servers.map(normalizeServer).filter(Boolean) as McpServerConfig[] : [],
    overrides: (raw as any).overrides && typeof (raw as any).overrides === "object" ? (raw as any).overrides : {}
  }
}

function writeState(state: McpConfigState): void {
  store.set(STORAGE_KEY, state)
}

export function listMcpServers(workspaceId?: string | null): McpServerConfig[] {
  const state = readState()
  const discovered = scanLocalMcpServers(workspaceId)
  const merged = new Map<string, McpServerConfig>()
  for (const server of discovered) merged.set(server.id, applyOverride(server, state))
  for (const server of state.servers) merged.set(server.id, applyOverride(server, state))
  return [...merged.values()].sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.name.localeCompare(b.name))
}

export function enabledMcpServers(workspaceId?: string | null): McpServerConfig[] {
  return listMcpServers(workspaceId).filter(server => server.enabled)
}

export function scanLocalMcpServers(workspaceId?: string | null): McpServerConfig[] {
  const out: McpServerConfig[] = []
  for (const item of configCandidates(workspaceId)) {
    if (!existsSync(item.path)) continue
    try {
      const json = JSON.parse(readFileSync(item.path, "utf-8"))
      out.push(...serversFromConfig(json, item.source, item.path))
    } catch {
      // invalid local configs are ignored here; explicit mcp:test reports failures per server.
    }
  }
  return dedupeServers(out)
}

export function upsertMcpServer(input: Partial<McpServerConfig> & { name: string }): McpServerConfig {
  const state = readState()
  const server = normalizeServer({
    id: input.id || `mcp-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    source: "user",
    enabled: input.enabled ?? true,
    transport: input.transport || (input.url ? "http" : "stdio"),
    command: input.command,
    args: input.args,
    env: input.env,
    cwd: input.cwd,
    url: input.url,
    status: "unknown"
  })
  if (!server) throw new Error("Invalid MCP server")
  const idx = state.servers.findIndex(item => item.id === server.id)
  if (idx >= 0) state.servers[idx] = server
  else state.servers.push(server)
  writeState(state)
  return server
}

export function removeMcpServer(id: string): boolean {
  const state = readState()
  const before = state.servers.length
  state.servers = state.servers.filter(server => server.id !== id)
  delete state.overrides[id]
  writeState(state)
  return before !== state.servers.length
}

export function setMcpEnabled(id: string, enabled: boolean): McpServerConfig | null {
  const state = readState()
  const server = state.servers.find(item => item.id === id)
  if (server) {
    server.enabled = enabled
  } else {
    state.overrides[id] = { ...(state.overrides[id] || {}), enabled }
  }
  writeState(state)
  return listMcpServers().find(item => item.id === id) ?? null
}

export async function testMcpServer(id: string, workspaceId?: string | null): Promise<McpServerConfig> {
  const server = listMcpServers(workspaceId).find(item => item.id === id)
  if (!server) throw new Error(`MCP server not found: ${id}`)
  try {
    if (server.transport === "stdio") {
      if (!server.command) throw new Error("Missing command")
      await execFileAsync(server.command, [...(server.args || []), "--help"], {
        cwd: server.cwd || undefined,
        windowsHide: true,
        timeout: 2500,
        maxBuffer: 128 * 1024
      })
    } else if (server.url) {
      const res = await fetch(server.url, { method: "HEAD" }).catch(() => null)
      if (!res || res.status >= 500) throw new Error(`HTTP ${res?.status ?? "unreachable"}`)
    } else {
      throw new Error("Missing URL")
    }
    return persistStatus(server, "ok")
  } catch (e: any) {
    return persistStatus(server, "error", e?.message || String(e))
  }
}

export function acpMcpServersForWorkspace(workspaceId?: string | null): any[] {
  return enabledMcpServers(workspaceId).map(server => {
    if (server.transport === "stdio") {
      return {
        name: server.name,
        command: server.command,
        args: server.args || [],
        env: server.env || {},
        cwd: server.cwd
      }
    }
    return { name: server.name, url: server.url, transport: server.transport }
  })
}

function persistStatus(server: McpServerConfig, status: "ok" | "error", error?: string): McpServerConfig {
  const state = readState()
  const updated = { ...server, status, error }
  const idx = state.servers.findIndex(item => item.id === server.id)
  if (idx >= 0) state.servers[idx] = updated
  else if (server.source === "user") state.servers.push(updated)
  else state.overrides[server.id] = { ...(state.overrides[server.id] || {}), status, error }
  writeState(state)
  return updated
}

function configCandidates(workspaceId?: string | null): Array<{ path: string; source: McpServerConfig["source"] }> {
  const home = homedir()
  const candidates: Array<{ path: string; source: McpServerConfig["source"] }> = [
    { path: join(home, ".mcp.json"), source: "local" },
    { path: join(home, ".config", "agenthub", "mcp.json"), source: "user" },
    { path: join(home, ".codex", "mcp.json"), source: "local" },
    { path: join(home, ".claude", "mcp.json"), source: "local" },
    { path: join(home, ".agents", "mcp.json"), source: "local" },
    { path: join(home, ".agents", "plugins", "mcp.json"), source: "kun" },
    { path: join(home, ".ecc", "mcp.json"), source: "ecc" }
  ]
  const ws = workspaceId ? getWorkspaceManager().getById(workspaceId) : null
  if (ws?.rootPath) {
    candidates.unshift({ path: join(ws.rootPath, ".mcp.json"), source: "workspace" })
    candidates.unshift({ path: join(ws.rootPath, "mcp.json"), source: "workspace" })
  }
  return candidates
}

function serversFromConfig(config: any, source: McpServerConfig["source"], sourcePath: string): McpServerConfig[] {
  const servers = config?.mcpServers || config?.servers || config
  if (!servers || typeof servers !== "object") return []
  return Object.entries(servers).map(([name, raw]: [string, any]) => normalizeServer({
    id: stableId(`${source}:${sourcePath}:${name}`),
    name,
    source,
    enabled: raw?.enabled !== false && raw?.disabled !== true,
    transport: raw?.transport || raw?.type || (raw?.url ? "http" : "stdio"),
    command: raw?.command,
    args: Array.isArray(raw?.args) ? raw.args : [],
    env: raw?.env && typeof raw.env === "object" ? raw.env : undefined,
    cwd: raw?.cwd,
    url: raw?.url || raw?.endpoint,
    status: "unknown"
  })).filter(Boolean) as McpServerConfig[]
}

function normalizeServer(raw: any): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null
  const name = String(raw.name || "").trim()
  if (!name) return null
  const transport = normalizeTransport(raw.transport)
  const command = typeof raw.command === "string" ? raw.command.trim() : undefined
  const url = typeof raw.url === "string" ? raw.url.trim() : undefined
  if (transport === "stdio" && !command) return null
  if (transport !== "stdio" && !url) return null
  return {
    id: String(raw.id || stableId(`${name}:${command || url}`)),
    name,
    source: normalizeSource(raw.source),
    enabled: raw.enabled !== false,
    transport,
    command,
    args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    env: raw.env && typeof raw.env === "object" ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)])) : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    url,
    status: raw.status === "ok" || raw.status === "error" ? raw.status : "unknown",
    error: typeof raw.error === "string" ? raw.error : undefined
  }
}

function normalizeTransport(value: any): McpServerConfig["transport"] {
  const v = String(value || "").toLowerCase()
  if (v === "sse") return "sse"
  if (v === "http" || v === "streamable-http") return "http"
  return "stdio"
}

function normalizeSource(value: any): McpServerConfig["source"] {
  if (value === "workspace" || value === "local" || value === "ecc" || value === "kun") return value
  return "user"
}

function applyOverride(server: McpServerConfig, state: McpConfigState): McpServerConfig {
  const override = state.overrides[server.id]
  return override ? { ...server, enabled: override.enabled ?? server.enabled, status: override.status ?? server.status, error: override.error ?? server.error } : server
}

function dedupeServers(servers: McpServerConfig[]): McpServerConfig[] {
  const out = new Map<string, McpServerConfig>()
  for (const server of servers) out.set(server.id, server)
  return [...out.values()]
}

function sourceRank(source: McpServerConfig["source"]): number {
  return ({ workspace: 0, user: 1, local: 2, kun: 3, ecc: 4 })[source]
}

function stableId(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `mcp-${(h >>> 0).toString(16)}`
}
