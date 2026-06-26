/**
 * Unified Error Model for AgentHub.
 *
 * Provides a consistent error structure across all subsystems:
 * provider, MCP, Git, Browser, GitHub, Terminal, local agent.
 * UI can display "reason + suggested action" uniformly.
 *
 * P3-4: Unified error model.
 */

export type ErrorSource = 'provider' | 'mcp' | 'git' | 'browser' | 'github' | 'terminal' | 'agent' | 'memory' | 'workflow' | 'system'

export interface AppError {
  /** Machine-readable error code (e.g. 'PROVIDER_API_KEY_MISSING', 'MCP_TIMEOUT') */
  code: string
  /** Human-readable message */
  message: string
  /** Optional root cause */
  cause?: string
  /** Suggested fix action */
  action?: string
  /** Error source subsystem */
  source: ErrorSource
  /** Whether the operation can be retried */
  retryable: boolean
  /** ISO timestamp */
  timestamp: string
  /** Optional raw error for debugging */
  raw?: unknown
}

/**
 * Create a structured AppError.
 */
export function createError(
  source: ErrorSource,
  code: string,
  message: string,
  opts?: { cause?: string; action?: string; retryable?: boolean; raw?: unknown }
): AppError {
  return {
    code,
    message,
    cause: opts?.cause,
    action: opts?.action,
    source,
    retryable: opts?.retryable ?? false,
    timestamp: new Date().toISOString(),
    raw: opts?.raw
  }
}

/**
 * Wrap an unknown error into an AppError.
 */
export function wrapError(source: ErrorSource, err: unknown, context?: string): AppError {
  // LOW-22: Check err.message property for non-Error objects that have one
  const message = err instanceof Error
    ? err.message
    : (typeof err === 'object' && err !== null && typeof (err as any).message === 'string'
      ? (err as any).message
      : String(err))
  // LOW-26: Extend cause to 5 lines; derive cause from non-Error values too
  const cause = deriveCause(err)
  return createError(source, 'UNKNOWN', context ? `${context}: ${message}` : message, {
    cause,
    retryable: false,
    raw: err
  })
}

/** LOW-26: Derive a cause string from unknown error values (up to 5 lines). */
function deriveCause(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.stack?.split('\n').slice(0, 5).join('\n')
  }
  if (typeof err === 'string') return err || undefined
  if (typeof err === 'object' && err !== null) {
    try { return JSON.stringify(err, null, 2).split('\n').slice(0, 5).join('\n') } catch { return undefined }
  }
  return undefined
}

/**
 * Common error codes for quick construction.
 */
export const ERRORS = {
  // Provider
  PROVIDER_API_KEY_MISSING: (provider: string) =>
    createError('provider', 'PROVIDER_API_KEY_MISSING', `API key not configured for ${provider}`, { action: 'Add API key in Settings → Providers' }),
  PROVIDER_UNREACHABLE: (provider: string) =>
    createError('provider', 'PROVIDER_UNREACHABLE', `Cannot connect to ${provider}`, { retryable: true, action: 'Check network connection and API endpoint' }),
  PROVIDER_MODEL_NOT_FOUND: (provider: string, model: string) =>
    createError('provider', 'PROVIDER_MODEL_NOT_FOUND', `Model ${model} not found in ${provider}`, { action: 'Verify the model name and provider configuration' }),

  // MCP
  MCP_TIMEOUT: (server: string) =>
    createError('mcp', 'MCP_TIMEOUT', `MCP server ${server} timed out`, { retryable: true, action: 'Check MCP server command and configuration' }),
  MCP_INVALID_RESPONSE: (server: string) =>
    createError('mcp', 'MCP_INVALID_RESPONSE', `MCP server ${server} returned invalid JSON-RPC response`, { action: 'Verify MCP server version and protocol support' }),
  MCP_COMMAND_NOT_FOUND: (server: string, command: string) =>
    createError('mcp', 'MCP_COMMAND_NOT_FOUND', `MCP command not found: ${command}`, { action: 'Install or configure the MCP server' }),

  // Git
  GIT_NOT_REPO: () =>
    createError('git', 'GIT_NOT_REPO', 'Not a git repository', { action: 'Initialize a git repository or bind a workspace' }),
  GIT_PUSH_FAILED: () =>
    createError('git', 'GIT_PUSH_FAILED', 'Push failed', { retryable: true, action: 'Check remote credentials and branch protection rules' }),

  // Agent
  AGENT_NOT_FOUND: (agentId: string) =>
    createError('agent', 'AGENT_NOT_FOUND', `Agent ${agentId} not found or not available`, { action: 'Check agent installation in Settings → Local Agents' }),
  AGENT_TIMEOUT: (agentId: string) =>
    createError('agent', 'AGENT_TIMEOUT', `Agent ${agentId} timed out`, { retryable: true }),
  AGENT_CANCELLED: () =>
    createError('agent', 'AGENT_CANCELLED', 'Task was cancelled by user', { action: 'Re-run the task if needed' }),

  // System
  STORE_ACCESS_DENIED: (key: string) =>
    createError('system', 'STORE_ACCESS_DENIED', `Access denied for store key: ${key}`, { action: 'Check app permissions and storage access' }),
  WORKSPACE_NOT_BOUND: () =>
    createError('system', 'WORKSPACE_NOT_BOUND', 'No workspace bound to this session', { action: 'Bind a workspace in Settings → Workspaces' })
} as const
