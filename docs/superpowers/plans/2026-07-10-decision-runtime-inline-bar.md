# Decision Runtime and Inline Decision Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one durable, typed decision runtime that pauses and resumes the same Turn, serializes every Workbench submission per thread, and presents Prompt, Agent, tool, ACP, and Guard choices in an accessible inline DecisionBar.

**Architecture:** The main process owns all authoritative state: terminal Turn semantics, atomic runtime mutations, immutable queued submissions, DecisionService queues, timers, sender binding, and continuation release. The Renderer obtains complete live cards from pending-list IPC, reduces them with Renderer-local draft decisions, and renders one stable inline card above the Composer input; runtime history remains audit-only. Existing tool, ACP, and Guard await points become trusted adapters over the shared service, while the old modal and in-message action paths are retired only after adapter parity tests pass.

**Tech Stack:** Electron 33, TypeScript 5.6, Node.js 24, React 18, typed Electron IPC, Vitest 4 with happy-dom, Testing Library, Playwright Electron E2E, the existing JSON AppStore, and PowerShell-compatible `npm.cmd` commands.

---

## Source of truth and execution constraints

- Design source: `docs/superpowers/specs/2026-07-10-multi-model-loop-prompt-decisions-design.md`, especially sections 6, 7, 8, 11, 13, 14, 15.1, 15.2, 15.4, and 16.
- Work only on the files named by the current task. Do not stage, revert, format, or repair unrelated dirty-worktree changes.
- Run each red test before production code. A test that unexpectedly passes means the test does not isolate the missing behavior; strengthen it before implementation.
- Every decision transition that can release a continuation must be durable before event publication and before resolving its waiter.
- Renderer events are hints. `turns:listPendingDecisions()` is the complete live-card authority after refresh, window changes, or event gaps.
- Keep the existing Composer single-head worker semantics. It becomes an optimistic projection of the main-process admission queue, not the execution authority.
- Keep raw Prompt candidates and permission previews out of runtime event history. The durable live decision record may contain display-safe card data; audit events contain IDs, source, hashes, state, and redacted summaries.

## File responsibility map

### New files

| File | Responsibility |
| --- | --- |
| `src/shared/turn-status.ts` | Single Turn status union and terminal-status predicate usable by main, preload contracts, and Renderer. |
| `src/main/runtime/turn-status.ts` | Runtime-facing re-export so main-process code has one stable import path. |
| `src/main/runtime/__tests__/turn-status.test.ts` | Terminal/non-terminal truth table. |
| `src/shared/decision-contract.ts` | Shared decision request, pending item, submission, resolution, owner, source, kind, state, and IPC result types. |
| `src/main/runtime/decision-request-factories.ts` | Runtime validation plus branded neutral and privileged request factories. |
| `src/main/runtime/decision-service.ts` | FIFO state machine, waiters, timers, limits, cancellation, durable request/resolution ordering, shutdown, and orphan recovery. |
| `src/main/runtime/__tests__/decision-request-factories.test.ts` | Privileged-field, cardinality, size, and ID validation. |
| `src/main/runtime/__tests__/decision-service.test.ts` | Decision lifecycle, isolation, idempotency, failure rollback, timeout, cancellation, and orphan sweep. |
| `src/main/ipc/decision-ipc.ts` | Pending-list and resolution IPC handlers with sender binding. |
| `src/main/ipc/__tests__/decision-ipc.test.ts` | IPC payload and sender-scope tests. |
| `src/main/runtime/thread-execution-coordinator.ts` | Durable per-thread admission queue and terminal-state drain loop. |
| `src/main/runtime/workbench-turn-runner.ts` | Existing create/retry preparation and dispatch logic behind an injected runner boundary. |
| `src/main/runtime/__tests__/thread-execution-coordinator.test.ts` | Durable FIFO, cancellation, multi-window, refresh, and recovery tests. |
| `src/renderer/workbench/decisions/decisionQueue.ts` | Pure authoritative reconciliation and stable active-card selection. |
| `src/renderer/workbench/decisions/decisionAdapters.ts` | Runtime pending cards and local draft decisions to one presentation union. |
| `src/renderer/workbench/decisions/DecisionBar.tsx` | Accessible inline A-layout card with selection, custom text, remember, busy, and retryable-error states. |
| `src/renderer/workbench/decisions/__tests__/decisionQueue.test.ts` | Stable FIFO and refresh reconciliation tests. |
| `src/renderer/workbench/decisions/__tests__/DecisionBar.test.tsx` | Interaction and accessibility tests. |
| `src/main/runtime/decision-adapters/tool-decision-adapter.ts` | Trusted tool request mapping and remember-policy callback. |
| `src/main/runtime/decision-adapters/acp-decision-adapter.ts` | Trusted ACP option preservation and exact option-ID resolution. |
| `src/main/runtime/decision-adapters/guard-decision-adapter.ts` | Trusted Guard decision mapping with structured denial/timeout/cancellation. |
| `src/main/runtime/decision-adapters/__tests__/tool-decision-adapter.test.ts` | Tool allow/deny/remember tests. |
| `src/main/runtime/decision-adapters/__tests__/acp-decision-adapter.test.ts` | Exact ACP option-ID tests. |
| `src/main/runtime/decision-adapters/__tests__/guard-decision-adapter.test.ts` | Guard continuation and fail-closed tests. |
| `src/main/__tests__/decision-runtime-architecture.test.ts` | Migration guard proving new wiring exists and legacy primary channels are gone. |
| `src/main/runtime/e2e-decision-fixture.ts` | Environment-gated deterministic E2E decision request; inert outside E2E. |

### Existing high-overlap files

| File and current lines | Required narrow change |
| --- | --- |
| `src/main/runtime/types.ts:1,92-116,129-154` | Import shared status type; add decision event kinds, decision ledger records, queued submissions, and Turn owner metadata. |
| `src/shared/ipc-contract.ts:533-567,3061-3132,6734-6814` | Reuse shared status/decision types; add pending-list, resolve, queue-list, and clear-queue channels and validators; later remove legacy resolve channels. |
| `src/main/store.ts:54-127` | Add a rejecting, serialized atomic `commit()` API without changing existing debounced `set()` callers. |
| `src/main/runtime/store.ts:20-34,41-85,165-223,238-245,275-329,352-386` | Add transaction serialization, cloned mutation facade, decision/submission state, terminal helper use, and decision-aware compaction. |
| `src/main/index.ts:82,588-993,1070-1099,1123-1158` | Instantiate services; move create/retry bodies behind runner/coordinator; bind cancellation and graceful shutdown. |
| `src/main/ipc/index.ts:27-49,115-135` | Register decision and coordinated Turn IPC with injected dependencies. |
| `src/main/ipc/hub-threads-ipc.ts:41-64,87-120,168-173` | Use shared terminal helper; keep historical fork isolated; explicitly route Workbench-producing Git submissions through admission. |
| `src/preload/index.ts:121-141` | Expose validated decision and admission wrappers. |
| `src/renderer/vite-env.d.ts:168-174,568,832-849` | Reuse shared status and decision result types; add new preload methods; later remove legacy methods. |
| `src/renderer/workbench/WorkbenchLayout.tsx:130-185,300-305,353-545,547-588,959-1024,1096-1107,1392-1432,1503-1509` | Own authoritative pending decisions, submit actions, thread counts, coordinator receipts, and remove old modal state. |
| `src/renderer/workbench/WorkbenchMainContent.tsx:45-59,127-183,221-279` | Carry active decision and count props to Composer; remove Guard action callback. |
| `src/renderer/workbench/ComposerBar.tsx:142-164,401-456,810-823` | Preserve local send worker; insert DecisionBar immediately before the input layer; own local draft revision/hash. |
| `src/renderer/workbench/PromptEnhancer.tsx:8-61` | Emit a revision-bound local draft decision instead of replacing text immediately. |
| `src/renderer/workbench/SessionSidebar.tsx:15-45,298-307,445-469` | Render pending-decision counts and treat `awaiting-decision` as active but non-terminal. |
| `src/renderer/workbench/ThreadView.tsx:23-38,89-96,600-643,805-829` | Use shared terminal semantics and convert Guard decision actions to read-only audit cards. |
| `src/main/hub/dispatcher.ts:243-272,1083,1123-1275,1639-1745` | Replace local approval map with tool/ACP adapters while retaining audit stream events and cancellation semantics. |
| `src/main/hub/adapters/acp-client.ts:29-41,437-505` | Return a structured selected option, validate membership, and stop auto-selecting the first option. |
| `src/main/runtime/guard-approval-service.ts:12-100` | Reduce to compatibility exports during migration, then remove its in-memory waiter map. |
| `src/main/runtime/schedule-helpers.ts:244-310` | Await Guard adapter result and preserve the same schedule continuation. |
| `src/renderer/glass/approval-dialog.tsx:10-123` | Delete after inline tool cards pass parity tests. |
| `src/renderer/workbench/utils/approvalEvents.ts:180-224` | Keep audit reconciliation only; remove decision submission ownership. |

## Task A: Establish one terminal Turn-status invariant

**Files:**
- Create: `src/shared/turn-status.ts`
- Create: `src/main/runtime/turn-status.ts`
- Create: `src/main/runtime/__tests__/turn-status.test.ts`
- Create: `src/main/hub/task-turn-tracking.ts`
- Create: `src/main/hub/__tests__/task-turn-tracking.test.ts`
- Test: `src/main/__tests__/task-turn-tracking-wiring.test.ts`
- Modify: `src/main/runtime/types.ts:1`
- Modify: `src/shared/ipc-contract.ts:533`
- Modify: `src/renderer/vite-env.d.ts:568`
- Modify: `src/main/runtime/store.ts:214-223,238-245,275-288`
- Modify: `src/renderer/workbench/WorkbenchLayout.tsx:578-588`
- Modify: `src/renderer/workbench/SessionSidebar.tsx:100,445-469`
- Modify: `src/renderer/workbench/ThreadView.tsx:381-390,805-829`
- Modify: `src/main/ipc/hub-threads-ipc.ts:168-173`

- [ ] **Step 1: Write the failing terminal-status truth-table test**

```ts
import { describe, expect, it } from 'vitest'
import { isTerminalTurnStatus, TERMINAL_TURN_STATUSES } from '../../../shared/turn-status'

describe('Turn terminal status invariant', () => {
  it('treats only completed, failed, cancelled, and interrupted as terminal', () => {
    expect(TERMINAL_TURN_STATUSES).toEqual([
      'completed',
      'failed',
      'cancelled',
      'interrupted'
    ])
    expect(isTerminalTurnStatus('queued')).toBe(false)
    expect(isTerminalTurnStatus('running')).toBe(false)
    expect(isTerminalTurnStatus('awaiting-decision')).toBe(false)
    expect(isTerminalTurnStatus('completed')).toBe(true)
    expect(isTerminalTurnStatus('failed')).toBe(true)
    expect(isTerminalTurnStatus('cancelled')).toBe(true)
    expect(isTerminalTurnStatus('interrupted')).toBe(true)
  })
})
```

Also create `src/main/hub/__tests__/task-turn-tracking.test.ts` with the non-terminal tracking regression:

```ts
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installTaskTurnTracking } from '../task-turn-tracking'

it('keeps the task attached while its Turn awaits a decision and releases only on a shared terminal status', () => {
  const dispatcher = new EventEmitter()
  const runtimeStore = { attachTask: vi.fn(), appendStreamEvent: vi.fn() }
  installTaskTurnTracking(dispatcher, runtimeStore)

  dispatcher.emit('task:created', { id: 'task-1', __turnId: 'turn-1' })
  dispatcher.emit('task:finished', { id: 'task-1', status: 'awaiting-decision' })
  dispatcher.emit('stream', { taskId: 'task-1', kind: 'delta', text: 'after pause' })
  expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)

  dispatcher.emit('task:finished', { id: 'task-1', status: 'interrupted' })
  dispatcher.emit('stream', { taskId: 'task-1', kind: 'delta', text: 'too late' })
  expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/__tests__/turn-status.test.ts`

Expected: FAIL because `src/shared/turn-status.ts` does not exist.

- [ ] **Step 3: Add the shared status source and runtime re-export**

```ts
// src/shared/turn-status.ts
export const TURN_STATUSES = [
  'queued',
  'running',
  'awaiting-decision',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
] as const

export type WorkbenchTurnStatus = (typeof TURN_STATUSES)[number]

export const TERMINAL_TURN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'interrupted'
] as const satisfies readonly WorkbenchTurnStatus[]

const TERMINAL = new Set<WorkbenchTurnStatus>(TERMINAL_TURN_STATUSES)

export function isTerminalTurnStatus(status: WorkbenchTurnStatus): boolean {
  return TERMINAL.has(status)
}
```

```ts
// src/main/runtime/turn-status.ts
export {
  TURN_STATUSES,
  TERMINAL_TURN_STATUSES,
  isTerminalTurnStatus,
  type WorkbenchTurnStatus
} from '../../shared/turn-status'
```

Create `src/main/hub/task-turn-tracking.ts` so task/Turn stream ownership uses the same terminal predicate:

```ts
import { isTerminalTurnStatus, type WorkbenchTurnStatus } from '../../shared/turn-status'

interface TaskTurnEventSource {
  on(event: string, listener: (...args: any[]) => void): unknown
  off?(event: string, listener: (...args: any[]) => void): unknown
}

interface TaskTurnRuntimeStore {
  attachTask(turnId: string, taskId: string): void
  appendStreamEvent(turnId: string, event: any): void
}

export function installTaskTurnTracking(dispatcher: TaskTurnEventSource, runtimeStore: TaskTurnRuntimeStore): () => void {
  const taskToTurn = new Map<string, string>()
  const onCreated = (task: { id: string; __turnId?: string }) => {
    if (!task.__turnId) return
    taskToTurn.set(task.id, task.__turnId)
    try { runtimeStore.attachTask(task.__turnId, task.id) }
    catch { taskToTurn.delete(task.id) }
  }
  const onStream = (event: { taskId: string; __runtimeTurnId?: string }) => {
    const turnId = taskToTurn.get(event.taskId)
    if (!turnId) return
    event.__runtimeTurnId = turnId
    try { runtimeStore.appendStreamEvent(turnId, event) } catch { /* stream persistence reports elsewhere */ }
  }
  const onFinished = (task: { id: string; status: WorkbenchTurnStatus }) => {
    if (isTerminalTurnStatus(task.status)) taskToTurn.delete(task.id)
  }
  const onRemoved = (event: { taskId: string }) => taskToTurn.delete(event.taskId)

  dispatcher.on('task:created', onCreated)
  dispatcher.on('stream', onStream)
  dispatcher.on('task:finished', onFinished)
  dispatcher.on('task:removed', onRemoved)
  return () => {
    dispatcher.off?.('task:created', onCreated)
    dispatcher.off?.('stream', onStream)
    dispatcher.off?.('task:finished', onFinished)
    dispatcher.off?.('task:removed', onRemoved)
    taskToTurn.clear()
  }
}
```

Install this once beside Dispatcher construction in `src/main/index.ts`; `task:removed` may always detach, but `task:finished` must not detach for `queued`, `running`, or `awaiting-decision`.

- [ ] **Step 4: Replace duplicated status unions and terminal comparisons**

At `src/main/runtime/types.ts:1`, replace the local union with:

```ts
export type { WorkbenchTurnStatus } from '../../shared/turn-status'
import type { WorkbenchTurnStatus } from '../../shared/turn-status'
```

At `src/shared/ipc-contract.ts:533`, replace the local union with:

```ts
export type WorkbenchTurnStatusLike = import('./turn-status').WorkbenchTurnStatus
```

At `src/renderer/vite-env.d.ts:568`, replace the ambient union with:

```ts
type WorkbenchTurnStatus = import('../shared/turn-status').WorkbenchTurnStatus
```

Use the shared predicate for every completion calculation. The critical RuntimeStore replacement is:

```ts
setTurnStatus(turnId: string, status: WorkbenchTurnStatus, payload: any = {}): void {
  const turn = this.requireTurn(turnId)
  turn.status = status
  if (isTerminalTurnStatus(status)) turn.completedAt = Date.now()
  else delete turn.completedAt
  const thread = this.requireThread(turn.threadId)
  thread.lastTurnStatus = status
  thread.updatedAt = Date.now()
  this.appendEvent(turn.threadId, turn.id, 'turn:status', undefined, { status, ...payload }, false)
  this.save()
}
```

Change completed-task filtering to `isTerminalTurnStatus(turn.status)`. Change Renderer running/active calculations to `!isTerminalTurnStatus(status)`, while displaying `awaiting-decision` as “Waiting for decision” and `interrupted` as “Interrupted”. Change `finalStatusFromEvents()` to return `WorkbenchTurnStatus` and preserve `interrupted` rather than coercing it to `completed`.

- [ ] **Step 5: Add stale-completion-time coverage to the existing store test**

Add this test to `src/main/runtime/__tests__/store.test.ts`:

```ts
it('clears completedAt when a Turn returns to a non-terminal decision state', async () => {
  const { WorkbenchRuntimeStore } = await import('../store')
  const runtime = new WorkbenchRuntimeStore()
  runtimes.push(runtime)
  const { turn } = runtime.createTurn({ prompt: 'approval', mode: 'auto', workspaceId: null })

  runtime.setTurnStatus(turn.id, 'completed')
  expect(runtime.getTurn(turn.id)?.completedAt).toEqual(expect.any(Number))

  runtime.setTurnStatus(turn.id, 'awaiting-decision')
  expect(runtime.getTurn(turn.id)?.completedAt).toBeUndefined()
  expect(runtime.clearCompletedTasks()).not.toContain(turn.id)
})
```

