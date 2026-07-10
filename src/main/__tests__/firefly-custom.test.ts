import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { planDispatch } from "../runtime/dispatch-planner"
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

  it("injects only approved long-term memories into dispatcher prompts", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("new Dispatcher(registry, pipeline, (taskText = \"\") => memory().selectContextEntries(taskText, { limit: 12, tokenBudget: 4_000 }))")
    expect(source).toContain("memory().selectContextEntries(prompt, { limit: 24, tokenBudget: 8_000 })")
    expect(source).toContain("memory().selectContextEntries(optimizedDispatchUserPrompt, { limit: 8, tokenBudget: 3_000 })")
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
    expect(source).toContain("makeRouteDecision(thread.id, turn.id, optimizedDispatchUserPrompt, dispatchPlanBase.routeAgentIds)")
    expect(source).toContain("makeRouteDecision(thread.id, created.turn.id, retryOptimizedPrompt, retryPlanBase.routeAgentIds)")
    expect(plan.routeAgentIds).toEqual(["codex", "claude"])
    expect(plan.schedule).toBe(customSchedule)
    expect(scheduleHelpers).toContain("function scheduleStepsWithRouteDecision(steps: ScheduleStep[], decision?: RouteDecision): ScheduleStep[]")
    expect(scheduleHelpers).toContain("void decision")
  })

  it("runs any supplied schedule graph instead of only custom and smart five-role modes", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain(": !directTarget && scheduleForTurn")
    expect(source).toContain(": !retryTargetAgent && retrySchedule")
    expect(source).toContain("if (scheduleForTurn && !(\"id\" in task))")
    expect(source).toContain("if (retrySchedule && !(\"id\" in task))")
    expect(source).not.toContain('(effectiveMode === "custom" || effectiveMode === "firefly-custom") && !directTarget && scheduleForTurn')
    expect(source).not.toContain('(turn.mode === "custom" || turn.mode === "firefly-custom") && !retryTargetAgent && retrySchedule')
  })

  it("forces local and provider direct runs out of schedule mode before persisting or retrying", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const localDirectPlan = planDispatch({
      requestedMode: "firefly-custom",
      directRun: true,
      directTarget: "codex",
      availableAgentIds: ["codex", "claude", "minimax-code"],
      optimization: optimizer()
    })
    const providerDirectPlan = planDispatch({
      requestedMode: "custom",
      directRun: true,
      availableAgentIds: ["codex", "claude"],
      optimization: optimizer()
    })

    expect(source).toContain("const localDirect = !!directTarget")
    expect(source).toContain("const directRun = providerDirect || localDirect")
    expect(source).toContain("const effectiveMode = dispatchPlanBase.effectiveMode")
    expect(source).toContain("const scheduleForTurn = dispatchPlanBase.schedule")
    expect(source).toContain("customSchedule: retryPlanBase.schedule")
    expect(source).toContain("mode: retryPlanBase.effectiveMode")
    expect(source).toContain("const retryDirectRun = retryProviderDirect || !!retryTargetAgent")
    expect(source).toContain("const retrySchedule = retryPlan.schedule")
    expect(localDirectPlan).toMatchObject({
      effectiveMode: "auto",
      dispatchMode: "auto",
      strategy: "direct-agent"
    })
    expect(localDirectPlan.schedule).toBeUndefined()
    expect(localDirectPlan.routeAgentIds).toBeUndefined()
    expect(providerDirectPlan).toMatchObject({
      effectiveMode: "auto",
      dispatchMode: "auto",
      strategy: "direct-provider"
    })
    expect(providerDirectPlan.schedule).toBeUndefined()
  })

  it("scores guard verdicts from agent output instead of guard prompt instructions", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")
    const guardService = readFileSync(join(process.cwd(), "src/main/runtime/guard-approval-service.ts"), "utf8")

    // evaluateGuardVerdict now lives in guard-approval-service.ts
    expect(guardService).toContain("explicitGuardVerdictFromText(reviewText) || riskVerdictForText(reviewText, role)")
    expect(scheduleHelpers).toContain("emitGuardVerdict(guardStore, input.threadId, input.turnId, step.agentId, step.role, content)")
    expect(scheduleHelpers).not.toContain("[stepContext, content].join")
  })

  it("asks before continuing through high-risk guard verdicts", () => {
    const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")
    const guardService = readFileSync(join(process.cwd(), "src/main/runtime/guard-approval-service.ts"), "utf8")

    expect(scheduleHelpers).toContain("requestGuardApproval")
    expect(scheduleHelpers).toContain("executorVerdictNeedsApproval")
    expect(scheduleHelpers).toContain("guardShouldBlockExecutor(verdict, step.role) || executorVerdictNeedsApproval(verdict, step.role)")
    // Guard service now lives in guard-approval-service.ts
    expect(guardService).toContain("needs-confirmation")
    expect(guardService).toContain("requiresUserDecision")
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
