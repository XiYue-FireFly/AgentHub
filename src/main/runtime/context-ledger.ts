import { existsSync } from "node:fs"
import { getWorkspaceManager } from "../hub/workspace"
import type {
  ContextBlock,
  ContextProjection,
  RuntimeEvent,
  WorkbenchAttachment,
  WorkbenchSnapshot,
  WorkbenchThread,
  WorkbenchTurn
} from "./types"

const DEFAULT_SOFT_CONTEXT_TOKENS = 96_000
const DEFAULT_HARD_CONTEXT_TOKENS = 120_000
const DEFAULT_KEEP_RECENT_TURNS = 6

export interface BuildContextProjectionInput {
  thread: WorkbenchThread | undefined
  prompt: string
  workspaceId: string | null
  attachments: WorkbenchAttachment[]
  snapshot: WorkbenchSnapshot
  events: RuntimeEvent[]
  memories?: Array<{ id?: string; title?: string; content?: string; text?: string; category?: string }>
  pinnedBlocks?: ContextBlock[]
  writeDraft?: { title: string; content: string } | null
  modelContextWindowTokens?: number
}

export function buildContextProjection(input: BuildContextProjectionInput): ContextProjection {
  const blocks: ContextBlock[] = []
  const now = Date.now()
  const threadTurns = input.thread
    ? input.snapshot.turns.filter(turn => turn.threadId === input.thread!.id)
    : []
  const recentTurns = threadTurns.slice(-DEFAULT_KEEP_RECENT_TURNS)

  if (recentTurns.length > 0) {
    blocks.push({
      id: "ctx-recent-turns",
      kind: "recent_turns",
      title: "最近对话",
      detail: `${recentTurns.length} 轮会话会作为连续上下文`,
      content: recentTurns.map(turn => compactTurnForContext(turn, input.events)).join("\n\n"),
      estimateTokens: estimateTokens(recentTurns.map(turn => turn.prompt).join("\n")),
      participation: "selected",
      createdAt: now
    })
  }

  const olderTurns = threadTurns.slice(0, Math.max(0, threadTurns.length - DEFAULT_KEEP_RECENT_TURNS))
  const olderEstimate = estimateTokens(olderTurns.map(turn => turn.prompt).join("\n"))
  if (olderTurns.length > 0) {
    blocks.push({
      id: "ctx-compaction-summary",
      kind: "compaction_summary",
      title: "压缩摘要",
      detail: `${olderTurns.length} 轮较早会话已折叠`,
      content: summarizeTurns(olderTurns),
      estimateTokens: Math.min(olderEstimate, 1200),
      participation: "selected",
      createdAt: now
    })
  }

  for (const attachment of input.attachments) {
    blocks.push({
      id: `ctx-attachment-${attachment.id}`,
      kind: "attachment",
      title: attachment.name,
      detail: attachment.kind === "image" ? "图片附件" : attachment.kind === "text" ? "文本附件" : "文件附件",
      content: attachment.text || attachment.path || attachment.dataUrl?.slice(0, 2048) || "",
      sourceRef: attachment.path || attachment.id,
      estimateTokens: estimateTokens(attachment.text || attachment.name),
      participation: "selected",
      createdAt: now
    })
  }

  for (const memory of input.memories?.slice(0, 8) ?? []) {
    const content = memory.content || memory.text || ""
    blocks.push({
      id: `ctx-memory-${memory.id || hash(`${memory.title}:${content}`)}`,
      kind: "memory",
      title: memory.title || memory.category || "长期记忆",
      detail: memory.category,
      content,
      sourceRef: memory.id,
      estimateTokens: estimateTokens(content),
      participation: "selected",
      createdAt: now
    })
  }

  if (input.writeDraft?.content?.trim()) {
    blocks.push({
      id: "ctx-write-draft",
      kind: "write_draft",
      title: input.writeDraft.title || "当前文稿",
      detail: "写作空间草稿",
      content: input.writeDraft.content,
      estimateTokens: estimateTokens(input.writeDraft.content),
      participation: "selected",
      createdAt: now
    })
  }

  blocks.push(workspaceStateBlock(input.workspaceId, now))
  for (const block of input.pinnedBlocks ?? []) {
    if (!blocks.some(item => item.id === block.id)) blocks.push({ ...block, participation: "pinned_next_send", pinned: true })
  }

  const totalEstimateTokens = blocks.reduce((sum, block) => sum + (block.estimateTokens ?? estimateTokens(block.content || block.detail || block.title)), 0)
  const softThreshold = softThresholdForWindow(input.modelContextWindowTokens)
  const hardThreshold = hardThresholdForWindow(input.modelContextWindowTokens)
  const compacted = totalEstimateTokens > hardThreshold
  return {
    threadId: input.thread?.id ?? null,
    workspaceId: input.workspaceId,
    blocks: totalEstimateTokens > softThreshold ? compactBlocks(blocks, hardThreshold) : blocks,
    totalEstimateTokens,
    compacted,
    createdAt: now
  }
}

