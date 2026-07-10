export type DecisionSource =
  | 'prompt-optimizer'
  | 'agent'
  | 'router'
  | 'tool'
  | 'guard'
  | 'acp'
  | 'multi-model-loop'

export type DecisionKind = 'confirm' | 'single-select' | 'multi-select' | 'text'

export type DecisionState = 'queued' | 'active' | 'resolving' | 'terminal'

export type DecisionOwner =
  | {
      readonly type: 'turn'
      readonly threadId: string
      readonly turnId: string
      readonly workspaceId: string | null
      readonly webContentsId: number
    }
  | {
      readonly type: 'hub'
      readonly sessionId: string
    }

export interface DecisionOption {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly preview?: string
  readonly tone?: 'default' | 'safe' | 'warning' | 'danger'
}

export interface DecisionRequest {
  readonly schemaVersion: 1
  readonly id: string
  readonly owner: DecisionOwner
  readonly source: DecisionSource
  readonly kind: DecisionKind
  readonly title: string
  readonly description?: string
  readonly options: readonly DecisionOption[]
  readonly minSelections: number
  readonly maxSelections: number
  readonly allowCustom: boolean
  readonly customInput?: {
    readonly placeholder?: string
    readonly maxChars: number
  }
  readonly allowRemember: boolean
  readonly idempotencyKey?: string
  readonly createdAt: number
  readonly deadlineMs?: number
  readonly metadata?: {
    readonly agentId?: string
    readonly risk?: 'low' | 'medium' | 'high' | 'critical'
    readonly toolName?: string
    readonly action?: string
    readonly target?: string
    readonly preview?: string
  }
}

export interface PendingDecision {
  request: DecisionRequest
  state: DecisionState
  activatedAt?: number
  expiresAt?: number
}

export interface DecisionSubmission {
  requestId: string
  outcome: 'selected' | 'submitted' | 'denied' | 'cancelled'
  selectedOptionIds?: string[]
  customText?: string
  remember?: boolean
}

export interface DecisionResolution {
  requestId: string
  status: 'selected' | 'submitted' | 'denied' | 'cancelled' | 'timeout' | 'stale'
  selectedOptionIds?: string[]
  text?: string
  resolvedAt: number
}

export type DecisionResolveResult =
  | { accepted: true; warning?: 'remember_failed' }
  | { accepted: false }
