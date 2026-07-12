"use strict"
import { EventEmitter } from "node:events"
import type { AgentDecisionResultEvent } from "../../agentic/user-decision-transport"

export interface AgentAdapter {
 id: string
 name: string
 binary: string
 protocol: "stdio-ndjson" | "stdio-plain" | "http" | "acp"
 mode: "interactive" | "oneshot"
 start(): Promise<void>
 stop(): Promise<void>
 send(prompt: string): void
 onOutput: ((chunk: string) => void) | null
 onError: ((err: Error) => void) | null
 decisionContinuation?: 'none' | 'live' | 'checkpoint'
 onProtocolEvent?: ((event: unknown) => void) | null
 resumeDecision?(result: AgentDecisionResultEvent): Promise<void>
 status: "idle" | "busy" | "error"
}

export abstract class BaseAgentAdapter extends EventEmitter implements AgentAdapter {
  abstract id: string
  abstract name: string
  abstract binary: string
  abstract protocol: "stdio-ndjson" | "stdio-plain" | "http" | "acp"
  abstract mode: "interactive" | "oneshot"

  status: "idle" | "busy" | "error" = "idle"
  onOutput: ((chunk: string) => void) | null = null
  onError: ((err: Error) => void) | null = null
  /** Structured exit code from the child process (null if still running or exited normally with code 0) */
  exitCode: number | null = null
  /** Full stderr captured from the child process (for diagnostics) */
  lastStderr: string = ""

  protected process: any = null
  protected buffer = ""
  protected startCount = 0

  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  abstract send(prompt: string, opts?: { cwd?: string | null }): void

  protected handleOutput(chunk: string): void {
 if (this.onOutput) this.onOutput(chunk)
  }

  protected handleError(err: Error): void {
 this.status = "error"
 if (this.onError) this.onError(err)
  }
}
