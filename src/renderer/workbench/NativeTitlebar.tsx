import React, { useEffect, useState } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import { readAppearanceLocal } from '../appearance'
import { resolveKeyboardShortcutBindings, shortcutDisplay } from '../keyboard-shortcuts'
import type { ViewMode } from './viewModes'

export type WorkbenchSettingsTabKey =
  | 'providers'
  | 'local-agents'
  | 'routing'
  | 'approvals'
  | 'workspaces'
  | 'skills'
  | 'mcp'
  | 'appearance'
  | 'memory'
  | 'updates'
  | 'shortcuts'
  | 'models'
  | 'plugins'
  | 'usage'
  | 'agentLoop'
  | 'requirements'

export type WorkbenchRightPanel = 'runs' | 'git' | 'worktrees' | 'browser' | 'terminal' | 'files' | 'side-chat' | null

interface NativeTitlebarProps {
  hubRunning: boolean
  search: string
  setSearch: (value: string) => void
  view: ViewMode
  setView: (view: ViewMode) => void
  createThread: () => Promise<void>
  openCreateProject: () => void
  openSetup: (tab?: WorkbenchSettingsTabKey) => void
  setRightPanel: (panel: WorkbenchRightPanel) => void
  shortcuts: ReturnType<typeof resolveKeyboardShortcutBindings>
}

export function NativeTitlebar({
  hubRunning,
  search,
  setSearch,
  view,
  setView,
  createThread,
  openCreateProject,
  openSetup,
  setRightPanel,
  shortcuts
}: NativeTitlebarProps) {
  const win = window.electronAPI?.win
  const [openMenu, setOpenMenu] = useState<'file' | 'view' | 'help' | null>(null)
  const [uiStyle, setUiStyle] = useState<'mac' | 'win'>(() => readAppearanceLocal().uiStyle)
  const isMacStyle = uiStyle === 'mac'

  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent).detail
      if (next?.uiStyle) setUiStyle(next.uiStyle)
    }
    window.addEventListener('agenthub:appearance-change', handler)
    return () => window.removeEventListener('agenthub:appearance-change', handler)
  }, [])

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [openMenu])

  const run = (action: () => void | Promise<unknown>) => (event: React.MouseEvent) => {
    event.stopPropagation()
    setOpenMenu(null)
    void action()
  }

  return (
    <div className="wb-titlebar app-drag" onDoubleClick={() => win?.maximizeToggle()}>
      {isMacStyle && (
        <div className="wb-traffic-lights app-no-drag">
          <span className="tl-dot tl-close" onClick={() => win?.close()} />
          <span className="tl-dot tl-min" onClick={() => win?.minimize()} />
          <span className="tl-dot tl-max" onClick={() => win?.maximizeToggle()} />
        </div>
      )}
      <TitlebarMenu
        id="file"
        label={tr('文件', 'File')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('新建对话', 'New chat'), shortcut: shortcutDisplay(shortcuts['new-chat']), action: run(createThread) },
          { label: tr('添加工作目录', 'Add working folder'), shortcut: shortcutDisplay(shortcuts['choose-workspace']), action: run(openCreateProject) },
          { label: tr('打开 Git 面板', 'Open Git panel'), shortcut: shortcutDisplay(shortcuts['panel-git']), action: run(() => setRightPanel('git')) },
          { label: tr('打开浏览器', 'Open browser'), shortcut: shortcutDisplay(shortcuts['panel-browser']), action: run(() => setRightPanel('browser')) }
        ]}
      />
      <TitlebarMenu
        id="view"
        label={tr('视图', 'View')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('对话', 'Chat'), shortcut: shortcutDisplay(shortcuts['view-chat']), checked: view === 'chat', action: run(() => setView('chat')) },
          { label: tr('写作', 'Write'), shortcut: shortcutDisplay(shortcuts['view-write']), checked: view === 'write', action: run(() => setView('write')) },
          { label: tr('任务历史', 'Tasks'), shortcut: shortcutDisplay(shortcuts['view-tasks']), checked: view === 'tasks', action: run(() => setView('tasks')) },
          { label: tr('需求', 'Requirements'), shortcut: shortcutDisplay(shortcuts['view-requirements']), checked: view === 'requirements', action: run(() => setView('requirements')) },
          { label: tr('设置', 'Settings'), shortcut: shortcutDisplay(shortcuts['view-settings']), checked: view === 'settings', action: run(() => setView('settings')) },
          { label: tr('运行面板', 'Runs panel'), shortcut: shortcutDisplay(shortcuts['panel-runs']), action: run(() => setRightPanel('runs')) },
          { label: tr('工作树面板', 'Worktrees panel'), action: run(() => setRightPanel('worktrees')) }
        ]}
      />
      <TitlebarMenu
        id="help"
        label={tr('帮助', 'Help')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('快捷键设置', 'Keyboard shortcuts'), shortcut: shortcutDisplay(shortcuts['settings-shortcuts']), action: run(() => openSetup('shortcuts')) },
          { label: tr('MCP 配置', 'MCP settings'), shortcut: shortcutDisplay(shortcuts['settings-mcp']), action: run(() => openSetup('mcp')) },
          { label: tr('打开项目主页', 'Open homepage'), action: run(() => window.electronAPI.app.openExternal('https://agenthub.dev')) }
        ]}
      />
      <div className="wb-title-spacer"></div>
      <div className="wb-search app-no-drag">
        <Icon d={IC.search} size={14} />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder={tr('搜索工作目录、会话、任务', 'Search folders, sessions, tasks')} />
      </div>
      <div className="wb-hub-state">
        <span className={'ah-dot ' + (hubRunning ? 'idle' : 'error')}></span>
        {hubRunning ? tr('Hub 运行中', 'Hub running') : tr('Hub 离线', 'Hub offline')}
      </div>
      <div className="wb-window-actions app-no-drag">
        <button onClick={() => win?.minimize()}><Icon d={IC.min} size={13} /></button>
        <button onClick={() => win?.maximizeToggle()}><Icon d={IC.max} size={13} /></button>
        <button onClick={() => win?.close()}><Icon d={IC.x} size={13} /></button>
      </div>
    </div>
  )
}

function TitlebarMenu({
  id,
  label,
  openMenu,
  setOpenMenu,
  items
}: {
  id: 'file' | 'view' | 'help'
  label: string
  openMenu: 'file' | 'view' | 'help' | null
  setOpenMenu: (menu: 'file' | 'view' | 'help' | null) => void
  items: Array<{ label: string; shortcut?: string; checked?: boolean; action: (event: React.MouseEvent) => void }>
}) {
  const open = openMenu === id
  return (
    <div className="wb-menu-wrap app-no-drag" onPointerDown={event => event.stopPropagation()}>
      <button
        type="button"
        className={'wb-menu' + (open ? ' active' : '')}
        onClick={event => {
          event.stopPropagation()
          setOpenMenu(open ? null : id)
        }}
      >
        {label}
      </button>
      {open && (
        <div className="wb-menu-dropdown">
          {items.map(item => (
            <button key={item.label} type="button" onClick={item.action}>
              <span className="wb-menu-check">{item.checked ? '✓' : ''}</span>
              <span>{item.label}</span>
              {item.shortcut && <small>{item.shortcut}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