- [ ] **Step 6: Run the focused status and store tests**

Run: `npm.cmd test -- src/main/runtime/__tests__/turn-status.test.ts src/main/runtime/__tests__/store.test.ts src/main/hub/__tests__/task-turn-tracking.test.ts src/main/__tests__/task-turn-tracking-wiring.test.ts`

Expected: PASS.

- [ ] **Step 7: Type-check status consumers**

Run: `npm.cmd run typecheck`

Expected: PASS with all switches and status labels handling `awaiting-decision` and `interrupted`.

- [ ] **Step 8: Commit the invariant**

```powershell
git add -- src/shared/turn-status.ts src/main/runtime/turn-status.ts src/main/runtime/__tests__/turn-status.test.ts src/main/hub/task-turn-tracking.ts src/main/hub/__tests__/task-turn-tracking.test.ts src/main/__tests__/task-turn-tracking-wiring.test.ts src/main/index.ts src/main/runtime/types.ts src/shared/ipc-contract.ts src/renderer/vite-env.d.ts src/main/runtime/store.ts src/main/runtime/__tests__/store.test.ts src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/SessionSidebar.tsx src/renderer/workbench/ThreadView.tsx src/main/ipc/hub-threads-ipc.ts
git commit -m "feat(runtime): define terminal turn states"
```

## Task B: Add awaited atomic runtime mutations and protected ledgers

**Files:**
- Modify: `src/main/store.ts:54-127`
- Modify: `src/main/__tests__/store-local-token.test.ts:86-116`
- Modify: `src/main/runtime/types.ts:101-154`
- Modify: `src/main/runtime/store.ts:20-85,316-386`
- Modify: `src/main/runtime/__tests__/store.test.ts:1-12,145-166,252-271`

- [ ] **Step 1: Write red tests for rejecting persistence and publish-after-commit**

Extend the hoisted store mock in `src/main/runtime/__tests__/store.test.ts` with `commit` and add:

```ts
const commit = vi.fn(async (key: string, value: any) => {
  memory[key] = value
})

vi.mock('../../store', () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { setCount++; memory[key] = value },
    commit
  }
}))

it('publishes a runtime mutation only after the durable commit succeeds', async () => {
  const { WorkbenchRuntimeStore } = await import('../store')
  const runtime = new WorkbenchRuntimeStore()
  runtimes.push(runtime)
  const { turn } = runtime.createTurn({ prompt: 'atomic', mode: 'auto', workspaceId: null })
  const published: RuntimeEvent[] = []
  runtime.on('event', event => published.push(event))
  commit.mockClear()
  published.length = 0

  await runtime.commitRuntimeMutation(tx => {
    tx.setTurnStatus(turn.id, 'awaiting-decision')
    tx.appendEvent(turn.threadId, turn.id, 'decision:requested', undefined, {
      requestId: 'decision-1',
      source: 'agent'
    })
  })

  expect(commit).toHaveBeenCalledTimes(1)
  expect(published.map(event => event.kind)).toEqual(['turn:status', 'decision:requested'])
  expect(runtime.getTurn(turn.id)?.status).toBe('awaiting-decision')
})

it('keeps the old snapshot and publishes nothing when persistence fails', async () => {
  const { WorkbenchRuntimeStore } = await import('../store')
  const runtime = new WorkbenchRuntimeStore()
  runtimes.push(runtime)
  const { turn } = runtime.createTurn({ prompt: 'rollback', mode: 'auto', workspaceId: null })
  const published: RuntimeEvent[] = []
  runtime.on('event', event => published.push(event))
  commit.mockRejectedValueOnce(new Error('disk full'))
  published.length = 0

  await expect(runtime.commitRuntimeMutation(tx => {
    tx.setTurnStatus(turn.id, 'awaiting-decision')
    tx.appendEvent(turn.threadId, turn.id, 'decision:requested', undefined, {
      requestId: 'decision-2',
      source: 'agent'
    })
  })).rejects.toThrow('disk full')

  expect(runtime.getTurn(turn.id)?.status).toBe('running')
  expect(published).toEqual([])
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/__tests__/store.test.ts`

Expected: FAIL because `store.commit()` and `commitRuntimeMutation()` do not exist.

- [ ] **Step 3: Add a rejecting atomic commit to AppStore**

Add the following methods to `AppStore` in `src/main/store.ts`. `enqueuePersist()` may keep logging and recovering for legacy fire-and-forget saves; `commit()` must return the original rejecting operation to its caller.

```ts
private async persistSnapshot(snapshot: Record<string, any>): Promise<void> {
  const tmp = this.filePath + '.tmp'
  await fs.promises.writeFile(tmp, JSON.stringify(snapshot, null, 2))
  await fs.promises.rename(tmp, this.filePath)
}

async commit(key: string, value: any): Promise<void> {
  this.init()
  if (this.saveTimer) {
    clearTimeout(this.saveTimer)
    this.saveTimer = null
  }

  const operation = this.saveChain.then(async () => {
    const candidate = { ...this.data, [key]: value }
    await this.persistSnapshot(candidate)
    this.data = candidate
  })

  this.saveChain = operation.catch(error => {
    log.error(`[Store] Atomic commit failed (${this.filePath}):`, error?.message || String(error))
  })
  return operation
}
```

Refactor `enqueuePersist()` to capture `const snapshot = { ...this.data }` and call `persistSnapshot(snapshot)` inside `saveChain`; preserve its current logging behavior for debounced settings writes.

- [ ] **Step 4: Prove AppStore commit rejects and does not swap memory**

Add to `src/main/__tests__/store-local-token.test.ts`:

```ts
it('rejects an atomic commit and keeps the previous in-memory value', async () => {
  const { store } = await import('../store')
  store.set('runtime.workbench.v1', { version: 1, turns: ['old'] })
  await store.flush()
  fsMock.promises.rename.mockRejectedValueOnce(new Error('rename denied'))

  await expect(store.commit('runtime.workbench.v1', { version: 1, turns: ['new'] }))
    .rejects.toThrow('rename denied')

  expect(store.get('runtime.workbench.v1')).toEqual({ version: 1, turns: ['old'] })
})
```

- [ ] **Step 5: Add decision and admission records to the persisted runtime shape**

Add these internal durable types to `src/main/runtime/types.ts`:

```ts
import type { DecisionRequest, DecisionResolution, DecisionState } from '../../shared/decision-contract'

export interface DurableDecisionRecord {
  request: DecisionRequest
  state: DecisionState
  activatedAt?: number
  expiresAt?: number
  resolution?: DecisionResolution
}

export interface QueuedThreadSubmission {
  id: string
  threadId: string
  turnId: string
  ownerWebContentsId: number
  input: import('../../shared/ipc-contract').TurnCreateInputLike
  source: 'create' | 'retry'
  retryOfTurnId?: string
  state: 'queued' | 'starting'
  createdAt: number
}
```

Add `ownerWebContentsId?: number` to `WorkbenchTurn`. Add `decisions: DurableDecisionRecord[]` and `queuedSubmissions: QueuedThreadSubmission[]` to `PersistedRuntime` and initialize both to empty arrays when loading older state.

- [ ] **Step 6: Implement the serialized cloned mutation facade**

Add the following public facade and serialization boundary in `src/main/runtime/store.ts`:

```ts
export interface RuntimeMutation {
  getTurn(turnId: string): WorkbenchTurn | undefined
  setTurnStatus(turnId: string, status: WorkbenchTurnStatus, payload?: Record<string, unknown>): void
  appendEvent(
    threadId: string,
    turnId: string,
    kind: RuntimeEvent['kind'],
    agentId: string | undefined,
    payload: Record<string, unknown>
  ): RuntimeEvent
  upsertDecision(record: DurableDecisionRecord): void
  upsertSubmission(record: QueuedThreadSubmission): void
  removeSubmission(submissionId: string): void
}

private mutationChain: Promise<void> = Promise.resolve()

commitRuntimeMutation<T>(mutate: (tx: RuntimeMutation) => T): Promise<T> {
  const operation = this.mutationChain.then(async () => {
    const current = this.load()
    const draft = structuredClone(current)
    const stagedEvents: RuntimeEvent[] = []
    const tx = createRuntimeMutation(draft, stagedEvents)
    const result = mutate(tx)
    draft.events = pruneRuntimeEvents(draft)
    await store.commit(STORAGE_KEY, draft)
    this.state = draft
    for (const event of stagedEvents) this.emit('event', event)
    return result
  })

  this.mutationChain = operation.then(() => undefined, () => undefined)
  return operation
}
```

Implement `createRuntimeMutation()` in the same file. Its `setTurnStatus()` must use `isTerminalTurnStatus()`, clear `completedAt` for non-terminal states, update the owning thread, and stage a `turn:status` event. Its `appendEvent()` must allocate the next per-thread sequence inside the cloned state and must not call `EventEmitter.emit()`.

Change the event union to include:

```ts
| 'decision:requested'
| 'decision:resolved'
```

Change pruning to accept the whole draft. Protect `decision:requested` while its matching durable record lacks a resolution, and protect `decision:resolved` tombstones ahead of deltas and ordinary activity events:

```ts
function isProtectedRuntimeEvent(event: RuntimeEvent, state: PersistedRuntime): boolean {
  if (PROTECTED_EVENT_KINDS.has(event.kind)) return true
  if (event.kind === 'decision:resolved') return true
  if (event.kind !== 'decision:requested') return false
  const requestId = String(event.payload?.requestId || '')
  return state.decisions.some(record => record.request.id === requestId && !record.resolution)
}
```

- [ ] **Step 7: Run atomic store tests**

Run: `npm.cmd test -- src/main/__tests__/store-local-token.test.ts src/main/runtime/__tests__/store.test.ts`

Expected: PASS, including rejection propagation, rollback, publish ordering, and existing delta debounce behavior.

- [ ] **Step 8: Commit the transaction boundary**

```powershell
git add -- src/main/store.ts src/main/__tests__/store-local-token.test.ts src/main/runtime/types.ts src/main/runtime/store.ts src/main/runtime/__tests__/store.test.ts
git commit -m "feat(runtime): persist atomic runtime mutations"
```

## Task C: Define the typed decision contract and trusted factories

**Files:**
- Create: `src/shared/decision-contract.ts`
- Create: `src/main/runtime/decision-request-factories.ts`
- Create: `src/main/runtime/__tests__/decision-request-factories.test.ts`

- [ ] **Step 1: Write red tests for cardinality and privileged-field isolation**

```ts
import { describe, expect, it } from 'vitest'
import {
  createAgentDecisionRequest,
  createToolDecisionRequest,
  validateDecisionRequest
} from '../decision-request-factories'

const owner = {
  type: 'turn' as const,
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  webContentsId: 7
}

describe('decision request factories', () => {
  it('creates neutral Agent choices without privileged presentation fields', () => {
    const request = createAgentDecisionRequest({
      owner,
      title: 'Choose scope',
      options: [
        { id: 'focused', label: 'Focused repair' },
        { id: 'audit', label: 'Full audit' }
      ],
      idempotencyKey: 'agent-1:step-2:scope',
      kind: 'single-select'
    })

    expect(request.source).toBe('agent')
    expect(request.allowRemember).toBe(false)
    expect(request.deadlineMs).toBeUndefined()
    expect(request.metadata).toBeUndefined()
    expect(request.options.every(option => option.tone === undefined)).toBe(true)
  })

  it('rejects generic Agent attempts to impersonate privileged cards', () => {
    expect(() => createAgentDecisionRequest({
      owner,
      title: 'Run command',
      kind: 'confirm',
      options: [{ id: 'allow', label: 'Allow', tone: 'danger' }],
      idempotencyKey: 'agent-1:step-3:permission',
      allowRemember: true,
      deadlineMs: 10_000,
      metadata: { action: 'run_command', target: 'rm -rf /' }
    } as any)).toThrow('privileged decision fields')
  })

  it('enforces kind-specific cardinality and unique option IDs', () => {
    expect(() => validateDecisionRequest({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      owner,
      source: 'agent',
      kind: 'single-select',
      title: 'Invalid',
      options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }],
      minSelections: 2,
      maxSelections: 2,
      allowCustom: false,
      allowRemember: false,
      createdAt: Date.now()
    })).toThrow()
  })

  it('allows privileged metadata only through the tool factory', () => {
    const request = createToolDecisionRequest({
      owner,
      agentId: 'codex',
      tool: 'exec',
      toolName: 'exec',
      action: 'run_command',
      target: 'npm.cmd test',
      preview: 'npm.cmd test',
      risk: 'medium',
      deadlineMs: 300_000,
      allowRemember: true
    })

    expect(request.source).toBe('tool')
    expect(request.options.map(option => option.id)).toEqual(['deny', 'allow-once'])
    expect(request.metadata?.risk).toBe('medium')
  })
})
```

- [ ] **Step 2: Run the focused factory test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/__tests__/decision-request-factories.test.ts`

Expected: FAIL because the contract and factories do not exist.

- [ ] **Step 3: Add the complete shared decision contract**

```ts
// src/shared/decision-contract.ts
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
      type: 'turn'
      threadId: string
      turnId: string
      workspaceId: string | null
      webContentsId: number
    }
  | {
      type: 'hub'
      sessionId: string
    }

export interface DecisionOption {
  id: string
  label: string
  description?: string
  preview?: string
  tone?: 'default' | 'safe' | 'warning' | 'danger'
}

