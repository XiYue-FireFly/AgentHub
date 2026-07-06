import type { ScheduleStep, SchedulePreview, ModelSelection } from './types'
import type { RouteDecision } from '../hub/router'
import type { ChatCompletionMessage } from '../providers/types'
import type { Dispatcher } from '../hub/dispatcher'
import { getWorkbenchRuntimeStore } from './store'
import { getApprovalConfig } from '../agentic/approval'
import { evaluateGuardVerdict, emitGuardVerdict, executorVerdictNeedsApproval, requestGuardApproval } from './guard-approval-service'
import { guardShouldBlockExecutor } from './guards'
import { compactChatMessages, compactTextByTokenBudget } from './token-economy'

const runtimeStore = getWorkbenchRuntimeStore()

const guardStore = { appendSystemEvent: (tId: string, trId: string, kind: any, agentId: string, payload: any) => runtimeStore.appendSystemEvent(tId, trId, kind, agentId, payload) }

export function orderedCustomLayers(steps: ScheduleStep[]): ScheduleStep[][] {
  const remaining = new Map(steps.map(step => [step.id, step]))
  const done = new Set<string>()
  const layers: ScheduleStep[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(step => (step.dependsOn ?? []).every(dep => done.has(dep)))
    const layer = ready
    if (!layer.length) break
    layers.push(layer)
    for (const step of layer) {
      remaining.delete(step.id)
      done.add(step.id)
    }
  }
  return layers
}

export const FIREFLY_SERIAL_ROLE_ORDER: ScheduleStep["role"][] = ["router", "lead", "reviewer", "executor", "gatekeeper"]

export function serialFireflySteps(steps: ScheduleStep[]): ScheduleStep[] {
  const indexed = steps.map((step, index) => ({ step, index }))
  const ordered = indexed
    .sort((a, b) => {
      const aRank = FIREFLY_SERIAL_ROLE_ORDER.indexOf(a.step.role)
      const bRank = FIREFLY_SERIAL_ROLE_ORDER.indexOf(b.step.role)
      return (aRank === -1 ? 99 : aRank) - (bRank === -1 ? 99 : bRank) || a.index - b.index
    })
    .map(item => item.step)
  return ordered.map((step, index) => ({
    ...step,
    dependsOn: index === 0 ? undefined : [ordered[index - 1].id]
  }))
}

export function isConcreteScheduleStep(step: ScheduleStep): boolean {
  return !!step.agentId && step.agentId !== "auto" && step.agentId !== "all"
}

export function transitiveScheduleDependencies(step: ScheduleStep, stepsById: Map<string, ScheduleStep>, seen = new Set<string>()): ScheduleStep[] {
  const out: ScheduleStep[] = []
  for (const depId of step.dependsOn ?? []) {
    if (seen.has(depId)) continue
    seen.add(depId)
    const dep = stepsById.get(depId)
    if (!dep) continue
    out.push(dep)
    out.push(...transitiveScheduleDependencies(dep, stepsById, seen))
  }
  return out
}

export function validateConcreteScheduleSteps(steps: ScheduleStep[]): { steps: ScheduleStep[]; error?: string } {
  const concrete = steps.filter(isConcreteScheduleStep)
  if (concrete.length === 0) return { steps: [], error: "No usable local agents are available for this custom schedule." }
  const byId = new Map<string, ScheduleStep>()
  for (const step of concrete) {
    if (byId.has(step.id)) return { steps: concrete, error: `Duplicate schedule step id: ${step.id}` }
    byId.set(step.id, step)
  }
  for (const step of concrete) {
    if (hasScheduleCycle(step, byId)) {
      return { steps: concrete, error: `Schedule dependency cycle detected near "${step.label}".` }
    }
  }
  for (const step of concrete) {
    const missingDep = (step.dependsOn ?? []).find(dep => !byId.has(dep))
    if (missingDep) {
      return { steps: concrete, error: `Schedule step "${step.label}" depends on unavailable step "${missingDep}".` }
    }
    if (step.role === "executor") {
      const guardDeps = transitiveScheduleDependencies(step, byId)
        .filter(dep => dep.role === "reviewer" || dep.role === "gatekeeper")
      if (guardDeps.length === 0) {
        return { steps: concrete, error: `Executor step "${step.label}" requires a concrete reviewer or gatekeeper dependency.` }
      }
    }
  }
  return { steps: concrete }
}

