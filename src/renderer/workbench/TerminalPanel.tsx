/**
 * TerminalPanel: interactive terminal with AI operations.
 *
 * Shows terminal output, allows command input, and provides AI buttons
 * for explaining output and suggesting commands.
 *
 * Phase 1.4 of AGENTHUB_ITERATION_GOAL.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'

interface TerminalPanelProps {
  workspaceRoot?: string | null
  onClose?: () => void
}

interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'ai'
  text: string
  timestamp: number
}

function tr(zh: string, en: string): string {
  const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh' : 'en'
  return lang === 'zh' ? zh : en
}

export function TerminalPanel({ workspaceRoot, onClose }: TerminalPanelProps) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const addLine = useCallback((type: TerminalLine['type'], text: string) => {
    setLines(prev => [...prev, { type, text, timestamp: Date.now() }])
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  const handleRun = useCallback(async () => {
    if (!input.trim() || running) return
    const cmd = input.trim()
    setInput('')
    addLine('input', `$ ${cmd}`)
    setRunning(true)

    try {
      // Use terminal:run IPC if available, otherwise show placeholder
      const result = await window.electronAPI.terminal?.run?.({
        command: cmd,
        workspaceId: workspaceRoot || undefined
      })
      if (result?.stdout) {
        addLine('output', result.stdout)
      } else if (result?.stderr) {
        addLine('error', result.stderr)
      } else {
        addLine('output', tr('（命令已发送到终端）', '(Command sent to terminal)'))
      }
    } catch (err: any) {
      addLine('error', err?.message || tr('命令执行失败', 'Command failed'))
    } finally {
      setRunning(false)
    }
  }, [input, running, workspaceRoot, addLine])

  const handleExplainOutput = useCallback(async () => {
    if (lines.length === 0) return
    setAiLoading(true)
    setAiError(null)
    try {
      const recentOutput = lines
        .filter(l => l.type === 'output' || l.type === 'error')
        .slice(-20)
        .map(l => l.text)
        .join('\n')

      const context = {
        recentCommands: lines.filter(l => l.type === 'input').slice(-5).map(l => l.text.replace(/^\$ /, '')),
        recentOutput: recentOutput.split('\n'),
        cwd: workspaceRoot || undefined
      }

      const prompt = await window.electronAPI.terminalAi.explainOutput(context)
      addLine('ai', tr('正在分析输出...', 'Analyzing output...'))
      // TODO: Send prompt to AI model and get explanation
      addLine('ai', tr('（AI 分析功能待接入模型）', '(AI analysis pending model integration)'))
    } catch (err: any) {
      setAiError(err?.message || tr('分析失败', 'Analysis failed'))
    } finally {
      setAiLoading(false)
    }
  }, [lines, workspaceRoot, addLine])

  const handleSuggestCommand = useCallback(async () => {
    const intent = input.trim() || tr('查看当前目录文件', 'List files in current directory')
    setAiLoading(true)
    setAiError(null)
    try {
      const context = {
        recentCommands: lines.filter(l => l.type === 'input').slice(-5).map(l => l.text.replace(/^\$ /, '')),
        recentOutput: lines.filter(l => l.type === 'output').slice(-10).map(l => l.text),
        cwd: workspaceRoot || undefined
      }

      const prompt = await window.electronAPI.terminalAi.suggestCommand(intent, context)
      addLine('ai', tr('正在生成建议...', 'Generating suggestion...'))
      // TODO: Send prompt to AI model and get suggestion
      addLine('ai', tr('（AI 建议功能待接入模型）', '(AI suggestion pending model integration)'))
    } catch (err: any) {
      setAiError(err?.message || tr('建议生成失败', 'Suggestion failed'))
    } finally {
      setAiLoading(false)
    }
  }, [input, lines, workspaceRoot, addLine])

  const handleClear = useCallback(() => {
    setLines([])
    setAiError(null)
  }, [])

  return (
    <div className="glass" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--glass-border-default)' }}>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{tr('终端', 'Terminal')}</span>
        <button className="ah-btn sm" onClick={handleExplainOutput} disabled={aiLoading || lines.length === 0}>
          {aiLoading ? '⏳' : '🔍'} {tr('解释输出', 'Explain')}
        </button>
        <button className="ah-btn sm" onClick={handleSuggestCommand} disabled={aiLoading}>
          {aiLoading ? '⏳' : '💡'} {tr('建议命令', 'Suggest')}
        </button>
        <button className="ah-btn sm" onClick={handleClear}>{tr('清空', 'Clear')}</button>
        {onClose && <button className="ah-btn sm" onClick={onClose}>×</button>}
      </div>

      {/* Output */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6 }}>
        {lines.length === 0 && (
          <div style={{ color: 'var(--tx-3)', textAlign: 'center', padding: 40 }}>
            {tr('输入命令开始执行，或点击上方 AI 按钮获取帮助。', 'Type a command to execute, or click AI buttons above for help.')}
          </div>
        )}
        {lines.map((line, idx) => (
          <div key={idx} style={{
            color: line.type === 'input' ? 'var(--tx-1)'
              : line.type === 'error' ? 'var(--color-error)'
              : line.type === 'ai' ? 'var(--color-info)'
              : 'var(--tx-2)',
            marginBottom: 4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {line.text}
          </div>
        ))}
        {running && <div style={{ color: 'var(--tx-3)' }}>{tr('执行中...', 'Running...')}</div>}
      </div>

      {/* Error */}
      {aiError && (
        <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--color-error)', borderTop: '1px solid var(--glass-border-default)' }}>
          {aiError}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--glass-border-default)' }}>
        <span style={{ color: 'var(--tx-3)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>$</span>
        <input
          className="ah-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleRun() }}
          placeholder={tr('输入命令...', 'Type a command...')}
          style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13 }}
          disabled={running}
        />
        <button className="ah-btn sm primary" onClick={handleRun} disabled={!input.trim() || running}>
          {running ? '⏳' : '▶'} {tr('运行', 'Run')}
        </button>
      </div>
    </div>
  )
}
