import { getPluginContributions, scanPlugins } from "./plugin-manager"
import { getSkillManager } from "../skills/manager"
import { BUILTIN_SKILLS, type SkillDef } from "../skills/types"
import type { ContextBlock, WorkbenchAttachment } from "./types"

export interface PromptOptimizerInput {
  prompt: string
  workspaceRoot?: string | null
  attachments?: WorkbenchAttachment[]
  maxSkills?: number
  maxPlugins?: number
}

export interface PromptDispatchAnalysis {
  originalPrompt: string
  intent: PromptIntent
  matchedSkills: OptimizerSkillMatch[]
  matchedPlugins: OptimizerPluginMatch[]
  contextBlock: ContextBlock
}

export interface PromptOptimizerResult extends PromptDispatchAnalysis {
  optimizedPrompt: string
}

export type PromptIntent =
  | "implementation"
  | "bugfix"
  | "review"
  | "research"
  | "testing"
  | "design"
  | "documentation"
  | "operations"
  | "general"

export interface OptimizerSkillMatch {
  id: string
  name: string
  description: string
  source: string
  score: number
}

export interface OptimizerPluginMatch {
  pluginId: string
  id: string
  kind: "skill" | "prompt" | "command"
  label: string
  score: number
}

const INTENT_PATTERNS: Array<{ intent: PromptIntent; terms: string[] }> = [
  { intent: "bugfix", terms: ["fix", "bug", "broken", "error", "crash", "regression", "修复", "报错", "错误", "崩溃"] },
  { intent: "review", terms: ["review", "audit", "check", "security", "审查", "检查", "审核", "安全"] },
  { intent: "testing", terms: ["test", "coverage", "verify", "vitest", "playwright", "测试", "覆盖", "验证"] },
  { intent: "research", terms: ["research", "investigate", "explore", "docs", "lookup", "调研", "研究", "查找", "文档"] },
  { intent: "design", terms: ["design", "architecture", "plan", "schema", "架构", "设计", "规划", "方案"] },
  { intent: "documentation", terms: ["document", "docs", "readme", "changelog", "release notes", "文档", "说明"] },
  { intent: "operations", terms: ["deploy", "ci", "docker", "migration", "release", "部署", "发布", "迁移", "运维"] },
  { intent: "implementation", terms: ["implement", "build", "create", "add", "write", "refactor", "实现", "创建", "新增", "添加", "重构"] }
]

const INTENT_GUIDANCE: Record<PromptIntent, string> = {
  implementation: "Implement the request using the existing project patterns. Keep changes scoped, preserve user work, and verify with the narrowest meaningful checks.",
  bugfix: "Reproduce or reason from evidence first, identify the root cause, make the smallest safe fix, and verify the failing path.",
  review: "Use a review posture: lead with defects, regressions, security risks, and missing tests. Cite concrete files/lines when available.",
  research: "Gather evidence before concluding. Prefer local project docs or official sources, and separate facts from assumptions.",
  testing: "Identify the behavior under test, match the existing test framework, cover happy path plus edge/failure paths, and run relevant checks.",
  design: "Clarify goals, constraints, tradeoffs, affected modules, risks, and verification before implementation.",
  documentation: "Update docs in the existing voice and structure. Keep examples accurate and verify referenced commands or paths.",
  operations: "Treat environment, secrets, rollout, rollback, and verification as first-class constraints.",
  general: "Answer directly while preserving context, constraints, and verification expectations."
}

export function analyzePromptForDispatch(input: PromptOptimizerInput): PromptDispatchAnalysis {
  const originalPrompt = normalizePrompt(input.prompt)
  const terms = queryTerms(originalPrompt)
  const intent = detectIntent(originalPrompt, terms)
  const matchedSkills = matchSkills(originalPrompt, terms, input.maxSkills ?? 4)
  const matchedPlugins = matchPlugins(originalPrompt, terms, input.workspaceRoot, input.maxPlugins ?? 4)
  const contextBlock = buildOptimizerContextBlock(intent, matchedSkills, matchedPlugins, originalPrompt)
  return { originalPrompt, intent, matchedSkills, matchedPlugins, contextBlock }
}

export function optimizePromptForDispatch(input: PromptOptimizerInput): PromptOptimizerResult {
  const analysis = analyzePromptForDispatch(input)
  const optimizedPrompt = buildOptimizedPrompt({
    originalPrompt: analysis.originalPrompt,
    intent: analysis.intent,
    matchedSkills: analysis.matchedSkills,
    matchedPlugins: analysis.matchedPlugins,
    attachments: input.attachments || []
  })
  return { ...analysis, optimizedPrompt }
}

function buildOptimizedPrompt(input: {
  originalPrompt: string
  intent: PromptIntent
  matchedSkills: OptimizerSkillMatch[]
  matchedPlugins: OptimizerPluginMatch[]
  attachments: WorkbenchAttachment[]
}): string {
  const skillLines = input.matchedSkills.map(skill => `- ${skill.name}: ${skill.description || skill.source}`)
  const pluginLines = input.matchedPlugins.map(plugin => `- ${plugin.kind} ${plugin.label} (${plugin.pluginId})`)
  const attachmentLines = input.attachments.map(attachment => `- ${attachment.name} (${attachment.kind}${attachment.path ? `, ${attachment.path}` : ""})`)
  return [
    "[AgentHub Prompt Optimizer]",
    `Detected intent: ${input.intent}`,
    `Dispatch guidance: ${INTENT_GUIDANCE[input.intent]}`,
    skillLines.length ? "Relevant skills:" : "",
    ...skillLines,
    pluginLines.length ? "Relevant plugin contributions:" : "",
    ...pluginLines,
    attachmentLines.length ? "Attachments to consider:" : "",
    ...attachmentLines,
    "",
    "[User Request]",
    input.originalPrompt
  ].filter(Boolean).join("\n")
}

