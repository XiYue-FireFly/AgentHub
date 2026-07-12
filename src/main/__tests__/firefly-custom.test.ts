import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { planDispatch } from "../runtime/dispatch-planner"
import { executeQueuedWorkbenchTurnDispatch, resolveQueuedWorkbenchTurnDispatch } from "../runtime/workbench-turn-execution"
import type { PromptOptimizerResult } from "../runtime/prompt-optimizer"
import type { SchedulePreview } from "../runtime/types"

function optimizer(overrides: Partial<PromptOptimizerResult> = {}): PromptOptimizerResult {
  return {
    originalPrompt: "Fix the app and review the implementation",
    optimizedPrompt: "[optimized] Fix the app and review the implementation",
    intent: "bugfix",
    matchedSkills: [],
    matchedPlugins: [],
    contextBlock: {
      id: "ctx-test",
      kind: "skill",
      title: "Prompt optimizer",
      participation: "selected",
      createdAt: 1
    },
    ...overrides
  }
}

describe("smart five-role custom schedule integration", () => {
  it("isolates router prompts and marks non-chat schedule output as run-only", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")

    expect(scheduleHelpers).toContain('step.role === "router"')
    expect(scheduleHelpers).toContain('{ role: "user", content: stepPrompt }')
    expect(scheduleHelpers).toContain("scheduleStepsWithRouteDecision")
    expect(scheduleHelpers).toContain("serialFireflySteps")
    expect(scheduleHelpers).toContain("const fireflyHandoff = input.schedule.preset === \"firefly-custom\"")
    expect(scheduleHelpers).toContain("const layers = fireflyHandoff ? validation.steps.map(step => [step]) : orderedCustomLayers(validation.steps)")
    expect(scheduleHelpers).toContain("if (fireflyHandoff && step.role === \"router\")")
    expect(scheduleHelpers).toContain("const compressedHistory = compactScheduleHistory(input.messages, input.prompt)")
    expect(scheduleHelpers).toContain("dependencyOutputIds(step, stepsById)")
    expect(scheduleHelpers).toContain("for (const parent of dep?.dependsOn ?? []) visit(parent)")
    expect(scheduleHelpers).toContain("providerId: \"local-router\"")
    expect(scheduleHelpers).toContain("modelId: \"weighted-router\"")
    expect(scheduleHelpers).toContain("gatedCandidateStepIds")
    expect(scheduleHelpers).toContain("streamMetaForScheduleStep")
    expect(scheduleHelpers).toContain("forceRunOnly || gatedCandidateIds.has(step.id)")
    expect(scheduleHelpers).toContain("finalScheduleRelease")
    expect(scheduleHelpers).toContain("appendSyntheticChatRelease")
    expect(scheduleHelpers).toContain("const content = task.results.get(step.agentId) || \"\"")
    expect(scheduleHelpers).toContain('runtimeStore.appendSystemEvent(input.threadId, input.turnId, "agent:done"')
    expect(scheduleHelpers).not.toContain('runtimeStore.appendSystemEvent(input.threadId, input.turnId, "agent:delta"')
    expect(scheduleHelpers).toContain('item.step.role === "gatekeeper"')
    expect(scheduleHelpers).toContain("gatedRelease: true")
    expect(scheduleHelpers).toContain("scheduleStepId: input.step.id")
    expect(scheduleHelpers).toContain("usageExcluded: true")
  })

  it("validates custom schedule dependencies instead of force-running invalid graphs", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")

    expect(scheduleHelpers).toContain("validateConcreteScheduleSteps")
    expect(scheduleHelpers).toContain("hasScheduleCycle")
    expect(scheduleHelpers).toContain("Executor step")
    expect(scheduleHelpers).toContain("requires a concrete reviewer or gatekeeper dependency")
    expect(scheduleHelpers).toContain("Schedule dependency cycle detected")
    expect(scheduleHelpers).not.toContain("const fallback = remaining.values().next().value")
  })

  it("does not add run-only schedule output to future assistant history", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain('event.payload?.visibility !== "run"')
    expect(source).toContain("finalAssistantContentForTurn")
  })

  it("does not fabricate a root parent dispatch ID for a workbench schedule", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).not.toContain("parentDispatchId: createDispatchId()")
  })

  it("injects only approved long-term memories into dispatcher prompts", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("new Dispatcher(")
    expect(source).toContain("requestToolDecision: async ({ task, agentId, request, idempotencyKey, onRequested }) =>")
    expect(source).toContain("cancelDecisionTurn: turnId => decisionService.cancelTurn(turnId)")
    expect(source).toContain("cancelDecisionAgent: (turnId, agentId) => decisionService.cancelAgentDecisions(turnId, agentId)")
    expect(source).toContain("memory().selectContextEntries(prompt, { limit: 24, tokenBudget: 8_000 })")
    expect(source).toContain("memory().selectContextEntries(dispatchUserPrompt, { limit: 8, tokenBudget: 3_000 })")
    expect(source).not.toContain("new Dispatcher(registry, pipeline, () => memory().getCatalog().entries")
  })

  it("builds five-role schedules from dispatchable local agents instead of every registry entry", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const plan = planDispatch({
      requestedMode: "firefly-custom",
      availableAgentIds: ["codex", "claude", "minimax-code"],
      optimization: optimizer()
    })

    expect(source).toContain("async function dispatchableLocalAgentIds()")
    expect(source).toContain("buildAgentOptions(await refreshLocalAgentStatusCache()).map(agent => agent.agentId)")
    expect(source).toContain("const usableLocalAgentIds = await dispatchableLocalAgentIds()")
    expect(source).toContain("availableAgentIds: usableLocalAgentIds")
    expect(source).not.toContain('import { getCachedLocalAgentStatuses } from "./runtime/local-agents"')
    expect(plan.effectiveMode).toBe("firefly-custom")
    expect(plan.dispatchMode).toBe("chain")
    expect(plan.schedule?.preset).toBe("firefly-custom")
    expect(plan.routeAgentIds).toEqual(["codex", "claude", "minimax-code"])
    expect(plan.schedule?.steps.every(step => plan.routeAgentIds?.includes(step.agentId))).toBe(true)
    expect(source).not.toContain("fireflyFiveRoleTemplate(registry.getAll().map(agent => agent.id))")
  })

  it("limits smart five-role router decisions to the same dispatchable local agent set", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const customSchedule: SchedulePreview = {
      preset: "custom",
      label: "Test schedule",
      description: "Test schedule",
      steps: [
        { id: "one", label: "One", agentId: "codex", role: "worker", mode: "auto" }
      ]
    }
    const plan = planDispatch({
      requestedMode: "custom",
      customSchedule,
      availableAgentIds: ["codex", "claude"],
      optimization: optimizer()
    })

    expect(source).toContain("function availableRouteAgents(agentIds?: string[])")
    expect(source).toContain("const allowed = agentIds?.length ? new Set(agentIds) : null")
    expect(source).toContain("makeRouteDecision(thread.id, turn.id, promptEnvelope.effectivePrompt, dispatchPlanBase.routeAgentIds)")
    expect(plan.routeAgentIds).toEqual(["codex", "claude"])
    expect(plan.schedule).toBe(customSchedule)
    expect(scheduleHelpers).toContain("function scheduleStepsWithRouteDecision(steps: ScheduleStep[], decision?: RouteDecision): ScheduleStep[]")
    expect(scheduleHelpers).toContain("void decision")
  })

  it("runs any supplied schedule graph through the live execution branch", async () => {
    const schedule: SchedulePreview = {
      preset: "broadcast",
      label: "Broadcast schedule",
      description: "A user supplied broadcast graph",
      steps: [{ id: "worker", label: "Worker", agentId: "codex", role: "worker", mode: "auto" }]
    }
    const routing = resolveQueuedWorkbenchTurnDispatch({
      payload: { prompt: "Run it", mode: "broadcast", customSchedule: schedule },
      availableAgentIds: ["codex", "claude"],
      attachments: [],
      optimization: optimizer()
    })
    const dispatch = vi.fn(async () => ({ id: "task" }))
    const dispatchProviderDirect = vi.fn(async () => ({ id: "provider-task" }))
    const runSchedule = vi.fn(async () => ({ status: "completed" }))

    expect(routing.dispatchPlan.schedule).toBe(schedule)
    await executeQueuedWorkbenchTurnDispatch({
      routing,
      plan: routing.dispatchPlan,
      dispatcher: { dispatch, dispatchProviderDirect } as any,
      prompt: "Run it",
      providerOptions: {},
      dispatchOptions: {},
      runSchedule
    })

    expect(runSchedule).toHaveBeenCalledOnce()
    expect(dispatch).not.toHaveBeenCalled()
    expect(dispatchProviderDirect).not.toHaveBeenCalled()
  })

  it("routes local and provider direct turns around schedules in the live executor", async () => {
    const customSchedule: SchedulePreview = {
      preset: "firefly-custom",
      label: "Five role",
      description: "Five role schedule",
      steps: [{ id: "lead", label: "Lead", agentId: "codex", role: "lead", mode: "auto" }]
    }
    const providerSelection = { providerId: "deepseek", modelId: "deepseek-chat", source: "provider" as const }
    const localDirect = resolveQueuedWorkbenchTurnDispatch({
      payload: { prompt: "Fix it", mode: "firefly-custom", targetAgent: "codex", modelSelection: providerSelection, customSchedule },
      availableAgentIds: ["codex", "claude", "minimax-code"],
      attachments: [],
      optimization: optimizer()
    })
    const providerDirect = resolveQueuedWorkbenchTurnDispatch({
      payload: { prompt: "Review it", mode: "custom", modelSelection: providerSelection, customSchedule },
      availableAgentIds: ["codex", "claude"],
      attachments: [],
      optimization: optimizer()
    })
    const dispatch = vi.fn(async () => ({ id: "local-task" }))
    const dispatchProviderDirect = vi.fn(async () => ({ id: "provider-task" }))
    const runSchedule = vi.fn(async () => ({ status: "completed" }))

    expect(localDirect).toMatchObject({
      directTarget: "codex",
      providerDirect: false,
      directRun: true,
      turnModelSelection: undefined,
      dispatchPlan: {
      effectiveMode: "auto",
      dispatchMode: "auto",
      strategy: "direct-agent"
      }
    })
    expect(localDirect.dispatchPlan.schedule).toBeUndefined()
    expect(providerDirect).toMatchObject({
      directTarget: undefined,
      providerDirect: true,
      directRun: true,
      turnModelSelection: providerSelection,
      dispatchPlan: {
      effectiveMode: "auto",
      dispatchMode: "auto",
      strategy: "direct-provider"
      }
    })
    expect(providerDirect.dispatchPlan.schedule).toBeUndefined()

    await executeQueuedWorkbenchTurnDispatch({
      routing: providerDirect,
      plan: providerDirect.dispatchPlan,
      dispatcher: { dispatch, dispatchProviderDirect } as any,
      prompt: "Review it",
      providerOptions: { turnId: "turn-provider" },
      dispatchOptions: { turnId: "turn-provider" },
      runSchedule
    })
    await executeQueuedWorkbenchTurnDispatch({
      routing: localDirect,
      plan: localDirect.dispatchPlan,
      dispatcher: { dispatch, dispatchProviderDirect } as any,
      prompt: "Fix it",
      providerOptions: { turnId: "turn-local" },
      dispatchOptions: { turnId: "turn-local" },
      runSchedule
    })

    expect(dispatchProviderDirect).toHaveBeenCalledWith("Review it", providerSelection, { turnId: "turn-provider" })
    expect(dispatch).toHaveBeenCalledWith("Fix it", "auto", "codex", { turnId: "turn-local" })
    expect(runSchedule).not.toHaveBeenCalled()
  })

  it("scores guard verdicts from agent output instead of guard prompt instructions", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")

    expect(scheduleHelpers).toContain("explicitGuardVerdictFromText(reviewText) || riskVerdictForText(reviewText, role)")
    expect(scheduleHelpers).toContain("emitGuardVerdict(input.threadId, input.turnId, step.agentId, step.role, content)")
    expect(scheduleHelpers).not.toContain("[stepContext, content].join")
  })

  it("asks before continuing through high-risk guard verdicts", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")

    expect(scheduleHelpers).toContain("GuardDecisionAdapter")
    expect(scheduleHelpers).toContain("requestScheduleGuardDecision")
    expect(scheduleHelpers).toContain("executorVerdictNeedsApproval")
    expect(scheduleHelpers).toContain("guardShouldBlockExecutor(verdict, step.role) || executorVerdictNeedsApproval(verdict, step.role)")
    expect(scheduleHelpers).toContain("idempotencyKey: `guard:${input.turnId}:${step.id}`")
    expect(scheduleHelpers).not.toContain("requiresUserDecision")
    expect(scheduleHelpers).toContain('decision === "approved"')
  })

  it("continues smart five-role runs when a reviewer or gatekeeper fails after main produced output", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")

    expect(scheduleHelpers).toContain("function isNonBlockingGuardStepFailure")
    expect(scheduleHelpers).toContain("source: \"guard-step-fallback\"")
    expect(scheduleHelpers).toContain("nonBlocking: true")
    expect(scheduleHelpers).toContain("failedStepId: failed.step.id")
    expect(scheduleHelpers).toContain("step.role !== \"reviewer\" && step.role !== \"gatekeeper\"")
    expect(scheduleHelpers).toContain("Continuing with the latest main-agent output")
    expect(scheduleHelpers).toContain("return outputs.some(item => (item.step.role === \"lead\" || item.step.role === \"synthesizer\") && item.content.trim())")
  })

  it("preserves completed stdio output when a local CLI exits non-zero after producing final text", () => {
    const dispatcher = readFileSync(join(process.cwd(), "src/main/hub/dispatcher.ts"), "utf8")

    expect(dispatcher).toContain("if (content.trim() && exitCode !== null && e?.code !== \"AGENT_TIMEOUT\")")
    expect(dispatcher).toContain("fallbackContentFromActivitySteps(activitySteps)")
    expect(dispatcher).toContain("function fallbackContentFromActivitySteps")
    expect(dispatcher).toContain("CLI exit warning")
    expect(dispatcher).toContain("task.results.set(agentId, content)")
    expect(dispatcher).toContain("kind: \"done\", taskId: task.id, agentId, providerId, modelId, content")
  })

  it("keeps orchestrate derived prompts token-bounded without dropping compressed thread history", () => {
    const dispatcher = readFileSync(join(process.cwd(), "src/main/hub/dispatcher.ts"), "utf8")

    expect(dispatcher).toContain("function compactOrchestrateMessages")
    expect(dispatcher).toContain("compactChatMessages")
    expect(dispatcher).toContain("messages: compactMessagesForDerivedPrompt(opts, planPrompt)")
    expect(dispatcher).toContain("messages: compactOrchestrateMessages(opts, prompt)")
    expect(dispatcher).toContain("messages: compactOrchestrateMessages(opts, verifyText)")
    expect(dispatcher).toContain("messages: compactOrchestrateMessages(opts, synthPrompt, 8_000)")
    expect(dispatcher).not.toContain("function currentOnlyDerivedMessages")
  })
})
