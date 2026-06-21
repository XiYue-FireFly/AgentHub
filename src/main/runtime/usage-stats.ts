import { store } from "../store"
import { getWorkbenchRuntimeStore } from "./store"
import { DEFAULT_PRICING_RULES, DEFAULT_PRICING_ALIASES } from "./default-pricing"
import { normalizeUsage as normalizeUsageRaw } from "../providers/client"
import type {
  PaginatedUsageRecords,
  RuntimeEvent,
  UsageHeatmapDay,
  UsageModelRow,
  UsagePricingRule,
  UsageProviderRow,
  UsageRange,
  UsageRecordFilter,
  UsageRequestRecord,
  UsageSource,
  UsageStats,
  UsageTokenBreakdown,
  UsageView,
  WorkbenchTurn
} from "./types"

const DAY_MS = 86_400_000
const CHARS_PER_TOKEN = 4
const PRICING_KEY = "usage.pricing.v1"
const LEDGER_KEY = "usage.ledger.v1"
const PRICING_SEEDED_KEY = "usage.pricing.seeded.v1"
// Ledger 保留上限：超过则裁剪最旧记录（安全阀，防止 electron-store 无限膨胀）。
// 不再按 TTL 自动裁剪——usage 历史不应被动丢失，用户可手动清理。
const LEDGER_MAX_RECORDS = 10_000

// --- Persistent usage ledger (survives runtime event trimming) ---

function loadLedger(): UsageRequestRecord[] {
  const raw: any = store.get(LEDGER_KEY)
  return Array.isArray(raw) ? raw : []
}

function saveLedger(records: UsageRequestRecord[]): void {
  store.set(LEDGER_KEY, records)
}

/**
 * Merge new records into the ledger and return the full merged list.
 * Reads, deduplicates, saves, and returns in a single synchronous operation
 * to avoid stale reads when called from buildUsageRecords.
 *
 * 同时执行 TTL（30 天）与上限（10000 条）剪枝，避免 electron-store 无限膨胀。
 * 参照 cc-switch usage_rollup.rs:57-179 的剪枝策略。
 */
function appendLedgerEntries(newRecords: UsageRequestRecord[]): UsageRequestRecord[] {
  const existing = loadLedger()
  if (!newRecords.length) return pruneLedger(existing, false)
  const existingIds = new Set(existing.map(r => r.eventId))
  const toAdd = newRecords.filter(r => !existingIds.has(r.eventId))
  if (!toAdd.length) return pruneLedger(existing, false)
  const merged = [...toAdd, ...existing].sort((a, b) => b.createdAt - a.createdAt)
  // 写盘：即使无剪枝也要保存，因为新增了 toAdd
  const pruned = pruneLedgerSilent(merged)
  saveLedger(pruned)
  return pruned
}

/**
 * Ledger 剪枝：仅按上限（10000 条）裁剪最旧记录，不再按 TTL 自动删除。
 * 历史 usage 不应被动丢失；用户可通过 UI 手动清理。
 * 不写盘，仅返回剪枝后的数组（写盘由调用方决定）。
 */
function pruneLedger(records: UsageRequestRecord[], persistIfChanged: boolean): UsageRequestRecord[] {
  if (records.length === 0) return records
  const pruned = pruneLedgerSilent(records)
  if (pruned.length === records.length) return records
  if (persistIfChanged) saveLedger(pruned)
  return pruned
}

function pruneLedgerSilent(records: UsageRequestRecord[]): UsageRequestRecord[] {
  if (records.length === 0) return records
  // Only apply max-records limit as safety valve. No TTL-based auto-deletion.
  if (records.length > LEDGER_MAX_RECORDS) {
    return records.slice(0, LEDGER_MAX_RECORDS)
  }
  return records
}

interface UsageBucket {
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheSavingsTokens: number
  cacheSavingsUsd: number | null
  billableInputTokens: number
  inputSurfaceTokens: number
  costUsd: number | null
  hasUnpriced: boolean
  requests: number
  turnIds: Set<string>
}

interface PricingState {
  version: 1
  rules: UsagePricingRule[]
}

export function usageStats(range: UsageRange = "all", view: UsageView = "overview"): UsageStats {
  const records = filterUsageRecords(buildUsageRecords(), { range })
  const turns = turnsForUsageRecords(records)
  const usageByTurn = usageTokensByTurn(records)
  const totals = records.reduce((bucket, record) => addRecordToBucket(bucket, record), emptyUsageBucket())
  const heatmap = buildHeatmap(turns, usageByTurn, range)
  const activeDaysSet = new Set(heatmap.filter(day => day.turns > 0 || day.tokens > 0).map(day => day.date))

  return {
    range,
    view,
    sessions: new Set(turns.map(turn => turn.threadId)).size,
    messages: turns.length,
    totalTokens: totals.tokens,
    actualTokens: totals.actualTokens,
    estimatedTokens: totals.estimatedTokens,
    hasEstimated: totals.hasEstimated,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheSavingsTokens: totals.cacheSavingsTokens,
    cacheSavingsUsd: totals.cacheSavingsUsd,
    billableInputTokens: totals.billableInputTokens,
    activeDays: activeDaysSet.size,
    currentStreak: currentStreak(activeDaysSet),
    longestStreak: longestStreak(activeDaysSet),
    cost: totals.costUsd,
    costUsd: totals.costUsd,
    hasUnpriced: totals.hasUnpriced,
    // cacheSavings 现在指向节省金额（USD），不再是 raw token 数
    cacheSavings: totals.cacheSavingsUsd,
    contextSavings: null,
    cacheRate: cacheRate(totals),
    requests: totals.requests,
    heatmap,
    models: modelRows(records),
    providers: providerRows(records)
  }
}

