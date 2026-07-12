/**
 * Hook Engine for AgentHub
 *
 * Inspired by Kun's hook-engine.ts
 * Supports PreToolUse, PostToolUse, and lifecycle hooks.
 */

export const HOOK_PHASES = [
  'PreToolUse',
  'PostToolUse',
  'PreDispatch',
  'PostDispatch'
] as const

export type HookPhase = (typeof HOOK_PHASES)[number]

export interface ToolCallLike {
  toolName: string
  arguments: Record<string, unknown>
}

export interface ToolHookContext {
  threadId: string
  turnId?: string
  workspace?: string
  agentId?: string
}

export interface ToolHookResultPayload {
  output: unknown
  isError?: boolean
}

export type HookInvocation =
  | { phase: 'PreToolUse'; call: ToolCallLike; context: ToolHookContext }
  | { phase: 'PostToolUse'; call: ToolCallLike; context: ToolHookContext; result: ToolHookResultPayload }
  | { phase: 'PreDispatch'; threadId: string; prompt: string; workspace?: string }
  | { phase: 'PostDispatch'; threadId: string; prompt: string; result: unknown; workspace?: string }

export interface HookResult {
  decision?: 'allow' | 'deny' | 'request-approval'
  requestApproval?: {
    pluginId: string
    hookId: string
    message: string
  }
  message?: string
  arguments?: Record<string, unknown>
  output?: unknown
  isError?: boolean
  additionalContext?: string
}

export interface ResolvedHook {
  phase: HookPhase
  matcher?: string
  toolNames?: string[]
  timeoutMs?: number
  run: (invocation: HookInvocation) => Promise<HookResult | void> | HookResult | void
}

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000

export interface PreToolUseOutcome {
  call: ToolCallLike
  denied?: string
  autoApproved: boolean
  warnings: string[]
}

export interface PostToolUseOutcome {
  output: unknown
  isError?: boolean
  warnings: string[]
}

export interface DispatchOutcome {
  denied?: string
  approvalRequests: Array<{
    pluginId: string
    hookId: string
    message: string
  }>
  additionalContext: string[]
  warnings: string[]
}

export interface ObserverOutcome {
  warnings: string[]
}

/**
 * Check if there are hooks for a specific phase.
 */
export function hasHooksForPhase(hooks: ResolvedHook[] | undefined, phase: HookPhase): boolean {
  return (hooks ?? []).some((hook) => hook.phase === phase)
}

/**
 * Run PreToolUse hooks in order.
 */
export async function runPreToolUseHooks(
  hooks: ResolvedHook[] | undefined,
  input: { call: ToolCallLike; context: ToolHookContext }
): Promise<PreToolUseOutcome> {
  let call = input.call
  let autoApproved = false
  const warnings: string[] = []

  for (const hook of hooksForTool(hooks, 'PreToolUse', call.toolName)) {
    const outcome = await executeHook(hook, { phase: 'PreToolUse', call, context: input.context })
    if (outcome.warning) warnings.push(outcome.warning)
    const result = outcome.result
    if (!result) continue

    if (result.decision === 'deny') {
      return {
        call,
        denied: result.message || 'tool call denied by PreToolUse hook',
        autoApproved: false,
        warnings
      }
    }
    if (result.decision === 'allow') autoApproved = true
    if (result.arguments && typeof result.arguments === 'object') {
      call = { ...call, arguments: result.arguments }
    }
  }

  return { call, autoApproved, warnings }
}

/**
 * Run PostToolUse hooks in order.
 */
export async function runPostToolUseHooks(
  hooks: ResolvedHook[] | undefined,
  input: { call: ToolCallLike; context: ToolHookContext; result: ToolHookResultPayload }
): Promise<PostToolUseOutcome> {
  let current = input.result
  const warnings: string[] = []

  for (const hook of hooksForTool(hooks, 'PostToolUse', input.call.toolName)) {
    const outcome = await executeHook(hook, {
      phase: 'PostToolUse',
      call: input.call,
      context: input.context,
      result: current
    })
    if (outcome.warning) warnings.push(outcome.warning)
    const result = outcome.result
    if (!result) continue

    if ('output' in result) {
      current = { output: result.output, isError: result.isError ?? current.isError }
    } else if (result.isError !== undefined) {
      current = { ...current, isError: result.isError }
    }
  }

  return { output: current.output, isError: current.isError, warnings }
}

