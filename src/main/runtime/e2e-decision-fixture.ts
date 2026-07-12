import type { DecisionResolution } from '../../shared/decision-contract'
import { createAgentDecisionRequest, createToolDecisionRequest } from './decision-request-factories'
import type { DecisionService } from './decision-service'
import type { WorkbenchRuntimeStore } from './store'
import type { WorkbenchTurn } from './types'

const FIXTURE_ENV = 'AGENTHUB_E2E_DECISION_FIXTURE'
const SAME_TURN_PROMPT = 'E2E fixture: choose the repair direction'
const RESTART_PROMPT = 'E2E fixture: restart recovery permission'
const EXECUTION_COUNTER_FIXTURE = 'restart-permission-execution-counter'
const EXECUTION_COUNTER_GLOBAL = '__agentHubE2eDecisionFixturePermissionExecutionCount'

type FixtureMode = 'same-turn' | 'restart-seed' | 'restart-recover'

interface FixtureOptions {
  runtimeStore: WorkbenchRuntimeStore
  decisionService: DecisionService
  webContentsId: number
}

type FixtureGlobal = typeof globalThis & {
  [EXECUTION_COUNTER_GLOBAL]?: number
}

let installedMode: FixtureMode | null = null

function fixtureMode(): FixtureMode | null {
  if (process.env.AGENTHUB_E2E !== '1' || process.env.NODE_ENV !== 'test') return null
  const candidate = process.env[FIXTURE_ENV]
  return candidate === 'same-turn' || candidate === 'restart-seed' || candidate === 'restart-recover'
    ? candidate
    : null
}

function publishPermissionExecutionCount(count: number): void {
  ;(globalThis as FixtureGlobal)[EXECUTION_COUNTER_GLOBAL] = count
}

function countPermissionExecutions(runtimeStore: WorkbenchRuntimeStore, turn: WorkbenchTurn): number {
  return runtimeStore.eventsSince(turn.threadId, 0)
    .filter(event => event.turnId === turn.id && event.payload?.fixture === EXECUTION_COUNTER_FIXTURE)
    .reduce((count, event) => (
      typeof event.payload?.count === 'number' && Number.isInteger(event.payload.count) && event.payload.count >= count
        ? event.payload.count
        : count
    ), 0)
}

function originalRestartTurn(runtimeStore: WorkbenchRuntimeStore): WorkbenchTurn | undefined {
  return runtimeStore.snapshot(undefined).turns.find(turn => turn.prompt === RESTART_PROMPT)
}

async function persistPermissionExecutionCount(
  runtimeStore: WorkbenchRuntimeStore,
  turn: WorkbenchTurn,
  count: number
): Promise<void> {
  await runtimeStore.appendSystemEvent(turn.threadId, turn.id, 'agent:activity', 'e2e-fixture', {
    fixture: EXECUTION_COUNTER_FIXTURE,
    count,
    visibility: 'run'
  })
  publishPermissionExecutionCount(count)
}

async function requestAndWaitForAdmission(
  decisionService: DecisionService,
  request: ReturnType<typeof createAgentDecisionRequest> | ReturnType<typeof createToolDecisionRequest>,
  onResolution: (resolution: DecisionResolution) => Promise<void> | void
): Promise<void> {
  let resolveAdmission!: () => void
  let rejectAdmission!: (error: unknown) => void
  const admitted = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve
    rejectAdmission = reject
  })
  const resolution = decisionService.request(request, {
    onAdmitted: () => resolveAdmission()
  })
  void resolution.then(onResolution).catch(rejectAdmission)
  await admitted
}

