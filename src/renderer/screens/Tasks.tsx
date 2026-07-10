import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, AgentMark, Enter, Seg, Collapse } from '../glass/ui'
import { TaskItem, sumTokens, fmtTokens, usageTotal, sumCost, costOf, fmtCost } from '../glass/meta'
import { SetupTab, firstRunActionForError } from '../glass/connection-status'
import { ActivityTrail } from '../glass/activity-view'
import type { WorkspaceItem } from '../workbench/types'

const STATUS_LABEL: Record<TaskItem['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

const STATUS_COLOR: Record<TaskItem['status'], string> = {
  running: 'var(--st-busy)',
  completed: 'var(--st-idle)',
  failed: 'var(--st-error)',
  cancelled: 'var(--tx-3)'
}

const MODE_LABEL: Record<string, string> = {
  auto: '自动路由',
  broadcast: '广播',
  chain: '链式交接',
  orchestrate: '编排',
  'lead-workers': '主控 + 工作组',
  'parallel-review': '并行评审',
  'firefly-custom': '智能五角色',
  custom: '自定义调度'
}

function StatusBadge({ status }: { status: TaskItem['status'] }) {
  const color = STATUS_COLOR[status] || 'var(--tx-3)'
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      color,
      border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      background: `color-mix(in srgb, ${color} 11%, transparent)`,
      borderRadius: 999,
      padding: '2px 9px',
      whiteSpace: 'nowrap'
    }}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  return (
    <button
      className="ah-btn sm"
      title="复制内容"
      style={{ flex: 'none', padding: '4px 9px' }}
      onClick={(event) => {
        event.stopPropagation()
        try {
          navigator.clipboard?.writeText(text)
          setDone(true)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setDone(false), 1200)
        } catch {
          // noop
        }
      }}
    >
      <Icon d={done ? IC.check : IC.copy} size={12} /> {done ? '已复制' : '复制'}
    </button>
  )
}

