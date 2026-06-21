/**
 * FireflyStateMachine: five-role chain scheduling state machine.
 *
 * Implements the router → main → reviewer → executor → gatekeeper chain
 * with strict context isolation between roles.
 *
 * P1-2: Five-role chain scheduling.
 */

export type FireflyRole = 'router' | 'main' | 'reviewer' | 'executor' | 'gatekeeper'

export type FireflyPhase =
  | 'idle'
  | 'router_decision'
  | 'main_candidate'
  | 'review_verdict'
  | 'executor_actions'
  | 'gatekeeper_verdict'
  | 'final_release'
  | 'blocked'
  | 'error'

export interface FireflyState {
  phase: FireflyPhase
  currentRole: FireflyRole | null
  /** Router's decision output */
  routerOutput?: string
  /** Main agent's candidate output */
  mainOutput?: string
  /** Reviewer's verdict output */
  reviewerOutput?: string
  /** Executor's actions output */
  executorOutput?: string
  /** Gatekeeper's final output */
  gatekeeperOutput?: string
  /** Approved actions from reviewer */
  approvedActions: string[]
  /** Rejected actions from reviewer */
  rejectedActions: string[]
  /** Guard verdict reasons */
  guardReasons: string[]
  /** Whether execution was blocked by guard */
  blockedByGuard: boolean
  /** Start timestamp */
  startedAt: number
  /** Per-role timing */
  roleTimings: Map<FireflyRole, { startedAt: number; completedAt?: number }>
}

const ROLE_ORDER: FireflyRole[] = ['router', 'main', 'reviewer', 'executor', 'gatekeeper']

/**
 * Create initial firefly state.
 */
export function createFireflyState(): FireflyState {
  return {
    phase: 'idle',
    currentRole: null,
    approvedActions: [],
    rejectedActions: [],
    guardReasons: [],
    blockedByGuard: false,
    startedAt: Date.now(),
    roleTimings: new Map()
  }
}

/**
 * Advance to the next role in the chain.
 */
export function advanceRole(state: FireflyState): FireflyState {
  const currentIdx = state.currentRole ? ROLE_ORDER.indexOf(state.currentRole) : -1
  const nextIdx = currentIdx + 1
  if (nextIdx >= ROLE_ORDER.length) {
    return { ...state, phase: 'final_release', currentRole: null }
  }
  const nextRole = ROLE_ORDER[nextIdx]
  const phaseMap: Record<FireflyRole, FireflyPhase> = {
    router: 'router_decision',
    main: 'main_candidate',
    reviewer: 'review_verdict',
    executor: 'executor_actions',
    gatekeeper: 'gatekeeper_verdict'
  }
  const timings = new Map(state.roleTimings)
  timings.set(nextRole, { startedAt: Date.now() })
  return {
    ...state,
    phase: phaseMap[nextRole],
    currentRole: nextRole,
    roleTimings: timings
  }
}

/**
 * Record a role's output and advance.
 */
export function completeRole(state: FireflyState, role: FireflyRole, output: string): FireflyState {
  const timings = new Map(state.roleTimings)
  const timing = timings.get(role)
  if (timing) timing.completedAt = Date.now()

  const updates: Partial<FireflyState> = { roleTimings: timings, currentRole: role }
  switch (role) {
    case 'router': updates.routerOutput = output; updates.phase = 'router_decision'; break
    case 'main': updates.mainOutput = output; updates.phase = 'main_candidate'; break
    case 'reviewer': updates.reviewerOutput = output; updates.phase = 'review_verdict'; break
    case 'executor': updates.executorOutput = output; updates.phase = 'executor_actions'; break
    case 'gatekeeper': updates.gatekeeperOutput = output; updates.phase = 'gatekeeper_verdict'; break
  }
  return advanceRole({ ...state, ...updates })
}

/**
 * Block the chain at the current role (guard verdict).
 */
export function blockChain(state: FireflyState, reasons: string[]): FireflyState {
  return {
    ...state,
    phase: 'blocked',
    blockedByGuard: true,
    guardReasons: reasons
  }
}

/**
 * Get the context visible to a specific role.
 * Enforces strict context isolation.
 */
export function getRoleContext(
  state: FireflyState,
  role: FireflyRole,
  userPrompt: string,
  memoryContext?: string,
  projectContext?: string
): { messages: string[]; constraints: string[] } {
  switch (role) {
    case 'router':
      return {
        messages: [userPrompt],
        constraints: [
          'You are the router. Analyze the user input and determine the task type.',
          'Output a JSON decision: { "taskType": "...", "complexity": "...", "suggestedAgent": "..." }',
          'Do NOT generate code or solutions. Only classify and route.'
        ]
      }
    case 'main':
      return {
        messages: [
          userPrompt,
          memoryContext || '',
          projectContext || ''
        ].filter(Boolean),
        constraints: [
          'You are the main agent. Generate a complete solution.',
          'Output your candidate answer directly. Do not discuss your reasoning process.'
        ]
      }
    case 'reviewer':
      return {
        messages: [
          `Original request: ${userPrompt}`,
          `Candidate output:\n${state.mainOutput || '(no output)'}`,
          'Review the candidate for correctness, security, and completeness.'
        ],
        constraints: [
          'You are the reviewer. Evaluate the candidate output.',
          'Output a verdict: PASS, WARN, REVISE, or BLOCK with reasons.',
          'Do NOT generate alternative solutions. Only evaluate.'
        ]
      }
    case 'executor':
      if (state.approvedActions.length === 0) {
        return {
          messages: ['No approved actions to execute.'],
          constraints: ['No actions approved. Complete as no-op.']
        }
      }
      return {
        messages: [
          `Approved actions: ${state.approvedActions.join(', ')}`,
          'Execute only the approved actions. Do not add new actions.'
        ],
        constraints: [
          'You are the executor. Execute ONLY the approved actions.',
          'Do NOT propose new actions. Do NOT skip approved actions.'
        ]
      }
    case 'gatekeeper':
      return {
        messages: [
          `Original request: ${userPrompt}`,
          `Main output: ${state.mainOutput || '(no output)'}`,
          `Reviewer verdict: ${state.reviewerOutput || '(no verdict)'}`,
          'Synthesize the final response for the user.'
        ],
        constraints: [
          'You are the gatekeeper. Produce the final user-facing response.',
          'Do NOT expose internal JSON, router decisions, or reviewer notes.',
          'Output ONLY the final answer in the user\'s expected format.'
        ]
      }
  }
}

/**
 * Check if the chain is complete.
 */
export function isComplete(state: FireflyState): boolean {
  return state.phase === 'final_release' || state.phase === 'blocked' || state.phase === 'error'
}

/**
 * Get the final output from the chain.
 */
export function getFinalOutput(state: FireflyState): string | null {
  if (state.phase === 'final_release') return state.gatekeeperOutput || state.mainOutput || null
  if (state.phase === 'blocked') return `Blocked: ${state.guardReasons.join('; ')}`
  return null
}