export interface DecisionRequest {
  schemaVersion: 1
  id: string
  owner: DecisionOwner
  source: DecisionSource
  kind: DecisionKind
  title: string
  description?: string
  options: DecisionOption[]
  minSelections: number
  maxSelections: number
  allowCustom: boolean
  customInput?: { placeholder?: string; maxChars: number }
  allowRemember: boolean
  idempotencyKey?: string
  createdAt: number
  deadlineMs?: number
  metadata?: {
    agentId?: string
    risk?: 'low' | 'medium' | 'high' | 'critical'
    toolName?: string
    action?: string
    target?: string
    preview?: string
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
```

- [ ] **Step 4: Implement branded request creation and validation**

In `src/main/runtime/decision-request-factories.ts`, keep the brand symbol module-private and export the branded type plus factories:

```ts
import { randomUUID } from 'node:crypto'
import type {
  DecisionKind,
  DecisionOption,
  DecisionOwner,
  DecisionRequest,
  DecisionSource
} from '../../shared/decision-contract'

const CREATED_DECISION = Symbol('created-decision')
const PRIVILEGED_KEYS = ['allowRemember', 'deadlineMs', 'metadata'] as const
export const AGENT_TEXT_DEFAULT_MAX_CHARS = 16 * 1024
const TURN_PROMPT_LIMIT = 512 * 1024

export type CreatedDecisionRequest = DecisionRequest & {
  readonly [CREATED_DECISION]: true
}

type AgentDecisionInput = {
  owner: DecisionOwner
  title: string
  description?: string
  kind: DecisionKind
  options: Array<Omit<DecisionOption, 'tone' | 'preview'>>
  idempotencyKey: string
  allowCustom?: boolean
  customInput?: { placeholder?: string; maxChars?: number }
  minSelections?: number
  maxSelections?: number
}

function cardinality(kind: DecisionKind, count: number): [number, number] {
  if (kind === 'multi-select') return [1, count]
  if (kind === 'text') return [0, 0]
  return [1, 1]
}

function brand(request: DecisionRequest): CreatedDecisionRequest {
  validateDecisionRequest(request)
  return Object.freeze({ ...request, [CREATED_DECISION]: true })
}

export function createAgentDecisionRequest(input: AgentDecisionInput): CreatedDecisionRequest {
  for (const key of PRIVILEGED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error('Agent requests cannot set privileged decision fields')
    }
  }
  if (input.options.some(option => Object.prototype.hasOwnProperty.call(option, 'tone') || Object.prototype.hasOwnProperty.call(option, 'preview'))) {
    throw new Error('Agent requests cannot set privileged decision fields')
  }
  if (!input.idempotencyKey.trim()) throw new Error('Agent decision requires an idempotency key')
  const [defaultMin, defaultMax] = cardinality(input.kind, input.options.length)
  return brand({
    schemaVersion: 1,
    id: randomUUID(),
    owner: input.owner,
    source: 'agent',
    kind: input.kind,
    title: input.title,
    description: input.description,
    options: input.options,
    minSelections: input.minSelections ?? defaultMin,
    maxSelections: input.maxSelections ?? defaultMax,
    allowCustom: input.allowCustom ?? input.kind === 'text',
    customInput: input.customInput || input.kind === 'text'
      ? { placeholder: input.customInput?.placeholder, maxChars: input.customInput?.maxChars ?? AGENT_TEXT_DEFAULT_MAX_CHARS }
      : undefined,
    allowRemember: false,
    idempotencyKey: input.idempotencyKey,
    createdAt: Date.now()
  })
}

export function validateDecisionRequest(request: DecisionRequest): void {
  if (request.schemaVersion !== 1) throw new Error('Unsupported decision schema version')
  if (!request.id || !request.title.trim()) throw new Error('Decision id and title are required')
  if (request.options.length > 8) throw new Error('Decision options must contain at most 8 items')
  const ids = request.options.map(option => option.id)
  if (new Set(ids).size !== ids.length) throw new Error('Decision option IDs must be unique')
  if (request.kind === 'confirm' || request.kind === 'single-select') {
    if (request.minSelections !== 1 || request.maxSelections !== 1) throw new Error('Single decisions require exactly one selection')
  }
  if (request.kind === 'multi-select') {
    if (request.minSelections < 1 || request.maxSelections < request.minSelections || request.maxSelections > request.options.length) {
      throw new Error('Multi-select cardinality is invalid')
    }
  }
  if (request.kind === 'text') {
    if (request.minSelections !== 0 || request.maxSelections !== 0 || !request.allowCustom) throw new Error('Text decisions require custom input only')
  }
  const maxChars = request.customInput?.maxChars
  if (maxChars !== undefined && (maxChars < 1 || maxChars > TURN_PROMPT_LIMIT)) throw new Error('Custom input limit is invalid')
  if ((request.source === 'tool' || request.source === 'guard' || request.source === 'acp') === false) {
    if (request.allowRemember || request.deadlineMs || request.metadata?.risk || request.metadata?.target || request.metadata?.preview) {
      throw new Error('Untrusted source contains privileged decision fields')
    }
  }
}
```

Add the trusted factories in the same module. Each path calls the same brand and validation boundary; Renderer and Agent payloads never call createTrustedDecisionRequest directly.

```ts
type NeutralDecisionInput = {
  owner: DecisionOwner
  title: string
  description?: string
  kind: DecisionKind
  options: Array<Omit<DecisionOption, 'tone'>>
  minSelections?: number
  maxSelections?: number
  allowCustom?: boolean
  customInput?: { placeholder?: string; maxChars: number }
  idempotencyKey?: string
}

export type ToolDecisionInput = {
  owner: DecisionOwner
  agentId: string
  tool: 'write' | 'exec'
  toolName: string
  action: string
  target: string
  preview: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  deadlineMs?: number
  allowRemember?: boolean
  idempotencyKey?: string
}

export type GuardDecisionInput = {
  owner: DecisionOwner
  agentId: string
  role: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  reasons: string[]
  deadlineMs?: number
  idempotencyKey?: string
}

export type AcpPermissionOptionInput = {
  optionId: string
  name?: string
  kind?: string
  description?: string
}

export type AcpDecisionInput = {
  owner: DecisionOwner
  title: string
  toolName: string
  options: AcpPermissionOptionInput[]
  deadlineMs?: number
  idempotencyKey?: string
}

function createTrustedDecisionRequest(
  source: DecisionSource,
  input: Omit<DecisionRequest, 'schemaVersion' | 'id' | 'createdAt' | 'source'>
): CreatedDecisionRequest {
  return brand({ schemaVersion: 1, id: randomUUID(), createdAt: Date.now(), source, ...input })
}

function createNeutralDecisionRequest(
  source: 'prompt-optimizer' | 'router' | 'multi-model-loop',
  input: NeutralDecisionInput
): CreatedDecisionRequest {
  const [defaultMin, defaultMax] = cardinality(input.kind, input.options.length)
  return createTrustedDecisionRequest(source, {
    ...input,
    minSelections: input.minSelections ?? defaultMin,
    maxSelections: input.maxSelections ?? defaultMax,
    allowCustom: input.allowCustom ?? input.kind === 'text',
    allowRemember: false
  })
}

export function createPromptDecisionRequest(input: NeutralDecisionInput): CreatedDecisionRequest {
  return createNeutralDecisionRequest('prompt-optimizer', input)
}

export function createRouterDecisionRequest(input: NeutralDecisionInput): CreatedDecisionRequest {
  return createNeutralDecisionRequest('router', input)
}

export function createMultiModelLoopDecisionRequest(input: NeutralDecisionInput): CreatedDecisionRequest {
  return createNeutralDecisionRequest('multi-model-loop', input)
}

export function createToolDecisionRequest(input: ToolDecisionInput): CreatedDecisionRequest {
  return createTrustedDecisionRequest('tool', {
    owner: input.owner,
    kind: 'single-select',
    title: `Allow ${input.toolName}?`,
    description: input.action,
    options: [
      { id: 'deny', label: 'Deny', tone: 'safe' },
      { id: 'allow-once', label: 'Allow once', tone: 'warning' }
    ],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: input.allowRemember === true,
    idempotencyKey: input.idempotencyKey,
    deadlineMs: input.deadlineMs,
    metadata: {
      agentId: input.agentId,
      risk: input.risk,
      toolName: input.toolName,
      action: input.action,
      target: input.target,
      preview: input.preview
    }
  })
}

export function createGuardDecisionRequest(input: GuardDecisionInput): CreatedDecisionRequest {
  const summary = input.reasons.join('; ')
  return createTrustedDecisionRequest('guard', {
    owner: input.owner,
    kind: 'single-select',
    title: 'Guard approval required',
    description: summary,
    options: [
      { id: 'deny', label: 'Deny', tone: 'safe' },
      { id: 'allow-once', label: 'Allow once', tone: 'warning' }
    ],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: false,
    idempotencyKey: input.idempotencyKey,
    deadlineMs: input.deadlineMs,
    metadata: {
      agentId: input.agentId,
      risk: input.risk,
      action: `guard:${input.role}`,
      preview: summary
    }
  })
}

export function createAcpDecisionRequest(input: AcpDecisionInput): CreatedDecisionRequest {
  const ids = input.options.map(option => option.optionId)
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('ACP option IDs must be non-empty and unique')
  }
  return createTrustedDecisionRequest('acp', {
    owner: input.owner,
    kind: 'single-select',
    title: input.title,
    options: input.options.map(option => ({
      id: option.optionId,
      label: option.name || option.optionId,
      description: option.description,
      tone: option.kind?.startsWith('deny') ? 'safe' : 'warning'
    })),
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: false,
    idempotencyKey: input.idempotencyKey,
    deadlineMs: input.deadlineMs,
    metadata: {
      toolName: input.toolName,
      action: 'acp_permission'
    }
  })
}
```

Prompt, Router, and Multi-model Loop factories accept validated neutral labels/previews and original/custom options but no risk, remember, target, or security deadline. Tool and Guard factories accept only typed main-process input. ACP keeps the original validated protocol optionId as DecisionOption.id.

- [ ] **Step 5: Run the focused factory test**

Run: `npm.cmd test -- src/main/runtime/__tests__/decision-request-factories.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the contract**

```powershell
git add -- src/shared/decision-contract.ts src/main/runtime/decision-request-factories.ts src/main/runtime/__tests__/decision-request-factories.test.ts
git commit -m "feat(decisions): define trusted decision contract"
```

## Task D: Implement DecisionService lifecycle, FIFO queues, and recovery

**Files:**
- Create: `src/main/runtime/decision-service.ts`
- Create: `src/main/runtime/__tests__/decision-service.test.ts`
- Modify: `src/main/runtime/store.ts:87-117,316-386`
- Modify: `src/main/runtime/types.ts:101-154`
- Modify: `src/main/index.ts:1123-1158`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionService } from '../decision-service'
import {
  AGENT_TEXT_DEFAULT_MAX_CHARS,
  createAgentDecisionRequest,
  createGuardDecisionRequest,
  createPromptDecisionRequest,
  createToolDecisionRequest
} from '../decision-request-factories'
import { WorkbenchRuntimeStore } from '../store'

const owner = (threadId: string, turnId: string) => ({
  type: 'turn' as const,
  threadId,
  turnId,
  workspaceId: null,
  webContentsId: 11
})

describe('DecisionService', () => {
  const services: DecisionService[] = []
  afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.shutdown()))
    vi.useRealTimers()
  })

  it('persists one active head, queues the tail, and resumes the same Turn once', async () => {
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({ prompt: 'choose', mode: 'auto', workspaceId: null })
    const service = new DecisionService({ runtimeStore: runtime })
    services.push(service)
    const first = service.request(createAgentDecisionRequest({
      owner: owner(thread.id, turn.id),
      title: 'First',
      kind: 'single-select',
      options: [{ id: 'a', label: 'A' }],
      idempotencyKey: 'agent:step:first'
    }))
    const second = service.request(createAgentDecisionRequest({
      owner: owner(thread.id, turn.id),
      title: 'Second',
      kind: 'single-select',
      options: [{ id: 'b', label: 'B' }],
      idempotencyKey: 'agent:step:second'
    }))

    await vi.waitFor(() => expect(service.listPending({ threadId: thread.id }).map(item => item.state)).toEqual(['active', 'queued']))
    expect(runtime.getTurn(turn.id)?.status).toBe('awaiting-decision')
    expect(await service.resolve({
      requestId: service.listPending({ threadId: thread.id })[1].request.id,
      outcome: 'selected',
      selectedOptionIds: ['b']
    }, { webContentsId: 11, workspaceId: null })).toEqual({ accepted: false })

    const firstId = service.listPending({ threadId: thread.id })[0].request.id
    expect(await service.resolve({ requestId: firstId, outcome: 'selected', selectedOptionIds: ['a'] }, { webContentsId: 11, workspaceId: null }))
      .toEqual({ accepted: true })
    await expect(first).resolves.toMatchObject({ requestId: firstId, selectedOptionIds: ['a'] })
    expect(service.listPending({ threadId: thread.id })[0].state).toBe('active')
    expect(runtime.getTurn(turn.id)?.status).toBe('awaiting-decision')

    const secondId = service.listPending({ threadId: thread.id })[0].request.id
    await service.resolve({ requestId: secondId, outcome: 'selected', selectedOptionIds: ['b'] }, { webContentsId: 11, workspaceId: null })
    await expect(second).resolves.toMatchObject({ requestId: secondId, selectedOptionIds: ['b'] })
    expect(runtime.getTurn(turn.id)?.status).toBe('running')
    expect(service.listPending({ threadId: thread.id })).toEqual([])
  })

  it('starts a security deadline only when a queued request becomes active', async () => {
    vi.useFakeTimers()
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({ prompt: 'deadlines', mode: 'auto', workspaceId: null })
    const service = new DecisionService({ runtimeStore: runtime })
    services.push(service)
    const first = service.request(createAgentDecisionRequest({
      owner: owner(thread.id, turn.id), title: 'No timeout', kind: 'single-select',
      options: [{ id: 'a', label: 'A' }], idempotencyKey: 'first'
    }))
    const guarded = service.request(createGuardDecisionRequest({
      owner: owner(thread.id, turn.id),
      agentId: 'reviewer',
      role: 'executor',
      risk: 'high',
      reasons: ['fixture'],
      deadlineMs: 1_000
    }))

    await vi.advanceTimersByTimeAsync(2_000)
    expect(service.listPending({ threadId: thread.id })[1].expiresAt).toBeUndefined()
    const firstId = service.listPending({ threadId: thread.id })[0].request.id
    await service.resolve({ requestId: firstId, outcome: 'selected', selectedOptionIds: ['a'] }, { webContentsId: 11, workspaceId: null })
    await first
    expect(service.listPending({ threadId: thread.id })[0].expiresAt).toEqual(expect.any(Number))
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(guarded).resolves.toMatchObject({ status: 'timeout' })
  })
})
```

Add these concrete boundary cases in the same file (the helper resolves each request so created-count tests prove terminal durable rows are still counted):

```ts
const promptRequest = (requestOwner: ReturnType<typeof owner>, index: number) => createPromptDecisionRequest({
  owner: requestOwner,
  title: `Prompt ${index}`,
  kind: 'single-select',
  options: [{ id: 'continue', label: 'Continue' }],
  idempotencyKey: `prompt:${index}`
})

async function settle(service: DecisionService, request: ReturnType<typeof promptRequest>): Promise<void> {
  const continuation = service.request(request)
  await vi.waitFor(() => expect(service.listPending().some(item => item.request.id === request.id)).toBe(true))
  await expect(service.resolve({
    requestId: request.id,
    outcome: 'selected',
    selectedOptionIds: ['continue']
  }, { webContentsId: 11, workspaceId: null })).resolves.toEqual({ accepted: true })
  await continuation
}

it('defaults ordinary Agent text to 16 KiB while retaining the 512 KiB hard ceiling', () => {
  const requestOwner = owner('thread-text', 'turn-text')
  const ordinary = createAgentDecisionRequest({
    owner: requestOwner,
    title: 'Explain',
    kind: 'text',
    options: [],
    idempotencyKey: 'agent:text:ordinary'
  })
  expect(AGENT_TEXT_DEFAULT_MAX_CHARS).toBe(16 * 1024)
  expect(ordinary.customInput?.maxChars).toBe(16 * 1024)
  expect(() => createAgentDecisionRequest({
    owner: requestOwner,
    title: 'Too large',
    kind: 'text',
    options: [],
    customInput: { maxChars: 512 * 1024 + 1 },
    idempotencyKey: 'agent:text:too-large'
  })).toThrow('Custom input limit is invalid')
})

it('allows eight unresolved decisions per Turn and rejects the ninth', async () => {
  const runtime = new WorkbenchRuntimeStore()
  const { thread, turn } = runtime.createTurn({ prompt: 'eight', mode: 'auto', workspaceId: null })
  const service = new DecisionService({ runtimeStore: runtime }); services.push(service)
  for (let index = 0; index < 8; index++) void service.request(promptRequest(owner(thread.id, turn.id), index))
  await vi.waitFor(() => expect(service.listPending({ threadId: thread.id })).toHaveLength(8))
  await expect(service.request(promptRequest(owner(thread.id, turn.id), 8)))
    .rejects.toThrow('at most 8 unresolved decisions per Turn')
})

it('counts terminal durable records toward 32 created decisions per Turn', async () => {
  const runtime = new WorkbenchRuntimeStore()
  const { thread, turn } = runtime.createTurn({ prompt: 'created', mode: 'auto', workspaceId: null })
  const service = new DecisionService({ runtimeStore: runtime }); services.push(service)
  for (let index = 0; index < 32; index++) await settle(service, promptRequest(owner(thread.id, turn.id), index))
  expect(runtime.listDurableDecisions().filter(record => record.request.owner.type === 'turn' && record.request.owner.turnId === turn.id)).toHaveLength(32)
  await expect(service.request(promptRequest(owner(thread.id, turn.id), 32)))
    .rejects.toThrow('at most 32 created decisions per Turn')
})

it('counts terminal Agent records and rejects the fifth Agent-created decision in one Turn', async () => {
  const runtime = new WorkbenchRuntimeStore()
  const { thread, turn } = runtime.createTurn({ prompt: 'agent cap', mode: 'auto', workspaceId: null })
  const service = new DecisionService({ runtimeStore: runtime }); services.push(service)
  for (let index = 0; index < 4; index++) {
    const request = createAgentDecisionRequest({
      owner: owner(thread.id, turn.id), title: `Agent ${index}`, kind: 'single-select',
      options: [{ id: 'continue', label: 'Continue' }], idempotencyKey: `agent:step:${index}`
    })
    await settle(service, request)
  }
  await expect(service.request(createAgentDecisionRequest({
    owner: owner(thread.id, turn.id), title: 'Agent 5', kind: 'single-select',
    options: [{ id: 'continue', label: 'Continue' }], idempotencyKey: 'agent:step:4'
  }))).rejects.toThrow('at most 4 Agent-created decisions per Turn')
})

it('allows 64 unresolved decisions process-wide and rejects the sixty-fifth', async () => {
  const runtime = new WorkbenchRuntimeStore()
  const service = new DecisionService({ runtimeStore: runtime }); services.push(service)
  for (let index = 0; index < 64; index++) {
    const { thread, turn } = runtime.createTurn({ prompt: `process ${index}`, mode: 'auto', workspaceId: null })
    void service.request(promptRequest(owner(thread.id, turn.id), index))
  }
  await vi.waitFor(() => expect(service.listPending()).toHaveLength(64))
  const { thread, turn } = runtime.createTurn({ prompt: 'overflow', mode: 'auto', workspaceId: null })
  await expect(service.request(promptRequest(owner(thread.id, turn.id), 64)))
    .rejects.toThrow('at most 64 unresolved decisions process-wide')
})

it('sweeps an orphan into an audit-safe rerun descriptor without reviving a waiter', async () => {
  const runtime = new WorkbenchRuntimeStore()
  const { thread, turn } = runtime.createTurn({ prompt: 'original user request', mode: 'auto', workspaceId: null })
  const request = createToolDecisionRequest({
    owner: owner(thread.id, turn.id), agentId: 'codex', tool: 'exec', toolName: 'exec',
    action: 'run_command', target: 'SECRET_OLD_COMMAND', preview: 'SECRET_OLD_COMMAND', risk: 'high'
  })
  await runtime.commitRuntimeMutation(tx => {
    tx.upsertDecision({ request, state: 'active' })
    tx.setTurnStatus(turn.id, 'awaiting-decision')
  })
  const service = new DecisionService({ runtimeStore: runtime }); services.push(service)

  await expect(service.sweepOrphans()).resolves.toEqual([{
    kind: 'rerun-turn', requestId: request.id, threadId: thread.id,
    originalTurnId: turn.id, source: 'tool'
  }])
  expect(service.listPending()).toEqual([])
  expect(runtime.getTurn(turn.id)?.status).toBe('interrupted')
  const event = runtime.eventsSince(thread.id, 0).find(item => item.kind === 'decision:resolved')
  expect(event?.payload).toEqual({
    requestId: request.id, status: 'stale', source: 'tool',
    recovery: { kind: 'rerun-turn', originalTurnId: turn.id }
  })
  expect(JSON.stringify(event?.payload)).not.toContain('SECRET_OLD_COMMAND')
})
```

Keep the remaining concrete cases in this suite for duplicate idempotency keys, different-thread isolation, invalid/late submissions, persistence rejection rollback, Turn cancellation, graceful shutdown, and startup orphan sweep.

- [ ] **Step 2: Run the DecisionService test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/__tests__/decision-service.test.ts`