async function installSameTurnFixture({ runtimeStore, decisionService, webContentsId }: FixtureOptions): Promise<void> {
  const { thread, turn } = await runtimeStore.createTurn({
    prompt: SAME_TURN_PROMPT,
    mode: 'auto',
    ownerWebContentsId: webContentsId
  })
  const request = createAgentDecisionRequest({
    owner: {
      type: 'turn',
      threadId: thread.id,
      turnId: turn.id,
      workspaceId: thread.workspaceId,
      webContentsId
    },
    title: 'Choose a fixture repair direction',
    description: 'This deterministic E2E decision resumes the existing Turn through the regular decision IPC.',
    kind: 'single-select',
    options: [
      { id: 'focused', label: 'Focused repair' },
      { id: 'broad', label: 'Broad repair' }
    ],
    idempotencyKey: 'e2e-same-turn-decision'
  })
  await requestAndWaitForAdmission(decisionService, request, async resolution => {
    if (resolution.status !== 'selected' || !resolution.selectedOptionIds?.includes('focused')) return
    await runtimeStore.completeTurnWithFinalEvent(turn.id, {
      agentId: 'e2e-fixture',
      payload: { content: 'Fixture resumed with focused' }
    })
  })
}

async function installRestartSeedFixture({ runtimeStore, decisionService, webContentsId }: FixtureOptions): Promise<void> {
  const { thread, turn } = await runtimeStore.createTurn({
    prompt: RESTART_PROMPT,
    mode: 'auto',
    ownerWebContentsId: webContentsId
  })
  const request = createToolDecisionRequest({
    owner: {
      type: 'turn',
      threadId: thread.id,
      turnId: turn.id,
      workspaceId: thread.workspaceId,
      webContentsId
    },
    agentId: 'e2e-fixture',
    tool: 'exec',
    toolName: 'Fixture permission',
    action: 'Seed an unresolved permission without executing it.',
    target: 'e2e://restart-permission',
    preview: 'fixture permission is intentionally not executed',
    risk: 'low',
    idempotencyKey: 'e2e-restart-permission'
  })
  await persistPermissionExecutionCount(runtimeStore, turn, 0)
  await requestAndWaitForAdmission(decisionService, request, async resolution => {
    if (resolution.status !== 'selected' || !resolution.selectedOptionIds?.includes('allow-once')) return
    const nextCount = countPermissionExecutions(runtimeStore, turn) + 1
    await persistPermissionExecutionCount(runtimeStore, turn, nextCount)
    await runtimeStore.completeTurnWithFinalEvent(turn.id, {
      agentId: 'e2e-fixture',
      payload: { content: 'Fixture permission continuation executed' }
    })
  })
}

function installRestartRecoveryFixture(runtimeStore: WorkbenchRuntimeStore): void {
  const originalTurn = originalRestartTurn(runtimeStore)
  publishPermissionExecutionCount(originalTurn ? countPermissionExecutions(runtimeStore, originalTurn) : 0)
}

/**
 * E2E-only fixture bootstrap. It has no side effects unless the dedicated test
 * environment flag selects a fixture mode.
 */
export async function installE2eDecisionFixture(options: FixtureOptions): Promise<void> {
  const mode = fixtureMode()
  if (!mode) return

  if (installedMode === mode) return

  if (mode === 'same-turn') {
    await installSameTurnFixture(options)
    installedMode = mode
    return
  }
  if (mode === 'restart-seed') {
    await installRestartSeedFixture(options)
    installedMode = mode
    return
  }
  installRestartRecoveryFixture(options.runtimeStore)
  installedMode = mode
}

/**
 * Keeps restart recovery deterministic: a fresh retry Turn completes locally,
 * avoiding a real provider/tool dispatch during the E2E proof.
 */
export async function completeE2eRestartRecoveryTurn(
  runtimeStore: WorkbenchRuntimeStore,
  turn: WorkbenchTurn
): Promise<boolean> {
  const originalTurn = originalRestartTurn(runtimeStore)
  if (
    fixtureMode() !== 'restart-recover' ||
    !originalTurn ||
    turn.retryOfTurnId !== originalTurn.id ||
    turn.prompt !== RESTART_PROMPT
  ) {
    return false
  }

  const completed = await runtimeStore.completeTurnWithFinalEvent(turn.id, {
    agentId: 'e2e-fixture',
    payload: { content: 'Fixture rerun completed after stale permission recovery' }
  })
  return completed
}
