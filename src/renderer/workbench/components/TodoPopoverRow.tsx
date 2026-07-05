import React from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'

interface TodoPopoverRowProps {
  todo: ThreadTodo
  onStatus: (todo: ThreadTodo, status: ThreadTodoStatus) => void
  onDelete: (todoId: string) => void
  onDispatch?: (todo: ThreadTodo) => void
  dispatching?: boolean
}

export function TodoPopoverRow({ todo, onStatus, onDelete, onDispatch, dispatching = false }: TodoPopoverRowProps) {
  const nextStatus: ThreadTodoStatus = todo.status === 'completed' ? 'pending' : 'completed'
  const canDispatch = !!onDispatch && todo.status !== 'completed'
  return (
    <div className={'wb-top-todo-row status-' + todo.status}>
      <button
        className="wb-top-todo-check"
        type="button"
        onClick={() => onStatus(todo, nextStatus)}
        title={todo.status === 'completed' ? tr('恢复待办', 'Mark pending') : tr('标记完成', 'Mark done')}
      >
        {todo.status === 'completed' && <Icon d={IC.check} size={12} />}
      </button>
      <div className="wb-top-todo-body">
        <button
          className="wb-top-todo-content"
          type="button"
          onClick={() => onStatus(todo, todo.status === 'in_progress' ? 'pending' : 'in_progress')}
          title={todo.content}
        >
          <span>{todo.content}</span>
        </button>
        <div className="wb-top-todo-status-btns">
          {(['pending', 'in_progress', 'completed'] as ThreadTodoStatus[]).map(status => (
            <button
              key={status}
              className={'wb-top-todo-status-btn' + (todo.status === status ? ' active' : '')}
              type="button"
              onClick={() => onStatus(todo, status)}
              title={status === 'pending' ? tr('待处理', 'Pending') : status === 'in_progress' ? tr('进行中', 'In progress') : tr('已完成', 'Done')}
            >
              {status === 'pending' ? tr('待办', 'Todo') : status === 'in_progress' ? tr('进行', 'WIP') : tr('完成', 'Done')}
            </button>
          ))}
        </div>
      </div>
      {canDispatch && (
        <button
          className="wb-top-todo-run"
          type="button"
          onClick={() => onDispatch(todo)}
          disabled={dispatching}
          title={todo.source?.turnId ? tr('重新派发到 Agent', 'Run again with agent') : tr('派发到 Agent', 'Run with agent')}
        >
          <Icon d={dispatching ? IC.pulse : IC.send} size={12} />
        </button>
      )}
      <button className="wb-top-todo-delete" type="button" onClick={() => onDelete(todo.id)} title={tr('删除', 'Delete')}>
        <Icon d={IC.x} size={12} />
      </button>
    </div>
  )
}