export function usageRecords(filter: UsageRecordFilter = {}, page = 1, pageSize = 50): PaginatedUsageRecords {
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const safePageSize = Math.max(1, Math.min(200, Math.floor(Number(pageSize) || 50)))
  const records = filterUsageRecords(buildUsageRecords(), filter)
  const start = (safePage - 1) * safePageSize
  return {
    records: records.slice(start, start + safePageSize),
    total: records.length,
    page: safePage,
    pageSize: safePageSize
  }
}

export function usageRecordDetail(id: string): UsageRequestRecord | null {
  return buildUsageRecords().find(record => record.id === id) ?? null
}

export function listUsagePricingRules(): UsagePricingRule[] {
  return pricingState().rules
}

export function upsertUsagePricingRule(input: Partial<UsagePricingRule> & { modelId: string }): UsagePricingRule {
  const modelId = String(input.modelId || "").trim()
  if (!modelId) throw new Error("modelId is required")
  const now = Date.now()
  const state = pricingState()
  const providerId = normalizeOptionalString(input.providerId)
  const id = pricingRuleId(providerId, modelId)
  const existing = state.rules.find(rule => rule.id === id)
  const next: UsagePricingRule = {
    id,
    providerId,
    modelId,
    displayName: normalizeOptionalString(input.displayName),
    inputUsdPerMillion: nonNegativeNumber(input.inputUsdPerMillion),
    outputUsdPerMillion: nonNegativeNumber(input.outputUsdPerMillion),
    cacheReadUsdPerMillion: optionalNonNegativeNumber(input.cacheReadUsdPerMillion),
    cacheCreationUsdPerMillion: optionalNonNegativeNumber(input.cacheCreationUsdPerMillion),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  state.rules = existing ? state.rules.map(rule => rule.id === id ? next : rule) : [...state.rules, next]
  savePricingState(state)
  return next
}

export function deleteUsagePricingRule(idOrModelId: string, providerId?: string): boolean {
  const state = pricingState()
  const id = providerId ? pricingRuleId(providerId, idOrModelId) : String(idOrModelId || "")
  const before = state.rules.length
  state.rules = state.rules.filter(rule => rule.id !== id && rule.modelId !== id)
  if (state.rules.length !== before) savePricingState(state)
  return state.rules.length !== before
}

/**
 * Normalize provider-specific usage shapes into UsageTokenBreakdown.
 *
 * 委托给 `providers/client.ts` 的 `normalizeUsage`（单一权威源），再补充
 * `billableInputTokens` / `inputSurfaceTokens` / `cacheReadInputIncluded` 等
 * 统计层 derived 字段。避免双份归一逻辑漂移（P1-5 修复）。
 */
export function normalizeUsage(usage: any): UsageTokenBreakdown | null {
  const raw = normalizeUsageRaw(usage)
  if (!raw) return null
  const inputTokens = raw.input_tokens
  const outputTokens = raw.output_tokens
  const cacheReadTokens = raw.cache_read_tokens
  const cacheCreationTokens = raw.cache_creation_tokens
  const reasoningTokens = raw.reasoning_tokens
  const totalTokens = raw.total_tokens
  const cacheReadInputIncluded = cacheReadAlreadyInInput(usage)
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheCreationTokens <= 0) return null
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    billableInputTokens: cacheReadInputIncluded ? Math.max(inputTokens - cacheReadTokens, 0) : inputTokens,
    inputSurfaceTokens: inputSurfaceTokens(inputTokens, cacheReadTokens, cacheReadInputIncluded),
    cacheReadInputIncluded,
    totalTokens: totalTokens || inputTokens + outputTokens + cacheCreationTokens,
    reasoningTokens,
    modelId: normalizeOptionalString(raw.modelId) || normalizeOptionalString(usage?.model) || normalizeOptionalString(usage?.modelVersion)
  }
}

export function estimateUsageForDoneEvent(turn: WorkbenchTurn, event: RuntimeEvent): UsageTokenBreakdown {
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
  const inputTokens = estimateTokens([promptText, attachmentText].join("\n"))
  const outputTokens = estimateTokens(outputText)
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billableInputTokens: inputTokens,
    inputSurfaceTokens: inputTokens,
    totalTokens: inputTokens + outputTokens
  }
}

export function isModelUsageEvent(event: RuntimeEvent): boolean {
  if (event.kind !== "agent:done" && event.kind !== "agent:error") return false
  if (event.payload?.usageExcluded || event.payload?.synthetic) return false
  const providerId = providerIdForEvent(event).toLowerCase()
  const agentId = String(event.agentId || event.payload?.agentId || "").toLowerCase()
  if (!providerId || providerId === "system" || providerId === "terminal" || providerId === "git") return false
  if (providerId.includes("terminal") || providerId.includes("git")) return false
  if (agentId === "system" || agentId.includes("terminal") || agentId.includes("git")) return false
  return Boolean(event.agentId || event.payload?.agentId)
}