Expected: FAIL because `DecisionService` does not exist.

- [ ] **Step 3: Implement the service entry model and owner FIFO**

```ts
type SenderScope = { webContentsId: number; workspaceId: string | null }

type DecisionEntry = {
  request: CreatedDecisionRequest
  state: DecisionState
  visible: boolean
  activatedAt?: number
  expiresAt?: number
  timer?: ReturnType<typeof setTimeout>
  resolveWaiter: (resolution: DecisionResolution) => void
  continuation: Promise<DecisionResolution>
  onRemember?: (resolution: DecisionResolution) => Promise<void>
}

function ownerKey(owner: DecisionOwner): string {
  return owner.type === 'turn' ? `turn:${owner.threadId}` : `hub:${owner.sessionId}`
}

export class DecisionService {
  private readonly entries = new Map<string, DecisionEntry>()
  private readonly queues = new Map<string, string[]>()
  private readonly idempotency = new Map<string, string>()
  private readonly idempotentResults = new Map<string, Promise<DecisionResolution>>()
  private readonly runtimeStore: WorkbenchRuntimeStore
  private shuttingDown = false

  constructor(input: { runtimeStore: WorkbenchRuntimeStore }) {
    this.runtimeStore = input.runtimeStore
  }

  listPending(filter: { threadId?: string; webContentsId?: number; workspaceId?: string | null } = {}): PendingDecision[] {
    return [...this.entries.values()]
      .filter(entry => entry.visible)
      .filter(entry => !filter.threadId || (entry.request.owner.type === 'turn' && entry.request.owner.threadId === filter.threadId))
      .filter(entry => filter.webContentsId === undefined || (entry.request.owner.type === 'turn' && entry.request.owner.webContentsId === filter.webContentsId))
      .filter(entry => filter.workspaceId === undefined || (entry.request.owner.type === 'turn' && entry.request.owner.workspaceId === filter.workspaceId))
      .sort((left, right) => left.request.createdAt - right.request.createdAt || left.request.id.localeCompare(right.request.id))
      .map(entry => ({
        request: entry.request,
        state: entry.state,
        activatedAt: entry.activatedAt,
        expiresAt: entry.expiresAt
      }))
  }
}
```

Define and use exact service limits; `created` counts must come from durable rows even after they are terminal, while provisional entries are merged by request ID so concurrent callers cannot slip past a boundary:

```ts
export const DECISION_SERVICE_LIMITS = Object.freeze({
  unresolvedPerTurn: 8,
  createdPerTurn: 32,
  unresolvedProcess: 64,
  agentCreatedPerTurn: 4
})

private assertLimits(request: CreatedDecisionRequest): void {
  const records = new Map(
    this.runtimeStore.listDurableDecisions().map(record => [record.request.id, record] as const)
  )
  for (const entry of this.entries.values()) {
    if (!records.has(entry.request.id)) {
      records.set(entry.request.id, { request: entry.request, state: entry.state })
    }
  }
  const all = [...records.values()]
  const unresolved = all.filter(record => !record.resolution)
  if (unresolved.length >= DECISION_SERVICE_LIMITS.unresolvedProcess) {
    throw new Error('DecisionService allows at most 64 unresolved decisions process-wide')
  }
  if (request.owner.type !== 'turn') return

  const forTurn = all.filter(record =>
    record.request.owner.type === 'turn' && record.request.owner.turnId === request.owner.turnId
  )
  if (forTurn.length >= DECISION_SERVICE_LIMITS.createdPerTurn) {
    throw new Error('DecisionService allows at most 32 created decisions per Turn')
  }
  if (forTurn.filter(record => !record.resolution).length >= DECISION_SERVICE_LIMITS.unresolvedPerTurn) {
    throw new Error('DecisionService allows at most 8 unresolved decisions per Turn')
  }
  if (request.source === 'agent' && forTurn.filter(record => record.request.source === 'agent').length >= DECISION_SERVICE_LIMITS.agentCreatedPerTurn) {
    throw new Error('DecisionService allows at most 4 Agent-created decisions per Turn')
  }
}
```

- [ ] **Step 4: Implement atomic request and resolution ordering**

The request path must create a provisional waiter, enqueue it, persist request plus `awaiting-decision`, then expose it:

```ts
async request(
  request: CreatedDecisionRequest,
  options: { signal?: AbortSignal; onRemember?: (resolution: DecisionResolution) => Promise<void> } = {}
): Promise<DecisionResolution> {
  if (this.shuttingDown) throw new Error('DecisionService is shutting down')
  const idempotencyScope = request.idempotencyKey ? `${ownerKey(request.owner)}:${request.idempotencyKey}` : undefined
  const duplicateResult = idempotencyScope ? this.idempotentResults.get(idempotencyScope) : undefined
  if (duplicateResult) return duplicateResult
  this.assertLimits(request)

  let release!: (resolution: DecisionResolution) => void
  const continuation = new Promise<DecisionResolution>(resolve => { release = resolve })
  const key = ownerKey(request.owner)
  const queue = this.queues.get(key) ?? []
  const entry: DecisionEntry = {
    request,
    state: queue.length === 0 ? 'active' : 'queued',
    visible: false,
    resolveWaiter: release,
    continuation,
    onRemember: options.onRemember
  }
  if (entry.state === 'active') this.markActivated(entry)
  this.entries.set(request.id, entry)
  queue.push(request.id)
  this.queues.set(key, queue)
  if (idempotencyScope) {
    this.idempotency.set(idempotencyScope, request.id)
    this.idempotentResults.set(idempotencyScope, continuation)
  }

  try {
    await this.runtimeStore.commitRuntimeMutation(tx => {
      tx.upsertDecision(this.durable(entry))
      if (request.owner.type === 'turn') tx.setTurnStatus(request.owner.turnId, 'awaiting-decision')
      tx.appendEvent(this.threadId(request.owner), this.turnId(request.owner), 'decision:requested', undefined, this.auditRequest(entry))
    })
  } catch (error) {
    this.removeProvisional(entry)
    throw error
  }

  entry.visible = true
  this.startTimer(entry)
  options.signal?.addEventListener('abort', () => { void this.cancelRequest(request.id) }, { once: true })
  return continuation
}
```

The resolution path must reject non-head and wrong-sender submissions, persist terminalization and promotion, then release exactly once:

```ts
async resolve(submission: DecisionSubmission, sender: SenderScope): Promise<DecisionResolveResult> {
  const entry = this.entries.get(submission.requestId)
  if (!entry || entry.state !== 'active' || !this.senderMatches(entry.request.owner, sender)) return { accepted: false }
  this.validateSubmission(entry.request, submission)
  entry.state = 'resolving'
  const resolution = this.toResolution(entry.request, submission)
  const key = ownerKey(entry.request.owner)
  const queue = this.queues.get(key) ?? []
  const next = queue[1] ? this.entries.get(queue[1]) : undefined
  const nextActivatedAt = next ? Date.now() : undefined
  const nextExpiresAt = next && next.request.deadlineMs && nextActivatedAt !== undefined
    ? nextActivatedAt + next.request.deadlineMs
    : undefined

  try {
    await this.runtimeStore.commitRuntimeMutation(tx => {
      tx.upsertDecision({ ...this.durable(entry), state: 'terminal', resolution })
      tx.appendEvent(this.threadId(entry.request.owner), this.turnId(entry.request.owner), 'decision:resolved', undefined, this.auditResolution(entry, resolution))
      if (next) {
        tx.upsertDecision({
          ...this.durable(next),
          state: 'active',
          activatedAt: nextActivatedAt,
          expiresAt: nextExpiresAt
        })
      }
      if (entry.request.owner.type === 'turn' && !next) tx.setTurnStatus(entry.request.owner.turnId, 'running')
    })
  } catch (error) {
    entry.state = 'active'
    throw error
  }

  this.finishEntry(entry, resolution)
  queue.shift()
  if (queue.length === 0) this.queues.delete(key)
  else this.queues.set(key, queue)
  if (next) {
    next.state = 'active'
    next.activatedAt = nextActivatedAt
    next.expiresAt = nextExpiresAt
    this.startTimer(next)
  }

  if (submission.remember && entry.request.allowRemember && entry.onRemember) {
    try { await entry.onRemember(resolution) }
    catch { return { accepted: true, warning: 'remember_failed' } }
  }
  return { accepted: true }
}
```

Implement `validateSubmission()` with authoritative option membership, unique IDs, exact cardinality, bounded custom text, expiration, and permission custom-text rejection. Implement `cancelTurn()` and timeout through the same terminal commit helper. `finishEntry()` clears the timer, removes the entry, and calls its waiter once after commit.

Retain settled `idempotentResults` until the owning Turn becomes terminal, then delete that Turn's keys. This returns the same settled result for a repeated Agent/step key without retaining process-wide results indefinitely.

- [ ] **Step 5: Implement graceful shutdown and orphan recovery**

```ts
export type StaleDecisionRecovery = {
  kind: 'rerun-turn'
  requestId: string
  threadId: string
  originalTurnId: string
  source: DecisionSource
}

async sweepOrphans(): Promise<StaleDecisionRecovery[]> {
  const orphans = this.runtimeStore.listDurableDecisions().filter(record => !record.resolution)
  const recoveries: StaleDecisionRecovery[] = []
  for (const record of orphans) {
    const resolution: DecisionResolution = {
      requestId: record.request.id,
      status: 'stale',
      resolvedAt: Date.now()
    }
    await this.runtimeStore.commitRuntimeMutation(tx => {
      tx.upsertDecision({ ...record, state: 'terminal', resolution })
      const originalTurnId = this.turnId(record.request.owner)
      tx.appendEvent(this.threadId(record.request.owner), originalTurnId, 'decision:resolved', undefined, {
        requestId: record.request.id,
        status: 'stale',
        source: record.request.source,
        recovery: { kind: 'rerun-turn', originalTurnId }
      })
      if (record.request.owner.type === 'turn') tx.setTurnStatus(record.request.owner.turnId, 'interrupted')
    })
    if (record.request.owner.type === 'turn') recoveries.push({
      kind: 'rerun-turn',
      requestId: record.request.id,
      threadId: record.request.owner.threadId,
      originalTurnId: record.request.owner.turnId,
      source: record.request.source
    })
  }
  return recoveries
}

async shutdown(): Promise<void> {
  this.shuttingDown = true
  const ids = [...this.entries.keys()]
  for (const id of ids) await this.resolveTerminal(id, 'stale')
}
```

Call `sweepOrphans()` once during `app.whenReady()` before accepting new Turn submissions. The recovery descriptor and audit event contain only IDs, source, and the fixed `rerun-turn` action; they never contain the old target, command, preview, selected option, or a resolver. In `will-quit`, await `decisionService.shutdown()` before `store.flush()` and before clearing adapters.

- [ ] **Step 6: Run service and store tests**

Run: `npm.cmd test -- src/main/runtime/__tests__/decision-service.test.ts src/main/runtime/__tests__/store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit DecisionService**

```powershell
git add -- src/main/runtime/decision-service.ts src/main/runtime/__tests__/decision-service.test.ts src/main/runtime/store.ts src/main/runtime/types.ts src/main/index.ts
git commit -m "feat(decisions): add durable decision service"
```

## Task E: Add validated decision IPC and sender scope

**Files:**
- Create: `src/main/ipc/decision-ipc.ts`
- Create: `src/main/ipc/__tests__/decision-ipc.test.ts`
- Modify: `src/shared/ipc-contract.ts:3081-3132,6734-6774`
- Modify: `src/main/ipc/index.ts:27-49,115-135`
- Modify: `src/preload/index.ts:121-141`
- Modify: `src/renderer/vite-env.d.ts:168-174`
- Modify: `src/main/index.ts:92-115,1083-1099`
- Test: `src/main/ipc/__tests__/ipc-contract-guard.test.ts:327-446`

- [ ] **Step 1: Write failing IPC ownership tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDecisionIpc } from '../decision-ipc'

describe('decision IPC', () => {
  const handlers = new Map<string, Function>()
  const service = {
    listPending: vi.fn(() => []),
    resolve: vi.fn(async () => ({ accepted: true as const }))
  }

  beforeEach(() => {
    handlers.clear()
    service.listPending.mockClear()
    service.resolve.mockClear()
  })

  it('binds pending-list and resolution to the calling webContents', async () => {
    registerDecisionIpc({
      decisionService: service as any,
      handle: (channel, handler) => handlers.set(channel, handler),
      senderScope: event => ({ webContentsId: event.sender.id, workspaceId: 'workspace-1' })
    })
    const event = { sender: { id: 41 } }
    await handlers.get('turns:listPendingDecisions')!(event, 'thread-1')
    expect(service.listPending).toHaveBeenCalledWith({ threadId: 'thread-1', webContentsId: 41, workspaceId: 'workspace-1' })

    const submission = { requestId: 'decision-1', outcome: 'selected', selectedOptionIds: ['allow-once'] }
    await handlers.get('turns:resolveDecision')!(event, submission)
    expect(service.resolve).toHaveBeenCalledWith(submission, { webContentsId: 41, workspaceId: 'workspace-1' })
  })

  it('rejects callers that are not Workbench windows', async () => {
    registerDecisionIpc({
      decisionService: service as any,
      handle: (channel, handler) => handlers.set(channel, handler),
      senderScope: () => null
    })
    await expect(handlers.get('turns:resolveDecision')!({ sender: { id: 99 } }, {
      requestId: 'decision-1', outcome: 'denied'
    })).rejects.toThrow('Untrusted decision sender')
    expect(service.resolve).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the IPC test and confirm the red state**

Run: `npm.cmd test -- src/main/ipc/__tests__/decision-ipc.test.ts`

Expected: FAIL because the channels and registrar do not exist.

- [ ] **Step 3: Add channel types and strict validators**

Add to `IpcContract`:

```ts
'turns:listPendingDecisions': {
  args: [threadId?: string]
  result: import('./decision-contract').PendingDecision[]
}
'turns:resolveDecision': {
  args: [submission: import('./decision-contract').DecisionSubmission]
  result: import('./decision-contract').DecisionResolveResult
}
```

Add validators that accept only `requestId`, `outcome`, unique bounded `selectedOptionIds`, bounded `customText`, and boolean `remember`. Reject unknown top-level keys, more than eight selected IDs, IDs over 256 characters, and custom text over 512 KiB. Keep kind-specific cardinality authoritative in DecisionService because it owns the stored request.

- [ ] **Step 4: Register scope-bound handlers**

```ts
import type { IpcMainInvokeEvent } from 'electron'
import type { DecisionService } from '../runtime/decision-service'
import { typedHandle } from './typed-ipc'

type Scope = { webContentsId: number; workspaceId: string | null }

export function registerDecisionIpc(input: {
  decisionService: DecisionService
  senderScope: (event: IpcMainInvokeEvent) => Scope | null
  handle?: typeof typedHandle
}): void {
  const handle = input.handle ?? typedHandle
  handle('turns:listPendingDecisions', (event, threadId) => {
    const scope = input.senderScope(event)
    if (!scope) throw new Error('Untrusted decision sender')
    return input.decisionService.listPending({ threadId, ...scope })
  })
  handle('turns:resolveDecision', async (event, submission) => {
    const scope = input.senderScope(event)
    if (!scope) throw new Error('Untrusted decision sender')
    return input.decisionService.resolve(submission, scope)
  })
}
```

Register this module from `src/main/ipc/index.ts`. Pass a `senderScope` dependency from `src/main/index.ts` that returns non-null only when `event.sender.id` matches a live Workbench `BrowserWindow`; derive its workspace from the request owner/Turn in DecisionService rather than trusting Renderer payload.

- [ ] **Step 5: Add preload and Renderer typings**

```ts
// src/preload/index.ts, inside turns
listPendingDecisions: (threadId?: string) => typedInvoke('turns:listPendingDecisions', threadId),
resolveDecision: (submission: IpcArgs<'turns:resolveDecision'>[0]) =>
  typedInvoke('turns:resolveDecision', submission),
```

Mirror these signatures in `src/renderer/vite-env.d.ts` using imported shared decision types. Extend `ipc-contract-guard.test.ts` so both channels must exist in the contract, preload, validator map, and main registrar.

- [ ] **Step 6: Run decision IPC tests**

Run: `npm.cmd test -- src/main/ipc/__tests__/decision-ipc.test.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit IPC wiring**

```powershell
git add -- src/main/ipc/decision-ipc.ts src/main/ipc/__tests__/decision-ipc.test.ts src/shared/ipc-contract.ts src/main/ipc/index.ts src/preload/index.ts src/renderer/vite-env.d.ts src/main/index.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts
git commit -m "feat(decisions): expose sender-bound decision ipc"
```

## Task F: Serialize Workbench create and retry admission

