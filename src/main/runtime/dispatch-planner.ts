import type { RouteDecision } from "../hub/router"
import type { PromptDispatchAnalysis } from "./prompt-optimizer"
import { executorGateTemplate, fireflyFiveRoleTemplate, parallelReviewTemplate, toDispatcherMode } from "./schedules"
import type { DispatchPreset, SchedulePreview, WorkbenchAttachment } from "./types"

export interface DispatchPlannerInput {
  requestedMode: DispatchPreset
  directRun?: boolean
  directTarget?: string | null
  customSchedule?: SchedulePreview
  availableAgentIds: string[]
  attachments?: WorkbenchAttachment[]
  optimization: PromptDispatchAnalysis
}

export interface DispatchPlan {
  effectiveMode: DispatchPreset
  dispatchMode: "auto" | "broadcast" | "chain" | "orchestrate"
  schedule?: SchedulePreview
  routeAgentIds?: string[]
  routeDecision?: RouteDecision
  strategy:
    | "direct-agent"
    | "direct-provider"
    | "user-schedule"
    | "user-mode"
    | "auto-single"
    | "auto-parallel-review"
    | "auto-lead-workers"
    | "auto-executor-gate"
    | "auto-five-role"
  reasons: string[]
}

const REVIEW_TERMS = /\b(review|audit|security|risk|compare|parallel|consensus)\b|审查|检查|评审|安全|风险|对比|比较|并行/i
const ACTION_TERMS = /\b(fix|implement|build|create|add|write|refactor|update|edit|patch)\b|修复|实现|新增|添加|重构|修改|编辑/i
const LOOP_TERMS = /\b(loop|aggregate|multi[- ]?model|consensus|debate|ensemble)\b|循环|聚合|多模型|共识/i

export function planDispatch(input: DispatchPlannerInput): DispatchPlan {
  const requestedMode = input.requestedMode || "auto"
  const directTarget = input.directTarget?.trim() || null
  const availableAgentIds = unique(input.availableAgentIds)
  const reasons: string[] = []

  if (input.directRun) {
    return {
      effectiveMode: "auto",
      dispatchMode: "auto",
      strategy: directTarget ? "direct-agent" : "direct-provider",
      reasons: [directTarget ? "User selected a specific local agent." : "User selected a provider model directly."]
    }
  }

  if (directTarget) {
    return {
      effectiveMode: "auto",
      dispatchMode: "auto",
      strategy: "direct-agent",
      reasons: ["User selected a specific local agent."]
    }
  }

  if (input.customSchedule) {
    return {
      effectiveMode: requestedMode,
      dispatchMode: toDispatcherMode(requestedMode),
      schedule: input.customSchedule,
      routeAgentIds: availableAgentIds,
      strategy: "user-schedule",
      reasons: ["User supplied an explicit schedule graph."]
    }
  }

  if (requestedMode !== "auto") {
    return planExplicitMode(requestedMode, availableAgentIds)
  }

  return planAuto(input, availableAgentIds, reasons)
}

export function applyRouteDecisionToPlan(plan: DispatchPlan, routeDecision?: RouteDecision): DispatchPlan {
  if (!routeDecision) return plan
  return { ...plan, routeDecision }
}

function planExplicitMode(requestedMode: DispatchPreset, availableAgentIds: string[]): DispatchPlan {
  const schedule = scheduleForPreset(requestedMode, availableAgentIds)
  return {
    effectiveMode: requestedMode,
    dispatchMode: toDispatcherMode(requestedMode),
    schedule,
    routeAgentIds: availableAgentIds,
    strategy: "user-mode",
    reasons: [`User selected ${requestedMode} mode.`]
  }
}

