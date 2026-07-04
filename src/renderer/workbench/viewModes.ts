export const WORKBENCH_VIEW_MODES = ['chat', 'write', 'tasks', 'requirements', 'settings', 'workflows'] as const

export type ViewMode = typeof WORKBENCH_VIEW_MODES[number]

export function isWorkbenchViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (WORKBENCH_VIEW_MODES as readonly string[]).includes(value)
}
