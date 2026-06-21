/**
 * Diagnostics: system health checks for AgentHub.
 *
 * Runs a suite of checks to verify that all subsystems are working
 * correctly: store, providers, agents, MCP, memory, workspace.
 * Returns structured results for the Diagnostics UI.
 */

export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface DiagnosticResult {
  id: string
  name: string
  nameZh: string
  category: 'system' | 'providers' | 'agents' | 'mcp' | 'memory' | 'workspace'
  status: DiagnosticStatus
  message: string
  details?: string
  durationMs?: number
}

export interface DiagnosticSuite {
  timestamp: string
  results: DiagnosticResult[]
  summary: { pass: number; warn: number; fail: number; skip: number; total: number }
}

/**
 * Run all diagnostic checks. Each check is independent and isolated —
 * a failure in one check doesn't prevent others from running.
 *
 * Dependencies are injected to avoid circular imports.
 */
export async function runDiagnostics(context: {
  storeGet: (key: string) => any
  hasProviders: () => boolean
  hasAgents: () => boolean
  hasMcpServers: () => boolean
  hasMemoryEntries: () => boolean
  hasWorkspace: () => boolean
  appVersion: string
}): Promise<DiagnosticSuite> {
  const results: DiagnosticResult[] = []
  const startAll = Date.now()

  // System checks
  results.push(checkStore(context))
  results.push(checkVersion(context))
  results.push(checkPlatform())

  // Provider checks
  results.push(checkProviders(context))

  // Agent checks
  results.push(checkAgents(context))

  // MCP checks
  results.push(checkMcp(context))

  // Memory checks
  results.push(checkMemory(context))

  // Workspace checks
  results.push(checkWorkspace(context))

  const summary = {
    pass: results.filter(r => r.status === 'pass').length,
    warn: results.filter(r => r.status === 'warn').length,
    fail: results.filter(r => r.status === 'fail').length,
    skip: results.filter(r => r.status === 'skip').length,
    total: results.length
  }

  return { timestamp: new Date().toISOString(), results, summary }
}

function timed(id: string, name: string, nameZh: string, category: DiagnosticResult['category'], fn: () => { status: DiagnosticStatus; message: string; details?: string }): DiagnosticResult {
  const start = Date.now()
  try {
    const result = fn()
    return { id, name, nameZh, category, ...result, durationMs: Date.now() - start }
  } catch (e: any) {
    return { id, name, nameZh, category, status: 'fail', message: e?.message || String(e), durationMs: Date.now() - start }
  }
}

function checkStore(ctx: { storeGet: (key: string) => any }): DiagnosticResult {
  return timed('store', 'Data Store', '数据存储', 'system', () => {
    try {
      ctx.storeGet('nonexistent-key-for-test')
      return { status: 'pass', message: 'Store is accessible' }
    } catch (e: any) {
      return { status: 'fail', message: `Store error: ${e?.message}` }
    }
  })
}

function checkVersion(ctx: { appVersion: string }): DiagnosticResult {
  return timed('version', 'App Version', '应用版本', 'system', () => {
    if (!ctx.appVersion || ctx.appVersion === '0.0.0') {
      return { status: 'warn', message: `Version not detected: ${ctx.appVersion}` }
    }
    return { status: 'pass', message: `AgentHub v${ctx.appVersion}` }
  })
}

function checkPlatform(): DiagnosticResult {
  return timed('platform', 'Platform', '运行平台', 'system', () => {
    return { status: 'pass', message: `${process.platform} ${process.arch}, Node ${process.versions?.node || '?'}` }
  })
}

function checkProviders(ctx: { hasProviders: () => boolean }): DiagnosticResult {
  return timed('providers', 'API Providers', 'API 供应商', 'providers', () => {
    if (ctx.hasProviders()) return { status: 'pass', message: 'At least one provider configured' }
    return { status: 'warn', message: 'No providers configured. Add an API key in Settings > Providers.' }
  })
}

function checkAgents(ctx: { hasAgents: () => boolean }): DiagnosticResult {
  return timed('agents', 'Local Agents', '本地 Agent', 'agents', () => {
    if (ctx.hasAgents()) return { status: 'pass', message: 'At least one local agent detected' }
    return { status: 'warn', message: 'No local agents detected. Install Codex, Claude, or another agent CLI.' }
  })
}

function checkMcp(ctx: { hasMcpServers: () => boolean }): DiagnosticResult {
  return timed('mcp', 'MCP Servers', 'MCP 服务', 'mcp', () => {
    if (ctx.hasMcpServers()) return { status: 'pass', message: 'MCP servers configured' }
    return { status: 'skip', message: 'No MCP servers configured (optional)' }
  })
}

function checkMemory(ctx: { hasMemoryEntries: () => boolean }): DiagnosticResult {
  return timed('memory', 'Long-Term Memory', '长期记忆', 'memory', () => {
    if (ctx.hasMemoryEntries()) return { status: 'pass', message: 'Memory entries exist' }
    return { status: 'skip', message: 'No memory entries yet (populated during use)' }
  })
}

function checkWorkspace(ctx: { hasWorkspace: () => boolean }): DiagnosticResult {
  return timed('workspace', 'Active Workspace', '工作目录', 'workspace', () => {
    if (ctx.hasWorkspace()) return { status: 'pass', message: 'Workspace bound to session' }
    return { status: 'warn', message: 'No workspace bound. Bind a directory in Settings > Workspaces.' }
  })
}
