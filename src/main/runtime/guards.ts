export type GuardLevel = "low" | "medium" | "high"
export type GuardStatus = "pass" | "warn" | "revise" | "block"

export interface GuardVerdict {
  level: GuardLevel
  status: GuardStatus
  reasons: string[]
}

const VALID_STATUSES: ReadonlySet<string> = new Set(["pass", "warn", "revise", "block"])
const VALID_LEVELS: ReadonlySet<string> = new Set(["low", "medium", "high"])

/**
 * Try to extract a structured JSON verdict from model output.
 * Models should output: {"guard":{"status":"pass|warn|revise|block","level":"low|medium|high","reasons":["..."]}}
 * This is the most reliable extraction path; regex/heuristic are fallbacks.
 */
export function structuredVerdictFromText(text: string): GuardVerdict | null {
  const value = String(text || "")
  // Look for {"guard":{...}} or {"verdict":{...}} JSON blocks
  const jsonMatch = value.match(/\{[^{}]*"(?:guard|verdict)"\s*:\s*(\{[^{}]+\})\s*\}/)
  if (!jsonMatch) {
    // Also try standalone {"status":"...","level":"...","reasons":[...]}
    const standalone = value.match(/\{\s*"status"\s*:\s*"(?:pass|warn|revise|block)"[^}]*\}/)
    if (!standalone) return null
    try {
      const obj = JSON.parse(standalone[0])
      return validateVerdictShape(obj)
    } catch { return null }
  }
  try {
    const inner = JSON.parse(jsonMatch[1])
    return validateVerdictShape(inner)
  } catch { return null }
}

function validateVerdictShape(obj: any): GuardVerdict | null {
  if (!obj || typeof obj !== "object") return null
  const status = typeof obj.status === "string" ? obj.status.toLowerCase() : null
  const level = typeof obj.level === "string" ? obj.level.toLowerCase() : null
  if (!status || !VALID_STATUSES.has(status)) return null
  const validLevel = level && VALID_LEVELS.has(level) ? level as GuardLevel
    : status === "block" ? "high" as GuardLevel
    : status === "revise" ? "medium" as GuardLevel
    : "low" as GuardLevel
  const reasons = Array.isArray(obj.reasons) ? obj.reasons.filter((r: any) => typeof r === "string").slice(0, 10) : []
  return { level: validLevel, status: status as GuardStatus, reasons: reasons.length ? reasons : [`structured ${status} verdict`] }
}

/**
 * Extract a guard verdict from model output.
 * Priority: structured JSON > explicit regex PASS/WARN/REVISE/BLOCK > keyword heuristic.
 */
export function explicitGuardVerdictFromText(text: string): GuardVerdict | null {
  // 1. Try structured JSON first (most reliable)
  const structured = structuredVerdictFromText(text)
  if (structured) return structured
  // 2. Fallback: regex first-line match
  const value = String(text || "")
  const firstLine = value.split(/\r?\n/).map(line => line.trim()).find(Boolean)
  const match = firstLine?.match(/^(PASS|WARN|REVISE|BLOCK)\b/i)
  if (!match) return null
  const status = match[1].toLowerCase() as GuardStatus
  const level: GuardLevel = status === "block" ? "high" : status === "revise" ? "medium" : "low"
  return {
    level,
    status,
    reasons: [firstLine || `explicit ${status} verdict`]
  }
}

export function riskVerdictForText(text: string, role: string): GuardVerdict {
  const value = String(text || "").toLowerCase()
  if (role === "executor" && /\b(no execution needed|nothing to execute|no approved action|no action required)\b/i.test(value)) {
    return { level: "low", status: "pass", reasons: ["no approved execution action requested"] }
  }
  if (/(rm\s+-rf|format\s+[a-z]:|delete\s+all|remove-item\s+-recurse|drop\s+database|\u6cc4\u9732|\u79c1\u94a5|password|api[_-]?key|token)/i.test(value)) {
    return {
      level: "high",
      status: "block",
      reasons: ["dangerous command, destructive action, or sensitive secret pattern"]
    }
  }
  if (/(writefile|delete|remove|shell|terminal|exec|browser|click|\u4e0b\u8f7d|\u5220\u9664|\u5199\u5165|\u8fd0\u884c\u547d\u4ee4|\u6267\u884c\u547d\u4ee4)/i.test(value) || role === "executor") {
    return {
      level: "medium",
      status: "revise",
      reasons: ["action requires review before execution"]
    }
  }
  if (/(maybe|\u4e0d\u786e\u5b9a|\u53ef\u80fd|\u8349\u7a3f|draft)/i.test(value)) {
    return {
      level: "low",
      status: "warn",
      reasons: ["answer may need user-facing clarity"]
    }
  }
  return { level: "low", status: "pass", reasons: ["no blocking issue detected"] }
}

export function guardShouldBlockExecutor(verdict: GuardVerdict, role: string): boolean {
  if (role !== "reviewer" && role !== "gatekeeper") return false
  return verdict.status === "block" || verdict.status === "revise"
}
