import { useCallback, useState } from 'react'
import { tr } from '../../glass/i18n'

interface ProjectDraft {
  name: string
  rootPath: string
}

export function useProjectDialog() {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({ name: '', rootPath: '' })
  const [projectError, setProjectError] = useState<string | null>(null)

  const openCreateProject = useCallback(() => {
    setProjectDialogOpen(true)
    setProjectDraft({ name: '', rootPath: '' })
    setProjectError(null)
  }, [])

  const pickProjectFolder = useCallback(async () => {
    const result = await window.electronAPI.dialog.selectDirectory()
    if (result) {
      setProjectDraft(prev => ({ ...prev, rootPath: result }))
    }
  }, [])

  const submitProject = useCallback(async (): Promise<boolean> => {
    if (!projectDraft.name.trim()) {
      setProjectError(tr('请输入项目名称', 'Please enter a project name'))
      return false
    }
    if (!projectDraft.rootPath.trim()) {
      setProjectError(tr('请选择工作目录', 'Please select a working directory'))
      return false
    }
    try {
      await window.electronAPI.workspaces.create({
        name: projectDraft.name.trim(),
        rootPath: projectDraft.rootPath.trim()
      })
      setProjectDialogOpen(false)
      setProjectError(null)
      return true
    } catch (e: any) {
      setProjectError(e?.message || tr('创建项目失败', 'Failed to create project'))
      return false
    }
  }, [projectDraft])

  return {
    projectDialogOpen,
    setProjectDialogOpen,
    projectDraft,
    setProjectDraft,
    projectError,
    setProjectError,
    openCreateProject,
    pickProjectFolder,
    submitProject
  }
}
