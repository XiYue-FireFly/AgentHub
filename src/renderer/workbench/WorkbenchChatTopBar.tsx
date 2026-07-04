import React, { useEffect, useRef, useState } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import type { WorkbenchRightPanel } from './NativeTitlebar'
import { ToolPanelBar } from './WorkbenchPanels'
import { TodoPopoverRow } from './components/TodoPopoverRow'

type RightPanel = WorkbenchRightPanel

interface WorkbenchChatTopBarProps {
  title: string
  workspaceName: string
  workspaceTitle: string
  openWorkspace: () => void
  workspaceRoot: string | null
  activePanel: RightPanel
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  readyLocalAgents: number
  openTasks: () => void
  todos: ThreadTodo[]
  activeThreadId: string | null
  updateTodoStatus: (todo: ThreadTodo, status: ThreadTodoStatus) => void
  deleteTodo: (todoId: string) => void
}

export function WorkbenchChatTopBar({
  title,
  workspaceName,
  workspaceTitle,
  openWorkspace,
  workspaceRoot,
  activePanel,
  setPanel,
  workspaceId,
  readyLocalAgents,
  openTasks,
  todos,
  activeThreadId,
  updateTodoStatus,
  deleteTodo
}: WorkbenchChatTopBarProps) {
  const [todoOpen, setTodoOpen] = useState(false)
  const todoRef = useRef<HTMLDivElement | null>(null)
  const openTodos = todos.filter(todo => todo.status !== 'completed')
  const completedTodos = todos.filter(todo => todo.status === 'completed')
  const inProgressTodos = todos.filter(todo => todo.status === 'in_progress')
  const pendingCount = Math.max(0, todos.length - completedTodos.length - inProgressTodos.length)

  useEffect(() => {
    if (!todoOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!todoRef.current?.contains(event.target as Node)) setTodoOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [todoOpen])

  return (
    <>
      <div className="wb-minimal-head-left">
        <button className="wb-minimal-project" type="button" onClick={openWorkspace} title={workspaceTitle}>
          <Icon d={IC.folder} size={14} />
          <span>{workspaceName}</span>
          <Icon d={IC.chevDown} size={12} />
        </button>
        <span className="wb-minimal-title">{title}</span>
      </div>
      <div className="wb-minimal-head-actions">
        <button
          className="wb-minimal-tool-button"
          type="button"
          disabled={!workspaceRoot}
          onClick={() => workspaceRoot && window.electronAPI.app.openPath({ path: workspaceRoot, target: 'editor' })}
          title={workspaceRoot ? tr('打开编辑器', 'Open editor') : tr('选择工作目录后可用', 'Choose a working folder first')}
        >
          <Icon d={IC.folder} size={15} />
          <span>{tr('打开编辑器', 'Open editor')}</span>
        </button>
        <ToolPanelBar activePanel={activePanel} setPanel={setPanel} workspaceId={workspaceId} iconOnly />
        <button
          className={'wb-minimal-tool-button' + (activePanel === 'runs' ? ' active' : '')}
          onClick={() => setPanel(activePanel === 'runs' ? null : 'runs')}
          title={tr('运行', 'Runs')}
        >
          <Icon d={IC.tasks} size={15} />
          {readyLocalAgents > 0 && <small>{readyLocalAgents}</small>}
        </button>
        <div className="wb-top-todo" ref={todoRef}>
          <button
            className={'wb-minimal-tool-button' + (todoOpen ? ' active' : '')}
            onClick={() => setTodoOpen(open => !open)}
            title={tr('Todo / Agent 分步任务', 'Todo / agent plan tasks')}
          >
            <Icon d={IC.tasks} size={15} />
            <span>Todo</span>
            {openTodos.length > 0 && <small>{Math.min(99, openTodos.length)}</small>}
          </button>
          {todoOpen && (
            <div className="wb-top-todo-popover">
              <div className="wb-top-todo-head">
                <div>
                  <strong>Todo</strong>
                  <span>{activeThreadId ? tr('当前会话的 Agent 分步任务', 'Agent plan tasks for this thread') : tr('还没有打开会话', 'No active thread')}</span>
                </div>
                <button className="ah-btn sm" type="button" onClick={openTasks}>{tr('完整任务页', 'Task page')}</button>
              </div>
              {todos.length > 0 && (
                <div className="wb-top-todo-stats">
                  <div className="wb-top-todo-stat">
                    <strong>{pendingCount}</strong>
                    <span>{tr('待处理', 'Pending')}</span>
                  </div>
                  <div className="wb-top-todo-stat">
                    <strong>{inProgressTodos.length}</strong>
                    <span>{tr('进行中', 'In Progress')}</span>
                  </div>
                  <div className="wb-top-todo-stat">
                    <strong>{completedTodos.length}</strong>
                    <span>{tr('已完成', 'Done')}</span>
                  </div>
                </div>
              )}
              <div className="wb-top-todo-list">
                {todos.length === 0 && (
                  <div className="wb-top-todo-empty">
                    {tr('Agent 生成计划后，分步任务会显示在这里。', 'Agent-generated plan steps will appear here.')}
                  </div>
                )}
                {openTodos.map(todo => (
                  <TodoPopoverRow
                    key={todo.id}
                    todo={todo}
                    onStatus={updateTodoStatus}
                    onDelete={deleteTodo}
                  />
                ))}
                {completedTodos.length > 0 && (
                  <details className="wb-top-todo-done">
                    <summary>{tr(`已完成 ${completedTodos.length} 项`, `${completedTodos.length} completed`)}</summary>
                    {completedTodos.slice(0, 8).map(todo => (
                      <TodoPopoverRow
                        key={todo.id}
                        todo={todo}
                        onStatus={updateTodoStatus}
                        onDelete={deleteTodo}
                      />
                    ))}
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
