import { describe, expect, it, vi } from "vitest"
import { pickPromptInTty, type PromptTerminalIo } from "../terminal-prompt-decision-port"

function promptIo(answers: string[]): PromptTerminalIo {
  return {
    write: vi.fn(),
    question: vi.fn(async () => answers.shift() || ""),
    close: vi.fn()
  }
}

describe("pickPromptInTty", () => {
  it("selects an indexed candidate and closes its terminal input", async () => {
    const io = promptIo(["2"])

    await expect(pickPromptInTty({
      originalPrompt: "Fix it",
      candidates: ["Repair the focused defect.", "Audit and repair the whole module."],
      retryAllowed: false
    }, io)).resolves.toEqual({ kind: "candidate", index: 1 })
    expect(io.close).toHaveBeenCalledOnce()
  })

  it("accepts a non-empty custom terminal prompt", async () => {
    const io = promptIo(["3", "Repair the login form and run its focused tests."])

    await expect(pickPromptInTty({
      originalPrompt: "Fix it",
      candidates: ["Repair the focused defect.", "Audit and repair the whole module."],
      retryAllowed: false
    }, io)).resolves.toEqual({
      kind: "custom",
      text: "Repair the login form and run its focused tests."
    })
  })
})
