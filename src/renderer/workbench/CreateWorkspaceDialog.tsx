import React, { useId, useRef, useState } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'
import { defaultDialogPath, rememberDialogPath } from '../appearance'
import { useModalFocus } from '../hooks/useModalFocus'

interface CreateWorkspaceDialogProps {
  activeWorkspaceRoot?: string | null
  onClose: () => void
  onCreated: (workspace: { id: string; name: string; rootPath: string }) => Promise<void> | void
}

export function CreateWorkspaceDialog({
  activeWorkspaceRoot,
  onClose,
  onCreated
}: CreateWorkspaceDialogProps) {
  const [draft, setDraft] = useState({ name: '', rootPath: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const requestClose = () => {
    if (!submitting) onClose()
  }
  useModalFocus({ containerRef: dialogRef, initialFocusRef: nameRef, onEscape: requestClose })

  const pickProjectFolder = async () => {
    const picked = await window.electronAPI.app.pickFolder({ defaultPath: defaultDialogPath('folder', activeWorkspaceRoot) })
    if (!picked) return
    rememberDialogPath('folder', picked)
    const inferred = picked.split(/[\\/]/).filter(Boolean).at(-1) || tr('新工作目录', 'New folder')
    setDraft(current => ({ name: current.name || inferred, rootPath: picked }))
  }

  const submitProject = async () => {
    const name = draft.name.trim()
    const rootPath = draft.rootPath.trim()
    if (!name || !rootPath) {
      setError(tr('请选择本地目录并填写名称。', 'Choose a local folder and enter a name.'))
      return
    }
    try {
      setSubmitting(true)
      setError(null)
      const workspace = await window.electronAPI.workspaces.create({ name, rootPath })
      await onCreated(workspace)
    } catch (e: any) {
      setError(e?.message || tr('添加工作目录失败。', 'Failed to add folder.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="wb-modal-backdrop" onMouseDown={requestClose}>
      <div
        className="wb-project-modal"
        onMouseDown={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="wb-project-modal-head">
          <div>
            <strong id={titleId}>{tr('添加工作目录', 'Add working folder')}</strong>
            <span id={descriptionId}>{tr('选择一个本地目录。绑定后文件、Git、终端和工作树会使用这个目录。', 'Choose a local folder for files, Git, terminal, and worktrees.')}</span>
          </div>
          <button onClick={requestClose} disabled={submitting} aria-label={tr('关闭添加目录对话框', 'Close add folder dialog')}><Icon d={IC.x} size={14} /></button>
        </div>
        <label>
          {tr('目录名称', 'Folder name')}
          <input ref={nameRef} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={tr('给这个目录起个名字', 'Name this folder')} />
        </label>
        <label>
          {tr('本地目录', 'Local folder')}
          <div className="wb-folder-picker">
            <input value={draft.rootPath} onChange={event => setDraft(current => ({ ...current, rootPath: event.target.value }))} placeholder={tr('选择本地目录', 'Choose a local folder')} />
            <button onClick={pickProjectFolder} disabled={submitting}>{tr('浏览', 'Browse')}</button>
          </div>
        </label>
        {error && <div className="wb-project-error">{error}</div>}
        <div className="wb-project-modal-actions">
          <button onClick={requestClose} disabled={submitting}>{tr('取消', 'Cancel')}</button>
          <button className="primary" onClick={submitProject} disabled={submitting}>{tr('添加工作目录', 'Add folder')}</button>
        </div>
      </div>
    </div>
  )
}
