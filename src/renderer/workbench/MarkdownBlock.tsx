import React from 'react'
import { readAppearanceLocal } from '../appearance'
import { tr } from '../glass/i18n'
import { sanitizeHtml } from '../lib/sanitize'
import { renderMarkdown } from './markdown-renderer'

type OpenTarget = 'editor' | 'antigravity' | 'explorer' | 'system' | 'vscode' | 'cursor' | 'windsurf' | 'zed' | 'file-manager'

export function MarkdownBlock({ content, emptyText, workspaceRoot }: { content: string; emptyText?: string; workspaceRoot?: string | null }) {
  const source = content.trim()
  const html = renderMarkdown(source || (emptyText ?? ''))
  const [openError, setOpenError] = React.useState<string | null>(null)
  const [fileMenu, setFileMenu] = React.useState<{
    x: number
    y: number
    path: string
    line?: number
    label: string
  } | null>(null)

  React.useEffect(() => {
    if (!fileMenu) return
    const close = () => setFileMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [fileMenu])

  const openFileReference = (rawPath: string, line?: number, target: OpenTarget = readAppearanceLocal().defaultOpenTarget as OpenTarget) => {
    const path = resolveMarkdownPath(rawPath, workspaceRoot)
    setOpenError(null)
    window.electronAPI.app.openPath({ path, target, line, workspaceRoot: workspaceRoot || undefined }).then(result => {
      if (!result.ok) {
        const message = result.error || tr('未知错误', 'Unknown error')
        setOpenError(message)
        console.warn('[AgentHub] open path failed:', message)
      }
    }).catch(error => {
      const message = error?.message || String(error)
      setOpenError(message)
      console.warn('[AgentHub] open path failed:', error)
    })
  }

  const copyResolvedPath = async (rawPath: string) => {
    const path = resolveMarkdownPath(rawPath, workspaceRoot)
    const result = await window.electronAPI.app.resolvePath({ path, workspaceRoot: workspaceRoot || undefined }).catch((error: any) => ({ ok: false, path, error: error?.message || String(error) }))
    await navigator.clipboard?.writeText(result.ok ? result.path : path)
  }

  const copyFileContent = async (rawPath: string) => {
    const path = resolveMarkdownPath(rawPath, workspaceRoot)
    const result = await window.electronAPI.app.readTextFile({ path, workspaceRoot: workspaceRoot || undefined }).catch((error: any) => ({ ok: false as const, path, content: '', error: error?.message || String(error) }))
    if (result.ok) await navigator.clipboard?.writeText(result.content || '')
    else {
      setOpenError(result.error || tr('读取失败', 'Read failed'))
      console.warn('[AgentHub] read file failed:', result.error)
    }
  }

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement | null)?.closest?.('a[data-file-path]') as HTMLAnchorElement | null
    if (!link) return
    event.preventDefault()
    const rawPath = link.dataset.filePath || ''
    const line = link.dataset.line ? Number(link.dataset.line) : undefined
    openFileReference(rawPath, line)
  }

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement | null)?.closest?.('a[data-file-path]') as HTMLAnchorElement | null
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    setFileMenu({
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 286)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 310)),
      path: link.dataset.filePath || '',
      line: link.dataset.line ? Number(link.dataset.line) : undefined,
      label: link.textContent?.trim() || link.dataset.filePath || ''
    })
  }

  return (
    <>
      <div className="wb-markdown" onClick={onClick} onContextMenu={onContextMenu} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
      {fileMenu && (
        <div
          className="wb-file-context-menu"
          style={{ left: fileMenu.x, top: fileMenu.y }}
          onPointerDown={event => event.stopPropagation()}
          role="menu"
        >
          <div className="wb-file-context-title">
            <span>{fileMenu.label}</span>
            <small>{targetLabel(readAppearanceLocal().defaultOpenTarget)}</small>
          </div>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line, 'editor'); setFileMenu(null) }}>{tr('在编辑器中打开', 'Open in editor')}</button>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line, 'explorer'); setFileMenu(null) }}>{tr('在文件管理器中显示', 'Reveal in file manager')}</button>
          <div className="wb-file-context-subtitle">{tr('打开方式', 'Open with')}</div>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line); setFileMenu(null) }}>{tr('默认目标', 'Default target')}</button>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line, 'vscode'); setFileMenu(null) }}>VS Code</button>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line, 'cursor'); setFileMenu(null) }}>Cursor</button>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line, 'antigravity'); setFileMenu(null) }}>Antigravity</button>
          <button type="button" onClick={() => { openFileReference(fileMenu.path, fileMenu.line, 'system'); setFileMenu(null) }}>{tr('系统默认', 'System default')}</button>
          <div className="wb-file-context-sep" />
          <button type="button" onClick={() => { copyResolvedPath(fileMenu.path).finally(() => setFileMenu(null)) }}>{tr('复制解析后的路径', 'Copy resolved path')}</button>
          <button type="button" onClick={() => { copyFileContent(fileMenu.path).finally(() => setFileMenu(null)) }}>{tr('复制文件内容', 'Copy file content')}</button>
        </div>
      )}
      {openError && <div className="wb-file-open-error" role="status">{tr('打开失败：', 'Open failed: ')}{openError}</div>}
    </>
  )
}

function resolveMarkdownPath(path: string, workspaceRoot?: string | null): string {
  if (/^[a-z]:[\\/]/i.test(path) || path.startsWith('/') || path.startsWith('\\\\')) return path
  if (!/[\\/]/.test(path) && !path.startsWith('.')) return path
  if (!workspaceRoot) return path
  return `${workspaceRoot.replace(/[\\/]+$/, '')}\\${path.replace(/^\.?[\\/]/, '')}`
}

function targetLabel(target: string): string {
  if (target === 'antigravity') return tr('默认：Antigravity', 'Default: Antigravity')
  if (target === 'system') return tr('默认：系统', 'Default: system')
  if (target === 'explorer' || target === 'file-manager') return tr('默认：文件管理器', 'Default: file manager')
  return tr(`默认：${target}`, `Default: ${target}`)
}
