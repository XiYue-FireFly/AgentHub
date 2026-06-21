import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { store } from "../store"
import { getWorkspaceManager } from "../hub/workspace"
import type { McpConfigState, McpServerConfig } from "./types"

const STORAGE_KEY = "runtime.mcp.v1"

/** Configurable probe timeout: env override > server config > default 5s. */
function probeTimeoutMs(server: McpServerConfig): number {
  const envOverride = Number(process.env.AGENTHUB_MCP_PROBE_TIMEOUT_MS)
  const base = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : (server.timeoutMs || 5000)
  return Math.max(2500, Math.min(30000, base))
}

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
      const raw = readFileSync(item.path, "utf-8")
      const parsed = parseConfigFile(raw, item.path)
      out.push(...serversFromConfig(parsed, item.source, item.path))
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

export function setMcpEnabled(id: string, enabled: boolean, workspaceId?: string | null): McpServerConfig | null {
  const state = readState()
  const server = state.servers.find(item => item.id === id)
  if (server) {
    server.enabled = enabled
  } else {
    state.overrides[id] = { ...(state.overrides[id] || {}), enabled }
  }
  writeState(state)
  return listMcpServers(workspaceId).find(item => item.id === id) ?? null
}

export async function testMcpServer(id: string, workspaceId?: string | null): Promise<McpServerConfig> {
  const server = listMcpServers(workspaceId).find(item => item.id === id)
  if (!server) throw new Error(`MCP server not found: ${id}`)
  try {
    if (server.transport === "stdio") {
      if (!server.command) throw new Error("Missing command")
      await probeStdioServer(server)
    } else if (server.url) {
      const res = await fetch(server.url, { method: "HEAD", headers: server.headers }).catch(() => null)
      if (!res || res.status < 200 || res.status >= 400) throw new Error(`HTTP ${res?.status ?? "unreachable"}`)
    } else {
      throw new Error("Missing URL")
    }
    return persistStatus(server, "ok")
  } catch (e: any) {
    return persistStatus(server, "error", e?.message || String(e))
  }
}

function resolveAppVersion(): string {
  try {
    // In Electron main process, __dirname points into the bundled app.
    // Walk up to find package.json (works in both dev and production).
    let dir = __dirname
    for (let i = 0; i < 5; i++) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'))
        if (pkg.version) return pkg.version
      }
      dir = join(dir, '..')
    }
  } catch { /* fall through to default */ }
  return '0.0.0'
}

function resolveAppName(): string {
  try {
    let dir = __dirname
    for (let i = 0; i < 5; i++) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'))
        if (pkg.productName) return pkg.productName
        if (pkg.name) return pkg.name
      }
      dir = join(dir, '..')
    }
  } catch { /* fall through to default */ }
  return 'AgentHub'
}

/**
 * Validate whether `stdout` contains a successful JSON-RPC initialize result.
 * Returns the parsed result object on success, or an error message string on failure.
 */
