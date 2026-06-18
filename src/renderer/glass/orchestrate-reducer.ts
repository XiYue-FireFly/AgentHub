/* ============================================================
   编排模式 — 纯 reducer：把 orchestrate:* 流事件折叠成 OrchestrateState
   App 的 onStream 收到 orchestrate:* 事件时调用本函数即可（接线只需一行）。
   事件契约见 COLLAB.md：orchestrate:plan / orchestrate:subtask / orchestrate:final。
   ============================================================ */

import { OrchestrateState, OrchestrateSubtask } from './orchestrate-view'

export function initialOrchestrateState(): OrchestrateState {
  return { phase: 'planning', subtasks: [] }
}

/** 纯函数：依据一条 orchestrate:* 事件返回新状态（不可变更新）。未知事件原样返回。 */
export function applyOrchestrateEvent(prev: OrchestrateState | undefined, ev: any): OrchestrateState {
  const state: OrchestrateState = prev
    ? { ...prev, subtasks: prev.subtasks.map(s => ({ ...s })) }
    : initialOrchestrateState()

  switch (ev?.kind) {
    case 'orchestrate:plan': {
      const subtasks: OrchestrateSubtask[] = Array.isArray(ev.subtasks)
        ? ev.subtasks.map((s: any) => ({
            id: String(s.id),
            title: s.title || String(s.id),
            detail: s.detail,
            agentId: s.agentId,
            status: 'pending' as const,
            content: ''
          }))
        : []
      return { ...state, phase: 'running', subtasks, leadAgentId: ev.leadAgentId ?? state.leadAgentId }
    }

    case 'orchestrate:subtask': {
      const subtasks = state.subtasks.slice()
      let idx = subtasks.findIndex(s => s.id === String(ev.subtaskId))
      if (idx < 0) {
        subtasks.push({ id: String(ev.subtaskId), title: ev.title || String(ev.subtaskId), status: 'pending' })
        idx = subtasks.length - 1
      }
      const cur = { ...subtasks[idx] }
      if (ev.agentId) cur.agentId = ev.agentId
      if (ev.status) cur.status = ev.status
      if (typeof ev.contentDelta === 'string') cur.content = (cur.content || '') + ev.contentDelta
      else if (typeof ev.content === 'string') cur.content = ev.content
      subtasks[idx] = cur
      return { ...state, subtasks }
    }

    case 'orchestrate:verdict': {
      const subtasks = state.subtasks.map(s =>
        s.id === String(ev.subtaskId) ? { ...s, verdict: { pass: !!ev.pass, note: ev.note } } : s)
      return { ...state, subtasks }
    }

    case 'orchestrate:synthesizing':
      return { ...state, phase: 'synthesizing' }

    case 'orchestrate:final':
      return { ...state, phase: 'done', final: typeof ev.content === 'string' ? ev.content : state.final }

    case 'orchestrate:error':
      return { ...state, phase: 'error', error: ev.error || 'orchestration error' }

    default:
      return state
  }
}
