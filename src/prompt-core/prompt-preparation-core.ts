import type {
  PromptEnvelope,
  PromptEnvelopeStatus,
  PromptOrigin,
  PromptPolicy,
  PromptPreparationSession
} from "../shared/prompt-contract"
import { hashPromptText } from "./canonical-json.ts"

export const PROMPT_OPTIMIZER_VERSION = "prompt-preparation-v1"

export type PromptClarity = "clear" | "ambiguous" | "broad" | "explicit-optimization"

export interface PromptAnalysis {
  readonly clarity: PromptClarity
  readonly signals: readonly string[]
}

const EXPLICIT_OPTIMIZATION =
  /\b(?:optimi[sz]e|rewrite|improve)\s+(?:this\s+)?prompt\b|(?:优化|改写|润色).{0,8}(?:提示词|prompt)|(?:提示词|prompt).{0,8}(?:优化|改写|润色)/iu

const BROAD_SCOPE =
  /\b(?:everything|all\s+(?:files?|issues?|problems?)|entire\s+(?:project|repository|codebase))\b|(?:全部|所有|整个)(?:项目|仓库|代码库|代码|问题|文件)/iu

const UNRESOLVED_REFERENCE =
  /^(?:(?:fix|change|improve|handle)\s+)?(?:this|that|it)\b|^(?:请|帮我|麻烦)?\s*(?:处理|修复|弄好|改好)?\s*(?:这个|那个|这些|它)\s*$/iu

const CLEAR_ACTION =
  /^(?:run|execute|list|open|show|explain|summarize|build|test|review|fix)\b.{1,120}$|^(?:运行|执行|列出|打开|显示|解释|总结|构建|测试|审查|修复).{1,80}$/iu

function normalizedPrompt(rawPrompt: string): string {
  return String(rawPrompt).normalize("NFKC").trim()
}

function terminalState(state: PromptPreparationSession["state"]): boolean {
  return state === "finalized" || state === "cancelled" || state === "failed"
}

export function analyzePrompt(rawPrompt: string): PromptAnalysis {
  const prompt = normalizedPrompt(rawPrompt)
  if (EXPLICIT_OPTIMIZATION.test(prompt)) {
    return Object.freeze({
      clarity: "explicit-optimization" as const,
      signals: Object.freeze(["explicit-request"])
    })
  }

  const signals: string[] = []
  if (BROAD_SCOPE.test(prompt)) signals.push("unbounded-scope")
  if (UNRESOLVED_REFERENCE.test(prompt)) signals.push("unresolved-reference")
  if (!CLEAR_ACTION.test(prompt) && prompt.length < 12) signals.push("missing-objective")

  const clarity: PromptClarity = signals.includes("unbounded-scope")
    ? "broad"
    : signals.length > 0
      ? "ambiguous"
      : "clear"

  return Object.freeze({ clarity, signals: Object.freeze(signals) })
}

export function shouldGeneratePromptCandidates(analysis: PromptAnalysis): boolean {
  return analysis.clarity === "ambiguous"
    || analysis.clarity === "broad"
    || analysis.clarity === "explicit-optimization"
}

/**
 * Electron-free baseline optimizer for the headless CLI. Runtime compositions
 * may add workspace/skill context, while this pure form remains source-loadable
 * by the CLI and preserves the same root-session semantics.
 */
export function optimizePromptForHeadlessDispatch(rawPrompt: string): string {
  const originalPrompt = normalizedPrompt(rawPrompt)
  return [
    "[AgentHub Prompt Optimizer]",
    "Clarify the objective, preserve the stated constraints, and verify the result with focused checks.",
    "",
    "[User Request]",
    originalPrompt
  ].join("\n")
}

export function startPromptPreparation(input: {
  sessionId: string
  rootInputId: string
  origin: PromptOrigin
  policy: PromptPolicy
  prompt: string
  retryOfEnvelopeId?: string
}): PromptPreparationSession {
  return Object.freeze({
    sessionId: input.sessionId,
    rootInputId: input.rootInputId,
    origin: input.origin,
    policy: input.policy,
    state: "analyzing",
    inputHash: hashPromptText(String(input.prompt).trim()),
    preparationCount: 1,
    optimizationCount: input.policy === "optimize" ? 1 : 0,
    candidateAttemptCount: 0,
    ...(input.retryOfEnvelopeId === undefined ? {} : { retryOfEnvelopeId: input.retryOfEnvelopeId })
  })
}

export function withPreparationState(
  session: PromptPreparationSession,
  state: PromptPreparationSession["state"],
  candidateAttemptCount = session.candidateAttemptCount
): PromptPreparationSession {
  if (terminalState(session.state)) throw new Error("Prompt preparation is already terminal")
  return Object.freeze({ ...session, state, candidateAttemptCount })
}

export function finalizePromptEnvelope(input: {
  session: PromptPreparationSession
  envelopeId: string
  displayOriginalPrompt: string
  effectivePrompt: string
  status: PromptEnvelopeStatus
  optimizerVersion: string
  finalizedAt: number
}): PromptEnvelope {
  if (input.session.state !== "analyzing" && input.session.state !== "awaiting-decision") {
    throw new Error("Prompt preparation cannot finalize from " + input.session.state)
  }

  const displayOriginalPrompt = String(input.displayOriginalPrompt).trim()
  const effectivePrompt = String(input.effectivePrompt).trim()
  if (!displayOriginalPrompt || !effectivePrompt) {
    throw new Error("Prompt envelope text must not be empty")
  }
  if (hashPromptText(displayOriginalPrompt) !== input.session.inputHash) {
    throw new Error("Prompt envelope original prompt does not match session input")
  }

  return Object.freeze({
    envelopeId: input.envelopeId,
    sessionId: input.session.sessionId,
    rootInputId: input.session.rootInputId,
    displayOriginalPrompt,
    effectivePrompt,
    origin: input.session.origin,
    policy: input.session.policy,
    status: input.status,
    optimizerVersion: input.optimizerVersion,
    inputHash: input.session.inputHash,
    preparedTextHash: hashPromptText(effectivePrompt),
    optimizationCount: input.session.optimizationCount,
    finalizedAt: input.finalizedAt
  })
}