export function validateInitializeResult(stdout: string): { ok: true; result: any } | { ok: false; error: string } {
  const braceStart = stdout.indexOf('{')
  if (braceStart < 0) return { ok: false, error: 'No JSON object found in stdout' }
  // Find matching closing brace
  let depth = 0
  let end = -1
  for (let i = braceStart; i < stdout.length && i < braceStart + 65536; i++) {
    if (stdout[i] === '{') depth++
    else if (stdout[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return { ok: false, error: 'Unbalanced braces in JSON-RPC response' }
  let parsed: any
  try {
    parsed = JSON.parse(stdout.slice(braceStart, end + 1))
  } catch {
    return { ok: false, error: 'Invalid JSON in response' }
  }
  if (parsed.jsonrpc !== '2.0') return { ok: false, error: `Missing or wrong jsonrpc: ${JSON.stringify(parsed.jsonrpc)}` }
  if (parsed.id !== 1) return { ok: false, error: `Expected id=1, got id=${JSON.stringify(parsed.id)}` }
  if (parsed.error) return { ok: false, error: `Server returned JSON-RPC error: ${JSON.stringify(parsed.error)}` }
  if (!parsed.result || typeof parsed.result !== 'object') return { ok: false, error: 'Missing result object in response' }
  return { ok: true, result: parsed.result }
}

async function probeStdioServer(server: McpServerConfig): Promise<void> {
  const appVersion = resolveAppVersion()
  const appName = resolveAppName()
  return new Promise<void>((resolve, reject) => {
    const child = spawn(server.command!, server.args || [], {
      cwd: server.cwd || undefined,
      env: { ...process.env, ...(server.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    let stdout = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch { /* ignore */ }
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      const diag = stderr || stdout
      finish(new Error(diag.trim()
        ? `MCP initialize timed out: ${diag.trim().slice(0, 200)}`
        : 'MCP initialize timed out; no JSON-RPC initialize response was received.'))
    }, probeTimeoutMs(server))
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk).slice(0, 65536)
      // Only succeed when stdout contains a parsed JSON-RPC initialize result
      const result = validateInitializeResult(stdout)
      if (result.ok) finish()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk).slice(0, 2048)
      // stderr is diagnostic only — never treated as success
    })
    child.on('error', (error: Error) => {
      const message = (error as any)?.code === 'ENOENT'
        ? `MCP command not found: ${server.command}`
        : error.message
      finish(new Error(message))
    })
    child.on('exit', (code: number | null) => {
      if (settled) return
      // On exit, check if stdout has a valid initialize result
      const result = validateInitializeResult(stdout)
      if (result.ok) finish()
      else finish(new Error((stderr || `MCP process exited with code ${code}`).trim()))
    })
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: appName, version: appVersion }
      }
    }) + '\n'
    child.stdin?.write(initRequest)
  })
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
    { path: join(home, ".claude.json"), source: "claude" },
    { path: join(home, ".claude", "settings.json"), source: "claude" },
    { path: join(home, ".codex", "mcp.json"), source: "local" },
    { path: join(home, ".codex", "config.json"), source: "codex" },
    { path: join(home, ".codex", "config.toml"), source: "codex" },
    { path: join(home, ".claude", "mcp.json"), source: "local" },
    { path: join(home, ".gemini", "settings.json"), source: "gemini" },
    { path: join(home, ".opencode", "mcp.json"), source: "opencode" },
    { path: join(home, ".opencode.json"), source: "opencode" },
    { path: join(home, ".ccgui", "config.json"), source: "ccgui" },
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

function parseConfigFile(raw: string, path: string): any {
  if (path.toLowerCase().endsWith(".toml")) return parseMcpToml(raw)
  return JSON.parse(raw)
}

function parseMcpToml(raw: string): any {
  const servers: Record<string, any> = {}
  let currentName: string | null = null
  const ensureServer = (name: string) => {
    if (!servers[name]) servers[name] = {}
    currentName = name
  }
  for (const line of raw.split(/\r?\n/)) {
    const stripped = stripTomlComment(line).trim()
    if (!stripped) continue
    const section = stripped.match(/^\[(.+)]$/)
    if (section) {
      const name = section[1].trim()
      const mcpMatch = name.match(/^mcp_servers\.("?)(.+?)\1$/i) || name.match(/^mcpServers\.("?)(.+?)\1$/i)
      if (mcpMatch) ensureServer(mcpMatch[2])
      else currentName = null
      continue
    }
    if (!currentName) continue
    const assignment = stripped.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (!assignment) continue
    const key = assignment[1]
    const value = parseTomlValue(assignment[2])
    const target = servers[currentName]
    if (key === "env" && value && typeof value === "object" && !Array.isArray(value)) {
      target.env = value
    } else {
      target[key] = value
    }
  }
  return { mcpServers: servers }
}

function stripTomlComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if ((ch === '"' || ch === "'") && line[i - 1] !== "\\") quote = quote === ch ? null : quote || ch
    if (ch === "#" && !quote) return line.slice(0, i)
  }
  return line
}

