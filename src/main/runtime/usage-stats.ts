import { getWorkbenchRuntimeStore } from "./store"
import type { RuntimeEvent, UsageHeatmapDay, UsageRange, UsageStats, UsageView, WorkbenchTurn } from "./types"

const DAY_MS = 86_400_000
const CHARS_PER_TOKEN = 4

interface UsageBucket {
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
}

interface UsageRecord extends UsageBucket {
  turnId: string
  agentId?: string
  modelId: string
}

export function usageStats(range: UsageRange = "all", view: UsageView = "overview"): UsageStats {
  const runtime = getWorkbenchRuntimeStore()
  const snapshot = runtime.snapshot(undefined)
  const turnIds = new Set(snapshot.turns.map(turn => turn.id))
  const events = snapshot.threads.flatMap(thread => runtime.eventsSince(thread.id, 0)).filter(event => turnIds.has(event.turnId))
  const from = rangeStart(range)
  const turns = snapshot.turns.filter(turn => !from || turn.createdAt >= from)
  const filteredTurnIds = new Set(turns.map(turn => turn.id))
  const filteredEvents = events.filter(event => filteredTurnIds.has(event.turnId))
  const usageRecords = usageRecordsForEvents(turns, filteredEvents)
  const usageByTurn = usageTokensByTurn(usageRecords)
  const totalTokens = [...usageByTurn.values()].reduce((sum, value) => sum + value.tokens, 0)
  const actualTokens = [...usageByTurn.values()].reduce((sum, value) => sum + value.actualTokens, 0)
  const estimatedTokens = [...usageByTurn.values()].reduce((sum, value) => sum + value.estimatedTokens, 0)
  const heatmap = buildHeatmap(turns, usageByTurn, range)
  const activeDaysSet = new Set(heatmap.filter(day => day.turns > 0 || day.tokens > 0).map(day => day.date))

  return {
    range,
    view,
    sessions: new Set(turns.map(turn => turn.threadId)).size,
    messages: turns.length,
    totalTokens,
    actualTokens,
    estimatedTokens,
    hasEstimated: estimatedTokens > 0,
    activeDays: activeDaysSet.size,
    currentStreak: currentStreak(activeDaysSet),
    longestStreak: longestStreak(activeDaysSet),
    cost: null,
    cacheSavings: null,
    contextSavings: null,
    cacheRate: null,
    heatmap,
    models: modelRows(usageRecords)
  }
}

function usageRecordsForEvents(turns: WorkbenchTurn[], events: RuntimeEvent[]): UsageRecord[] {
  const turnById = new Map(turns.map(turn => [turn.id, turn]))
  const actualKeys = new Set<string>()
  const records: UsageRecord[] = []

  for (const event of events) {
    if (!isModelUsageEvent(event)) continue
    const usage = normalizeUsage(event.payload?.usage)
    if (!usage || usage.totalTokens <= 0) continue
    const modelId = modelIdForEvent(event, usage.modelId)
    actualKeys.add(usageKey(event.turnId, event.agentId, modelId))
    records.push({
      turnId: event.turnId,
      agentId: event.agentId,
      modelId,
      tokens: usage.totalTokens,
      actualTokens: usage.totalTokens,
      estimatedTokens: 0,
      hasEstimated: false
    })
  }

  for (const event of events) {
    if (!isModelUsageEvent(event) || normalizeUsage(event.payload?.usage)) continue
    const turn = turnById.get(event.turnId)
    if (!turn) continue
    const modelId = modelIdForEvent(event)
    if (actualKeys.has(usageKey(event.turnId, event.agentId, modelId))) continue
    const estimatedTokens = estimateUsageForDoneEvent(turn, event)
    if (estimatedTokens <= 0) continue
    records.push({
      turnId: event.turnId,
      agentId: event.agentId,
      modelId,
      tokens: estimatedTokens,
      actualTokens: 0,
      estimatedTokens,
      hasEstimated: true
    })
  }

  return records
}

function usageTokensByTurn(records: UsageRecord[]): Map<string, UsageBucket> {
  const map = new Map<string, UsageBucket>()
  for (const record of records) {
    const prev = map.get(record.turnId) || emptyUsageBucket()
    map.set(record.turnId, addUsage(prev, record))
  }
  return map
}

function modelRows(records: UsageRecord[]): UsageStats["models"] {
  const rows = new Map<string, UsageBucket & { modelId: string; agentId?: string; turns: number; turnIds: Set<string> }>()
  for (const record of records) {
    const key = `${record.agentId || "agent"}:${record.modelId}`
    const row = rows.get(key) || { ...emptyUsageBucket(), modelId: record.modelId, agentId: record.agentId, turns: 0, turnIds: new Set<string>() }
    const next = addUsage(row, record)
    row.tokens = next.tokens
    row.actualTokens = next.actualTokens
    row.estimatedTokens = next.estimatedTokens
    row.hasEstimated = next.hasEstimated
    row.turnIds.add(record.turnId)
    row.turns = row.turnIds.size
    rows.set(key, row)
  }
  return [...rows.values()]
    .map(({ turnIds: _turnIds, ...row }) => row)
    .sort((a, b) => b.tokens - a.tokens)
}