export function hasScheduleCycle(step: ScheduleStep, stepsById: Map<string, ScheduleStep>, visiting = new Set<string>(), visited = new Set<string>()): boolean {
  if (visiting.has(step.id)) return true
  if (visited.has(step.id)) return false
  visiting.add(step.id)
  for (const depId of step.dependsOn ?? []) {
    const dep = stepsById.get(depId)
    if (dep && hasScheduleCycle(dep, stepsById, visiting, visited)) return true
  }
  visiting.delete(step.id)
  visited.add(step.id)
  return false
}

export function stepDependsOn(stepsById: Map<string, ScheduleStep>, step: ScheduleStep, targetId: string, seen = new Set<string>()): boolean {
  for (const dep of step.dependsOn ?? []) {
    if (dep === targetId) return true
    if (seen.has(dep)) continue
    seen.add(dep)
    const upstream = stepsById.get(dep)
    if (upstream && stepDependsOn(stepsById, upstream, targetId, seen)) return true
  }
  return false
}

export function gatedCandidateStepIds(steps: ScheduleStep[]): Set<string> {
  const stepsById = new Map(steps.map(step => [step.id, step]))
  const guardSteps = steps.filter(step => step.role === "reviewer" || step.role === "gatekeeper")
  return new Set(steps
    .filter(step => step.role === "lead" || step.role === "synthesizer")
    .filter(step => guardSteps.some(guard => stepDependsOn(stepsById, guard, step.id)))
    .map(step => step.id))
}

export function appendSyntheticChatRelease(input: {
  threadId: string
  turnId: string
  step: ScheduleStep
  content: string
  fireflyHandoff: boolean
  stripGuardPreamble: (content: string) => string
}) {
  const content = input.fireflyHandoff ? input.stripGuardPreamble(input.content) : input.content
  if (!content.trim()) return
  const payload = {
    content,
    providerId: "local-cli",
    modelId: input.step.agentId,
    scheduleRole: input.step.role,
    scheduleStepId: input.step.id,
    visibility: "chat",
    gatedRelease: true,
    sourceStepId: input.step.id,
    synthetic: true,
    usageExcluded: true
  }
  runtimeStore.appendSystemEvent(input.threadId, input.turnId, "agent:done", input.step.agentId, payload)
}

