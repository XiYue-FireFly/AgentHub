/**
 * WorkflowRunner: execute workflow step DAGs.
 *
 * Takes a WorkflowDefinition, resolves step dependencies (topological sort),
 * executes steps sequentially respecting dependsOn, and tracks status.
 *
 * Phase 3.1: Agent orchestration enhancement.
 */

import { EventEmitter } from 'events'

export interface WorkflowStepResult {
  stepId: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  output?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface WorkflowRunResult {
  workflowId: string
  runId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  steps: WorkflowStepResult[]
  startedAt: number
  completedAt?: number
}

type StepExecutor = (step: { id: string; type: string; label: string; prompt?: string; agentId?: string }) => Promise<{ output: string; error?: string }>

/**
 * Topological sort of workflow steps by dependsOn.
 * Returns steps in execution order, or throws if cycle detected.
 */
export function resolveStepOrder(steps: Array<{ id: string; dependsOn?: string[] }>): string[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const step of steps) {
    inDegree.set(step.id, 0)
    adj.set(step.id, [])
  }
  for (const step of steps) {
    for (const dep of (step.dependsOn || [])) {
      if (!inDegree.has(dep)) throw new Error(`Unknown dependency: ${dep} (referenced by ${step.id})`)
      adj.get(dep)!.push(step.id)
      inDegree.set(step.id, (inDegree.get(step.id) || 0) + 1)
    }
  }

  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const result: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const next of adj.get(id) || []) {
      const deg = inDegree.get(next)! - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }
  if (result.length !== steps.length) {
    const missing = steps.filter(s => !result.includes(s.id)).map(s => s.id)
    throw new Error(`Cycle detected involving: ${missing.join(', ')}`)
  }
  return result
}

/**
 * Execute a workflow run.
 */
export async function executeWorkflow(
  workflowId: string,
  steps: Array<{ id: string; type: string; label: string; prompt?: string; agentId?: string; dependsOn?: string[] }>,
  executor: StepExecutor,
  opts?: { onStepStart?: (stepId: string) => void; onStepEnd?: (stepId: string, result: WorkflowStepResult) => void; signal?: AbortSignal }
): Promise<WorkflowRunResult> {
  const runId = `wfr-${Date.now().toString(36)}`
  const order = resolveStepOrder(steps)
  const stepMap = new Map(steps.map(s => [s.id, s]))
  const results = new Map<string, WorkflowStepResult>()
  const startedAt = Date.now()

  for (const id of order) {
    if (opts?.signal?.aborted) {
      const remaining = order.filter(s => !results.has(s))
      for (const rid of remaining) results.set(rid, { stepId: rid, status: 'skipped' })
      break
    }

    const step = stepMap.get(id)!
    // Check all dependencies succeeded
    const deps = step.dependsOn || []
    const depsFailed = deps.some(d => results.get(d)?.status !== 'succeeded')
    if (depsFailed) {
      results.set(id, { stepId: id, status: 'skipped' })
      opts?.onStepEnd?.(id, results.get(id)!)
      continue
    }

    results.set(id, { stepId: id, status: 'running', startedAt: Date.now() })
    opts?.onStepStart?.(id)

    try {
      const out = await executor(step)
      const result: WorkflowStepResult = {
        stepId: id,
        status: out.error ? 'failed' : 'succeeded',
        output: out.output,
        error: out.error,
        completedAt: Date.now()
      }
      results.set(id, result)
      opts?.onStepEnd?.(id, result)
      if (result.status === 'failed') {
        // Skip remaining steps
        const remaining = order.filter(s => !results.has(s))
        for (const rid of remaining) results.set(rid, { stepId: rid, status: 'skipped' })
        break
      }
    } catch (err: any) {
      const result: WorkflowStepResult = {
        stepId: id,
        status: 'failed',
        error: err?.message || String(err),
        completedAt: Date.now()
      }
      results.set(id, result)
      opts?.onStepEnd?.(id, result)
      const remaining = order.filter(s => !results.has(s))
      for (const rid of remaining) results.set(rid, { stepId: rid, status: 'skipped' })
      break
    }
  }

  const allSteps = [...results.values()]
  const finalStatus = opts?.signal?.aborted ? 'cancelled'
    : allSteps.some(s => s.status === 'failed') ? 'failed'
    : allSteps.every(s => s.status === 'succeeded' || s.status === 'skipped') ? 'succeeded'
    : 'running'

  return {
    workflowId,
    runId,
    status: finalStatus,
    steps: order.map(id => results.get(id) || { stepId: id, status: 'pending' }),
    startedAt,
    completedAt: Date.now()
  }
}
