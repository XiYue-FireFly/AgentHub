/**
 * GitBranchControl: inline Git branch switcher.
 *
 * Shows current branch name, sync status, and uncommitted file count.
 * Clicking opens a popover with branch list, search, and create-and-checkout.
 *
 * Extracted from WorkbenchLayout.tsx to reduce monolith size.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'

export function GitBranchControl({ workspaceId, onOpenGit, compact = false }: {
  workspaceId: string | null
  onOpenGit: () => void
  compact?: boolean
}) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const branchInputRef = useRef<HTMLInputElement | null>(null)

  // LOW-19: Separate status and branches fetch into independent effects
  const refreshStatus = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null)
      setError(null)
      return null
    }
    setLoading(true)
    try {
      const nextStatus = await window.electronAPI.git.status(workspaceId)
      setStatus(nextStatus)
      setError(nextStatus.isRepo ? null : (nextStatus.error || tr('未检测到 Git 仓库。', 'No Git repository detected.')))
      return nextStatus
    } catch (e: any) {
      setError(e?.message || tr('读取 Git 状态失败。', 'Failed to read Git status.'))
      return null
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { refreshStatus().catch(() => {}) }, [refreshStatus])

  useEffect(() => {
    if (!workspaceId || !open || !status?.isRepo) {
      if (!open) setBranches([])
      return
    }
    let cancelled = false
    window.electronAPI.git.branches(workspaceId)
      .then(response => { if (!cancelled) setBranches(response?.localBranches || []) })
      .catch(() => { if (!cancelled) setBranches([]) })
    return () => { cancelled = true }
  }, [workspaceId, open, status?.isRepo])

  const refresh = useCallback(async () => {
    const nextStatus = await refreshStatus()
    if (open && nextStatus?.isRepo) {
      const branchResponse = await window.electronAPI.git.branches(workspaceId).catch(() => null)
      setBranches(branchResponse?.localBranches || [])
    }
  }, [refreshStatus, open, workspaceId])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => branchInputRef.current?.focus(), 0)
    const onPointerDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!workspaceId || !status?.isRepo) {
    const label = !workspaceId ? tr('未绑定目录', 'No workspace') : tr('不是 Git 仓库', 'Not a Git repo')
    return (
      <div className={'wb-git-branch-control empty' + (compact ? ' compact' : '')} title={error || label}>
        <button type="button" className="wb-git-branch-summary" onClick={onOpenGit}>
          <Icon d={IC.git} size={13} /><span>{label}</span><small>Git</small>
        </button>
        <button type="button" className="wb-git-branch-add" onClick={onOpenGit} title={tr('打开 Git 面板', 'Open Git panel')}>
          <Icon d={IC.plus} size={13} />
        </button>
      </div>
    )
  }

  const dirty = (status?.files?.length ?? 0) > 0
  const syncLabel = status.ahead || status.behind ? `↑${status.ahead} ↓${status.behind}` : tr('同步', 'synced')

  const checkout = async (branch: string) => {
    if (!branch || branch === status.branch) return
    try {
      setError(null)
      await window.electronAPI.git.checkoutBranch(workspaceId, branch)
      await refresh()
      setOpen(false)
    } catch (e: any) {
      setError(e?.message || tr('切换分支失败。', 'Failed to checkout branch.'))
      onOpenGit()
    }
  }

  const create = async (branch = query) => {
    if (!branch.trim()) return
    try {
      setError(null)
      await window.electronAPI.git.createBranch(workspaceId, branch.trim(), true)
      await refresh()
      setQuery('')
      setOpen(false)
    } catch (e: any) {
      setError(e?.message || tr('创建分支失败。', 'Failed to create branch.'))
      onOpenGit()
    }
  }

  const filteredBranches = branches.filter(b => b.name.toLowerCase().includes(query.trim().toLowerCase()))
  const canCreate = !!query.trim() && !branches.some(b => b.name.toLowerCase() === query.trim().toLowerCase())
  const dirtyLabel = dirty ? tr(`未提交：${status.files.length} 个文件`, `Uncommitted: ${status.files.length} files`) : syncLabel

  return (
    <div className={'wb-git-branch-control' + (compact ? ' compact' : '')} title={error || `${status.branch} · ${syncLabel}`} ref={popoverRef}>
      <button type="button" className="wb-git-branch-summary" onClick={() => setOpen(v => !v)}>
        <Icon d={IC.git} size={13} /><span>{status.branch || 'HEAD'}</span>
        <small>{dirty ? `${status.files.length} ${tr('变更', 'changes')}` : syncLabel}</small>
      </button>
      <button type="button" className="wb-git-branch-add" onClick={() => { setOpen(true); window.setTimeout(() => branchInputRef.current?.focus(), 0) }} disabled={loading} title={tr('新建或切换分支', 'Create or switch branch')}>
        <Icon d={IC.plus} size={13} />
      </button>
      {open && (
        <div className="wb-git-branch-popover">
          <div className="wb-git-branch-search">
            <Icon d={IC.search} size={14} />
            <input ref={branchInputRef} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { if (canCreate && !dirty) create(); else if (filteredBranches[0] && !dirty) checkout(filteredBranches[0].name) } }}
              placeholder={tr('搜索或输入新分支名', 'Search or type a new branch')} autoFocus />
          </div>
          <div className="wb-git-branch-popover-title">{tr('分支', 'Branches')}</div>
          {dirty && <div className="wb-git-branch-warning">{tr('有未提交变更时暂不切换或创建分支。', 'Commit or save changes before switching or creating branches.')}</div>}
          <div className="wb-git-branch-list">
            {filteredBranches.map(branch => (
              <button key={branch.name} type="button" className={branch.current ? 'active' : ''}
                onClick={() => checkout(branch.name)} disabled={loading || dirty || branch.current}>
                <Icon d={IC.broadcast} size={15} />
                <span><strong>{branch.name}</strong>{branch.current && <small>{dirtyLabel}</small>}</span>
                {branch.current && <Icon d={IC.check} size={15} />}
              </button>
            ))}
            {filteredBranches.length === 0 && <div className="wb-muted-box">{tr('没有匹配的分支。', 'No matching branches.')}</div>}
          </div>
          <div className="wb-git-branch-footer">
            <button type="button" onClick={onOpenGit}>{tr('Git 面板', 'Git panel')}</button>
            <button type="button" onClick={() => create()} disabled={!canCreate || loading || dirty}>
              {canCreate ? `${tr('创建并检出', 'Create and checkout')} ${query.trim()}` : tr('创建并检出新分支...', 'Create and checkout new branch...')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
