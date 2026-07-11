/**
 * AgentHub 原生 agentic 工具集 —— 让任何 HTTP 模型也能在工作区动手。
 *
 * 工具作用域严格限制在 `root`（工作区根目录）之内：所有路径经 resolveWithin 校验，
 * 拒绝绝对路径、`..` 逃逸、指向 root 自身、以及符号链接逃逸（isRealPathWithin）。
 * readOnly=true（无工作区时降级）禁止 fs_write / exec，只允许只读工具。
 *
 * 路径安全逻辑与 src/main/hub/workspace.ts 一致（此处小份复刻，避免改动其脏文件）。
 */
import { execFile, spawn } from 'node:child_process'
import { statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { resolve as resolvePath, relative as relativePath, isAbsolute, dirname, sep as pathSep } from 'node:path'
import { decodeProcessChunk } from '../runtime/process-decoder'

export interface ToolContext {
  /** 工作区根目录（绝对路径）；所有路径相对它解析 */
  root: string
  /** 只读模式（无工作区降级时）：禁止写文件与执行命令 */
  readOnly: boolean
  /** Cancels an in-flight exec process during task or application shutdown. */
  signal?: AbortSignal
}

export interface ToolResult {
  ok: boolean
  output: string
}

const MAX_READ_CHARS = 64000
const MAX_OUTPUT_CHARS = 16000
const EXEC_TIMEOUT_MS = 60000

/** OpenAI function-calling 工具 schema（anthropic/gemini 由 client 适配转发）。 */
export const AGENTIC_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fs_read',
      description: 'Read a UTF-8 text file inside the workspace. Returns file content (truncated if large).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relative to the workspace root.' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fs_list',
      description: 'List entries of a directory inside the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path relative to workspace root. Empty = root.' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fs_write',
      description: 'Create or overwrite a UTF-8 text file inside the workspace. Parent dirs are created.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root.' },
          content: { type: 'string', description: 'Full file content to write.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exec',
      description: 'Run a shell command in the workspace root. Use for builds, tests, git, etc. Set shellOverride=true if the command needs shell features (pipes, redirects, etc.).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command line to run.' },
          shellOverride: { type: 'boolean', description: 'Set to true to run via shell (needed for pipes, redirects, &&, etc.). Requires approval.' }
        },
        required: ['command']
      }
    }
  }
]

/** 把相对路径安全解析到 root 之内；返回 null = 非法。 */
function resolveWithin(root: string, rel: unknown): string | null {
  if (rel === undefined || rel === null) return root // 空 = root（用于 fs_list）
  if (typeof rel !== 'string') return null
  const trimmed = rel.trim()
  if (!trimmed) return root
  if (isAbsolute(trimmed)) return null
  const abs = resolvePath(root, trimmed)
  const r = relativePath(root, abs)
  if (r === '..' || r.startsWith('..' + pathSep) || r.startsWith('../') || isAbsolute(r)) return null
  return abs
}

