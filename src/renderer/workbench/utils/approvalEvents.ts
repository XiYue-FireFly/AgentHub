import type { ApprovalItem } from '../../glass/approval-dialog'

type ApprovalRuntimeEvent = Pick<RuntimeEvent, 'kind' | 'turnId' | 'agentId' | 'payload'>

export function approvalItemFromRuntimeEvent(event: ApprovalRuntimeEvent): ApprovalItem | null {
  if (event.kind !== 'agent:approval') return null
  const payload = event.payload || {}
  const request = payload.request
  if (!request || typeof request !== 'object') return null

  const id = stringValue(request.id)
  const agentId = stringValue(event.agentId) || stringValue(payload.agentId)
  const tool = request.tool === 'write' || request.tool === 'exec' ? request.tool : null
  const toolName = stringValue(request.toolName)
  if (!id || !agentId || !tool || !toolName) return null

  return {
    id,
    taskId: stringValue(payload.taskId) || event.turnId,
    agentId,
    tool,
    toolName,
    label: stringValue(request.label) || undefined,
    detail: stringValue(request.detail) || undefined
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