/**
 * Build usage records: ledger-first with write-through to runtime events.
 * Ledger entries survive runtime event trimming. New events not yet in the
 * ledger are computed, persisted, and merged.
 */
function buildUsageRecords(): UsageRequestRecord[] {
  const ledger = loadLedger()
  const ledgerEventIds = new Set(ledger.map(r => r.eventId))

  // Build from runtime events (same logic as before)
  const runtime = getWorkbenchRuntimeStore()
  const snapshot = runtime.snapshot(undefined)
  const turnById = new Map(snapshot.turns.map(turn => [turn.id, turn]))
  const turnIds = new Set(snapshot.turns.map(turn => turn.id))
  const events = snapshot.threads
    .flatMap(thread => runtime.eventsSince(thread.id, 0))
    .filter(event => turnIds.has(event.turnId) && isModelUsageEvent(event))
  const doneEvents = events.filter(event => event.kind === "agent:done")
  const errorEvents = events.filter(event => event.kind === "agent:error")
  const errorTurnIds = new Set(errorEvents.map(event => event.turnId))
  const actualEventIds = new Set<string>()
  const newRecords: UsageRequestRecord[] = []

  for (const event of doneEvents) {
    if (ledgerEventIds.has(event.id)) continue // already in ledger
    const usage = normalizeUsage(event.payload?.usage)
    // 闸门：过滤全 0 usage，避免上游合成空事件污染统计（参照 cc-switch parser.rs:46-51）
    if (!hasBillableTokens(usage)) continue
    const record = recordFromEvent(event, usage, "actual", turnById.get(event.turnId))
    actualEventIds.add(event.id)
    newRecords.push(record)
  }

  for (const event of doneEvents) {
    if (ledgerEventIds.has(event.id) || actualEventIds.has(event.id)) continue
    const turn = turnById.get(event.turnId)
    if (!turn) continue
    const _modelId = modelIdForEvent(event)
    const _providerId = providerIdForEvent(event)
    const estimated = estimateUsageForDoneEvent(turn, event)
    if (estimated.totalTokens <= 0) continue
    newRecords.push(recordFromEvent(event, estimated, "estimated", turn))
  }

  for (const event of errorEvents) {
    if (ledgerEventIds.has(event.id)) continue
    newRecords.push(emptyRecordFromEvent(event, turnById.get(event.turnId)))
  }

  for (const turn of snapshot.turns) {
    if (turn.status !== "cancelled" || errorTurnIds.has(turn.id)) continue
    const threadEvents = runtime.eventsSince(turn.threadId, 0)
    const event = [...threadEvents].reverse().find(item => item.turnId === turn.id && item.kind === "turn:status" && item.payload?.status === "cancelled")
    if (event && !ledgerEventIds.has(event.id)) newRecords.push(emptyRecordFromTurnStatus(event, turn))
  }

  // Write-through: persist new records to ledger, return merged
  if (newRecords.length > 0) {
    return appendLedgerEntries(newRecords)
  }
  return ledger.length > 0 ? ledger : []
}

function recordFromEvent(event: RuntimeEvent, usage: UsageTokenBreakdown, source: UsageSource, turn?: WorkbenchTurn): UsageRequestRecord {
  const providerId = providerIdForEvent(event)
  const modelId = modelIdForEvent(event, usage.modelId)
  const agentId = event.agentId || normalizeOptionalString(event.payload?.agentId)
  const priced = priceUsage(providerId, modelId, usage)
  const responsePreview = previewText(event.payload?.content || event.payload?.summary?.preview || "")
  const promptPreview = previewText(turn?.prompt || "")
  const totalTokens = usage.totalTokens || usage.inputTokens + usage.outputTokens
  const cacheReadInputIncluded = usage.cacheReadInputIncluded ?? inputIncludesCacheRead(providerId, modelId)
  return {
    id: `${event.id}:${source}`,
    eventId: event.id,
    threadId: event.threadId,
    turnId: event.turnId,
    agentId,
    providerId,
    modelId,
    requestModelId: normalizeOptionalString(event.payload?.requestModelId) || normalizeOptionalString(event.payload?.modelId) || normalizeOptionalString(turn?.modelSelection?.modelId) || modelId,
    source,
    status: "completed",
    createdAt: event.createdAt,
    latencyMs: optionalPositiveNumber(event.payload?.durationMs ?? event.payload?.latencyMs),
    firstTokenMs: optionalPositiveNumber(event.payload?.firstTokenMs),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    billableInputTokens: billableInputTokens(providerId, modelId, usage),
    inputSurfaceTokens: usage.inputSurfaceTokens ?? inputSurfaceTokens(usage.inputTokens, usage.cacheReadTokens, cacheReadInputIncluded),
    totalTokens,
    actualTokens: source === "actual" ? totalTokens : 0,
    estimatedTokens: source === "estimated" ? totalTokens : 0,
    hasEstimated: source === "estimated",
    reasoningTokens: usage.reasoningTokens,
    costUsd: priced.costUsd,
    hasUnpriced: priced.hasUnpriced,
    cacheSavingsUsd: priced.cacheSavingsUsd,
    promptPreview,
    responsePreview,
    rawUsage: source === "actual" ? event.payload?.usage : undefined
  }
}