function buildHeatmap(turns: WorkbenchTurn[], usageByTurn: Map<string, UsageBucket>, range: UsageRange): UsageHeatmapDay[] {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 119
  const today = startOfDay(Date.now())
  const byDate = new Map<string, UsageBucket & { turns: number }>()
  for (const turn of turns) {
    const date = isoDay(turn.createdAt)
    const cur = byDate.get(date) || { ...emptyUsageBucket(), turns: 0 }
    const turnUsage = usageByTurn.get(turn.id) || emptyUsageBucket()
    cur.turns += 1
    cur.tokens += turnUsage.tokens
    cur.actualTokens += turnUsage.actualTokens
    cur.estimatedTokens += turnUsage.estimatedTokens
    cur.hasEstimated = cur.hasEstimated || turnUsage.hasEstimated
    byDate.set(date, cur)
  }
  const maxTokens = Math.max(1, ...[...byDate.values()].map(day => day.tokens))
  const out: UsageHeatmapDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const ts = today - i * DAY_MS
    const date = isoDay(ts)
    const value = byDate.get(date) || { ...emptyUsageBucket(), turns: 0 }
    out.push({
      date,
      turns: value.turns,
      tokens: value.tokens,
      actualTokens: value.actualTokens,
      estimatedTokens: value.estimatedTokens,
      hasEstimated: value.hasEstimated,
      level: heatLevel(value.tokens, value.turns, maxTokens),
      selected: i === 0
    })
  }
  return out
}

function heatLevel(tokens: number, turns: number, maxTokens: number): UsageHeatmapDay["level"] {
  if (tokens <= 0 && turns <= 0) return 0
  if (tokens <= 0) return 1
  const ratio = tokens / maxTokens
  if (ratio > 0.75) return 4
  if (ratio > 0.45) return 3
  if (ratio > 0.18) return 2
  return 1
}

function currentStreak(activeDays: Set<string>): number {
  let streak = 0
  let cursor = startOfDay(Date.now())
  while (activeDays.has(isoDay(cursor))) {
    streak += 1
    cursor -= DAY_MS
  }
  return streak
}

function longestStreak(activeDays: Set<string>): number {
  const days = [...activeDays].sort()
  let longest = 0
  let current = 0
  let prev = 0
  for (const day of days) {
    const ts = new Date(`${day}T00:00:00`).getTime()
    current = prev && ts - prev === DAY_MS ? current + 1 : 1
    longest = Math.max(longest, current)
    prev = ts
  }
  return longest
}

function rangeStart(range: UsageRange): number | null {
  if (range === "all") return null
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  return startOfDay(Date.now()) - (days - 1) * DAY_MS
}

export function normalizeUsage(usage: any): { promptTokens: number; completionTokens: number; totalTokens: number; modelId?: string } | null {
  if (!usage || typeof usage !== "object") return null
  const promptTokens = numberField(usage.prompt_tokens) ?? numberField(usage.promptTokens) ?? numberField(usage.input_tokens) ?? numberField(usage.inputTokens) ?? numberField(usage.promptTokenCount) ?? 0
  const completionTokens = numberField(usage.completion_tokens) ?? numberField(usage.completionTokens) ?? numberField(usage.output_tokens) ?? numberField(usage.outputTokens) ?? numberField(usage.candidatesTokenCount) ?? 0
  const totalTokens = numberField(usage.total_tokens) ?? numberField(usage.totalTokens) ?? numberField(usage.totalTokenCount) ?? sumKnown(promptTokens, completionTokens) ?? 0
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) return null
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || promptTokens + completionTokens,
    modelId: typeof usage.modelId === "string" ? usage.modelId : undefined
  }
}

export function estimateUsageForDoneEvent(turn: WorkbenchTurn, event: RuntimeEvent): number {
  const promptText = turn.prompt || ""
  const attachmentText = (turn.attachments || [])
    .filter(attachment => attachment.kind !== "image")
    .map(attachment => [attachment.name, attachment.text].filter(Boolean).join("\n"))
    .join("\n")
  const outputText = [
    event.payload?.content,
    event.payload?.thinking,
    event.payload?.summary?.preview
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n")
  return estimateTokens([promptText, attachmentText, outputText].join("\n"))
}

export function isModelUsageEvent(event: RuntimeEvent): boolean {
  if (event.kind !== "agent:done") return false
  const providerId = String(event.payload?.providerId || "").toLowerCase()
  if (!providerId || providerId === "system" || providerId === "terminal" || providerId === "git") return false
  if (providerId.includes("terminal") || providerId.includes("git")) return false
  return Boolean(event.agentId || event.payload?.agentId)
}

function estimateTokens(text: string): number {
  const chars = text.replace(/\s+/g, " ").trim().length
  return chars > 0 ? Math.ceil(chars / CHARS_PER_TOKEN) : 0
}

function modelIdForEvent(event: RuntimeEvent, usageModelId?: string): string {
  return String(event.payload?.modelId || usageModelId || "unknown")
}

function usageKey(turnId: string, agentId: string | undefined, modelId: string): string {
  return `${turnId}:${agentId || "agent"}:${modelId}`
}

function emptyUsageBucket(): UsageBucket {
  return { tokens: 0, actualTokens: 0, estimatedTokens: 0, hasEstimated: false }
}

function addUsage<T extends UsageBucket>(base: T, value: UsageBucket): T {
  base.tokens += value.tokens
  base.actualTokens += value.actualTokens
  base.estimatedTokens += value.estimatedTokens
  base.hasEstimated = base.hasEstimated || value.hasEstimated || value.estimatedTokens > 0
  return base
}

function numberField(value: any): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function sumKnown(...values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value != null)
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function isoDay(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
