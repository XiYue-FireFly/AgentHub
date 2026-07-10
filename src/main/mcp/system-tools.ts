/**
 * MCP System Tools - 内建系统级工具
 *
 * 提供工作区（ctx.cwd）内的文件系统读写、Shell 执行、系统信息查询。
 * 所有路径经 isPathInsideBase 约束在 cwd 内；写/执行另受审批门控。
 */

import { spawn } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  unlinkSync,
  renameSync,
  copyFileSync,
  rmdirSync,
  realpathSync
} from 'node:fs'
import { resolve, isAbsolute, dirname, basename, join } from 'node:path'
import { homedir, platform, arch, release, totalmem, freemem, cpus, hostname } from 'node:os'
import { decodeProcessChunk } from '../runtime/process-decoder'
import { isPathInsideBase } from '../ipc/path-guards'

// ============================================================
// Types
// ============================================================

export interface SystemToolContext {
  /** 当前工作目录 */
  cwd: string
  /** 是否只读模式 */
  readOnly: boolean
}

export interface SystemToolResult {
  ok: boolean
  output: string
  error?: string
}

export type SystemToolName = 'fs_read' | 'fs_write' | 'fs_list' | 'fs_delete' | 'fs_move' | 'fs_copy' | 'shell_exec' | 'system_info'

// ============================================================
// Constants
// ============================================================

const MAX_READ_CHARS = 128_000
const MAX_OUTPUT_CHARS = 32_000
const EXEC_TIMEOUT_MS = 120_000
const MAX_DIR_ENTRIES = 500

// ============================================================
// MCP Tool Schemas
// ============================================================

export const SYSTEM_TOOL_SCHEMAS = [
  {
    name: 'fs_read',
    description: 'Read a UTF-8 text file from anywhere on the system. Returns file content (truncated if large).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path.' },
        offset: { type: 'number', description: 'Start reading from this line number (0-based).' },
        limit: { type: 'number', description: 'Maximum number of lines to read.' }
      },
      required: ['path']
    }
  },
  {
    name: 'fs_write',
    description: 'Create or overwrite a UTF-8 text file. Parent directories are created automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path.' },
        content: { type: 'string', description: 'Full file content to write.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'fs_list',
    description: 'List entries of a directory. Returns file names, sizes, and types.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Empty = current working directory.' },
        recursive: { type: 'boolean', description: 'List recursively (max depth 3).' }
      }
    }
  },
  {
    name: 'fs_delete',
    description: 'Delete a file or directory. Directories are deleted recursively.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete.' }
      },
      required: ['path']
    }
  },
  {
    name: 'fs_move',
    description: 'Move or rename a file or directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path.' },
        destination: { type: 'string', description: 'Destination path.' }
      },
      required: ['source', 'destination']
    }
  },
  {
    name: 'fs_copy',
    description: 'Copy a file or directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path.' },
        destination: { type: 'string', description: 'Destination path.' }
      },
      required: ['source', 'destination']
    }
  },
  {
    name: 'shell_exec',
    description: 'Execute a shell command. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory for the command (must stay inside tool cwd).' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000).' }
        // env intentionally omitted: caller env is ignored for security (G2-MH3)
      },
      required: ['command']
    }
  },
  {
    name: 'system_info',
    description: 'Get system information including OS, CPU, memory, and disk usage.',
    inputSchema: {
      type: 'object',
      properties: {
        detailed: { type: 'boolean', description: 'Include detailed information.' }
      }
    }
  }
]

// ============================================================
// Tool Implementations
// ============================================================

/**
 * Resolve a path and require it to stay inside cwd (workspace scope).
 * Uses realpath on existing ancestors to block symlink escapes (G2-MC2).
 */
function resolvePath(pathStr: string, cwd: string): string | null {
  if (!pathStr || typeof pathStr !== 'string' || !cwd) return null
  const base = resolve(cwd)
  const resolved = isAbsolute(pathStr) ? resolve(pathStr) : resolve(base, pathStr)
  if (!isPathInsideBase(resolved, base)) return null

  let rootReal: string
  try {
    rootReal = realpathSync(base)
  } catch {
    // cwd not present yet: logical isPathInsideBase already passed
    return resolved
  }

  // Walk up to first existing ancestor and verify realpath stays under rootReal
  let cur = resolved
  for (let i = 0; i < 64; i++) {
    try {
      const real = realpathSync(cur)
      if (!isPathInsideBase(real, rootReal)) return null
      return resolved
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return null
      cur = parent
    }
  }
  return null
}

function pathEscapeError(label = 'path'): SystemToolResult {
  return { ok: false, output: '', error: `${label} escapes the workspace cwd` }
}