function parseTomlValue(raw: string): any {
  const text = raw.trim()
  if (/^true$/i.test(text)) return true
  if (/^false$/i.test(text)) return false
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim()
    if (!inner) return []
    return splitTomlInline(inner).map(parseTomlValue)
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    const out: Record<string, any> = {}
    for (const part of splitTomlInline(text.slice(1, -1))) {
      const match = part.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
      if (match) out[match[1]] = parseTomlValue(match[2])
    }
    return out
  }
  return text
}

function splitTomlInline(value: string): string[] {
  const out: string[] = []
  let quote: string | null = null
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") quote = quote === ch ? null : quote || ch
    if (!quote && (ch === "[" || ch === "{")) depth += 1
    if (!quote && (ch === "]" || ch === "}")) depth -= 1
    if (!quote && depth === 0 && ch === ",") {
      out.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(value.slice(start).trim())
  return out.filter(Boolean)
}

function serversFromConfig(config: any, source: McpServerConfig["source"], sourcePath: string): McpServerConfig[] {
  const servers = config?.mcpServers || config?.servers || config?.capabilities?.mcp?.servers || (isSingleServerConfig(config) ? { [config.name || "server"]: config } : config)
  if (!servers || (typeof servers !== "object" && !Array.isArray(servers))) return []
  const disabled = new Set(Array.isArray(config?.disabledMcpServers)
    ? config.disabledMcpServers.map((item: any) => String(item).trim()).filter(Boolean)
    : [])
  const entries: Array<[string, any]> = Array.isArray(servers)
    ? servers.map((raw: any, index: number) => [String(raw?.id || raw?.name || `server-${index + 1}`), raw])
    : Object.entries(servers)
  return entries.map(([name, raw]: [string, any]) => {
    const spec = raw?.server && typeof raw.server === "object" ? raw.server : raw
    const serverName = raw?.name || raw?.id || name
    return normalizeServer({
    id: stableId(`${source}:${sourcePath}:${name}`),
    name: serverName,
    source,
    sourcePath,
    enabled: raw?.enabled !== false && raw?.disabled !== true && !disabled.has(String(serverName)),
    transport: spec?.transport || spec?.type || (spec?.url ? "http" : "stdio"),
    command: spec?.command,
    args: Array.isArray(spec?.args) ? spec.args : [],
    env: spec?.env && typeof spec.env === "object" ? spec.env : undefined,
    headers: spec?.headers && typeof spec.headers === "object" ? spec.headers : undefined,
    cwd: spec?.cwd,
    url: spec?.url || spec?.endpoint,
    timeoutMs: Number.isFinite(spec?.timeoutMs) ? spec.timeoutMs : undefined,
    trustScope: typeof spec?.trustScope === "string" ? spec.trustScope : undefined,
    trustedWorkspaceRoots: Array.isArray(spec?.trustedWorkspaceRoots) ? spec.trustedWorkspaceRoots : undefined,
    status: "unknown"
    })
  }).filter(Boolean) as McpServerConfig[]
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
    headers: raw.headers && typeof raw.headers === "object" ? Object.fromEntries(Object.entries(raw.headers).map(([k, v]) => [k, String(v)])) : undefined,
    cwd: typeof raw.cwd === "string" ? raw.cwd : undefined,
    url,
    timeoutMs: Number.isFinite(raw.timeoutMs) ? Math.max(250, Math.min(120_000, Math.round(raw.timeoutMs))) : undefined,
    trustScope: typeof raw.trustScope === "string" ? raw.trustScope : undefined,
    trustedWorkspaceRoots: Array.isArray(raw.trustedWorkspaceRoots) ? raw.trustedWorkspaceRoots.map(String) : undefined,
    sourcePath: typeof raw.sourcePath === "string" ? raw.sourcePath : undefined,
    status: raw.status === "ok" || raw.status === "error" ? raw.status : "unknown",
    error: typeof raw.error === "string" ? raw.error : undefined
  }
}

function isSingleServerConfig(config: any): boolean {
  return !!config && typeof config === "object" && (typeof config.command === "string" || typeof config.url === "string" || typeof config.endpoint === "string")
}

function normalizeTransport(value: any): McpServerConfig["transport"] {
  const v = String(value || "").toLowerCase()
  if (v === "sse") return "sse"
  if (v === "http" || v === "streamable-http") return "http"
  return "stdio"
}

