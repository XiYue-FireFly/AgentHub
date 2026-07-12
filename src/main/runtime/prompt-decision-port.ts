import type { DecisionRequest, DecisionResolution, DecisionOwner } from "../../shared/decision-contract"
import { createPromptDecisionRequest } from "./decision-request-factories"
import type { PromptDecisionInput, PromptDecisionPort, PromptSelection } from "./prompt-preparation-service"

export interface PromptDecisionRequester {
  request(request: DecisionRequest): Promise<DecisionResolution>
}

function terminalDecisionRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(?:terminal|stale|cancelled)\b/iu.test(message)
}

export class WorkbenchPromptDecisionPort implements PromptDecisionPort {
  constructor(private readonly decisions: PromptDecisionRequester) {}

  async decide(input: PromptDecisionInput): Promise<PromptSelection> {
    if (!input.owner || input.owner.type !== "turn") {
      throw new Error("Workbench Prompt decision requires a Turn owner")
    }
    const options = input.candidateError
      ? [
          ...(input.retryAllowed ? [{ id: "retry-optimization", label: "Retry optimization", description: input.candidateError }] : []),
          { id: "original", label: "Keep original", description: input.originalPrompt }
        ]
      : [
          { id: "original", label: "Keep original", description: input.originalPrompt },
          ...input.candidates.map((candidate, index) => ({
            id: `candidate-${index}`,
            label: `Candidate ${index + 1}`,
            description: candidate
          }))
        ]
    let resolution: DecisionResolution
    try {
      resolution = await this.decisions.request(createPromptDecisionRequest({
        owner: input.owner as DecisionOwner,
        kind: "single-select",
        title: "Choose the prepared Prompt",
        description: input.candidateError || "The original request is broad or ambiguous.",
        options,
        minSelections: 1,
        maxSelections: 1,
        allowCustom: true,
        customInput: { placeholder: "Write another version", maxChars: 512 * 1024 },
        idempotencyKey: `prompt-session:${input.sessionId}:attempt:${input.attempt}`
      }))
    } catch (error) {
      if (terminalDecisionRejection(error)) return { kind: "cancelled" }
      throw error
    }
    if (["cancelled", "timeout", "stale", "denied"].includes(resolution.status)) {
      return { kind: "cancelled" }
    }
    if (resolution.status === "submitted" && typeof resolution.text === "string") {
      return { kind: "custom", text: resolution.text }
    }
    if (resolution.status !== "selected") throw new Error("Prompt decision returned an invalid resolution")
    const optionId = resolution.selectedOptionIds?.[0]
    if (optionId === "retry-optimization") return { kind: "retry-candidates" }
    if (optionId === "original") return { kind: "original" }
    const match = /^candidate-(\d+)$/.exec(optionId || "")
    if (!match) throw new Error("Prompt decision returned an unknown option")
    return { kind: "candidate", index: Number(match[1]) }
  }
}
