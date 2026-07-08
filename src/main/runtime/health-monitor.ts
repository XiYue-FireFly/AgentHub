/**
 * Health Monitor for AgentHub
 *
 * Inspired by Kun's runtime supervisor and health check.
 * Monitors runtime health and implements automatic restart with backoff.
 */

export type RuntimeStatus = 'starting' | 'running' | 'unhealthy' | 'crashed' | 'stopped'

export interface HealthCheckResult {
  healthy: boolean
  status: RuntimeStatus
  latencyMs?: number
  error?: string
  timestamp: number
}

export interface RestartVerdict {
  allowed: boolean
  attempt: number
  delayMs: number
}

export interface HealthMonitorOptions {
  /** Health check interval in milliseconds */
  checkIntervalMs?: number
  /** Consecutive failures before marking unhealthy */
  failureThreshold?: number
  /** Maximum restarts within window before circuit breaking */
  maxRestarts?: number
  /** Window for restart budget in milliseconds */
  restartWindowMs?: number
  /** Base delay for exponential backoff */
  baseDelayMs?: number
  /** Delay multiplier for exponential backoff */
  delayFactor?: number
  /** Health check function */
  healthCheck: () => Promise<boolean>
  /** Restart function */
  restart: () => Promise<void>
  /** Status change callback */
  onStatusChange?: (status: RuntimeStatus) => void
}

const DEFAULT_CHECK_INTERVAL_MS = 30_000
const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_MAX_RESTARTS = 3
const DEFAULT_RESTART_WINDOW_MS = 60_000
const DEFAULT_BASE_DELAY_MS = 1_000
const DEFAULT_DELAY_FACTOR = 3

export class HealthMonitor {
  private readonly checkIntervalMs: number
  private readonly failureThreshold: number
  private readonly healthCheck: () => Promise<boolean>
  private readonly restart: () => Promise<void>
  private readonly onStatusChange?: (status: RuntimeStatus) => void

  private status: RuntimeStatus = 'stopped'
  private consecutiveFailures = 0
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private restartAttempts: number[] = []
  private readonly maxRestarts: number
  private readonly restartWindowMs: number
  private readonly baseDelayMs: number
  private readonly delayFactor: number

  constructor(options: HealthMonitorOptions) {
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS
    this.restartWindowMs = options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    this.delayFactor = options.delayFactor ?? DEFAULT_DELAY_FACTOR
    this.healthCheck = options.healthCheck
    this.restart = options.restart
    this.onStatusChange = options.onStatusChange
  }

  /**
   * Get current runtime status.
   */
  getStatus(): RuntimeStatus {
    return this.status
  }

  /**
   * Start monitoring.
   */
  start(): void {
    if (this.checkTimer) return
    this.setStatus('starting')
    this.consecutiveFailures = 0

    // Initial health check
    this.performHealthCheck().catch(() => {})

    // Periodic health checks
    this.checkTimer = setInterval(() => {
      this.performHealthCheck().catch(() => {})
    }, this.checkIntervalMs)
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    this.setStatus('stopped')
  }

  /**
   * Reset restart budget (call after successful stable run).
   */
  resetRestartBudget(): void {
    this.restartAttempts = []
  }

  /**
   * Check if restart is allowed.
   */
  canRestart(): RestartVerdict {
    const now = Date.now()
    // Clean old attempts
    this.restartAttempts = this.restartAttempts.filter(t => now - t < this.restartWindowMs)

    if (this.restartAttempts.length >= this.maxRestarts) {
      return { allowed: false, attempt: this.restartAttempts.length, delayMs: 0 }
    }

    const attempt = this.restartAttempts.length + 1
    const delayMs = Math.round(this.baseDelayMs * Math.pow(this.delayFactor, attempt - 1))
    return { allowed: true, attempt, delayMs }
  }

  /**
   * Perform a health check.
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const healthy = await this.healthCheck()
      if (healthy) {
        this.consecutiveFailures = 0
        if (this.status !== 'running') {
          this.setStatus('running')
        }
      } else {
        this.handleFailure()
      }
    } catch (error) {
      this.handleFailure()
    }
  }

  /**
   * Handle a health check failure.
   */
  private handleFailure(): void {
    this.consecutiveFailures++

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.setStatus('unhealthy')
      this.attemptRestart()
    }
  }

  /**
   * Attempt to restart the runtime.
   */
  private async attemptRestart(): Promise<void> {
    const verdict = this.canRestart()
    if (!verdict.allowed) {
      this.setStatus('crashed')
      return
    }

    this.restartAttempts.push(Date.now())

    // Wait for backoff delay
    await new Promise(resolve => setTimeout(resolve, verdict.delayMs))

    try {
      await this.restart()
      this.consecutiveFailures = 0
      this.setStatus('starting')
    } catch (error) {
      this.setStatus('crashed')
    }
  }

  /**
   * Set status and notify callback.
   */
  private setStatus(status: RuntimeStatus): void {
    if (this.status === status) return
    this.status = status
    this.onStatusChange?.(status)
  }
}

/**
 * Create a health monitor instance.
 */
export function createHealthMonitor(options: HealthMonitorOptions): HealthMonitor {
  return new HealthMonitor(options)
}
