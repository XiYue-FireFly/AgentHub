import { randomUUID } from "node:crypto"
import { optimizePromptForDispatch } from "./prompt-optimizer"
import { PromptCandidateGenerator, type PromptCandidateInvocation } from "./prompt-candidate-generator"
import { WorkbenchPromptDecisionPort, type PromptDecisionRequester } from "./prompt-decision-port"
import {
  PromptPreparationService,
  type PromptDecisionInput,
  type PromptDecisionPort,
  type PromptDecisionPortRouter,
  type PromptSelection
} from "./prompt-preparation-service"

export type HubPromptDecisionPort = PromptDecisionPort

class UnsupportedPromptDecisionPort implements PromptDecisionPort {
  async decide(_input: PromptDecisionInput): Promise<PromptSelection> {
    return { kind: "decision-required" }
  }
}

export function createPromptPreparationComposition(input: {
  decisionService: PromptDecisionRequester
  hubDecisionPort: HubPromptDecisionPort
  invokeCandidateModel: (request: PromptCandidateInvocation) => Promise<string>
  audit: (event: { kind: string; payload: Record<string, unknown> }) => void
}) {
  const workbenchPort = new WorkbenchPromptDecisionPort(input.decisionService)
  const unsupportedPort = new UnsupportedPromptDecisionPort()
  const decisionPorts: PromptDecisionPortRouter = {
    for(_origin, capability) {
      if (capability === "desktop-inline") return workbenchPort
      if (capability === "websocket") return input.hubDecisionPort
      if (capability === "none" || capability === "client-owned") return unsupportedPort
      throw new Error("Terminal Prompt decisions must use the Electron-free headless composition")
    }
  }
  const candidateGenerator = new PromptCandidateGenerator({ invoke: input.invokeCandidateModel })
  const promptPreparationService = new PromptPreparationService({
    id: prefix => `${prefix}-${randomUUID()}`,
    now: () => Date.now(),
    audit: input.audit,
    optimize: (prompt, _context) => {
      const result = optimizePromptForDispatch({ prompt })
      return { optimizedPrompt: result.optimizedPrompt, artifact: result }
    },
    generateCandidates: (prompt, context) => candidateGenerator.generate({
      originalPrompt: prompt,
      maxPromptChars: 512 * 1024,
      providerId: context.providerId,
      modelId: context.modelId
    }),
    decisionPorts
  })
  return Object.freeze({ promptPreparationService, candidateGenerator, decisionPorts })
}
