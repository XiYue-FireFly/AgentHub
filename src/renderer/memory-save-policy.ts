export const IDLE_MEMORY_SAVE_DELAY_MS = 450
export const RUNNING_MEMORY_SAVE_INTERVAL_MS = 5_000

export function hasRunningTask(tasks: Array<{ status?: string }>): boolean {
  return tasks.some(task => task.status === 'running')
}

export function nextMemorySaveDelayMs(hasRunningTasks: boolean, now: number, lastRunningSaveAt: number): number {
  if (!hasRunningTasks) return IDLE_MEMORY_SAVE_DELAY_MS
  const elapsed = Math.max(0, now - lastRunningSaveAt)
  return Math.max(0, RUNNING_MEMORY_SAVE_INTERVAL_MS - elapsed)
}
