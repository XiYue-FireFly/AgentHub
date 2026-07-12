import { describe, expect, it, vi } from "vitest"
import { WorkbenchPromptDecisionPort } from "../prompt-decision-port"
import {
  createPromptPreparationComposition,
  type HubPromptDecisionPort
} from "../prompt-preparation-composition"
import { hubPromptCacheContext, promptCacheContext } from "../prompt-cache-context"
import type { PromptDecisionRequester } from "../prompt-decision-port"
import type { PromptDecisionPort } from "../prompt-preparation-service"

describe("Prompt preparation composition", () => {
  it("routes supported capabilities and leaves unsupported paths decision-required", async () => {
    const decide = vi.fn<PromptDecisionPort["decide"]>()
    decide.mockResolvedValue({ kind: "original" })
    const hubDecisionPort: HubPromptDecisionPort = { decide }
    const request = vi.fn<PromptDecisionRequester["request"]>()
    const composition = createPromptPreparationComposition({
      decisionService: { request },
      hubDecisionPort,
      invokeCandidateModel: vi.fn(async () => JSON.stringify({ schemaVersion: "prompt-candidates-v1", candidates: [] })),
      audit: vi.fn()
    })

    expect(composition.decisionPorts.for("workbench:create", "desktop-inline"))
      .toBeInstanceOf(WorkbenchPromptDecisionPort)
    expect(composition.decisionPorts.for("hub:websocket", "websocket")).toBe(hubDecisionPort)
    await expect(composition.decisionPorts.for("internal:schedule", "none").decide({} as never))
      .resolves.toEqual({ kind: "decision-required" })
    await expect(composition.decisionPorts.for("external-proxy:openai", "client-owned").decide({} as never))
      .resolves.toEqual({ kind: "decision-required" })
  })

  it("hashes every local cache context projection and keeps hub fallback canonical", () => {
    const base = {
      locale: "en-US",
      workspaceRoot: "E:\\Agent",
      contextProjection: { threadId: "thread-1" },
      plugins: ["plugin-a"],
      skills: ["skill-a"],
      attachments: ["attachment-a"],
      providerId: "openai",
      modelId: "gpt"
    }
    const first = promptCacheContext(base)
    const changed = promptCacheContext({ ...base, contextProjection: { threadId: "thread-2" } })

    expect(changed.contextSignature).not.toBe(first.contextSignature)
    expect(hubPromptCacheContext({ providerId: "openai", modelId: "gpt" }))
      .toEqual(hubPromptCacheContext({ providerId: "openai", modelId: "gpt" }))
  })

  it("regenerates candidates with the cache context model identity when that identity changes", async () => {
    const invokeCandidateModel = vi.fn(async () => JSON.stringify({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Fix it by identifying the affected behavior and applying the smallest safe change." },
        { text: "Fix it with a minimal implementation and a concise explanation of the result." }
      ]
    }))
    const composition = createPromptPreparationComposition({
      decisionService: {
        request: vi.fn(async () => ({
          requestId: "decision-1",
          status: "selected" as const,
          selectedOptionIds: ["candidate-1"],
          resolvedAt: 1
        }))
      },
      hubDecisionPort: { decide: vi.fn(async () => ({ kind: "original" as const })) },
      invokeCandidateModel,
      audit: vi.fn()
    })
    const cacheContext = (providerId: string, modelId: string) => promptCacheContext({
      locale: "en-US",
      workspaceRoot: null,
      contextProjection: {},
      plugins: [],
      skills: [],
      attachments: [],
      providerId,
      modelId
    })
    const prepare = (providerId: string, modelId: string) => composition.promptPreparationService.prepareRoot({
      origin: "workbench:create",
      prompt: "Fix it",
      decisionOwner: { type: "turn", threadId: "thread-1", turnId: "turn-1", workspaceId: null, webContentsId: 1 },
      cacheContext: cacheContext(providerId, modelId)
    })

    await prepare("provider-a", "model-a")
    await prepare("provider-b", "model-b")

    expect(invokeCandidateModel).toHaveBeenCalledTimes(2)
    expect(invokeCandidateModel).toHaveBeenNthCalledWith(1, expect.objectContaining({
      providerId: "provider-a",
      modelId: "model-a"
    }))
    expect(invokeCandidateModel).toHaveBeenNthCalledWith(2, expect.objectContaining({
      providerId: "provider-b",
      modelId: "model-b"
    }))
  })
})
