import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import { WorkspaceItem } from './types'
import { styledConfirm } from '../lib/confirm'

const PERSONAL_WORKSPACE_KEY = '__personal__'
const SIDEBAR_WIDTH_KEY = 'agenthub.workbench.sidebarWidth.v1'
const MIN_SIDEBAR_WIDTH = 248
const MAX_SIDEBAR_WIDTH = 420

export function SessionSidebar({
  view,
  setView,
  workspaces,
  workspaceId,
  selectWorkspace,
  createProject,
  threads,
  activeThreadId,
  selectThread,
  createThread,
  createThreadInWorkspace,
  renameThread,
  deleteThread,
  search,
  setSearch,
  proxyHost,
  pendingThreadId
}: {
  view: 'chat' | 'write' | 'tasks' | 'settings' | 'workflows'
  setView: (view: 'chat' | 'write' | 'tasks' | 'settings' | 'workflows') => void
  workspaces: WorkspaceItem[]
  workspaceId: string | null
  selectWorkspace: (id: string | null) => void
  createProject: () => void
  threads: WorkbenchThread[]
  activeThreadId: string | null
  selectThread: (id: string | null) => void
  createThread: (workspaceId?: string | null) => void
  createThreadInWorkspace: (workspaceId: string) => void
  renameThread: (id: string, title: string) => Promise<void> | void
  deleteThread: (id: string) => void
  search: string
  setSearch: (value: string) => void
  proxyHost: string
  pendingThreadId: string | null
}) {
  const [sidebarWidth, setSidebarWidth] = useState(312)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<WorkbenchThread | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingBusy, setRenamingBusy] = useState(false)
  const grouped = useMemo(() => groupThreadsByWorkspace(threads), [threads])
  const resizeHandlersRef = useRef<{ move: ((e: PointerEvent) => void) | null; up: ((e: PointerEvent) => void) | null }>({ move: null, up: null })
  const query = search.trim().toLowerCase()
  const personalThreads = grouped.get(PERSONAL_WORKSPACE_KEY) ?? []
  const visiblePersonalThreads = useMemo(() => {
    const scopeHit = [tr('个人会话', 'Personal chat'), tr('未绑定工作目录', 'No folder bound')].join('\n').toLowerCase().includes(query)
    if (!query || scopeHit) return personalThreads
    return personalThreads.filter(thread => [thread.title, statusLabel(thread.lastTurnStatus), tr('个人会话', 'Personal chat')]
      .join('\n').toLowerCase().includes(query))
  }, [personalThreads, query])
  const visibleProjects = useMemo(() => {
    return workspaces.map(workspace => {
      const projectThreads = grouped.get(workspace.id) ?? []
      const workspaceHit = [workspace.name, workspace.rootPath].join('\n').toLowerCase().includes(query)
      const visibleThreads = query
        ? projectThreads.filter(thread => [thread.title, statusLabel(thread.lastTurnStatus), workspace.name, workspace.rootPath]
          .join('\n').toLowerCase().includes(query))
        : projectThreads
      if (query && !workspaceHit && visibleThreads.length === 0) return null
      return {
        workspace,
        allThreads: projectThreads,
        visibleThreads: workspaceHit ? projectThreads : visibleThreads,
        runningCount: projectThreads.filter(thread => thread.lastTurnStatus === 'running' || thread.lastTurnStatus === 'queued').length
      }
    }).filter(Boolean) as Array<{
      workspace: WorkspaceItem
      allThreads: WorkbenchThread[]
      visibleThreads: WorkbenchThread[]
      runningCount: number
    }>
  }, [grouped, query, workspaces])

  useEffect(() => {
    window.electronAPI.store.get(SIDEBAR_WIDTH_KEY)
      .then(value => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          setSidebarWidth(clampSidebarWidth(value))
        }
      })
      .catch(() => {})
  }, [])

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      const { move, up } = resizeHandlersRef.current
      if (move) window.removeEventListener('pointermove', move)
      if (up) {
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      document.body.classList.remove('wb-sidebar-resizing')
    }
  }, [])

  const startResize = (event: React.PointerEvent) => {
    const startX = event.clientX
    const startWidth = sidebarWidth
    document.body.classList.add('wb-sidebar-resizing')
    const move = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    }
    const up = (upEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + upEvent.clientX - startX)
      setSidebarWidth(nextWidth)
      window.electronAPI.store.set(SIDEBAR_WIDTH_KEY, nextWidth).catch(() => {})
      document.body.classList.remove('wb-sidebar-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      resizeHandlersRef.current = { move: null, up: null }
    }
    resizeHandlersRef.current = { move, up }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    event.preventDefault()
  }

  useEffect(() => {
    if (!workspaceId) return
    setCollapsed(current => ({ ...current, [workspaceId]: false }))
  }, [workspaceId])

  const startRename = (thread: WorkbenchThread) => {
    setRenaming(thread)
    setRenameValue(thread.title)
  }

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    if (!renaming || renamingBusy) return
    const nextTitle = renameValue.trim()
    if (!nextTitle || nextTitle === renaming.title) {
      setRenaming(null)
      return
    }
    setRenamingBusy(true)
    try {
      await renameThread(renaming.id, nextTitle)
      setRenaming(null)
    } finally {
      setRenamingBusy(false)
    }
  }

  const removeThread = async (thread: WorkbenchThread) => {
    const ok = await styledConfirm({ message: tr(`删除会话"${thread.title}"？`, `Delete session "${thread.title}"?`), danger: true })
    if (!ok) return
    deleteThread(thread.id)
  }

  return (
    <aside className="wb-sidebar" style={{ width: sidebarWidth, flexBasis: sidebarWidth } as React.CSSProperties}>
      <div className="wb-mode-tabs">
        <button className={view !== 'write' ? 'active' : ''} onClick={() => setView('chat')}><Icon d={IC.terminal} size={15} /> {tr('代码', 'Code')}</button>
        <button className={view === 'write' ? 'active' : ''} onClick={() => setView('write')}><Icon d={IC.pencil} size={15} /> {tr('写作', 'Write')}</button>
      </div>
      <button
        type="button"
        className="wb-sidebar-resize-handle"
        onPointerDown={startResize}
        aria-label={tr('调整侧边栏宽度', 'Resize sidebar')}
        title={tr('调整侧边栏宽度', 'Resize sidebar')}
      />

      <nav className="wb-nav">
        <button className={view === 'chat' ? 'active' : ''} onClick={() => createThread()}>
          <Icon d={IC.plus} size={16} /> {tr('新对话', 'New chat')}
        </button>
        <button onClick={createProject}>
          <Icon d={IC.folder} size={16} /> {tr('添加工作目录', 'Add working folder')}
        </button>
        <button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}>
          <Icon d={IC.tasks} size={16} /> {tr('任务', 'Tasks')}
        </button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
          <Icon d={IC.gear} size={16} /> {tr('设置', 'Settings')}
        </button>
      </nav>

      <div className="wb-sidebar-search">
        <Icon d={IC.search} size={14} />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={tr('搜索工作目录和会话', 'Search folders and sessions')}
        />
        {search && (
          <button title={tr('清空搜索', 'Clear search')} onClick={() => setSearch('')}>
            <Icon d={IC.x} size={12} />
          </button>
        )}
      </div>

      <div className="wb-sidebar-section">
        <div className="wb-sidebar-label">
          <span>{tr('工作台', 'Workbench')}</span>
          <button title={tr('添加工作目录', 'Add working folder')} onClick={createProject}><Icon d={IC.plus} size={13} /></button>
        </div>
      </div>

      <div className="wb-thread-list">
        {(!query || visiblePersonalThreads.length > 0) && (
          <section className={'wb-project-group' + (!workspaceId ? ' active' : '')}>
            <div className="wb-project-row">
              <button
                className="wb-project-collapse"
                onClick={() => setCollapsed(current => ({ ...current, [PERSONAL_WORKSPACE_KEY]: !current[PERSONAL_WORKSPACE_KEY] }))}
                title={collapsed[PERSONAL_WORKSPACE_KEY] ? tr('展开个人会话', 'Expand personal chat') : tr('折叠个人会话', 'Collapse personal chat')}
              >
                <Icon d={collapsed[PERSONAL_WORKSPACE_KEY] ? IC.chev : IC.chevDown} size={13} />
              </button>
              <button className="wb-project-main" onClick={() => selectWorkspace(null)} title={tr('未绑定工作目录', 'No folder bound')}>
                <Icon d={IC.chat} size={15} />
                <span>{tr('个人会话', 'Personal chat')}</span>
                <small>
                  {personalThreads.length || ''}
                </small>
              </button>
              <button
                className="wb-project-add"
                title={tr('新建个人会话', 'New personal chat')}
                onClick={() => createThread(null)}
              >
                <Icon d={IC.plus} size={13} />
              </button>
            </div>
            {!collapsed[PERSONAL_WORKSPACE_KEY] && (
              <div className="wb-project-sessions">
                {personalThreads.length === 0 && !query && (
                  <button className="wb-session-empty" onClick={() => createThread(null)}>{tr('开始新对话', 'Start a new chat')}</button>
                )}
                {visiblePersonalThreads.map(thread => (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    pending={thread.id === pendingThreadId}
                    selectThread={selectThread}
                    onRename={startRename}
                    onDelete={removeThread}
                  />
                ))}
                {query && visiblePersonalThreads.length === 0 && (
                  <span className="wb-session-filter-empty">{tr('个人会话没有匹配项', 'No matching personal chats')}</span>
                )}
              </div>
            )}
          </section>
        )}

        {workspaces.length === 0 && !query && (
          <div className="wb-empty-side">
            <strong>{tr('还没有工作目录', 'No folders yet')}</strong>
            <span>{tr('工作目录只在需要文件、Git、终端或工作树时使用。', 'Folders are only needed for files, Git, terminal, or worktrees.')}</span>
            <button onClick={createProject}>{tr('添加工作目录', 'Add working folder')}</button>
          </div>
        )}

        {query && visibleProjects.length === 0 && visiblePersonalThreads.length === 0 && (
          <div className="wb-empty-side">
            <strong>{tr('没有匹配项', 'No matches')}</strong>
            <span>{tr('换一个工作目录或会话名称试试。', 'Try another folder or session name.')}</span>
          </div>
        )}

        {visibleProjects.map(({ workspace, allThreads, visibleThreads, runningCount }) => {
          const active = workspace.id === workspaceId
          const isCollapsed = query ? false : collapsed[workspace.id] === true
          return (
            <section key={workspace.id} className={'wb-project-group' + (active ? ' active' : '')}>
              <div className="wb-project-row">
                <button
                  className="wb-project-collapse"
                  onClick={() => setCollapsed(current => ({ ...current, [workspace.id]: !isCollapsed }))}
                  title={isCollapsed ? tr('展开工作目录', 'Expand folder') : tr('折叠工作目录', 'Collapse folder')}
                >
                  <Icon d={isCollapsed ? IC.chev : IC.chevDown} size={13} />
                </button>
                <button className="wb-project-main" onClick={() => selectWorkspace(workspace.id)} title={workspace.rootPath}>
                  <Icon d={IC.folder} size={15} />
                  <span>{workspace.name}</span>
                  <small title={tr(`${allThreads.length} 个会话`, `${allThreads.length} sessions`)}>
                    {runningCount > 0 && <i className="wb-project-running">{runningCount}</i>}
                    {allThreads.length || ''}
                  </small>
                </button>
                <button
                  className="wb-project-add"
                  title={tr('在工作目录中新建会话', 'New session in folder')}
                  onClick={() => createThreadInWorkspace(workspace.id)}
                >
                  <Icon d={IC.plus} size={13} />
                </button>
              </div>
              {!isCollapsed && (
                <div className="wb-project-sessions">
                  {active && allThreads.length === 0 && (
                    <button className="wb-session-empty" onClick={() => createThreadInWorkspace(workspace.id)}>{tr('开始第一个会话', 'Start first session')}</button>
                  )}
                  {visibleThreads.map(thread => (
                    <ThreadItem
                      key={thread.id}
                      thread={thread}
                      active={thread.id === activeThreadId}
                      pending={thread.id === pendingThreadId}
                      selectThread={selectThread}
                      onRename={startRename}
                      onDelete={removeThread}
                    />
                  ))}
                  {query && visibleThreads.length === 0 && (
                    <span className="wb-session-filter-empty">{tr('没有匹配的会话', 'No matching sessions')}</span>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <div className="wb-sidebar-footer">
        <button onClick={() => setView('settings')}>
          <Icon d={IC.gear} size={15} />
          {tr('设置', 'Settings')}
        </button>
        <span>{proxyHost}</span>
      </div>

      {renaming && (
        <div className="wb-modal-backdrop" onMouseDown={() => !renamingBusy && setRenaming(null)}>
          <form className="wb-rename-modal" onMouseDown={event => event.stopPropagation()} onSubmit={submitRename}>
            <div className="wb-project-modal-head">
              <div>
                <strong>{tr('重命名会话', 'Rename session')}</strong>
                <span>{tr('给这个会话起一个方便在列表里扫描的短名称。', 'Give this thread a short name that stays easy to scan in the list.')}</span>
              </div>
              <button type="button" disabled={renamingBusy} onClick={() => setRenaming(null)}>
                <Icon d={IC.x} size={14} />
              </button>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={event => setRenameValue(event.target.value)}
              onFocus={event => event.currentTarget.select()}
              disabled={renamingBusy}
            />
            <div className="wb-project-modal-actions">
              <button type="button" disabled={renamingBusy} onClick={() => setRenaming(null)}>{tr('取消', 'Cancel')}</button>
              <button className="primary" disabled={renamingBusy || !renameValue.trim()} type="submit">
                {renamingBusy ? tr('保存中', 'Saving') : tr('重命名', 'Rename')}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}

function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)))
}

function ThreadItem({
  thread,
  active,
  pending,
  selectThread,
  onRename,
  onDelete
}: {
  thread: WorkbenchThread
  active: boolean
  pending: boolean
  selectThread: (id: string | null) => void
  onRename: (thread: WorkbenchThread) => void
  onDelete: (thread: WorkbenchThread) => void
}) {
  const running = thread.lastTurnStatus === 'running' || thread.lastTurnStatus === 'queued'
  return (
    <div className={'wb-thread-item' + (active ? ' active' : '') + (pending ? ' pending' : '')}>
      <button className="wb-thread-main" onClick={() => selectThread(thread.id)} title={thread.title} aria-busy={pending}>
        <span>{thread.title}</span>
        <small>
          <i className={'wb-thread-status ' + statusClass(thread.lastTurnStatus)}></i>
          {pending && <i className="wb-thread-running" title={tr('切换中', 'Switching')} />}
          {statusLabel(thread.lastTurnStatus)} / {relativeTime(thread.updatedAt)}
        </small>
      </button>
      <div className="wb-thread-actions">
        {running && <span className="wb-thread-running" title={tr('运行中', 'Running')}></span>}
        <button title={tr('重命名会话', 'Rename session')} onClick={() => onRename(thread)}>
          <Icon d={IC.pencil} size={12} />
        </button>
        <button title={tr('删除会话', 'Delete session')} onClick={() => onDelete(thread)}>
          <Icon d={IC.trash} size={12} />
        </button>
      </div>
    </div>
  )
}

function groupThreadsByWorkspace(threads: WorkbenchThread[]): Map<string, WorkbenchThread[]> {
  const grouped = new Map<string, WorkbenchThread[]>()
  for (const thread of threads) {
    const key = thread.workspaceId || PERSONAL_WORKSPACE_KEY
    grouped.set(key, [...(grouped.get(key) ?? []), thread])
  }
  for (const [workspaceId, items] of grouped.entries()) {
    grouped.set(workspaceId, [...items].sort((a, b) => b.updatedAt - a.updatedAt))
  }
  return grouped
}

function statusLabel(status?: WorkbenchTurnStatus): string {
  if (!status) return tr('空闲', 'idle')
  if (status === 'completed') return tr('完成', 'done')
  if (status === 'running') return tr('运行中', 'running')
  if (status === 'queued') return tr('排队中', 'queued')
  if (status === 'failed') return tr('失败', 'failed')
  if (status === 'cancelled') return tr('已取消', 'cancelled')
  return status
}

function statusClass(status?: WorkbenchTurnStatus): string {
  if (status === 'running' || status === 'queued') return 'busy'
  if (status === 'failed') return 'error'
  if (status === 'completed') return 'idle'
  return 'off'
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return tr('刚刚', 'now')
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}${tr('分', 'm')}`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}${tr('小时', 'h')}`
  return `${Math.round(diff / 86_400_000)}${tr('天', 'd')}`
}
