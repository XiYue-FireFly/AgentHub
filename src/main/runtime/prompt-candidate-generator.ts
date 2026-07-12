import { validatePromptCandidateSet } from "../../prompt-core/prompt-candidate-validator"

export interface PromptCandidateInvocation {
  readonly providerId: string
  readonly modelId: string
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly tools: readonly never[]
  readonly toolChoice: "none"
  readonly responseFormat: "json"
}

export class PromptCandidateGenerator {
  constructor(private readonly deps: {
    invoke: (input: PromptCandidateInvocation) => Promise<string>
  }) {}

  async generate(input: {
    originalPrompt: string
    maxPromptChars: number
    providerId: string
    modelId: string
  }): Promise<readonly string[]> {
    const raw = await this.deps.invoke({
      providerId: input.providerId,
      modelId: input.modelId,
      systemPrompt: [
        "Return JSON only.",
        "Use schemaVersion prompt-candidates-v1.",
        "Return two or three materially distinct Prompt candidates.",
        "Preserve paths, quoted literals, numeric IDs, URLs, negations, requested output forms, and safety constraints.",
        "Do not add facts, permissions, destructive actions, tools, or external side effects."
      ].join("\n"),
      userPrompt: input.originalPrompt,
      tools: [],
      toolChoice: "none",
      responseFormat: "json"
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error("Prompt candidate model returned invalid JSON")
    }

    const validation = validatePromptCandidateSet(parsed, input.originalPrompt, input.maxPromptChars)
    if (!validation.ok) throw new Error(validation.error)
    return validation.candidates
  }
}
