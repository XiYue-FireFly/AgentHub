import { describe, expect, it, vi } from "vitest"
import { PromptCandidateGenerator, type PromptCandidateInvocation } from "../prompt-candidate-generator"

describe("PromptCandidateGenerator", () => {
  it("uses exactly one no-tools JSON call and validates before returning", async () => {
    const invoke = vi.fn<(input: PromptCandidateInvocation) => Promise<string>>(async () => JSON.stringify({
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
    const invocation = invoke.mock.calls[0]?.[0]
    expect(invocation?.systemPrompt).toContain('{"schemaVersion":"prompt-candidates-v1","candidates":[{"text":"..."},{"text":"..."}]}')
    expect(invocation?.systemPrompt).toContain('same language as the original request')
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

  it("normalizes a model string-array candidate response before validating it", async () => {
    const invoke = vi.fn(async () => JSON.stringify({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        "分析项目的目标、范围、约束和输出格式，并给出结构化结论。",
        "从背景、关键指标、风险和下一步行动四个维度分析项目。"
      ]
    }))
    const generator = new PromptCandidateGenerator({ invoke })

    await expect(generator.generate({
      originalPrompt: "分析项目",
      maxPromptChars: 4_000,
      providerId: "provider-1",
      modelId: "model-1"
    })).resolves.toEqual([
      "分析项目的目标、范围、约束和输出格式,并给出结构化结论。",
      "从背景、关键指标、风险和下一步行动四个维度分析项目。"
    ])
  })

  it("accepts a JSON code fence and common candidate text aliases without weakening validation", async () => {
    const invoke = vi.fn(async () => [
      "```json",
      JSON.stringify({
        schemaVersion: "prompt-candidates-v1",
        candidates: [
          { content: "分析项目的目标、范围、约束和输出格式。" },
          { prompt: "从背景、风险和下一步行动三个维度分析项目。" }
        ]
      }),
      "```"
    ].join("\n"))
    const generator = new PromptCandidateGenerator({ invoke })

    await expect(generator.generate({
      originalPrompt: "分析项目",
      maxPromptChars: 4_000,
      providerId: "provider-1",
      modelId: "model-1"
    })).resolves.toEqual([
      "分析项目的目标、范围、约束和输出格式。",
      "从背景、风险和下一步行动三个维度分析项目。"
    ])
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
