# Multi-model Loop, Prompt Preparation, and Inline Decisions

**Status:** Approved for implementation

**Date:** 2026-07-10

**Repository:** `E:\Agent\ChatGPT\AgentHub`

## 1. Objective

AgentHub must provide one coherent execution path for four related behaviors:

1. Every top-level input that creates an AI Turn starts exactly one auditable Prompt preparation session; every input that is actually dispatched finalizes exactly one immutable root Prompt envelope.
2. Vague, overly broad, or explicitly requested Prompt optimization can generate multiple model-written candidates and wait for the user to choose one.
3. Any supported Agent, tool, Guard, or router interaction that requires a user decision pauses the current Turn and resumes that same Turn after the user responds.
4. When the user explicitly enables multi-model fusion, 2-3 distinct resolved models collaborate in a bounded generate-synthesize-judge Loop and publish only one final answer.

The user-facing decision surface is the selected **A layout**: vertically stacked choice cards in an inline bar immediately above the Composer input. It replaces centered approval modals and scattered in-message decision buttons as the primary interaction.

## 2. Scope

### 2.1 In scope

- A main-process `DecisionService` with typed requests, per-thread FIFO queues, cancellation, safe timeouts, runtime events, and same-Turn continuation.
- An inline Renderer `DecisionBar` for Prompt candidates, ordinary choices, Agent choices, tool permissions, and Guard approvals.
- An Electron-free Prompt preparation core, a main-process `PromptPreparationService`, one `PromptPreparationSession` per registered root AI ingress, and one immutable `PromptEnvelope` per dispatched root input.
- A per-call `DispatchEnvelope` that proves the canonical provider payload and its lineage to the prepared root Prompt without falsely equating the two hashes.
- Local Prompt clarity analysis, versioned in-memory caches, and model-generated candidates only when needed.
- A structured `request_user_decision` capability for Agents and adapters that can suspend or checkpoint a dispatch.
- A new `MultiModelLoopRunner` that reuses the production `Dispatcher` rather than the unfinished legacy loop modules.
- Page-refresh reconciliation, background-thread badges, accessibility, telemetry, and regression tests.
- Safe migration of current tool and Guard approval flows into the shared decision protocol.
- A main-process `ThreadExecutionCoordinator` that persists and serializes queued submissions so a pending decision cannot be bypassed by another window or direct IPC caller.

### 2.2 Out of scope

- Resuming an in-flight model/tool call after the Electron main process has restarted. JavaScript promises and provider streams cannot be serialized safely; old requests become stale and offer a rerun action.
- Guessing decisions by parsing ordinary Agent prose or Markdown.
- Automatically enabling multi-model fusion for ordinary chat.
- Rewriting external OpenAI-compatible or Anthropic-compatible proxy traffic by default.
- Infinite self-refinement, unbounded model fan-out, or autonomous approval of privileged operations.
- Completing the placeholder implementations in `src/main/loop/agent-loop.ts` or `src/main/loop/multi-model-aggregator.ts`.

## 3. Current-state findings

The production code already contains two independent same-process wait mechanisms:

- Tool approval waits on a resolver in `Dispatcher`, then continues the same HTTP/ACP tool loop.
- Guard approval waits on a resolver in `guard-approval-service.ts`, then continues the same schedule execution.

They are not interchangeable. Tool approval uses a global centered `ApprovalDialog`; Guard actions are embedded in `ThreadView`; both use boolean decisions; and Prompt candidates or ordinary Agent choices have no main-process continuation protocol. Tool approval has stronger event reconciliation, while Guard approval is process-memory only.

Prompt optimization currently covers Workbench create and retry paths, but Hub WebSocket and headless CLI dispatch raw text. The existing optimizer is a synchronous lexical wrapper and cannot request candidates or prove that every actual dispatch used its output.

The legacy Loop classes contain placeholder model and tool calls and are not connected to production dispatch. Extending them would create a second incomplete execution stack.

The worktree also contains substantial existing changes in `src/main/index.ts`, `src/main/hub/dispatcher.ts`, `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `WorkbenchLayout.tsx`, `ComposerBar.tsx`, and approval tests. Implementation must prefer new focused modules and narrow wiring changes.

## 4. Considered approaches

### 4.1 Visual-only replacement

Replace `ApprovalDialog` with an inline component while retaining separate resolvers and protocols.

**Advantage:** Smallest immediate diff.

**Rejected because:** Prompt candidates and ordinary Agent choices would still end a dispatch, queue ordering would remain inconsistent, and two or more sources could display conflicting active decisions.

### 4.2 Unified DecisionService and independent MultiModelLoopRunner — selected

Introduce one typed main-process decision service, source adapters, one Renderer queue, one inline DecisionBar, one Prompt envelope, and a production Dispatcher-based Loop runner.

**Advantages:** Solves same-Turn continuation at the correct boundary, preserves security validation in the main process, supports every requested decision source, and can be introduced incrementally.

**Trade-off:** Requires narrow changes across main, preload/shared IPC, and Renderer layers.

### 4.3 Fully durable workflow engine

Persist every continuation step so an app restart can replay an in-flight task.

**Advantage:** True cross-process recovery.

**Rejected for this release:** It requires converting all provider streams, tools, and schedules into checkpointed state machines and materially expands the project.

## 5. Target architecture

```text
Top-level user input
    -> create Turn with original input
    -> create one PromptPreparationSession
         -> clear: finalize one root PromptEnvelope
         -> vague/broad/explicit optimization:
              generate and validate 2-3 candidates internally
              -> use the entry point's decision channel
              -> selected/custom/original choice
              -> finalize one root PromptEnvelope
    -> persist original Prompt, effective Prompt, and finalized envelope on the Turn
    -> Router receives PromptEnvelope.effectivePrompt
         -> normal mode: Dispatcher
         -> fusion enabled: read-only MultiModelLoopRunner -> optional single Executor
    -> Agent/tool/Guard needs a decision
         -> DecisionService.request()
         -> DecisionBar selection
         -> resume the same Turn/call stack
    -> build one child DispatchEnvelope per provider call
         -> canonical payload hash + root/parent hash lineage
    -> publish one final Turn output