export function TasksScreen({ tasks, workspaces, search, onCancelTask, onDeleteTask, onClearCompleted, openSetup }: {
  tasks: TaskItem[]
  workspaces: WorkspaceItem[]
  search: string
  onCancelTask: (id: string) => void
  onDeleteTask: (id: string) => void
  onClearCompleted: (workspaceId?: string | null) => void
  openSetup: (tab?: SetupTab) => void
}) {
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const groups = useMemo(() => groupTasksByWorkspace(tasks, workspaces, filter, search), [filter, search, tasks, workspaces])
  const totalVisibleTasks = groups.reduce((sum, group) => sum + group.tasks.length, 0)

  return (
    <div data-screen-label="任务" style={{ padding: '6px 4px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>任务历史</h2>
          <div className="ah-hint" style={{ marginTop: 4 }}>按工作目录收纳任务卡片；隐藏任务不会删除对话内容。</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Seg value={filter} onChange={setFilter} options={[
            { value: 'all', label: '全部' },
            { value: 'running', label: '运行中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'cancelled', label: '已取消' }
          ]} />
        </div>
      </div>

      {totalVisibleTasks === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: 'center', color: 'var(--tx-3)' }}>没有匹配的任务</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map((group, index) => (
          <WorkspaceTaskCard
            key={group.id}
            group={group}
            index={index}
            open={openGroup ? openGroup === group.id : index === 0}
            openTask={openTask}
            setOpenGroup={setOpenGroup}
            setOpenTask={setOpenTask}
            onCancelTask={onCancelTask}
            onDeleteTask={onDeleteTask}
            onClearCompleted={onClearCompleted}
            openSetup={openSetup}
          />
        ))}
      </div>
    </div>
  )
}

function WorkspaceTaskCard({
  group,
  index,
  open,
  openTask,
  setOpenGroup,
  setOpenTask,
  onCancelTask,
  onDeleteTask,
  onClearCompleted,
  openSetup
}: {
  group: WorkspaceTaskGroup
  index: number
  open: boolean
  openTask: string | null
  setOpenGroup: (id: string | null) => void
  setOpenTask: (id: string | null) => void
  onCancelTask: (id: string) => void
  onDeleteTask: (id: string) => void
  onClearCompleted: (workspaceId?: string | null) => void
  openSetup: (tab?: SetupTab) => void
}) {
  const groupTokenTotal = group.tasks.reduce((sum, task) => sum + sumTokens(task.usage), 0)
  const groupCostValues = group.tasks.map(task => sumCost(task.usage)).filter((value): value is number => value != null)
  const groupCost = groupCostValues.length ? groupCostValues.reduce((sum, value) => sum + value, 0) : null
  const finishedCount = group.tasks.filter(task => task.status !== 'running').length

  return (
    <Enter delay={index * 35} className="glass" style={{ overflow: 'hidden' }}>
      <div
        onClick={() => setOpenGroup(open ? '__closed__' : group.id)}
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', minWidth: 0 }}
      >
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <strong style={{ fontSize: 14, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</strong>
          <span className="ah-hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.rootPath || '个人会话'} · {group.tasks.length} 个任务</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className="ah-chip">运行 {group.running}</span>
          <span className="ah-chip">完成 {group.completed}</span>
          {group.failed > 0 && <span className="ah-chip" style={{ color: 'var(--st-error)' }}>失败 {group.failed}</span>}
          {groupTokenTotal > 0 && (
            <span className="ah-chip" title="Token 总量 / 估算费用" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {fmtTokens(groupTokenTotal)} tok{groupCost != null ? ` · ${fmtCost(groupCost)}` : ''}
            </span>
          )}
          <button
            className="ah-btn sm"
            disabled={finishedCount === 0}
            onClick={event => { event.stopPropagation(); onClearCompleted(group.workspaceId) }}
            title="只隐藏该工作目录已结束的任务卡片"
          >
            <Icon d={IC.trash} size={12} /> 清理已结束
          </button>
        </div>
        <Icon d={IC.chevDown} size={14} style={{ color: 'var(--tx-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      <Collapse open={open}>
        <div style={{ borderTop: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column' }}>
          {group.tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              open={openTask === task.id}
              setOpenTask={setOpenTask}
              onCancelTask={onCancelTask}
              onDeleteTask={onDeleteTask}
              openSetup={openSetup}
            />
          ))}
        </div>
      </Collapse>
    </Enter>
  )
}

function TaskRow({ task, open, setOpenTask, onCancelTask, onDeleteTask, openSetup }: {
  task: TaskItem
  open: boolean
  setOpenTask: (id: string | null) => void
  onCancelTask: (id: string) => void
  onDeleteTask: (id: string) => void
  openSetup: (tab?: SetupTab) => void
}) {
  const tokenTotal = sumTokens(task.usage)
  const cost = sumCost(task.usage)

  return (
    <div style={{ borderTop: '1px solid color-mix(in srgb, var(--glass-border) 60%, transparent)' }}>
      <div
        onClick={() => setOpenTask(open ? null : task.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', cursor: 'pointer', minWidth: 0 }}
      >
        <StatusBadge status={task.status} />
        <div style={{ flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.text}</span>
          {task.threadTitle && <small className="ah-hint">{task.threadTitle}</small>}
        </div>
        <span className="ah-chip">{MODE_LABEL[task.mode] || task.mode}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {task.agents.map(agentId => <AgentMark key={agentId} id={agentId} size={20} radius={6} />)}
        </div>
        {tokenTotal > 0 && (
          <span className="ah-chip" title="Token 总量 / 估算费用" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {fmtTokens(tokenTotal)} tok{cost != null ? ` · ${fmtCost(cost)}` : ''}
          </span>
        )}
        <span className="ah-hint" style={{ width: 52, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
          {task.status === 'running' ? '-' : formatDuration(task.durationMs)}
        </span>
        <span className="ah-hint" style={{ width: 46, textAlign: 'right' }}>{task.createdAt}</span>
        {task.status === 'running' ? (
          <button className="ah-btn sm danger" onClick={event => { event.stopPropagation(); onCancelTask(task.id) }}>取消</button>
        ) : (
          <button className="ah-btn sm danger" onClick={event => { event.stopPropagation(); onDeleteTask(task.id) }}>
            <Icon d={IC.trash} size={12} /> 隐藏
          </button>
        )}
        <Icon d={IC.chevDown} size={14} style={{ color: 'var(--tx-3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      <Collapse open={open}>
        <TaskDetails task={task} openSetup={openSetup} tokenTotal={tokenTotal} cost={cost} />
      </Collapse>
    </div>
  )
}

function TaskDetails({ task, openSetup, tokenTotal, cost }: {
  task: TaskItem
  openSetup: (tab?: SetupTab) => void
  tokenTotal: number
  cost: number | null
}) {
  return (
    <div style={{ borderTop: '1px solid var(--glass-border)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>
        {task.id} · {MODE_LABEL[task.mode] || task.mode} · {task.agents.length} 个 Agent
      </div>
      {tokenTotal > 0 && (
        <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--mint)' }}>Token 合计 {fmtTokens(tokenTotal)}{cost != null ? ` · ${fmtCost(cost)}` : ''}</span>
          {Object.entries(task.usage || {}).map(([agentId, usage]) => (
            <span key={agentId} style={{ color: 'var(--tx-3)' }}>
              {agentId}: {fmtTokens(usageTotal(usage))} (输入 {fmtTokens(usage.prompt_tokens || 0)} / 输出 {fmtTokens(usage.completion_tokens || 0)}){costOf(usage) != null ? ` · ${fmtCost(costOf(usage)! )}` : ''}
            </span>
          ))}
        </div>
      )}
      {task.results && Object.entries(task.results).map(([agentId, content]) => (
        <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AgentMark id={agentId} size={24} radius={7} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {task.steps?.[agentId]?.length ? <ActivityTrail steps={task.steps[agentId]} running={task.status === 'running'} /> : null}
            <div style={{ fontSize: 13, color: 'var(--tx-2)', background: 'var(--bg-task-content)', borderRadius: 10, padding: '9px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
          </div>
          {content && <CopyBtn text={content} />}
        </div>
      ))}
      {task.errors && Object.entries(task.errors).map(([agentId, error]) => {
        const action = firstRunActionForError(error)
        return (
          <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <AgentMark id={agentId} size={24} radius={7} />
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {task.steps?.[agentId]?.length ? <ActivityTrail steps={task.steps[agentId]} running={false} /> : null}
              <div style={{ fontSize: 12.5, color: 'var(--st-error)', background: 'var(--bg-error-subtle)', border: '1px solid var(--border-error-subtle)', borderRadius: 10, padding: '9px 13px', fontFamily: 'var(--font-mono)' }}>{error}</div>
            </div>
            {action && <button className="ah-btn sm primary" onClick={() => openSetup(action.tab)}>去设置</button>}
            {error && <CopyBtn text={error} />}
          </div>
        )
      })}
      {task.steps && Object.entries(task.steps).map(([agentId, steps]) =>
        (steps?.length && !task.results?.[agentId] && !task.errors?.[agentId]) ? (
          <div key={`steps-${agentId}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AgentMark id={agentId} size={24} radius={7} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <ActivityTrail steps={steps} running={task.status === 'running'} />
            </div>
          </div>
        ) : null
      )}
    </div>
  )
}

interface WorkspaceTaskGroup {
  id: string
  workspaceId: string | null
  name: string
  rootPath: string
  tasks: TaskItem[]
  running: number
  completed: number
  failed: number
}

function groupTasksByWorkspace(tasks: TaskItem[], workspaces: WorkspaceItem[], filter: string, search: string): WorkspaceTaskGroup[] {
  const workspaceById = new Map(workspaces.map(workspace => [workspace.id, workspace]))
  const term = search.trim().toLowerCase()
  const groups = new Map<string, WorkspaceTaskGroup>()

  for (const task of tasks) {
    if (filter !== 'all' && task.status !== filter) continue
    const workspace = task.workspaceId ? workspaceById.get(task.workspaceId) : null
    const groupId = task.workspaceId ? `workspace:${task.workspaceId}` : 'personal'
    const group = groups.get(groupId) || {
      id: groupId,
      workspaceId: task.workspaceId ?? null,
      name: workspace?.name || (task.workspaceId ? '工作目录' : '个人会话'),
      rootPath: workspace?.rootPath || '',
      tasks: [],
      running: 0,
      completed: 0,
      failed: 0
    }
    const groupMatches = !term || [group.name, group.rootPath].some(value => value.toLowerCase().includes(term))
    const taskMatches = !term || [
      task.text,
      task.threadTitle || '',
      task.mode,
      ...task.agents
    ].some(value => String(value).toLowerCase().includes(term))
    if (!groupMatches && !taskMatches) {
      groups.set(groupId, group)
      continue
    }
    group.tasks.push(task)
    if (task.status === 'running') group.running += 1
    else if (task.status === 'failed') group.failed += 1
    else group.completed += 1
    groups.set(groupId, group)
  }

  return [...groups.values()].filter(group => group.tasks.length > 0)
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