**Files:**
- Create: `src/main/runtime/thread-execution-coordinator.ts`
- Create: `src/main/runtime/workbench-turn-runner.ts`
- Create: `src/main/runtime/__tests__/thread-execution-coordinator.test.ts`
- Create: `src/main/ipc/turns-ipc.ts`
- Modify: `src/main/runtime/store.ts:165-223`
- Modify: `src/main/index.ts:588-993`
- Modify: `src/main/ipc/index.ts:27-49`
- Modify: `src/shared/ipc-contract.ts:3105-3124,6734-6748`
- Modify: `src/preload/index.ts:128-133`
- Test: `src/main/ipc/__tests__/turns-ipc-validation.test.ts:78-158`

- [ ] **Step 1: Write failing durable FIFO tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ThreadExecutionCoordinator } from '../thread-execution-coordinator'
import { WorkbenchRuntimeStore } from '../store'

describe('ThreadExecutionCoordinator', () => {
  it('acknowledges only after persistence and starts one head per thread', async () => {
    const runtimeStore = new WorkbenchRuntimeStore()
    const starts: string[] = []
    const runner = { start: vi.fn(async submission => { starts.push(submission.turnId) }) }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await coordinator.enqueueCreate({ prompt: 'first', mode: 'auto', workspaceId: null }, 7)
    const second = await coordinator.enqueueCreate({ threadId: first.thread.id, prompt: 'second', mode: 'auto', workspaceId: null }, 7)

    await vi.waitFor(() => expect(runner.start).toHaveBeenCalledTimes(1))
    expect(runtimeStore.getTurn(first.turn.id)?.status).toBe('running')
    expect(runtimeStore.getTurn(second.turn.id)?.status).toBe('queued')

    await coordinator.onTurnStatus(first.turn.id, 'awaiting-decision')
    expect(runner.start).toHaveBeenCalledTimes(1)
    await coordinator.onTurnStatus(first.turn.id, 'completed')
    await vi.waitFor(() => expect(runner.start).toHaveBeenCalledTimes(2))
    expect(starts).toEqual([first.turn.id, second.turn.id])
  })

  it('preserves queued tails when the head is cancelled and clears only explicitly', async () => {
    const runtimeStore = new WorkbenchRuntimeStore()
    const runner = { start: vi.fn(async () => undefined) }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await coordinator.enqueueCreate({ prompt: 'head', mode: 'auto', workspaceId: null }, 7)
    const tail = await coordinator.enqueueCreate({ threadId: first.thread.id, prompt: 'tail', mode: 'auto', workspaceId: null }, 7)

    await coordinator.cancelTurn(first.turn.id)
    expect(runtimeStore.getTurn(tail.turn.id)?.status).toBe('running')
    expect(await coordinator.clearQueue(first.thread.id)).toEqual([])
  })

  it('reruns an interrupted Turn as a new retry Turn without copying its stale decision payload', async () => {
    const runtimeStore = new WorkbenchRuntimeStore()
    const { thread, turn: original } = runtimeStore.createTurn({ prompt: 'original user request', mode: 'auto', workspaceId: null })
    runtimeStore.setTurnStatus(original.id, 'interrupted')
    const oldRequest = createToolDecisionRequest({
      owner: { type: 'turn', threadId: thread.id, turnId: original.id, workspaceId: null, webContentsId: 7 },
      agentId: 'codex', tool: 'exec', toolName: 'exec', action: 'run_command',
      target: 'OLD_COMMAND_MUST_NOT_RUN', preview: 'OLD_COMMAND_MUST_NOT_RUN', risk: 'high'
    })
    await runtimeStore.commitRuntimeMutation(tx => tx.upsertDecision({
      request: oldRequest,
      state: 'terminal',
      resolution: { requestId: oldRequest.id, status: 'stale', resolvedAt: 1 }
    }))
    const runner = { start: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })

    const rerun = await coordinator.rerunInterruptedTurn(original.id, 7)
    expect(rerun.turn.id).not.toBe(original.id)
    const submission = runtimeStore.listQueuedSubmissions(thread.id).find(item => item.turnId === rerun.turn.id)!
    expect(submission.retryOfTurnId).toBe(original.id)
    expect(submission.input.prompt).toBe('original user request')
    expect(JSON.stringify(submission)).not.toContain(oldRequest.id)
    expect(JSON.stringify(submission)).not.toContain('OLD_COMMAND_MUST_NOT_RUN')
    expect(runtimeStore.listDurableDecisions().find(item => item.request.id === oldRequest.id)?.resolution?.status).toBe('stale')
  })
})
```

Add cases for two sender windows, retry submission immutability, denial/timeout retaining the head, refresh reconstruction, `starting` recovery without re-execution, and explicit clear removing only queued tails.

- [ ] **Step 2: Run the coordinator test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/__tests__/thread-execution-coordinator.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Add atomic queued-Turn creation to RuntimeStore**

```ts
async createQueuedSubmission(input: {
  payload: TurnCreateInputLike
  ownerWebContentsId: number
  source: 'create' | 'retry'
  retryOfTurnId?: string
}): Promise<{ thread: WorkbenchThread; turn: WorkbenchTurn; submission: QueuedThreadSubmission }> {
  return this.commitRuntimeMutation(tx => {
    const thread = tx.ensureThread(input.payload.threadId, input.payload.workspaceId, input.payload.prompt)
    const turn = tx.createTurn({
      ...input.payload,
      threadId: thread.id,
      status: 'queued',
      ownerWebContentsId: input.ownerWebContentsId
    })
    const submission: QueuedThreadSubmission = {
      id: randomUUID(),
      threadId: thread.id,
      turnId: turn.id,
      ownerWebContentsId: input.ownerWebContentsId,
      input: structuredClone(input.payload),
      source: input.source,
      retryOfTurnId: input.retryOfTurnId,
      state: 'queued',
      createdAt: Date.now()
    }
    tx.upsertSubmission(submission)
    return { thread, turn, submission }
  })
}
```

Extend `RuntimeMutation` with `ensureThread()` and `createTurn()` using the same existing title, attachment, and `turn:created` behavior. The returned Turn remains `queued` until coordinator drain commits `running`.

- [ ] **Step 4: Implement coordinator drain and recovery**

```ts
export interface WorkbenchTurnRunner {
  start(submission: QueuedThreadSubmission): Promise<void>
  cancel(turnId: string): Promise<void>
}

export class ThreadExecutionCoordinator {
  private readonly draining = new Set<string>()

  constructor(private readonly input: {
    runtimeStore: WorkbenchRuntimeStore
    runner: WorkbenchTurnRunner
  }) {}

  async enqueueCreate(payload: TurnCreateInputLike, ownerWebContentsId: number): Promise<TurnCreateResultLike> {
    const created = await this.input.runtimeStore.createQueuedSubmission({ payload, ownerWebContentsId, source: 'create' })
    void this.drain(created.thread.id)
    return { thread: created.thread, turn: created.turn }
  }

  async enqueueRetry(turnId: string, ownerWebContentsId: number): Promise<TurnCreateResultLike> {
    const original = this.input.runtimeStore.getTurn(turnId)
    if (!original) throw new Error(`Turn not found: ${turnId}`)
    return this.enqueueRetryPayload(this.retryPayload(original), ownerWebContentsId, original.id)
  }

  async rerunInterruptedTurn(originalTurnId: string, ownerWebContentsId: number): Promise<TurnCreateResultLike> {
    const original = this.input.runtimeStore.getTurn(originalTurnId)
    if (!original) throw new Error(`Turn not found: ${originalTurnId}`)
    if (original.status !== 'interrupted') throw new Error('Only an interrupted Turn can be rerun from stale recovery')
    const created = await this.input.runtimeStore.createQueuedSubmission({
      payload: this.retryPayload(original),
      ownerWebContentsId,
      source: 'retry',
      retryOfTurnId: original.id
    })
    if (created.turn.id === original.id) throw new Error('Rerun must allocate a new Turn ID')
    void this.drain(created.thread.id)
    return { thread: created.thread, turn: created.turn }
  }

  async onTurnStatus(turnId: string, status: WorkbenchTurnStatus): Promise<void> {
    if (!isTerminalTurnStatus(status)) return
    const turn = this.input.runtimeStore.getTurn(turnId)
    if (turn) await this.drain(turn.threadId)
  }

  private async drain(threadId: string): Promise<void> {
    if (this.draining.has(threadId)) return
    this.draining.add(threadId)
    try {
      const active = this.input.runtimeStore.listTurns(threadId).find(turn => !isTerminalTurnStatus(turn.status) && turn.status !== 'queued')
      if (active) return
      const head = this.input.runtimeStore.listQueuedSubmissions(threadId)[0]
      if (!head) return
      await this.input.runtimeStore.commitRuntimeMutation(tx => {
        tx.upsertSubmission({ ...head, state: 'starting' })
        tx.setTurnStatus(head.turnId, 'running')
      })
      await this.input.runner.start(head)
    } finally {
      this.draining.delete(threadId)
    }
  }
}
```

On startup, convert a persisted `starting` submission whose process continuation is gone to an `interrupted` Turn and remove that submission; then drain the next `queued` tail. Never replay a persisted `starting` operation.

- [ ] **Step 5: Extract current create/retry execution behind the runner**

Move the current create preparation/dispatch body from `src/main/index.ts:588-792` into `WorkbenchTurnRunner.start()`. Move retry input reconstruction from `src/main/index.ts:818-900` into `retryPayload()`. The runner receives the already-created Turn and therefore must remove the old `runtimeStore.createTurn()` calls at `src/main/index.ts:667-687` and `:889-900`; every later `turn.id`, `thread.id`, cancellation check, task attachment, and final status update stays bound to that supplied Turn.

Move `turns:create`, `turns:retry`, `turns:cancel`, and `turns:cancelAgent` registration into `src/main/ipc/turns-ipc.ts`. Create/retry call coordinator methods with `event.sender.id`. Cancel calls DecisionService cancellation, Dispatcher cancellation, durable Turn cancellation, and coordinator drain in that order. Add `turns:listQueuedSubmissions(threadId?)` and `turns:clearQueue(threadId)` for refresh and explicit discard.

Add a sender-bound `turns:rerunInterrupted(originalTurnId)` contract/preload method whose handler calls only `coordinator.rerunInterruptedTurn(originalTurnId, event.sender.id)`. It accepts no decision request ID, option, command, target, preview, or permission payload. The new submission is reconstructed solely by `retryPayload(originalTurn)` from the original user Turn.

- [ ] **Step 6: Run coordinator and Turn IPC tests**

Run: `npm.cmd test -- src/main/runtime/__tests__/thread-execution-coordinator.test.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/ipc/__tests__/registration-hub.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit main-process admission**

```powershell
git add -- src/main/runtime/thread-execution-coordinator.ts src/main/runtime/workbench-turn-runner.ts src/main/runtime/__tests__/thread-execution-coordinator.test.ts src/main/ipc/turns-ipc.ts src/main/runtime/store.ts src/main/index.ts src/main/ipc/index.ts src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts
git commit -m "feat(runtime): serialize thread submissions"
```

## Task G: Reconcile authoritative runtime decisions with local draft decisions

**Files:**
- Create: `src/renderer/workbench/decisions/decisionQueue.ts`
- Create: `src/renderer/workbench/decisions/decisionAdapters.ts`
- Create: `src/renderer/workbench/decisions/__tests__/decisionQueue.test.ts`
- Test: `src/renderer/workbench/__tests__/threadview-stale-decision.test.tsx`
- Modify: `src/renderer/workbench/WorkbenchLayout.tsx:353-545,573-580`
- Modify: `src/renderer/workbench/SessionSidebar.tsx:15-45,298-307,445-469`
- Modify: `src/renderer/workbench/ThreadView.tsx:600-643`

- [ ] **Step 1: Write failing reconciliation tests**

```ts
import { describe, expect, it } from 'vitest'
import { reconcileDecisionQueue, selectActiveDecision } from '../decisionQueue'
import type { DecisionPresentationItem } from '../decisionAdapters'

const runtimeItem = (id: string, threadId = 'thread-1', createdAt = 1): DecisionPresentationItem => ({
  origin: 'runtime',
  id,
  threadId,
  createdAt,
  request: {
    schemaVersion: 1,
    id,
    owner: { type: 'turn', threadId, turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
    source: 'agent',
    kind: 'single-select',
    title: id,
    options: [{ id: 'a', label: 'A' }],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: false,
    createdAt
  },
  state: 'active'
})

describe('decisionQueue', () => {
  it('replaces runtime cards from the authoritative list and retains local draft cards', () => {
    const local: DecisionPresentationItem = {
      ...runtimeItem('draft-1'),
      origin: 'draft',
      draftRevision: 3,
      draftHash: 'hash-3'
    }
    const result = reconcileDecisionQueue(
      [runtimeItem('stale'), local],
      [runtimeItem('current')]
    )
    expect(result.map(item => item.id)).toEqual(['current', 'draft-1'])
  })

  it('selects a stable active head by createdAt and ID for one thread', () => {
    const result = selectActiveDecision([
      runtimeItem('b', 'thread-1', 4),
      runtimeItem('a', 'thread-1', 4),
      runtimeItem('other', 'thread-2', 1)
    ], 'thread-1')
    expect(result?.id).toBe('a')
  })
})
```

Add an audit-safe stale recovery parser and UI test:

```tsx
it('renders a fixed stale card whose only action reruns the original Turn', () => {
  const rerunInterruptedTurn = vi.fn(async () => undefined)
  render(<StaleDecisionCard event={{
    kind: 'decision:resolved',
    turnId: 'old-turn',
    payload: {
      requestId: 'old-request', status: 'stale', source: 'tool',
      recovery: { kind: 'rerun-turn', originalTurnId: 'old-turn' },
      unexpectedPreview: 'OLD_COMMAND_MUST_NOT_RENDER'
    }
  } as any} onRerunInterruptedTurn={rerunInterruptedTurn} />)
  expect(screen.getByText('Decision interrupted by restart')).toBeTruthy()
  expect(screen.queryByText('OLD_COMMAND_MUST_NOT_RENDER')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Rerun Turn' }))
  expect(rerunInterruptedTurn).toHaveBeenCalledWith('old-turn')
})
```

- [ ] **Step 2: Run the queue test and confirm the red state**

Run: `npm.cmd test -- src/renderer/workbench/decisions/__tests__/decisionQueue.test.ts`

Expected: FAIL because the Renderer decision modules do not exist.

- [ ] **Step 3: Define the presentation union and pure reconciliation**

```ts
// src/renderer/workbench/decisions/decisionAdapters.ts
import type { DecisionRequest, DecisionState, PendingDecision } from '../../../shared/decision-contract'

export type RuntimeDecisionItem = {
  origin: 'runtime'
  id: string
  threadId: string
  createdAt: number
  request: DecisionRequest
  state: DecisionState
  activatedAt?: number
  expiresAt?: number
}

export type DraftDecisionItem = {
  origin: 'draft'
  id: string
  threadId: string
  createdAt: number
  request: Omit<DecisionRequest, 'owner'>
  state: 'active'
  draftRevision: number
  draftHash: string
  valuesByOptionId: Record<string, string>
}

export type DecisionPresentationItem = RuntimeDecisionItem | DraftDecisionItem

export function runtimeDecisionItem(item: PendingDecision): RuntimeDecisionItem {
  if (item.request.owner.type !== 'turn') throw new Error('Hub decisions are not desktop cards')
  return {
    origin: 'runtime',
    id: item.request.id,
    threadId: item.request.owner.threadId,
    createdAt: item.request.createdAt,
    request: item.request,
    state: item.state,
    activatedAt: item.activatedAt,
    expiresAt: item.expiresAt
  }
}
```

Add `staleDecisionRecoveryFromEvent()` in `decisionAdapters.ts`. It returns only `{ requestId, source, originalTurnId, action: 'rerun-turn' }` after checking `status === 'stale'`, `recovery.kind === 'rerun-turn'`, and non-empty IDs; it discards every other event field. `ThreadView` renders the fixed text “Decision interrupted by restart” and a “Rerun Turn” button that calls `window.electronAPI.turns.rerunInterrupted(originalTurnId)`. It never calls `turns.resolveDecision()` and never renders the old request payload.

```ts
// src/renderer/workbench/decisions/decisionQueue.ts
import type { PendingDecision } from '../../../shared/decision-contract'
import { runtimeDecisionItem, type DecisionPresentationItem } from './decisionAdapters'

const order = (left: DecisionPresentationItem, right: DecisionPresentationItem) =>
  left.createdAt - right.createdAt || left.id.localeCompare(right.id)

export function reconcileDecisionQueue(
  current: DecisionPresentationItem[],
  authoritative: PendingDecision[] | DecisionPresentationItem[]
): DecisionPresentationItem[] {
  const runtime = authoritative.map(item => 'origin' in item ? item : runtimeDecisionItem(item))
  const drafts = current.filter(item => item.origin === 'draft')
  return [...runtime, ...drafts].sort(order)
}

export function selectActiveDecision(items: DecisionPresentationItem[], threadId: string | null): DecisionPresentationItem | null {
  if (!threadId) return null
  return items.filter(item => item.threadId === threadId && item.state === 'active').sort(order)[0] ?? null
}

export function pendingCountsByThread(items: DecisionPresentationItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.threadId] = (counts[item.threadId] ?? 0) + 1
    return counts
  }, {})
}
```

- [ ] **Step 4: Make WorkbenchLayout reload the authoritative list**

Add one state owner and one refresh callback:

```ts
const [decisionItems, setDecisionItems] = useState<DecisionPresentationItem[]>([])

const refreshPendingDecisions = useCallback(async () => {
  const authoritative = await window.electronAPI.turns.listPendingDecisions()
  setDecisionItems(current => reconcileDecisionQueue(current, authoritative))
}, [])
```