```

### 5.1 Module boundaries

#### Prompt preparation core and PromptPreparationService

The pure core owns policy evaluation, clarity classification, candidate artifact validation, cache keys, and envelope finalization without importing Electron, RuntimeStore, skills, or plugins. The main-process service injects candidate generation, context signatures, decision channels, persistence, and Prompt audit events. This split lets headless CLI reuse the same rules safely.

#### ThreadExecutionCoordinator

Owns main-process admission and durable FIFO execution for each Workbench thread. It persists immutable queued submissions, prevents later Turns from starting while the head Turn is waiting, and drains only after the current Turn reaches a true terminal state.

#### DecisionService

Owns typed validation, active waiters, per-thread FIFO order, expiration, cancellation, resolution, persistence ordering, and continuation delivery. It does not interpret Agent prose or render UI.

#### Decision adapters

Map existing tool approval, Guard approval, ACP options, router choice, Prompt candidates, and Agent `request_user_decision` calls into the common request schema. They convert a typed resolution back into the result expected by the caller.

#### DecisionBar

Renders one stable active decision for the selected thread, its queue count, details, actions, custom input, busy state, and errors. It contains no IPC-specific business logic.

#### Dispatch boundary

Builds a canonical provider payload from the prepared Prompt, history, system instructions, attachments, tools, workspace context, and plugin context. It creates a per-call `DispatchEnvelope`, verifies that payload's own hash, and retains lineage to the root Prompt hash.

#### MultiModelLoopRunner

Selects 2-3 eligible routes with at least two distinct resolved provider/model pairs, runs read-only candidate calls through a cancellable production Dispatcher interface, invokes synthesis and judging, applies bounded revision feedback, handles partial failures, and publishes one final result. It links every internal dispatch to the root Prompt session but never optimizes internal Prompts again.

## 6. Shared decision contract

The shared contract is a discriminated, versioned protocol. Renderer data contains display-safe fields; executable values remain authoritative in the main process.

```ts
type DecisionSource =
  | "prompt-optimizer"
  | "agent"
  | "router"
  | "tool"
  | "guard"
  | "acp"
  | "multi-model-loop"

type DecisionKind =
  | "confirm"
  | "single-select"
  | "multi-select"
  | "text"

type DecisionOwner =
  | {
      type: "turn"
      workspaceId: string | null
      threadId: string
      turnId: string
      webContentsId: number
    }
  | {
      type: "hub"
      sessionId: string
    }

type DecisionState =
  | "queued"
  | "active"
  | "resolving"
  | "terminal"

interface DecisionOption {
  id: string
  label: string
  description?: string
  preview?: string
  tone?: "default" | "safe" | "warning" | "danger"
}

interface DecisionRequest {
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
    risk?: "low" | "medium" | "high" | "critical"
    toolName?: string
    action?: string
    target?: string
    preview?: string
  }
}

interface PendingDecision {
  request: DecisionRequest
  state: DecisionState
  activatedAt?: number
  expiresAt?: number
}

interface DecisionSubmission {
  requestId: string
  outcome: "selected" | "submitted" | "denied" | "cancelled"
  selectedOptionIds?: string[]
  customText?: string
  remember?: boolean
}

interface DecisionResolution {
  requestId: string
  status: "selected" | "submitted" | "denied" | "cancelled" | "timeout" | "stale"
  selectedOptionIds?: string[]
  text?: string
  resolvedAt: number
}
```

`DecisionState` describes queue lifecycle only. The exact terminal outcome is
stored in `DecisionResolution.status`, so durable records do not duplicate or
diverge from their authoritative resolution.

The Renderer submits only request IDs, option IDs, bounded custom text, and the remember flag. The main process looks up the original request, verifies that it is the active head of its owner queue, binds desktop IPC to the trusted sender window/workspace or remote resolution to the authenticated Hub session, validates option membership, cardinality, expiration, text limits, and policy, then maps IDs to the authoritative Prompt/tool/permission value. It never accepts a command, path, Prompt candidate, or permission payload merely because a client sent it back.

Cardinality is authoritative: `confirm` and `single-select` require exactly one selected option; `multi-select` requires a unique selected set within `minSelections..maxSelections`; `text` requires zero selected options and one bounded non-empty custom value. Duplicate option IDs and inconsistent kind/cardinality settings are rejected when a request is created.

Only trusted main-process adapter factories may create privileged `tool`/`guard` sources, risk labels, permission tones, targets, previews, remember behavior, or security deadlines. Agent-origin requests are always neutral, cannot request remembered permission, and cannot impersonate a privileged card. Standard tool permission IDs map only to deny/allow-once; a trusted ACP adapter may preserve a validated protocol-provided option set.

Request IDs use `crypto.randomUUID()`. Agent-origin requests require a stable idempotency key scoped to Agent/step. The service returns the existing waiter/result for a duplicate key rather than appending another card.

Hard limits use the existing turn Prompt ceiling of 512 KiB. Each request may set a smaller limit; ordinary Agent text choices default to 16 KiB, while Prompt custom input may use the turn ceiling. Permission decisions never accept custom text. A Turn may have at most eight unresolved decisions and 32 created decisions; the process may hold at most 64 unresolved decisions. Generic Agent choice tools are further limited to four created requests per Turn and one unresolved request per Agent/step/idempotency key.

## 7. Decision lifecycle and Turn state

### 7.1 Turn states

Add `awaiting-decision` as a non-terminal Turn status and `interrupted` as the terminal recovery status for a lost continuation:

```text
queued -> running -> awaiting-decision -> running -> completed
                    |                   |
                    +-> cancelled       +-> failed/cancelled
                    +-> interrupted (continuation lost on restart)
