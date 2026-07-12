import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("ThreadView agent output status", () => {
  it("wires ForkButton onFork from onForkThread prop (F-N4)", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")
    expect(source).toContain("onForkThread")
    expect(source).toContain("onFork={onForkThread}")
  })

  it("uses the latest agent lifecycle event instead of the first done event", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("latestAgentStatus")
    expect(source).toContain("if (event.kind === 'agent:start') latestAgentStatus = 'running'")
    expect(source).toContain("done = event")
    expect(source).toContain("latestAgentStatus = 'completed'")
    expect(source).toContain("error = event")
    expect(source).toContain("latestAgentStatus = 'failed'")
    expect(source).toContain("if (eventsOrSummary.latestAgentStatus === 'running') return 'running'")
  })

  it("normalizes stream text while an agent is still running", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("const text = normalizeOutput(rawText)")
    expect(source).toContain("text && (!isTerminalTurnStatus(status) ? <pre className=\"wb-streaming-text\"")
    expect(source).toContain("!isTerminalTurnStatus(status)\n                ? <ProcessingState events={agentEvents} turn={turn} />")
    expect(source).toContain("const running = !isTerminalTurnStatus(outputStatus(turn.status, events, turn.targetAgent || ''))")
    expect(source).not.toContain("status === 'running' ? rawText.trim()")
    expect(source).not.toContain("status === 'running' ? rawText : normalizeOutput(rawText)")
  })

  it("keeps run-only custom schedule output out of chat answer text", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("function isChatVisibleRuntimeEvent(event: RuntimeEvent): boolean")
    expect(source).toContain("event.kind === 'turn:summary'")
    expect(source).toContain("INTERNAL_TIMELINE_AGENT_IDS.has(event.agentId)")
    expect(source).toContain("event.payload?.visibility === 'run'")
    expect(source).toContain("summary.done?.payload?.visibility === 'run' ? ''")
  })

  it("collapses tool streams only after an agent reaches a shared terminal status", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("defaultOpen={!isTerminalTurnStatus(status)}")
    expect(source).toContain("collapseWhenComplete={isTerminalTurnStatus(status)}")
    expect(source).toContain("const [open, setOpen] = useState(!isTerminalTurnStatus(status))")
    expect(source).toContain("setOpen(!isTerminalTurnStatus(status))")
  })

  it("uses raw event duration and counts failed agent runs in completion reports", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("const visibleEvents = events.filter(isChatVisibleRuntimeEvent)")
    expect(source).not.toContain("event.kind !== 'run:created' && event.kind !== 'run:status'")
    expect(source).toContain("const failedRunCount = status === 'failed' ? 1 : 0")
    expect(source).toContain("totalTools: toolCalls.length + failedRunCount + successfulRunCount")
    expect(source).toContain("const visibleFailedTools = status === 'failed'")
    expect(source).toContain("const historicalFailedAttempts = status === 'completed'")
    expect(source).toContain("outcome: status === 'failed' ? 'failed' as const")
    expect(source).toContain("totalDuration: eventDurationMs(events)")
    expect(source).toContain("function eventDurationMs(events: RuntimeEvent[]): number")
    expect(source).toContain("terminalEventTime(events)")
    expect(source).toContain("event.payload?.durationMs")
    expect(source).toContain("explicitDurations.reduce((sum, value) => sum + value, 0)")
    expect(source).not.toContain("parseFloat(formatEventDuration(events))")
  })

  it("does not let route-only metadata cards inherit a later failed turn status", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("eventsOrSummary.routeEvents.length > 0 || eventsOrSummary.guardEvents.length > 0")
    expect(source).toContain("turnStatus === 'queued' ? 'running' : turnStatus")
    expect(source).not.toContain("return pendingGuard")
  })

  it("groups repeated agent runs by schedule role so reviewer failures do not overwrite main output", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("function eventGroupKey(event: RuntimeEvent): string")
    expect(source).toContain("event.payload?.scheduleRole")
    expect(source).toContain("event.payload?.role")
    expect(source).toContain("event.payload?.sourceStepId")
    expect(source).toContain("event.payload?.failedStepId")
    expect(source).toContain("`${agentId}:${role}:${stepId || role}`")
    expect(source).toContain("summary.scheduleRole ? ` · ${roleName(summary.scheduleRole)}` : ''")
  })

  it("downgrades non-blocking guard step failures and preserves process-only output", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("const nonBlockingGuardFailure = isNonBlockingGuardFailureSummary(summary)")
    expect(source).toContain("const status = nonBlockingGuardFailure ? 'completed' : outputStatus")
    expect(source).toContain("summary.error && !nonBlockingGuardFailure")
    expect(source).toContain("function isNonBlockingGuardFailureSummary")
    expect(source).toContain("guard-step-fallback")
    expect(source).toContain("function emptyOutputText")
    expect(source).toContain("The agent did not return final text, but the run process above was preserved.")
    expect(source).toContain("const finalIsError = summary.hasError && !isNonBlockingGuardFailureSummary(summary)")
  })

  it("does not render empty 0ms completion reports without reportable work", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("const hasReportableWork = toolCalls.length > 0 || failedRunCount > 0 || stats.files.length > 0")
    expect(source).toContain("if (!hasReportableWork) return null")
    expect(source).not.toContain("wb-completion-final-preview")
  })

  it("finalizes running tool rows and filters noisy URL fragments from modified files", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("function stepsToToolCalls(steps: any[], runStatus: WorkbenchTurnStatus = 'running', terminalTime?: number)")
    expect(source).toContain("rawStatus === 'started' && runStatus === 'completed' ? 'succeeded'")
    expect(source).toContain("rawStatus === 'started' && runStatus === 'failed' ? 'failed'")
    expect(source).toContain("rawStatus === 'started' && isTerminalTurnStatus(runStatus) ? 'declined'")
    expect(source).toContain("const fallbackEndTime = terminalTime && terminalTime >= startTime")
    expect(source).toContain("calls={stepsToToolCalls(summary.steps, status, terminalEventTime(agentEvents))}")
    expect(source).toContain("!isLikelySourceFilePath(parsed.path)")
    expect(source).toContain("function isLikelySourceFilePath(path: string): boolean")
    expect(source).toContain("/\\b[a-z][a-z0-9+.-]*:\\/\\//i.test(value)")
  })

  it("reports only write-like file operations as modified files", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("const files = extractModifiedFiles(events)")
    expect(source).toContain("function extractModifiedFiles(events: RuntimeEvent[]): string[]")
    expect(source).toContain("if (!step || !isWriteLikeStep(step)) continue")
    expect(source).toContain("function isWriteLikeStep(step: any): boolean")
    expect(source).toContain("read|grep|glob|search|find|list|ls|cat|view|fetch|open")
    expect(source).toContain("write|edit|create|update|patch|apply|modify|delete|remove|rename|move|save|fs_write")
  })

  it("treats approval-required tool rows as declined instead of failed attempts", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("function isApprovalRequiredStep(step: any): boolean")
    expect(source).toContain("requires approval|approval required|This command requires approval")
    expect(source).toContain(": step.status === 'error' ? approvalRequired ? 'declined' : 'failed'")
  })

  it("keeps awaiting-decision active and presents interrupted as terminal", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("isTerminalTurnStatus")
    expect(source).toContain("isTerminalTurnStatus(turn.status) &&")
    expect(source).toContain("isTerminalTurnStatus(status) && <CompletionSummary")
    expect(source).toContain("status === 'awaiting-decision'")
    expect(source).toContain("'Waiting for decision'")
    expect(source).toContain("status === 'interrupted'")
    expect(source).toContain("'Interrupted'")
  })

  it("routes normal terminal retries separately from interrupted recovery", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).toContain("isTerminalTurnStatus(turn.status) && turn.status !== 'interrupted'")
    expect(source).toContain("onClick={() => onRetry(turn.id)}")
    expect(source).toContain("turn.status === 'interrupted' && <InterruptedDecisionRecovery")
  })

  it("renders guard history as read-only audit text", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")

    expect(source).not.toContain('onResolveGuard')
    expect(source).not.toContain('wb-role-event-actions')
    expect(source).not.toContain("'Continue'")
    expect(source).not.toContain("'Stop'")
  })
})
