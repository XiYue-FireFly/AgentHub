/**
 * TerminalPanel: Kun-inspired interactive terminal with xterm.js + PTY.
 *
 * Features:
 * - Real shell access via node-pty
 * - Multiple terminal tabs
 * - Theme-aware (follows app light/dark)
 * - Persistent sessions (survives panel toggle)
 * - Tab management (rename, close, context menu)
 */

import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import {
  closeTerminalTabState,
  getRememberedWorkspaceTabState,
  rememberWorkspaceTabState,
  type TerminalTab,
  type TerminalTabState
} from './terminalTabs'

// xterm.js loaded dynamically to avoid SSR issues
let Terminal: any = null
let FitAddon: any = null
let WebLinksAddon: any = null

async function loadXterm() {
  if (Terminal) return
  const xterm = await import('@xterm/xterm')
  const fit = await import('@xterm/addon-fit')
  const links = await import('@xterm/addon-web-links')
  Terminal = xterm.Terminal
  FitAddon = fit.FitAddon
  WebLinksAddon = links.WebLinksAddon
  // Load xterm CSS
  await import('@xterm/xterm/css/xterm.css')
}

interface TerminalPanelProps {
  workspaceRoot?: string | null
  onClose?: () => void
}

const TERMINAL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
const TERMINAL_FONT_SIZE = 13
const TERMINAL_SCROLLBACK = 5000
const FIT_DEBOUNCE_MS = 80
const INITIAL_TAB_ID = 'main'
const MAX_TABS = 8

