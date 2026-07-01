import { DispatchPreset } from '../../src/store/workbench-store'
import { localAgentLabel } from '../localAgentOptions'

const MIN_INSPECTOR_WIDTH = 340
const MAX_INSPECTOR_WIDTH = 760

/**
 * Normalize agent slots to ensure valid and unique agents.
 */
export function normalizeAgentSlots(slots: string[], usableAgentIds: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of slots) {
    if (usableAgentIds.includes(id) && !seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  for (const id of usableAgentIds) {
    if (next.length >= 3) break
    if (!seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  return next.slice(0, 3)
}

/**
 * Clamp inspector width to responsive bounds.
 */
export function clampInspectorWidth(width: number, viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth): number {
  const sidebarAndMain = viewportWidth > 1160 ? 292 + 560 + 40 : 290 + 420 + 32
  const responsiveMax = Math.max(MIN_INSPECTOR_WIDTH, viewportWidth - sidebarAndMain)
  return Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, responsiveMax, Math.round(width)))
}

/**
 * Watch a terminal run for completion.
 */
export async function watchTerminalRun(runId: string, setRuns: React.Dispatch<React.SetStateAction<Array<{ id: string; status: string }>>>, signal?: AbortSignal) {
  for (let i = 0; i < 24; i++) {
    if (signal?.aborted) return
    await new Promise(resolve => setTimeout(resolve, i < 8 ? 500 : 1200))
    if (signal?.aborted) return
    const history = await window.electronAPI.terminal.history().catch(() => [])
    const current = history.find(run => run.id === runId)
    setRuns(history)
    if (current && current.status !== 'running') break
  }
}

/**
 * Get short name for an agent.
 */
export function agentShortName(agentId: string): string {
  return localAgentLabel(agentId)
}
