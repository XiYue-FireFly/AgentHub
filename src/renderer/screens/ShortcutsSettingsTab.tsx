/**
 * ShortcutsSettingsTab: keyboard shortcut management panel.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles shortcut recording, reset, conflict detection, and search.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr, getLang } from '../glass/i18n'
import {
  KEYBOARD_SHORTCUT_COMMANDS,
  KEYBOARD_SHORTCUT_STORE_KEY,
  KEYBOARD_SHORTCUTS_CHANGED,
  KeyboardShortcutsConfigV1,
  KeyboardShortcutCommandId,
  resolveKeyboardShortcutBindings,
  normalizeKeyboardShortcuts,
  keyboardEventToShortcut,
  findKeyboardShortcutConflict,
  shortcutDisplay
} from '../keyboard-shortcuts'

function shortcutCommandLabel(command?: { labelZh: string; labelEn: string }): string {
  if (!command) return ''
  return getLang() === 'en' ? command.labelEn : command.labelZh
}

export function ShortcutsSettingsTab() {
  const [settings, setSettings] = useState<KeyboardShortcutsConfigV1>({ bindings: {} })
  const [search, setSearch] = useState('')
  const [recording, setRecording] = useState<KeyboardShortcutCommandId | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const bindings = useMemo(() => resolveKeyboardShortcutBindings(settings), [settings])
  const filteredCommands = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return KEYBOARD_SHORTCUT_COMMANDS
    return KEYBOARD_SHORTCUT_COMMANDS.filter(command => [
      command.labelZh,
      command.labelEn,
      command.descriptionZh,
      command.descriptionEn,
      command.id,
      ...(bindings[command.id] || [])
    ].join(' ').toLowerCase().includes(needle))
  }, [search, bindings])

  useEffect(() => {
    let alive = true
    window.electronAPI.store.get(KEYBOARD_SHORTCUT_STORE_KEY)
      .then(value => { if (alive) setSettings(normalizeKeyboardShortcuts(value && typeof value === 'object' ? value : null)) })
      .catch(() => { if (alive) setSettings({ bindings: {} }) })
    return () => { alive = false }
  }, [])

  const persist = useCallback(async (next: KeyboardShortcutsConfigV1) => {
    const normalized = normalizeKeyboardShortcuts(next)
    setSettings(normalized)
    await window.electronAPI.store.set(KEYBOARD_SHORTCUT_STORE_KEY, normalized)
    window.dispatchEvent(new CustomEvent(KEYBOARD_SHORTCUTS_CHANGED))
  }, [])

  const setCommandShortcut = async (commandId: KeyboardShortcutCommandId, shortcut: string) => {
    const next = normalizeKeyboardShortcuts({
      bindings: {
        ...settings.bindings,
        [commandId]: [shortcut]
      }
    })
    await persist(next)
    const conflict = findKeyboardShortcutConflict(resolveKeyboardShortcutBindings(next), commandId, shortcut)
    if (conflict) {
      const other = KEYBOARD_SHORTCUT_COMMANDS.find(command => command.id === conflict)
      setMessage(`${shortcut} ${tr('已与', 'also matches')} ${shortcutCommandLabel(other)} ${tr('冲突。', 'conflicts.')}`)
    } else {
      setMessage(tr('快捷键已保存。', 'Shortcut saved.'))
    }
  }

  const resetCommand = async (commandId: KeyboardShortcutCommandId) => {
    const nextBindings = { ...settings.bindings }
    delete nextBindings[commandId]
    await persist({ bindings: nextBindings })
    setMessage(tr('已恢复默认快捷键。', 'Default shortcut restored.'))
  }

  const onRecorderKeyDown = async (event: React.KeyboardEvent, commandId: KeyboardShortcutCommandId) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(null)
      setMessage(null)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      await persist({ bindings: { ...settings.bindings, [commandId]: [] } })
      setRecording(null)
      setMessage(tr('已清除该命令快捷键。', 'Shortcut cleared for this command.'))
      return
    }
    const shortcut = keyboardEventToShortcut(event)
    if (!shortcut) return
    if (!event.ctrlKey && !event.metaKey && !event.altKey && shortcut !== 'Shift+Tab') {
      setMessage(tr('请使用 Ctrl、Alt、Meta 组合键，或 Shift+Tab。', 'Use Ctrl, Alt, Meta, or Shift+Tab.'))
      return
    }
    await setCommandShortcut(commandId, shortcut)
    setRecording(null)
  }

  return (
    <div className="wb-settings-stack wb-shortcuts">
      <section className="glass wb-shortcuts-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('快捷键', 'Keyboard shortcuts')}</strong>
            <span>{tr('录制、重置或搜索 AgentHub 工作台操作。', 'Record, reset, or search AgentHub workbench actions.')}</span>
          </div>
          <input className="ah-input" value={search} onChange={event => setSearch(event.target.value)} placeholder={tr('搜索命令或快捷键', 'Search commands or shortcuts')} />
        </div>

        <div className="wb-shortcuts-list">
          {filteredCommands.map(command => {
            const activeShortcut = shortcutDisplay(bindings[command.id])
            const conflict = activeShortcut ? findKeyboardShortcutConflict(bindings, command.id, activeShortcut) : null
            const isRecording = recording === command.id
            return (
              <div key={command.id} className={'wb-shortcut-row' + (conflict ? ' conflict' : '')}>
                <div>
                  <strong>{shortcutCommandLabel(command)}</strong>
                  <span>{getLang() === 'en' ? command.descriptionEn : command.descriptionZh}</span>
                </div>
                <button
                  className={'wb-shortcut-key' + (isRecording ? ' recording' : '')}
                  onClick={() => { setRecording(command.id); setMessage(tr('请按下新的快捷键；Esc 取消，Backspace 清除。', 'Press a new shortcut. Esc cancels, Backspace clears.')) }}
                  onKeyDown={event => onRecorderKeyDown(event, command.id)}
                  autoFocus={isRecording}
                >
                  {isRecording ? tr('正在录制...', 'Recording...') : activeShortcut || tr('未设置', 'Unset')}
                </button>
                <button className="ah-btn sm" onClick={() => resetCommand(command.id)}>{tr('默认', 'Default')}</button>
                {conflict && <small>{tr('冲突：', 'Conflict: ')}{shortcutCommandLabel(KEYBOARD_SHORTCUT_COMMANDS.find(item => item.id === conflict))}</small>}
              </div>
            )
          })}
          {filteredCommands.length === 0 && <div className="wb-memory-kun-empty"><Icon d={IC.terminal} size={24} /><span>{tr('没有匹配的快捷键。', 'No matching shortcuts.')}</span></div>}
        </div>
      </section>
      {message && <div className="glass wb-shortcut-message">{message}</div>}
    </div>
  )
}