Include `listPendingDecisions()` in both initial `loadWorkbench()` and thread-selection refreshes. In the runtime event subscription, call `refreshPendingDecisions()` immediately for `decision:requested` and `decision:resolved`; do not construct clickable cards from event payloads. Derive `activeDecision` with `selectActiveDecision(decisionItems, activeThreadId)` and derive `decisionCounts` for all sidebar threads.

Pass `decisionCounts` into `SessionSidebar`. Add `decisionCount` to `ThreadItem` and render an accessible badge:

```tsx
{decisionCount > 0 && (
  <span className="wb-thread-decision-count" aria-label={tr(`${decisionCount} 个待处理决策`, `${decisionCount} pending decisions`)}>
    {decisionCount}
  </span>
)}
```

- [ ] **Step 5: Run queue and Workbench state tests**

Run: `npm.cmd test -- src/renderer/workbench/decisions/__tests__/decisionQueue.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/thread-switching-layout.test.ts`

Expected: PASS, including refresh replacement of stale runtime cards.

- [ ] **Step 6: Commit authoritative reconciliation**

```powershell
git add -- src/renderer/workbench/decisions/decisionQueue.ts src/renderer/workbench/decisions/decisionAdapters.ts src/renderer/workbench/decisions/__tests__/decisionQueue.test.ts src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/SessionSidebar.tsx
git commit -m "feat(renderer): reconcile pending decisions"
```

## Task H: Render the inline DecisionBar and local draft choices

**Files:**
- Create: `src/renderer/workbench/decisions/DecisionBar.tsx`
- Create: `src/renderer/workbench/decisions/__tests__/DecisionBar.test.tsx`
- Create: `src/renderer/workbench/decisions/PendingDecisionNotice.tsx`
- Create: `src/renderer/workbench/decisions/__tests__/PendingDecisionNotice.test.tsx`
- Modify: `src/renderer/workbench/ComposerBar.tsx:76-105,810-823`
- Modify: `src/renderer/workbench/PromptEnhancer.tsx:8-61`
- Modify: `src/renderer/workbench/WorkbenchLayout.tsx:1392-1432`
- Modify: `src/renderer/workbench/WorkbenchMainContent.tsx:45-59,127-183,221-222`
- Modify: `src/renderer/globals.css:9474-9510,10245-10258,11165-11232`
- Test: `src/renderer/workbench/__tests__/ComposerBar.sendQueue.test.tsx`

- [ ] **Step 1: Write failing interaction and accessibility tests**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DecisionBar } from '../DecisionBar'

