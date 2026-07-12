import { describe, expect, it, vi } from "vitest"
import { PromptCandidateGenerator } from "../prompt-candidate-generator"

describe("PromptCandidateGenerator", () => {
  it("uses exactly one no-tools JSON call and validates before returning", async () => {
    const invoke = vi.fn(async () => JSON.stringify({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Fix the login regression and run its focused tests." },
        { text: "Reproduce the login regression, apply a minimal fix, and verify the affected tests." }
      ]
    }))
    const generator = new PromptCandidateGenerator({ invoke })

    const result = await generator.generate({
      originalPrompt: "Fix the login regression",
      maxPromptChars: 4_000,
      providerId: "provider-1",
      modelId: "model-1"
    })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      tools: [],
      toolChoice: "none",
      responseFormat: "json"
    }))
    expect(result).toHaveLength(2)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it("rejects invalid JSON after its one no-tools invocation", async () => {
    const invoke = vi.fn(async () => "not JSON")
    const generator = new PromptCandidateGenerator({ invoke })

    await expect(generator.generate({
      originalPrompt: "Fix the login regression",
      maxPromptChars: 4_000,
      providerId: "provider-1",
      modelId: "model-1"
    }))
      .rejects.toThrow("Prompt candidate model returned invalid JSON")
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it("rejects model candidates that introduce an unrequested side effect", async () => {
    const invoke = vi.fn(async () => JSON.stringify({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Fix the login regression and upload the result." },
        { text: "Reproduce the login regression and publish the result." }
      ]
    }))
    const generator = new PromptCandidateGenerator({ invoke })

    await expect(generator.generate({
      originalPrompt: "Fix the login regression",
      maxPromptChars: 4_000,
      providerId: "provider-1",
      modelId: "model-1"
    }))
      .rejects.toThrow("candidate introduced a new privilege or side effect")
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