function emptyRecordFromEvent(event: RuntimeEvent, turn?: WorkbenchTurn): UsageRequestRecord {
  const providerId = providerIdForEvent(event)
  const modelId = modelIdForEvent(event)
  const agentId = event.agentId || normalizeOptionalString(event.payload?.agentId)
  const status = event.payload?.code === "AGENT_CANCELLED" || event.payload?.status === "cancelled" ? "cancelled" : "failed"
  return {
    id: `${event.id}:none`,
    eventId: event.id,
    threadId: event.threadId,
    turnId: event.turnId,
    agentId,
    providerId,
    modelId,
    requestModelId: normalizeOptionalString(event.payload?.requestModelId) || normalizeOptionalString(event.payload?.modelId) || normalizeOptionalString(turn?.modelSelection?.modelId) || modelId,
    source: "none",
    status,
    createdAt: event.createdAt,
    latencyMs: optionalPositiveNumber(event.payload?.durationMs ?? event.payload?.latencyMs),
    firstTokenMs: optionalPositiveNumber(event.payload?.firstTokenMs),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billableInputTokens: 0,
    inputSurfaceTokens: 0,
    totalTokens: 0,
    actualTokens: 0,
    estimatedTokens: 0,
    hasEstimated: false,
    costUsd: null,
    hasUnpriced: false,
    cacheSavingsUsd: null,
    promptPreview: previewText(turn?.prompt || ""),
    responsePreview: previewText(event.payload?.content || ""),
    errorMessage: normalizeOptionalString(event.payload?.error) || normalizeOptionalString(event.payload?.message) || normalizeOptionalString(event.payload?.code)
  }
}

function emptyRecordFromTurnStatus(event: RuntimeEvent, turn: WorkbenchTurn): UsageRequestRecord {
  const providerId = turn.modelSelection?.source === "provider" && turn.modelSelection.providerId
    ? turn.modelSelection.providerId
    : "local-cli"
  const modelId = turn.modelSelection?.modelId || turn.targetAgent || "unknown"
  return {
    id: `${event.id}:none`,
    eventId: event.id,
    threadId: event.threadId,
    turnId: event.turnId,
    agentId: turn.targetAgent || (turn.modelSelection?.source === "provider" ? `provider:${turn.modelSelection.providerId}` : undefined),
    providerId,
    modelId,
    requestModelId: turn.modelSelection?.modelId || modelId,
    source: "none",
    status: "cancelled",
    createdAt: event.createdAt,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billableInputTokens: 0,
    inputSurfaceTokens: 0,
    totalTokens: 0,
    actualTokens: 0,
    estimatedTokens: 0,
    hasEstimated: false,
    costUsd: null,
    hasUnpriced: false,
    cacheSavingsUsd: null,
    promptPreview: previewText(turn.prompt || ""),
    errorMessage: normalizeOptionalString(event.payload?.error) || "cancelled"
  }
}

function filterUsageRecords(records: UsageRequestRecord[], filter: UsageRecordFilter): UsageRequestRecord[] {
  const fromRange = rangeStart(filter.range || "all")
  const from = filter.from ?? fromRange ?? null
  const to = filter.to ?? null
  const query = String(filter.query || "").trim().toLowerCase()
  const out = records.filter(record => {
    if (from && record.createdAt < from) return false
    if (to && record.createdAt > to) return false
    if (filter.providerId && record.providerId !== filter.providerId) return false
    if (filter.modelId && record.modelId !== filter.modelId) return false
    if (filter.agentId && record.agentId !== filter.agentId) return false
    if (filter.source && filter.source !== "all" && record.source !== filter.source) return false
    if (filter.status && filter.status !== "all" && record.status !== filter.status) return false
    if (query) {
      const haystack = [
        record.providerId,
        record.modelId,
        record.agentId,
        record.promptPreview,
        record.responsePreview
      ].filter(Boolean).join(" ").toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
  const sortBy = filter.sortBy || "createdAt"
  const dir = filter.sortDir === "asc" ? 1 : -1
  return out.sort((a, b) => {
    const av = sortBy === "tokens" ? a.totalTokens : sortBy === "cost" ? (a.costUsd ?? -1) : sortBy === "latencyMs" ? (a.latencyMs ?? -1) : a.createdAt
    const bv = sortBy === "tokens" ? b.totalTokens : sortBy === "cost" ? (b.costUsd ?? -1) : sortBy === "latencyMs" ? (b.latencyMs ?? -1) : b.createdAt
    return (av - bv) * dir
  })
}

function turnsForUsageRecords(records: UsageRequestRecord[]): WorkbenchTurn[] {
  if (records.length === 0) return []
  const turnIds = new Set(records.map(record => record.turnId))
  const runtime = getWorkbenchRuntimeStore()
  const snapshot = runtime.snapshot(undefined)
  return snapshot.turns.filter(turn => turnIds.has(turn.id))
}

function usageTokensByTurn(records: UsageRequestRecord[]): Map<string, UsageBucket> {
  const map = new Map<string, UsageBucket>()
  for (const record of records) {
    const prev = map.get(record.turnId) || emptyUsageBucket()
    map.set(record.turnId, addRecordToBucket(prev, record))
  }
  return map
}

function modelRows(records: UsageRequestRecord[]): UsageModelRow[] {
  const rows = new Map<string, UsageBucket & { modelId: string; providerId?: string; agentId?: string }>()
  for (const record of records) {
    const key = `${record.providerId || "provider"}:${record.agentId || "agent"}:${record.modelId}`
    const row = rows.get(key) || { ...emptyUsageBucket(), modelId: record.modelId, providerId: record.providerId, agentId: record.agentId }
    addRecordToBucket(row, record)
    rows.set(key, row)
  }
  return [...rows.values()]
    .map(bucketToModelRow)
    .sort((a, b) => b.tokens - a.tokens)
}

function providerRows(records: UsageRequestRecord[]): UsageProviderRow[] {
  const rows = new Map<string, UsageBucket & { providerId: string }>()
  for (const record of records) {
    const row = rows.get(record.providerId) || { ...emptyUsageBucket(), providerId: record.providerId }
    addRecordToBucket(row, record)
    rows.set(record.providerId, row)
  }
  return [...rows.values()]
    .map(bucketToProviderRow)
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
    mergeBucket(cur, turnUsage)
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
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      cacheReadTokens: value.cacheReadTokens,
      cacheCreationTokens: value.cacheCreationTokens,
      cacheSavingsTokens: value.cacheSavingsTokens,
      cacheSavingsUsd: value.cacheSavingsUsd,
      costUsd: value.costUsd,
      hasUnpriced: value.hasUnpriced,
      level: heatLevel(value.tokens, value.turns, maxTokens),
      selected: i === 0
    })
  }
  return out
}

