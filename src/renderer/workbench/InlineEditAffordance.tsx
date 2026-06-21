/**
 * InlineEditAffordance: UI for inline code editing.
 *
 * Shows an "Edit" button on code blocks. When clicked:
 * 1. User enters an instruction
 * 2. Calls inlineEdit.buildPrompt to get the AI prompt
 * 3. Shows a diff preview
 * 4. User can apply or cancel
 *
 * Phase 1.3 of AGENTHUB_ITERATION_GOAL.
 */

import React, { useState, useCallback } from 'react'

interface InlineEditAffordanceProps {
  code: string
  filePath?: string
  startLine?: number
  endLine?: number
  workspaceRoot?: string
  onApply?: (newCode: string) => void
}

function tr(zh: string, en: string): string {
  const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh' : 'en'
  return lang === 'zh' ? zh : en
}

export function InlineEditAffordance({ code, filePath, startLine, endLine, workspaceRoot, onApply }: InlineEditAffordanceProps) {
  const [editing, setEditing] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ original: string; replacement: string } | null>(null)

  const handleEdit = useCallback(async () => {
    if (!instruction.trim()) return
    setLoading(true)
    setError(null)
    try {
      // Build the prompt for the AI
      const prompt = await window.electronAPI.inlineEdit.buildPrompt({
        range: {
          filePath: filePath || '',
          startLine: startLine || 1,
          endLine: endLine || (code.split('\n').length),
          selectedText: code
        },
        instruction: instruction.trim()
      })

      // TODO: Send prompt to AI model and get replacement
      // For now, show a placeholder
      const replacement = `[AI would replace based on: ${instruction}]\n${code}`

      // Validate the replacement
      const validation = await window.electronAPI.inlineEdit.validate(code, replacement)
      if (!validation.valid) {
        setError(validation.warnings?.join(', ') || tr('替换内容无效', 'Invalid replacement'))
        return
      }

      setDiff({ original: code, replacement })
    } catch (err: any) {
      setError(err?.message || tr('生成替换失败', 'Failed to generate replacement'))
    } finally {
      setLoading(false)
    }
  }, [code, filePath, startLine, endLine, instruction])

  const handleApply = useCallback(async () => {
    if (!diff) return
    try {
      if (filePath) {
        const result = await window.electronAPI.inlineEdit.apply(
          code,
          startLine || 1,
          endLine || (code.split('\n').length),
          diff.replacement
        )
        if (result.ok && onApply) {
          onApply(result.content || diff.replacement)
        }
      } else if (onApply) {
        onApply(diff.replacement)
      }
      setEditing(false)
      setDiff(null)
      setInstruction('')
    } catch (err: any) {
      setError(err?.message || tr('应用替换失败', 'Failed to apply replacement'))
    }
  }, [diff, code, filePath, startLine, endLine, onApply])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setDiff(null)
    setInstruction('')
    setError(null)
  }, [])

  if (!editing) {
    return (
      <button
        className="ah-btn sm"
        onClick={() => setEditing(true)}
        style={{ fontSize: 11, padding: '2px 8px' }}
      >
        ✏️ {tr('编辑', 'Edit')}
      </button>
    )
  }

  return (
    <div className="glass" style={{ padding: 12, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13, flex: 1 }}>{tr('内联编辑', 'Inline Edit')}</strong>
        <button className="ah-btn sm" onClick={handleCancel}>{tr('取消', 'Cancel')}</button>
      </div>

      {!diff ? (
        <>
          <textarea
            className="ah-input"
            rows={3}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder={tr('描述你想要的修改...', 'Describe the change you want...')}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="ah-btn sm primary"
              onClick={handleEdit}
              disabled={!instruction.trim() || loading}
            >
              {loading ? tr('生成中...', 'Generating...') : tr('生成替换', 'Generate')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--tx-2)' }}>
            {tr('预览差异：', 'Preview diff:')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-error)' }}>{tr('原始', 'Original')}</div>
              <pre style={{ background: 'var(--bg-code-block)', padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
                <code>{diff.original}</code>
              </pre>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-success)' }}>{tr('替换', 'Replacement')}</div>
              <pre style={{ background: 'var(--bg-code-block)', padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
                <code>{diff.replacement}</code>
              </pre>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ah-btn sm primary" onClick={handleApply}>
              {tr('应用替换', 'Apply')}
            </button>
            <button className="ah-btn sm" onClick={() => setDiff(null)}>
              {tr('重新编辑', 'Re-edit')}
            </button>
          </div>
        </>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</div>}
    </div>
  )
}