function terminalSessionId(workspaceRoot: string | null | undefined, tabId: string): string {
  const wsKey = (workspaceRoot || 'no-workspace').replaceAll('\\', '/').toLowerCase()
  let hash = 2166136261
  for (let i = 0; i < wsKey.length; i++) {
    hash ^= wsKey.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `terminal:${(hash >>> 0).toString(36)}:${tabId}`
}

function resolveThemeMode(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function resolveTerminalTheme() {
  const mode = resolveThemeMode()
  if (mode === 'light') {
    return {
      background: '#ffffff',
      foreground: '#1a1a2e',
      cursor: '#1a1a2e',
      selectionBackground: 'rgba(59, 130, 246, 0.25)',
      black: '#1a1a2e',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#f1f5f9'
    }
  }
  return {
    background: 'rgba(15, 20, 35, 0.98)',
    foreground: '#e2e8f0',
    cursor: '#e2e8f0',
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#1e293b',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#f1f5f9'
  }
}

export function TerminalPanel({ workspaceRoot, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<any>(null)
  const fitRef = useRef<any>(null)
  const aliveRef = useRef(true)
  const attachTokenRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState(false)
  const [xtermLoaded, setXtermLoaded] = useState(false)
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: INITIAL_TAB_ID, index: 1 }])
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB_ID)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const workspaceTabStatesRef = useRef<Map<string, TerminalTabState>>(new Map())
  const workspaceKeyRef = useRef(workspaceRoot || '')

  // Load xterm.js
  useEffect(() => {
    loadXterm().then(() => setXtermLoaded(true)).catch(() => {})
  }, [])

  useLayoutEffect(() => { tabsRef.current = tabs }, [tabs])
  useLayoutEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  // Reset tabs on workspace change
  useLayoutEffect(() => {
    const prevKey = workspaceKeyRef.current
    const nextKey = workspaceRoot || ''
    if (prevKey === nextKey) return
    rememberWorkspaceTabState(workspaceTabStatesRef.current, prevKey, { tabs: tabsRef.current, activeTabId: activeTabIdRef.current })
    const saved = getRememberedWorkspaceTabState(workspaceTabStatesRef.current, nextKey)
    workspaceKeyRef.current = nextKey
    if (saved) {
      tabsRef.current = saved.tabs
      activeTabIdRef.current = saved.activeTabId
      setTabs(saved.tabs)
      setActiveTabId(saved.activeTabId)
    } else {
      const initialTabs = [{ id: INITIAL_TAB_ID, index: 1 }]
      tabsRef.current = initialTabs
      activeTabIdRef.current = INITIAL_TAB_ID
      setTabs(initialTabs)
      setActiveTabId(INITIAL_TAB_ID)
    }
  }, [workspaceRoot])

  const disposeRenderer = useCallback(() => {
    const term = termRef.current
    const disposer = (term as any)?.__dispose
    disposer?.()
    term?.dispose?.()
    termRef.current = null
    fitRef.current = null
    const container = containerRef.current
    if (container) container.replaceChildren()
  }, [])

  const attachTerminal = useCallback(async (tabId: string) => {
    if (!xtermLoaded || !Terminal || !containerRef.current) return
    const sessionId = terminalSessionId(workspaceRoot, tabId)
    const attachToken = ++attachTokenRef.current
    const isCurrent = () => aliveRef.current && attachTokenRef.current === attachToken

    const container = containerRef.current
    container.replaceChildren()
    setError(null)
    setExited(false)

    const theme = resolveTerminalTheme()
    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      cursorBlink: true,
      scrollback: TERMINAL_SCROLLBACK,
      theme,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    requestAnimationFrame(() => {
      if (!isCurrent()) return
      try { fit.fit() } catch { /* ignore */ }
    })

    // Stream PTY output → xterm
    const offData = (window as any).electronAPI?.terminalPty?.onData?.((payload: any) => {
      if (payload.sessionId !== sessionId) return
      try { term.write(payload.data) } catch { /* disposed */ }
    })
    const offExit = (window as any).electronAPI?.terminalPty?.onExit?.((payload: any) => {
      if (payload.sessionId !== sessionId) return
      setExited(true)
    })

    // xterm input → PTY
    const disposable = term.onData((data: string) => {
      (window as any).electronAPI?.terminalPty?.write?.({ sessionId, data })
    })

    // Resize handling
    let resizeTimer: any = null
    const triggerFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (!isCurrent()) return
        try {
          fit.fit()
          const dims = fit.proposeDimensions()
          if (dims) {
            (window as any).electronAPI?.terminalPty?.resize?.({ sessionId, cols: dims.cols, rows: dims.rows })
          }
        } catch { /* ignore */ }
      }, FIT_DEBOUNCE_MS)
    }
    const resizeObserver = new ResizeObserver(triggerFit)
    resizeObserver.observe(container)

    // G2-MH4: stash disposers BEFORE await so early exits always clean up listeners
    const runDispose = () => {
      try { offData?.() } catch { /* ignore */ }
      try { offExit?.() } catch { /* ignore */ }
      try { disposable.dispose?.() } catch { /* ignore */ }
      try { resizeObserver.disconnect() } catch { /* ignore */ }
      if (resizeTimer) clearTimeout(resizeTimer)
    }
    ;(term as any).__dispose = runDispose

    // Create PTY session
    try {
      const result = await (window as any).electronAPI?.terminalPty?.create?.({
        sessionId,
        cwd: workspaceRoot || undefined,
        cols: fit.proposeDimensions()?.cols || 80,
        rows: fit.proposeDimensions()?.rows || 24
      })
      if (!isCurrent()) {
        runDispose()
        try { term.dispose?.() } catch { /* ignore */ }
        return
      }
      if (!result?.ok) {
        setError(result?.message || 'Failed to create terminal')
        runDispose()
        return
      }
      const dims = fit.proposeDimensions()
      if (dims) {
        (window as any).electronAPI?.terminalPty?.resize?.({ sessionId, cols: dims.cols, rows: dims.rows })
      }
      setExited(false)
    } catch (e: any) {
      if (!isCurrent()) {
        runDispose()
        try { term.dispose?.() } catch { /* ignore */ }
        return
      }
      setError(e?.message || String(e))
      runDispose()
    }
  }, [xtermLoaded, workspaceRoot])

  useEffect(() => {
    aliveRef.current = true
    if (xtermLoaded) attachTerminal(activeTabId)
    return () => {
      aliveRef.current = false
      attachTokenRef.current++
      // F-W3: only tear down xterm UI on tab switch / panel hide.
      // Keep the main-process PTY + ring buffer so reattach works.
      // PTY is killed explicitly in handleCloseTab / handleRestart / app quit.
      disposeRenderer()
    }
  }, [activeTabId, xtermLoaded, attachTerminal, disposeRenderer, workspaceRoot])

  // Follow theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const term = termRef.current
      if (!term) return
      term.options.theme = resolveTerminalTheme()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const handleNewTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) return
    const nextIndex = Math.max(...tabs.map(t => t.index), 0) + 1
    const tab: TerminalTab = {
      id: `tab-${Date.now().toString(36)}-${nextIndex}`,
      index: nextIndex
    }
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [tabs.length])

  const handleCloseTab = useCallback((tabId: string) => {
    const sessionId = terminalSessionId(workspaceRoot, tabId)
    ;(window as any).electronAPI?.terminalPty?.dispose?.(sessionId)

    setTabs(prev => {
      const current = { tabs: prev, activeTabId: activeTabIdRef.current }
      const next = closeTerminalTabState(current, tabId)
      if (next === current || next.tabs === current.tabs) return prev

      tabsRef.current = next.tabs
      activeTabIdRef.current = next.activeTabId
      setActiveTabId(next.activeTabId)
      return next.tabs
    })
  }, [workspaceRoot])

  const handleRestart = useCallback(async () => {
    const sessionId = terminalSessionId(workspaceRoot, activeTabId)
    try { await (window as any).electronAPI?.terminalPty?.dispose?.(sessionId) } catch { /* ignore */ }
    setError(null)
    setExited(false)
    disposeRenderer()
    aliveRef.current = true
    attachTerminal(activeTabId)
  }, [activeTabId, workspaceRoot, disposeRenderer, attachTerminal])

  const startRename = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return
    setRenamingTabId(tabId)
    setRenameValue(tab.title || `Terminal ${tab.index}`)
  }, [tabs])

  const commitRename = useCallback(() => {
    if (!renamingTabId) return
    const nextTitle = renameValue.trim()
    setTabs(prev => prev.map(t => t.id === renamingTabId ? { ...t, title: nextTitle || undefined } : t))
    setRenamingTabId(null)
    setRenameValue('')
  }, [renamingTabId, renameValue])

  useEffect(() => {
    if (renamingTabId) {
      requestAnimationFrame(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() })
    }
  }, [renamingTabId])

  const getTabTitle = useCallback((tab: TerminalTab) => {
    return tab.title?.trim() || `Terminal ${tab.index}`
  }, [])

  return (
    <aside className="wb-terminal-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div className="wb-terminal-tabs">
        <div className="wb-terminal-tab-list" role="tablist" aria-label={tr('终端标签', 'Terminal tabs')}>
          {tabs.map(tab => {
            const active = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={'wb-terminal-tab' + (active ? ' active' : '')}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                aria-label={getTabTitle(tab)}
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => startRename(tab.id)}
                onContextMenu={(e) => { e.preventDefault(); startRename(tab.id) }}
                onKeyDown={e => {
                  if (renamingTabId === tab.id) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActiveTabId(tab.id)
                  }
                  if (e.key === 'F2') {
                    e.preventDefault()
                    startRename(tab.id)
                  }
                }}
              >
                {renamingTabId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                      if (e.key === 'Escape') { e.preventDefault(); setRenamingTabId(null); setRenameValue('') }
                    }}
                    className="wb-terminal-tab-rename"
                    onClick={e => e.stopPropagation()}
                    aria-label={tr('重命名终端标签', 'Rename terminal tab')}
                  />
                ) : (
                  <>
                    <Icon d={IC.terminal} size={13} />
                    <span>{getTabTitle(tab)}</span>
                  </>
                )}
                {tabs.length > 1 && (
                  <button
                    className="wb-terminal-tab-close"
                    onClick={e => { e.stopPropagation(); handleCloseTab(tab.id) }}
                    title={tr('关闭', 'Close')}
                    aria-label={tr('关闭终端标签', 'Close terminal tab')}
                  >
                    <Icon d={IC.x} size={10} />
                  </button>
                )}
              </div>
            )
          })}
          <button
            className="wb-terminal-tab-add"
            onClick={handleNewTab}
            disabled={tabs.length >= MAX_TABS}
            title={tr('新建终端', 'New terminal')}
            aria-label={tr('新建终端', 'New terminal')}
          >
            <Icon d={IC.plus} size={12} />
          </button>
        </div>
        <div className="wb-terminal-tab-actions">
          <button onClick={handleRestart} title={tr('重启', 'Restart')} aria-label={tr('重启终端', 'Restart terminal')}>
            <Icon d={IC.refresh} size={13} />
          </button>
          {onClose && (
            <button onClick={onClose} title={tr('关闭', 'Close')} aria-label={tr('关闭终端面板', 'Close terminal panel')}>
              <Icon d={IC.x} size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Terminal body */}
      <div className="wb-terminal-body" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
        {error && (
          <div className="wb-terminal-error">
            <div className="wb-terminal-error-title">{tr('终端不可用', 'Terminal unavailable')}</div>
            <div className="wb-terminal-error-message">{error}</div>
            <button className="ah-btn sm" onClick={handleRestart}>{tr('重启', 'Restart')}</button>
          </div>
        )}
        {exited && !error && (
          <div className="wb-terminal-exited">
            <button className="ah-btn sm" onClick={handleRestart}>{tr('终端已退出 - 点击重启', 'Terminal exited - click to restart')}</button>
          </div>
        )}
        {!xtermLoaded && !error && (
          <div className="wb-terminal-loading">{tr('加载终端...', 'Loading terminal...')}</div>
        )}
      </div>
    </aside>
  )
}
