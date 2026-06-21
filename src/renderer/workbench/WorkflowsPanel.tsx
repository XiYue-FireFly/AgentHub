/**
 * WorkflowsPanel: browse / create / edit / delete / run workflows.
 *
 * Accessible via Ctrl+Shift+W or the command palette "open-workflows".
 * Phase 1.1 of AGENTHUB_ITERATION_GOAL.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'

interface WorkflowStep {
  id: string
  type: string
  label: string
  agentId?: string
  prompt?: string
  skillId?: string
  dependsOn?: string[]
  requiresApproval?: boolean
}

interface WorkflowDef {
  id: string
  name: string
  description: string
  category: string
  steps: WorkflowStep[]
  tags: string[]
  createdAt: string
  updatedAt: string
  useCount: number
  pinned?: boolean
}

const CATEGORY_LABELS: Record<string, { zh: string; en: string }> = {
  development: { zh: '开发', en: 'Development' },
  review: { zh: '审查', en: 'Review' },
  research: { zh: '研究', en: 'Research' },
  deployment: { zh: '部署', en: 'Deployment' },
  custom: { zh: '自定义', en: 'Custom' }
}

const STEP_TYPE_ICONS: Record<string, string> = {
  prompt: '💬',
  agent: '🤖',
  skill: '⚡',
  review: '🔍',
  gate: '🚧'
}

function tr(zh: string, en: string): string {
  const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh' : 'en'
  return lang === 'zh' ? zh : en
}

function WorkflowCard({ wf, onEdit, onDelete }: {
  wf: WorkflowDef
  onEdit: (wf: WorkflowDef) => void
  onDelete: (id: string) => void
}) {
  const cat = CATEGORY_LABELS[wf.category] || CATEGORY_LABELS.custom
  return (
    <div
      className="glass"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}
      onClick={() => onEdit(wf)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1, fontSize: 14 }}>{wf.name}</strong>
        <span className="ah-chip" style={{ fontSize: 10 }}>{cat.zh}</span>
        {wf.pinned && <span style={{ fontSize: 12 }}>📌</span>}
      </div>
      {wf.description && (
        <div style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.4 }}>
          {wf.description.slice(0, 100)}{wf.description.length > 100 ? '...' : ''}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--tx-3)' }}>
        <span>{wf.steps.length} {tr('步', 'steps')}</span>
        <span>·</span>
        <span>{wf.useCount} {tr('次使用', 'uses')}</span>
        {wf.tags.length > 0 && (
          <>
            <span>·</span>
            <span>{wf.tags.slice(0, 3).join(', ')}</span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {wf.steps.map(step => (
          <span key={step.id} className="ah-chip" style={{ fontSize: 10 }}>
            {STEP_TYPE_ICONS[step.type] || '•'} {step.label.slice(0, 16)}
          </span>
        ))}
      </div>
    </div>
  )
}

function WorkflowEditor({ wf, onSave, onCancel }: {
  wf: WorkflowDef | null
  onSave: (wf: Partial<WorkflowDef>) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(wf?.name || '')
  const [description, setDescription] = useState(wf?.description || '')
  const [category, setCategory] = useState(wf?.category || 'custom')
  const [steps, setSteps] = useState<WorkflowStep[]>(wf?.steps || [])
  const [tags, setTags] = useState(wf?.tags?.join(', ') || '')

  const addStep = () => {
    const id = `step-${Date.now().toString(36)}`
    setSteps([...steps, { id, type: 'prompt', label: `Step ${steps.length + 1}` }])
  }

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    setSteps(steps.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  const removeStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx))
  }

  const moveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setSteps(next)
  }

  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      ...(wf?.id ? { id: wf.id } : {}),
      name: name.trim(),
      description: description.trim(),
      category: category as any,
      steps,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean)
    })
  }

  return (
    <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{wf ? tr('编辑工作流', 'Edit workflow') : tr('新建工作流', 'New workflow')}</strong>
        <div style={{ flex: 1 }} />
        <button className="ah-btn sm" onClick={onCancel}>{tr('取消', 'Cancel')}</button>
        <button className="ah-btn sm primary" onClick={handleSave} disabled={!name.trim()}>{tr('保存', 'Save')}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="wb-field">
          <span>{tr('名称', 'Name')}</span>
          <input className="ah-input" value={name} onChange={e => setName(e.target.value)} placeholder={tr('工作流名称', 'Workflow name')} />
        </label>
        <label className="wb-field">
          <span>{tr('分类', 'Category')}</span>
          <select className="ah-select" value={category} onChange={e => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.zh}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="wb-field">
        <span>{tr('描述', 'Description')}</span>
        <textarea className="ah-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder={tr('工作流描述', 'Workflow description')} />
      </label>

      <label className="wb-field">
        <span>{tr('标签（逗号分隔）', 'Tags (comma-separated)')}</span>
        <input className="ah-input" value={tags} onChange={e => setTags(e.target.value)} placeholder="tag1, tag2" />
      </label>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>{tr('步骤', 'Steps')}</strong>
          <button className="ah-btn sm" onClick={addStep}>+ {tr('添加步骤', 'Add step')}</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((step, idx) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-input)', borderRadius: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--tx-3)', minWidth: 20 }}>{idx + 1}</span>
              <select className="ah-select" value={step.type} onChange={e => updateStep(idx, { type: e.target.value })} style={{ width: 100 }}>
                {Object.entries(STEP_TYPE_ICONS).map(([k, icon]) => (
                  <option key={k} value={k}>{icon} {k}</option>
                ))}
              </select>
              <input className="ah-input" value={step.label} onChange={e => updateStep(idx, { label: e.target.value })} placeholder={tr('步骤名称', 'Step name')} style={{ flex: 1 }} />
              <button className="ah-btn sm" onClick={() => moveStep(idx, -1)} disabled={idx === 0}>↑</button>
              <button className="ah-btn sm" onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}>↓</button>
              <button className="ah-btn sm danger" onClick={() => removeStep(idx)}>×</button>
            </div>
          ))}
          {steps.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
              {tr('暂无步骤，点击上方添加。', 'No steps yet. Click "Add step" above.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function WorkflowsPanel({ onClose }: { onClose?: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<WorkflowDef | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.workflows.list()
      setWorkflows(Array.isArray(list) ? list : [])
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to load workflows')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleSeed = async () => {
    try {
      await window.electronAPI.workflows.seed()
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to seed workflows')
    }
  }

  const handleSave = async (partial: Partial<WorkflowDef>) => {
    try {
      await window.electronAPI.workflows.upsert(partial as any)
      setEditing(null)
      setCreating(false)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to save workflow')
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(tr('确定删除此工作流？', 'Delete this workflow?'))) return
    try {
      await window.electronAPI.workflows.delete(id)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete workflow')
    }
  }

  const filtered = useMemo(() => {
    let list = workflows
    if (categoryFilter) list = list.filter(w => w.category === categoryFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(w =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    return list
  }, [workflows, search, categoryFilter])

  if (editing || creating) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto' }}>
        <WorkflowEditor wf={creating ? null : editing} onSave={handleSave} onCancel={() => { setEditing(null); setCreating(false) }} />
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong style={{ fontSize: 16, flex: 1 }}>{tr('工作流', 'Workflows')}</strong>
        <button className="ah-btn sm" onClick={handleSeed} title={tr('加载默认工作流', 'Seed defaults')}>
          {tr('默认', 'Seed')}
        </button>
        <button className="ah-btn sm primary" onClick={() => setCreating(true)}>
          + {tr('新建', 'New')}
        </button>
      </div>

      {/* Search + Filter */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="ah-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tr('搜索工作流...', 'Search workflows...')}
          style={{ flex: 1 }}
        />
        <select
          className="ah-select"
          value={categoryFilter || ''}
          onChange={e => setCategoryFilter(e.target.value || null)}
          style={{ width: 120 }}
        >
          <option value="">{tr('全部', 'All')}</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.zh}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && <div className="glass wb-error-text">{error}</div>}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--tx-2)' }}>
        <span>{filtered.length} / {workflows.length} {tr('个工作流', 'workflows')}</span>
        <span>{workflows.reduce((sum, w) => sum + w.steps.length, 0)} {tr('总步骤', 'total steps')}</span>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map(wf => (
          <WorkflowCard key={wf.id} wf={wf} onEdit={setEditing} onDelete={handleDelete} />
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--tx-3)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14 }}>
            {workflows.length === 0
              ? tr('暂无工作流。点击「默认」加载示例。', 'No workflows. Click "Seed" to load examples.')
              : tr('无匹配结果。', 'No matching workflows.')}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', color: 'var(--tx-3)', padding: 16 }}>{tr('加载中...', 'Loading...')}</div>}
    </div>
  )
}
