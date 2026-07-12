import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf-8")

describe("Hub prompt-decision ingress wiring", () => {
  it("prepares Hub chat with the authenticated session owner and routes only trusted resolve frames", () => {
    expect(source).toContain('import { HubPromptDecisionChannel } from "./hub/prompt-decision-channel"')
    expect(source).toContain('hubPromptCacheContext')
    expect(source).toContain('message.type === "prompt:decision_resolve"')
    expect(source).toContain('channel.resolve(message, { type: "hub", sessionId: clientId })')
    expect(source).toContain('decisionOwner: { type: "hub", sessionId: clientId }')
    expect(source).toContain('promptPreparationService.prepareRoot({')
    expect(source).toContain('origin: "hub:websocket"')
    expect(source).toContain('lineage: promptLineageFromEnvelope(prepared.envelope)')
  })
})
