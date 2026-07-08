/**
 * Terminal PTY IPC: persistent pseudo-terminal sessions (Kun-inspired).
 *
 * The main process owns real PTY sessions via node-pty, streams output
 * to the renderer via 'terminal:data' events, and reports exit via
 * 'terminal:exit'. Sessions persist across panel toggle (re-attach
 * replays the ring buffer).
 */

import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { typedHandle } from './typed-ipc'

type TerminalSession = {
  pty: any // IPty from node-pty
  sender: Electron.WebContents
  ringBuffer: string
  exited: boolean
  cleanupOnDestroy?: () => void
}

const sessions = new Map<string, TerminalSession>()
const MAX_SESSIONS = 8
const RING_BUFFER_MAX = 65536 // 64KB ring buffer

let nodePty: typeof import('node-pty') | null | undefined

async function loadNodePty(): Promise<typeof import('node-pty') | null> {
  if (nodePty !== undefined) return nodePty
  try {
    nodePty = await import('node-pty')
  } catch (error) {
    console.warn('[terminal-pty] node-pty failed to load:', error)
    nodePty = null
  }
  return nodePty
}

function resolveDefaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    const pwsh7 = join(programFiles, 'PowerShell', '7', 'pwsh.exe')
    if (existsSync(pwsh7)) return { file: pwsh7, args: ['-NoLogo'] }
    const windowsPwsh = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (existsSync(windowsPwsh)) return { file: windowsPwsh, args: ['-NoLogo'] }
    return { file: process.env.COMSPEC ?? 'cmd.exe', args: [] }
  }
  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return { file: process.env.SHELL || fallback, args: [] }
}

function appendRingBuffer(current: string, data: string): string {
  const combined = current + data
  if (combined.length <= RING_BUFFER_MAX) return combined
  return combined.slice(combined.length - RING_BUFFER_MAX)
}

function replayRingBuffer(sender: Electron.WebContents, sessionId: string, ringBuffer: string): void {
  if (!ringBuffer || sender.isDestroyed()) return
  sender.send('terminal:data', { sessionId, data: ringBuffer })
}

function attachSenderToSession(sessionId: string, session: TerminalSession, sender: Electron.WebContents): void {
  if (session.cleanupOnDestroy && !session.sender.isDestroyed()) {
    session.sender.removeListener('destroyed', session.cleanupOnDestroy)
  }
  session.sender = sender
  const cleanupOnDestroy = () => {
    if (session.exited) return
    try { session.pty.kill() } catch { /* ignore */ }
    session.exited = true
    sessions.delete(sessionId)
  }
  session.cleanupOnDestroy = cleanupOnDestroy
  sender.once('destroyed', cleanupOnDestroy)
}

export function registerTerminalPtyIpc(_getMainWindow: () => BrowserWindow | null): void {
  typedHandle('terminal:create', async (_event, payload) => {
    const ptyModule = await loadNodePty()
    if (!ptyModule) {
      return { ok: false, message: 'node-pty not available. Built-in terminal is disabled.' }
    }

    const { sessionId, cwd, cols = 80, rows = 24 } = payload

    const existing = sessions.get(sessionId)
    if (existing && !existing.exited) {
      attachSenderToSession(sessionId, existing, _event.sender)
      replayRingBuffer(_event.sender, sessionId, existing.ringBuffer)
      return { ok: true, reattached: true }
    }
    if (existing?.exited) {
      sessions.delete(sessionId)
    }

    if (sessions.size >= MAX_SESSIONS) {
      return { ok: false, message: `Maximum ${MAX_SESSIONS} terminal sessions reached.` }
    }

    const shell = resolveDefaultShell()
    const sender = _event.sender

    try {
      const pty = ptyModule.spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: cwd || process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
      })

      const session: TerminalSession = {
        pty,
        sender,
        ringBuffer: '',
        exited: false
      }

      // Attach sender before registering onData to prevent race condition
      sessions.set(sessionId, session)
      attachSenderToSession(sessionId, session, sender)

      pty.onData((data: string) => {
        session.ringBuffer = appendRingBuffer(session.ringBuffer, data)
        if (!session.sender.isDestroyed()) {
          session.sender.send('terminal:data', { sessionId, data })
        }
      })

      pty.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
        session.exited = true
        if (session.cleanupOnDestroy && !session.sender.isDestroyed()) {
          session.sender.removeListener('destroyed', session.cleanupOnDestroy)
        }
        if (!session.sender.isDestroyed()) {
          session.sender.send('terminal:exit', { sessionId, exitCode })
        }
        sessions.delete(sessionId)
      })

      return { ok: true }
    } catch (error: any) {
      return { ok: false, message: error?.message || String(error) }
    }
  })

  typedHandle('terminal:write', (_event, payload) => {
    const session = sessions.get(payload.sessionId)
    if (session && !session.exited) {
      try { session.pty.write(payload.data) } catch { /* ignore */ }
    }
  })

  typedHandle('terminal:resize', (_event, payload) => {
    const session = sessions.get(payload.sessionId)
    if (session && !session.exited) {
      try { session.pty.resize(payload.cols, payload.rows) } catch { /* ignore */ }
    }
  })

  typedHandle('terminal:dispose', (_event, sessionId) => {
    const session = sessions.get(sessionId)
    if (session) {
      try { session.pty.kill() } catch { /* ignore */ }
      sessions.delete(sessionId)
    }
  })
}

/** 清理所有终端会话（用于应用退出时） */
export function disposeAllTerminalSessions(): void {
  for (const [id, session] of sessions) {
    if (!session.exited) {
      try { session.pty.kill() } catch { /* ignore */ }
    }
    sessions.delete(id)
  }
}