const item = {
  origin: 'runtime' as const,
  id: 'decision-1',
  threadId: 'thread-1',
  createdAt: 1,
  state: 'active' as const,
  request: {
    schemaVersion: 1 as const,
    id: 'decision-1',
    owner: { type: 'turn' as const, threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
    source: 'tool' as const,
    kind: 'single-select' as const,
    title: 'Allow command?',
    description: 'The Agent wants to run tests.',
    options: [
      { id: 'deny', label: 'Deny', tone: 'danger' as const },
      { id: 'allow-once', label: 'Allow once', tone: 'safe' as const }
    ],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: true,
    createdAt: 1
  }
}

describe('DecisionBar', () => {
  it('is an inline group without modal semantics or a focus trap', () => {
    render(<DecisionBar item={item} position={1} count={2} onSubmit={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Allow command?' })
    expect(group.getAttribute('aria-modal')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  it('keeps the card and reports a retryable error when main rejects submission', async () => {
    const submit = vi.fn(async () => ({ accepted: false as const }))
    render(<DecisionBar item={item} position={1} count={1} onSubmit={submit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be accepted'))
    expect(screen.getByRole('group', { name: 'Allow command?' })).toBeTruthy()
  })

  it('disables duplicate actions while an authoritative submission is in flight', async () => {
    let release!: (value: { accepted: true }) => void
    const submit = vi.fn(() => new Promise<{ accepted: true }>(resolve => { release = resolve }))
    render(<DecisionBar item={item} position={1} count={1} onSubmit={submit} />)
    const allow = screen.getByRole('button', { name: 'Allow once' })
    fireEvent.click(allow)
    fireEvent.click(allow)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(allow).toBeDisabled()
    release({ accepted: true })
  })
})
```

Add these accessibility cases to the same suite; security sources announce assertively only after the debounce, Escape only collapses details, errors are associated, and mounting a new card does not move focus:

```tsx
it('debounces live announcements and uses assertive mode for security decisions', async () => {
  vi.useFakeTimers()
  render(<DecisionBar item={item} position={1} count={2} onSubmit={vi.fn()} />)
  const live = screen.getByTestId('decision-live-region')
  expect(live).toHaveAttribute('aria-live', 'assertive')
  expect(live.textContent).toBe('')
  await act(async () => { vi.advanceTimersByTime(180) })
  expect(live.textContent).toBe('Allow command?. Decision 1 of 2.')
  vi.useRealTimers()
})

it('uses polite announcements for neutral Agent decisions', async () => {
  vi.useFakeTimers()
  render(<DecisionBar item={{ ...item, request: { ...item.request, source: 'agent' } }} position={1} count={1} onSubmit={vi.fn()} />)
  expect(screen.getByTestId('decision-live-region')).toHaveAttribute('aria-live', 'polite')
  await act(async () => { vi.advanceTimersByTime(180) })
  vi.useRealTimers()
})

it('Escape collapses details without submitting or denying', () => {
  const submit = vi.fn()
  render(<DecisionBar item={item} position={1} count={1} onSubmit={submit} />)
  const details = screen.getByRole('button', { name: 'Show details' })
  fireEvent.click(details)
  expect(details).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(screen.getByRole('group', { name: 'Allow command?' }), { key: 'Escape' })
  expect(details).toHaveAttribute('aria-expanded', 'false')
  expect(submit).not.toHaveBeenCalled()
})

it('associates a rejected submission error without moving existing Composer focus', async () => {
  const composer = document.createElement('textarea')
  composer.setAttribute('aria-label', 'Composer')
  document.body.appendChild(composer)
  composer.focus()
  const submit = vi.fn(async () => ({ accepted: false as const }))
  const view = render(<DecisionBar item={item} position={1} count={1} onSubmit={submit} />)
  expect(document.activeElement).toBe(composer)
  fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  const group = screen.getByRole('group', { name: 'Allow command?' })
  expect(group.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  view.rerender(<DecisionBar item={{ ...item, id: 'decision-2', request: { ...item.request, id: 'decision-2' } }} position={1} count={1} onSubmit={submit} />)
  expect(document.activeElement).toBe(composer)
  composer.remove()
})
```

Create `PendingDecisionNotice.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PendingDecisionNotice } from '../PendingDecisionNotice'

it('appears only outside Chat and returns to the owning Chat thread', () => {
  const returnToChat = vi.fn()
  const { rerender } = render(<PendingDecisionNotice visible={false} count={2} threadId="thread-2" onReturnToChat={returnToChat} />)
  expect(screen.queryByRole('status')).toBeNull()
  rerender(<PendingDecisionNotice visible count={2} threadId="thread-2" onReturnToChat={returnToChat} />)
  expect(screen.getByText('2 pending decisions')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Return to decision' }))
  expect(returnToChat).toHaveBeenCalledWith('thread-2')
})
```

- [ ] **Step 2: Run the component test and confirm the red state**

Run: `npm.cmd test -- src/renderer/workbench/decisions/__tests__/DecisionBar.test.tsx`

Expected: FAIL because `DecisionBar` does not exist.

- [ ] **Step 3: Implement the IPC-free inline component**

```tsx
import React, { useId, useState } from 'react'
import type { DecisionResolveResult, DecisionSubmission } from '../../../shared/decision-contract'
import type { DecisionPresentationItem } from './decisionAdapters'

export function DecisionBar({ item, position, count, onSubmit }: {
  item: DecisionPresentationItem
  position: number
  count: number
  onSubmit: (submission: DecisionSubmission) => Promise<DecisionResolveResult>
}) {
  const titleId = useId()
  const detailsId = useId()
  const errorId = useId()
  const [selected, setSelected] = useState<string[]>([])
  const [customText, setCustomText] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnouncement(`${item.request.title}. Decision ${position} of ${count}.`)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [item.id, item.request.title, position, count])

  const assertive = item.request.source === 'tool' || item.request.source === 'guard' || item.request.source === 'acp'

  const submit = async (submission: DecisionSubmission) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onSubmit(submission)
      if (!result.accepted) setError('This decision could not be accepted. Refresh and try again.')
      else if (result.warning === 'remember_failed') setError('The one-time decision was applied, but it could not be remembered.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision submission failed.')
    } finally {
      setBusy(false)
    }
  }

  const choose = (optionId: string) => {
    if (item.request.kind === 'single-select' || item.request.kind === 'confirm') {
      void submit({ requestId: item.id, outcome: 'selected', selectedOptionIds: [optionId], remember })
      return
    }
    setSelected(current => current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId])
  }

  return (
    <section
      className={`wb-decision-bar source-${item.request.source}`}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      aria-busy={busy}
      onKeyDown={event => {
        if (event.key === 'Escape' && detailsOpen) {
          event.preventDefault()
          setDetailsOpen(false)
        }
      }}
    >
      <span data-testid="decision-live-region" className="wb-sr-only" role="status" aria-live={assertive ? 'assertive' : 'polite'} aria-atomic="true">
        {announcement}
      </span>
      <header>
        <strong id={titleId}>{item.request.title}</strong>
        <span>{position} / {count}</span>
      </header>
      {item.request.description && <button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(open => !open)}>{detailsOpen ? 'Hide details' : 'Show details'}</button>}
      {detailsOpen && item.request.description && <p id={detailsId}>{item.request.description}</p>}
      <div className="wb-decision-options">
        {item.request.options.map(option => (
          <button key={option.id} type="button" data-decision-primary={option === item.request.options[0] ? '' : undefined} disabled={busy} className={`tone-${option.tone ?? 'default'}`} onClick={() => choose(option.id)}>
            <span>{option.label}</span>
            {option.description && <small>{option.description}</small>}
          </button>
        ))}
      </div>
      {item.request.allowCustom && (
        <label className="wb-decision-custom">
          <span>Other / custom</span>
          <textarea value={customText} maxLength={item.request.customInput?.maxChars} disabled={busy} onChange={event => setCustomText(event.target.value)} />
        </label>
      )}
      {item.request.allowRemember && (
        <label className="wb-decision-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} /> Remember this choice</label>
      )}
      {(item.request.kind === 'multi-select' || item.request.allowCustom) && (
        <button type="button" disabled={busy || (selected.length === 0 && !customText.trim())} onClick={() => void submit({
          requestId: item.id,
          outcome: customText.trim() ? 'submitted' : 'selected',
          selectedOptionIds: selected,
          customText: customText.trim() || undefined,
          remember
        })}>Confirm</button>
      )}
      {error && <div id={errorId} role="alert" aria-live="assertive" className="wb-error-text">{error}</div>}
    </section>
  )
}
```

Create the compact global notice and render it from `WorkbenchMainContent` only while `view !== 'chat'`:

```tsx
export function PendingDecisionNotice({ visible, count, threadId, onReturnToChat }: {
  visible: boolean
  count: number
  threadId: string
  onReturnToChat: (threadId: string) => void
}) {
  if (!visible || count < 1) return null
  return (
    <aside className="wb-pending-decision-notice" role="status" aria-live="polite">
      <span>{count} pending decisions</span>
      <button type="button" onClick={() => onReturnToChat(threadId)}>Return to decision</button>
    </aside>
  )
}
```

`WorkbenchLayout` passes the oldest pending item's `threadId`; the callback first awaits `selectThread(threadId)` and then calls `setView('chat')`, so the button cannot return to the wrong conversation.

In `ComposerBar`, set the focus intent before awaiting authoritative resolution and consume it only when the active request ID changes:

```tsx
const focusAfterDecisionRef = useRef<string | null>(null)
const composerRootRef = useRef<HTMLDivElement | null>(null)

const submitDecision = async (submission: DecisionSubmission): Promise<DecisionResolveResult> => {
  focusAfterDecisionRef.current = decisionItem?.id ?? null
  try {
    const result = await onDecisionSubmit(submission)
    if (!result.accepted) focusAfterDecisionRef.current = null
    return result
  } catch (error) {
    focusAfterDecisionRef.current = null
    throw error
  }
}

useLayoutEffect(() => {
  const settledId = focusAfterDecisionRef.current
  if (!settledId || decisionItem?.id === settledId) return
  focusAfterDecisionRef.current = null
  queueMicrotask(() => {
    const next = composerRootRef.current?.querySelector<HTMLElement>('[data-decision-primary]')
    ;(next ?? textareaRef.current)?.focus()
  })
}, [decisionItem?.id])
```

Extend `ComposerBar.sendQueue.test.tsx`: focus the Composer, mount a new card and assert focus stays in the Composer; accept it, rerender with a second card and assert its first action has focus; accept the second, rerender with `decisionItem={null}`, and assert the Composer regains focus.

- [ ] **Step 4: Insert DecisionBar at the specified Composer location**

Add `decisionItem`, `decisionPosition`, `decisionCount`, and `onDecisionSubmit` props through `WorkbenchLayout -> WorkbenchMainContent -> ComposerBar`. At `ComposerBar.tsx:819`, render exactly before `.wb-composer-input-layer`:

```tsx
<div className="wb-composer">
  {decisionItem && (
    <DecisionBar
      key={decisionItem.id}
      item={decisionItem}
      position={decisionPosition}
      count={decisionCount}
      onSubmit={onDecisionSubmit}
    />
  )}
  <div className="wb-composer-input-layer">
```

`WorkbenchLayout.onDecisionSubmit` calls `turns.resolveDecision()` for runtime items and applies local draft values only when the current `draftRevision` and `draftHash` still match.

- [ ] **Step 5: Convert manual PromptEnhancer output to a local draft item**

Change `PromptEnhancer` to receive `threadId`, `draftRevision`, `draftHash`, and `onDecision`. Keep its existing QuickComplete call, but replace immediate `onEnhanced(enhanced)` with a local item containing authoritative “Keep original” and “Use enhanced” options:

```ts
const decisionId = crypto.randomUUID()
onDecision({
  origin: 'draft',
  id: decisionId,
  threadId,
  createdAt: Date.now(),
  state: 'active',
  draftRevision,
  draftHash,
  valuesByOptionId: { original: text, enhanced },
  request: {
    schemaVersion: 1,
    id: decisionId,
    source: 'prompt-optimizer',
    kind: 'single-select',
    title: 'Choose the Composer draft',
    options: [
      { id: 'original', label: 'Keep original' },
      { id: 'enhanced', label: 'Use enhanced' }
    ],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: true,
    customInput: { placeholder: 'Write another version', maxChars: 512 * 1024 },
    allowRemember: false,
    createdAt: Date.now()
  }
})
```

The local draft shape deliberately has no `owner`; it is not a main-process `DecisionRequest`. Composer increments `draftRevision` on every user edit and computes SHA-256 with `crypto.subtle.digest`; a stale result never changes the textarea.

- [ ] **Step 6: Add responsive, dark-mode, and focus-visible styles**

Add `.wb-decision-bar` rules to `globals.css`: full Composer width, inline flow, no fixed positioning, visible focus rings, `max-height` with internal overflow for long options, danger/safe tones using existing tokens, stacked controls below 720px, and dark-theme token overrides. Every button, checkbox hit area, input, and textarea uses `min-height: 32px`; `.wb-decision-bar` uses `min-width: 0; max-width: 100%; overflow-x: clip`, preview text uses `overflow-wrap: anywhere`, and the narrow option grid becomes `grid-template-columns: minmax(0, 1fr)` so the page never scrolls horizontally. Add a CSS assertion in `DecisionBar.test.tsx` that reads `globals.css` and matches `min-height: 32px`, `max-width: 100%`, and the narrow single-column rule. Do not add `aria-modal`, `position: fixed`, or a z-index overlay.

- [ ] **Step 7: Run DecisionBar and Composer tests**

Run: `npm.cmd test -- src/renderer/workbench/decisions/__tests__/DecisionBar.test.tsx src/renderer/workbench/decisions/__tests__/PendingDecisionNotice.test.tsx src/renderer/workbench/__tests__/ComposerBar.sendQueue.test.tsx src/renderer/workbench/__tests__/thread-switching-layout.test.ts`

Expected: PASS; existing send-queue order and retry behavior remain unchanged.

- [ ] **Step 8: Commit the inline bar**

```powershell
git add -- src/renderer/workbench/decisions/DecisionBar.tsx src/renderer/workbench/decisions/PendingDecisionNotice.tsx src/renderer/workbench/decisions/__tests__/DecisionBar.test.tsx src/renderer/workbench/decisions/__tests__/PendingDecisionNotice.test.tsx src/renderer/workbench/ComposerBar.tsx src/renderer/workbench/PromptEnhancer.tsx src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/WorkbenchMainContent.tsx src/renderer/globals.css src/renderer/workbench/__tests__/ComposerBar.sendQueue.test.tsx
git commit -m "feat(renderer): add inline decision bar"
```

## Task I: Migrate Dispatcher tool approval to DecisionService

**Files:**
- Create: `src/main/runtime/decision-adapters/tool-decision-adapter.ts`
- Create: `src/main/runtime/decision-adapters/__tests__/tool-decision-adapter.test.ts`
- Create: `src/main/runtime/decision-adapters/plugin-decision-adapter.ts`
- Create: `src/main/runtime/decision-adapters/__tests__/plugin-decision-adapter.test.ts`
- Modify: `src/main/runtime/plugin-contributions.ts:69-88`
- Modify: `src/main/hooks/hook-engine.ts:31-54,157-183`
- Test: `src/main/runtime/__tests__/plugin-contributions.test.ts`
- Test: `src/main/runtime/__tests__/workbench-turn-runner.test.ts`
- Modify: `src/main/hub/dispatcher.ts:243-272,1083,1123-1275,1724-1745`
- Modify: `src/main/agentic/approval.ts:119-233,249-293`
- Test: `src/main/hub/__tests__/dispatcher-approval-events.test.ts`
- Test: `src/renderer/workbench/__tests__/approvalEvents.test.ts`

- [ ] **Step 1: Write failing tool adapter tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { ToolDecisionAdapter } from '../tool-decision-adapter'

describe('ToolDecisionAdapter', () => {
  it('maps allow-once to true and denial to false', async () => {
    const service = {
      request: vi.fn()
        .mockResolvedValueOnce({ requestId: 'one', status: 'selected', selectedOptionIds: ['allow-once'], resolvedAt: 1 })
        .mockResolvedValueOnce({ requestId: 'two', status: 'denied', resolvedAt: 2 })
    }
    const adapter = new ToolDecisionAdapter({ decisionService: service as any, approvalConfig: {} as any })
    await expect(adapter.request({
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
      agentId: 'codex', tool: 'exec', toolName: 'exec', action: 'run_command', target: 'npm.cmd test', preview: 'npm.cmd test', risk: 'medium'
    })).resolves.toBe(true)
    await expect(adapter.request({
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
      agentId: 'codex', tool: 'exec', toolName: 'exec', action: 'run_command', target: 'npm.cmd test', preview: 'npm.cmd test', risk: 'medium'
    })).resolves.toBe(false)
  })

  it('registers remember persistence without re-requesting the tool decision', async () => {
    const remember = vi.fn(async () => { throw new Error('store failed') })
    let onRemember!: (resolution: any) => Promise<void>
    const service = {
      request: vi.fn(async (_request, options) => {
        onRemember = options.onRemember
        return { requestId: 'one', status: 'selected', selectedOptionIds: ['allow-once'], resolvedAt: 1 }
      })
    }
    const adapter = new ToolDecisionAdapter({
      decisionService: service as any,
      approvalConfig: { setOverrideAndFlush: remember } as any
    })
    await expect(adapter.request({
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
      agentId: 'codex', tool: 'exec', toolName: 'exec', action: 'run_command', target: 'npm.cmd test', preview: 'npm.cmd test', risk: 'medium'
    })).resolves.toBe(true)
    await expect(onRemember({ requestId: 'one', status: 'selected', selectedOptionIds: ['allow-once'], resolvedAt: 1 }))
      .rejects.toThrow('store failed')
    expect(service.request).toHaveBeenCalledTimes(1)
  })
})
```

Create `plugin-decision-adapter.test.ts` and extend `plugin-contributions.test.ts` with the structured approval path:

```ts
import { describe, expect, it, vi } from 'vitest'
import { PluginDecisionAdapter } from '../plugin-decision-adapter'

const turnOwner = { type: 'turn' as const, threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 }

it('awaits DecisionService and resumes the same Turn only after approval', async () => {
  let release!: (value: any) => void
  const request = vi.fn((_decision: any) => new Promise(resolve => { release = resolve }))
  const adapter = new PluginDecisionAdapter({ decisionService: { request } as any })
  const pending = adapter.request({ owner: turnOwner, pluginId: 'safe-plugin', hookId: 'preflight', message: 'Approve pre-dispatch hook' })
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(request.mock.calls[0][0].owner.turnId).toBe('turn-1')
  let settled = false
  void pending.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  release({ requestId: 'decision-1', status: 'selected', selectedOptionIds: ['allow-once'], resolvedAt: 1 })
  await expect(pending).resolves.toBe(true)
})

it('fails closed when no Turn owner or interactive DecisionService channel exists', async () => {
  await expect(new PluginDecisionAdapter({}).request({
    pluginId: 'safe-plugin', hookId: 'preflight', message: 'Approve'
  })).resolves.toBe(false)
  await expect(new PluginDecisionAdapter({}).request({
    owner: turnOwner, pluginId: 'safe-plugin', hookId: 'preflight', message: 'Approve'
  })).resolves.toBe(false)
})
```

```ts
it('returns a structured approval request instead of converting requireApproval to deny', async () => {
  const outcome = await runPreDispatchHooks(resolvePluginPreDispatchHooks(), {
    threadId: 'thread-1', prompt: 'approval fixture'
  })
  expect(outcome.denied).toBeUndefined()
  expect(outcome.approvalRequests).toEqual([{
    pluginId: 'installed', hookId: 'approve', message: 'Approve plugin dispatch.'
  }])
})
```

- [ ] **Step 2: Run the adapter test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/decision-adapters/__tests__/tool-decision-adapter.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the trusted tool adapter**

```ts
import type { DecisionService } from '../decision-service'
import {
  createToolDecisionRequest,
  type ToolDecisionInput
} from '../decision-request-factories'

export class ToolDecisionAdapter {
  constructor(private readonly input: {
    decisionService: DecisionService
    approvalConfig: { setOverrideAndFlush(agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'deny'): Promise<void> }
  }) {}

  async request(input: ToolDecisionInput): Promise<boolean> {
    const request = createToolDecisionRequest({ ...input, deadlineMs: 300_000, allowRemember: true })
    const resolution = await this.input.decisionService.request(request, {
      onRemember: async result => {
        const allowed = result.selectedOptionIds?.includes('allow-once') === true
        await this.input.approvalConfig.setOverrideAndFlush(input.agentId, input.tool, allowed ? 'allow' : 'deny')
      }
    })
    return resolution.status === 'selected' && resolution.selectedOptionIds?.includes('allow-once') === true
  }
}
```

Implement `plugin-decision-adapter.ts` by reusing the existing trusted Guard factory; do not add a generic privileged factory:

```ts
import type { DecisionService } from '../decision-service'
import {
  createGuardDecisionRequest,
  type GuardDecisionInput
} from '../decision-request-factories'

export type PluginDecisionInput = {
  owner?: GuardDecisionInput['owner']
  pluginId: string
  hookId: string
  message: string
}

export class PluginDecisionAdapter {
  constructor(private readonly input: { decisionService?: Pick<DecisionService, 'request'> } = {}) {}

  async request(input: PluginDecisionInput): Promise<boolean> {
    if (!input.owner || !this.input.decisionService) return false
    const request = createGuardDecisionRequest({
      owner: input.owner,
      agentId: `plugin:${input.pluginId}`,
      role: `pre-dispatch:${input.hookId}`,
      risk: 'medium',
      reasons: [input.message],
      idempotencyKey: `plugin:${input.pluginId}:${input.hookId}:pre-dispatch`
    })
    const resolution = await this.input.decisionService.request(request)
    return resolution.status === 'selected' && resolution.selectedOptionIds?.includes('allow-once') === true
  }
}
```

Extend the hook contract so a declaration requests approval without owning or resolving it:

```ts
export type PluginApprovalRequest = { pluginId: string; hookId: string; message: string }

export interface HookResult {
  decision?: 'allow' | 'deny' | 'request-approval'
  approvalRequest?: PluginApprovalRequest
  // existing fields stay unchanged
}

export interface DispatchOutcome {
  denied?: string
  approvalRequests: PluginApprovalRequest[]
  additionalContext: string[]
  warnings: string[]
}
```

In `resolvePluginPreDispatchHooks()`, replace the current `requireApproval` denial with:

```ts
if (hook.requireApproval) {
  return {
    decision: 'request-approval',
    approvalRequest: {
      pluginId: hook.pluginId || 'plugin',
      hookId: hook.id,
      message: hook.message?.trim() || `Plugin ${hook.pluginId || 'plugin'} requires approval before dispatch.`
    }
  }
}
```

`runPreDispatchHooks()` appends validated `request-approval` payloads to `approvalRequests` and never puts them in `denied`.

Add `ApprovalConfig.setOverrideAndFlush()` using the rejecting `store.commit()` API. It must update the cache only after persistence succeeds.

- [ ] **Step 4: Replace Dispatcher pending approval ownership**

Inject `ToolDecisionAdapter` into Dispatcher. Replace `requestApprovalFor()` calls with `toolDecisionAdapter.request()` using the Turn owner resolved from `task.__turnId`, its thread, workspace, and `ownerWebContentsId`. Retain `agent:approval` pending/resolved stream events as audit events around the adapter await. Delete `pendingApprovals`, `approvalSeq`, approval timers, and `resolveApproval()` only after all Dispatcher tests use DecisionService. Dispatcher task/agent cancellation must call DecisionService cancellation through the Turn/Agent scope before stopping the provider loop.

Instantiate `PluginDecisionAdapter` beside DecisionService. Move both create and retry PreDispatch execution into `WorkbenchTurnRunner.start(submission)`, after `ThreadExecutionCoordinator` has durably created the new Turn. Build the owner from `submission.threadId`, `submission.turnId`, the Turn workspace, and `submission.ownerWebContentsId`, then await every `preDispatchOutcome.approvalRequests` item:

```ts
for (const approval of preDispatchOutcome.approvalRequests) {
  const approved = await pluginDecisionAdapter.request({ owner, ...approval })
  if (!approved) throw new Error(`Plugin ${approval.pluginId} pre-dispatch approval was denied or unavailable.`)
}
```

Only after this loop may the same `submission.turnId` continue to budget checks and dispatch. A missing owner/channel returns `false` and fails closed; it must never fall back to immediate allow or silently choose a route. In `workbench-turn-runner.test.ts`, defer the adapter promise, assert dispatch has not started while pending, resolve it, assert dispatch starts once with the same Turn ID, and run the case for both `source: 'create'` and `source: 'retry'`.

- [ ] **Step 5: Run tool and reconciliation tests**

Run: `npm.cmd test -- src/main/runtime/decision-adapters/__tests__/tool-decision-adapter.test.ts src/main/runtime/decision-adapters/__tests__/plugin-decision-adapter.test.ts src/main/runtime/__tests__/plugin-contributions.test.ts src/main/runtime/__tests__/workbench-turn-runner.test.ts src/main/hub/__tests__/dispatcher-approval-events.test.ts src/main/agentic/__tests__/approval.test.ts src/renderer/workbench/__tests__/approvalEvents.test.ts`

Expected: PASS, including pending/resolved audit ordering and no duplicate execution after a remember failure.

- [ ] **Step 6: Commit tool migration**

```powershell
git add -- src/main/runtime/decision-adapters/tool-decision-adapter.ts src/main/runtime/decision-adapters/plugin-decision-adapter.ts src/main/runtime/decision-adapters/__tests__/tool-decision-adapter.test.ts src/main/runtime/decision-adapters/__tests__/plugin-decision-adapter.test.ts src/main/runtime/plugin-contributions.ts src/main/runtime/__tests__/plugin-contributions.test.ts src/main/hooks/hook-engine.ts src/main/runtime/workbench-turn-runner.ts src/main/runtime/__tests__/workbench-turn-runner.test.ts src/main/hub/dispatcher.ts src/main/agentic/approval.ts src/main/hub/__tests__/dispatcher-approval-events.test.ts src/main/agentic/__tests__/approval.test.ts src/renderer/workbench/__tests__/approvalEvents.test.ts
git commit -m "feat(decisions): migrate tool approvals"
```

## Task J: Preserve ACP permission option IDs through DecisionService

**Files:**
- Create: `src/main/runtime/decision-adapters/acp-decision-adapter.ts`
- Create: `src/main/runtime/decision-adapters/__tests__/acp-decision-adapter.test.ts`
- Modify: `src/main/hub/adapters/acp-client.ts:29-41,437-505`
- Modify: `src/main/hub/dispatcher.ts:1639-1745`
- Test: `src/main/hub/adapters/__tests__/acp-client.test.ts`

- [ ] **Step 1: Write failing exact-option tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { AcpDecisionAdapter } from '../acp-decision-adapter'

describe('AcpDecisionAdapter', () => {
  it('returns the exact protocol option selected by the user', async () => {
    const service = {
      request: vi.fn(async () => ({
        requestId: 'decision-1',
        status: 'selected',
        selectedOptionIds: ['allow_session'],
        resolvedAt: 1
      }))
    }
    const adapter = new AcpDecisionAdapter({ decisionService: service as any })
    await expect(adapter.request({
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
      title: 'Permission',
      toolName: 'shell',
      options: [
        { optionId: 'deny_once', name: 'Deny', kind: 'deny_once' },
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow_session', name: 'Allow for session', kind: 'allow_always' }
      ]
    })).resolves.toEqual({ outcome: 'selected', optionId: 'allow_session' })
  })

  it('fails closed when a resolution contains an unknown option ID', async () => {
    const service = {
      request: vi.fn(async () => ({ requestId: 'decision-1', status: 'selected', selectedOptionIds: ['invented'], resolvedAt: 1 }))
    }
    const adapter = new AcpDecisionAdapter({ decisionService: service as any })
    await expect(adapter.request({
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
      title: 'Permission',
      toolName: 'shell',
      options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }]
    })).resolves.toEqual({ outcome: 'cancelled' })
  })
})
```

- [ ] **Step 2: Run the ACP adapter test and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/decision-adapters/__tests__/acp-decision-adapter.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement ACP option preservation**

```ts
import type { DecisionService } from '../decision-service'
import {
  createAcpDecisionRequest,
  type AcpDecisionInput
} from '../decision-request-factories'

export type AcpPermissionOption = {
  optionId: string
  name?: string
  kind?: string
  description?: string
}

export type AcpPermissionResolution =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

export class AcpDecisionAdapter {
  constructor(private readonly input: { decisionService: DecisionService }) {}

  async request(input: AcpDecisionInput): Promise<AcpPermissionResolution> {
    const request = createAcpDecisionRequest({
      owner: input.owner,
      title: input.title,
      toolName: input.toolName,
      options: input.options,
      deadlineMs: 300_000
    })
    const resolution = await this.input.decisionService.request(request)
    const selected = resolution.selectedOptionIds?.[0]
    if (resolution.status !== 'selected' || !selected) return { outcome: 'cancelled' }
    if (!input.options.some(option => option.optionId === selected)) return { outcome: 'cancelled' }
    return { outcome: 'selected', optionId: selected }
  }
}
```

Change `AcpPromptHandlers.onRequestPermission` from `Promise<boolean>` to `Promise<AcpPermissionResolution>` and include the validated protocol `options` in `AcpPermissionRequest`.

- [ ] **Step 4: Replace first-option selection in AcpClient**

Replace `acp-client.ts:484-505` with:

```ts
private async handlePermissionRequest(msg: any): Promise<void> {
  const options = normalizePermissionOptions(msg.params?.options)
  const sid = String(msg.params?.sessionId || '')
  const handler = sid ? this.promptHandlers.get(sid)?.onRequestPermission : undefined
  if (!handler || options.length === 0) {
    this.respond(msg.id, { outcome: { outcome: 'cancelled' } })
    return
  }

  let resolution: AcpPermissionResolution = { outcome: 'cancelled' }
  try {
    resolution = await handler({ ...acpPermissionRequest(msg.params), options })
  } catch {
    resolution = { outcome: 'cancelled' }
  }

  if (resolution.outcome === 'selected' && options.some(option => option.optionId === resolution.optionId)) {
    this.respond(msg.id, { outcome: { outcome: 'selected', optionId: resolution.optionId } })
    return
  }
  this.respond(msg.id, { outcome: { outcome: 'cancelled' } })
}
```

`normalizePermissionOptions()` must require a non-empty unique `optionId`, cap the list at eight, bound display strings, and preserve order. It must never fall back to `options[0]`. Wire Dispatcher `onRequestPermission` to `AcpDecisionAdapter`; for an explicit auto-allow policy, select only a uniquely recognized `allow_once` option, otherwise cancel.

- [ ] **Step 5: Run ACP tests**

Run: `npm.cmd test -- src/main/runtime/decision-adapters/__tests__/acp-decision-adapter.test.ts src/main/hub/adapters/__tests__/acp-client.test.ts src/main/hub/__tests__/dispatcher-approval-events.test.ts`

Expected: PASS and every selected response contains the user-selected protocol `optionId`.

- [ ] **Step 6: Commit ACP migration**

```powershell
git add -- src/main/runtime/decision-adapters/acp-decision-adapter.ts src/main/runtime/decision-adapters/__tests__/acp-decision-adapter.test.ts src/main/hub/adapters/acp-client.ts src/main/hub/dispatcher.ts src/main/hub/adapters/__tests__/acp-client.test.ts src/main/hub/__tests__/dispatcher-approval-events.test.ts
git commit -m "feat(decisions): preserve acp permission options"
```

## Task K: Migrate Guard decisions and retire legacy primary approval UI/IPC

**Files:**
- Create: `src/main/runtime/decision-adapters/guard-decision-adapter.ts`
- Create: `src/main/runtime/decision-adapters/__tests__/guard-decision-adapter.test.ts`
- Create: `src/main/__tests__/decision-runtime-architecture.test.ts`
- Modify: `src/main/runtime/schedule-helpers.ts:244-310`
- Delete: `src/main/runtime/guard-approval-service.ts`
- Modify: `src/main/index.ts:28,793-818,1145-1147`
- Modify: `src/main/ipc/missing-ipc.ts:125-139`
- Modify: `src/shared/ipc-contract.ts:3061-3080,3121-3124,6746-6748,6797-6814`
- Modify: `src/preload/index.ts:128-133`
- Modify: `src/renderer/vite-env.d.ts:168-174,337-341`
- Modify: `src/renderer/workbench/WorkbenchLayout.tsx:3,130-185,300-305,547-567,1096-1098,1431,1503-1509`
- Modify: `src/renderer/workbench/WorkbenchMainContent.tsx:57-59,139-141,277-280`
- Modify: `src/renderer/workbench/ThreadView.tsx:23-38,89-96,600-643,824-829`
- Modify: `src/renderer/workbench/utils/approvalEvents.ts:198-224`
- Delete: `src/renderer/glass/approval-dialog.tsx`
- Rename: `src/main/runtime/__tests__/guard-approval-service.test.ts` to `src/main/runtime/__tests__/guard-decision-adapter.integration.test.ts`
- Test: `src/renderer/workbench/__tests__/approvalEvents.test.ts`

- [ ] **Step 1: Write failing Guard adapter and migration-guard tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { GuardDecisionAdapter } from '../guard-decision-adapter'

describe('GuardDecisionAdapter', () => {
  it.each([
    ['selected', ['allow-once'], 'approved'],
    ['denied', undefined, 'denied'],
    ['timeout', undefined, 'timeout'],
    ['cancelled', undefined, 'cancelled']
  ] as const)('maps %s to %s without changing Turn identity', async (status, selectedOptionIds, expected) => {
    const service = { request: vi.fn(async () => ({ requestId: 'guard-1', status, selectedOptionIds, resolvedAt: 1 })) }
    const adapter = new GuardDecisionAdapter({ decisionService: service as any })
    await expect(adapter.request({
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 7 },
      agentId: 'reviewer', role: 'executor', risk: 'high', reasons: ['unsafe output']
    })).resolves.toMatchObject({ requestId: 'guard-1', decision: expected })
  })
})
```

```ts
// src/main/__tests__/decision-runtime-architecture.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('decision runtime migration', () => {
  it('routes primary decisions through DecisionService and removes legacy resolution channels', () => {
    expect(read('src/main/hub/dispatcher.ts')).toContain('ToolDecisionAdapter')
    expect(read('src/main/runtime/schedule-helpers.ts')).toContain('GuardDecisionAdapter')
    expect(read('src/main/hub/adapters/acp-client.ts')).not.toContain('opts[0]')
    expect(read('src/preload/index.ts')).not.toContain("typedInvoke('turns:resolveGuard'")
    expect(read('src/preload/index.ts')).not.toContain("typedInvoke('agentic:resolveApproval'")
    expect(read('src/renderer/workbench/WorkbenchLayout.tsx')).not.toContain('<ApprovalDialog')
    expect(read('src/renderer/workbench/ThreadView.tsx')).not.toContain('onResolveGuard')
  })
})
```

- [ ] **Step 2: Run Guard and architecture tests and confirm the red state**

Run: `npm.cmd test -- src/main/runtime/decision-adapters/__tests__/guard-decision-adapter.test.ts src/main/__tests__/decision-runtime-architecture.test.ts`

Expected: FAIL because Guard still owns an in-memory waiter map and legacy primary channels/UI remain.

- [ ] **Step 3: Implement the trusted Guard adapter**

```ts
import type { DecisionService } from '../decision-service'
import {
  createGuardDecisionRequest,
  type GuardDecisionInput
} from '../decision-request-factories'

export type GuardDecision = {
  requestId: string
  decision: 'approved' | 'denied' | 'timeout' | 'cancelled'
}

export class GuardDecisionAdapter {
  constructor(private readonly input: { decisionService: DecisionService }) {}

  async request(input: GuardDecisionInput): Promise<GuardDecision> {
    const request = createGuardDecisionRequest({
      owner: input.owner,
      agentId: input.agentId,
      role: input.role,
      risk: input.risk,
      reasons: input.reasons,
      deadlineMs: 300_000
    })
    const resolution = await this.input.decisionService.request(request)
    const decision = resolution.status === 'selected' && resolution.selectedOptionIds?.includes('allow-once')
      ? 'approved'
      : resolution.status === 'timeout'
        ? 'timeout'
        : resolution.status === 'cancelled' || resolution.status === 'stale'
          ? 'cancelled'
          : 'denied'
    return { requestId: request.id, decision }
  }
}
```

- [ ] **Step 4: Replace schedule Guard awaits without changing continuation identity**

Inject `GuardDecisionAdapter` into `runCustomScheduleTurn()`. At both current calls in `schedule-helpers.ts:250-256` and `:285-291`, call the adapter with the existing `input.threadId`, `input.turnId`, Agent, role, verdict level, and reasons. Keep existing approved/warn and denied/block audit events, but add timeout and cancelled messages explicitly. Delete the standalone `pendingGuardApprovals` map, resolver, timer, and shutdown functions with `guard-approval-service.ts`.

- [ ] **Step 5: Remove legacy primary resolution channels and actions**

After tool, ACP, and Guard adapter tests pass:

- Remove `agentic:getPendingApprovalIds`, `agentic:resolveApproval`, and `turns:resolveGuard` from `ipc-contract.ts`, validators, `missing-ipc.ts`, `main/index.ts`, preload, and Renderer typings.
- Remove approval modal state, `createApprovalDecisionHandler`, and `<ApprovalDialog>` from `WorkbenchLayout`; delete `approval-dialog.tsx`.
- Retain `agentic:setApprovalDefault` and `agentic:setApprovalOverride` settings channels.
- Change `approvalEvents.ts` to audit-only parsing/reconciliation without submission callbacks.
- Remove `onResolveGuard` props through `WorkbenchMainContent` and `ThreadView`. In `RoleEvents`, render pending/resolved Guard history as text-only status; no Continue/Stop buttons remain.
- Replace ThreadView’s pending-Guard completion inference with shared Turn status. `awaiting-decision` displays waiting; it never becomes completed because a Guard audit event exists.

- [ ] **Step 6: Run Guard, architecture, Renderer, and contract tests**

Run: `npm.cmd test -- src/main/runtime/decision-adapters/__tests__/guard-decision-adapter.test.ts src/main/runtime/__tests__/guard-decision-adapter.integration.test.ts src/main/__tests__/decision-runtime-architecture.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts src/renderer/workbench/__tests__/approvalEvents.test.ts src/renderer/workbench/__tests__/threadview-status.test.ts`

Expected: PASS; the renamed integration suite exercises the adapter rather than the removed in-memory service.

- [ ] **Step 7: Commit Guard migration and legacy retirement**

```powershell
git add -A -- src/main/runtime/decision-adapters/guard-decision-adapter.ts src/main/runtime/decision-adapters/__tests__/guard-decision-adapter.test.ts src/main/__tests__/decision-runtime-architecture.test.ts src/main/runtime/schedule-helpers.ts src/main/runtime/guard-approval-service.ts src/main/index.ts src/main/ipc/missing-ipc.ts src/shared/ipc-contract.ts src/preload/index.ts src/renderer/vite-env.d.ts src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/WorkbenchMainContent.tsx src/renderer/workbench/ThreadView.tsx src/renderer/workbench/utils/approvalEvents.ts src/renderer/glass/approval-dialog.tsx src/main/runtime/__tests__/guard-approval-service.test.ts src/renderer/workbench/__tests__/approvalEvents.test.ts
git commit -m "feat(decisions): migrate guards and retire legacy approvals"
```

## Task L: Prove same-Turn continuation and run full regression

**Files:**
- Create: `src/main/runtime/e2e-decision-fixture.ts`
- Modify: `src/main/index.ts:92-115,1070-1115`
- Modify: `test/e2e/app.spec.ts:38-63,75-117`
- Test: all files introduced or changed in Tasks A-K

- [ ] **Step 1: Write a failing deterministic Electron E2E scenario**

Parameterize `launchAgentHub()` with extra environment values, then add:

```ts
test('inline decision resumes the same Turn exactly once', async () => {
  test.setTimeout(120_000)
  const { app, page, userDataDir } = await launchAgentHub({ AGENTHUB_E2E_DECISION_FIXTURE: '1' })
  try {
    await dismissAnnouncement(page)
    await expect(page.locator('.wb-decision-bar')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.wb-decision-bar')).toHaveAttribute('role', 'group')
    const turnId = await page.locator('.wb-decision-bar').getAttribute('data-turn-id')
    await page.getByRole('button', { name: 'Focused repair' }).click()
    await expect(page.locator('.wb-decision-bar')).toBeHidden({ timeout: 10_000 })
    await expect(page.getByText('Fixture resumed with focused')).toBeVisible({ timeout: 10_000 })
    expect(await page.locator(`[data-turn-id="${turnId}"]`).count()).toBeGreaterThan(0)
  } finally {
    await closeAgentHub(app)
    await removeUserDataDir(userDataDir)
  }
})
```

Add the restart/rerun scenario using one preserved `userDataDir`:

```ts
test('orphan rerun creates a new Turn and never revives the old permission', async () => {
  test.setTimeout(120_000)
  const seeded = await launchAgentHub({ AGENTHUB_E2E_ORPHAN_DECISION_FIXTURE: 'seed' })
  const userDataDir = seeded.userDataDir
  let oldTurnId = ''
  let oldRequestId = ''
  try {
    await dismissAnnouncement(seeded.page)
    const card = seeded.page.locator('.wb-decision-bar')
    await expect(card).toBeVisible()
    oldTurnId = (await card.getAttribute('data-turn-id'))!
    oldRequestId = (await card.getAttribute('data-decision-id'))!
  } finally {
    await closeAgentHub(seeded.app)
  }

  const recovered = await launchAgentHub({
    AGENTHUB_E2E_ORPHAN_DECISION_FIXTURE: 'recover',
    AGENTHUB_E2E_REUSE_USER_DATA_DIR: userDataDir
  })
  try {
    const stale = recovered.page.getByRole('group', { name: 'Decision interrupted by restart' })
    await expect(stale).toBeVisible()
    await stale.getByRole('button', { name: 'Rerun Turn' }).click()
    const newTurnId = await recovered.page.locator('[data-retry-of-turn-id]').getAttribute('data-turn-id')
    expect(newTurnId).toBeTruthy()
    expect(newTurnId).not.toBe(oldTurnId)
    await expect(recovered.page.locator(`[data-decision-id="${oldRequestId}"]`)).toHaveCount(0)
    await expect(recovered.page.locator('[data-e2e-old-permission-executions]')).toHaveAttribute('data-e2e-old-permission-executions', '0')
  } finally {
    await closeAgentHub(recovered.app)
    await removeUserDataDir(userDataDir)
  }
})
```

The E2E fixture may expose only an environment-gated numeric execution counter. `seed` persists one unresolved synthetic permission without executing it; `recover` lets startup sweep create the stale audit card. The rerun fixture completes only the new retry Turn from its original prompt and increments the counter only if the old permission continuation is incorrectly revived.

- [ ] **Step 2: Build and run the E2E test to confirm the red state**

Run: `npm.cmd run build`

Run: `npm.cmd run test:e2e -- --grep "inline decision resumes"`

Expected: FAIL because the environment-gated fixture does not exist.

- [ ] **Step 3: Add an inert-outside-E2E decision fixture**

```ts
import type { BrowserWindow } from 'electron'
import { createAgentDecisionRequest } from './decision-request-factories'
import type { DecisionService } from './decision-service'
import type { WorkbenchRuntimeStore } from './store'

export function installE2EDecisionFixture(input: {
  window: BrowserWindow
  runtimeStore: WorkbenchRuntimeStore
  decisionService: DecisionService
}): void {
  if (process.env.AGENTHUB_E2E_DECISION_FIXTURE !== '1') return
  const { thread, turn } = input.runtimeStore.createTurn({
    prompt: 'E2E decision fixture',
    mode: 'auto',
    workspaceId: null,
    ownerWebContentsId: input.window.webContents.id
  })
  const request = createAgentDecisionRequest({
    owner: {
      type: 'turn',
      threadId: thread.id,
      turnId: turn.id,
      workspaceId: null,
      webContentsId: input.window.webContents.id
    },
    title: 'Choose fixture scope',
    kind: 'single-select',
    options: [
      { id: 'focused', label: 'Focused repair' },
      { id: 'audit', label: 'Full audit' }
    ],
    idempotencyKey: `e2e:${turn.id}:scope`
  })
  void input.decisionService.request(request).then(async resolution => {
    const selected = resolution.selectedOptionIds?.[0] ?? 'none'
    await input.runtimeStore.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, 'agent:done', 'e2e-fixture', {
        kind: 'done',
        content: `Fixture resumed with ${selected}`
      })
      tx.setTurnStatus(turn.id, 'completed')
    })
  })
}
```

Call this only after the Workbench window is registered and DecisionService orphan recovery has completed. Add `data-turn-id={item.request.owner.type === 'turn' ? item.request.owner.turnId : undefined}` to DecisionBar for deterministic audit linkage; this attribute contains an internal random ID, not user content.

- [ ] **Step 4: Run the E2E scenario green**

Run: `npm.cmd run build`

Run: `npm.cmd run test:e2e -- --grep "inline decision resumes"`

Expected: PASS with one DecisionBar, one selection, one continuation result, and the original Turn ID retained.

- [ ] **Step 5: Run all targeted decision suites together**

Run:

```powershell
npm.cmd test -- src/main/runtime/__tests__/turn-status.test.ts src/main/runtime/__tests__/store.test.ts src/main/runtime/__tests__/decision-request-factories.test.ts src/main/runtime/__tests__/decision-service.test.ts src/main/runtime/__tests__/thread-execution-coordinator.test.ts src/main/ipc/__tests__/decision-ipc.test.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/runtime/decision-adapters/__tests__/tool-decision-adapter.test.ts src/main/runtime/decision-adapters/__tests__/acp-decision-adapter.test.ts src/main/runtime/decision-adapters/__tests__/guard-decision-adapter.test.ts src/renderer/workbench/decisions/__tests__/decisionQueue.test.ts src/renderer/workbench/decisions/__tests__/DecisionBar.test.tsx src/renderer/workbench/__tests__/ComposerBar.sendQueue.test.tsx src/main/__tests__/decision-runtime-architecture.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full repository verification**

Run these commands separately and preserve each output:

```powershell
npm.cmd run typecheck
npm.cmd test -- --reporter=dot
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run build:win
npm.cmd run lint
```

Expected:

- Typecheck, full Vitest, build, Electron E2E, and Windows packaging: PASS.
- Lint: no errors in touched files and no regression beyond the frozen baseline recorded in `TEST_RESULTS_CHATGPT.md`. Do not describe the repository as lint-clean if baseline errors remain.

- [ ] **Step 7: Review security and persistence evidence**

Confirm from test output and final diff:

- wrong-window, wrong-workspace, non-head, duplicate, late, malformed, and expired submissions cannot release continuation;
- persistence failure publishes no decision event and leaves the card retryable;
- request IDs come from `crypto.randomUUID()`;
- generic Agent inputs cannot set privileged fields;
- ACP returns only an option ID present in the original protocol request;
- denial, timeout, cancellation, restart, and shutdown remain fail-closed;
- remember failure does not reopen a decision or execute a tool twice;
- queued submissions survive refresh and are not executed before the true terminal head;
- event history contains no raw candidate payload or unredacted secret preview.

- [ ] **Step 8: Run plan self-review and diff checks**

Map every design requirement in sections 6, 7, 8, 11, 13, 14, 15.1, 15.2, and 15.4 to Tasks A-L. Scan the plan and implementation for unfinished markers or mismatched type/function names. Then run:

```powershell
git diff --check
git status --short
git diff -- src/shared/turn-status.ts src/shared/decision-contract.ts src/main/runtime/decision-service.ts src/main/runtime/thread-execution-coordinator.ts src/renderer/workbench/decisions/DecisionBar.tsx
```

Expected: no whitespace errors; only intended files are staged for the final commit; unrelated dirty files remain untouched and unstaged.

- [ ] **Step 9: Commit integration evidence**

```powershell
git add -- src/main/runtime/e2e-decision-fixture.ts src/main/index.ts test/e2e/app.spec.ts
git commit -m "test(decisions): verify inline same-turn continuation"
```

## Completion criteria

- Every Workbench create/retry submission is durable before acknowledgement and serialized by the main process.
- A Turn may cycle `running -> awaiting-decision -> running` repeatedly without receiving `completedAt` until a true terminal state.
- DecisionService exposes exactly one stable active item per owner queue, starts security deadlines on activation, and releases continuations only after durable resolution publication.
- Refresh uses complete pending-list IPC; runtime history is audit-only.
- Prompt, Agent, tool, ACP, and Guard decisions share the inline DecisionBar; local draft decisions never call main-process resolution IPC.
- Tool, ACP, and Guard denial/timeout/cancellation remain fail-closed.
- The centered ApprovalDialog, in-message Guard action buttons, and their legacy resolution channels are absent from the primary path.
- Targeted tests, typecheck, full Vitest, build, Electron E2E, and Windows packaging pass without touching unrelated worktree changes.
