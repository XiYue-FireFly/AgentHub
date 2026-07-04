/**
 * SDD Requirements List - 需求列表页面
 *
 * 显示所有需求，支持创建、删除、搜索、编辑
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import { styledConfirm } from '../../lib/confirm'
import { useSddDraftStore } from '../sdd-draft-store'
import { listDrafts, createNewDraft, deleteDraft, loadDraft, saveDraftToDisk, parseRequirementBlocks } from '../sdd-draft-actions'
import { buildAssistantPrompt } from '../sdd-assistant-prompt'
import { applyAssistantRequirementResponse } from '../sdd-assistant-apply'
import { buildPlanPrompt } from '../sdd-plan-prompt'
import { SddDraftEditor } from './SddDraftEditor'
import { SddAssistantPanel } from './SddAssistantPanel'

interface SddRequirementsListProps {
  workspaceRoot: string | null
}

const PLAN_GENERATION_TRIGGER_MESSAGE = 'Generate an implementation plan from the current requirement document.'
type AssistantRequestMode = 'chat' | 'plan'

export function SddRequirementsList({ workspaceRoot }: SddRequirementsListProps) {
  const [drafts, setDrafts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMode, setAssistantMode] = useState<'chat' | 'plan'>('chat')

  const activeDraft = useSddDraftStore((s) => s.activeDraft)
  const draftContent = useSddDraftStore((s) => s.content)

  // Load drafts
  const refreshDrafts = useCallback(async () => {
    if (!workspaceRoot) return
    setLoading(true)
    try {
      const result = await listDrafts(workspaceRoot)
      setDrafts(result)
    } catch (error) {
      console.error('Failed to load drafts:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => {
    refreshDrafts()
  }, [refreshDrafts])

  // Filter drafts by search
  const filteredDrafts = useMemo(() => {
    if (!search.trim()) return drafts
    const needle = search.toLowerCase()
    return drafts.filter(d =>
      d.title.toLowerCase().includes(needle) ||
      d.id.toLowerCase().includes(needle)
    )
  }, [drafts, search])

  // Create new draft
  const handleCreate = async () => {
    if (!workspaceRoot || !newTitle.trim()) return
    try {
      const draft = await createNewDraft(workspaceRoot, newTitle.trim())
      if (!draft) return
      setNewTitle('')
      setShowCreateDialog(false)
      await refreshDrafts()
      // 自动打开新创建的需求
      setView('editor')
    } catch (error) {
      console.error('Failed to create draft:', error)
    }
  }

  // Delete draft
  const handleDelete = async (draftId: string) => {
    if (!workspaceRoot) return
    const ok = await styledConfirm({
      message: tr('删除这个需求草稿？该操作会移除需求文档、聊天记录和追踪快照。', 'Delete this requirement draft? This removes the requirement document, chat history, and trace snapshot.'),
      danger: true
    })
    if (!ok) return
    try {
      await deleteDraft(workspaceRoot, draftId)
      if (activeDraft?.id === draftId) {
        setView('list')
      }
      await refreshDrafts()
    } catch (error) {
      console.error('Failed to delete draft:', error)
    }
  }

  // Open draft
  const handleOpen = async (draftId: string) => {
    if (!workspaceRoot) return
    await loadDraft(workspaceRoot, draftId)
    setView('editor')
  }

  // Back to list
  const handleBack = () => {
    setView('list')
  }

  const handleSendAssistantMessage = useCallback(async (
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    mode: AssistantRequestMode = 'chat'
  ): Promise<string> => {
    const store = useSddDraftStore.getState()
    const draft = store.activeDraft
    if (!draft) throw new Error('No active draft')

    let systemPrompt: string
    let userPrompt: string = message

    if (mode === 'plan') {
      const planResult = buildPlanPrompt({
        draft,
        blocks: store.requirementBlocks,
        designContext: draft.designContext
      })
      systemPrompt = planResult.systemPrompt
      userPrompt = planResult.userPrompt
      setAssistantMode('chat')
    } else {
      const result = buildAssistantPrompt(
        {
          draft,
          blocks: store.requirementBlocks,
          designContext: draft.designContext,
          history
        },
        message
      )
      systemPrompt = result.systemPrompt
      userPrompt = result.userPrompt
    }

    const result = await window.electronAPI.ai.quickComplete({
      prompt: userPrompt,
      systemPrompt
    })
    if (!result?.ok) throw new Error(result?.error || 'AI request failed')
    const content = result.content || ''
    if (mode === 'chat' && content.trim()) {
      const latest = useSddDraftStore.getState()
      latest.setContent(applyAssistantRequirementResponse(latest.content, content))
      await saveDraftToDisk()
      await parseRequirementBlocks()
      if (workspaceRoot) await refreshDrafts()
    }
    return content
  }, [refreshDrafts, workspaceRoot])

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  // 如果正在编辑，显示编辑器
  if (view === 'editor' && activeDraft) {
    return (
      <div className={`sdd-requirements-full ${assistantOpen ? 'sdd-with-assistant' : ''}`}>
        <SddDraftEditor
          onClose={handleBack}
          onOpenAssistant={() => setAssistantOpen(!assistantOpen)}
          onNext={() => {
            // 触发计划生成：切换到计划模式并打开 AI 助手面板
            if (!draftContent) return
            setAssistantMode('plan')
            setAssistantOpen(true)
          }}
          nextDisabled={!draftContent}
        />
        {assistantOpen && (
          <SddAssistantPanel
            draftId={activeDraft.id}
            workspaceRoot={activeDraft.workspaceRoot}
            initialMessage={assistantMode === 'plan' ? PLAN_GENERATION_TRIGGER_MESSAGE : undefined}
            initialMode={assistantMode}
            onSendMessage={handleSendAssistantMessage}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </div>
    )
  }

  if (!workspaceRoot) {
    return (
      <div className="sdd-empty-state">
        <Icon d={IC.folder} size={48} />
        <h3>{tr('没有选择工作区', 'No workspace selected')}</h3>
        <p>{tr('请先选择一个工作区来管理需求', 'Please select a workspace to manage requirements')}</p>
      </div>
    )
  }

  return (
    <div className="sdd-requirements-list">
      {/* Header */}
      <div className="sdd-requirements-header">
        <div className="sdd-requirements-title">
          <Icon d={IC.file} size={24} />
          <h2>{tr('需求管理', 'Requirements')}</h2>
          <span className="sdd-requirements-count">{drafts.length}</span>
        </div>
        <button
          className="ah-btn primary"
          onClick={() => setShowCreateDialog(true)}
        >
          <Icon d={IC.plus} size={16} />
          {tr('新建需求', 'New Requirement')}
        </button>
      </div>

      {/* Search */}
      <div className="sdd-requirements-search">
        <Icon d={IC.search} size={16} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('搜索需求...', 'Search requirements...')}
        />
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="sdd-create-dialog">
          <div className="sdd-create-dialog-content">
            <h3>{tr('创建新需求', 'Create New Requirement')}</h3>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={tr('输入需求标题...', 'Enter requirement title...')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowCreateDialog(false)
              }}
            />
            <div className="sdd-create-dialog-actions">
              <button className="ah-btn" onClick={() => setShowCreateDialog(false)}>
                {tr('取消', 'Cancel')}
              </button>
              <button
                className="ah-btn primary"
                onClick={handleCreate}
                disabled={!newTitle.trim()}
              >
                {tr('创建', 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drafts List */}
      <div className="sdd-drafts-container">
        {loading && (
          <div className="sdd-loading">
            {tr('加载中...', 'Loading...')}
          </div>
        )}

        {!loading && filteredDrafts.length === 0 && (
          <div className="sdd-empty-state">
            <Icon d={IC.file} size={32} />
            <p>{tr('没有找到需求，点击"新建需求"开始', 'No requirements found, click "New Requirement" to start')}</p>
          </div>
        )}

        {filteredDrafts.map(draft => (
          <div
            key={draft.id}
            className={`sdd-draft-card ${activeDraft?.id === draft.id ? 'active' : ''}`}
            onClick={() => handleOpen(draft.id)}
          >
            <div className="sdd-draft-card-header">
              <Icon d={IC.file} size={18} />
              <span className="sdd-draft-card-title">{draft.title}</span>
              <button
                className="sdd-draft-card-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(draft.id)
                }}
                title={tr('删除', 'Delete')}
              >
                <Icon d={IC.trash} size={14} />
              </button>
            </div>
            <div className="sdd-draft-card-meta">
              <span className="sdd-draft-card-date">
                {formatDate(draft.updatedAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
