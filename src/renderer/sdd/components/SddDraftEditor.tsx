/**
 * SDD Draft Editor - 需求编辑器组件
 *
 * 完全参照 kun 的 SddDraftEditorView 设计
 */

import React, { useEffect, useRef, useState } from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import { useSddDraftStore } from '../sdd-draft-store'
import { saveDraftToDisk, parseRequirementBlocks } from '../sdd-draft-actions'
import { diffHistoryVersions, getHistorySummary, restoreFromHistory, type DraftHistorySummary } from '../sdd-draft-history'
import { SddTracePanel } from './SddTracePanel'
import { SddModelSelect } from './SddAssistantPanel'
import type { ProviderDef } from '../../glass/meta'

const SDD_AUTOSAVE_MS = 650

// ============================================================
// 设计上下文栏（参照 kun 的 SddDesignContextBar）
// ============================================================

const DESIGN_TONE_OPTIONS = [
  '编辑风', '专业', '活泼', '极简', '大胆', '温暖', '科技感', '严肃'
]

function SddDesignContextBar() {
  const activeDraft = useSddDraftStore((s) => s.activeDraft)
  const updateDesignContext = useSddDraftStore((s) => s.updateDesignContext)
  const [open, setOpen] = useState(false)

  const designContext = activeDraft?.designContext
  const tone = designContext?.tone ?? []
  const brandColor = designContext?.brandColor ?? ''

  const toggleTone = (value: string) => {
    const next = tone.includes(value) ? tone.filter((t) => t !== value) : [...tone, value]
    updateDesignContext({ tone: next })
  }

  const summaryParts = [
    designContext?.designType ? (designContext.designType === 'brand' ? tr('品牌', 'Brand') : tr('产品', 'Product')) : null,
    brandColor || null,
    tone.length ? tone.join('·') : null
  ].filter(Boolean)

  const summary = summaryParts.length > 0 ? summaryParts.join(' · ') : tr('未设置设计上下文', 'No design context set')

  return (
    <div className="sdd-design-context">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sdd-design-context-toggle"
      >
        <span className="sdd-design-context-label">
          <span className="sdd-design-context-icon">✨</span>
          {tr('设计上下文', 'Design Context')}
        </span>
        <span className="sdd-design-context-summary">{summary}</span>
      </button>
      {open && (
        <div className="sdd-design-context-body">
          <div>
            <div className="sdd-design-context-field-label">{tr('设计类型', 'Design Type')}</div>
            <div className="sdd-design-context-chips">
              {['brand', 'product'].map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`sdd-design-chip ${designContext?.designType === type ? 'active' : ''}`}
                  onClick={() => updateDesignContext({ designType: type as 'brand' | 'product' })}
                >
                  {type === 'brand' ? tr('品牌', 'Brand') : tr('产品', 'Product')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="sdd-design-context-field-label">{tr('品牌色', 'Brand Color')}</div>
            <div className="sdd-design-context-color">
              <input
                type="color"
                value={brandColor || '#3b82d8'}
                onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
              />
              <input
                type="text"
                value={brandColor}
                onChange={(e) => updateDesignContext({ brandColor: e.target.value })}
                placeholder="#3b82d8"
              />
            </div>
          </div>
          <div>
            <div className="sdd-design-context-field-label">{tr('色调', 'Tone')}</div>
            <div className="sdd-design-context-chips">
              {DESIGN_TONE_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`sdd-design-chip ${tone.includes(value) ? 'active' : ''}`}
                  onClick={() => toggleTone(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// 需求进度条（参照 kun 的 SddRequirementProgress）
// ============================================================

function SddRequirementProgress({ blocks }: { blocks: any[] }) {
  if (!blocks || blocks.length === 0) return null

  const counts = { verified: 0, done: 0, building: 0, planned: 0, draft: 0 }
  for (const block of blocks) {
    counts[block.status as keyof typeof counts]++
  }
  const total = blocks.length
  const implemented = counts.verified + counts.done

  return (
    <div className="sdd-req-progress">
      <span className="sdd-req-progress-label">{tr('需求进度', 'Requirement Progress')}</span>
      <div className="sdd-req-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={implemented}>
        {(['verified', 'done', 'building', 'planned'] as const).map((key) =>
          counts[key] > 0 ? (
            <span
              key={key}
              className={`sdd-req-progress-seg-${key}`}
              style={{ width: `${(counts[key] / total) * 100}%` }}
            />
          ) : null
        )}
      </div>
      <span className="sdd-req-progress-summary">
        {implemented}/{total} {tr('已完成', 'done')}
      </span>
    </div>
  )
}

// ============================================================
// 状态标签
// ============================================================

function statusLabel(saveStatus: string, operationStatus: string): { text: string; className: string } {
  if (operationStatus === 'upgrading') return { text: tr('生成计划中...', 'Generating plan...'), className: 'sdd-status-upgrading' }
  if (operationStatus === 'error' || saveStatus === 'error') return { text: tr('错误', 'Error'), className: 'sdd-status-error' }
  if (saveStatus === 'saving') return { text: tr('保存中...', 'Saving...'), className: 'sdd-status-saving' }
  if (saveStatus === 'dirty') return { text: tr('未保存', 'Unsaved'), className: 'sdd-status-dirty' }
  return { text: tr('已保存', 'Saved'), className: 'sdd-status-saved' }
}

function formatHistoryTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return timestamp
  }
}

function SddHistoryPanel({ draftId, workspaceRoot }: { draftId: string; workspaceRoot: string }) {
  const content = useSddDraftStore((s) => s.content)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DraftHistorySummary[]>(() => getHistorySummary(draftId, workspaceRoot))
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const refresh = () => {
    const next = getHistorySummary(draftId, workspaceRoot)
    setEntries(next)
    setSelectedVersion(current => current && next.some(entry => entry.version === current) ? current : next.at(-1)?.version ?? null)
  }

  useEffect(() => {
    refresh()
    setStatus(null)
  }, [draftId, workspaceRoot])

  const selectedEntry = selectedVersion ? entries.find(entry => entry.version === selectedVersion) : undefined
  const latestVersion = entries.at(-1)?.version
  const diff = selectedVersion && latestVersion && selectedVersion !== latestVersion
    ? diffHistoryVersions(draftId, selectedVersion, latestVersion, workspaceRoot)
    : null

  const handleRestore = async () => {
    if (!selectedVersion || restoring) return
    setRestoring(true)
    setStatus(null)
    try {
      const restored = await restoreFromHistory(draftId, selectedVersion, workspaceRoot)
      if (!restored) {
        setStatus(tr('未找到可恢复的历史版本', 'History version not found'))
        return
      }
      const saved = await saveDraftToDisk()
      if (!saved) {
        setStatus(tr('恢复后保存失败', 'Restore failed to save'))
        return
      }
      const parseSource = useSddDraftStore.getState()
      if (parseSource.activeDraft?.id !== draftId || parseSource.activeDraft.workspaceRoot !== workspaceRoot) {
        setStatus(tr('恢复期间需求文档已变更', 'Restore stopped because the requirement draft changed'))
        return
      }
      const sourceSession = parseSource.draftSession
      const sourceRevision = parseSource.editRevision
      const sourceContent = parseSource.content
      const parsed = await parseRequirementBlocks()
      const afterParse = useSddDraftStore.getState()
      if (
        !parsed ||
        afterParse.activeDraft?.id !== draftId ||
        afterParse.activeDraft.workspaceRoot !== workspaceRoot ||
        afterParse.draftSession !== sourceSession ||
        afterParse.editRevision !== sourceRevision ||
        afterParse.content !== sourceContent
      ) {
        setStatus(tr('恢复期间需求文档已变更', 'Restore stopped because the requirement draft changed'))
        return
      }
      refresh()
      setStatus(tr('已恢复并保存', 'Restored and saved'))
    } catch (error: any) {
      setStatus(error?.message || tr('恢复失败', 'Restore failed'))
    } finally {
      setRestoring(false)
    }
  }

  if (entries.length === 0) return null

  return (
    <section className="sdd-history-panel" aria-label={tr('需求历史版本', 'Requirement history')}>
      <button type="button" className="sdd-history-toggle" onClick={() => setOpen(value => !value)}>
        <span className="sdd-history-title">
          <Icon d={IC.refresh} size={14} />
          {tr('历史版本', 'Version History')}
        </span>
        <span className="sdd-history-summary">
          {tr(`${entries.length} 个快照`, `${entries.length} snapshots`)}
        </span>
      </button>
      {open && (
        <div className="sdd-history-body">
          <div className="sdd-history-list">
            {entries.slice().reverse().map(entry => (
              <button
                type="button"
                key={entry.version}
                className={`sdd-history-entry ${selectedVersion === entry.version ? 'active' : ''}`}
                onClick={() => setSelectedVersion(entry.version)}
              >
                <span className="sdd-history-entry-main">
                  <span className="sdd-history-version">v{entry.version}</span>
                  <span className="sdd-history-message">{entry.message}</span>
                </span>
                <span className="sdd-history-entry-meta">
                  {entry.author} · {formatHistoryTime(entry.timestamp)}
                </span>
              </button>
            ))}
          </div>
          {selectedEntry && (
            <div className="sdd-history-detail">
              <div className="sdd-history-detail-title">
                <span>{tr('选中版本', 'Selected version')} v{selectedEntry.version}</span>
                <button
                  type="button"
                  className="sdd-history-restore"
                  onClick={handleRestore}
                  disabled={restoring}
                >
                  {restoring ? tr('恢复中', 'Restoring') : tr('恢复', 'Restore')}
                </button>
              </div>
              {diff && (
                <div className="sdd-history-diff">
                  <span className="sdd-history-diff-added">+{diff.added.length}</span>
                  <span className="sdd-history-diff-removed">-{diff.removed.length}</span>
                </div>
              )}
              {selectedEntry.truncated && (
                <div className="sdd-history-warning">
                  {tr('该历史版本内容已截断，恢复可能不完整。', 'This history entry is truncated; restore may be incomplete.')}
                </div>
              )}
              {status && <div className="sdd-history-status">{status}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ============================================================
// 主编辑器组件
// ============================================================

interface SddDraftEditorProps {
  providers?: ProviderDef[]
  modelSelection?: ModelSelection | null
  onModelSelectionChange?: (selection: ModelSelection | null) => void
  onOpenAssistant?: () => void
  onNext?: () => void
  onVerify?: () => void
  onSendToChat?: () => void
  onSyncToTodo?: () => void
  onClose?: () => void
  nextDisabled?: boolean
  verifyDisabled?: boolean
  sendToChatDisabled?: boolean
  syncToTodoDisabled?: boolean
  syncingTodo?: boolean
  syncTodoStatus?: { tone: 'muted' | 'success' | 'warning' | 'error'; text: string } | null
}

export function SddDraftEditor({ providers, modelSelection, onModelSelectionChange, onOpenAssistant, onNext, onVerify, onSendToChat, onSyncToTodo, onClose, nextDisabled, verifyDisabled, sendToChatDisabled, syncToTodoDisabled, syncingTodo, syncTodoStatus }: SddDraftEditorProps) {
  const {
    activeDraft,
    content,
    draftSession,
    editRevision,
    saveStatus,
    operationStatus,
    error,
    requirementBlocks,
    trace
  } = useSddDraftStore()

  const setContent = useSddDraftStore((s) => s.setContent)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动保存
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!activeDraft || saveStatus !== 'dirty') return
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      saveDraftToDisk()
    }, SDD_AUTOSAVE_MS)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [activeDraft?.id, activeDraft?.workspaceRoot, editRevision, saveStatus])

  // 解析需求块
  useEffect(() => {
    const timer = setTimeout(() => {
      void parseRequirementBlocks()
    }, 300)
    return () => clearTimeout(timer)
  }, [activeDraft?.id, activeDraft?.workspaceRoot, content, draftSession, editRevision])

  // 清理：卸载时刷盘 dirty，避免 G2-MH7 丢键入
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const snap = useSddDraftStore.getState()
      if (snap.activeDraft && snap.saveStatus === 'dirty') {
        void saveDraftToDisk()
      }
    }
  }, [])

  if (!activeDraft) {
    return (
      <div className="sdd-empty-state">
        <span className="sdd-empty-icon">📄</span>
        <span className="sdd-empty-text">{tr('没有打开的需求', 'No requirement open')}</span>
      </div>
    )
  }

  const upgrading = operationStatus === 'upgrading'
  const readOnly = upgrading
  const status = statusLabel(saveStatus, operationStatus)

  return (
    <div className="sdd-editor-container">
      {/* 顶部工具栏 */}
      <div className="sdd-editor-toolbar">
        <div className="sdd-editor-toolbar-left">
          {onClose && (
            <button className="sdd-toolbar-btn" onClick={onClose} title={tr('关闭', 'Close')}>
              <Icon d={IC.x} size={16} />
            </button>
          )}
          <span className="sdd-editor-title">{activeDraft.title || tr('未命名需求', 'Untitled Requirement')}</span>
        </div>
        <div className="sdd-editor-toolbar-right">
          <span className={`sdd-editor-status ${status.className}`}>
            {status.text}
          </span>
          <SddModelSelect
            providers={providers}
            modelSelection={modelSelection}
            onModelSelectionChange={onModelSelectionChange}
          />
          {onOpenAssistant && (
            <button className="sdd-toolbar-btn" onClick={onOpenAssistant} title={tr('AI 助手', 'AI Assistant')}>
              <span>✨</span>
            </button>
          )}
          {onSendToChat && (
            <button
              className="sdd-toolbar-btn sdd-toolbar-btn-primary"
              onClick={onSendToChat}
              disabled={sendToChatDisabled || readOnly}
              title={tr('把完整需求文档发送到当前对话，让 Agent 按文档开发', 'Send the full requirement document to the current chat for agent implementation')}
            >
              <Icon d={IC.chat} size={14} />
              <span>{tr('加入对话开发', 'Send doc to chat')}</span>
            </button>
          )}
          {onSyncToTodo && (
            <button
              className="sdd-toolbar-btn"
              onClick={onSyncToTodo}
              disabled={syncToTodoDisabled || syncingTodo || readOnly}
              title={tr('把当前需求文档里的 - [ ] 清单同步到当前会话 Todo', 'Sync checklist items from this requirement document to the current thread todos')}
            >
              <Icon d={IC.check} size={14} />
              <span>{syncingTodo ? tr('同步中', 'Syncing') : tr('同步 Todo', 'Sync Todo')}</span>
            </button>
          )}
          {onSyncToTodo && syncTodoStatus && (
            <span className={`sdd-toolbar-status ${syncTodoStatus.tone}`} role="status" aria-live="polite">
              {syncTodoStatus.text}
            </span>
          )}
          {onVerify && (
            <button
              className="sdd-toolbar-btn"
              onClick={onVerify}
              disabled={verifyDisabled || readOnly}
              title={tr('Verify Acceptance', 'Verify Acceptance')}
            >
              <Icon d={IC.check} size={14} />
              <span>{tr('Verify', 'Verify')}</span>
            </button>
          )}
          {onNext && (
            <button
              className="sdd-toolbar-btn sdd-toolbar-btn-primary"
              onClick={onNext}
              disabled={nextDisabled || readOnly}
              title={tr('下一步：生成计划', 'Next: Generate Plan')}
            >
              <span>{tr('生成计划', 'Generate Plan')}</span>
              <Icon d={IC.chev} size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 需求进度条 */}
      <SddRequirementProgress blocks={requirementBlocks} />

      {/* 设计上下文栏 */}
      <SddDesignContextBar />

      <SddHistoryPanel draftId={activeDraft.id} workspaceRoot={activeDraft.workspaceRoot} />

      {/* 错误提示 */}
      {error && (
        <div className="sdd-editor-error">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* 编辑器主体 */}
      <div className="sdd-editor-content">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={readOnly}
          placeholder={tr('输入需求内容...\n\n使用 ### R-1: 标题 {状态} 格式定义需求块\n使用 - [ ] 定义验收标准', 'Enter requirement content...\n\nUse ### R-1: Title {status} format to define requirement blocks\nUse - [ ] to define acceptance criteria')}
          className="sdd-editor-textarea"
        />
      </div>

      {/* 需求块列表 */}
      {requirementBlocks.length > 0 && (
        <div className="sdd-requirement-blocks-panel">
          <div className="sdd-requirement-blocks-header">
            <span>{tr('需求块', 'Requirement Blocks')}</span>
            <span className="sdd-requirement-blocks-count">{requirementBlocks.length}</span>
          </div>
          <div className="sdd-requirement-blocks-list">
            {requirementBlocks.map((block) => (
              <div key={block.id} className="sdd-requirement-block-item">
                <span className={`sdd-block-status sdd-block-status-${block.status}`}>
                  {block.status === 'verified' ? '✓' :
                   block.status === 'done' ? '●' :
                   block.status === 'building' ? '◐' :
                   block.status === 'planned' ? '○' : '◯'}
                </span>
                <span className="sdd-block-id">{block.id}</span>
                <span className="sdd-block-title">{block.title}</span>
                <span className={`sdd-block-badge sdd-badge-${block.status}`}>
                  {block.status}
                </span>
                <span className="sdd-block-criteria">
                  {block.acceptanceCriteria.filter(c => c.checked).length}/{block.acceptanceCriteria.length}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SddTracePanel trace={trace} blocks={requirementBlocks} />
    </div>
  )
}
