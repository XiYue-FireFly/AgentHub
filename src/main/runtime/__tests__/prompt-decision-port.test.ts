import { describe, expect, it, vi } from "vitest"
import {
  WorkbenchPromptDecisionPort,
  type PromptDecisionRequester
} from "../prompt-decision-port"
import type { DecisionResolution } from "../../../shared/decision-contract"
import type { PromptSelection } from "../prompt-preparation-service"

const owner = {
  type: "turn" as const,
  threadId: "thread-1",
  turnId: "turn-1",
  workspaceId: null,
  webContentsId: 7
}

function decisionInput(overrides: Record<string, unknown> = {}) {
  return {
    owner,
    sessionId: "session-1",
    origin: "workbench:create" as const,
    attempt: 1,
    originalPrompt: "Fix this",
    candidates: ["Candidate A", "Candidate B"],
    retryAllowed: true,
    ...overrides
  }
}

describe("WorkbenchPromptDecisionPort", () => {
  it("requires a Turn owner and maps exact original/candidate/custom options", async () => {
    const requestDecision = vi.fn<PromptDecisionRequester["request"]>()
    requestDecision.mockResolvedValue({
      requestId: "request-1",
      status: "selected",
      selectedOptionIds: ["candidate-1"],
      resolvedAt: 1
    })
    const decisions: PromptDecisionRequester = { request: requestDecision }
    const port = new WorkbenchPromptDecisionPort(decisions)

    await expect(port.decide(decisionInput({ owner: undefined }))).rejects
      .toThrow("requires a Turn owner")
    await expect(port.decide(decisionInput())).resolves.toEqual({ kind: "candidate", index: 1 })
    const request = requestDecision.mock.calls[0]?.[0]
    if (!request) throw new Error("Expected Prompt Decision request")
    expect(request.owner).toEqual(owner)
    expect(request.options).toEqual([
      { id: "original", label: "Keep original", description: "Fix this" },
      { id: "candidate-0", label: "Candidate 1", description: "Candidate A" },
      { id: "candidate-1", label: "Candidate 2", description: "Candidate B" }
    ])
    expect(request.idempotencyKey).toBe("prompt-session:session-1:attempt:1")
  })

  const resolutionCases: Array<[
    string,
    Omit<DecisionResolution, "requestId" | "resolvedAt">,
    PromptSelection
  ]> = [
    ["original", { status: "selected", selectedOptionIds: ["original"] }, { kind: "original" }],
    ["custom", { status: "submitted", text: "Use my exact prompt" }, { kind: "custom", text: "Use my exact prompt" }],
    ["terminal", { status: "cancelled" }, { kind: "cancelled" }]
  ]

  it.each(resolutionCases)("maps %s DecisionService resolutions", async (_name, resolution, expected) => {
    const requestDecision = vi.fn<PromptDecisionRequester["request"]>()
    requestDecision.mockResolvedValue({ requestId: "request-1", resolvedAt: 1, ...resolution })
    const decisions: PromptDecisionRequester = { request: requestDecision }
    const port = new WorkbenchPromptDecisionPort(decisions)

    await expect(port.decide(decisionInput())).resolves.toEqual(expected)
  })

  it("maps retry only through the authoritative retry option", async () => {
    const requestDecision = vi.fn<PromptDecisionRequester["request"]>()
    requestDecision.mockResolvedValue({
      requestId: "request-1",
      status: "selected",
      selectedOptionIds: ["retry-optimization"],
      resolvedAt: 1
    })
    const decisions: PromptDecisionRequester = { request: requestDecision }
    const port = new WorkbenchPromptDecisionPort(decisions)

    await expect(port.decide(decisionInput({ candidateError: "model outage", candidates: [] })))
      .resolves.toEqual({ kind: "retry-candidates" })
    const request = requestDecision.mock.calls[0]?.[0]
    if (!request) throw new Error("Expected Prompt Decision request")
    expect(request.options).toEqual([
      { id: "retry-optimization", label: "Retry optimization", description: "model outage" },
      { id: "original", label: "Keep original", description: "Fix this" }
    ])
  })

  it("returns cancelled when DecisionService rejects a terminal Turn request", async () => {
    const requestDecision = vi.fn<PromptDecisionRequester["request"]>()
    requestDecision.mockRejectedValue(new Error("Decision owner Turn is terminal"))
    const port = new WorkbenchPromptDecisionPort({ request: requestDecision })

    await expect(port.decide(decisionInput())).resolves.toEqual({ kind: "cancelled" })
  })
})
