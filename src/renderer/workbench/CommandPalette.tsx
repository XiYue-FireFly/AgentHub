/**
 * CommandPalette: global command search overlay.
 *
 * Opens with Ctrl+Shift+P. Fuzzy-matches across all registered commands
 * (keyboard shortcuts + dynamic commands). Executes selected command and
 * closes.
 */

import React, { useState, useEffect, useId, useRef, useMemo, useCallback } from 'react'
import { tr, useLang, type Lang } from '../glass/i18n'
import { useModalFocus } from '../hooks/useModalFocus'

export interface PaletteCommand {
  id: string
  label: string
  labelZh?: string
  labelEn?: string
  description?: string
  descriptionZh?: string
  descriptionEn?: string
  shortcut?: string
  category?: string
  keywords?: string[]
}

interface CommandPaletteProps {
  commands: PaletteCommand[]
  onExecute: (commandId: string) => void
  onClose: () => void
}

/** Simple fuzzy match: checks if query chars appear in order within target. */
function _fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

/** Score a fuzzy match: shorter targets with earlier matches score higher. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 1000
  if (t.startsWith(q)) return 900
  let qi = 0
  let firstMatch = -1
  let consecutive = 0
  let maxConsecutive = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatch < 0) firstMatch = ti
      consecutive++
      maxConsecutive = Math.max(maxConsecutive, consecutive)
      qi++
    } else {
      consecutive = 0
    }
  }
  if (qi < q.length) return 0
  const base = 500 - firstMatch * 2 - t.length
  return base + maxConsecutive * 10
}

function localizedCommandLabel(command: PaletteCommand, lang: Lang): string {
  if (lang === 'zh') return command.labelZh || command.label || command.labelEn || command.id
  return command.labelEn || command.label || command.labelZh || command.id
}

export function CommandPalette({ commands, onExecute, onClose }: CommandPaletteProps) {
  const lang = useLang()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const instanceId = useId().replace(/:/g, '')
  const helpId = `wb-command-palette-help-${instanceId}`
  const listId = `wb-command-palette-list-${instanceId}`
  const optionId = (index: number) => `wb-command-palette-option-${instanceId}-${index}`

  useModalFocus({ containerRef: dialogRef, initialFocusRef: inputRef, onEscape: onClose })

  const localizedCommands = useMemo(() => commands.map(command => ({
    command,
    label: localizedCommandLabel(command, lang)
  })), [commands, lang])

  const filtered = useMemo(() => {
    if (!query.trim()) return localizedCommands
    const q = query.trim()
    return localizedCommands
      .map(item => {
        const { command, label } = item
        const score = Math.max(
          fuzzyScore(q, label),
          fuzzyScore(q, command.description || ''),
          fuzzyScore(q, command.category || '')
        )
        return { item, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item)
  }, [localizedCommands, query])

  useEffect(() => { setSelectedIndex(0) }, [query])
  useEffect(() => {
    setSelectedIndex(index => filtered.length === 0 ? 0 : Math.min(Math.max(index, 0), filtered.length - 1))
  }, [filtered.length])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const execute = useCallback((id: string) => {
    onExecute(id)
    onClose()
  }, [onExecute, onClose])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(index => filtered.length === 0 ? 0 : Math.min(Math.max(index, 0) + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(index => filtered.length === 0 ? 0 : Math.max(index - 1, 0))
      return
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) { e.preventDefault(); execute(filtered[selectedIndex].command.id); return }
  }, [filtered, selectedIndex, execute])

  return (
    <div className="wb-cp-overlay" onClick={onClose}>
      <div
        className="wb-cp-container"
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={tr('命令面板', 'Command palette')}
        aria-describedby={helpId}
        tabIndex={-1}
      >
        <div className="wb-cp-input-wrap">
          <svg className="wb-cp-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="10.5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="wb-cp-input"
            placeholder={tr('搜索命令...', 'Search commands...')}
            role="combobox"
            aria-label={tr('搜索命令', 'Search commands')}
            aria-controls={listId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={filtered[selectedIndex] ? optionId(selectedIndex) : undefined}
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div
          className="wb-cp-list"
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={tr('命令', 'Commands')}
        >
          {filtered.length === 0 && (
            <div className="wb-cp-empty">{tr('无匹配命令', 'No matching commands')}</div>
          )}
          {filtered.map(({ command, label }, index) => (
            <button
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={-1}
              className={'wb-cp-item' + (index === selectedIndex ? ' active' : '')}
              onClick={() => execute(command.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="wb-cp-item-label">{label}</span>
              {command.category && <span className="wb-cp-item-cat">{command.category}</span>}
              {command.shortcut && <span className="wb-cp-item-shortcut">{command.shortcut}</span>}
            </button>
          ))}
        </div>
        <div className="wb-cp-footer" id={helpId}>
          <span>{tr('↑↓ 导航 · Enter 执行 · Esc 关闭', '↑↓ navigate · Enter execute · Esc close')}</span>
        </div>
      </div>
    </div>
  )
}