function bucketToModelRow(bucket: UsageBucket & { modelId: string; providerId?: string; agentId?: string }): UsageModelRow {
  return {
    modelId: bucket.modelId,
    providerId: bucket.providerId,
    agentId: bucket.agentId,
    turns: bucket.turnIds.size,
    requests: bucket.requests,
    tokens: bucket.tokens,
    actualTokens: bucket.actualTokens,
    estimatedTokens: bucket.estimatedTokens,
    hasEstimated: bucket.hasEstimated,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheCreationTokens: bucket.cacheCreationTokens,
    cacheSavingsTokens: bucket.cacheSavingsTokens,
    cacheSavingsUsd: bucket.cacheSavingsUsd,
    costUsd: bucket.costUsd,
    hasUnpriced: bucket.hasUnpriced
  }
}

function bucketToProviderRow(bucket: UsageBucket & { providerId: string }): UsageProviderRow {
  return {
    providerId: bucket.providerId,
    turns: bucket.turnIds.size,
    requests: bucket.requests,
    tokens: bucket.tokens,
    actualTokens: bucket.actualTokens,
    estimatedTokens: bucket.estimatedTokens,
    hasEstimated: bucket.hasEstimated,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheCreationTokens: bucket.cacheCreationTokens,
    cacheSavingsTokens: bucket.cacheSavingsTokens,
    cacheSavingsUsd: bucket.cacheSavingsUsd,
    costUsd: bucket.costUsd,
    hasUnpriced: bucket.hasUnpriced
  }
}

function addRecordToBucket<T extends UsageBucket>(bucket: T, record: UsageRequestRecord): T {
  bucket.tokens += record.totalTokens
  bucket.actualTokens += record.actualTokens
  bucket.estimatedTokens += record.estimatedTokens
  bucket.hasEstimated = bucket.hasEstimated || record.hasEstimated
  bucket.inputTokens += record.inputTokens
  bucket.outputTokens += record.outputTokens
  bucket.cacheReadTokens += record.cacheReadTokens
  bucket.cacheCreationTokens += record.cacheCreationTokens
  bucket.cacheSavingsTokens += record.cacheReadTokens
  bucket.billableInputTokens += record.billableInputTokens
  bucket.inputSurfaceTokens += record.inputSurfaceTokens ?? inputSurfaceTokens(record.inputTokens, record.cacheReadTokens, inputIncludesCacheRead(record.providerId, record.modelId))
  bucket.requests += 1
  bucket.turnIds.add(record.turnId)
  if (record.costUsd == null && record.hasUnpriced && record.totalTokens > 0) {
    bucket.hasUnpriced = true
  }
  if (record.costUsd != null) {
    bucket.costUsd = (bucket.costUsd ?? 0) + record.costUsd
  }
  // 累加节省金额；cacheSavingsUsd 为 null 表示该模型未定价，跳过
  if (record.cacheSavingsUsd != null) {
    bucket.cacheSavingsUsd = (bucket.cacheSavingsUsd ?? 0) + record.cacheSavingsUsd
  }
  return bucket
}

function mergeBucket<T extends UsageBucket>(target: T, source: UsageBucket): T {
  target.tokens += source.tokens
  target.actualTokens += source.actualTokens
  target.estimatedTokens += source.estimatedTokens
  target.hasEstimated = target.hasEstimated || source.hasEstimated
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheCreationTokens += source.cacheCreationTokens
  target.cacheSavingsTokens += source.cacheSavingsTokens
  target.billableInputTokens += source.billableInputTokens
  target.inputSurfaceTokens += source.inputSurfaceTokens
  target.requests += source.requests
  for (const turnId of source.turnIds) target.turnIds.add(turnId)
  if (source.hasUnpriced) target.hasUnpriced = true
  if (source.costUsd != null) target.costUsd = (target.costUsd ?? 0) + source.costUsd
  if (source.cacheSavingsUsd != null) target.cacheSavingsUsd = (target.cacheSavingsUsd ?? 0) + source.cacheSavingsUsd
  return target
}