function safeReadFile(filePath: string, offset?: number, limit?: number): SystemToolResult {
  try {
    if (!existsSync(filePath)) {
      return { ok: false, output: '', error: `File not found: ${filePath}` }
    }

    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      return { ok: false, output: '', error: `Path is a directory: ${filePath}` }
    }

    let content = readFileSync(filePath, 'utf-8')

    // Apply line offset and limit
    if (offset !== undefined || limit !== undefined) {
      const lines = content.split('\n')
      const start = offset || 0
      const end = limit ? start + limit : lines.length
      content = lines.slice(start, end).join('\n')
    }

    // Truncate if too large
    if (content.length > MAX_READ_CHARS) {
      content = content.slice(0, MAX_READ_CHARS) + '\n\n... [truncated]'
    }

    return { ok: true, output: content }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to read file: ${error.message}` }
  }
}

function safeWriteFile(filePath: string, content: string): SystemToolResult {
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(filePath, content, 'utf-8')
    return { ok: true, output: `File written successfully: ${filePath}` }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to write file: ${error.message}` }
  }
}

function safeListDir(dirPath: string, recursive = false, depth = 0): SystemToolResult {
  try {
    if (!existsSync(dirPath)) {
      return { ok: false, output: '', error: `Directory not found: ${dirPath}` }
    }

    const stat = statSync(dirPath)
    if (!stat.isDirectory()) {
      return { ok: false, output: '', error: `Path is not a directory: ${dirPath}` }
    }

    const entries = readdirSync(dirPath, { withFileTypes: true })
    const results: string[] = []

    for (const entry of entries.slice(0, MAX_DIR_ENTRIES)) {
      const fullPath = join(dirPath, entry.name)
      const entryStat = statSync(fullPath)
      const size = entryStat.size
      const type = entry.isDirectory() ? 'directory' : 'file'
      const modified = entryStat.mtime.toISOString()

      results.push(`${entry.name} (${type}, ${size} bytes, modified: ${modified})`)

      // Recursive listing (max depth 3)
      if (recursive && entry.isDirectory() && depth < 3) {
        const subResult = safeListDir(fullPath, true, depth + 1)
        if (subResult.ok) {
          const subLines = subResult.output.split('\n').map(line => `  ${line}`)
          results.push(...subLines)
        }
      }
    }

    if (entries.length > MAX_DIR_ENTRIES) {
      results.push(`... and ${entries.length - MAX_DIR_ENTRIES} more entries`)
    }

    return { ok: true, output: results.join('\n') }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to list directory: ${error.message}` }
  }
}

function safeDelete(targetPath: string): SystemToolResult {
  try {
    if (!existsSync(targetPath)) {
      return { ok: false, output: '', error: `Path not found: ${targetPath}` }
    }

    const stat = statSync(targetPath)
    if (stat.isDirectory()) {
      // Recursive delete
      const entries = readdirSync(targetPath)
      for (const entry of entries) {
        const fullPath = join(targetPath, entry)
        safeDelete(fullPath)
      }
      rmdirSync(targetPath)
    } else {
      unlinkSync(targetPath)
    }

    return { ok: true, output: `Deleted successfully: ${targetPath}` }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to delete: ${error.message}` }
  }
}

function safeMove(source: string, destination: string): SystemToolResult {
  try {
    if (!existsSync(source)) {
      return { ok: false, output: '', error: `Source not found: ${source}` }
    }

    const destDir = dirname(destination)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }

    renameSync(source, destination)
    return { ok: true, output: `Moved successfully: ${source} -> ${destination}` }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to move: ${error.message}` }
  }
}

function safeCopy(source: string, destination: string): SystemToolResult {
  try {
    if (!existsSync(source)) {
      return { ok: false, output: '', error: `Source not found: ${source}` }
    }

    const stat = statSync(source)
    const destDir = dirname(destination)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }

    if (stat.isDirectory()) {
      // Recursive copy
      mkdirSync(destination, { recursive: true })
      const entries = readdirSync(source)
      for (const entry of entries) {
        const srcPath = join(source, entry)
        const destPath = join(destination, entry)
        safeCopy(srcPath, destPath)
      }
    } else {
      copyFileSync(source, destination)
    }

    return { ok: true, output: `Copied successfully: ${source} -> ${destination}` }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to copy: ${error.message}` }
  }
}

async function safeExec(
  command: string,
  cwd: string,
  timeout = EXEC_TIMEOUT_MS
): Promise<SystemToolResult> {
  return new Promise((resolve) => {
    const isWin = platform() === 'win32'
    const shell = isWin ? 'cmd.exe' : '/bin/sh'
    const args = isWin ? ['/c', command] : ['-c', command]

    // G2-MH3: never merge caller-controlled env (PATH/BASH_ENV/etc. injection)
    const child = spawn(shell, args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += decodeProcessChunk(chunk)
      if (stdout.length > MAX_OUTPUT_CHARS) {
        stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + '\n... [truncated]'
      }
    })

    child.stderr.on('data', (chunk) => {
      stderr += decodeProcessChunk(chunk)
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = stderr.slice(0, MAX_OUTPUT_CHARS) + '\n... [truncated]'
      }
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        ok: false,
        output: stdout,
        error: `Command timed out after ${timeout}ms`
      })
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        output: stdout || stderr || `(exit code: ${code})`,
        error: code !== 0 ? stderr || `Exit code: ${code}` : undefined
      })
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        output: '',
        error: `Failed to execute command: ${error.message}`
      })
    })
  })
}

