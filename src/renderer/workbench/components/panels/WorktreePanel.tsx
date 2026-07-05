import React, { useCallback, useEffect, useState } from 'react'
import { tr } from '../../../glass/i18n'
import { styledConfirm } from '../../../lib/confirm'
import { PanelTitle } from '../PanelTitle'

interface WorktreeItem {
  id: string
  branch: string
  path: string
  status: 'clean' | 'dirty' | 'missing'
}

function worktreeStatusLabel(status: WorktreeItem['status']): string {
  if (status === 'dirty') return tr('有变更', 'Dirty')
  if (status === 'missing') return tr('路径丢失', 'Missing')
  return tr('干净', 'Clean')
}

interface WorktreePanelProps {
  workspaceId: string | null
  onClose: () => void
}

export function WorktreePanel({ workspaceId, onClose }: WorktreePanelProps) {
  const [items, setItems] = useState<WorktreeItem[]>([])
  const [branch, setBranch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setItems([])
      return
    }
    setItems(await window.electronAPI.worktrees.list(workspaceId).catch(() => []))
  }, [workspaceId])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  const create = async () => {
    if (!workspaceId || !branch.trim()) return
    setLoading(true)
    try {
      setError(null)
      await window.electronAPI.worktrees.create({ parentWorkspaceId: workspaceId, branch: branch.trim() })
      setBranch('')
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('创建工作树失败。', 'Failed to create worktree.'))
    } finally {
      setLoading(false)
    }
  }

  const sync = async (id: string) => {
    setLoading(true)
    try {
      setError(null)
      await window.electronAPI.worktrees.sync(id)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('同步工作树失败。', 'Failed to sync worktree.'))
    } finally {
      setLoading(false)
    }
  }

  const open = async (id: string) => {
    try {
      setError(null)
      await window.electronAPI.worktrees.open(id)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('打开工作树失败。', 'Failed to open worktree.'))
    }
  }

  const remove = async (item: WorktreeItem) => {
    const force = item.status === 'dirty'
    const message = force
      ? tr('这个工作树有未提交变更。确认强制删除并移除记录？', 'This worktree has uncommitted changes. Force remove it?')
      : tr('删除这个工作树并移除记录？', 'Remove this worktree and its record?')
    const ok = await styledConfirm({ message, danger: force })
    if (!ok) return
    try {
      setError(null)
      await window.electronAPI.worktrees.remove(item.id, force)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('删除工作树失败。', 'Failed to remove worktree.'))
    }
  }

  return (
    <div className="wb-tool-panel">
      <PanelTitle title={tr('工作树', 'Worktrees')} subtitle={tr('隔离分支目录', 'Isolated branch folders')} onClose={onClose} onRefresh={refresh} />
      {!workspaceId && <div className="wb-muted-box">{tr('工作树需要先选择 Git 工作目录。', 'Choose a Git working folder to use worktrees.')}</div>}
      {workspaceId && (
        <>
          <div className="wb-tool-inline-form">
            <input value={branch} onChange={e => setBranch(e.target.value)} placeholder={tr('新分支名称', 'New branch name')} />
            <button onClick={create} disabled={loading || !branch.trim()}>{tr('创建', 'Create')}</button>
          </div>
          {items.length === 0 && <div className="wb-muted-box">{tr('还没有工作树。', 'No worktrees yet.')}</div>}
          {items.map(item => (
            <div key={item.id} className="wb-tool-row">
              <strong>{item.branch}</strong>
              <small>{worktreeStatusLabel(item.status)} · {item.path}</small>
              <div className="wb-tool-actions compact">
                <button onClick={() => open(item.id)}>{tr('打开', 'Open')}</button>
                <button onClick={() => sync(item.id)} disabled={loading}>{tr('同步', 'Sync')}</button>
                <button onClick={() => remove(item)} className="danger">{tr('删除', 'Delete')}</button>
              </div>
            </div>
          ))}
          {error && <div className="wb-send-error">{error}</div>}
        </>
      )}
    </div>
  )
}