/**
 * Run PreDispatch hooks.
 */
export async function runPreDispatchHooks(
  hooks: ResolvedHook[] | undefined,
  input: { threadId: string; prompt: string; workspace?: string }
): Promise<DispatchOutcome> {
  const additionalContext: string[] = []
  const approvalRequests: DispatchOutcome['approvalRequests'] = []
  const warnings: string[] = []

  for (const hook of hooksForPhase(hooks, 'PreDispatch')) {
    let outcome: HookExecutionOutcome
    try {
      outcome = await executeHook(hook, { phase: 'PreDispatch', ...input })
    } catch (error) {
      warnings.push(`PreDispatch hook failed: ${errorMessage(error)}`)
      continue
    }
    if (outcome.warning) warnings.push(outcome.warning)
    const result = outcome.result
    if (!result) continue

    if (result.decision === 'deny') {
      return {
        denied: result.message || 'dispatch denied by PreDispatch hook',
        approvalRequests,
        additionalContext,
        warnings
      }
    }
    if (result.decision === 'request-approval' && result.requestApproval) {
      approvalRequests.push(result.requestApproval)
    }
    if (result.additionalContext?.trim()) additionalContext.push(result.additionalContext.trim())
  }

  return { approvalRequests, additionalContext, warnings }
}

/**
 * Run observer hooks (PostDispatch).
 */
export async function runObserverHooks(
  hooks: ResolvedHook[] | undefined,
  invocation: Extract<HookInvocation, { phase: 'PostDispatch' }>
): Promise<ObserverOutcome> {
  const warnings: string[] = []

  for (const hook of hooksForPhase(hooks, invocation.phase)) {
    try {
      const outcome = await executeHook(hook, invocation)
      if (outcome.warning) warnings.push(outcome.warning)
      else if (outcome.result?.message?.trim()) warnings.push(outcome.result.message.trim())
    } catch (error) {
      warnings.push(`${invocation.phase} hook failed: ${errorMessage(error)}`)
    }
  }

  return { warnings }
}

function hooksForPhase(hooks: ResolvedHook[] | undefined, phase: HookPhase): ResolvedHook[] {
  return (hooks ?? []).filter((hook) => hook.phase === phase)
}

function hooksForTool(
  hooks: ResolvedHook[] | undefined,
  phase: HookPhase,
  toolName: string
): ResolvedHook[] {
  return hooksForPhase(hooks, phase).filter((hook) => hookMatchesTool(hook, toolName))
}

export function hookMatchesTool(
  hook: Pick<ResolvedHook, 'matcher' | 'toolNames'>,
  toolName: string
): boolean {
  const hasNames = Boolean(hook.toolNames && hook.toolNames.length > 0)
  const hasMatcher = Boolean(hook.matcher)
  if (!hasNames && !hasMatcher) return true
  if (hasNames && hook.toolNames!.includes(toolName)) return true
  if (hasMatcher && compileMatcher(hook.matcher!).test(toolName)) return true
  return false
}

const matcherCache = new Map<string, RegExp>()

function compileMatcher(pattern: string): RegExp {
  const cached = matcherCache.get(pattern)
  if (cached) return cached
  const alternatives = pattern
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[.+?^${}()[\]\\]/g, '\\$&').replaceAll('*', '.*'))
  const regex = new RegExp(`^(?:${alternatives.join('|') || '$.'})$`)
  matcherCache.set(pattern, regex)
  return regex
}

interface HookExecutionOutcome {
  result?: HookResult
  warning?: string
}

async function executeHook(hook: ResolvedHook, invocation: HookInvocation): Promise<HookExecutionOutcome> {
  try {
    const result = await withTimeout(
      Promise.resolve().then(() => hook.run(invocation)),
      hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      `${hook.phase} hook timed out`
    )
    return result ? { result } : {}
  } catch (error) {
    return { warning: `${hook.phase} hook failed: ${errorMessage(error)}` }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs))
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
