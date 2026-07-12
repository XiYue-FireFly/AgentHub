export const TURN_STATUSES = [
  'queued',
  'running',
  'awaiting-decision',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
] as const

export type WorkbenchTurnStatus = (typeof TURN_STATUSES)[number]

export const TERMINAL_TURN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'interrupted'
] as const satisfies readonly WorkbenchTurnStatus[]

const TERMINAL = new Set<WorkbenchTurnStatus>(TERMINAL_TURN_STATUSES)

export function isTerminalTurnStatus(status: WorkbenchTurnStatus): boolean {
  return TERMINAL.has(status)
}