```

A Turn may enter `awaiting-decision` more than once. A Turn with any unresolved blocking decision cannot emit `completed` or set `completedAt`. It returns to `running` only when that Turn has no queued, active, or resolving blocking decision.

Introduce one shared `isTerminalTurnStatus()` predicate and use it in RuntimeStore, ThreadView, execution queues, retry/cancel logic, task-turn tracking, and all completion-time calculations. Only `completed`, `failed`, `cancelled`, and `interrupted` are terminal. RuntimeStore must clear an erroneous `completedAt` whenever a non-terminal status is restored.

### 7.2 Queue ownership

- Turn-owned queues are isolated by `threadId`; remote queues are isolated by Hub session ID.
- Each owner queue uses strict FIFO by `createdAt` plus request ID as a deterministic tie-breaker.
- The currently visible item is stable and is never replaced by a newer request while the user is reading or acting on it.
- A request moves through `queued -> active -> resolving -> terminal`. Only the active queue head can be submitted.
- Resolving one item terminalizes it, promotes the next queued item immediately, and then releases the resolved continuation. If another blocking item for the Turn remains, the Turn stays `awaiting-decision`.
- Different threads can wait or run independently.
- A source security deadline begins only when its request becomes active, so a permission card cannot expire unseen in the queue.
- A new message submitted in a thread whose active Turn is waiting is persisted as an immutable queued submission by the main process; it does not overwrite the pending Turn or start ahead of it.
- Other threads remain usable.

### 7.3 Thread admission and queued submissions

`ThreadExecutionCoordinator` is the authority for Workbench thread admission. Every create/retry path that targets a Workbench thread, including direct IPC and additional windows, must enqueue through it; the Renderer Composer queue is an optimistic projection rather than the source of truth.

- A submission is persisted before the enqueue call acknowledges success.
- Only the head Turn may run. Later submissions remain `queued` while the head is running or awaiting a decision.
- A denial or timeout resumes the head Turn with a structured result; it does not drain the next submission until the head becomes terminal.
- Cancelling the head Turn preserves later queued messages and drains the next one. A separate explicit clear-queue action is required to discard them.
- Refresh reconstructs queued submissions from main-process state.
- Hub remote sessions use their own admission key and cannot bypass a Workbench thread gate.

### 7.4 Transactional runtime mutation

The current emit-then-save RuntimeStore API is insufficient. Add an awaited, serialized `commitRuntimeMutation()` boundary that applies Turn/task changes and decision ledger events to one cloned snapshot, persists that snapshot atomically, swaps it into memory, and only then publishes events. A failed flush publishes nothing and leaves the prior snapshot active.

Decision requested/resolved records are protected from event compaction while their owner is non-terminal. After terminalization, compaction may retain a tombstone summary. Full candidate text is not duplicated in event history.

### 7.5 Atomic request sequence

1. Validate and normalize the request.
2. Create the waiter and cancellation bindings in a provisional state that is excluded from pending-list IPC.
3. Add the request as `queued`, or `active` if it is the owner queue head. Create its deadline timer only on activation.
4. Use `commitRuntimeMutation()` to persist `decision:requested` and, for a Turn owner, its `awaiting-decision` transition.
5. If persistence fails, remove the provisional waiter/timer/queue entry and reject without exposing a live decision.
6. Mark the committed request visible to pending-list IPC and publish the already-durable event.

### 7.6 Atomic resolution sequence

1. Find the active request and atomically mark it `resolving`; duplicate and late submissions return `false`.
2. Validate the submission against the stored request.
3. Use one runtime mutation to persist `decision:resolved`, promote the next queue item, and set the Turn to `running` only when it has no blocking decision left.
4. On persistence failure, restore the request to `active`, keep the bar visible, and return a retryable error.
5. After the mutation flushes and events publish, remove the old timer/waiter and release the waiting promise exactly once.
6. Start the promoted request's deadline from its activation time.

Cancellation follows the same ordering. Cancelling a Turn cancels all its decisions, timers, provider calls, Loop branches, and continuation work for that Turn, but preserves later user submissions in the thread admission queue. Scoped Agent cancellation affects only matching branches and decisions. A response arriving afterward cannot restart execution.

### 7.7 Timeout policy

- Prompt candidates, ordinary Agent questions, and router choices have no automatic timeout. They wait until selection or explicit Turn cancellation.
- Tool and Guard requests retain source-specific security deadlines. Timeout is a denial, is persisted before continuation, and is returned to the Agent as a structured result so it may choose a safer alternative or explain the stop.
- Graceful app shutdown writes terminal `stale` records before resolving waiters. After a crash or forced restart, startup recovery performs an orphan sweep as described below.

## 8. Runtime events, IPC, and refresh recovery

Add typed runtime events:

- `decision:requested`
- `decision:resolved`
- `prompt:preparation-started`
- `prompt:candidate-attempted`
- `prompt:prepared`
- `prompt:dispatched`
- Multi-model round/candidate/synthesis/judge lifecycle events

Add a narrow IPC surface:

- `turns:listPendingDecisions(threadId?)`
- `turns:resolveDecision(submission)`
- the existing runtime event subscription transports decision events

The preload exposes validated wrappers only. Main-process IPC validation applies string, array, enum, cardinality, ownership, and size limits before invoking the service.

On Renderer refresh, `turns:listPendingDecisions()` is the authoritative source for complete display-safe live cards, including candidate text still held by the main process. Historical events provide audit order and terminal tombstones only; history alone never makes a request clickable.

At main-process startup, an orphan sweep scans durable `decision:requested` records without terminal tombstones. It commits `decision:resolved(stale)` and changes an affected Turn from `awaiting-decision` to `interrupted`. The stale timeline item contains only an audit-safe summary and a **rerun Turn** action. Rerun creates a new retry Turn from the original user request; it never executes an old command or permission directly.

## 9. Prompt preparation

### 9.1 Preparation sessions, root envelopes, and dispatch envelopes

```ts
type PromptPolicy = "optimize" | "structured" | "passthrough" | "internal"

type PromptPreparationState =
  | "analyzing"
  | "awaiting-decision"
  | "finalized"
  | "cancelled"
  | "failed"

interface PromptPreparationSession {
  sessionId: string
  rootInputId: string
  origin: string
  policy: PromptPolicy
  state: PromptPreparationState
  inputHash: string
  preparationCount: 1
  optimizationCount: 0 | 1
  candidateAttemptCount: number
  retryOfEnvelopeId?: string
}

