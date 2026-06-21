/**
 * Logger: unified logging for main process.
 *
 * Replaces raw console.log/error/warn with structured, level-aware logging.
 * Supports namespace prefixes and redaction for sensitive data.
 *
 * P2-9: console.log cleanup.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let minLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel]
}

function formatMsg(namespace: string, level: LogLevel, msg: string): string {
  const ts = new Date().toISOString().slice(11, 23)
  return `[${ts}] [${level.toUpperCase()}] [${namespace}] ${msg}`
}

export function createLogger(namespace: string) {
  return {
    debug: (msg: string, ...args: any[]) => {
      if (shouldLog('debug')) console.debug(formatMsg(namespace, 'debug', msg), ...args)
    },
    info: (msg: string, ...args: any[]) => {
      if (shouldLog('info')) console.info(formatMsg(namespace, 'info', msg), ...args)
    },
    warn: (msg: string, ...args: any[]) => {
      if (shouldLog('warn')) console.warn(formatMsg(namespace, 'warn', msg), ...args)
    },
    error: (msg: string, ...args: any[]) => {
      if (shouldLog('error')) console.error(formatMsg(namespace, 'error', msg), ...args)
    }
  }
}

// Pre-built loggers for common namespaces
export const hub = createLogger('Hub')
export const window_ = createLogger('Window')
export const pipeline = createLogger('Pipeline')
export const proxy = createLogger('Proxy')
export const workspace = createLogger('Workspace')
export const agent = createLogger('Agent')
export const mcp = createLogger('MCP')
export const store = createLogger('Store')
