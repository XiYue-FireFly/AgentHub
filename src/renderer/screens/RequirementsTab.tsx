/**
 * Requirements Tab - 需求管理设置页面
 *
 * 在设置页面中显示需求管理功能
 */

import React, { useEffect, useState } from 'react'
import { SddRequirementsList } from '../sdd/components/SddRequirementsList'

interface RequirementsTabProps {
  workspaceId: string | null
}

export function RequirementsTab({ workspaceId }: RequirementsTabProps) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!workspaceId) {
      setWorkspaceRoot(null)
      return () => { alive = false }
    }
    // Don't set to null immediately to prevent flash - keep previous value
    window.electronAPI.workspaces.list()
      .then(workspaces => {
        if (!alive) return
        const root = workspaces.find(workspace => workspace.id === workspaceId)?.rootPath ?? null
        setWorkspaceRoot(root)
      })
      .catch(() => { if (alive) setWorkspaceRoot(null) })
    return () => { alive = false }
  }, [workspaceId])

  return <SddRequirementsList workspaceRoot={workspaceRoot} />
}