interface PromptEnvelope {
  envelopeId: string
  sessionId: string
  rootInputId: string
  displayOriginalPrompt: string
  effectivePrompt: string
  origin: string
  policy: PromptPolicy
  status:
    | "optimized"
    | "unchanged"
    | "candidate-selected"
    | "custom-selected"
    | "reused-selection"
    | "structured"
    | "passthrough"
  optimizerVersion: string
  inputHash: string
  preparedTextHash: string
  optimizationCount: 0 | 1
  finalizedAt: number
}

interface DispatchEnvelope {
  dispatchId: string
  rootInputId?: string
  rootEnvelopeId?: string
  rootPreparedTextHash?: string
  parentDispatchId?: string
  providerId: string
  modelId: string
  policy: PromptPolicy
  canonicalPayloadHash: string
  optimizationCount: 0
}
```

Every registered root AI ingress creates exactly one `PromptPreparationSession` immediately. `preparationCount` is always 1; `optimizationCount` is 1 when the root `optimize` policy executes even if it preserves text, and 0 for structured/passthrough/internal work. A cancelled or failed session remains auditable but does not fabricate a finalized envelope. If dispatch proceeds, the session finalizes exactly one immutable `PromptEnvelope` and emits `prompt:prepared` once.

The Turn persists the original display Prompt, selected `effectivePrompt`, and finalized envelope. The UI displays the original text; Router and subsequent model history use the effective text. Each provider call then receives its own `DispatchEnvelope`, because system messages, history, attachments, tools, workspace/plugin context, and internal role instructions make the canonical provider payload different from the root Prompt text.

### 9.2 Entry funnels and interaction capability

`QuickComplete` and `Dispatcher` are transports, not origins. A typed `PromptIngressRegistry` maps every caller to an origin, policy, and decision capability; an unregistered direct AI call fails a contract test.

| Funnel and aliases | Policy | Decision capability |
| --- | --- | --- |
| Workbench `turns:create`: Composer, Side Conversation, Requirements/Write/Todo send-to-chat, and slash/ECC/plugin commands that dispatch an Agent | `optimize` | desktop inline DecisionBar |
| Workbench `turns:retry` | one new session that reuses the prior user selection without re-optimizing it; explicit re-optimize starts a new candidate attempt | desktop inline DecisionBar |
| SDD assistant/plan/verify, Browser assistant/action, Inline Edit, and other domain-built QuickComplete callers | `structured` | no generic ambiguity prompt |
| Manual Composer PromptEnhancer | draft-local preparation, not a Turn root | local DecisionBar item bound to draft revision/hash |
| Hub WebSocket AI dispatch | `optimize` | advertised WebSocket decision request/resolve protocol |
| Headless CLI AI run | `optimize` through the Electron-free core | terminal picker for TTY; structured `decision_required` result for non-TTY |
| OpenAI/Anthropic external proxy | no root preparation session; canonical passthrough `DispatchEnvelope` only | client owns interaction |
| Schedule child, Loop candidate, Synthesizer, Judge, final Executor instruction | `internal` with root lineage | inherit the root decision context; count 0 |
| Deterministic goal/git/terminal and other non-AI commands | outside the AI Prompt pipeline | not applicable |

SDD/Requirements content explicitly sent to Chat enters through `turns:create` and therefore uses `optimize`; only the domain assistant calls that directly execute their already-structured Prompt use `structured`.

For Hub WebSocket, a client that does not advertise the decision protocol receives a structured `decision_required` response and no Agent dispatch. A non-interactive CLI similarly prints a bounded JSON result and exits before dispatch instead of waiting forever for a desktop bar. Neither fallback claims same-Turn desktop continuation.

Internal calls create child `DispatchEnvelope` records with `optimizationCount: 0`; they do not create another root preparation session. External proxy requests are audited by canonical payload hash but are intentionally outside the root-Prompt exactly-once guarantee.

### 9.3 Clarity analysis

The session first emits `prompt:preparation-started`. The local analyzer returns `clear`, `ambiguous`, `broad`, or `explicit-optimization`. It uses Unicode-aware tokenization and structured signals rather than naive substring matches. Signals include missing objective, missing output form, unresolved references, conflicting intents, unbounded scope, and explicit optimization language.

The analyzer must not force a candidate choice merely because a Prompt is short. Clear short commands remain unchanged. Structured product surfaces bypass the generic wrapper because they already provide domain instructions.

### 9.4 Model candidate generation

An internal low-latency, no-tools model call is made only when:

- the analyzer classifies the input as ambiguous or broad; or
- the user explicitly asks for Prompt optimization.

The initial candidate attempt is made at most once per preparation session. A user may explicitly request another attempt after a failure; that increments `candidateAttemptCount` and emits `prompt:candidate-attempted`, but it does not create another root session or increment root `optimizationCount`.

The generator must return a versioned JSON schema containing 2-3 bounded candidates. A main-process validator rejects the entire attempt unless at least two candidates are non-empty, structurally valid, normalized-distinct, within the turn Prompt limit, and faithful to the original objective and explicit constraints. Protected literals such as paths, quoted values, negations, requested output forms, and safety constraints must be preserved. A candidate may not introduce permissions, destructive actions, external side effects, or new factual assumptions absent from the source. Invalid or partially valid attempts are not shown or cached.

The DecisionBar adds authoritative **keep original** and **other/custom** choices outside the model response. Candidate generation is marked `internal`, so it cannot recursively trigger Prompt preparation.

If candidate generation fails, the same DecisionBar offers **retry optimization**, **continue with original**, and **other/custom**. The Turn remains alive.

### 9.5 Caching and efficiency

- A bounded 512-entry in-memory LRU caches validated deterministic artifacts for the process lifetime.
- Cache keys are SHA-256 over canonical JSON containing raw input hash, optimizer/generator/template/schema versions, policy, origin, interaction policy, locale, workspace/context signature, skill/plugin signature, attachment signature when attachments participate, and candidate provider/model configuration.
- Model candidate sets use a separate 30-minute, 128-entry in-memory LRU with the same complete key inputs.
- Raw Prompts and candidates are not written to a new disk cache.
- Cache values contain only validated pure analysis artifacts or candidate strings. They never contain root/session/request/option IDs, owners, Turn IDs, draft revisions/hashes, timestamps, or resolver state.
- Every cache hit creates fresh cryptographically random request and option IDs bound to the current owner or draft.
- Failed, incomplete, duplicate, or unvalidated candidate results are never cached; retry is never blocked by a negative cache entry.
- Cache hits still participate in the current preparation session and produce a fresh finalized envelope and audit event if dispatch proceeds.
- Version or context signature changes invalidate prior entries automatically.

### 9.6 Turn persistence and retry

When a session finalizes, the Turn stores `displayOriginalPrompt`, `effectivePrompt`, and the serialized root envelope. Chat rendering uses the display original; construction of later provider history uses the effective Prompt so an answer is never paired with the vague pre-optimization text.

Retry always creates one new preparation session from the prior Turn's original input plus an explicit reference to the prior finalized envelope. By default it executes the root `optimize` policy once (`preparationCount: 1`, `optimizationCount: 1`), preserves the user's prior selected/custom effective Prompt with status `reused-selection`, and does not feed that effective Prompt through another rewriting pass or show the same choice again. Only an explicit **re-optimize Prompt** action starts a new candidate attempt from the original input. If the prior Turn never finalized an envelope, retry starts normally from the original input.

### 9.7 Dispatch proof

`prompt:prepared` is emitted once after final selection and records session ID, origin, policy, status, optimizer version, SHA-256 input/prepared-text hashes, cache status, candidate attempt count, and optimization count.

Before each provider call, the dispatch boundary constructs canonical JSON from the resolved provider/model, ordered system/messages content, attachments, tool schema, and allowed context layers, then records its SHA-256 as `DispatchEnvelope.canonicalPayloadHash`. The envelope also records the root envelope ID and prepared-text hash, or the parent dispatch ID for internal calls. The boundary hashes the exact canonical payload again immediately before send and fails closed on a mismatch.

This hash lineage proves that one prepared root Prompt fed the request while acknowledging that the actual provider payload legitimately contains more context. Child candidate/Synthesizer/Judge/Executor calls have their own payload hashes and `optimizationCount: 0`; they never pretend that a different internal Prompt equals the root prepared-text hash.

## 10. Agent-requested decisions

Agents must use a structured `request_user_decision` capability instead of emitting prose that the application attempts to interpret.

The capability accepts a title, description, 1-8 neutral options, single/multi-selection mode, optional bounded custom input, and a required stable idempotency key. It cannot set source, risk, privileged tone, tool/action/target fields, remember behavior, or deadlines. The executor validates it, applies per-Turn limits, calls the neutral Agent adapter for `DecisionService.request()`, and returns a structured result to the same Agent execution.

Transport behavior:

- HTTP agentic tool loops await the decision and continue the existing tool loop.
- ACP permission options are preserved as option IDs; AgentHub no longer automatically chooses the first allow/deny option for the user.
- Structured stdio/stream adapters may emit a protocol-level `decision_request` event. The outer Dispatcher keeps the Turn pending and resumes the session when supported.
- If an adapter cannot keep a live session but supports structured checkpoints, Dispatcher re-dispatches the same Agent within the same Turn using the decision result and prior run context.
- Plain-text-only adapters do not gain decision support by prose parsing. They are instructed to make a best-effort result or state the limitation.

Plugin pre-dispatch hooks that require approval run only after a Turn/remote owner exists and adapt through a trusted main-process factory. They no longer convert a request for approval directly into a denial when an interactive channel is available.

## 11. DecisionBar user experience

### 11.1 Placement

`DecisionBar` renders inside `.wb-composer`, immediately before `.wb-composer-input-layer`, so it is visually anchored above the input. `WorkbenchLayout` owns runtime decisions and passes the active-thread projection through `WorkbenchMainContent` to `ComposerBar`.

Manual Prompt enhancement occurs before a Turn exists and is therefore not a main-process `DecisionRequest`. Its Renderer adapter creates a local `DraftDecisionItem` with `threadId`, `draftRevision`, and `draftHash`, and feeds the same presentation reducer. It never calls `turns:resolveDecision`, never changes Turn state, and cannot be styled as a privileged card. Sending the selected draft later creates the normal single root preparation session.

When Chat is not the visible screen, `PersistentComposer` remains hidden. A compact global status notice shows the number of pending decisions and returns the user to the relevant Chat thread. Background threads also show sidebar badges.

### 11.2 A layout

```text
+--------------------------------------------------+
| A decision is required                      1 / 3 |
| This request is broad. Choose the intended scope. |
|                                                  |
| + Candidate 1: focused repair -----------------+ |
| + Candidate 2: full audit in stages -----------+ |
| + Candidate 3: analysis and plan only ---------+ |
| [Other / custom text..........................] |
|                                      [Confirm]   |
+--------------------------------------------------+
+-------------------- Composer --------------------+
```

### 11.3 Interaction rules

- One active card is shown for the selected thread; the count indicates queued items.
- Clicking a single-select candidate submits it directly. Custom input requires an explicit confirmation.
- Permission cards show source thread, Agent, risk, action, target, and a redacted/truncated preview. Actions are **Deny**, **Allow once**, and optional **Remember this choice**.
- Busy state disables all actions for that request. The card is removed only after a successful authoritative main-process acknowledgement.
- Retryable errors remain in place with the user's custom text and remember state preserved.
- The Composer remains editable. Sending another message persists an immutable submission through `ThreadExecutionCoordinator`; it never overwrites a waiting Turn or starts before it.
- A send-time Prompt candidate resolves the already-created Turn and does not replace the user's current Composer draft.
- Manual Prompt enhancement candidates carry `draftRevision` and `draftHash`; a late result cannot overwrite a changed draft and instead offers regenerate/view options.
- Old `ApprovalDialog` and in-message Guard buttons leave the primary path. Timeline cards retain read-only pending/resolved audit states.

### 11.4 Accessibility

- The bar is an inline `<section>`/`role="group"`, not an `aria-modal` dialog, and has no focus trap.
- New decisions do not steal focus from the Composer. A debounced live region announces the request and queue count; security-sensitive requests may use assertive announcement.
- `Escape` only collapses expanded details and never denies or submits a decision.
- Permission action order is **Deny** then **Allow once**; the safe action is first when the user explicitly enters the bar.
- Resolution moves focus to the next decision when one exists, otherwise back to the Composer.
- Errors use `role="alert"` and `aria-describedby`; busy state uses `aria-busy`.
- Controls are at least 32 CSS pixels in the implementation, have visible focus states, do not rely on color alone, and wrap on narrow screens.
- Command/preview blocks are height-limited and vertically scrollable; the main bar never requires horizontal page scrolling.

## 12. Multi-model fusion Loop

### 12.1 Trigger and topology

The Loop runs only when the user explicitly enables multi-model fusion for the Turn or through an explicit persisted setting. Ordinary chat retains current routing, latency, and cost.

Each round:

1. Router resolves candidate routes to concrete `{providerId, modelId}` pairs and deduplicates them.
2. It selects 2-3 healthy routes containing at least two distinct models. If fewer than two distinct models are available, execution degrades explicitly to multi-Agent/single-model or ordinary routing and must not display a multi-model-fusion claim.
3. Candidate Agents receive the same effective root Prompt in independent derived session keys and run with a read-only, no-side-effects capability profile.
4. A read-only Synthesizer produces one revision, preserving material disagreements and evidence.
5. An independent read-only Judge returns a validated schema: `{ verdict, score, revisionId, feedback, unresolved }`, where verdict is `PASS` or `REVISE` and score is an integer 0-100.
6. `PASS` accepts that revision. `REVISE` starts the next round with Judge feedback as internal context.

There are at most three rounds. Judge and Synthesizer use a distinct provider/model from candidate generation where available; otherwise they use separate session keys and role instructions. Candidate, Synthesizer, and Judge calls may read workspace context but cannot write files, execute mutating commands, or perform other external side effects.

### 12.2 Production execution path

`MultiModelLoopRunner` calls the production Dispatcher through a new cancellable branch interface rather than the current fire-and-wait shape:

```ts
interface DispatchHandle<T> {
  taskId: string
  result: Promise<T>
  cancel(reason: string): Promise<void>
}

