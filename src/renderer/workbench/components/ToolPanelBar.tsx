import React from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'

export type RightPanel = 'runs' | 'git' | 'worktrees' | 'browser' | 'terminal' | 'files' | 'side-chat' | null

interface ToolPanelBarProps {
  activePanel: RightPanel
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  iconOnly?: boolean
}

export function ToolPanelBar({ activePanel, setPanel, workspaceId, iconOnly = false }: ToolPanelBarProps) {
  const items: Array<{ id: Exclude<RightPanel, null | 'runs'>; label: string; icon: React.ReactNode; requiresWorkspace?: boolean }> = [
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
