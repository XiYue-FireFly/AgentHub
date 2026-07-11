/**
 * WorkspacesTab: workspace management settings panel.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles workspace CRUD, active selection, and folder picking.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'
import { notifyWorkspaceChange } from '../workspace-change'

function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="wb-muted-box" style={{ textAlign: 'center', padding: 24 }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <strong>{title}</strong>
      <p style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>{detail}</p>
    </div>
  )
}

export function WorkspacesTab() {
  const [items, setItems] = useState<Array<{ id: string; name: string; rootPath: string }>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id?: string; name: string; rootPath: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.electronAPI.workspaces.list(),
      window.electronAPI.workspaces.getActive()
    ])
    setItems(list)
    setActiveId(active)
    return active
  }, [])

  const refreshAfterMutation = useCallback(async () => {
    try {
      const activeWorkspaceId = await refresh()
      notifyWorkspaceChange({ kind: 'known', activeWorkspaceId })
      setError(null)
    } catch {
      notifyWorkspaceChange({ kind: 'invalidate' })
      setError(tr('工作目录修改已生效，但本页刷新失败。', 'The workspace change was applied, but this page failed to refresh.'))
    }
  }, [refresh])

  useEffect(() => {
    let alive = true
    refresh()
      .catch((err: any) => { if (alive) setError(err?.message || tr('加载工作目录失败', 'Failed to load workspaces')) })
    return () => { alive = false }
  }, [refresh])

  const save = async () => {
    if (!editing?.name.trim() || !editing.rootPath.trim()) return
    try {
      if (editing.id) await window.electronAPI.workspaces.update(editing.id, { name: editing.name.trim(), rootPath: editing.rootPath.trim() })
      else await window.electronAPI.workspaces.create({ name: editing.name.trim(), rootPath: editing.rootPath.trim() })
      setEditing(null)
      await refreshAfterMutation()
    } catch (err: any) {
      setError(err?.message || tr('保存工作目录失败', 'Failed to save workspace'))
    }
  }

  const pickFolder = async () => {
    try {
      const path = await window.electronAPI.app.pickFolder({ defaultPath: editing?.rootPath })
      if (path) {
        setEditing(current => ({ id: current?.id, name: current?.name || path.split(/[\\/]/).filter(Boolean).pop() || tr('工作目录', 'Workspace'), rootPath: path }))
      }
    } catch (err: any) {
      setError(err?.message || tr('选择目录失败', 'Failed to pick folder'))
    }
  }

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>{tr('工作目录是可选上下文', 'Workspaces are optional context')}</strong>
          <span>{tr('普通对话和写作不需要目录；终端、Git、工作树和项目文件操作才需要。', 'Chat and writing can work without a folder; terminal, Git, worktrees, and project file actions need one.')}</span>
        </div>
        <button className="ah-btn sm primary" onClick={() => setEditing({ name: '', rootPath: '' })}>
          <Icon d={IC.plus} size={13} /> {tr('添加工作目录', 'Add workspace')}
        </button>
      </div>
      {editing && (
        <div className="glass wb-provider-card">
          <div className="wb-card-head"><strong>{editing.id ? tr('编辑工作目录', 'Edit workspace') : tr('添加工作目录', 'Add workspace')}</strong></div>
          <div className="wb-form-grid two">
            <input className="ah-input" placeholder={tr('给这个目录起个名字', 'Name this folder')} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
            <div className="wb-folder-picker">
              <input className="ah-input mono" placeholder={tr('选择本地目录', 'Choose local folder')} value={editing.rootPath} onChange={event => setEditing({ ...editing, rootPath: event.target.value })} />
              <button className="ah-btn sm" onClick={pickFolder}>{tr('选择', 'Choose')}</button>
            </div>
          </div>
          <div className="wb-card-actions">
            <button className="ah-btn sm" onClick={() => setEditing(null)}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" onClick={save}>{tr('保存', 'Save')}</button>
          </div>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={<Icon d={IC.folder} size={24} />} title={tr('还没有工作目录', 'No workspaces yet')} detail={tr('可以直接新建对话；需要本地文件能力时再添加目录。', 'You can start a chat now; add a folder when local file features are needed.')} />}
      {items.map(item => (
        <div key={item.id} className="glass wb-workspace-row">
          <div>
            <strong>{item.name}</strong>
            {activeId === item.id && <span className="ah-chip mint">{tr('当前', 'Active')}</span>}
            <p>{item.rootPath}</p>
          </div>
           <div className="wb-card-actions">
            {activeId !== item.id && <button className="ah-btn sm" onClick={async () => {
              try {
                await window.electronAPI.workspaces.setActive(item.id)
                await refreshAfterMutation()
              } catch (err: any) {
                setError(err?.message || tr('设置当前目录失败', 'Failed to set active workspace'))
              }
            }}>{tr('设为当前', 'Set active')}</button>}
            <button className="ah-btn sm" onClick={() => setEditing({ id: item.id, name: item.name, rootPath: item.rootPath })}>{tr('编辑', 'Edit')}</button>
            <button className="ah-btn sm danger" onClick={async () => {
              try {
                const ok = await styledConfirm({ message: tr(`移除工作目录「${item.name}」？磁盘文件不会被删除。`, `Remove workspace "${item.name}"? Files on disk will not be deleted.`), danger: true })
                if (!ok) return
                const removed = await window.electronAPI.workspaces.remove(item.id)
                if (!removed) return
                await refreshAfterMutation()
              } catch (err: any) {
                setError(err?.message || tr('移除工作目录失败', 'Failed to remove workspace'))
              }
            }}>{tr('移除', 'Remove')}</button>
          </div>
        </div>
      ))}
      {error && <div className="glass wb-error-text">{error}</div>}
    </div>
  )
}
