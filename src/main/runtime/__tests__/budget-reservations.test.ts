import { describe, expect, it } from 'vitest'
import { BudgetReservationCenter } from '../budget-reservations'

const blockingConfig = {
  version: 1 as const,
  dailyLimitUsd: 10,
  monthlyLimitUsd: 100,
  perRequestMaxTokens: 20_000,
  perRequestMaxCostUsd: 8,
  notifyAtPercent: 80,
  blockWhenExceeded: true,
  suggestCheaperModel: true
}

function center() {
  return new BudgetReservationCenter(() => ({
    config: blockingConfig,
    dailySpentUsd: 1,
    monthlySpentUsd: 1
  }))
}

describe('BudgetReservationCenter', () => {
  it('counts active reservations before admitting another fan-out', () => {
    const reservations = center()

    const first = reservations.reserve('run-1', { tokens: 8_000, costUsd: 6, requests: 3 })
    const second = reservations.reserve('run-2', { tokens: 4_000, costUsd: 4, requests: 2 })

    expect(first).toMatchObject({
      ok: true,
      receipt: { id: expect.any(String), ownerId: 'run-1', costUsd: 6 }
    })
    expect(second).toEqual({ ok: false, reason: 'Daily budget ($10) exceeded' })
    expect(reservations.listActive()).toHaveLength(1)
  })

  it('releases reservations idempotently and admits a later request', () => {
    const reservations = center()
    const first = reservations.reserve('run-1', { tokens: 8_000, costUsd: 6, requests: 3 })
    if (!first.ok) throw new Error(first.reason)

    expect(reservations.release(first.receipt.id)).toBe(true)
    expect(reservations.release(first.receipt.id)).toBe(false)
    expect(reservations.listActive()).toEqual([])
    expect(reservations.reserve('run-2', { tokens: 4_000, costUsd: 4, requests: 2 }).ok).toBe(true)
  })

  it('enforces token limits even when cost is unpriced', () => {
    expect(center().reserve('large', { tokens: 20_001, costUsd: null, requests: 3 })).toEqual({
      ok: false,
      reason: 'Request exceeds 20000 token limit'
    })
  })

  it.each([
    ['empty owner', '', { tokens: 1, costUsd: null, requests: 1 }, 'Budget reservation owner is required'],
    ['non-finite tokens', 'run', { tokens: Number.NaN, costUsd: null, requests: 1 }, 'Budget reservation amount is invalid'],
    ['negative tokens', 'run', { tokens: -1, costUsd: null, requests: 1 }, 'Budget reservation amount is invalid'],
    ['fractional tokens', 'run', { tokens: 1.5, costUsd: null, requests: 1 }, 'Budget reservation amount is invalid'],
    ['fractional requests', 'run', { tokens: 1, costUsd: null, requests: 1.5 }, 'Budget reservation amount is invalid'],
    ['zero requests', 'run', { tokens: 1, costUsd: null, requests: 0 }, 'Budget reservation amount is invalid'],
    ['negative cost', 'run', { tokens: 1, costUsd: -1, requests: 1 }, 'Budget reservation amount is invalid'],
    ['non-finite cost', 'run', { tokens: 1, costUsd: Number.POSITIVE_INFINITY, requests: 1 }, 'Budget reservation amount is invalid']
  ])('rejects %s with a stable validation error', (_name, ownerId, amount, reason) => {
    expect(center().reserve(ownerId, amount)).toEqual({ ok: false, reason })
  })

  it.each([
    ['missing owner', undefined, { tokens: 1, costUsd: null, requests: 1 }, 'Budget reservation owner is required'],
    ['non-string owner', 42, { tokens: 1, costUsd: null, requests: 1 }, 'Budget reservation owner is required'],
    ['null amount', 'run', null, 'Budget reservation amount is invalid'],
    ['undefined amount', 'run', undefined, 'Budget reservation amount is invalid'],
    ['undefined cost', 'run', { tokens: 1, costUsd: undefined, requests: 1 }, 'Budget reservation amount is invalid']
  ])('fails closed for malformed runtime input: %s', (_name, ownerId, amount, reason) => {
    let result: unknown

    expect(() => {
      result = center().reserve(ownerId as any, amount as any)
    }).not.toThrow()
    expect(result).toEqual({ ok: false, reason })
  })
})