export async function runCustomScheduleTurn(input: {
  dispatcher: Dispatcher
  prompt: string
  schedule: SchedulePreview
  workspaceId: string | null
  turnId: string
  threadId: string
  messages: ChatCompletionMessage[]
  isCancelled: () => boolean
  thinking?: any
  modelSelection?: ModelSelection
  preserveCurrentMessage?: boolean
  routeDecision?: RouteDecision
  recentUserMessages?: string[]
  emitMemoryCandidates: (threadId: string, turnId: string, prompt: string, content: string) => void
}): Promise<{ status: "completed" | "failed" | "cancelled"; error?: string }> {
  const fireflyHandoff = input.schedule.preset === "firefly-custom"
  const scheduleSteps = fireflyHandoff
    ? serialFireflySteps(scheduleStepsWithRouteDecision(input.schedule.steps, input.routeDecision))
    : scheduleStepsWithRouteDecision(input.schedule.steps, input.routeDecision)
  const validation = validateConcreteScheduleSteps(scheduleSteps)
  if (validation.error) return { status: "failed", error: validation.error }
  const layers = fireflyHandoff ? validation.steps.map(step => [step]) : orderedCustomLayers(validation.steps)
  const gatedCandidateIds = fireflyHandoff ? new Set<string>() : gatedCandidateStepIds(validation.steps)
  const stepsById = new Map(validation.steps.map(step => [step.id, step]))
  const compressedHistory = compactScheduleHistory(input.messages, input.prompt)
  if (layers.length === 0) {
    return { status: "failed", error: "No usable local agents are available for this custom schedule." }
  }
  const outputs: Array<{ step: ScheduleStep; content: string; error?: string }> = []
  let blockedByGuard: string | null = null
  let deniedByGuard: string | null = null
  for (const layer of layers) {
    if (input.isCancelled()) return { status: "cancelled" }
    const results = await Promise.all(layer.map(async step => {
      if (input.isCancelled()) return { step, content: "", error: "cancelled", status: "cancelled" as const }
      if (fireflyHandoff && step.role === "router") {
        const content = JSON.stringify(input.routeDecision || {}, null, 2)
        runtimeStore.appendSystemEvent(input.threadId, input.turnId, "agent:done", step.agentId, {
          kind: "done",
          taskId: `synthetic-router-${input.turnId}`,
          agentId: step.agentId,
          providerId: "local-router",
          modelId: "weighted-router",
          content,
          scheduleStepId: step.id,
          scheduleRole: step.role,
          visibility: "run",
          synthetic: true,
          usageExcluded: true,
          durationMs: 0
        })
        return { step, content, status: "completed" as const }
      }
      if (step.role === "executor" && blockedByGuard) {
        runtimeStore.appendSystemEvent(input.threadId, input.turnId, "guard:verdict", step.agentId, {
          role: step.role,
          level: "high",
          status: "block",
          reasons: [blockedByGuard],
          checkedAt: Date.now()
        })
        return { step, content: "", error: blockedByGuard, status: "failed" as const }
      }
      const role = `${step.label} / ${step.role}`
      const stepContext = promptForScheduleStep(step, outputs, input, stepsById, compressedHistory)
      const stepPrompt = [
        `[AgentHub Custom Schedule]`,
        `Current step: ${role}`,
        step.dependsOn?.length ? `Depends on: ${step.dependsOn.join(", ")}` : "",
        "",
        stepContext
      ].filter(Boolean).join("\n")
      const stepModelSelection = modelSelectionForScheduleStep(input.modelSelection, step)
      const stepMessages = [
        ...compressedHistory,
        { role: "user", content: stepPrompt } as ChatCompletionMessage
      ]
      const task = await input.dispatcher.dispatch(stepPrompt, "auto", step.agentId, {
        thinking: input.thinking,
        workspaceId: input.workspaceId,
        modelSelection: stepModelSelection,
        turnId: input.turnId,
        threadId: `${input.threadId}:custom:${step.id}`,
        conversationText: stepPrompt,
        messages: stepMessages,
        preserveCurrentMessage: input.preserveCurrentMessage,
        streamMeta: streamMetaForScheduleStep(step, gatedCandidateIds, fireflyHandoff)
      })
      const content = task.results.get(step.agentId) || ""
      const error = task.errors.get(step.agentId) || task.error
      if (!error && (step.role === "reviewer" || step.role === "gatekeeper" || step.role === "executor")) {
        const verdict = evaluateGuardVerdict(content, step.role)
        const guardBypassedByPreset = getApprovalConfig().getConfig().preset === "full-access"
        if (!guardBypassedByPreset && (guardShouldBlockExecutor(verdict, step.role) || executorVerdictNeedsApproval(verdict, step.role))) {
          const reason = verdict.reasons.join("; ")
          if (verdict.level === "high" || verdict.status === "block") {
            const guardDecision = await requestGuardApproval(guardStore, {
              threadId: input.threadId,
              turnId: input.turnId,
              agentId: step.agentId,
              role: step.role,
              verdict
            })
            const { requestId, decision } = guardDecision
            if (decision === "approved") {
              runtimeStore.appendSystemEvent(input.threadId, input.turnId, "guard:verdict", step.agentId, {
                role: step.role,
                level: verdict.level,
                status: "warn",
                reasons: ["User approved continuing after high-risk guard warning.", ...verdict.reasons],
                requestId,
                decision,
                checkedAt: Date.now()
              })
            } else {
              deniedByGuard = decision === "timeout"
                ? "Guard decision timed out; execution was stopped."
                : reason
              runtimeStore.appendSystemEvent(input.threadId, input.turnId, "guard:verdict", step.agentId, {
                role: step.role,
                level: verdict.level,
                status: "block",
                reasons: [deniedByGuard],
                requestId,
                decision,
                checkedAt: Date.now()
              })
              blockedByGuard = deniedByGuard
            }
          } else {
            emitGuardVerdict(guardStore, input.threadId, input.turnId, step.agentId, step.role, content)
            const guardDecision = await requestGuardApproval(guardStore, {
              threadId: input.threadId,
              turnId: input.turnId,
              agentId: step.agentId,
              role: step.role,
              verdict
            })
            const { decision } = guardDecision
            if (decision === "approved") {
              runtimeStore.appendSystemEvent(input.threadId, input.turnId, "guard:verdict", step.agentId, {
                role: step.role,
                level: verdict.level,
                status: "warn",
                reasons: ["User approved continuing after medium-risk guard warning.", ...verdict.reasons],
                decision,
                checkedAt: Date.now()
              })
            } else {
              blockedByGuard = reason
            }
          }
        } else {
          emitGuardVerdict(guardStore, input.threadId, input.turnId, step.agentId, step.role, content)
        }
      }
      return { step, content, error, status: task.status }
    }))
    outputs.push(...results.map(result => ({ step: result.step, content: result.content, error: result.error })))
    const cancelled = results.find(result => result.status === "cancelled")
    if (cancelled || input.isCancelled()) return { status: "cancelled", error: cancelled?.error }
    if (deniedByGuard) return { status: "failed", error: deniedByGuard }
    const failed = results.find(result => result.status === "failed" || result.error)
    if (failed) {
      if (fireflyHandoff && isNonBlockingGuardStepFailure(failed.step, outputs)) {
        runtimeStore.appendSystemEvent(input.threadId, input.turnId, "guard:verdict", failed.step.agentId, {
          role: failed.step.role,
          level: "medium",
          status: "warn",
          nonBlocking: true,
          source: "guard-step-fallback",
          failedRole: failed.step.role,
          failedStepId: failed.step.id,
          reasons: [
            `${failed.step.label} was unavailable: ${failed.error || "no output"}. Continuing with the latest main-agent output.`
          ],
          checkedAt: Date.now()
        })
      } else {
        return { status: "failed", error: failed.error || `${failed.step.label} failed` }
      }
    }
  }
  if (blockedByGuard) return { status: "failed", error: blockedByGuard }
  const gatedFinal = finalScheduleRelease(outputs, fireflyHandoff, gatedCandidateIds)
  if (gatedFinal?.content) {
    appendSyntheticChatRelease({
      threadId: input.threadId,
      turnId: input.turnId,
      step: gatedFinal.step,
      content: gatedFinal.content,
      fireflyHandoff,
      stripGuardPreamble
    })
  }
  const final = gatedFinal || [...outputs].reverse().find(item => item.step.role === "lead" || item.step.role === "synthesizer") || outputs[outputs.length - 1]
  if (final?.content) input.emitMemoryCandidates(input.threadId, input.turnId, input.prompt, fireflyHandoff ? stripGuardPreamble(final.content) : final.content)
  return { status: "completed" }
}