function buildOptimizerContextBlock(
  intent: PromptIntent,
  skills: OptimizerSkillMatch[],
  plugins: OptimizerPluginMatch[],
  originalPrompt: string
): ContextBlock {
  const content = [
    `Detected intent: ${intent}`,
    `Original request: ${clip(originalPrompt, 1200)}`,
    skills.length ? "Matched skills:" : "",
    ...skills.map(skill => `- ${skill.name} (${skill.source}) score=${skill.score}: ${skill.description}`),
    plugins.length ? "Matched plugin contributions:" : "",
    ...plugins.map(plugin => `- ${plugin.kind} ${plugin.label} from ${plugin.pluginId} score=${plugin.score}`)
  ].filter(Boolean).join("\n")
  return {
    id: `ctx-prompt-optimizer-${hash(`${intent}:${originalPrompt}`)}`,
    kind: "skill",
    title: "提示词优化器",
    detail: "用户输入已在派发前进行意图识别，并匹配相关 skill/plugin。",
    content,
    estimateTokens: Math.ceil(content.length / 4),
    participation: "selected",
    createdAt: Date.now()
  }
}

function matchSkills(prompt: string, terms: string[], max: number): OptimizerSkillMatch[] {
  const manager = getSkillManager()
  const byManager = manager.findMatchingSkills(prompt)
  const fallback = manager.list()
    .map(skill => ({ skill, score: scoreText(skillText(skill), terms) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.skill)
  const seen = new Set<string>()
  const registered = [...byManager, ...fallback]
    .filter(skill => {
      if (seen.has(skill.id)) return false
      seen.add(skill.id)
      return true
    })
    .map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      score: scoreText(skillText(skill), terms)
    }))
  return [...registered, ...matchBuiltinSkills(terms)]
    .filter(skill => {
      const key = `${skill.source}:${skill.name}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
}

function matchBuiltinSkills(terms: string[]): OptimizerSkillMatch[] {
  return BUILTIN_SKILLS
    .map((skill, index) => {
      const text = [skill.name, skill.description, skill.instructions, skill.source, ...(skill.tags || [])].join(" ")
      return {
        id: `builtin-skill-${slug(skill.name || String(index))}`,
        name: skill.name,
        description: skill.description || "",
        source: skill.source || "builtin",
        score: scoreText(text, terms)
      }
    })
    .filter(skill => skill.score > 0)
}

function matchPlugins(prompt: string, terms: string[], workspaceRoot?: string | null, max = 4): OptimizerPluginMatch[] {
  const contributions = getPluginContributions(scanPlugins(workspaceRoot || undefined))
  const matches: OptimizerPluginMatch[] = []
  for (const skill of contributions.skills) {
    const score = scoreText([skill.id, skill.path, skill.content || ""].join(" "), terms)
    if (score > 0) matches.push({ pluginId: skill.pluginId, id: skill.id, kind: "skill", label: skill.id, score })
  }
  for (const promptContribution of contributions.prompts) {
    const score = scoreText([promptContribution.id, promptContribution.name, promptContribution.body].join(" "), terms)
    if (score > 0) matches.push({ pluginId: promptContribution.pluginId, id: promptContribution.id, kind: "prompt", label: promptContribution.name, score })
  }
  for (const command of contributions.commands) {
    const score = scoreText([command.id, command.label].join(" "), terms)
    if (score > 0) matches.push({ pluginId: command.pluginId, id: command.id, kind: "command", label: command.label, score })
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, max)
}

function detectIntent(prompt: string, terms: string[]): PromptIntent {
  const lower = prompt.toLowerCase()
  let best: { intent: PromptIntent; score: number } = { intent: "general", score: 0 }
  for (const pattern of INTENT_PATTERNS) {
    const score = pattern.terms.reduce((sum, term) => {
      const normalized = term.toLowerCase()
      const hit = lower.includes(normalized) || terms.includes(normalized)
      if (!hit) return sum
      const exactIntentBoost = pattern.intent === "bugfix" && ["fix", "bug", "修复", "报错", "错误"].includes(normalized) ? 2 : 0
      return sum + 2 + exactIntentBoost
    }, 0)
    if (score > best.score) best = { intent: pattern.intent, score }
  }
  return best.intent
}

function normalizePrompt(prompt: string): string {
  return String(prompt || "").trim()
}

function queryTerms(prompt: string): string[] {
  const latin = prompt.toLowerCase().match(/[a-z0-9_/-]{2,}/g) || []
  const cjk = prompt.match(/[\u4e00-\u9fff]{2,}/g) || []
  return [...new Set([...latin, ...cjk].map(term => term.replace(/^\/+/, "")).filter(term => !STOP_TERMS.has(term)))]
}

const STOP_TERMS = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "需要", "现在", "这个", "一个", "实现"])

function skillText(skill: SkillDef): string {
  return [skill.name, skill.description, skill.instructions, skill.source, ...skill.tags].join(" ")
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (lower.includes(term.toLowerCase())) score += term.length > 3 ? 2 : 1
  }
  return score
}

function clip(value: string, max: number): string {
  const text = String(value || "").trim()
  return text.length <= max ? text : `${text.slice(0, max - 3).trim()}...`
}

function hash(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skill"
}
