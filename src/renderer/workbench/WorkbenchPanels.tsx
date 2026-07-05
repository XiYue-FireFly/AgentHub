import React, { useEffect, useRef } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import type { WorkbenchRightPanel } from './NativeTitlebar'

export const DEFAULT_INSPECTOR_WIDTH = 460
export const MIN_INSPECTOR_WIDTH = 340
export const MAX_INSPECTOR_WIDTH = 760

export function clampInspectorWidth(width: number, viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth): number {
  const sidebarAndMain = viewportWidth > 1160 ? 292 + 560 + 40 : 290 + 420 + 32
  const responsiveMax = Math.max(MIN_INSPECTOR_WIDTH, viewportWidth - sidebarAndMain)
  return Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, responsiveMax, Math.round(width)))
}

export function WorkbenchInspector({
  width,
  viewportWidth,
  setWidth,
  commitWidth,
  activePanel,
  setPanel,
  workspaceId,
  onClose,
  children
}: {
  width: number
  viewportWidth: number
  setWidth: (width: number) => void
  commitWidth: (width: number) => void
  activePanel: WorkbenchRightPanel
  setPanel: (panel: WorkbenchRightPanel) => void
  workspaceId: string | null
  onClose: () => void
  children: React.ReactNode
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const widthRef = useRef(width)
  widthRef.current = width

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!drag.current) return
      setWidth(drag.current.startWidth + (drag.current.startX - event.clientX))
    }
    const up = () => {
      if (drag.current) commitWidth(widthRef.current)
      drag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [setWidth, commitWidth])

  return (
    <aside className="wb-right wb-inspector" style={viewportWidth > 820 ? { width: clampInspectorWidth(width, viewportWidth) } : undefined}>
      <div
        className="wb-inspector-resize"
        onMouseDown={event => {
          drag.current = { startX: event.clientX, startWidth: width }
          event.preventDefault()
        }}
      />
      <div className="wb-inspector-tabs">
        {inspectorItems(workspaceId).map(item => (
          <button
            key={item.id}
            className={activePanel === item.id ? 'active' : ''}
            onClick={() => setPanel(item.id)}
            disabled={item.disabled}
            title={item.disabled ? tr('选择工作目录后可用', 'Choose a working folder first') : item.label}
          >
            <Icon d={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        ))}
        <button className="close" onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
      <div className="wb-inspector-body">{children}</div>
    </aside>
  )
}

export function WorkbenchBottomDock({
  activePanel,
  setPanel,
  workspaceId,
  onClose,
  children
}: {
  activePanel: Exclude<WorkbenchRightPanel, null>
  setPanel: (panel: WorkbenchRightPanel) => void
  workspaceId: string | null
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <section className="wb-bottom-dock">
      <div className="wb-bottom-dock-tabs">
        {inspectorItems(workspaceId).map(item => (
          <button
            key={item.id}
            className={activePanel === item.id ? 'active' : ''}
            onClick={() => setPanel(item.id)}
            disabled={item.disabled}
            title={item.disabled ? tr('选择工作目录后可用', 'Choose a working folder first') : item.label}
          >
            <Icon d={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        ))}
        <button className="close" onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
      <div className="wb-bottom-dock-body">{children}</div>
    </section>
  )
}

export function ToolPanelBar({
  activePanel,
  setPanel,
  workspaceId,
  iconOnly = false
}: {
  activePanel: WorkbenchRightPanel
  setPanel: (panel: WorkbenchRightPanel) => void
  workspaceId: string | null
  iconOnly?: boolean
}) {
  const items: Array<{ id: Exclude<WorkbenchRightPanel, null | 'runs'>; label: string; icon: React.ReactNode; requiresWorkspace?: boolean }> = [
    { id: 'files', label: tr('文件', 'Files'), icon: IC.file, requiresWorkspace: true },
    { id: 'side-chat', label: tr('旁支对话', 'Side Chat'), icon: IC.chat },
    { id: 'git', label: 'Git', icon: IC.git, requiresWorkspace: true },
    { id: 'worktrees', label: tr('工作树', 'Worktrees'), icon: IC.folder, requiresWorkspace: true },
    { id: 'browser', label: tr('浏览器', 'Browser'), icon: IC.search }
  ]
  return (
    <div className={'wb-tool-panel-bar' + (iconOnly ? ' icon-only' : '')}>
      {items.map(item => {
        const disabled = item.requiresWorkspace && !workspaceId
        return (
          <button
            key={item.id}
            className={'wb-tool-button' + (activePanel === item.id ? ' active' : '')}
            onClick={() => !disabled && setPanel(activePanel === item.id ? null : item.id)}
            disabled={disabled}
            title={disabled ? tr('选择工作目录后可用', 'Available after choosing a working folder') : item.label}
          >
            <Icon d={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function PanelTitle({
  title,
  subtitle,
  onClose,
  onRefresh,
  loading
}: {
  title: string
  subtitle?: string
  onClose: () => void
  onRefresh?: () => void | Promise<void>
  loading?: boolean
}) {
  return (
    <div className="wb-timeline-head">
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="wb-timeline-head-actions">
        {onRefresh && <button onClick={() => onRefresh()} disabled={loading} title={tr('刷新', 'Refresh')}><Icon d={IC.refresh} size={14} /></button>}
        <button onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
    </div>
  )
}

function inspectorItems(workspaceId: string | null): Array<{ id: Exclude<WorkbenchRightPanel, null>; label: string; icon: React.ReactNode; disabled: boolean }> {
  return [
    { id: 'runs', label: tr('运行', 'Runs'), icon: IC.tasks, disabled: false },
    { id: 'files', label: tr('文件', 'Files'), icon: IC.file, disabled: !workspaceId },
    { id: 'git', label: 'Git', icon: IC.git, disabled: !workspaceId },
    { id: 'worktrees', label: tr('工作树', 'Worktrees'), icon: IC.folder, disabled: !workspaceId },
    { id: 'browser', label: tr('浏览器', 'Browser'), icon: IC.search, disabled: false }
  ]
}
