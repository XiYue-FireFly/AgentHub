export interface PreventableQuitEvent {
  preventDefault(): void
}

interface WillQuitHandlerOptions {
  cleanup(): Promise<void>
  exit(): void
  onFailure(message: string, error: unknown): void
}

export function createWillQuitHandler({ cleanup, exit, onFailure }: WillQuitHandlerOptions) {
  let cleanupCompletion: Promise<void> | null = null
  let exitCompletion: Promise<void> | null = null
  const report = (message: string, error: unknown): void => {
    try { onFailure(message, error) } catch { /* shutdown reporting must not block exit */ }
  }

  return (event: PreventableQuitEvent): Promise<void> => {
    event.preventDefault()
    if (!cleanupCompletion) {
      cleanupCompletion = Promise.resolve()
        .then(cleanup)
        .catch(error => {
          report("[AgentHub] Shutdown cleanup failed", error)
        })
    }
    if (exitCompletion) return exitCompletion

    const attempt = cleanupCompletion
      .then(() => {
        try { exit() } catch (error) {
          report("[AgentHub] Shutdown exit failed", error)
          if (exitCompletion === attempt) exitCompletion = null
        }
      })
    exitCompletion = attempt
    return attempt
  }
}