function emptyUsageBucket(): UsageBucket {
  return {
    tokens: 0,
    actualTokens: 0,
    estimatedTokens: 0,
    hasEstimated: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheSavingsTokens: 0,
    cacheSavingsUsd: null,
    billableInputTokens: 0,
    inputSurfaceTokens: 0,
    costUsd: null,
    hasUnpriced: false,
    requests: 0,
    turnIds: new Set<string>()
  }
}

function priceUsage(providerId: string, modelId: string, usage: UsageTokenBreakdown): { costUsd: number | null; hasUnpriced: boolean; cacheSavingsUsd: number | null } {
  const rule = findPricingRule(providerId, modelId)
  if (!rule) return { costUsd: null, hasUnpriced: true, cacheSavingsUsd: null }
  const billableInput = billableInputTokens(providerId, modelId, usage)
  const cacheReadPrice = rule.cacheReadUsdPerMillion ?? 0
  const cacheCreationPrice = rule.cacheCreationUsdPerMillion ?? rule.inputUsdPerMillion
  const costUsd =
    billableInput / 1_000_000 * rule.inputUsdPerMillion +
    usage.outputTokens / 1_000_000 * rule.outputUsdPerMillion +
    usage.cacheReadTokens / 1_000_000 * cacheReadPrice +
    usage.cacheCreationTokens / 1_000_000 * cacheCreationPrice
  // 节省金额 = cacheReadTokens × (inputPrice - cacheReadPrice) / 1M
  // 语义：缓存命中的 token 若按完整 input 价计费会多花多少，即为节省金额
  const cacheSavingsUsd = usage.cacheReadTokens > 0
    ? usage.cacheReadTokens / 1_000_000 * Math.max(rule.inputUsdPerMillion - cacheReadPrice, 0)
    : 0
  return { costUsd, hasUnpriced: false, cacheSavingsUsd }
}

/**
 * Billable tokens 闸门：参照 cc-switch parser.rs:46-51 has_billable_tokens。
 * 全 0 usage 不应进入统计，避免上游合成空事件污染。
 */
function hasBillableTokens(usage: UsageTokenBreakdown | null | undefined): usage is UsageTokenBreakdown {
  if (!usage) return false
  return usage.totalTokens > 0
    || usage.inputTokens > 0
    || usage.outputTokens > 0
    || usage.cacheReadTokens > 0
    || usage.cacheCreationTokens > 0
}

function billableInputTokens(providerId: string, modelId: string, usage: UsageTokenBreakdown): number {
  const explicit = Number(usage.billableInputTokens)
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit)
  const cacheReadInputIncluded = usage.cacheReadInputIncluded ?? inputIncludesCacheRead(providerId, modelId)
  if (cacheReadInputIncluded) return Math.max(usage.inputTokens - usage.cacheReadTokens, 0)
  return usage.inputTokens
}

/**
 * 判断 cacheRead 是否已含于 input_tokens 中。
 *
 * Anthropic/Claude：input_tokens 不含 cache_read，cache_read 单独计费 → false
 * OpenAI/Codex/GPT：prompt_tokens_details.cached_tokens 是 prompt_tokens 的子集 → true
 * Gemini：cachedContentTokenCount 是 promptTokenCount 的子集 → true
 * DeepSeek：prompt_tokens_details.cached_tokens 已含于 prompt_tokens → true
 * OpenRouter：上游响应已含 cache 字段子集 → true
 * 本地 CLI：协议未统一，保守按 false 处理（避免漏算 billable）
 *
 * 注意：优先使用 usage.cacheReadInputIncluded（由 normalizeUsage 通过
 * cacheReadAlreadyInInput(raw) 设置），仅在该字段缺失时回退到本函数。
 */
function inputIncludesCacheRead(providerId: string, modelId: string): boolean {
  const key = `${providerId} ${modelId}`.toLowerCase()
  // Anthropic/Claude 系列：cache_read 不含于 input
  if (key.includes("anthropic") || key.includes("claude")) return false
  // OpenAI/Codex/GPT 系列：cache_read 含于 prompt_tokens
  if (key.includes("openai") || key.includes("codex") || key.includes("gpt") || key.includes("o1") || key.includes("o3") || key.includes("o4")) return true
  // Google Gemini 系列
  if (key.includes("gemini") || key.includes("google") || key.includes("palm") || key.includes("bard")) return true
  // DeepSeek
  if (key.includes("deepseek")) return true
  // OpenRouter（上游响应已含 cache 字段子集）
  if (key.includes("openrouter")) return true
  // Moonshot/Kimi
  if (key.includes("moonshot") || key.includes("kimi")) return true
  // 智谱 GLM
  if (key.includes("zhipu") || key.includes("glm")) return true
  // 通义千问 Qwen
  if (key.includes("qwen") || key.includes("tongyi") || key.includes("dashscope")) return true
  // MiniMax
  if (key.includes("minimax")) return true
  // Hunyuan
  if (key.includes("hunyuan") || key.includes("tencent")) return true
  // API provider 直连（默认 OpenAI 兼容协议）
  if (key.includes("provider:")) return true
  // 本地 CLI 未知，保守按 false 处理
  return false
}

