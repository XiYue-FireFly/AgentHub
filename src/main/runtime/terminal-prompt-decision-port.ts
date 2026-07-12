import { createInterface } from "node:readline/promises"
import { stdin as processStdin, stdout as processStdout } from "node:process"
import type { PromptSelection } from "./prompt-preparation-service"

export interface PromptTerminalIo {
  write(text: string): void
  question(text: string): Promise<string>
  close(): void
}

export interface TerminalPromptDecisionInput {
  readonly originalPrompt: string
  readonly candidates: readonly string[]
  readonly retryAllowed: boolean
  readonly maxCustomChars?: number
}

const MAX_TERMINAL_CANDIDATES = 3
const MAX_CUSTOM_CHARS = 512 * 1024

export function createProcessPromptTerminalIo(): PromptTerminalIo {
  const readline = createInterface({ input: processStdin, output: processStdout })
  return {
    write: text => processStdout.write(text),
    question: text => readline.question(text),
    close: () => readline.close()
  }
}

/**
 * Presents a deliberately small, text-only Prompt selector. Callers must use
 * this only when stdin is a TTY; non-interactive callers return
 * `decision-required` before reaching this adapter.
 */
export async function pickPromptInTty(
  input: TerminalPromptDecisionInput,
  io: PromptTerminalIo = createProcessPromptTerminalIo()
): Promise<PromptSelection> {
  const candidates = input.candidates.slice(0, MAX_TERMINAL_CANDIDATES)
  const maxCustomChars = Math.min(MAX_CUSTOM_CHARS, Math.max(1, input.maxCustomChars ?? MAX_CUSTOM_CHARS))
  try {
    io.write("\nPrompt needs a choice.\n")
    candidates.forEach((candidate, index) => io.write(`${index + 1}. ${candidate}\n`))
    io.write(`${candidates.length + 1}. Enter a custom prompt\n`)
    io.write("0. Keep the original prompt\n")
    if (input.retryAllowed) io.write("r. Retry prompt optimization\n")
    io.write("q. Cancel\n")

    for (;;) {
      const choice = (await io.question("Choose an option: ")).trim().toLowerCase()
      if (choice === "0") return { kind: "original" }
      if (choice === "q" || choice === "quit" || choice === "cancel") return { kind: "cancelled" }
      if (choice === "r" && input.retryAllowed) return { kind: "retry-candidates" }
      const numeric = Number(choice)
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= candidates.length) {
        return { kind: "candidate", index: numeric - 1 }
      }
      if (numeric === candidates.length + 1) {
        const custom = (await io.question("Custom prompt: ")).trim()
        if (custom && custom.length <= maxCustomChars) return { kind: "custom", text: custom }
        io.write(`Custom prompt must contain 1-${maxCustomChars} characters.\n`)
        continue
      }
      io.write("Choose a listed option.\n")
    }
  } finally {
    io.close()
  }
}
