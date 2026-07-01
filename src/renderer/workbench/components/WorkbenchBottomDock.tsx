import React from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import { RightPanel } from './ToolPanelBar'

interface InspectorItem {
  id: Exclude<RightPanel, null>
  label: string
  icon: React.ReactNode
  disabled: boolean
}

interface WorkbenchBottomDockProps {
  activePanel: Exclude<RightPanel, null>
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  onClose: () => void
  children: React.ReactNode
  items: InspectorItem[]
}

export function WorkbenchBottomDock({
  activePanel,
  setPanel,
  workspaceId,
  onClose,
  children,
  items
}: WorkbenchBottomDockProps) {
  return (
    <section className="wb-bottom-dock">
      <div className="wb-bottom-dock-tabs">
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
      <div className="wb-bottom-dock-body">{children}</div>
    </section>
  )
}