/**
 * 查找价格规则，参照 cc-switch usage_stats.rs:2018-2042 的候选降级机制。
 *
 * 匹配优先级（BFS 式降级）：
 * 1. 精确匹配 (providerId + modelId) 或 (undefined providerId + modelId)
 * 2. 剥离日期后缀 -YYYY-MM-DD / -YYYYMMDD 后重试
 * 3. 剥离 reasoning effort 后缀 (-high/-medium/-low/-minimal/-xhigh)
 * 4. 去掉 vendor 命名空间前缀 (anthropic/ → claude-xxx)
 * 5. 前缀匹配 (rule.modelId.startsWith(candidate + "-"))
 *
 * 这解决了 binding 用 `claude-sonnet-4-5` 而 API 返回 `claude-sonnet-4-5-20250929`
 * 导致定价找不到的根因问题。
 */
function findPricingRule(providerId: string, modelId: string): UsagePricingRule | undefined {
  const rules = pricingState().rules
  const tryMatch = (id: string): UsagePricingRule | undefined =>
    rules.find(rule => rule.providerId === providerId && rule.modelId === id)
    || rules.find(rule => !rule.providerId && rule.modelId === id)

  // 1. 精确匹配
  const exact = tryMatch(modelId)
  if (exact) return exact

  // 2. 生成候选列表
  const candidates: string[] = [modelId]
  let current = modelId

  // 剥离日期后缀：-YYYY-MM-DD 或 -YYYYMMDD（参照 cc-switch strip_model_date_suffix）
  const strippedDate = current.replace(/-(\d{4})-(\d{2})-(\d{2})$/, "")
  if (strippedDate !== current && strippedDate.length > 0) {
    candidates.push(strippedDate)
    current = strippedDate
  }
  const strippedCompact = current.replace(/-(\d{8})$/, (m, d) => /^\d{8}$/.test(d) ? "" : m)
  if (strippedCompact !== current && strippedCompact.length > 0) {
    candidates.push(strippedCompact)
    current = strippedCompact
  }

  // 剥离 reasoning effort 后缀
  const strippedEffort = current.replace(/-(?:high|medium|low|minimal|xhigh)$/, "")
  if (strippedEffort !== current && strippedEffort.length > 0) {
    candidates.push(strippedEffort)
    current = strippedEffort
  }

  // 去掉 vendor 命名空间前缀（如 anthropic/claude-sonnet-4-5 → claude-sonnet-4-5）
  const ns = current.split("/").pop()
  if (ns && ns !== current) candidates.push(ns)

  // 3. 按候选逐一精确匹配
  for (const candidate of candidates) {
    if (candidate === modelId) continue // 已试过
    const hit = tryMatch(candidate)
    if (hit) return hit
  }

  // 4. 前缀匹配（LIKE 'model-%' 兜底）：当 pricing 表有 claude-sonnet-4-5 而请求是 claude-sonnet-4-5-20250929 时命中
  for (const candidate of candidates) {
    const prefixHit = rules.find(
      rule => !rule.providerId &&
        (rule.modelId === candidate || rule.modelId.startsWith(candidate + "-"))
    )
    if (prefixHit) return prefixHit
  }

  return undefined
}

function pricingState(): PricingState {
  const raw = store.get(PRICING_KEY)
  if (raw && typeof raw === "object" && Array.isArray((raw as any).rules)) {
    return {
      version: 1,
      rules: (raw as any).rules
        .map(normalizePricingRule)
        .filter((rule: UsagePricingRule | null): rule is UsagePricingRule => Boolean(rule))
    }
  }
  // 首次启动或老版本：注入默认价格表 seed
  // 用户后续可在 UsageStatsDashboard 的 pricing tab 编辑/删除
  if (!store.get(PRICING_SEEDED_KEY)) {
    const seeded = seedDefaultPricing()
    store.set(PRICING_SEEDED_KEY, true)
    return { version: 1, rules: seeded }
  }
  return { version: 1, rules: [] }
}

/**
 * 把 DEFAULT_PRICING_RULES 注入到 pricing store，返回注入后的规则列表。
 * 用户已自定义的规则（如果存在残留）会保留。
 */
