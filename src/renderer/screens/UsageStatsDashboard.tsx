import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { IC, Icon, Seg } from '../glass/ui'

type UsageTab = 'overview' | 'requests' | 'providers' | 'models' | 'pricing'

const RANGE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '90d', label: '90 days' },
  { value: '30d', label: '30 days' },
  { value: '7d', label: '7 days' }
]

const TAB_OPTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'requests', label: 'Requests' },
  { value: 'providers', label: 'Providers' },
  { value: 'models', label: 'Models' },
  { value: 'pricing', label: 'Pricing' }
]

const EMPTY_DRAFT = {
  providerId: '',
  modelId: '',
  displayName: '',
  inputUsdPerMillion: '',
  outputUsdPerMillion: '',
  cacheReadUsdPerMillion: '',
  cacheCreationUsdPerMillion: ''
}

export function UsageStatsDashboard() {
  const [range, setRange] = useState<UsageRange>('all')
  const [tab, setTab] = useState<UsageTab>('overview')
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [records, setRecords] = useState<PaginatedUsageRecords | null>(null)
  const [facetRecords, setFacetRecords] = useState<UsageRequestRecord[]>([])
  const [pricing, setPricing] = useState<UsagePricingRule[]>([])
  const [selectedDay, setSelectedDay] = useState<UsageHeatmapDay | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<UsageRequestRecord | null>(null)
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | UsageSource>('all')
  const [status, setStatus] = useState<'all' | UsageRequestRecord['status']>('all')
  const [threadId, setThreadId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestFilter = useMemo<UsageRecordFilter>(() => ({
    range,
    ...(threadId.trim() ? { threadId: threadId.trim() } : {}),
    ...(providerId.trim() ? { providerId: providerId.trim() } : {}),
    ...(modelId.trim() ? { modelId: modelId.trim() } : {}),
    ...(agentId.trim() ? { agentId: agentId.trim() } : {}),
    source,
    status,
    query,
    sortBy: 'createdAt',
    sortDir: 'desc'
  }), [agentId, modelId, providerId, query, range, source, status, threadId])

  const loadStats = useCallback(async () => {
    const next = await window.electronAPI.usage.stats(range, tab)
    setStats(next)
    setSelectedDay(current => {
      if (current && next.heatmap.some(day => day.date === current.date)) {
        return next.heatmap.find(day => day.date === current.date) || current
      }
      return next.heatmap.find(day => day.selected) || next.heatmap.find(day => day.turns > 0 || day.tokens > 0) || next.heatmap.at(-1) || null
    })
    setSelectedModelKey(current => {
      if (current && next.models.some(row => usageModelKey(row) === current)) return current
      return next.models[0] ? usageModelKey(next.models[0]) : null
    })
  }, [range, tab])

  const loadRecords = useCallback(async () => {
    const next = await window.electronAPI.usage.records(requestFilter, page, 25)
    setRecords(next)
    setSelectedRecord(current => {
      if (current && next.records.some(record => record.id === current.id)) return current
      return next.records[0] || null
    })
  }, [page, requestFilter])

  const loadFacets = useCallback(async () => {
    const next = await window.electronAPI.usage.records({ range, sortBy: 'createdAt', sortDir: 'desc' }, 1, 200)
    setFacetRecords(next.records)
  }, [range])

  const loadPricing = useCallback(async () => {
    setPricing(await window.electronAPI.usage.pricingList())
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await loadStats()
      await loadFacets()
      if (tab === 'requests') await loadRecords()
      if (tab === 'pricing') await loadPricing()
    } catch (err: any) {
      setError(err?.message || 'Failed to load usage statistics.')
    } finally {
      setLoading(false)
    }
  }, [loadFacets, loadPricing, loadRecords, loadStats, tab])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 220)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    setPage(1)
  }, [agentId, modelId, providerId, query, range, source, status, threadId])

  const selectedModel = stats?.models.find(row => usageModelKey(row) === selectedModelKey) || null
  const providerOptions = useMemo(() => uniqueStrings([
    ...(stats?.providers.map(row => row.providerId) || []),
    ...facetRecords.map(record => record.providerId)
  ]), [facetRecords, stats])
  const modelOptions = useMemo(() => uniqueStrings([
    ...(stats?.models.map(row => row.modelId) || []),
    ...facetRecords.map(record => record.modelId)
  ]), [facetRecords, stats])
  const agentOptions = useMemo(() => uniqueStrings(facetRecords.map(record => record.agentId || '')), [facetRecords])
  const threadOptions = useMemo(() => uniqueStrings(facetRecords.map(record => record.threadId)), [facetRecords])

  const cards = useMemo(() => stats ? [
    { label: 'Actual tokens', value: formatToken(stats.actualTokens), hint: stats.hasEstimated ? `Plus estimated ${formatToken(stats.estimatedTokens)}` : 'Only reported usage' },
    { label: 'Estimated tokens', value: stats.estimatedTokens > 0 ? `~${formatToken(stats.estimatedTokens)}` : '0 tokens', hint: stats.hasEstimated ? 'Estimated for local CLI or ACP runs' : 'No estimated usage' },
    { label: 'Input / output', value: `${compactToken(stats.inputTokens)} / ${compactToken(stats.outputTokens)}`, hint: 'Prompt and completion tokens' },
    { label: 'Cache read', value: stats.cacheReadTokens > 0 ? compactToken(stats.cacheReadTokens) : '0', hint: stats.cacheRate == null ? 'No cache data yet' : `${Math.round(stats.cacheRate * 100)}% cache` },
    { label: 'Cost', value: formatCost(stats.costUsd, stats.hasUnpriced), hint: stats.hasUnpriced ? 'Some models are unpriced' : 'Calculated from local pricing rules' },
    { label: 'Requests', value: String(stats.requests), hint: `${stats.activeDays} active days` }
  ] : [], [stats])

  const upsertPricing = async () => {
    if (!draft.modelId.trim()) return
    try {
      await window.electronAPI.usage.pricingUpsert({
        providerId: draft.providerId.trim() || undefined,
        modelId: draft.modelId.trim(),
        displayName: draft.displayName.trim() || undefined,
        inputUsdPerMillion: Number(draft.inputUsdPerMillion || 0),
        outputUsdPerMillion: Number(draft.outputUsdPerMillion || 0),
        cacheReadUsdPerMillion: draft.cacheReadUsdPerMillion === '' ? undefined : Number(draft.cacheReadUsdPerMillion),
        cacheCreationUsdPerMillion: draft.cacheCreationUsdPerMillion === '' ? undefined : Number(draft.cacheCreationUsdPerMillion)
      })
      setDraft(EMPTY_DRAFT)
      await loadPricing()
      await loadStats()
    } catch (err: any) {
      setError(err?.message || 'Failed to save pricing rule.')
    }
  }

  const editPricing = (rule: UsagePricingRule) => {
    setDraft({
      providerId: rule.providerId || '',
      modelId: rule.modelId,
      displayName: rule.displayName || '',
      inputUsdPerMillion: String(rule.inputUsdPerMillion ?? ''),
      outputUsdPerMillion: String(rule.outputUsdPerMillion ?? ''),
      cacheReadUsdPerMillion: rule.cacheReadUsdPerMillion == null ? '' : String(rule.cacheReadUsdPerMillion),
      cacheCreationUsdPerMillion: rule.cacheCreationUsdPerMillion == null ? '' : String(rule.cacheCreationUsdPerMillion)
    })
  }

  const deletePricing = async (rule: UsagePricingRule) => {
    try {
      await window.electronAPI.usage.pricingDelete(rule.id)
      await loadPricing()
      await loadStats()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete pricing rule.')
    }
  }

  const clearAttributionFilters = () => {
    setThreadId('')
    setProviderId('')
    setModelId('')
    setAgentId('')
    setQuery('')
    setSource('all')
    setStatus('all')
  }

  return (
    <div className="wb-usage-shell wb-usage-dashboard">
      <div className="wb-usage-top">
        <Seg value={tab} onChange={value => setTab(value as UsageTab)} options={TAB_OPTIONS} />
        <div className="wb-usage-actions">
          <Seg value={range} onChange={value => setRange(value as UsageRange)} options={RANGE_OPTIONS} />
          <button className="ah-btn sm" onClick={refresh} disabled={loading} title="Refresh">
            <Icon d={IC.refresh} size={14} />
            Refresh
          </button>
        </div>
      </div>

      {loading && <div className="wb-usage-state">Loading...</div>}
      {error && <div className="wb-usage-state error">{error}</div>}

      {!error && stats && (
        <>
          {tab === 'overview' && (
            <>
              <div className="wb-usage-cards">
                {cards.map(card => (
                  <div key={card.label} className="wb-usage-card">
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <small>{card.hint}</small>
                  </div>
                ))}
              </div>
              <div className="wb-usage-body">
                <div className="wb-usage-chart">
                  <div className="wb-usage-heatmap">
                    {stats.heatmap.map(day => (
                      <button
                        key={day.date}
                        type="button"
                        className={`wb-usage-day level-${day.level}${selectedDay?.date === day.date ? ' selected' : ''}`}
                        title={`${day.date} / ${day.turns} turns / ${formatUsageTokens(day.tokens, day.hasEstimated)}`}
                        onClick={() => setSelectedDay(day)}
                      />
                    ))}
                  </div>
                </div>
                <UsageDetailCard
                  title={selectedDay?.date || 'No day selected'}
                  rows={[
                    ['Requests', String(selectedDay?.turns || 0)],
                    ['Total', formatUsageTokens(selectedDay?.tokens || 0, selectedDay?.hasEstimated)],
                    ['Input', formatToken(selectedDay?.inputTokens || 0)],
                    ['Output', formatToken(selectedDay?.outputTokens || 0)],
                    ['Cache', formatToken(selectedDay?.cacheReadTokens || 0)],
                    ['Cost', formatCost(selectedDay?.costUsd ?? null, selectedDay?.hasUnpriced)]
                  ]}
                />
              </div>
            </>
          )}

          {tab === 'requests' && (
            <div className="wb-usage-wide">
              <div className="wb-usage-filter-row">
                <input className="ah-input" placeholder="Search provider, model, agent, thread, or preview" value={query} onChange={event => setQuery(event.target.value)} />
                <select className="ah-select" value={source} onChange={event => setSource(event.target.value as any)}>
                  <option value="all">All sources</option>
                  <option value="actual">Actual usage</option>
                  <option value="estimated">Estimated usage</option>
                  <option value="none">No tokens</option>
                </select>
                <select className="ah-select" value={status} onChange={event => setStatus(event.target.value as any)}>
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="wb-usage-filter-row">
                <FilterInput label="Thread" value={threadId} onChange={setThreadId} options={threadOptions} />
                <FilterInput label="Provider" value={providerId} onChange={setProviderId} options={providerOptions} />
                <FilterInput label="Model" value={modelId} onChange={setModelId} options={modelOptions} />
                <FilterInput label="Agent" value={agentId} onChange={setAgentId} options={agentOptions} />
                <button className="ah-btn sm" onClick={clearAttributionFilters}>Clear</button>
              </div>
              <div className="wb-usage-request-layout">
                <div className="wb-usage-table">
                  {(records?.records || []).map(record => (
                    <button key={record.id} className={'wb-usage-row' + (selectedRecord?.id === record.id ? ' selected' : '')} onClick={() => setSelectedRecord(record)}>
                      <span>{formatDateTime(record.createdAt)}</span>
                      <strong>{record.providerId} / {record.modelId}</strong>
                      <span>{record.agentId || '-'}</span>
                      <span>{formatUsageTokens(record.totalTokens, record.hasEstimated)}</span>
                      <span>{formatCost(record.costUsd, record.hasUnpriced)}</span>
                    </button>
                  ))}
                  {records && records.records.length === 0 && <div className="wb-usage-empty">No request records match the current filters.</div>}
                </div>
                <UsageDetailCard
                  title={selectedRecord ? `${selectedRecord.providerId} / ${selectedRecord.modelId}` : 'No request selected'}
                  rows={selectedRecord ? [
                    ['Time', formatDateTime(selectedRecord.createdAt)],
                    ['Thread', selectedRecord.threadId],
                    ['Turn', selectedRecord.turnId],
                    ['Agent', selectedRecord.agentId || '-'],
                    ['Status', selectedRecord.status],
                    ['Source', selectedRecord.source === 'estimated' ? 'Estimated' : selectedRecord.source === 'none' ? 'No tokens' : 'Actual'],
                    ['Input', formatToken(selectedRecord.inputTokens)],
                    ['Output', formatToken(selectedRecord.outputTokens)],
                    ['Cache read', formatToken(selectedRecord.cacheReadTokens)],
                    ['Cache write', formatToken(selectedRecord.cacheCreationTokens)],
                    ['Latency', selectedRecord.latencyMs == null ? '-' : `${selectedRecord.latencyMs}ms`],
                    ['Cost', formatCost(selectedRecord.costUsd, selectedRecord.hasUnpriced)]
                  ] : []}
                  preview={selectedRecord?.errorMessage || selectedRecord?.responsePreview || selectedRecord?.promptPreview}
                />
              </div>
              {records && records.total > records.pageSize && (
                <div className="wb-usage-pager">
                  <button className="ah-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <span>{page} / {Math.ceil(records.total / records.pageSize)}</span>
                  <button className="ah-btn sm" disabled={page >= Math.ceil(records.total / records.pageSize)} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {tab === 'providers' && (
            <RankList
              empty="No provider usage yet."
              rows={stats.providers.map(row => ({
                key: row.providerId,
                title: row.providerId,
                meta: `${row.requests} requests / ${row.turns} turns`,
                tokens: row.tokens,
                estimated: row.hasEstimated,
                cost: row.costUsd,
                unpriced: row.hasUnpriced,
                detail: `${compactToken(row.inputTokens)} input / ${compactToken(row.outputTokens)} output / ${compactToken(row.cacheReadTokens)} cache`
              }))}
            />
          )}

          {tab === 'models' && (
            <div className="wb-usage-body">
              <RankList
                empty="No model usage yet."
                selectedKey={selectedModelKey}
                onSelect={setSelectedModelKey}
                rows={stats.models.map(row => ({
                  key: usageModelKey(row),
                  title: row.modelId,
                  meta: `${row.providerId || '-'} / ${row.agentId || '-'}`,
                  tokens: row.tokens,
                  estimated: row.hasEstimated,
                  cost: row.costUsd,
                  unpriced: row.hasUnpriced,
                  detail: `${row.requests} requests / ${compactToken(row.inputTokens)} input / ${compactToken(row.outputTokens)} output`
                }))}
              />
              <UsageDetailCard
                title={selectedModel?.modelId || 'No model selected'}
                rows={selectedModel ? [
                  ['Provider', selectedModel.providerId || '-'],
                  ['Agent', selectedModel.agentId || '-'],
                  ['Requests', String(selectedModel.requests)],
                  ['Actual', formatToken(selectedModel.actualTokens)],
                  ['Estimated', selectedModel.estimatedTokens ? `~${formatToken(selectedModel.estimatedTokens)}` : '0 tokens'],
                  ['Cache', formatToken(selectedModel.cacheReadTokens)],
                  ['Cost', formatCost(selectedModel.costUsd, selectedModel.hasUnpriced)]
                ] : []}
              />
            </div>
          )}

          {tab === 'pricing' && (
            <div className="wb-usage-wide">
              <div className="wb-pricing-form">
                <input className="ah-input" placeholder="Provider, optional" value={draft.providerId} onChange={event => setDraft({ ...draft, providerId: event.target.value })} />
                <input className="ah-input" placeholder="Model ID" value={draft.modelId} onChange={event => setDraft({ ...draft, modelId: event.target.value })} />
                <input className="ah-input" placeholder="Display name, optional" value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder="Input $/1M" value={draft.inputUsdPerMillion} onChange={event => setDraft({ ...draft, inputUsdPerMillion: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder="Output $/1M" value={draft.outputUsdPerMillion} onChange={event => setDraft({ ...draft, outputUsdPerMillion: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder="Cache read $/1M" value={draft.cacheReadUsdPerMillion} onChange={event => setDraft({ ...draft, cacheReadUsdPerMillion: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder="Cache write $/1M" value={draft.cacheCreationUsdPerMillion} onChange={event => setDraft({ ...draft, cacheCreationUsdPerMillion: event.target.value })} />
                <button className="ah-btn sm primary" onClick={upsertPricing} disabled={!draft.modelId.trim()}>Save pricing</button>
              </div>
              <div className="wb-usage-table">
                {pricing.map(rule => (
                  <div key={rule.id} className="wb-usage-row wb-pricing-row">
                    <strong>{rule.providerId ? `${rule.providerId} / ${rule.modelId}` : rule.modelId}</strong>
                    <span>in ${rule.inputUsdPerMillion}/1M</span>
                    <span>out ${rule.outputUsdPerMillion}/1M</span>
                    <span>cache r ${rule.cacheReadUsdPerMillion ?? 0}/1M</span>
                    <span>cache w ${rule.cacheCreationUsdPerMillion ?? rule.inputUsdPerMillion}/1M</span>
                    <button className="ah-btn sm" onClick={() => editPricing(rule)}>Edit</button>
                    <button className="ah-btn sm danger" onClick={() => deletePricing(rule)}>Delete</button>
                  </div>
                ))}
                {pricing.length === 0 && <div className="wb-usage-empty">No pricing rules yet. Tokens are still tracked, but cost is shown as unpriced.</div>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FilterInput({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const listId = `usage-${label.toLowerCase()}-options`
  return (
    <label className="wb-usage-filter-field">
      <span>{label}</span>
      <input className="ah-input" list={listId} placeholder={`Any ${label.toLowerCase()}`} value={value} onChange={event => onChange(event.target.value)} />
      <datalist id={listId}>
        {options.map(option => <option key={option} value={option} />)}
      </datalist>
    </label>
  )
}

function UsageDetailCard({ title, rows, preview }: { title: string; rows: Array<[string, string]>; preview?: string }) {
  return (
    <aside className="wb-usage-detail">
      <strong>{title}</strong>
      {rows.length === 0 && <span>Select a record to view details.</span>}
      <div className="wb-usage-mini-metrics">
        {rows.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      {preview && <p className="wb-usage-preview">{preview}</p>}
    </aside>
  )
}

function RankList({ rows, empty, selectedKey, onSelect }: {
  rows: Array<{ key: string; title: string; meta: string; detail: string; tokens: number; estimated?: boolean; cost: number | null; unpriced?: boolean }>
  empty: string
  selectedKey?: string | null
  onSelect?: (key: string) => void
}) {
  if (!rows.length) return <div className="wb-usage-empty">{empty}</div>
  return (
    <div className="wb-usage-models">
      {rows.map(row => (
        <button key={row.key} type="button" className={'wb-usage-model-row' + (selectedKey === row.key ? ' selected' : '')} onClick={() => onSelect?.(row.key)}>
          <span><strong>{row.title}</strong><small>{row.meta}</small></span>
          <span>{row.detail}</span>
          <strong>{formatUsageTokens(row.tokens, row.estimated)}</strong>
          <small>{formatCost(row.cost, row.unpriced)}</small>
        </button>
      ))}
    </div>
  )
}

function usageModelKey(row: UsageModelRow): string {
  return `${row.providerId || 'provider'}:${row.agentId || 'agent'}:${row.modelId}`
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function compactToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function formatToken(value: number): string {
  return `${compactToken(value)} tokens`
}

function formatUsageTokens(value: number, hasEstimated?: boolean): string {
  return `${hasEstimated ? '~' : ''}${formatToken(value)}`
}

function formatCost(value: number | null | undefined, unpriced?: boolean): string {
  if (value == null) return unpriced ? 'Unpriced' : '-'
  const formatted = value === 0 ? '$0' : value < 0.01 ? '<$0.01' : `$${value.toFixed(value < 1 ? 4 : 2)}`
  return unpriced ? `${formatted} + unpriced` : formatted
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
