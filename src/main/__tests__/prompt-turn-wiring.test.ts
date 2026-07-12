import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const runnerSource = readFileSync(join(process.cwd(), "src/main/runtime/workbench-turn-runner.ts"), "utf8")
const turnsIpcSource = readFileSync(join(process.cwd(), "src/main/ipc/turns-ipc.ts"), "utf8")
const indexSource = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

describe("Workbench Prompt wiring", () => {
  it("prepares the coordinator-created Turn with its trusted owner", () => {
    expect(runnerSource).toContain("runtimeStore.getTurn(submission.turnId)")
    expect(runnerSource).toContain('type: "turn"')
    expect(runnerSource).toContain("turnId: turn.id")
    expect(runnerSource).toContain("webContentsId: submission.ownerWebContentsId")
    expect(runnerSource).toContain("decisionOwner")
    expect(runnerSource).toContain('origin: submission.source === "retry" ? "workbench:retry" : "workbench:create"')
    expect(runnerSource).not.toContain("createTurn(")
  })

  it("attaches one immutable envelope and uses effective Prompt semantics", () => {
    expect(runnerSource).toContain("commitRuntimeMutation")
    expect(runnerSource).toContain("attachPromptEnvelope(turn.id, prepared.envelope)")
    expect(indexSource).toContain("previous.effectivePrompt || previous.prompt")
    expect(indexSource).toContain("turn.effectivePrompt || turn.prompt")
  })

  it("uses typed retry strategy without compounding an older effective Prompt", () => {
    expect(turnsIpcSource).toContain('"reuse-selection"')
    expect(turnsIpcSource).toContain('"reoptimize"')
    expect(runnerSource).toContain("retryStrategy: submission.retryStrategy")
    expect(runnerSource).toContain("reuseEnvelope: retryOfTurn?.promptEnvelope")
    expect(runnerSource).not.toContain("prompt: retryOfTurn.effectivePrompt")
  })

  it("does not restore create or retry handlers in main index", () => {
    expect(indexSource).not.toContain('typedHandle("turns:create"')
    expect(indexSource).not.toContain('typedHandle("turns:retry"')
  })

  it("injects the shared prompt preparation composition into the runner", () => {
    expect(indexSource).toContain("createPromptPreparationComposition")
    expect(indexSource).toContain("promptPreparationService")
    expect(indexSource).toContain("promptPreparation:")
  })

  it("injects prompt preparation into the QuickComplete IPC registration", () => {
    const registration = indexSource.slice(indexSource.indexOf("registerAllIpcHandlers({"))

    expect(registration).toContain("promptPreparationService: promptPreparationComposition.promptPreparationService")
  })

  it("resolves the actual candidate model identity before Workbench and Hub preparation", () => {
    const workbenchWiring = indexSource.slice(
      indexSource.indexOf("const workbenchTurnRunner"),
      indexSource.indexOf("preDispatch: approvePluginPreDispatch")
    )
    const hubWiring = indexSource.slice(
      indexSource.indexOf('const modelSelection = payload.modelSelection as ModelSelection | undefined'),
      indexSource.indexOf('if (prepared.kind === "decision-required")')
    )

    expect(indexSource).toContain("resolveProductionPromptCandidateIdentity")
    expect(workbenchWiring).toContain("const candidateIdentity = resolveProductionPromptCandidateIdentity(modelSelection)")
    expect(workbenchWiring).toContain("providerId: candidateIdentity.providerId")
    expect(workbenchWiring).toContain("modelId: candidateIdentity.modelId")
    expect(hubWiring).toContain("const candidateIdentity = resolveProductionPromptCandidateIdentity(modelSelection)")
    expect(hubWiring).toContain("providerId: candidateIdentity.providerId")
    expect(hubWiring).toContain("modelId: candidateIdentity.modelId")
  })
})
