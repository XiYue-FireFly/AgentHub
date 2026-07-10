import { spawn, ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { app } from "electron"
import { getWorkspaceManager } from "../hub/workspace"
import type { TerminalRun } from "./types"
import { appendDecodedProcessChunk } from "./process-decoder"
import { store } from "../store"

const MAX_OUTPUT = 96 * 1024
const MAX_RUNS = 200
const APPEARANCE_KEY = "appearance.preferences"
type TerminalShell = "system" | "powershell" | "cmd" | "git-bash" | "wsl"

function id(): string {
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export class TerminalRuntime {
  private runs: TerminalRun[] = []
  private children = new Map<string, ChildProcessWithoutNullStreams>()

  history(): TerminalRun[] {
    return [...this.runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 80)
  }

  run(input: { workspaceId?: string | null; command: string }): TerminalRun {
    const command = input.command.trim()
    if (!command) throw new Error("Command is required")
    const workspace = input.workspaceId ? getWorkspaceManager().getById(input.workspaceId) : null
    const cwd = workspace?.rootPath || app.getPath("userData")
    if (!existsSync(cwd)) throw new Error(`Workspace path does not exist: ${cwd}`)
    const run: TerminalRun = {
      id: id(),
      workspaceId: input.workspaceId ?? workspace?.id ?? null,
      command,
      cwd,
      status: "running",
      stdout: "",
      stderr: "",
      exitCode: null,
      createdAt: Date.now()
    }
    this.runs.unshift(run)
    if (this.runs.length > MAX_RUNS) this.runs.length = MAX_RUNS

    const shell = resolveTerminalShell()
    const child = spawn(shell.command, shell.args(command), {
      cwd,
      windowsHide: true,
      env: process.env
    })
    this.children.set(run.id, child)
    child.stdout.on("data", chunk => { run.stdout = appendDecodedProcessChunk(run.stdout, chunk, MAX_OUTPUT) })
    child.stderr.on("data", chunk => { run.stderr = appendDecodedProcessChunk(run.stderr, chunk, MAX_OUTPUT) })
    child.on("error", error => {
      run.status = "failed"
      run.stderr = clamp(run.stderr + (error?.message || String(error)))
      run.completedAt = Date.now()
      this.children.delete(run.id)
    })
    child.on("close", code => {
      // MED-17: Skip status update if already 'failed' (error event fired first) or 'cancelled'
      if (run.status !== "cancelled" && run.status !== "failed") run.status = code === 0 ? "completed" : "failed"
      run.exitCode = code
      run.completedAt = Date.now()
      this.children.delete(run.id)
    })
    return run
  }

  cancel(runId: string): boolean {
    const child = this.children.get(runId)
    const run = this.runs.find(item => item.id === runId)
    if (!child || !run) return false
    run.status = "cancelled"
    run.completedAt = Date.now()
    killProcessTree(child)
    this.children.delete(runId)
    return true
  }

  /** Kill all still-running terminal children. Called on app quit to avoid
   *  orphaning spawned shell processes (they would survive AgentHub closing). */
  dispose(): void {
    for (const [runId, child] of this.children) {
      const run = this.runs.find(item => item.id === runId)
      if (run && run.status === "running") {
        run.status = "cancelled"
        run.completedAt = Date.now()
      }
      try { killProcessTree(child) } catch { /* process may have already exited */ }
    }
    this.children.clear()
  }
}

function resolveTerminalShell(): { command: string; args: (command: string) => string[] } {
  const selected = readTerminalShell()
  if (process.platform !== "win32") {
    if (selected === "powershell") {
      // Check if pwsh is available
      try {
        const { execFileSync } = require('child_process')
        execFileSync('pwsh', ['--version'], { timeout: 5000, stdio: 'pipe' })
      } catch {
        throw new Error("PowerShell (pwsh) is not installed. Please install it or switch to system shell.")
      }
      return { command: "pwsh", args: command => ["-NoProfile", "-Command", command] }
    }
    if (selected !== "system") throw new Error(`Terminal shell "${selected}" is only supported on Windows.`)
    return { command: "/bin/sh", args: command => ["-lc", command] }
  }
  if (selected === "cmd") return { command: "cmd.exe", args: command => ["/d", "/s", "/c", command] }
  if (selected === "git-bash") {
    const bash = gitBashPath()
    if (!bash) throw new Error("Git Bash was selected, but bash.exe was not found.")
    return { command: bash, args: command => ["-lc", command] }
  }
  if (selected === "wsl") return { command: "wsl.exe", args: command => ["sh", "-lc", command] }
  return { command: "powershell.exe", args: command => ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command] }
}

function readTerminalShell(): TerminalShell {
  const raw = store.get(APPEARANCE_KEY, null)
  const shell = raw?.terminalShell
  return ["system", "powershell", "cmd", "git-bash", "wsl"].includes(shell) ? shell : "system"
}

function gitBashPath(): string | null {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
  ]
  return candidates.find(path => existsSync(path)) || null
}

function clamp(value: string): string {
  if (value.length <= MAX_OUTPUT) return value
  return value.slice(0, MAX_OUTPUT) + "\n[AgentHub: output truncated]"
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) { try { child.kill() } catch { /* noop */ }; return }
  if (process.platform === 'win32') {
    try {
      // LOW-27: Use execFileSync with array args (no shell injection risk)
      const { execFileSync } = require('child_process')
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 5000 })
    } catch { try { child.kill() } catch { /* noop */ } }
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* noop */ } }
  }
}

let instance: TerminalRuntime | null = null

export function getTerminalRuntime(): TerminalRuntime {
  if (!instance) instance = new TerminalRuntime()
  return instance
}
