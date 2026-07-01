import React, { useEffect, useRef } from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import { clampInspectorWidth } from '../utils/scheduleUtils'
import { RightPanel } from './ToolPanelBar'

interface InspectorItem {
  id: Exclude<RightPanel, null>
  label: string
  icon: React.ReactNode
  disabled: boolean
}

interface WorkbenchInspectorProps {
  width: number
  viewportWidth: number
  setWidth: (width: number) => void
  commitWidth: (width: number) => void
  activePanel: RightPanel
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  onClose: () => void
  children: React.ReactNode
  items: InspectorItem[]
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
  children,
  items
}: WorkbenchInspectorProps) {
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
        {items.map(item => (
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