export function isNonBlockingGuardStepFailure(step: ScheduleStep, outputs: Array<{ step: ScheduleStep; content: string; error?: string }>): boolean {
  if (step.role !== "reviewer" && step.role !== "gatekeeper") return false
  return outputs.some(item => (item.step.role === "lead" || item.step.role === "synthesizer") && item.content.trim())
}

export function finalScheduleRelease(outputs: Array<{ step: ScheduleStep; content: string; error?: string }>, fireflyHandoff: boolean, gatedCandidateIds: Set<string>) {
  if (fireflyHandoff) {
    return [...outputs].reverse().find(item => item.step.role === "gatekeeper" && item.content) ||
      [...outputs].reverse().find(item => item.step.role === "executor" && item.content) ||
      [...outputs].reverse().find(item => item.step.role === "lead" && item.content)
  }
  return [...outputs].reverse().find(item => gatedCandidateIds.has(item.step.id) && item.content)
}

export function scheduleStepsWithRouteDecision(steps: ScheduleStep[], decision?: RouteDecision): ScheduleStep[] {
  void decision
  if (!decision || !decision.selectedAgentId) return steps
  const selectedAgent = decision.selectedAgentId
  return steps.map(step => {
    if (step.role === "lead" && step.agentId === "auto") {
      return { ...step, agentId: selectedAgent }
    }
    return step
  })
}

export function streamMetaForScheduleStep(step: ScheduleStep, gatedCandidateIds = new Set<string>(), forceRunOnly = false): Record<string, any> {
  return {
    scheduleStepId: step.id,
    scheduleRole: step.role,
    visibility: forceRunOnly || gatedCandidateIds.has(step.id) ? "run" : step.role === "lead" || step.role === "synthesizer" ? "chat" : "run"
  }
}

export function stripGuardPreamble(content: string): string {
  const lines = String(content || "").split(/\r?\n/)
  while (lines.length && !lines[0].trim()) lines.shift()
  if (!lines.length) return ""
  const match = lines[0].trim().match(/^(PASS|WARN|REVISE|BLOCK)\b\s*[:：-]?\s*(.*)$/i)
  if (!match) return lines.join("\n").trim()
  const rest = match[2]?.replace(/^final answer\s*[:：-]?\s*/i, "").trim()
  const tail = lines.slice(1).join("\n").trim()
  return [rest, tail].filter(Boolean).join("\n\n").trim() || String(content || "").trim()
}

