import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tr } from '../glass/i18n'
import { IC, Icon, Seg } from '../glass/ui'

type UsageTab = 'overview' | 'requests' | 'providers' | 'models' | 'pricing'

const RANGE_OPTIONS = () => [
  { value: 'all', label: tr('全部', 'All') },
  { value: '90d', label: tr('90 天', '90 days') },
  { value: '30d', label: tr('30 天', '30 days') },
  { value: '7d', label: tr('7 天', '7 days') }
]

const TAB_OPTIONS = () => [
  { value: 'overview', label: tr('概览', 'Overview') },
  { value: 'requests', label: tr('请求', 'Requests') },
  { value: 'providers', label: tr('提供商', 'Providers') },
  { value: 'models', label: tr('模型', 'Models') },
  { value: 'pricing', label: tr('定价', 'Pricing') }
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
  const requestGenerationRef = useRef(0)

  const isCurrentRequest = useCallback((generation: number) => (
    requestGenerationRef.current === generation
  ), [])

  useEffect(() => () => {
    requestGenerationRef.current += 1
  }, [])

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

  const loadStats = useCallback(async (generation: number) => {
    const next = await window.electronAPI.usage.stats(range, tab)
    if (!isCurrentRequest(generation)) return false
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
    return true
  }, [isCurrentRequest, range, tab])

  const loadRecords = useCallback(async (generation: number) => {
    const next = await window.electronAPI.usage.records(requestFilter, page, 25)
    if (!isCurrentRequest(generation)) return false
    setRecords(next)
    setSelectedRecord(current => {
      if (current && next.records.some(record => record.id === current.id)) return current
      return next.records[0] || null
    })
    return true
  }, [isCurrentRequest, page, requestFilter])

  const loadFacets = useCallback(async (generation: number) => {
    const next = await window.electronAPI.usage.records({ range, sortBy: 'createdAt', sortDir: 'desc' }, 1, 200)
    if (!isCurrentRequest(generation)) return false
    setFacetRecords(next.records)
    return true
  }, [isCurrentRequest, range])

  const loadPricing = useCallback(async (generation: number) => {
    const next = await window.electronAPI.usage.pricingList()
    if (!isCurrentRequest(generation)) return false
    setPricing(next)
    return true
  }, [isCurrentRequest])

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current
    setLoading(true)
    setError(null)
    try {
      if (!await loadStats(generation)) return
      if (!await loadFacets(generation)) return
      if (tab === 'requests' && !await loadRecords(generation)) return
      if (tab === 'pricing') await loadPricing(generation)
    } catch (err: any) {
      if (isCurrentRequest(generation)) {
        setError(err?.message || tr('加载用量统计失败。', 'Failed to load usage statistics.'))
      }
    } finally {
      if (isCurrentRequest(generation)) setLoading(false)
    }
  }, [isCurrentRequest, loadFacets, loadPricing, loadRecords, loadStats, tab])

  useEffect(() => {
    requestGenerationRef.current += 1
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
    { label: tr('实际令牌数', 'Actual tokens'), value: formatToken(stats.actualTokens), hint: stats.hasEstimated ? tr(`另含估算 ${formatToken(stats.estimatedTokens)}`, `Plus estimated ${formatToken(stats.estimatedTokens)}`) : tr('仅包含已报告用量', 'Only reported usage') },
    { label: tr('估算令牌数', 'Estimated tokens'), value: stats.estimatedTokens > 0 ? `~${formatToken(stats.estimatedTokens)}` : formatToken(0), hint: stats.hasEstimated ? tr('为本地 CLI 或 ACP 运行估算', 'Estimated for local CLI or ACP runs') : tr('无估算用量', 'No estimated usage') },
    { label: tr('输入 / 输出', 'Input / output'), value: `${compactToken(stats.inputTokens)} / ${compactToken(stats.outputTokens)}`, hint: tr('提示词和补全令牌', 'Prompt and completion tokens') },
    { label: tr('缓存读取', 'Cache read'), value: stats.cacheReadTokens > 0 ? compactToken(stats.cacheReadTokens) : '0', hint: stats.cacheRate == null ? tr('暂无缓存数据', 'No cache data yet') : tr(`${Math.round(stats.cacheRate * 100)}% 缓存`, `${Math.round(stats.cacheRate * 100)}% cache`) },
    { label: tr('费用', 'Cost'), value: formatCost(stats.costUsd, stats.hasUnpriced), hint: stats.hasUnpriced ? tr('部分模型尚未定价', 'Some models are unpriced') : tr('根据本地定价规则计算', 'Calculated from local pricing rules') },
    { label: tr('请求数', 'Requests'), value: String(stats.requests), hint: tr(`${stats.activeDays} 个活跃日`, `${stats.activeDays} active days`) }
  ] : [], [stats])

  const upsertPricing = async () => {
    if (!draft.modelId.trim()) return
    const generation = ++requestGenerationRef.current
    setLoading(true)
    setError(null)
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
      if (!isCurrentRequest(generation)) return
      setDraft(EMPTY_DRAFT)
      if (!await loadPricing(generation)) return
      await loadStats(generation)
    } catch (err: any) {
      if (isCurrentRequest(generation)) {
        setError(err?.message || tr('保存定价规则失败。', 'Failed to save pricing rule.'))
      }
    } finally {
      if (isCurrentRequest(generation)) setLoading(false)
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
    const generation = ++requestGenerationRef.current
    setLoading(true)
    setError(null)
    try {
      await window.electronAPI.usage.pricingDelete(rule.id)
      if (!isCurrentRequest(generation)) return
      if (!await loadPricing(generation)) return
      await loadStats(generation)
    } catch (err: any) {
      if (isCurrentRequest(generation)) {
        setError(err?.message || tr('删除定价规则失败。', 'Failed to delete pricing rule.'))
      }
    } finally {
      if (isCurrentRequest(generation)) setLoading(false)
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
        <Seg value={tab} onChange={value => setTab(value as UsageTab)} options={TAB_OPTIONS()} />
        <div className="wb-usage-actions">
          <Seg value={range} onChange={value => setRange(value as UsageRange)} options={RANGE_OPTIONS()} />
          <button className="ah-btn sm" onClick={refresh} disabled={loading} title={tr('刷新', 'Refresh')}>
            <Icon d={IC.refresh} size={14} />
            {tr('刷新', 'Refresh')}
          </button>
        </div>
      </div>

      {loading && <div className="wb-usage-state">{tr('加载中...', 'Loading...')}</div>}
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
                        title={tr(`${day.date} / ${day.turns} 轮 / ${formatUsageTokens(day.tokens, day.hasEstimated)}`, `${day.date} / ${day.turns} turns / ${formatUsageTokens(day.tokens, day.hasEstimated)}`)}
                        onClick={() => setSelectedDay(day)}
                      />
                    ))}
                  </div>
                </div>
                <UsageDetailCard
                  title={selectedDay?.date || tr('未选择日期', 'No day selected')}
                  rows={[
                    [tr('请求数', 'Requests'), String(selectedDay?.turns || 0)],
                    [tr('总计', 'Total'), formatUsageTokens(selectedDay?.tokens || 0, selectedDay?.hasEstimated)],
                    [tr('输入', 'Input'), formatToken(selectedDay?.inputTokens || 0)],
                    [tr('输出', 'Output'), formatToken(selectedDay?.outputTokens || 0)],
                    [tr('缓存', 'Cache'), formatToken(selectedDay?.cacheReadTokens || 0)],
                    [tr('费用', 'Cost'), formatCost(selectedDay?.costUsd ?? null, selectedDay?.hasUnpriced)]
                  ]}
                />
              </div>
            </>
          )}

          {tab === 'requests' && (
            <div className="wb-usage-wide">
              <div className="wb-usage-filter-row">
                <input className="ah-input" placeholder={tr('搜索提供商、模型、Agent、线程或预览', 'Search provider, model, agent, thread, or preview')} value={query} onChange={event => setQuery(event.target.value)} />
                <select className="ah-select" value={source} onChange={event => setSource(event.target.value as any)}>
                  <option value="all">{tr('全部来源', 'All sources')}</option>
                  <option value="actual">{tr('实际用量', 'Actual usage')}</option>
                  <option value="estimated">{tr('估算用量', 'Estimated usage')}</option>
                  <option value="none">{tr('无令牌', 'No tokens')}</option>
                </select>
                <select className="ah-select" value={status} onChange={event => setStatus(event.target.value as any)}>
                  <option value="all">{tr('全部状态', 'All statuses')}</option>
                  <option value="completed">{tr('已完成', 'Completed')}</option>
                  <option value="failed">{tr('失败', 'Failed')}</option>
                  <option value="cancelled">{tr('已取消', 'Cancelled')}</option>
                </select>
              </div>
              <div className="wb-usage-filter-row">
                <FilterInput label={tr('线程', 'Thread')} value={threadId} onChange={setThreadId} options={threadOptions} />
                <FilterInput label={tr('提供商', 'Provider')} value={providerId} onChange={setProviderId} options={providerOptions} />
                <FilterInput label={tr('模型', 'Model')} value={modelId} onChange={setModelId} options={modelOptions} />
                <FilterInput label="Agent" value={agentId} onChange={setAgentId} options={agentOptions} />
                <button className="ah-btn sm" onClick={clearAttributionFilters}>{tr('清除', 'Clear')}</button>
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
                  {records && records.records.length === 0 && <div className="wb-usage-empty">{tr('没有符合当前筛选条件的请求记录。', 'No request records match the current filters.')}</div>}
                </div>
                <UsageDetailCard
                  title={selectedRecord ? `${selectedRecord.providerId} / ${selectedRecord.modelId}` : tr('未选择请求', 'No request selected')}
                  rows={selectedRecord ? [
                    [tr('时间', 'Time'), formatDateTime(selectedRecord.createdAt)],
                    [tr('线程', 'Thread'), selectedRecord.threadId],
                    [tr('轮次', 'Turn'), selectedRecord.turnId],
                    ['Agent', selectedRecord.agentId || '-'],
                    [tr('状态', 'Status'), selectedRecord.status],
                    [tr('来源', 'Source'), selectedRecord.source === 'estimated' ? tr('估算', 'Estimated') : selectedRecord.source === 'none' ? tr('无令牌', 'No tokens') : tr('实际', 'Actual')],
                    [tr('输入', 'Input'), formatToken(selectedRecord.inputTokens)],
                    [tr('输出', 'Output'), formatToken(selectedRecord.outputTokens)],
                    [tr('缓存读取', 'Cache read'), formatToken(selectedRecord.cacheReadTokens)],
                    [tr('缓存写入', 'Cache write'), formatToken(selectedRecord.cacheCreationTokens)],
                    [tr('延迟', 'Latency'), selectedRecord.latencyMs == null ? '-' : `${selectedRecord.latencyMs}ms`],
                    [tr('费用', 'Cost'), formatCost(selectedRecord.costUsd, selectedRecord.hasUnpriced)]
                  ] : []}
                  preview={selectedRecord?.errorMessage || selectedRecord?.responsePreview || selectedRecord?.promptPreview}
                />
              </div>
              {records && records.total > records.pageSize && (
                <div className="wb-usage-pager">
                  <button className="ah-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr('上一页', 'Previous')}</button>
                  <span>{page} / {Math.ceil(records.total / records.pageSize)}</span>
                  <button className="ah-btn sm" disabled={page >= Math.ceil(records.total / records.pageSize)} onClick={() => setPage(page + 1)}>{tr('下一页', 'Next')}</button>
                </div>
              )}
            </div>
          )}

          {tab === 'providers' && (
            <RankList
              empty={tr('暂无提供商用量。', 'No provider usage yet.')}
              rows={stats.providers.map(row => ({
                key: row.providerId,
                title: row.providerId,
                meta: tr(`${row.requests} 个请求 / ${row.turns} 轮`, `${row.requests} requests / ${row.turns} turns`),
                tokens: row.tokens,
                estimated: row.hasEstimated,
                cost: row.costUsd,
                unpriced: row.hasUnpriced,
                detail: tr(`${compactToken(row.inputTokens)} 输入 / ${compactToken(row.outputTokens)} 输出 / ${compactToken(row.cacheReadTokens)} 缓存`, `${compactToken(row.inputTokens)} input / ${compactToken(row.outputTokens)} output / ${compactToken(row.cacheReadTokens)} cache`)
              }))}
            />
          )}

          {tab === 'models' && (
            <div className="wb-usage-body">
              <RankList
                empty={tr('暂无模型用量。', 'No model usage yet.')}
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
                  detail: tr(`${row.requests} 个请求 / ${compactToken(row.inputTokens)} 输入 / ${compactToken(row.outputTokens)} 输出`, `${row.requests} requests / ${compactToken(row.inputTokens)} input / ${compactToken(row.outputTokens)} output`)
                }))}
              />
              <UsageDetailCard
                title={selectedModel?.modelId || tr('未选择模型', 'No model selected')}
                rows={selectedModel ? [
                  [tr('提供商', 'Provider'), selectedModel.providerId || '-'],
                  ['Agent', selectedModel.agentId || '-'],
                  [tr('请求数', 'Requests'), String(selectedModel.requests)],
                  [tr('实际', 'Actual'), formatToken(selectedModel.actualTokens)],
                  [tr('估算', 'Estimated'), selectedModel.estimatedTokens ? `~${formatToken(selectedModel.estimatedTokens)}` : formatToken(0)],
                  [tr('缓存', 'Cache'), formatToken(selectedModel.cacheReadTokens)],
                  [tr('费用', 'Cost'), formatCost(selectedModel.costUsd, selectedModel.hasUnpriced)]
                ] : []}
              />
            </div>
          )}

          {tab === 'pricing' && (
            <div className="wb-usage-wide">
              <div className="wb-pricing-form">
                <input className="ah-input" placeholder={tr('提供商（可选）', 'Provider, optional')} value={draft.providerId} onChange={event => setDraft({ ...draft, providerId: event.target.value })} />
                <input className="ah-input" placeholder={tr('模型 ID', 'Model ID')} value={draft.modelId} onChange={event => setDraft({ ...draft, modelId: event.target.value })} />
                <input className="ah-input" placeholder={tr('显示名称（可选）', 'Display name, optional')} value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder={tr('输入 $/1M', 'Input $/1M')} value={draft.inputUsdPerMillion} onChange={event => setDraft({ ...draft, inputUsdPerMillion: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder={tr('输出 $/1M', 'Output $/1M')} value={draft.outputUsdPerMillion} onChange={event => setDraft({ ...draft, outputUsdPerMillion: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder={tr('缓存读取 $/1M', 'Cache read $/1M')} value={draft.cacheReadUsdPerMillion} onChange={event => setDraft({ ...draft, cacheReadUsdPerMillion: event.target.value })} />
                <input className="ah-input" type="number" min="0" step="0.0001" placeholder={tr('缓存写入 $/1M', 'Cache write $/1M')} value={draft.cacheCreationUsdPerMillion} onChange={event => setDraft({ ...draft, cacheCreationUsdPerMillion: event.target.value })} />
                <button className="ah-btn sm primary" onClick={upsertPricing} disabled={!draft.modelId.trim()}>{tr('保存定价', 'Save pricing')}</button>
              </div>
              <div className="wb-usage-table">
                {pricing.map(rule => (
                  <div key={rule.id} className="wb-usage-row wb-pricing-row">
                    <strong>{rule.providerId ? `${rule.providerId} / ${rule.modelId}` : rule.modelId}</strong>
                    <span>{tr('输入', 'in')} ${rule.inputUsdPerMillion}/1M</span>
                    <span>{tr('输出', 'out')} ${rule.outputUsdPerMillion}/1M</span>
                    <span>{tr('缓存读', 'cache r')} ${rule.cacheReadUsdPerMillion ?? 0}/1M</span>
                    <span>{tr('缓存写', 'cache w')} ${rule.cacheCreationUsdPerMillion ?? rule.inputUsdPerMillion}/1M</span>
                    <button className="ah-btn sm" onClick={() => editPricing(rule)}>{tr('编辑', 'Edit')}</button>
                    <button className="ah-btn sm danger" onClick={() => deletePricing(rule)}>{tr('删除', 'Delete')}</button>
                  </div>
                ))}
                {pricing.length === 0 && <div className="wb-usage-empty">{tr('暂无定价规则。令牌仍会统计，但费用显示为未定价。', 'No pricing rules yet. Tokens are still tracked, but cost is shown as unpriced.')}</div>}
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
      <input className="ah-input" list={listId} placeholder={tr(`任意${label}`, `Any ${label.toLowerCase()}`)} value={value} onChange={event => onChange(event.target.value)} />
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
      {rows.length === 0 && <span>{tr('选择一条记录以查看详情。', 'Select a record to view details.')}</span>}
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
  return tr(`${compactToken(value)} 个令牌`, `${compactToken(value)} tokens`)
}

function formatUsageTokens(value: number, hasEstimated?: boolean): string {
  return `${hasEstimated ? '~' : ''}${formatToken(value)}`
}

function formatCost(value: number | null | undefined, unpriced?: boolean): string {
  if (value == null) return unpriced ? tr('未定价', 'Unpriced') : '-'
  const formatted = value === 0 ? '$0' : value < 0.01 ? '<$0.01' : `$${value.toFixed(value < 1 ? 4 : 2)}`
  return unpriced ? tr(`${formatted} + 未定价`, `${formatted} + unpriced`) : formatted
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
