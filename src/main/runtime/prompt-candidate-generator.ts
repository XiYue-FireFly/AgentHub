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

function normalizeCandidateItem(candidate: unknown): unknown {
  if (typeof candidate === "string") return { text: candidate }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate
  const record = candidate as Record<string, unknown>
  if (typeof record.text === "string") return candidate

  const aliases = [record.content, record.prompt].filter((value): value is string => typeof value === "string")
  if (aliases.length !== 1) return candidate
  return { ...record, text: aliases[0] }
}

function normalizeCandidateResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.candidates)) return value
  return {
    ...record,
    candidates: record.candidates.map(normalizeCandidateItem)
  }
}

function candidateJsonPayload(raw: string): string {
  const trimmed = raw.replace(/^\uFEFF/u, "").trim()
  const fenced = /^```(?:json|application\/json)?\s*\r?\n([\s\S]*?)\r?\n?```$/iu.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
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
        'Use exactly this JSON object: {"schemaVersion":"prompt-candidates-v1","candidates":[{"text":"..."},{"text":"..."}]}.',
        "Each candidates item must be an object with one non-empty text string; do not return an array of strings.",
        "Return two or three materially distinct Prompt candidates.",
        "Write every candidate in the same language as the original request.",
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
      parsed = JSON.parse(candidateJsonPayload(raw))
    } catch {
      throw new Error("Prompt candidate model returned invalid JSON")
    }

    const validation = validatePromptCandidateSet(normalizeCandidateResponse(parsed), input.originalPrompt, input.maxPromptChars)
    if (!validation.ok) throw new Error(validation.error)
    return validation.candidates
  }
}