function isRealPathWithin(root: string, target: string): boolean {
  let rootReal: string
  try { rootReal = realpathSync(root) } catch { return false }
  // target 可能尚不存在（写新文件、含未建的父目录）：向上找到第一个真实存在的祖先再校验，
  // 防止符号链接逃逸，同时允许在 root 内创建多级新目录。
  let cur = target
  for (let i = 0; i < 64; i++) {
    try {
      const real = realpathSync(cur)
      const r = relativePath(rootReal, real)
      return r === '' || (r !== '..' && !r.startsWith('..' + pathSep) && !r.startsWith('../') && !isAbsolute(r))
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return false
      cur = parent
    }
  }
  return false
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n…(truncated, ${s.length - max} more chars)` : s
}

/** Shell metacharacters that indicate a command needs shell interpretation. */
const SHELL_META_REGEX = /[|&;><`$(){}!#~]/

/**
 * Split a command string into [program, ...args] for safe shell:false execution.
 * Handles quoted strings. Returns null if the command contains shell metacharacters
 * that cannot be safely split (pipes, redirects, chaining, etc.).
 */
function splitCommand(command: string): [string, string[]] | null {
  const trimmed = command.trim()
  if (!trimmed) return null
  // If command contains shell metacharacters, it needs shell interpretation
  if (SHELL_META_REGEX.test(trimmed)) return null
  // Simple split on whitespace (respects basic quoting)
  const parts: string[] = []
  let current = ""
  let inQuote: string | null = null
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inQuote) {
      if (ch === inQuote) { inQuote = null } else { current += ch }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (ch === " " || ch === "\t") {
      if (current) { parts.push(current); current = "" }
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  if (parts.length === 0) return null
  return [parts[0], parts.slice(1)]
}

function runCommand(command: string, cwd: string, shellOverride?: boolean, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) {
    return Promise.resolve({ ok: false, output: '[aborted before command execution]' })
  }
  return new Promise<ToolResult>((resolve) => {
    let out = ''
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let sigkillTimer: ReturnType<typeof setTimeout> | null = null
    let abortListener: (() => void) | null = null
    let stopReason: 'aborted' | 'timed-out' | null = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (sigkillTimer) clearTimeout(sigkillTimer)
      timer = null
      sigkillTimer = null
      if (abortListener) signal?.removeEventListener('abort', abortListener)
      abortListener = null
    }
    const finish = (ok: boolean, text: string) => {
      if (done) return
      done = true
      cleanup()
      resolve({ ok, output: clip(text, MAX_OUTPUT_CHARS) })
    }
    try {
      // P0-2: Default to shell:false for security. Only use shell:true when
      // explicitly requested (shellOverride=true) or when the command contains
      // shell metacharacters that require shell interpretation.
      const useShell = shellOverride === true
      let child: ReturnType<typeof spawn>
      if (useShell) {
        child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' })
      } else {
        const split = splitCommand(command)
        if (split) {
          const [cmd, args] = split
          child = spawn(cmd, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32' })
        } else {
          // Command has shell metacharacters but shell not approved — reject
          finish(false, '[security] Command contains shell metacharacters (|, &, ;, >, <, $, etc.) and requires explicit shell approval. Use shellOverride=true after approval.')
          return
        }
      }
      const forceKillDirectly = (signalName: NodeJS.Signals = 'SIGTERM') => {
        if (done) return
        if (process.platform !== 'win32' && child.pid) {
          try { process.kill(-child.pid, signalName) } catch { try { child.kill(signalName) } catch { /* process may already have exited */ } }
        } else {
          try { child.kill(signalName) } catch { /* process may already have exited */ }
        }
        sigkillTimer = setTimeout(() => {
          if (done) return
          if (process.platform !== 'win32' && child.pid) {
            try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* process may already have exited */ } }
          } else {
            try { child.kill('SIGKILL') } catch { /* process may already have exited */ }
          }
        }, 500)
      }
      const requestStop = (reason: 'aborted' | 'timed-out') => {
        if (done || stopReason) return
        stopReason = reason
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (process.platform === 'win32' && child.pid) {
          try {
            execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, error => {
              if (error && !done) forceKillDirectly()
            })
          } catch {
            forceKillDirectly()
          }
          return
        }
        forceKillDirectly('SIGTERM')
      }
      // LOW-12: Cap intermediate output buffer to prevent unbounded memory growth
      const MAX_BUFFER = MAX_OUTPUT_CHARS * 2
      child.stdout?.on('data', d => { if (out.length < MAX_BUFFER) out += decodeProcessChunk(d) })
      child.stderr?.on('data', d => { if (out.length < MAX_BUFFER) out += decodeProcessChunk(d) })
      child.on('error', e => {
        if (stopReason === 'aborted') finish(false, (out || '(no output)') + '\n[aborted]')
        else if (stopReason === 'timed-out') finish(false, out + `\n[timed out after ${EXEC_TIMEOUT_MS / 1000}s]`)
        else finish(false, out + '\n[spawn error] ' + (e as Error).message)
      })
      child.on('close', code => {
        if (stopReason === 'aborted') finish(false, (out || '(no output)') + '\n[aborted]')
        else if (stopReason === 'timed-out') finish(false, out + `\n[timed out after ${EXEC_TIMEOUT_MS / 1000}s]`)
        else finish(code === 0, (out || '(no output)') + `\n[exit code ${code}]`)
      })
      timer = setTimeout(() => { requestStop('timed-out') }, EXEC_TIMEOUT_MS)
      abortListener = () => { requestStop('aborted') }
      signal?.addEventListener('abort', abortListener, { once: true })
      if (signal?.aborted) abortListener()
    } catch (e) {
      finish(false, '[exec failed] ' + (e as Error).message)
    }
  })
}

/** 执行一个工具调用；name 未知或参数非法 → ok:false（喂回模型让它纠正）。 */
export async function executeTool(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
  const a = args && typeof args === 'object' ? args : {}
  if (ctx.signal?.aborted) return { ok: false, output: '[aborted before tool execution]' }
  try {
    if (name === 'fs_read') {
      const abs = resolveWithin(ctx.root, a.path)
      if (!abs || !isRealPathWithin(ctx.root, abs)) return { ok: false, output: 'Rejected: path escapes the workspace.' }
      const st = statSync(abs)
      if (!st.isFile()) return { ok: false, output: 'Not a file: ' + a.path }
      return { ok: true, output: clip(readFileSync(abs, 'utf-8'), MAX_READ_CHARS) }
    }
    if (name === 'fs_list') {
      const abs = resolveWithin(ctx.root, a.path)
      if (!abs || !isRealPathWithin(ctx.root, abs)) return { ok: false, output: 'Rejected: path escapes the workspace.' }
      const entries = readdirSync(abs, { withFileTypes: true })
        .map(e => (e.isDirectory() ? e.name + '/' : e.name))
      return { ok: true, output: entries.length ? entries.join('\n') : '(empty)' }
    }
    if (name === 'fs_write') {
      if (ctx.readOnly) return { ok: false, output: 'Rejected: read-only (no workspace set). Set a workspace to allow writes.' }
      const abs = resolveWithin(ctx.root, a.path)
      if (!abs || !isRealPathWithin(ctx.root, abs)) return { ok: false, output: 'Rejected: path escapes the workspace.' }
      if (typeof a.content !== 'string') return { ok: false, output: 'Rejected: content must be a string.' }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, a.content, 'utf-8')
      return { ok: true, output: `Wrote ${a.content.length} chars to ${a.path}` }
    }
    if (name === 'exec') {
      if (ctx.readOnly) return { ok: false, output: 'Rejected: read-only (no workspace set). Set a workspace to allow command execution.' }
      if (typeof a.command !== 'string' || !a.command.trim()) return { ok: false, output: 'Rejected: empty command.' }
      // P0-2: shellOverride must be explicitly approved via the approval system
      const shellApproved = a.shellOverride === true
      return await runCommand(a.command, ctx.root, shellApproved, ctx.signal)
    }
    return { ok: false, output: 'Unknown tool: ' + name }
  } catch (e) {
    return { ok: false, output: '[tool error] ' + (e as Error).message }
  }
}
