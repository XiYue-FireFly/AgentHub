import { randomUUID } from 'node:crypto'
import { checkBudget, getBudgetConfig, type BudgetConfig } from './budget-center'
import { currentUsageSpend } from './usage-stats'

export interface BudgetReservationAmount {
  tokens: number
  costUsd: number | null
  requests: number
}

export interface BudgetReservationReceipt extends BudgetReservationAmount {
  id: string
  ownerId: string
  createdAt: number
}

export interface BudgetReservationSnapshot {
  config: BudgetConfig
  dailySpentUsd: number
  monthlySpentUsd: number
}

export type BudgetReservationResult =
  | { ok: true; receipt: BudgetReservationReceipt; warning?: string }
  | { ok: false; reason: string }

export class BudgetReservationCenter {
  private readonly active = new Map<string, BudgetReservationReceipt>()

  constructor(private readonly snapshot: () => BudgetReservationSnapshot) {}

  reserve(ownerId: string, amount: BudgetReservationAmount): BudgetReservationResult {
    if (typeof ownerId !== 'string' || !ownerId.trim()) {
      return { ok: false, reason: 'Budget reservation owner is required' }
    }
    const rawAmount = amount as unknown
    if (!rawAmount || typeof rawAmount !== 'object' || Array.isArray(rawAmount)) {
      return { ok: false, reason: 'Budget reservation amount is invalid' }
    }
    const reservationAmount = rawAmount as BudgetReservationAmount
    if (
      !Number.isFinite(reservationAmount.tokens)
      || reservationAmount.tokens < 0
      || !Number.isInteger(reservationAmount.tokens)
      || !Number.isInteger(reservationAmount.requests)
      || reservationAmount.requests < 1
      || (reservationAmount.costUsd !== null
        && (!Number.isFinite(reservationAmount.costUsd) || reservationAmount.costUsd < 0))
    ) {
      return { ok: false, reason: 'Budget reservation amount is invalid' }
    }

    const current = this.snapshot()
    let activeCost = 0
    for (const receipt of this.active.values()) activeCost += receipt.costUsd ?? 0

    const check = checkBudget(
      current.config,
      current.dailySpentUsd + activeCost,
      current.monthlySpentUsd + activeCost,
      reservationAmount.tokens,
      reservationAmount.costUsd
    )
    if (!check.allowed) return { ok: false, reason: check.reason || 'Budget reservation denied' }

    const receipt: BudgetReservationReceipt = Object.freeze({
      id: randomUUID(),
      ownerId,
      tokens: reservationAmount.tokens,
      costUsd: reservationAmount.costUsd,
      requests: reservationAmount.requests,
      createdAt: Date.now()
    })
    this.active.set(receipt.id, receipt)
    return { ok: true, receipt, warning: check.warning }
  }

  release(id: string): boolean {
    return this.active.delete(id)
  }

  listActive(): BudgetReservationReceipt[] {
    return [...this.active.values()]
  }
}

export const dispatchBudgetReservations = new BudgetReservationCenter(() => {
  const spend = currentUsageSpend()
  return {
    config: getBudgetConfig(),
    dailySpentUsd: spend.dailySpentUsd,
    monthlySpentUsd: spend.monthlySpentUsd
  }
})
