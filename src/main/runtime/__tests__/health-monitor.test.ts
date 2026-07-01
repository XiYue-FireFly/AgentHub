import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HealthMonitor, createHealthMonitor, type RuntimeStatus } from '../health-monitor'

describe('HealthMonitor', () => {
  let monitor: HealthMonitor
  let healthCheck: () => Promise<boolean>
  let restart: () => Promise<void>
  let statusChanges: RuntimeStatus[]

  beforeEach(() => {
    healthCheck = vi.fn().mockResolvedValue(true)
    restart = vi.fn().mockResolvedValue(undefined)
    statusChanges = []
    monitor = createHealthMonitor({
      checkIntervalMs: 100,
      failureThreshold: 2,
      maxRestarts: 2,
      restartWindowMs: 1000,
      healthCheck,
      restart,
      onStatusChange: (status) => statusChanges.push(status)
    })
  })

  describe('start/stop', () => {
    it('should start with starting status', () => {
      monitor.start()
      expect(monitor.getStatus()).toBe('starting')
    })

    it('should stop with stopped status', () => {
      monitor.start()
      monitor.stop()
      expect(monitor.getStatus()).toBe('stopped')
    })

    it('should not start twice', () => {
      monitor.start()
      monitor.start() // should not throw
      expect(monitor.getStatus()).toBe('starting')
    })
  })

  describe('health check', () => {
    it('should transition to running on successful check', async () => {
      monitor.start()
      // Wait for initial health check
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(monitor.getStatus()).toBe('running')
    })

    it('should stay running on consecutive successful checks', async () => {
      monitor.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(monitor.getStatus()).toBe('running')
      // Wait for another check
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(monitor.getStatus()).toBe('running')
    })

    it('should transition to unhealthy after failure threshold', async () => {
      healthCheck = vi.fn().mockResolvedValue(false)
      monitor = createHealthMonitor({
        checkIntervalMs: 50,
        failureThreshold: 2,
        maxRestarts: 2,
        restartWindowMs: 1000,
        healthCheck,
        restart,
        onStatusChange: (status) => statusChanges.push(status)
      })
      monitor.start()
      // Wait for 2 failed checks
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(monitor.getStatus()).toBe('unhealthy')
    })
  })

  describe('restart budget', () => {
    it('should allow restart within budget', () => {
      const verdict = monitor.canRestart()
      expect(verdict.allowed).toBe(true)
      expect(verdict.attempt).toBe(1)
    })

    it('should deny restart when budget exceeded', () => {
      // Use up the budget by simulating restart attempts
      ;(monitor as any).restartAttempts.push(Date.now())
      ;(monitor as any).restartAttempts.push(Date.now())
      const verdict = monitor.canRestart()
      expect(verdict.allowed).toBe(false)
    })

    it('should reset restart budget', () => {
      // Use up the budget
      monitor.canRestart()
      monitor.canRestart()
      monitor.resetRestartBudget()
      const verdict = monitor.canRestart()
      expect(verdict.allowed).toBe(true)
    })

    it('should calculate exponential backoff delay', () => {
      const verdict1 = monitor.canRestart()
      expect(verdict1.delayMs).toBe(1000) // base delay

      // Simulate restart attempt
      ;(monitor as any).restartAttempts.push(Date.now())
      const verdict2 = monitor.canRestart()
      expect(verdict2.delayMs).toBe(3000) // base * factor
    })
  })

  describe('status changes', () => {
    it('should notify on status changes', () => {
      monitor.start()
      expect(statusChanges).toContain('starting')
    })

    it('should not notify on same status', () => {
      monitor.start()
      monitor.start() // should not notify again
      const startingCount = statusChanges.filter(s => s === 'starting').length
      expect(startingCount).toBe(1)
    })
  })
})

describe('createHealthMonitor', () => {
  it('should create a monitor with default options', () => {
    const monitor = createHealthMonitor({
      healthCheck: async () => true,
      restart: async () => {}
    })
    expect(monitor).toBeInstanceOf(HealthMonitor)
    expect(monitor.getStatus()).toBe('stopped')
  })
})
