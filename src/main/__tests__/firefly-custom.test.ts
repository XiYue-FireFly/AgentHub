import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("smart five-role custom schedule integration", () => {
  it("isolates router prompts and marks non-chat schedule output as run-only", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain('step.role === "router"')
    expect(source).toContain('{ role: "user", content: stepPrompt }')
    expect(source).toContain("scheduleStepsWithRouteDecision")
    expect(source).toContain("serialFireflySteps")
    expect(source).toContain("const fireflyHandoff = input.schedule.preset === \"firefly-custom\"")
    expect(source).toContain("const layers = fireflyHandoff ? validation.steps.map(step => [step]) : orderedCustomLayers(validation.steps)")
    expect(source).toContain("if (fireflyHandoff && step.role === \"router\")")
    expect(source).toContain("providerId: \"local-router\"")
    expect(source).toContain("modelId: \"weighted-router\"")
    expect(source).toContain("gatedCandidateStepIds")
    expect(source).toContain("streamMetaForScheduleStep")
    expect(source).toContain("forceRunOnly || gatedCandidateIds.has(step.id)")
    expect(source).toContain("finalScheduleRelease")
    expect(source).toContain("appendSyntheticChatRelease")
    expect(source).toContain("const content = task.results.get(step.agentId) || \"\"")
    expect(source).toContain('runtimeStore.appendSystemEvent(input.threadId, input.turnId, "agent:delta"')
    expect(source).toContain('channel: "content"')
    expect(source).toContain("text: content")
    expect(source).toContain('item.step.role === "gatekeeper"')
    expect(source).toContain("gatedRelease: true")
    expect(source).toContain("scheduleStepId: input.step.id")
    expect(source).toContain("usageExcluded: true")
  })

  it("validates custom schedule dependencies instead of force-running invalid graphs", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("validateConcreteScheduleSteps")
    expect(source).toContain("hasScheduleCycle")
    expect(source).toContain("Executor step")
    expect(source).toContain("requires a concrete reviewer or gatekeeper dependency")
    expect(source).toContain("Schedule dependency cycle detected")
    expect(source).not.toContain("const fallback = remaining.values().next().value")
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
    expect(source).toContain("memory().selectContextEntries(payload.prompt, { limit: 8, tokenBudget: 3_000 })")
    expect(source).not.toContain("new Dispatcher(registry, pipeline, () => memory().getCatalog().entries")
  })

  it("builds five-role schedules from dispatchable local agents instead of every registry entry", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("function dispatchableLocalAgentIds()")
    expect(source).toContain("const fireflyAgentIds = !providerDirect && mode === \"firefly-custom\" ? dispatchableLocalAgentIds() : []")
    expect(source).toContain("fireflyFiveRoleTemplate(fireflyAgentIds)")
    expect(source).toContain("fireflyFiveRoleTemplate(retryFireflyAgentIds)")
    expect(source).not.toContain("fireflyFiveRoleTemplate(registry.getAll().map(agent => agent.id))")
  })

  it("limits smart five-role router decisions to the same dispatchable local agent set", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("function availableRouteAgents(agentIds?: string[])")
    expect(source).toContain("const allowed = agentIds?.length ? new Set(agentIds) : null")
    expect(source).toContain("makeRouteDecision(thread.id, turn.id, dispatchUserPrompt, fireflyAgentIds)")
    expect(source).toContain("makeRouteDecision(thread.id, created.turn.id, retryUserPrompt, retryFireflyAgentIds)")
    expect(source).toContain("function scheduleStepsWithRouteDecision(steps: ScheduleStep[], decision?: RouteDecision): ScheduleStep[]")
    expect(source).toContain("void decision")
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

  it("scores guard verdicts from agent output instead of guard prompt instructions", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const guardService = readFileSync(join(process.cwd(), "src/main/runtime/guard-approval-service.ts"), "utf8")

    // evaluateGuardVerdict now lives in guard-approval-service.ts
    expect(guardService).toContain("explicitGuardVerdictFromText(reviewText) || riskVerdictForText(reviewText, role)")
    expect(source).toContain("emitGuardVerdict(guardStore, input.threadId, input.turnId, step.agentId, step.role, content)")
    expect(source).not.toContain("[stepContext, content].join")
  })

  it("asks before continuing through high-risk guard verdicts", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const guardService = readFileSync(join(process.cwd(), "src/main/runtime/guard-approval-service.ts"), "utf8")

    expect(source).toContain("requestGuardApproval")
    expect(source).toContain("executorVerdictNeedsApproval")
    expect(source).toContain("guardShouldBlockExecutor(verdict, step.role) || executorVerdictNeedsApproval(verdict, step.role)")
    // Guard service now lives in guard-approval-service.ts
    expect(guardService).toContain("needs-confirmation")
    expect(guardService).toContain("requiresUserDecision")
    expect(source).toContain('ipcMain.handle("turns:resolveGuard"')
    expect(source).toContain('decision === "approved"')
  })

  it("continues smart five-role runs when a reviewer or gatekeeper fails after main produced output", () => {
    const source = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("function isNonBlockingGuardStepFailure")
    expect(source).toContain("source: \"guard-step-fallback\"")
    expect(source).toContain("nonBlocking: true")
    expect(source).toContain("failedStepId: failed.step.id")
    expect(source).toContain("step.role !== \"reviewer\" && step.role !== \"gatekeeper\"")
    expect(source).toContain("Continuing with the latest main-agent output")
    expect(source).toContain("return outputs.some(item => (item.step.role === \"lead\" || item.step.role === \"synthesizer\") && item.content.trim())")
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
})