function seedDefaultPricing(): UsagePricingRule[] {
  const now = Date.now()
  const existingRaw = store.get(PRICING_KEY)
  const existingRules: UsagePricingRule[] =
    existingRaw && typeof existingRaw === "object" && Array.isArray((existingRaw as any).rules)
      ? (existingRaw as any).rules.map(normalizePricingRule).filter(Boolean)
      : []
  const existingIds = new Set(existingRules.map(rule => rule.id))
  const existingModelIds = new Set(existingRules.map(rule => rule.modelId))
  const toAdd: UsagePricingRule[] = []
  for (const entry of DEFAULT_PRICING_RULES) {
    const id = pricingRuleId(undefined, entry.modelId)
    if (existingIds.has(id) || existingModelIds.has(entry.modelId)) continue
    toAdd.push({
      id,
      providerId: undefined,
      modelId: entry.modelId,
      displayName: entry.displayName,
      inputUsdPerMillion: entry.inputUsdPerMillion,
      outputUsdPerMillion: entry.outputUsdPerMillion,
      cacheReadUsdPerMillion: entry.cacheReadUsdPerMillion || undefined,
      cacheCreationUsdPerMillion: entry.cacheCreationUsdPerMillion || undefined,
      createdAt: now,
      updatedAt: now
    })
  }
  // 同时注入无日期后缀别名（确保 claude-sonnet-4-5 等短名也能精确匹配）
  for (const entry of DEFAULT_PRICING_ALIASES) {
    const id = pricingRuleId(undefined, entry.modelId)
    if (existingIds.has(id) || existingModelIds.has(entry.modelId)) continue
    toAdd.push({
      id,
      providerId: undefined,
      modelId: entry.modelId,
      displayName: entry.displayName,
      inputUsdPerMillion: entry.inputUsdPerMillion,
      outputUsdPerMillion: entry.outputUsdPerMillion,
      cacheReadUsdPerMillion: entry.cacheReadUsdPerMillion || undefined,
      cacheCreationUsdPerMillion: entry.cacheCreationUsdPerMillion || undefined,
      createdAt: now,
      updatedAt: now
    })
  }
  const merged = [...existingRules, ...toAdd]
  savePricingState({ version: 1, rules: merged })
  return merged
}

function savePricingState(state: PricingState): void {
  store.set(PRICING_KEY, { version: 1, rules: state.rules })
}

function normalizePricingRule(raw: any): UsagePricingRule | null {
  if (!raw || typeof raw !== "object" || !raw.modelId) return null
  const providerId = normalizeOptionalString(raw.providerId)
  const modelId = String(raw.modelId)
  const now = Date.now()
  return {
    id: normalizeOptionalString(raw.id) || pricingRuleId(providerId, modelId),
    providerId,
    modelId,
    displayName: normalizeOptionalString(raw.displayName),
    inputUsdPerMillion: nonNegativeNumber(raw.inputUsdPerMillion),
    outputUsdPerMillion: nonNegativeNumber(raw.outputUsdPerMillion),
    cacheReadUsdPerMillion: optionalNonNegativeNumber(raw.cacheReadUsdPerMillion),
    cacheCreationUsdPerMillion: optionalNonNegativeNumber(raw.cacheCreationUsdPerMillion),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now
  }
}

function pricingRuleId(providerId: string | undefined, modelId: string): string {
  return `${providerId || "any"}:${modelId}`
}

function providerIdForEvent(event: RuntimeEvent): string {
  const explicit = normalizeOptionalString(event.payload?.providerId)
  if (explicit) return explicit
  const agentId = normalizeOptionalString(event.agentId || event.payload?.agentId)
  if (agentId?.startsWith("provider:")) return agentId.slice("provider:".length)
  return "local-cli"
}

function modelIdForEvent(event: RuntimeEvent, usageModelId?: string): string {
  return String(usageModelId || event.payload?.modelId || event.payload?.requestModelId || "unknown")
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

function cacheRate(bucket: UsageBucket): number | null {
  if (bucket.inputTokens <= 0 && bucket.cacheReadTokens <= 0) return null
  const totalInputSurface = bucket.inputSurfaceTokens || inputSurfaceTokens(bucket.inputTokens, bucket.cacheReadTokens, false)
  return totalInputSurface > 0 ? bucket.cacheReadTokens / totalInputSurface : null
}

function inputSurfaceTokens(inputTokens: number, cacheReadTokens: number, cacheReadInputIncluded: boolean): number {
  return cacheReadInputIncluded ? Math.max(inputTokens, cacheReadTokens) : inputTokens + cacheReadTokens
}

/**
 * Estimate token count with CJK-aware counting.
 * CJK characters are ~1.5 tokens each (GPT/Claude tokenizers), not 0.25
 * as the naive chars/4 would suggest. ASCII text remains ~4 chars/token.
 */
function estimateTokens(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized.length) return 0
  const cjkChars = (normalized.match(/[一-鿿぀-ゟ゠-ヿ가-힯]/g) || []).length
  const asciiChars = normalized.length - cjkChars
  return Math.ceil(cjkChars * 1.5 + asciiChars / CHARS_PER_TOKEN)
}

function previewText(value: any): string | undefined {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""
  return text ? text.slice(0, 240) : undefined
}

function cacheReadAlreadyInInput(raw: any): boolean {
  const original = raw?.raw && typeof raw.raw === "object" ? raw.raw : raw
  return Boolean(
    original?.prompt_tokens_details?.cached_tokens != null ||
    original?.input_tokens_details?.cached_tokens != null ||
    original?.inputTokensDetails?.cachedTokens != null ||
    original?.cachedContentTokenCount != null ||
    original?.cached_content_token_count != null
  )
}

function nonNegativeNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function optionalNonNegativeNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  return nonNegativeNumber(value)
}

function optionalPositiveNumber(value: any): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function normalizeOptionalString(value: any): string | undefined {
  const text = typeof value === "string" ? value.trim() : ""
  return text || undefined
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
