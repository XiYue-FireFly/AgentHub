export async function watchTerminalRun(
  runId: string,
  setRuns: React.Dispatch<React.SetStateAction<TerminalRun[]>>,
  signal?: AbortSignal
) {
  let attempt = 0
  while (!signal?.aborted) {
    const delay = attempt < 8 ? 500 : Math.min(5000, 1200 + (attempt - 8) * 250)
    await new Promise(resolve => setTimeout(resolve, delay))
    if (signal?.aborted) return
    const history = await window.electronAPI.terminal.history().catch(() => [])
    const current = history.find(run => run.id === runId)
    setRuns(history)
    if (current && current.status !== 'running') break
    // Only break if history is non-empty but runId not found (run was deleted)
    // If history is empty, retry (might be temporary IPC issue)
    if (!current && history.length > 0) break
    attempt += 1
  }
}