function getSystemInfo(detailed = false): SystemToolResult {
  try {
    const info: Record<string, any> = {
      platform: platform(),
      arch: arch(),
      release: release(),
      hostname: hostname(),
      homedir: homedir(),
      cwd: process.cwd(),
      nodeVersion: process.version,
      uptime: process.uptime()
    }

    if (detailed) {
      info.totalMemory = `${Math.round(totalmem() / 1024 / 1024)} MB`
      info.freeMemory = `${Math.round(freemem() / 1024 / 1024)} MB`
      info.cpus = cpus().length
      info.cpuModel = cpus()[0]?.model || 'Unknown'
      info.env = Object.keys(process.env).length
    }

    return {
      ok: true,
      output: JSON.stringify(info, null, 2)
    }
  } catch (error: any) {
    return { ok: false, output: '', error: `Failed to get system info: ${error.message}` }
  }
}

// ============================================================
// Tool Executor
// ============================================================

export async function executeSystemTool(
  toolName: SystemToolName,
  args: Record<string, any>,
  ctx: SystemToolContext
): Promise<SystemToolResult> {
  const cwd = ctx.cwd || homedir()

  switch (toolName) {
    case 'fs_read': {
      const filePath = resolvePath(args.path, cwd)
      if (!filePath) return pathEscapeError('path')
      return safeReadFile(filePath, args.offset, args.limit)
    }

    case 'fs_write': {
      if (ctx.readOnly) {
        return { ok: false, output: '', error: 'Write operation not allowed in read-only mode' }
      }
      const filePath = resolvePath(args.path, cwd)
      if (!filePath) return pathEscapeError('path')
      return safeWriteFile(filePath, args.content)
    }

    case 'fs_list': {
      if (args.path) {
        const dirPath = resolvePath(args.path, cwd)
        if (!dirPath) return pathEscapeError('path')
        return safeListDir(dirPath, args.recursive)
      }
      return safeListDir(cwd, args.recursive)
    }

    case 'fs_delete': {
      if (ctx.readOnly) {
        return { ok: false, output: '', error: 'Delete operation not allowed in read-only mode' }
      }
      const targetPath = resolvePath(args.path, cwd)
      if (!targetPath) return pathEscapeError('path')
      return safeDelete(targetPath)
    }

    case 'fs_move': {
      if (ctx.readOnly) {
        return { ok: false, output: '', error: 'Move operation not allowed in read-only mode' }
      }
      const source = resolvePath(args.source, cwd)
      if (!source) return pathEscapeError('source')
      const destination = resolvePath(args.destination, cwd)
      if (!destination) return pathEscapeError('destination')
      return safeMove(source, destination)
    }

    case 'fs_copy': {
      if (ctx.readOnly) {
        return { ok: false, output: '', error: 'Copy operation not allowed in read-only mode' }
      }
      const source = resolvePath(args.source, cwd)
      if (!source) return pathEscapeError('source')
      const destination = resolvePath(args.destination, cwd)
      if (!destination) return pathEscapeError('destination')
      return safeCopy(source, destination)
    }

    case 'shell_exec': {
      if (ctx.readOnly) {
        return { ok: false, output: '', error: 'Shell execution not allowed in read-only mode' }
      }
      let execCwd = cwd
      if (args.cwd) {
        const resolvedCwd = resolvePath(args.cwd, cwd)
        if (!resolvedCwd) return pathEscapeError('cwd')
        execCwd = resolvedCwd
      }
      return safeExec(args.command, execCwd, args.timeout)
    }

    case 'system_info': {
      return getSystemInfo(args.detailed)
    }

    default:
      return { ok: false, output: '', error: `Unknown tool: ${toolName}` }
  }
}

// ============================================================
// Guarded Category Mapping
// ============================================================

/**
 * 将工具名映射到审批类别
 * shell_exec -> exec
 */
export function guardedCategoryForTool(toolName: SystemToolName): 'read' | 'write' | 'exec' {
  switch (toolName) {
    case 'fs_read':
    case 'fs_list':
    case 'system_info':
      return 'read'
    case 'fs_write':
    case 'fs_delete':
    case 'fs_move':
    case 'fs_copy':
      return 'write'
    case 'shell_exec':
      return 'exec'
    default:
      return 'read'
  }
}

/**
 * OpenAI 格式的工具定义
 */
export function systemToolsOpenAi() {
  return SYSTEM_TOOL_SCHEMAS.map(schema => ({
    type: 'function',
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.inputSchema
    }
  }))
}
