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

// ============================================================
// 主编辑器组件
// ============================================================

interface SddDraftEditorProps {
  onOpenAssistant?: () => void
  onNext?: () => void
  onClose?: () => void
  nextDisabled?: boolean
}

export function SddDraftEditor({ onOpenAssistant, onNext, onClose, nextDisabled }: SddDraftEditorProps) {
  const {
    activeDraft,
    content,
    saveStatus,
    operationStatus,
    error,
    requirementBlocks
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
  }, [activeDraft, content, saveStatus])

  // 解析需求块
  useEffect(() => {
    const timer = setTimeout(() => {
      parseRequirementBlocks()
    }, 300)
    return () => clearTimeout(timer)
  }, [content])

  // 清理
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
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
          {onOpenAssistant && (
            <button className="sdd-toolbar-btn" onClick={onOpenAssistant} title={tr('AI 助手', 'AI Assistant')}>
              <span>✨</span>
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
    </div>
  )
}