function planAuto(input: DispatchPlannerInput, availableAgentIds: string[], reasons: string[]): DispatchPlan {
  const prompt = input.optimization.originalPrompt
  const matchCount = input.optimization.matchedSkills.length + input.optimization.matchedPlugins.length
  const hasAttachments = (input.attachments || []).length > 0
  const multiAgent = availableAgentIds.length >= 2
  const richAgentSet = availableAgentIds.length >= 3
  const needsReview = input.optimization.intent === "review" || input.optimization.intent === "testing" || REVIEW_TERMS.test(prompt)
  const needsActionGate = input.optimization.intent === "operations" || (hasAttachments && REVIEW_TERMS.test(prompt) && ACTION_TERMS.test(prompt))
  const needsImplementation = input.optimization.intent === "implementation" || input.optimization.intent === "bugfix" || input.optimization.intent === "design" || ACTION_TERMS.test(prompt)
  const asksForAggregation = LOOP_TERMS.test(prompt)
  const complexEnoughForLead = prompt.length > 900 || matchCount >= 2 || hasAttachments

  if (!multiAgent) {
    return {
      effectiveMode: "auto",
      dispatchMode: "auto",
      routeAgentIds: availableAgentIds,
      strategy: "auto-single",
      reasons: ["Only one usable local agent is available, so auto route stays single-agent."]
    }
  }

  if (asksForAggregation || needsReview) {
    reasons.push(asksForAggregation ? "Prompt asks for multi-model aggregation." : "Review/testing intent benefits from independent parallel opinions.")
    return {
      effectiveMode: "parallel-review",
      dispatchMode: "chain",
      schedule: parallelReviewTemplate(availableAgentIds),
      routeAgentIds: availableAgentIds,
      strategy: "auto-parallel-review",
      reasons
    }
  }

  if (needsActionGate && richAgentSet) {
    reasons.push("Action-oriented request with context benefits from review, execution, and gatekeeping.")
    return {
      effectiveMode: "custom",
      dispatchMode: "chain",
      schedule: executorGateTemplate(availableAgentIds),
      routeAgentIds: availableAgentIds,
      strategy: "auto-executor-gate",
      reasons
    }
  }

  if (needsImplementation && complexEnoughForLead) {
    reasons.push("Implementation/design request has enough context to benefit from lead-worker synthesis.")
    return {
      effectiveMode: "lead-workers",
      dispatchMode: "chain",
      schedule: leadWorkersAggregationTemplate(availableAgentIds),
      routeAgentIds: availableAgentIds,
      strategy: "auto-lead-workers",
      reasons
    }
  }

  if (richAgentSet && matchCount >= 3) {
    reasons.push("Multiple matched skills/plugins suggest a structured five-role handoff.")
    return {
      effectiveMode: "firefly-custom",
      dispatchMode: "chain",
      schedule: fireflyFiveRoleTemplate(availableAgentIds),
      routeAgentIds: availableAgentIds,
      strategy: "auto-five-role",
      reasons
    }
  }

  return {
    effectiveMode: "auto",
    dispatchMode: "auto",
    routeAgentIds: availableAgentIds,
    strategy: "auto-single",
    reasons: ["Auto route selected the best single target for a simple turn."]
  }
}

function scheduleForPreset(preset: DispatchPreset, availableAgentIds: string[]): SchedulePreview | undefined {
  if (preset === "parallel-review") return parallelReviewTemplate(availableAgentIds)
  if (preset === "firefly-custom") return fireflyFiveRoleTemplate(availableAgentIds)
  if (preset === "lead-workers") return leadWorkersAggregationTemplate(availableAgentIds)
  return undefined
}

function leadWorkersAggregationTemplate(agentIds: string[]): SchedulePreview {
  const available = unique(agentIds)
  const lead = preferredAgent(available, ["claude", "codex", "minimax-code"])
  const workerA = preferredAgent(available, ["codex", "minimax-code", "gemini", "claude"], lead)
  const workerB = preferredAgent(available, ["minimax-code", "claude", "gemini", "codex"], workerA)
  const synth = preferredAgent(available, ["claude", "codex", "minimax-code"], workerB)
  const workers = unique([workerA, workerB].filter(Boolean))
  return {
    preset: "lead-workers",
    label: "Auto lead-worker aggregation",
    labelZh: "自动主控聚合",
    labelEn: "Auto lead-worker aggregation",
    description: "A lead scopes the request, workers produce independent passes, and a synthesizer releases one final answer.",
    descriptionZh: "主控拆解请求，工作 Agent 独立处理，最后统一汇总为一个答案。",
    descriptionEn: "A lead scopes the request, workers produce independent passes, and a synthesizer releases one final answer.",
    steps: [
      { id: "lead", label: "Route and scope", labelZh: "路由与定界", labelEn: "Route and scope", agentId: lead, role: "lead", mode: "auto" },
      ...workers.map((agentId, index) => ({
        id: `worker-${index + 1}`,
        label: index === 0 ? "Primary pass" : "Independent pass",
        labelZh: index === 0 ? "主处理" : "独立视角",
        labelEn: index === 0 ? "Primary pass" : "Independent pass",
        agentId,
        role: "worker" as const,
        mode: "auto" as const,
        dependsOn: ["lead"]
      })),
      { id: "synth", label: "Synthesize final", labelZh: "汇总最终答案", labelEn: "Synthesize final", agentId: synth, role: "synthesizer", mode: "auto", dependsOn: workers.map((_, index) => `worker-${index + 1}`) }
    ]
  }
}

function preferredAgent(agentIds: string[], preferred: string[], avoid?: string): string {
  return preferred.find(id => id !== avoid && agentIds.includes(id)) ||
    agentIds.find(id => id !== avoid) ||
    agentIds[0] ||
    "auto"
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
}
