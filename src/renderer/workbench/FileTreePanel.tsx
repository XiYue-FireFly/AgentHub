/**
 * FileTreePanel: Workspace file tree browser (Kun-inspired).
 *
 * Shows a lazy-loading tree of the workspace directory. Click to expand
 * directories, right-click for context menu, double-click files to preview.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'

interface FileTreePanelProps {
  workspaceRoot: string | null
  workspaceId: string | null
  onClose: () => void
  onFileSelect?: (path: string) => void
}

interface FileEntry {
  path: string
  relativePath: string
  name: string
  extension: string
  isDirectory: boolean
  sizeBytes: number
}

interface DirectoryState {
  entries: FileEntry[]
  loading: boolean
  error: string | null
  loaded: boolean
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', 'coverage', '.cache'])

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function pathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(entry: FileEntry): React.ReactNode {
  if (entry.isDirectory) return null // handled by expand arrow
  const ext = entry.extension.toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) return <Icon d={IC.image} size={13} />
  return <Icon d={IC.file} size={13} />
}

export function FileTreePanel({ workspaceRoot, workspaceId, onClose, onFileSelect }: FileTreePanelProps) {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const root = workspaceRoot?.trim() || ''
  const rootKey = root ? pathKey(root) : ''

  // Reset on workspace change
  useEffect(() => {
    setDirectories({})
    setExpanded(new Set())
    setSelectedPath(null)
    setContextMenu(null)
  }, [root])

  // Auto-load root directory
  useEffect(() => {
    if (root) loadDirectory(root)
  }, [root])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  const loadDirectory = useCallback(async (path: string) => {
    if (!root) return
    const key = path === root ? '' : path
    setDirectories(prev => ({
      ...prev,
      [pathKey(path)]: {
        entries: prev[pathKey(path)]?.entries ?? [],
        loading: true,
        error: null,
        loaded: false
      }
    }))
    try {
      const result = await window.electronAPI.workspaceFiles.list(key || root)
      setDirectories(prev => ({
        ...prev,
        [pathKey(path)]: {
          entries: Array.isArray(result) ? result : [],
          loading: false,
          error: null,
          loaded: true
        }
      }))
    } catch (err: any) {
      setDirectories(prev => ({
        ...prev,
        [pathKey(path)]: {
          entries: [],
          loading: false,
          error: err?.message || String(err),
          loaded: true
        }
      }))
    }
  }, [root])

  const toggleExpand = useCallback((path: string) => {
    const key = pathKey(path)
    let shouldLoad = false
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        // Check if directory needs loading (will load after state update)
        const state = directories[key]
        if (!state?.loaded && !state?.loading) {
          shouldLoad = true
        }
      }
      return next
    })
    // Load directory outside updater to avoid side effects in Strict Mode
    if (shouldLoad) {
      loadDirectory(path)
    }
  }, [directories, loadDirectory])

  const handleEntryClick = useCallback((entry: FileEntry) => {
    setSelectedPath(entry.path)
    if (entry.isDirectory) {
      toggleExpand(entry.path)
    } else {
      onFileSelect?.(entry.path)
    }
  }, [toggleExpand, onFileSelect])

  const handleContextMenu = useCallback((event: React.MouseEvent, entry: FileEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedPath(entry.path)
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 200),
      y: Math.min(event.clientY, window.innerHeight - 120),
      entry
    })
  }, [])

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard?.writeText(path)
    setContextMenu(null)
  }, [])

  const handleCopyRelativePath = useCallback((entry: FileEntry) => {
    if (root) {
      const rel = entry.path.slice(root.length).replace(/^[/\\]+/, '')
      navigator.clipboard?.writeText(rel)
    }
    setContextMenu(null)
  }, [root])

  const renderEntry = useCallback((entry: FileEntry, depth: number) => {
    const key = pathKey(entry.path)
    const isExpanded = expanded.has(key)
    const isSelected = selectedPath === entry.path
    const dirState = entry.isDirectory ? directories[key] : null
    const hasChildren = dirState?.entries && dirState.entries.length > 0
    const paddingLeft = 12 + depth * 16

    return (
      <React.Fragment key={entry.path}>
        <div
          className={'wb-file-tree-row' + (isSelected ? ' selected' : '')}
          style={{ paddingLeft }}
          onClick={() => handleEntryClick(entry)}
          onContextMenu={(e) => handleContextMenu(e, entry)}
        >
          {entry.isDirectory ? (
            <span className="wb-file-tree-arrow">
              {dirState?.loading ? (
                <span className="wb-file-tree-spinner" />
              ) : (
                <Icon d={isExpanded ? IC.chevDown : IC.chev} size={11} />
              )}
            </span>
          ) : (
            <span className="wb-file-tree-icon">{fileIcon(entry)}</span>
          )}
          <span className="wb-file-tree-name" title={entry.name}>
            {entry.name}
          </span>
          {!entry.isDirectory && entry.sizeBytes > 0 && (
            <span className="wb-file-tree-size">{formatFileSize(entry.sizeBytes)}</span>
          )}
        </div>
        {entry.isDirectory && isExpanded && dirState?.entries?.map(child =>
          // Skip ignored directories
          IGNORED_DIRS.has(child.name) ? null : renderEntry(child, depth + 1)
        )}
        {entry.isDirectory && isExpanded && dirState?.error && (
          <div className="wb-file-tree-error" style={{ paddingLeft: paddingLeft + 28 }}>
            {dirState.error}
          </div>
        )}
      </React.Fragment>
    )
  }, [expanded, selectedPath, directories, handleEntryClick, handleContextMenu])

  // Flatten tree for display
  const treeEntries = useMemo(() => {
    if (!root) return []
    const rootState = directories[rootKey]
    if (!rootState?.entries) return []
    return rootState.entries.filter(e => !IGNORED_DIRS.has(e.name))
  }, [root, rootKey, directories])

  if (!root) {
    return (
      <div className="wb-tool-panel">
        <div className="wb-timeline-head">
          <div>
            <strong>{tr('文件', 'Files')}</strong>
            <span>{tr('工作目录文件树', 'Workspace file tree')}</span>
          </div>
          <div className="wb-timeline-head-actions">
            <button onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
          </div>
        </div>
        <div className="wb-muted-box">
          {tr('请先选择工作目录以查看文件树。', 'Choose a working folder to view the file tree.')}
        </div>
      </div>
    )
  }

  return (
    <div className="wb-tool-panel wb-file-tree-panel">
      <div className="wb-timeline-head">
        <div>
          <strong>{tr('文件', 'Files')}</strong>
          <span>{root.split(/[/\\]/).filter(Boolean).pop() || root}</span>
        </div>
        <div className="wb-timeline-head-actions">
          <button onClick={() => loadDirectory(root)} title={tr('刷新', 'Refresh')}>
            <Icon d={IC.refresh} size={14} />
          </button>
          <button onClick={onClose} title={tr('关闭', 'Close')}>
            <Icon d={IC.x} size={14} />
          </button>
        </div>
      </div>
      <div className="wb-file-tree-body">
        {treeEntries.length === 0 && directories[rootKey]?.loading && (
          <div className="wb-muted-box">{tr('加载中...', 'Loading...')}</div>
        )}
        {treeEntries.length === 0 && directories[rootKey]?.loaded && (
          <div className="wb-muted-box">{tr('空目录', 'Empty directory')}</div>
        )}
        {treeEntries.length === 0 && directories[rootKey]?.error && (
          <div className="wb-send-error">{directories[rootKey].error}</div>
        )}
        {treeEntries.map(entry => renderEntry(entry, 0))}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="wb-file-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={e => e.stopPropagation()}
        >
          {contextMenu.entry.isDirectory && (
            <button onClick={() => { toggleExpand(contextMenu.entry.path); setContextMenu(null) }}>
              {tr('展开', 'Expand')}
            </button>
          )}
          {!contextMenu.entry.isDirectory && (
            <button onClick={() => { onFileSelect?.(contextMenu.entry.path); setContextMenu(null) }}>
              {tr('打开', 'Open')}
            </button>
          )}
          <button onClick={() => handleCopyPath(contextMenu.entry.path)}>
            {tr('复制路径', 'Copy path')}
          </button>
          <button onClick={() => handleCopyRelativePath(contextMenu.entry)}>
            {tr('复制相对路径', 'Copy relative path')}
          </button>
        </div>
      )}
    </div>
  )
}
