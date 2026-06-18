import type { AgentUIStatus } from '../glass/meta'

export type AgentMap = Record<string, { status: AgentUIStatus }>

export interface WorkspaceItem {
  id: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
}
