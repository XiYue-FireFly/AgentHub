import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'

type GitViewMode = 'changes' | 'branches' | 'commits'
type GitDiffMode = 'working' | 'commit'
type GitChangeSection = 'staged' | 'unstaged'

interface GitWorkbenchPanelProps {
  workspaceId: string | null
  onClose: () => void
}

export function GitWorkbenchPanel({ workspaceId, onClose }: GitWorkbenchPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchListResponse | null>(null)
  const [log, setLog] = useState<GitLogResponse | null>(null)
  const [diffs, setDiffs] = useState<GitFileDiff[]>([])
  const [workingDiffCache, setWorkingDiffCache] = useState<Record<string, string>>({})
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null)
  const [commitDetails, setCommitDetails] = useState<GitCommitDetails | null>(null)
  const [commitDiffs, setCommitDiffs] = useState<GitCommitDiff[]>([])
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [branchQuery, setBranchQuery] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [viewMode, setViewMode] = useState<GitViewMode>('changes')
  const [diffMode, setDiffMode] = useState<GitDiffMode>('working')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const changedFiles = status?.files ?? []
  const stagedFiles = status?.stagedFiles ?? []
  const unstagedFiles = status?.unstagedFiles ?? []
  const selectedWorkingDiff = selectedPath ? workingDiffCache[selectedPath] || diffs.find(diff => diff.path === selectedPath)?.diff || '' : ''
  const selectedCommitDiff = useMemo(() => commitDiffs.find(diff => diff.path === selectedPath) ?? null, [commitDiffs, selectedPath])
  const activeDiffText = diffMode === 'commit'
    ? selectedCommitDiff?.diff || ''
    : selectedWorkingDiff

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null)
      setBranches(null)
      setLog(null)
      setDiffs([])
      setSelectedPath(null)
      setCheckedKeys([])
      return
    }
    setLoading(true)
    try {
      setError(null)
      const nextStatus = await window.electronAPI.git.status(workspaceId)
      if (!mountedRef.current) return
      setStatus(nextStatus)
      if (!nextStatus.isRepo) {
        setBranches(null)
        setLog(null)
        setDiffs([])
        setCheckedKeys([])
        setSelectedPath(null)
        return
      }
      const [nextBranches, nextLog] = await Promise.all([
        window.electronAPI.git.branches(workspaceId).catch(() => null),
        window.electronAPI.git.log(workspaceId, 80).catch(() => null)
      ])
      if (!mountedRef.current) return
      setBranches(nextBranches)
      setLog(nextLog)
      setDiffs([])
      setWorkingDiffCache({})
      const nextPaths = nextStatus.files.map(file => file.path)
      const nextKeys = new Set([
        ...nextStatus.stagedFiles.map(file => changeKey('staged', file.path)),
        ...nextStatus.unstagedFiles.map(file => changeKey('unstaged', file.path))
      ])
      setCheckedKeys(current => {
        const kept = current.filter(key => nextKeys.has(key))
        return kept.length ? kept : nextStatus.stagedFiles.map(file => changeKey('staged', file.path))
      })
      setSelectedPath(current => current && nextPaths.includes(current) ? current : nextPaths[0] || null)
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || tr('读取 Git 状态失败。', 'Failed to read Git status.'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    mountedRef.current = true
    refresh().catch(() => {})
    return () => { mountedRef.current = false }
  }, [refresh])

  useEffect(() => {
    if (!workspaceId || !selectedCommitSha) {
      setCommitDetails(null)
      setCommitDiffs([])
      return
    }
    let cancelled = false
    setDiffMode('commit')
    Promise.all([
      window.electronAPI.git.commitDetails(workspaceId, selectedCommitSha),
      window.electronAPI.git.commitDiff(workspaceId, selectedCommitSha)
    ]).then(([details, nextDiffs]) => {
      if (cancelled) return
      setCommitDetails(details)
      setCommitDiffs(nextDiffs)
      setSelectedPath(current => current && nextDiffs.some(diff => diff.path === current) ? current : nextDiffs[0]?.path || null)
    }).catch((e: any) => {
      if (!cancelled) setError(e?.message || tr('读取提交详情失败。', 'Failed to read commit details.'))
    })
    return () => { cancelled = true }
  }, [workspaceId, selectedCommitSha])

  useEffect(() => {
    if (!workspaceId || diffMode !== 'working' || !selectedPath || workingDiffCache[selectedPath] !== undefined) return
    let cancelled = false
    window.electronAPI.git.diff(workspaceId, selectedPath)
      .then(diff => {
        if (cancelled) return
        setWorkingDiffCache(current => ({ ...current, [selectedPath]: diff || '' }))
      })
      .catch(() => {
        if (cancelled) return
        setWorkingDiffCache(current => ({ ...current, [selectedPath]: '' }))
      })
    return () => { cancelled = true }
  }, [workspaceId, diffMode, selectedPath, workingDiffCache])

  const runAction = async (label: string, action: () => Promise<any>, after?: () => void) => {
    setActionLoading(label)
    try {
      setError(null)
      setNotice(null)
      await action()
      after?.()
      await refresh()
      setNotice(tr('操作已完成。', 'Done.'))
    } catch (e: any) {
      setError(e?.message || tr('Git 操作失败。', 'Git operation failed.'))
    } finally {
      setActionLoading(null)
    }
  }

  const togglePath = (section: GitChangeSection, path: string, checked: boolean) => {
    const key = changeKey(section, path)
    setCheckedKeys(current => checked ? Array.from(new Set([...current, key])) : current.filter(item => item !== key))
  }

  const stageFile = (file: GitFileStatus) => runAction(`stage:${file.path}`, () => window.electronAPI.git.stageFile(workspaceId, file.path))
  const unstageFile = (file: GitFileStatus) => runAction(`unstage:${file.path}`, () => window.electronAPI.git.unstageFile(workspaceId, file.path))
  const revertFile = async (file: GitFileStatus) => {
    const ok = await styledConfirm({ message: tr(`确认丢弃 ${file.path} 的变更？`, `Discard changes in ${file.path}?`), danger: true })
    if (!ok) return
    void runAction(`revert:${file.path}`, () => window.electronAPI.git.revertFile(workspaceId, file.path))
  }
  const revertAll = async () => {
    const ok = await styledConfirm({ message: tr('确认丢弃所有未提交变更？这个操作不可撤销。', 'Discard all uncommitted changes? This cannot be undone.'), danger: true })
    if (!ok) return
    void runAction('revert-all', () => window.electronAPI.git.revertAll(workspaceId))
  }
  const commit = () => {
    if (!message.trim()) return
    void runAction('commit', () => window.electronAPI.git.commit(workspaceId, message.trim(), checkedKeys), () => setMessage(''))
  }
  const checkoutBranch = (branch: GitBranch) => {
    if (branch.isCurrent || branch.isRemote) return
    void runAction(`checkout:${branch.name}`, () => window.electronAPI.git.checkoutBranch(workspaceId, branch.name))
  }
  const createBranch = () => {
    const name = newBranchName.trim()
    if (!name) return
    void runAction('create-branch', () => window.electronAPI.git.createBranch(workspaceId, name, true), () => setNewBranchName(''))
  }
  const renameBranch = () => {
    if (!renameTarget || !renameDraft.trim()) return
    void runAction('rename-branch', () => window.electronAPI.git.renameBranch(workspaceId, renameTarget, renameDraft.trim()), () => {
      setRenameTarget(null)
      setRenameDraft('')
    })
  }
  const deleteBranch = async (branch: GitBranch) => {
    const ok = await styledConfirm({ message: tr(`删除分支 ${branch.name}？未合并分支会被 Git 阻止。`, `Delete branch ${branch.name}? Git will block unmerged branches.`), danger: true })
    if (!ok) return
    void runAction(`delete:${branch.name}`, () => window.electronAPI.git.deleteBranch(workspaceId, branch.name, false))
  }

  const selectedCommit = log?.entries.find(entry => entry.sha === selectedCommitSha) ?? null
  const localBranches = branches?.localBranches ?? []
  const remoteBranches = branches?.remoteBranches ?? []
  const branchNeedle = branchQuery.trim().toLowerCase()
  const filteredLocalBranches = localBranches.filter(branch => branch.name.toLowerCase().includes(branchNeedle))
  const filteredRemoteBranches = remoteBranches.filter(branch => branch.name.toLowerCase().includes(branchNeedle))
  const selectedCount = checkedKeys.length

  return (
    <div className="wb-tool-panel wb-git-workbench-panel">
      <div className="wb-git-workbench-toolbar">
        <div className="wb-git-workbench-title">
          <strong>{tr('Git 工作台', 'Git workbench')}</strong>
          <span>{status?.isRepo ? `${status.branch || 'HEAD'} · ${changedFiles.length} ${tr('个变更', 'changes')}` : tr('本地仓库状态', 'Local repository status')}</span>
        </div>
        <div className="wb-git-workbench-tabs">
          {(['changes', 'branches', 'commits'] as GitViewMode[]).map(mode => (
            <button key={mode} className={viewMode === mode ? 'active' : ''} onClick={() => setViewMode(mode)}>
              {gitViewLabel(mode)}
            </button>
          ))}
        </div>
        <div className="wb-git-workbench-actions">
          <button onClick={() => runAction('fetch', () => window.electronAPI.git.fetch(workspaceId))} disabled={!status?.isRepo || !!actionLoading}>{tr('Fetch', 'Fetch')}</button>
          <button onClick={() => runAction('pull', () => window.electronAPI.git.pull(workspaceId))} disabled={!status?.isRepo || !!actionLoading}>{tr('Pull', 'Pull')}</button>
          <button onClick={() => runAction('push', () => window.electronAPI.git.push(workspaceId))} disabled={!status?.isRepo || !!actionLoading}>{tr('Push', 'Push')}</button>
          <button onClick={() => runAction('sync', () => window.electronAPI.git.sync(workspaceId))} disabled={!status?.isRepo || !!actionLoading}>{tr('同步', 'Sync')}</button>
          <button onClick={refresh} disabled={loading}><Icon d={IC.refresh} size={14} /></button>
          <button onClick={onClose}><Icon d={IC.x} size={14} /></button>
        </div>
      </div>

      {!workspaceId && <div className="wb-muted-box">{tr('Git 需要先选择工作目录。', 'Choose a working folder to use Git.')}</div>}
      {workspaceId && status && !status.isRepo && <div className="wb-muted-box">{status.error || tr('没有检测到 Git 仓库。', 'No Git repository detected.')}</div>}
      {error && <div className="wb-send-error">{error}</div>}
      {notice && <div className="wb-git-notice">{notice}</div>}

      {status?.isRepo && (
        <div className="wb-git-workbench">
          <aside className="wb-git-overview">
            <div className="wb-git-summary-grid">
              <div><strong>{status.branch || 'HEAD'}</strong><span>{tr('当前分支', 'branch')}</span></div>
              <div><strong>↑{status.ahead} ↓{status.behind}</strong><span>{status.upstream || tr('无上游', 'no upstream')}</span></div>
              <div><strong>{status.totalAdditions}+ / {status.totalDeletions}-</strong><span>{tr('变更行', 'line changes')}</span></div>
            </div>
            <GitFileSection
              title={tr('已暂存', 'Staged')}
              section="staged"
              files={stagedFiles}
              selectedPath={diffMode === 'working' ? selectedPath : null}
              checkedKeys={checkedKeys}
              emptyText={tr('没有已暂存变更。', 'No staged changes.')}
              onSelect={(path) => { setDiffMode('working'); setSelectedCommitSha(null); setSelectedPath(path) }}
              onToggle={togglePath}
              onPrimary={unstageFile}
              primaryLabel={tr('取消暂存', 'Unstage')}
              onDanger={revertFile}
            />
            <GitFileSection
              title={tr('未暂存', 'Unstaged')}
              section="unstaged"
              files={unstagedFiles}
              selectedPath={diffMode === 'working' ? selectedPath : null}
              checkedKeys={checkedKeys}
              emptyText={tr('工作区干净。', 'Working tree is clean.')}
              onSelect={(path) => { setDiffMode('working'); setSelectedCommitSha(null); setSelectedPath(path) }}
              onToggle={togglePath}
              onPrimary={stageFile}
              primaryLabel={tr('暂存', 'Stage')}
              onDanger={revertFile}
            />
            <div className="wb-git-side-actions">
              <button onClick={() => runAction('stage-all', () => window.electronAPI.git.stageAll(workspaceId))} disabled={!unstagedFiles.length || !!actionLoading}>{tr('全部暂存', 'Stage all')}</button>
              <button className="danger" onClick={revertAll} disabled={!changedFiles.length || !!actionLoading}>{tr('丢弃全部', 'Discard all')}</button>
            </div>
          </aside>

          <section className="wb-git-center">
            {viewMode === 'changes' && (
              <DiffPane
                title={selectedPath || tr('Diff', 'Diff')}
                subtitle={diffMode === 'commit' ? selectedCommit?.shortSha : gitFileLabel(changedFiles.find(file => file.path === selectedPath))}
                diffText={activeDiffText}
                emptyText={selectedPath ? tr('这个项目没有可显示的 diff。', 'No displayable diff for this item.') : tr('选择左侧文件查看 diff。', 'Select a file to view diff.')}
              />
            )}
            {viewMode === 'branches' && (
              <div className="wb-git-branch-workbench">
                <div className="wb-git-search-row">
                  <Icon d={IC.search} size={14} />
                  <input value={branchQuery} onChange={event => setBranchQuery(event.target.value)} placeholder={tr('搜索分支', 'Search branches')} />
                </div>
                <div className="wb-git-create-row">
                  <input value={newBranchName} onChange={event => setNewBranchName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') createBranch() }} placeholder={tr('新分支名称', 'New branch name')} />
                  <button onClick={createBranch} disabled={!newBranchName.trim() || !!actionLoading}>{tr('创建并检出', 'Create checkout')}</button>
                </div>
                <BranchSection title={tr('本地分支', 'Local branches')} branches={filteredLocalBranches} onCheckout={checkoutBranch} onDelete={deleteBranch} onRename={(branch) => { setRenameTarget(branch.name); setRenameDraft(branch.name) }} />
                <BranchSection title={tr('远程分支', 'Remote branches')} branches={filteredRemoteBranches} onCheckout={checkoutBranch} />
                {renameTarget && (
                  <div className="wb-git-rename-card">
                    <strong>{tr('重命名分支', 'Rename branch')}</strong>
                    <input value={renameDraft} onChange={event => setRenameDraft(event.target.value)} />
                    <div>
                      <button onClick={() => { setRenameTarget(null); setRenameDraft('') }}>{tr('取消', 'Cancel')}</button>
                      <button onClick={renameBranch} disabled={!renameDraft.trim() || renameDraft === renameTarget}>{tr('保存', 'Save')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {viewMode === 'commits' && (
              <div className="wb-git-commit-timeline">
                {(log?.entries ?? []).map(entry => (
                  <button
                    key={entry.sha}
                    className={entry.sha === selectedCommitSha ? 'active' : ''}
                    onClick={() => {
                      setSelectedCommitSha(entry.sha)
                      setViewMode('changes')
                    }}
                  >
                    <strong>{entry.summary || tr('无提交信息', 'No message')}</strong>
                    <small>{entry.shortSha} · {entry.author} · {formatGitTime(entry.timestamp)}</small>
                  </button>
                ))}
                {!log?.entries.length && <div className="wb-muted-box">{tr('暂无提交记录。', 'No commits yet.')}</div>}
              </div>
            )}
          </section>

          <aside className="wb-git-details">
            <section className="wb-git-commit-box">
              <div className="wb-git-section-head">
                <strong>{tr('提交', 'Commit')}</strong>
                <span>{selectedCount} / {changedFiles.length}</span>
              </div>
              <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder={tr('写下提交消息', 'Write a commit message')} />
              <button className="primary" onClick={commit} disabled={!message.trim() || selectedCount === 0 || !!actionLoading}>{actionLoading === 'commit' ? tr('提交中', 'Committing') : tr('提交选中变更', 'Commit selected')}</button>
            </section>
            <section className="wb-git-detail-card">
              <div className="wb-git-section-head">
                <strong>{tr('提交详情', 'Commit details')}</strong>
                <span>{selectedCommit?.shortSha || 'HEAD'}</span>
              </div>
              {commitDetails ? (
                <>
                  <h4>{commitDetails.summary || tr('无提交信息', 'No message')}</h4>
                  <small>{commitDetails.author} · {formatGitTime(commitDetails.commitTime)}</small>
                  <p>{commitDetails.message}</p>
                  <div className="wb-git-commit-files">
                    {commitDetails.files.map(file => <span key={file.path}>{file.status} {file.path}</span>)}
                  </div>
                </>
              ) : (
                <div className="wb-muted-box">{tr('从提交历史选择一条提交查看详情。', 'Select a commit to view details.')}</div>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}

function GitFileSection({
  title,
  section,
  files,
  selectedPath,
  checkedKeys,
  emptyText,
  onSelect,
  onToggle,
  onPrimary,
  primaryLabel,
  onDanger
}: {
  title: string
  section: GitChangeSection
  files: GitFileStatus[]
  selectedPath: string | null
  checkedKeys: string[]
  emptyText: string
  onSelect: (path: string) => void
  onToggle: (section: GitChangeSection, path: string, checked: boolean) => void
  onPrimary: (file: GitFileStatus) => void
  primaryLabel: string
  onDanger: (file: GitFileStatus) => void
}) {
  return (
    <section className="wb-git-file-section">
      <div className="wb-git-section-head"><strong>{title}</strong><span>{files.length}</span></div>
      {files.length === 0 && <div className="wb-muted-box">{emptyText}</div>}
      {files.map(file => (
        <div key={`${title}:${file.path}:${file.oldPath || ''}`} className={'wb-git-file-row' + (selectedPath === file.path ? ' active' : '')}>
          <input type="checkbox" checked={checkedKeys.includes(changeKey(section, file.path))} onChange={event => onToggle(section, file.path, event.target.checked)} />
          <button type="button" onClick={() => onSelect(file.path)} title={file.path}>
            <span className="wb-git-badge">{file.status || gitStatusCode(file)}</span>
            <strong>{file.path}</strong>
            <small>{gitFileLabel(file)}{file.oldPath ? ` · ${file.oldPath} → ${file.path}` : ''}</small>
          </button>
          <div className="wb-git-file-actions">
            <button onClick={() => onPrimary(file)}>{primaryLabel}</button>
            <button className="danger" onClick={() => onDanger(file)}>{tr('丢弃', 'Discard')}</button>
          </div>
        </div>
      ))}
    </section>
  )
}

function DiffPane({ title, subtitle, diffText, emptyText }: { title: string; subtitle?: string; diffText: string; emptyText: string }) {
  return (
    <div className="wb-git-diff-pane">
      <div className="wb-git-section-head"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
      <pre>{diffText || emptyText}</pre>
    </div>
  )
}

function BranchSection({
  title,
  branches,
  onCheckout,
  onRename,
  onDelete
}: {
  title: string
  branches: GitBranch[]
  onCheckout: (branch: GitBranch) => void
  onRename?: (branch: GitBranch) => void
  onDelete?: (branch: GitBranch) => void
}) {
  return (
    <section className="wb-git-branch-section">
      <div className="wb-git-section-head"><strong>{title}</strong><span>{branches.length}</span></div>
      {branches.map(branch => (
        <div key={`${title}:${branch.name}`} className={'wb-git-branch-row' + (branch.isCurrent ? ' active' : '')}>
          <button onClick={() => onCheckout(branch)} disabled={branch.isCurrent || branch.isRemote}>
            <span>{branch.isCurrent ? '✓' : branch.isRemote ? '↗' : ' '}</span>
            <strong>{branch.name}</strong>
            <small>{branch.upstream || branch.remote || ''}{branch.ahead || branch.behind ? ` · ↑${branch.ahead || 0} ↓${branch.behind || 0}` : ''}</small>
          </button>
          {!branch.isRemote && (
            <div>
              {onRename && <button onClick={() => onRename(branch)}>{tr('重命名', 'Rename')}</button>}
              {onDelete && !branch.isCurrent && <button className="danger" onClick={() => onDelete(branch)}>{tr('删除', 'Delete')}</button>}
            </div>
          )}
        </div>
      ))}
      {branches.length === 0 && <div className="wb-muted-box">{tr('没有匹配的分支。', 'No matching branches.')}</div>}
    </section>
  )
}

function gitViewLabel(mode: GitViewMode): string {
  if (mode === 'branches') return tr('分支', 'Branches')
  if (mode === 'commits') return tr('提交', 'Commits')
  return tr('变更', 'Changes')
}

function changeKey(section: GitChangeSection, path: string): string {
  return `${section}:${path}`
}

function gitStatusCode(file: { index: string; workingTree: string; status?: string }): string {
  const explicit = file.status?.trim()
  if (explicit) return explicit
  const code = `${file.index || ' '}${file.workingTree || ' '}`.trim()
  return code || 'M'
}

function gitFileLabel(file?: { status?: string; index?: string; workingTree?: string; additions?: number; deletions?: number }): string {
  if (!file) return ''
  const code = gitStatusCode({ index: file.index || ' ', workingTree: file.workingTree || ' ', status: file.status })
  const kind = code.includes('A') ? tr('新增', 'Added')
    : code.includes('D') ? tr('删除', 'Deleted')
      : code.includes('R') ? tr('重命名', 'Renamed')
        : code.includes('C') ? tr('复制', 'Copied')
          : code.includes('U') ? tr('冲突', 'Conflict')
            : code.includes('?') ? tr('未跟踪', 'Untracked')
              : tr('修改', 'Modified')
  const stats = typeof file.additions === 'number' || typeof file.deletions === 'number'
    ? ` · +${file.additions || 0} -${file.deletions || 0}`
    : ''
  return `${kind}${stats}`
}

function formatGitTime(timestamp: number): string {
  if (!timestamp) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}