export function contextProjectionPrompt(projection?: ContextProjection): string {
  if (!projection?.blocks.length) return ""
  const included = projection.blocks.filter(block => block.participation !== "excluded")
  if (!included.length) return ""
  return [
    "[AgentHub Context Ledger]",
    "下面是本轮显式带给模型的上下文。稳定系统提示不在这里重复，动态上下文只放在本轮消息中。",
    "",
    ...included.map(formatContextBlock)
  ].join("\n\n")
}

function workspaceStateBlock(workspaceId: string | null, createdAt: number): ContextBlock {
  if (!workspaceId) {
    return {
      id: "ctx-workspace-unbound",
      kind: "workspace_state",
      title: "未绑定工作目录",
      detail: "本轮没有项目文件上下文；普通对话和写作可继续，文件、终端、Git 需要先选择工作目录。",
      content: "workspaceId=null",
      estimateTokens: 64,
      participation: "selected",
      createdAt
    }
  }
  const workspace = getWorkspaceManager().getById(workspaceId)
  return {
    id: "ctx-workspace-bound",
    kind: "workspace_state",
    title: workspace?.name || "工作目录",
    detail: workspace?.rootPath && existsSync(workspace.rootPath) ? workspace.rootPath : "工作目录不可用",
    content: workspace ? `Workspace: ${workspace.name}\nRoot: ${workspace.rootPath}` : `Workspace not found: ${workspaceId}`,
    estimateTokens: 80,
    participation: "selected",
    createdAt
  }
}

function compactTurnForContext(turn: WorkbenchTurn, events: RuntimeEvent[]): string {
  const outputs = events
    .filter(event => event.turnId === turn.id && (event.kind === "agent:done" || event.kind === "orchestrate"))
    .map(event => event.payload?.content || event.payload?.error || "")
    .filter(Boolean)
    .join("\n")
  return [
    `User: ${clip(turn.prompt, 1200)}`,
    outputs ? `Assistant: ${clip(outputs, 1600)}` : ""
  ].filter(Boolean).join("\n")
}

function summarizeTurns(turns: WorkbenchTurn[]): string {
  const selected = turns.length <= 10 ? turns : [...turns.slice(0, 3), ...turns.slice(-7)]
  const omitted = Math.max(0, turns.length - selected.length)
  return [
    "目标、约束、决策、文件和未完成事项摘要：",
    ...selected.map((turn, index) => `- ${index + 1}. ${clip(turn.prompt, 240)} (${turn.status})`),
    omitted ? `- 中间 ${omitted} 轮已省略。` : ""
  ].filter(Boolean).join("\n")
}

function compactBlocks(blocks: ContextBlock[], hardThreshold: number): ContextBlock[] {
  const protectedBlocks = blocks.filter(block => block.pinned || block.kind !== "recent_turns")
  const recent = blocks.find(block => block.kind === "recent_turns")
  const protectedTokens = protectedBlocks.reduce((sum, block) => sum + (block.estimateTokens ?? 0), 0)
  if (!recent || protectedTokens < hardThreshold) return protectedBlocks
  return protectedBlocks.map(block => block.kind === "compaction_summary"
    ? {
        ...block,
        detail: "上下文较长，已自动压缩",
        content: clip(block.content || "", 4000),
        estimateTokens: Math.min(block.estimateTokens ?? 1200, 1200)
      }
    : block)
}

function formatContextBlock(block: ContextBlock): string {
  return [
    `## ${block.title}`,
    block.detail ? `Source: ${block.detail}` : "",
    block.sourceRef ? `Ref: ${block.sourceRef}` : "",
    block.content ? clip(block.content, 8000) : ""
  ].filter(Boolean).join("\n")
}

function hardThresholdForWindow(contextWindowTokens?: number): number {
  if (!contextWindowTokens || !Number.isFinite(contextWindowTokens)) return DEFAULT_HARD_CONTEXT_TOKENS
  return Math.max(8_000, Math.floor(contextWindowTokens * 0.85))
}

function softThresholdForWindow(contextWindowTokens?: number): number {
  if (!contextWindowTokens || !Number.isFinite(contextWindowTokens)) return DEFAULT_SOFT_CONTEXT_TOKENS
  return Math.max(8_000, Math.floor(contextWindowTokens * 0.75))
}

function estimateTokens(value: string): number {
  const clean = String(value || "").trim()
  if (!clean) return 0
  return Math.ceil(clean.length / 4)
}

function clip(value: string, max: number): string {
  const text = String(value || "").trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`
}

function hash(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}
