/**
 * Requirements Tab - 需求管理设置页面
 *
 * 在设置页面中显示需求管理功能
 */

import React from 'react'
import { SddRequirementsList } from '../sdd/components/SddRequirementsList'

interface RequirementsTabProps {
  workspaceId: string | null
}

export function RequirementsTab({ workspaceId }: RequirementsTabProps) {
  return <SddRequirementsList workspaceRoot={workspaceId} />
}
