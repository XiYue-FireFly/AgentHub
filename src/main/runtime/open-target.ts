/**
 * Open Target: editor and file manager detection + launching.
 *
 * Declares known editors with detection paths, formats jump-to-line
 * arguments per editor, and provides fallback to OS default opener.
 *
 * Renderer passes a target ID; main resolves and launches.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

export interface EditorCandidate {
  id: string
  name: string
  nameZh: string
  /** Common CLI commands to try */
  commands: string[]
  /** Windows-specific install paths */
  winPaths: string[]
  /** macOS-specific app paths */
  macPaths: string[]
  /** How to format jump-to-line: -g file:line:col for VS Code style */
  lineStyle: 'vscode' | 'xcode' | 'sublime' | 'zed' | 'none'
}

export const EDITOR_CANDIDATES: EditorCandidate[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    nameZh: 'VS Code',
    commands: ['code'],
    winPaths: [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'bin', 'code.cmd'),
      join(process.env['ProgramFiles(x86)'] || '', 'Microsoft VS Code', 'bin', 'code.cmd')
    ],
    macPaths: ['/usr/local/bin/code', '/opt/homebrew/bin/code'],
    lineStyle: 'vscode'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    nameZh: 'Cursor',
    commands: ['cursor'],
    winPaths: [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'bin', 'cursor.cmd'),
      join(process.env.ProgramFiles || '', 'Cursor', 'bin', 'cursor.cmd')
    ],
    macPaths: ['/usr/local/bin/cursor'],
    lineStyle: 'vscode'
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    nameZh: 'Windsurf',
    commands: ['windsurf'],
    winPaths: [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'windsurf', 'bin', 'windsurf.cmd')
    ],
    macPaths: ['/usr/local/bin/windsurf'],
    lineStyle: 'vscode'
  },
  {
    id: 'zed',
    name: 'Zed',
    nameZh: 'Zed',
    commands: ['zed'],
    winPaths: [],
    macPaths: ['/usr/local/bin/zed'],
    lineStyle: 'zed'
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    nameZh: 'Antigravity',
    commands: ['antigravity'],
    winPaths: [
      join(process.env.LOCALAPPDATA || '', 'Antigravity', 'bin', 'antigravity.cmd')
    ],
    macPaths: [],
    lineStyle: 'vscode'
  },
  {
    id: 'system',
    name: 'System Default',
    nameZh: '系统默认',
    commands: [],
    winPaths: [],
    macPaths: [],
    lineStyle: 'none'
  },
  {
    id: 'file-manager',
    name: 'File Manager',
    nameZh: '文件管理器',
    commands: [],
    winPaths: [],
    macPaths: [],
    lineStyle: 'none'
  }
]

/** Build editor arguments for jump-to-line. */
export function buildEditorArgs(editor: EditorCandidate, filePath: string, line?: number, column?: number): string[] {
  if (!line) return [filePath]
  switch (editor.lineStyle) {
    case 'vscode':
      return ['-g', `${filePath}:${line}:${column || 1}`]
    case 'xcode':
      return ['-l', String(line), filePath]
    case 'sublime':
      return [`${filePath}:${line}:${column || 1}`]
    case 'zed':
      return [`${filePath}:${line}:${column || 1}`]
    default:
      return [filePath]
  }
}

/** Detect which editor binary is available on this system. */
export function detectEditor(editorId: string): { found: boolean; path?: string } {
  const editor = EDITOR_CANDIDATES.find(e => e.id === editorId)
  if (!editor) return { found: false }
  if (editor.id === 'system' || editor.id === 'file-manager') return { found: true, path: editor.id }
  // Check platform-specific paths first
  const platformPaths = process.platform === 'darwin' ? editor.macPaths : editor.winPaths
  for (const p of platformPaths) {
    if (existsSync(p)) return { found: true, path: p }
  }
  // Try commands via PATH using where.exe (Windows) or which (macOS/Linux)
  for (const cmd of editor.commands) {
    try {
      const lookupCmd = process.platform === 'win32' ? 'where.exe' : 'which'
      const result = require('child_process').execFileSync(lookupCmd, [cmd], {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }).trim().split(/\r?\n/)[0]
      if (result && existsSync(result)) return { found: true, path: result }
    } catch { /* not found in PATH */ }
  }
  return { found: false }
}

/** Open a file path with the specified editor. */
export function openWithEditor(editorId: string, filePath: string, line?: number, column?: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    const editor = EDITOR_CANDIDATES.find(e => e.id === editorId)
    if (!editor) { resolve({ ok: false, error: `Unknown editor: ${editorId}` }); return }

    // System default: use OS opener
    if (editor.id === 'system') {
      try {
        const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        execFile(cmd, [filePath], { windowsHide: true }, err => {
          resolve(err ? { ok: false, error: err.message } : { ok: true })
        })
      } catch (e: any) { resolve({ ok: false, error: e.message }) }
      return
    }

    // File manager: reveal in folder
    if (editor.id === 'file-manager') {
      try {
        if (process.platform === 'win32') {
          execFile('explorer.exe', ['/select,', filePath], { windowsHide: true }, err => {
            resolve(err ? { ok: false, error: err.message } : { ok: true })
          })
        } else if (process.platform === 'darwin') {
          execFile('open', ['-R', filePath], { windowsHide: true }, err => {
            resolve(err ? { ok: false, error: err.message } : { ok: true })
          })
        } else {
          resolve({ ok: false, error: 'File manager reveal not supported on this platform' })
        }
      } catch (e: any) { resolve({ ok: false, error: e.message }) }
      return
    }

    // Named editor: detect binary, build args, launch
    const detected = detectEditor(editorId)
    if (!detected.found || !detected.path) {
      resolve({ ok: false, error: `Editor not found: ${editor.name}` })
      return
    }
    const args = buildEditorArgs(editor, filePath, line, column)
    execFile(detected.path, args, { windowsHide: true }, err => {
      resolve(err ? { ok: false, error: err.message } : { ok: true })
    })
  })
}