startDispatch(input, {
  parentRunId,
  branchId,
  sessionKey,
  signal,
  deadline,
  budgetReservationId,
  visibility: "run",
  capabilityMode: "read-only"
}): DispatchHandle<DispatchResult>
```

This interface is required for reliable per-branch timeout, global cancellation, child registration, and budget release. It preserves provider configuration, safe read tools, usage tracking, and runtime events without calling placeholder legacy Loop methods.

Every child call creates its own `DispatchEnvelope`, shares the root input/envelope lineage, and has `optimizationCount: 0`. All candidate/Synthesizer/Judge stream events are forced to `visibility: "run"`. Only the outer Runner may set the Turn terminal state or emit one synthetic final event with `visibility: "chat"` and `gatedRelease: true`.

If the accepted result requires workspace changes or another side effect, the Runner invokes exactly one designated final Executor sequentially with the accepted synthesis, normal tool policy, and normal user approvals. Parallel fusion roles never mutate the shared workspace. Response-only tasks skip the Executor and release the accepted synthesis directly.

### 12.3 Failure and stopping rules

- Two or more successful distinct-model candidates: synthesize the successful set and record failed branches.
- One successful candidate: degrade to a single-model answer and disclose the degradation in execution metadata; do not claim fusion.
- Zero successful candidates: fail the Turn with a concise combined error.
- A branch timeout cancels only that branch unless the global deadline is reached.
- An unparseable or ambiguous Judge result is fail-closed as `REVISE` with score 0.
- After round three without `PASS`, select the valid revision with the highest Judge score; ties choose the later round and then the lexical revision ID. If no Judge result is valid, use the final-round synthesis and label it unverified. Unresolved items are included explicitly.
- A user cancellation aborts candidates, Synthesizer, Judge, pending tool calls, and decisions.
- The final answer is appended once; intermediate candidates, Judge JSON, private chain-of-thought, and final-Executor internal streams are not published as assistant answers.
- If the Loop genuinely needs user arbitration, it creates a typed decision through `DecisionService` and resumes the same outer Loop after selection.

### 12.4 Budget controls

- Candidate fan-out is capped at three.
- Revision rounds are capped at three.
- Candidate, synthesis, and Judge calls receive per-call timeouts under one Turn deadline.
- Before each fan-out, the Runner atomically reserves the round's aggregate token/cost budget. Branches cannot independently pass a stale remaining-budget check. Unused reservations are released on completion or cancellation.
- If the first-round reservation fails but one ordinary model call still fits, the Runner degrades to ordinary single-model dispatch and reports that fusion was skipped; if even that call does not fit, the Turn fails before dispatch. If a later-round reservation fails, the Runner stops and releases the highest-scored valid revision already produced with a budget-limited marker.
- A successful Judge `PASS` stops immediately.
- Existing usage accounting records every child call while the UI presents the aggregate Turn cost.

## 13. Security and privacy

- Main-process validation is authoritative for all decisions.
- Request IDs are cryptographically random; resolution verifies the active queue head and binds the calling `webContents` to the owning window/workspace.
- Generic Agent requests cannot set privileged source, risk, tone, permission options, target, preview, remember, or deadline fields; only trusted adapters can.
- Renderer-provided HTML is never rendered. Labels, descriptions, custom text, commands, and previews are escaped as text.
- Permission previews are redacted and length-bounded before crossing IPC; environment secrets and full hidden context are excluded.
- A `remember` choice is accepted only for sources and policies that explicitly allow persistence. The allow/deny resolution is committed once before continuation; if saving the remembered policy later fails, the original one-time decision remains terminal and the UI shows a warning. It never returns the request to pending or risks re-executing a tool.
- Denial, timeout, cancellation, duplicate submission, stale request, and persistence failure are fail-closed.
- No new on-disk Prompt cache is introduced.
- Runtime events store audit-safe metadata and hashes; raw Prompt retention follows the existing Turn storage policy rather than duplicating content in telemetry. Live cards obtain candidate/permission display data from the authoritative in-memory pending-list IPC, not event history.

## 14. Error handling

| Condition | Required behavior |
| --- | --- |
| Decision request validation fails | Do not expose a card; fail caller with typed error |
| Request event persistence fails | Roll back waiter/timer; no continuation leak |
| Resolution persistence fails | Keep card pending and retryable; do not resume |
| Remember-policy persistence fails after resolution | Keep the one-time decision terminal; show a warning and do not repeat execution |
| Duplicate or late resolution | Return `false`; do not run continuation |
| Turn cancelled while waiting | Persist cancellation, clear all waiters/timers, ignore later responses |
| Renderer refresh | Reload complete live cards from pending-list IPC and use history only for audit order/tombstones |
| Main process restarted | Startup sweep writes stale tombstone, marks old Turn interrupted, and offers a new retry Turn; never execute the old permission |
| Prompt candidate model fails | Offer retry, original, and custom paths |
| Canonical provider payload hash differs from its DispatchEnvelope | Fail closed before provider call; do not compare the expanded payload to the root prepared-text hash |
| One Loop branch fails | Continue if policy permits; record branch failure |
| Judge is malformed | Treat as `REVISE` |
| Permission expires | Structured denial to Agent; allow a safe alternative/explanation |
| Thread has a waiting Turn and receives another submission | Persist it in the main admission queue and run it only after the head Turn is terminal |
| Fusion budget reservation fails | Before round one, degrade only if one ordinary call fits, otherwise fail; after a completed round, release the highest valid existing revision with a budget-limited marker |

## 15. Testing strategy

Implementation follows red–green–refactor, with new modules tested before production wiring.

### 15.1 DecisionService unit tests

- Request sets Turn to `awaiting-decision` and cannot complete while pending.
- `isTerminalTurnStatus()` treats `awaiting-decision` as non-terminal, does not set `completedAt`, and clears stale completion times on recovery.
- Resolution returns a Turn to `running` only when no queued/active/resolving blocking decision for that Turn remains.
- Continuation runs once and retains the original `turnId`.
- Multiple decisions in one thread transition queued/active/resolving/terminal in strict FIFO with a stable active item; only the active head is submittable.
- A queued security deadline starts on activation rather than request creation.
- Different threads are isolated.
- Duplicate, invalid, expired, and late submissions do not resume work.
- Cancellation and timeout clear timers and waiters and commit terminal events before continuation.
- Transactional persistence failure publishes nothing and rolls back without map, timer, event, or continuation leaks.
- Graceful shutdown marks active requests stale/cancelled; crash recovery sweeps orphans, marks Turns interrupted, and creates no live waiter.
- Agent idempotency and per-Turn/process request limits prevent duplicate or unbounded queues.
- Privileged fields can be created only through trusted adapters, and resolution rejects the wrong sender window/workspace.

### 15.2 ThreadExecutionCoordinator tests

- A submission is durable before enqueue acknowledgement.
- Direct IPC and a second window cannot start a later Turn ahead of a waiting head Turn.
- Denial/timeout resumes the head Turn and drains only after it is terminal.
- Cancelling the head preserves and then drains later queued user messages; explicit clear removes them.
- Refresh reconstructs immutable queued submissions from main-process state.

### 15.3 Prompt preparation tests

- Every registered root AI ingress creates one preparation session; only a dispatched root input finalizes one immutable root envelope.
- Cancelled/failed candidate sessions remain auditable without fabricating an envelope.
- Workbench Chat aliases funnel through create; every structured QuickComplete caller is registered by origin; direct unregistered dispatch fails a contract test.
- Structured and passthrough origins never receive the generic wrapper.
- Internal Loop/Schedule/Synthesizer/Judge/Executor prompts retain root lineage, create their own dispatch hashes, and remain count 0.
- Retry uses original input plus the prior selected envelope, preserves the effective selection without compounding, and only reopens candidates on explicit re-optimize.
- Chinese and English clarity cases avoid substring false positives.
- Clear short Prompts do not trigger a model call.
- Ambiguous, broad, and explicit sessions make one initial candidate attempt; explicit retry increments only candidate attempt count.
- Candidate generation has no tools; schema, count, uniqueness, bounds, protected literals, constraints, and no-new-privilege rules are enforced before display/cache.
- Cache keys include every output-affecting version/context/model/attachment input; cached values contain no owner/request state and hits create fresh IDs.
- Workbench uses DecisionBar, Hub uses its advertised protocol, TTY CLI uses a terminal picker, and non-TTY/unsupported clients return `decision_required` without dispatch.
- Turn history stores original plus effective Prompt and uses effective text for later model context.
- Root prepared-text hash and each canonical DispatchEnvelope payload hash are both verified with correct parent lineage; they are not incorrectly required to be equal.

### 15.4 Decision adapters and IPC tests

- Existing tool allow/deny semantics map correctly and remember policy is preserved.
- ACP option IDs are preserved rather than auto-selected.
- Guard continuation, denial, timeout, and cancellation use the unified service.
- `request_user_decision` returns the exact validated structured choice to the Agent.
- Custom text limits, kind-specific min/max cardinality, duplicate IDs, active-head ownership, sender scope, and malformed payloads are rejected.
- Plugin-required approval waits when an interactive channel exists.
- Remember persistence failure warns without reopening a terminal decision or executing a tool twice.

### 15.5 MultiModelLoopRunner tests

- Resolves and deduplicates provider/model routes; it never labels same-model multi-Agent work as multi-model fusion.
- Runs 2-3 read-only candidates with unique session keys and at most three rounds.
- Candidate/Synthesizer/Judge roles cannot write or execute mutating tools; at most one final Executor receives normal side-effect capability.
- Synthesizes two or more successes and publishes one final answer.
- `PASS` stops immediately; `REVISE` carries feedback to the next internal round.
- Malformed Judge output revises with score 0; round-three selection follows score, later-round, and revision-ID tie-break rules.
- One success degrades honestly; zero successes fails clearly.
- Dispatch handles support per-branch cancel, total deadline, parent/branch IDs, and result collection.
- Fan-out uses an atomic aggregate budget reservation and releases unused capacity.
- All child events are `visibility: run`; only one outer `visibility: chat`, `gatedRelease` event terminalizes the Turn.
- Child dispatches have `optimizationCount: 0`, distinct payload hashes, and the same root lineage.

### 15.6 Renderer tests

- A-layout cards render immediately above the Composer input.
- Per-thread FIFO, stable active request, queue count, deduplication, and background badges are correct.
- Busy/error state is per request; only authoritative success removes it.
- Custom input and remember state survive retryable errors.
- Page refresh renders complete live cards from authoritative pending-list IPC; event history supplies order/tombstones only.
- Startup orphans show an audit-safe stale/rerun item without lost candidate text and do not revive.
- Manual Prompt candidate results with an obsolete draft hash cannot overwrite new text.
- Manual draft items are Renderer-local, neutral, and never call runtime decision resolution or change Turn state.
- A send-time candidate modifies the pending Turn, not the current draft or send queue.
- Composer submission FIFO, owner changes, Stop, and hidden `PersistentComposer` behavior do not regress.
- New requests do not steal focus; Escape does not decide; live announcements, Tab order, focus return, narrow reflow, and alert associations pass accessibility tests.

### 15.7 Integration and E2E tests

- Send vague Prompt -> candidate DecisionBar -> choose option -> same Turn resumes -> one final answer.
- Agent requests a structured choice -> same Turn resumes after selection without a new user message.
- Tool and Guard approvals appear above the input and resume their original operations.
- Decisions in a background thread never appear as the active card in another thread.
- Page refresh during a wait preserves the usable bar when the main process still holds the continuation.
- App restart sweep turns an orphan into an interrupted old Turn; rerun creates a new retry Turn and never executes an old command.
- A later message submitted while waiting is durable, does not start early, and drains after the head Turn is terminal.
- Hub/CLI unsupported decision channels return structured `decision_required` instead of hanging.
- Fusion toggle off follows the ordinary Dispatcher; toggle on performs bounded, distinct-model, read-only fusion and at most one side-effecting final execution.

### 15.8 Regression commands

Run targeted tests during each phase, followed by:

```text
npm run typecheck
npm test -- --reporter=dot
npm run build
npm run test:e2e
```

Existing baseline failures must be distinguished from new regressions. No unrelated dirty worktree changes may be staged, reverted, or reformatted.

## 16. Implementation boundaries and migration order

The implementation plan should split work into independently verifiable phases:

1. **Runtime invariants:** add terminal-status helpers, transactional runtime mutation, protected decision ledger records, and crash orphan sweep tests.
2. **Contracts and DecisionService:** add shared types, trusted source factories, queues/state machine, IPC validation/sender binding, limits, and red tests.
3. **Thread admission:** add main-process durable queued submissions and make every Workbench thread create/retry ingress use the coordinator.
4. **DecisionBar:** add `workbench/decisions` modules, inline UI, authoritative pending-list reconciliation, local draft items, badges, and accessibility tests.
5. **Approval migration:** adapt Dispatcher tool/ACP approvals and Guard approvals while preserving existing reconciliation, remember warnings, and safety behavior; retire modal/in-message primary actions.
6. **Prompt preparation:** add the pure core, session/root/dispatch envelopes, ingress registry, clarity/cache/candidate validation, Turn history semantics, and every optimize/structured/passthrough/remote funnel.
7. **Agent decisions:** add structured Agent capability, idempotency/limits, and supported transport adapters.
8. **Multi-model Loop:** add the cancellable Dispatcher branch API, read-only runner, distinct-model resolution, atomic budget reservation, visibility gate, optional single Executor, settings/toggle wiring, and round events.
9. **Full verification:** targeted, full regression, E2E, accessibility, and dirty-diff review.

Prefer new files such as:

- `src/main/runtime/decision-service.ts`
- `src/main/runtime/thread-execution-coordinator.ts`
- `src/prompt-core/prompt-preparation-core.ts`
- `src/main/runtime/prompt-preparation-service.ts`
- `src/main/runtime/prompt-ingress-registry.ts`
- `src/main/runtime/dispatch-envelope.ts`
- `src/main/runtime/multi-model-loop.ts`
- `src/main/runtime/turn-status.ts`
- `src/shared/decision-contract.ts`
- `src/renderer/workbench/decisions/DecisionBar.tsx`
- `src/renderer/workbench/decisions/decisionQueue.ts`
- `src/renderer/workbench/decisions/decisionAdapters.ts`

Use the narrowest possible edits in high-overlap files. Do not rewrite the current Composer submission worker or approval reconciliation logic; adapt and preserve their tested semantics.

## 17. Acceptance criteria

The feature is complete only when all of the following are demonstrated:

1. Every registered root AI ingress starts exactly one auditable preparation session; every dispatched root input finalizes exactly one immutable Prompt envelope, while cancelled/failed sessions do not fabricate one.
2. The root prepared text and every canonical provider payload have separate verified SHA-256 hashes connected by explicit lineage; expanded provider payloads are never falsely compared to the root text hash.
3. Vague/broad/explicit optimization produces multiple choices plus original/custom paths.
4. In the desktop Workbench, Prompt, Agent, tool, and Guard decisions all use the inline A-layout bar above the input; remote/CLI entries use their declared structured channels and never wait for an unavailable bar.
5. A selection resumes the original Turn without creating another user Turn or requiring another message.
6. Decisions are strict FIFO per owner, isolated across threads/sessions, transactionally persisted before publication/resume, and safe against duplicate/late/wrong-window responses.
7. Tool and Guard denials/timeouts remain fail-closed.
8. Page refresh recovers live requests from authoritative main-process data; restart sweeps orphaned requests into stale/interrupted state and never pretends to recover an absent continuation.
9. Fusion runs only when explicitly enabled, uses 2-3 read-only branches with at least two distinct resolved models, stops within three rounds, permits at most one final side-effecting Executor, and publishes one final answer.
10. A waiting Turn cannot be bypassed by another window or direct IPC submission; later messages remain durable and drain only after the head Turn is terminal.
11. Targeted tests, typecheck, full tests, build, E2E, accessibility checks, and dirty-diff inspection show no new regression.
