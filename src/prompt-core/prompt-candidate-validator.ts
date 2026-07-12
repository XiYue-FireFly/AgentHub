import { canonicalJson, sha256Hex } from "./canonical-json"

export type PromptCandidateValidation =
  | { readonly ok: true; readonly candidates: readonly string[] }
  | { readonly ok: false; readonly error: string }

const QUOTED_LITERAL_PATTERNS = [
  /"([^"]{1,256})"/gu,
  /'([^']{1,256})'/gu,
  /“([^”]{1,256})”/gu,
  /‘([^’]{1,256})’/gu,
  /「([^」]{1,256})」/gu,
  /『([^』]{1,256})』/gu
]

const SIDE_EFFECT_FAMILIES = [
  /\b(?:delete|remove|erase|format|wipe|rm)\b|(?:删除|移除|清空|格式化)/giu,
  /\b(?:execute|run\s+(?:an?\s+)?(?:command|script)|shell|powershell|bash|cmd(?:\.exe)?)\b|(?:执行(?:命令|脚本)?|运行(?:命令|脚本)|终端)/giu,
  /\b(?:upload|send\s+(?:results?|data|files?)|publish|deploy|webhook|curl|fetch)\b|(?:上传|外发|发送到|发布|部署|网络请求)/giu,
  /\b(?:sudo|administrator|admin|root|elevat(?:e|ed|ion)|chmod|chown|grant\s+privileges?)\b|(?:管理员|提权|超级用户|权限提升)/giu
]

const ENGLISH_NEGATION_PREFIX =
  /\b(?:do\s+not|don't|must\s+not|never|without|no)\s+((?:[\w-]+\s+){0,4})$/iu

const CHINESE_NEGATION_PREFIX =
  /(?:不要|不得|禁止|不能|不允许|无需|无须)\s*((?:[\u3400-\u9FFF\w-]+\s*){0,4})$/u

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ")
}

function cleanFragment(value: string): string {
  return normalizedText(value).replace(/[.,!?。！？]+$/u, "")
}

function addMatches(fragments: Set<string>, pattern: RegExp, source: string, capture = false): void {
  for (const match of source.matchAll(pattern)) {
    const fragment = cleanFragment(capture ? (match[1] ?? "") : match[0])
    if (fragment) fragments.add(fragment)
  }
}

function protectedFragments(source: string): readonly string[] {
  const fragments = new Set<string>()
  for (const pattern of QUOTED_LITERAL_PATTERNS) addMatches(fragments, pattern, source, true)
  addMatches(fragments, /https?:\/\/[^\s<>"'`]+/gu, source)
  addMatches(fragments, /(?:[A-Za-z]:\\|\\\\)[^\s,;:!?"'<>]*/gu, source)
  addMatches(fragments, /(?:^|[\s("'`])((?:\/(?!\/))[^\s,;:!?"'<>]*)/gu, source, true)
  addMatches(fragments, /\b(?:[A-Za-z]{1,12}[-_]\d+(?:[-_]\d+)*|\d+(?:\.\d+)*)\b/gu, source)
  addMatches(
    fragments,
    /(?:\b(?:do not|don't|must not|without|never|no)\b|不要|不得|禁止|不能|不允许|无需|无须)[^.!?。！？\r\n]*/giu,
    source
  )
  return Object.freeze([...fragments])
}

function candidateText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const text = (value as Record<string, unknown>).text
  return typeof text === "string" ? normalizedText(text) : undefined
}

function isNegatedSideEffect(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 96), index)
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("。"),
    before.lastIndexOf("！"),
    before.lastIndexOf("？"),
    before.lastIndexOf(";"),
    before.lastIndexOf("；"),
    before.lastIndexOf("\n")
  )
  const prefix = before.slice(sentenceStart + 1)
  const negation = ENGLISH_NEGATION_PREFIX.exec(prefix) ?? CHINESE_NEGATION_PREFIX.exec(prefix)
  if (!negation) return false
  return !containsSideEffectTerm(negation[1] ?? "")
}

function containsSideEffectTerm(value: string): boolean {
  return SIDE_EFFECT_FAMILIES.some(family => new RegExp(family.source, family.flags).test(value))
}

function hasAffirmativeSideEffect(text: string, family: RegExp): boolean {
  const matcher = new RegExp(family.source, family.flags)
  for (const match of text.matchAll(matcher)) {
    if (match.index !== undefined && !isNegatedSideEffect(text, match.index)) return true
  }
  return false
}

function hasUnauthorizedSideEffect(candidate: string, source: string): boolean {
  return SIDE_EFFECT_FAMILIES.some(family =>
    hasAffirmativeSideEffect(candidate, family) && !hasAffirmativeSideEffect(source, family)
  )
}

export function validatePromptCandidateSet(
  value: unknown,
  sourcePrompt: string,
  maxPromptChars: number
): PromptCandidateValidation {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "candidate response must be an object" }
  }

  const record = value as Record<string, unknown>
  if (record.schemaVersion !== "prompt-candidates-v1") {
    return { ok: false, error: "unsupported candidate schema" }
  }
  if (!Array.isArray(record.candidates) || record.candidates.length < 2 || record.candidates.length > 3) {
    return { ok: false, error: "candidate count must be two or three" }
  }

  const source = normalizedText(String(sourcePrompt))
  const protectedValues = protectedFragments(source)
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const item of record.candidates) {
    const text = candidateText(item)
    if (!text || text.length > maxPromptChars) {
      return { ok: false, error: "candidate length is invalid" }
    }

    const distinctKey = text.toLowerCase()
    if (seen.has(distinctKey)) {
      return { ok: false, error: "candidate texts must be distinct" }
    }
    if (protectedValues.some(fragment => !text.includes(fragment))) {
      return { ok: false, error: "candidate lost a protected literal or constraint" }
    }
    if (hasUnauthorizedSideEffect(text, source)) {
      return { ok: false, error: "candidate introduced a new privilege or side effect" }
    }

    seen.add(distinctKey)
    candidates.push(text)
  }

  return { ok: true, candidates: Object.freeze(candidates) }
}

export function buildPromptArtifactCacheKey(input: Readonly<Record<string, unknown>>): string {
  return sha256Hex(canonicalJson(input))
}