export function promptForScheduleStep(
  step: ScheduleStep,
  outputs: Array<{ step: ScheduleStep; content: string; error?: string }>,
  input: { prompt: string; routeDecision?: RouteDecision; recentUserMessages?: string[]; preserveCurrentMessage?: boolean },
  stepsById = new Map<string, ScheduleStep>(),
  _compressedHistory: ChatCompletionMessage[] = []
): string {
  if (step.role === "router") {
    return [
      "[Router scope]",
      "You may only use the current user request, the last 10 user prompts, and the available route scores.",
      "Do not use assistant/main-agent outputs. Return concise JSON with state, selectedAgentId, and reasons.",
      "",
      `Current user request:\n${input.prompt}`,
      "",
      `Recent user prompts:\n${(input.recentUserMessages || []).slice(-10).map((item, index) => `${index + 1}. ${item}`).join("\n") || "(none)"}`,
      "",
      `Route decision:\n${JSON.stringify(input.routeDecision || {}, null, 2)}`
    ].join("\n")
  }
  const context = scheduleStepContext(step, outputs, input.prompt, stepsById, input.preserveCurrentMessage)
  if (step.role === "reviewer") {
    return [
      "[Reviewer scope]",
      "Inspect the main-agent draft for harmful, unsafe, destructive, privacy-leaking, or out-of-scope actions.",
      "Return PASS, WARN, REVISE, or BLOCK with concise reasons and any approved actions for the executor.",
      "Do not produce the final user-facing answer.",
      "",
      context
    ].join("\n")
  }
  if (step.role === "gatekeeper") {
    return [
      "[Gatekeeper scope]",
      "You are the final handoff step. Check the main draft, reviewer verdict, and executor result against the user's requested language, format, constraints, and project rules.",
      "Then release exactly one final user-facing answer.",
      "If you need to note a verdict, put PASS/WARN/REVISE/BLOCK on its own first line, then write the final answer after a blank line.",
      "Do not expose raw router JSON, reviewer notes, executor logs, or internal schedule details unless the user explicitly asked for process details.",
      "",
      context
    ].join("\n")
  }
  if (step.role === "executor") {
    const approvals = outputs
      .filter(item => item.step.role === "reviewer")
      .map(item => item.content)
      .join("\n")
    return [
      "[Executor scope]",
      "Only execute actions that are explicitly approved by the reviewer notes below.",
      "If there is no approved computer/browser/terminal/file action, respond with 'No execution needed.'",
      "Never perform destructive actions without explicit user confirmation.",
      "Do not produce the final user-facing answer; summarize executed or skipped actions for the gatekeeper.",
      "",
      "[Approvals]",
      approvals || "(no explicit approved actions)",
      "",
      context
    ].join("\n")
  }
  return context
}

function compactScheduleHistory(messages: ChatCompletionMessage[], prompt: string): ChatCompletionMessage[] {
  if (!messages.length) return []
  const history = messages.slice(0, -1)
  if (!history.length) return []
  return compactChatMessages(history, {
    maxTokens: 3_000,
    keepRecentMessages: 2,
    perHistoricalMessageTokens: 700,
    currentMessageTokens: 1_200
  })
    .filter(message => !sameTrimmed(message.content, prompt))
    .slice(-3)
}

function scheduleStepContext(step: ScheduleStep, outputs: Array<{ step: ScheduleStep; content: string; error?: string }>, prompt: string, stepsById: Map<string, ScheduleStep>, preservePrompt = false): string {
  const dependencyIds = dependencyOutputIds(step, stepsById)
  const relevant = dependencyIds.size
    ? outputs.filter(item => dependencyIds.has(item.step.id))
    : outputs.slice(-2)
  const upstream = relevant.map(item => {
    const raw = item.error ? `ERROR: ${item.error}` : item.content || "(no text output)"
    const compacted = compactTextByTokenBudget(raw, 1_800, {
      headTokens: 1_200,
      tailTokens: 400,
      marker: `[... upstream output from ${item.step.label} omitted by token economy ...]`
    }).text
    return `## ${item.step.label} (${item.step.agentId}, ${item.step.role})\n${compacted}`
  })
  return [
    "[User Request]",
    preservePrompt ? prompt : compactTextByTokenBudget(prompt, 4_000).text,
    upstream.length ? "\n[Relevant Upstream Outputs]" : "",
    ...upstream
  ].filter(Boolean).join("\n\n")
}

function dependencyOutputIds(step: ScheduleStep, stepsById: Map<string, ScheduleStep>): Set<string> {
  const ids = new Set<string>()
  const visit = (id: string) => {
    if (ids.has(id)) return
    ids.add(id)
    const dep = stepsById.get(id)
    for (const parent of dep?.dependsOn ?? []) visit(parent)
  }
  for (const dep of step.dependsOn ?? []) visit(dep)
  return ids
}

function sameTrimmed(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim() === right.replace(/\s+/g, " ").trim()
}

export function modelSelectionForScheduleStep(selection: ModelSelection | undefined, step: ScheduleStep): ModelSelection | undefined {
  if (!selection) return undefined
  if (selection.source === "provider") return undefined
  if (selection.source === "local-cli" && selection.agentId && selection.agentId !== step.agentId) return undefined
  return selection
}