function normalizeSource(value: any): McpServerConfig["source"] {
  if (value === "workspace" || value === "local" || value === "ecc" || value === "kun" || value === "claude" || value === "codex" || value === "gemini" || value === "opencode" || value === "ccgui") return value
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
  return ({ workspace: 0, user: 1, claude: 2, codex: 3, gemini: 4, opencode: 5, ccgui: 6, local: 7, kun: 8, ecc: 9 })[source]
}

function stableId(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `mcp-${(h >>> 0).toString(16)}`
}

/** Result of listing tools from an MCP server. */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: any
}

export interface McpServerToolsResult {
  ok: boolean
  tools: McpToolInfo[]
  error?: string
  resources?: number
  prompts?: number
}

/**
 * Connect to a stdio MCP server, initialize, and list its tools.
 * Returns structured tool info for the inventory UI.
 */
export async function listMcpServerTools(id: string, workspaceId?: string | null): Promise<McpServerToolsResult> {
  const server = listMcpServers(workspaceId).find(item => item.id === id)
  if (!server) return { ok: false, tools: [], error: `Server not found: ${id}` }
  if (server.transport !== 'stdio' || !server.command) {
    return { ok: false, tools: [], error: 'Only stdio servers are supported for tool listing' }
  }
  const appVersion = resolveAppVersion()
  const appName = resolveAppName()
  return new Promise(resolve => {
    const child = spawn(server.command!, server.args || [], {
      cwd: server.cwd || undefined,
      env: { ...process.env, ...(server.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let initialized = false
    let requestId = 1
    const pending = new Map<number, (result: any) => void>()
    let settled = false

    const finish = (result: McpServerToolsResult) => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* ignore */ }
      resolve(result)
    }

    const timer = setTimeout(() => finish({ ok: false, tools: [], error: `Timeout: ${(stderr || stdout).trim().slice(0, 200)}` }), Math.max(5000, Math.min(30000, server.timeoutMs || 10000)))

    function sendRequest(method: string, params?: any): Promise<any> {
      return new Promise(res => {
        const id = ++requestId
        pending.set(id, res)
        child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n')
      })
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
      // Try to parse complete JSON responses from the accumulated stdout
      const lines = stdout.split('\n')
      stdout = lines.pop() || '' // keep incomplete last line
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('{')) continue
        try {
          const msg = JSON.parse(trimmed)
          if (msg.id && pending.has(msg.id)) {
            const cb = pending.get(msg.id)
            pending.delete(msg.id)
            cb?.(msg)
          }
        } catch { /* not valid JSON, skip */ }
      }
    })

    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk).slice(0, 2048) })
    child.on('error', (err: Error) => {
      const msg = (err as any)?.code === 'ENOENT' ? `Command not found: ${server.command}` : err.message
      finish({ ok: false, tools: [], error: msg })
    })
    child.on('exit', (code: number | null) => {
      if (!settled) finish({ ok: false, tools: [], error: stderr.trim() || `Process exited with code ${code}` })
    })

    // Step 1: Initialize
    sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: appName, version: appVersion }
    }).then(initResult => {
      if (initResult.error) {
        finish({ ok: false, tools: [], error: `Initialize failed: ${JSON.stringify(initResult.error)}` })
        return
      }
      initialized = true
      // Step 2: Send initialized notification
      child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      // Step 3: List tools
      return sendRequest('tools/list')
    }).then(toolsResult => {
      if (settled || !toolsResult) return
      clearTimeout(timer)
      if (toolsResult.error) {
        finish({ ok: false, tools: [], error: `tools/list failed: ${JSON.stringify(toolsResult.error)}` })
        return
      }
      const tools: McpToolInfo[] = (toolsResult.result?.tools || []).map((t: any) => ({
        name: t.name || 'unnamed',
        description: t.description || undefined,
        inputSchema: t.inputSchema || undefined
      }))
      finish({ ok: true, tools })
    }).catch(err => {
      if (!settled) finish({ ok: false, tools: [], error: String(err) })
    })
  })
}
