# Prompt Preparation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auditable Prompt preparation pipeline in which every registered top-level AI ingress starts exactly one preparation session, every dispatched root input finalizes exactly one immutable Prompt envelope, retries never compound rewrites, and every real model call carries a separately verified canonical payload hash.

**Architecture:** Keep contracts in src/shared, deterministic and Electron-free behavior in src/prompt-core, and process-owned IDs, caches, candidate generation, persistence, and audit emission in src/main/runtime. A typed ingress registry is the allow-list for every root, structured, passthrough, and internal call. Root prepared-text hashes and per-call payload hashes remain distinct and are linked through explicit lineage.

**Tech Stack:** TypeScript 5.6, Node.js 24 crypto, Electron main process, Vitest 4, existing ProviderClient/Dispatcher/Workbench runtime store, and the approved DecisionService decision port.

---

## Scope, prerequisites, and invariants

This is the Prompt-preparation sub-project from
docs/superpowers/specs/2026-07-10-multi-model-loop-prompt-decisions-design.md,
sections 9, 15.3, and 17.1-17.2. Execute the Decision Runtime plan through
Tasks A-H first: the shared contract, DecisionService, sender-scoped resolution,
durable ThreadExecutionCoordinator, pre-created queued Turn,
workbench-turn-runner.ts, and DecisionBar must already exist. This ordering is
required because Prompt candidate decisions need a real DecisionOwner whose
new Turn already exists. If those prerequisites have not landed, stop at the
tested PromptDecisionPort boundary in Task 4; do not auto-select a candidate or
silently fall back to the original Prompt.

Preserve the current dirty worktree. In particular, use narrow patches in:

- src/main/runtime/workbench-turn-runner.ts from Decision Runtime Task F
- src/main/ipc/turns-ipc.ts from Decision Runtime Task F
- src/main/index.ts:527-547 for Hub composition only
- src/main/hub/dispatcher.ts:202-220, 341-510, 874-914, 1006-1121, 1465-1479, and 1637-1655
- src/main/ipc/missing-ipc.ts:233-279
- src/shared/ipc-contract.ts:321-334, 533-594, 3549-3551, 4590-4602, and 6715-6717

The implementation must preserve these invariants:

1. A registered root ingress creates one PromptPreparationSession immediately.
2. A cancelled or unrecoverably failed session emits an audit terminal state and never fabricates a PromptEnvelope. Candidate-generation failure is recoverable: it keeps the same session and Turn awaiting a retry/original/custom decision.
3. A dispatched root input finalizes one immutable PromptEnvelope and emits prompt:prepared once.
4. optimize policy executes once per root session, including unchanged and reused-selection results.
5. structured, passthrough, and internal policies have optimizationCount 0.
6. Retry starts from displayOriginalPrompt and defaults to reusing the prior effective selection; explicit re-optimize starts candidates from the original text in the new retry session and never sends the old effectivePrompt through the optimizer.
7. Each actual provider, stdio, or ACP call owns a separate DispatchEnvelope.
8. preparedTextHash hashes only the finalized effective Prompt. canonicalPayloadHash hashes the exact canonical payload sent at that call boundary. They are not expected to match.
9. Cache values contain only pure artifacts or candidate strings. IDs, Turn owners, timestamps, and resolver state are never cached.
10. An unknown origin or a model call without a verified dispatch envelope fails closed.
11. Candidate retry increments only candidateAttemptCount, uses an attempt-scoped idempotency key, and never creates another PromptPreparationSession or Turn.
12. Workbench Prompt preparation updates the Turn already created by ThreadExecutionCoordinator; it never calls createTurn.

## Planned file map

Create:

- src/main/runtime/prompt-decision-port.ts — Workbench and Hub DecisionService adapters plus capability/origin port routing.
- src/main/runtime/prompt-preparation-composition.ts — production construction of the service, candidate generator, audit sink, and decision-port router.
- src/main/runtime/prompt-cache-context.ts — deterministic Workbench, Hub, QuickComplete, and CLI cache-context builders.
- src/main/runtime/terminal-prompt-decision-port.ts — Electron-free TTY picker and non-TTY decision-required behavior.
- src/main/runtime/__tests__/prompt-preparation-composition.test.ts
- src/main/runtime/__tests__/terminal-prompt-decision-port.test.ts
- src/shared/prompt-contract.ts — public Prompt session, root envelope, dispatch envelope, origin, policy, and lineage contracts.
- src/prompt-core/canonical-json.ts — stable JSON and SHA-256 helpers with no Electron dependency.
- src/prompt-core/prompt-preparation-core.ts — Unicode-aware clarity analysis and pure session/finalization transitions.
- src/prompt-core/lru-cache.ts — bounded TTL-aware in-memory LRU.
- src/prompt-core/prompt-candidate-validator.ts — strict schema, uniqueness, bounds, literal, constraint, and privilege validation.
- src/main/runtime/prompt-ingress-registry.ts — exhaustive origin allow-list and interaction capabilities.
- src/main/runtime/prompt-preparation-service.ts — process-owned session lifecycle, caches, optimizer execution, decision port, and audit events.
- src/main/runtime/prompt-candidate-generator.ts — no-tools JSON candidate model call.
- src/main/runtime/dispatch-envelope.ts — canonical call payload creation, hash verification, and child lineage.
- src/main/runtime/__tests__/prompt-preparation-service.test.ts
- src/main/runtime/__tests__/prompt-ingress-contract.test.ts
- src/main/providers/__tests__/client-dispatch-envelope.test.ts
- src/main/__tests__/prompt-turn-wiring.test.ts

Modify:

- src/main/runtime/workbench-turn-runner.ts — prepare the already-created create/retry Turn and dispatch its effective Prompt.
- src/main/ipc/turns-ipc.ts — typed reuse-selection versus explicit re-optimize retry API.
- src/main/runtime/store.ts — atomically attach one finalized PromptEnvelope to an existing Turn.
- src/main/index.ts:527-547 — Hub composition and WebSocket Prompt-decision protocol only; Task 5 must not restore the removed turns:create/turns:retry handlers here.
- tsconfig.node.json:15 — include src/prompt-core.
- src/main/runtime/prompt-optimizer.ts:6-87 — expose deterministic optimizer artifacts without owning session state.
- src/main/runtime/types.ts:101-145 — persist original/effective Prompt, root envelope, and audit event kinds.
- src/main/runtime/store.ts:6-18, 165-199, and 352-363 — save the envelope and protect Prompt audit events.
- src/shared/ipc-contract.ts:321-334, 533-594, 3549-3551, 4590-4602, and 6715-6717 — require QuickComplete origin and expose Turn Prompt fields.
- src/renderer/vite-env.d.ts:835-894 and 2054-2063 — mirror generated/runtime-visible Prompt fields and QuickComplete origin.
- src/main/index.ts:200-251, 527-547, 588-790, and 818-990 — Workbench/Hub preparation and effective-history wiring.
- src/main/hub/dispatcher.ts:202-220, 341-510, 874-914, 1006-1121, 1465-1479, and 1637-1655 — carry lineage and create per-call envelopes.
- src/main/agentic/executor.ts:88-115 — one internal envelope per tool-loop model call.
- src/main/runtime/schedule-helpers.ts:155-168 and 216-241 — internal child lineage without a second root session.
- src/main/providers/client.ts:26-88 — require and re-verify an exact canonical envelope before fetch.
- src/main/ipc/missing-ipc.ts:233-279 — structured QuickComplete preparation.
- src/main/routing/proxy.ts:283-473 — passthrough dispatch envelope only.
- src/main/runtime/models-center.ts:135-179 — internal diagnostic dispatch envelope.
- src/main/runtime/headless-run.ts:23-44 and 176-200 — Electron-free CLI preparation and decision-required result.
- scripts/agenthub-cli.mjs:108 onward — TTY selection and non-TTY structured result.
- src/renderer/workbench/PromptEnhancer.tsx:39-43
- src/renderer/sdd/components/SddRequirementsList.tsx:526-531
- src/renderer/workbench/InlineEditAffordance.tsx:49
- src/renderer/workbench/components/panels/BrowserPanel.tsx:139-142 and 159-162

---

### Task 1: Shared contracts, canonical JSON, and SHA-256

**Files:**

- Create: src/shared/prompt-contract.ts
- Create: src/prompt-core/canonical-json.ts
- Create: src/prompt-core/__tests__/canonical-json.test.ts
- Modify: tsconfig.node.json:15

- [ ] **Step 1: Write the failing canonicalization and contract test**

Create src/prompt-core/__tests__/canonical-json.test.ts:

~~~typescript
import { describe, expect, it } from "vitest"
import {
  PROMPT_ORIGINS,
  type DispatchEnvelope,
  type PromptEnvelope
} from "../../shared/prompt-contract"
import { canonicalJson, sha256Hex } from "../canonical-json"

describe("canonical Prompt hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({
      z: 1,
      nested: { b: 2, a: 1 },
      messages: [{ role: "user", content: "first" }, { role: "assistant", content: "second" }],
      ignored: undefined
    })).toBe('{"messages":[{"content":"first","role":"user"},{"content":"second","role":"assistant"}],"nested":{"a":1,"b":2},"z":1}')
  })

  it("produces the known SHA-256 for canonical JSON", () => {
    expect(sha256Hex(canonicalJson({ b: 2, a: 1 })))
      .toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777")
  })

  it("publishes every supported origin and separate root/dispatch hashes", () => {
    expect(PROMPT_ORIGINS).toContain("workbench:create")
    expect(PROMPT_ORIGINS).toContain("internal:schedule")
    const root = {} as PromptEnvelope
    const dispatch = {} as DispatchEnvelope
    const rootHash: string = root.preparedTextHash
    const payloadHash: string = dispatch.canonicalPayloadHash
    expect(typeof rootHash).toBe("undefined")
    expect(typeof payloadHash).toBe("undefined")
  })
})
~~~

- [ ] **Step 2: Run the test and verify the expected RED state**

Run:

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/canonical-json.test.ts
~~~

Expected: FAIL because src/shared/prompt-contract.ts and
src/prompt-core/canonical-json.ts do not exist.

- [ ] **Step 3: Add the shared contracts**

Create src/shared/prompt-contract.ts with these complete public contracts:

~~~typescript
export const PROMPT_ORIGINS = [
  "workbench:create",
  "workbench:retry",
  "hub:websocket",
  "cli:headless",
  "quick-complete:prompt-enhancer",
  "quick-complete:sdd-requirements",
  "quick-complete:inline-edit",
  "quick-complete:browser-summary",
  "quick-complete:browser-analysis",
  "external-proxy:openai",
  "external-proxy:anthropic",
  "external-proxy:agent",
  "internal:schedule",
  "internal:agentic-round",
  "internal:prompt-candidate",
  "internal:loop-candidate",
  "internal:loop-synthesizer",
  "internal:loop-judge",
  "internal:loop-executor",
  "internal:model-diagnostic"
] as const

export type PromptOrigin = typeof PROMPT_ORIGINS[number]
export type PromptPolicy = "optimize" | "structured" | "passthrough" | "internal"
export type PromptSessionScope = "root" | "draft" | "none"
export type PromptDecisionCapability =
  | "desktop-inline"
  | "websocket"
  | "terminal"
  | "none"
  | "client-owned"

export type PromptPreparationState =
  | "analyzing"
  | "awaiting-decision"
  | "finalized"
  | "cancelled"
  | "failed"

export interface PromptPreparationSession {
  readonly sessionId: string
  readonly rootInputId: string
  readonly origin: PromptOrigin
  readonly policy: PromptPolicy
  readonly state: PromptPreparationState
  readonly inputHash: string
  readonly preparationCount: 1
  readonly optimizationCount: 0 | 1
  readonly candidateAttemptCount: number
  readonly retryOfEnvelopeId?: string
}

export type PromptEnvelopeStatus =
  | "optimized"
  | "unchanged"
  | "candidate-selected"
  | "custom-selected"
  | "reused-selection"
  | "structured"
  | "passthrough"

export interface PromptEnvelope {
  readonly envelopeId: string
  readonly sessionId: string
  readonly rootInputId: string
  readonly displayOriginalPrompt: string
  readonly effectivePrompt: string
  readonly origin: PromptOrigin
  readonly policy: PromptPolicy
  readonly status: PromptEnvelopeStatus
  readonly optimizerVersion: string
  readonly inputHash: string
  readonly preparedTextHash: string
  readonly optimizationCount: 0 | 1
  readonly finalizedAt: number
}

export interface PromptDispatchLineage {
  readonly origin: PromptOrigin
  readonly policy: PromptPolicy
  readonly rootInputId?: string
  readonly rootEnvelopeId?: string
  readonly rootPreparedTextHash?: string
  readonly parentDispatchId?: string
}

export interface DispatchEnvelope extends PromptDispatchLineage {
  readonly dispatchId: string
  readonly providerId: string
  readonly modelId: string
  readonly canonicalPayloadHash: string
  readonly optimizationCount: 0
}

export interface CanonicalDispatchMessage {
  readonly role: string
  readonly content: unknown
  readonly name?: string
  readonly toolCallId?: string
  readonly toolCalls?: unknown
}

export interface CanonicalDispatchPayload {
  readonly providerId: string
  readonly modelId: string
  readonly protocol: string
  readonly systemPrompt: string
  readonly messages: readonly CanonicalDispatchMessage[]
  readonly attachments: readonly unknown[]
  readonly tools: readonly unknown[]
  readonly toolChoice: unknown
  readonly thinking: unknown
  readonly contextLayers: readonly string[]
}

export function promptLineageFromEnvelope(envelope: PromptEnvelope): PromptDispatchLineage {
  return Object.freeze({
    origin: envelope.origin,
    policy: envelope.policy,
    rootInputId: envelope.rootInputId,
    rootEnvelopeId: envelope.envelopeId,
    rootPreparedTextHash: envelope.preparedTextHash
  })
}
~~~

- [ ] **Step 4: Add stable JSON and SHA-256**

Create src/prompt-core/canonical-json.ts:

~~~typescript
import { createHash } from "node:crypto"

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue }

function normalize(value: unknown, seen: Set<object>): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers")
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Canonical JSON rejects cycles")
    seen.add(value)
    const result = value.map(item => item === undefined ? null : normalize(item, seen))
    seen.delete(value)
    return result
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (seen.has(record)) throw new TypeError("Canonical JSON rejects cycles")
    seen.add(record)
    const result: Record<string, CanonicalValue> = {}
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue
      result[key] = normalize(item, seen)
    }
    seen.delete(record)
    return result
  }
  throw new TypeError("Canonical JSON rejects unsupported values")
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()))
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function hashPromptText(value: string): string {
  return sha256Hex(String(value))
}
~~~

Change tsconfig.node.json include to:

~~~json
"include": [
  "src/main/**/*",
  "src/preload/**/*",
  "src/shared/**/*",
  "src/prompt-core/**/*",
  "electron.vite.config.ts",
  "vitest.config.ts"
]
~~~

- [ ] **Step 5: Run the focused test and typecheck**

Run:

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/canonical-json.test.ts
npm.cmd run typecheck
~~~

Expected: one test file passes, three tests pass, and typecheck exits 0.

- [ ] **Step 6: Commit Task 1**

~~~powershell
git add tsconfig.node.json src/shared/prompt-contract.ts src/prompt-core/canonical-json.ts src/prompt-core/__tests__/canonical-json.test.ts
git commit -m "feat(prompt): add preparation and dispatch contracts"
~~~

---

### Task 2: Pure analyzer and immutable finalization

**Files:**

- Create: src/prompt-core/prompt-preparation-core.ts
- Create: src/prompt-core/__tests__/prompt-preparation-core.test.ts

- [ ] **Step 1: Write failing analyzer and finalization tests**

Create src/prompt-core/__tests__/prompt-preparation-core.test.ts:

~~~typescript
import { describe, expect, it } from "vitest"
import {
  analyzePrompt,
  finalizePromptEnvelope,
  startPromptPreparation
} from "../prompt-preparation-core"

describe("Prompt preparation core", () => {
  it.each([
    ["Run tests", "clear"],
    ["运行测试", "clear"],
    ["把这个弄好", "ambiguous"],
    ["检查整个项目的所有问题", "broad"],
    ["Optimize this prompt for implementation", "explicit-optimization"],
    ["请优化这个提示词", "explicit-optimization"]
  ] as const)("classifies %s as %s", (prompt, expected) => {
    expect(analyzePrompt(prompt).clarity).toBe(expected)
  })

  it("does not match unrelated substrings as explicit optimization", () => {
    expect(analyzePrompt("Explain optimizer statistics in this code").clarity)
      .not.toBe("explicit-optimization")
  })

  it("starts one immutable session and finalizes one immutable envelope", () => {
    const session = startPromptPreparation({
      sessionId: "session-1",
      rootInputId: "input-1",
      origin: "workbench:create",
      policy: "optimize",
      prompt: "Run tests"
    })
    const envelope = finalizePromptEnvelope({
      session,
      envelopeId: "envelope-1",
      displayOriginalPrompt: "Run tests",
      effectivePrompt: "Run the repository test suite and report failures.",
      status: "optimized",
      optimizerVersion: "prompt-preparation-v1",
      finalizedAt: 123
    })

    expect(session).toMatchObject({ preparationCount: 1, optimizationCount: 1, state: "analyzing" })
    expect(envelope.inputHash).toBe(session.inputHash)
    expect(envelope.preparedTextHash).not.toBe(envelope.inputHash)
    expect(Object.isFrozen(session)).toBe(true)
    expect(Object.isFrozen(envelope)).toBe(true)
  })

  it("uses count zero for structured work and rejects a second finalization", () => {
    const session = startPromptPreparation({
      sessionId: "session-2",
      rootInputId: "input-2",
      origin: "quick-complete:inline-edit",
      policy: "structured",
      prompt: "Replace the selected function body"
    })
    expect(session.optimizationCount).toBe(0)
    expect(() => finalizePromptEnvelope({
      session: { ...session, state: "finalized" },
      envelopeId: "envelope-2",
      displayOriginalPrompt: "Replace the selected function body",
      effectivePrompt: "Replace the selected function body",
      status: "structured",
      optimizerVersion: "prompt-preparation-v1",
      finalizedAt: 124
    })).toThrow("cannot finalize from finalized")
  })
})
~~~

- [ ] **Step 2: Run the test and verify RED**

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/prompt-preparation-core.test.ts
~~~

Expected: FAIL because prompt-preparation-core.ts does not exist.

- [ ] **Step 3: Implement the pure analyzer and transitions**

Create src/prompt-core/prompt-preparation-core.ts:

~~~typescript
import type {
  PromptDecisionCapability,
  PromptEnvelope,
  PromptEnvelopeStatus,
  PromptOrigin,
  PromptPolicy,
  PromptPreparationSession
} from "../shared/prompt-contract"
import { hashPromptText } from "./canonical-json"

export const PROMPT_OPTIMIZER_VERSION = "prompt-preparation-v1"

export type PromptClarity = "clear" | "ambiguous" | "broad" | "explicit-optimization"

export interface PromptAnalysis {
  readonly clarity: PromptClarity
  readonly signals: readonly string[]
}

const EXPLICIT_OPTIMIZATION =
  /\b(?:optimi[sz]e|rewrite|improve)\s+(?:this\s+)?prompt\b|(?:优化|改写|润色).{0,8}(?:提示词|prompt)|(?:提示词|prompt).{0,8}(?:优化|改写|润色)/iu
const BROAD_SCOPE =
  /\b(?:everything|all\s+(?:files|issues|problems)|entire\s+(?:project|repository|codebase))\b|(?:全部|所有|整个)(?:项目|仓库|代码|问题)/iu
const UNRESOLVED_REFERENCE =
  /^(?:fix|change|improve|handle)?\s*(?:this|that|it)\b|^(?:把|将)?(?:这个|那个|这些|它)(?:弄好|修好|改好|处理)?$/iu
const CLEAR_ACTION =
  /^(?:run|execute|list|open|show|explain|summarize|build|test|review|fix)\b.{1,120}$|^(?:运行|执行|列出|打开|显示|解释|总结|构建|测试|审查|修复).{1,80}$/iu

export function analyzePrompt(rawPrompt: string): PromptAnalysis {
  const prompt = String(rawPrompt).normalize("NFKC").trim()
  const signals: string[] = []
  if (EXPLICIT_OPTIMIZATION.test(prompt)) {
    return Object.freeze({ clarity: "explicit-optimization", signals: Object.freeze(["explicit-request"]) })
  }
  if (BROAD_SCOPE.test(prompt)) signals.push("unbounded-scope")
  if (UNRESOLVED_REFERENCE.test(prompt)) signals.push("unresolved-reference")
  if (!CLEAR_ACTION.test(prompt) && prompt.length < 12) signals.push("missing-objective")
  const clarity: PromptClarity = signals.includes("unbounded-scope")
    ? "broad"
    : signals.length > 0
      ? "ambiguous"
      : "clear"
  return Object.freeze({ clarity, signals: Object.freeze(signals) })
}

export function shouldGeneratePromptCandidates(analysis: PromptAnalysis): boolean {
  return analysis.clarity === "ambiguous"
    || analysis.clarity === "broad"
    || analysis.clarity === "explicit-optimization"
}

export function startPromptPreparation(input: {
  sessionId: string
  rootInputId: string
  origin: PromptOrigin
  policy: PromptPolicy
  prompt: string
  retryOfEnvelopeId?: string
}): PromptPreparationSession {
  return Object.freeze({
    sessionId: input.sessionId,
    rootInputId: input.rootInputId,
    origin: input.origin,
    policy: input.policy,
    state: "analyzing",
    inputHash: hashPromptText(String(input.prompt).trim()),
    preparationCount: 1,
    optimizationCount: input.policy === "optimize" ? 1 : 0,
    candidateAttemptCount: 0,
    retryOfEnvelopeId: input.retryOfEnvelopeId
  })
}

export function withPreparationState(
  session: PromptPreparationSession,
  state: PromptPreparationSession["state"],
  candidateAttemptCount = session.candidateAttemptCount
): PromptPreparationSession {
  if (session.state === "finalized" || session.state === "cancelled" || session.state === "failed") {
    throw new Error("Prompt preparation is already terminal")
  }
  return Object.freeze({ ...session, state, candidateAttemptCount })
}

export function finalizePromptEnvelope(input: {
  session: PromptPreparationSession
  envelopeId: string
  displayOriginalPrompt: string
  effectivePrompt: string
  status: PromptEnvelopeStatus
  optimizerVersion: string
  finalizedAt: number
}): PromptEnvelope {
  if (input.session.state !== "analyzing" && input.session.state !== "awaiting-decision") {
    throw new Error("Prompt preparation cannot finalize from " + input.session.state)
  }
  const original = String(input.displayOriginalPrompt).trim()
  const effective = String(input.effectivePrompt).trim()
  if (!original || !effective) throw new Error("Prompt envelope text must not be empty")
  return Object.freeze({
    envelopeId: input.envelopeId,
    sessionId: input.session.sessionId,
    rootInputId: input.session.rootInputId,
    displayOriginalPrompt: original,
    effectivePrompt: effective,
    origin: input.session.origin,
    policy: input.session.policy,
    status: input.status,
    optimizerVersion: input.optimizerVersion,
    inputHash: input.session.inputHash,
    preparedTextHash: hashPromptText(effective),
    optimizationCount: input.session.optimizationCount,
    finalizedAt: input.finalizedAt
  })
}
~~~

- [ ] **Step 4: Run focused tests and refactor only while green**

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/prompt-preparation-core.test.ts src/prompt-core/__tests__/canonical-json.test.ts
npm.cmd run typecheck
~~~

Expected: two test files pass and typecheck exits 0.

- [ ] **Step 5: Commit Task 2**

~~~powershell
git add src/prompt-core/prompt-preparation-core.ts src/prompt-core/__tests__/prompt-preparation-core.test.ts
git commit -m "feat(prompt): add pure preparation core"
~~~

---

### Task 3: Bounded caches, candidate schema, and no-tools generation

**Files:**

- Create: src/prompt-core/lru-cache.ts
- Create: src/prompt-core/prompt-candidate-validator.ts
- Create: src/prompt-core/__tests__/prompt-candidate-validator.test.ts
- Create: src/main/runtime/prompt-candidate-generator.ts
- Create: src/main/runtime/__tests__/prompt-candidate-generator.test.ts

- [ ] **Step 1: Write failing cache and validator tests**

Create src/prompt-core/__tests__/prompt-candidate-validator.test.ts:

~~~typescript
import { describe, expect, it } from "vitest"
import { LruCache } from "../lru-cache"
import {
  buildPromptArtifactCacheKey,
  validatePromptCandidateSet
} from "../prompt-candidate-validator"

describe("Prompt candidate artifacts", () => {
  it("evicts the least-recent entry and expires by TTL", () => {
    let now = 1_000
    const cache = new LruCache<string, string>({ capacity: 2, ttlMs: 100, now: () => now })
    cache.set("a", "A")
    cache.set("b", "B")
    expect(cache.get("a")).toBe("A")
    cache.set("c", "C")
    expect(cache.get("b")).toBeUndefined()
    now = 1_101
    expect(cache.get("a")).toBeUndefined()
  })

  it("accepts two distinct bounded candidates that preserve protected literals", () => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: 'Fix "AH-002" in E:\\Agent\\AgentHub without deleting tests.' },
        { text: 'Diagnose and minimally fix "AH-002" at E:\\Agent\\AgentHub; do not delete tests.' }
      ]
    }, 'Fix "AH-002" in E:\\Agent\\AgentHub; do not delete tests.', 4_000)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.candidates).toHaveLength(2)
  })

  it.each([
    {
      name: "duplicates",
      value: { schemaVersion: "prompt-candidates-v1", candidates: [{ text: "Same request" }, { text: " same   request " }] }
    },
    {
      name: "lost literal",
      value: { schemaVersion: "prompt-candidates-v1", candidates: [{ text: "Fix it safely" }, { text: "Review it safely" }] }
    },
    {
      name: "new destructive privilege",
      value: { schemaVersion: "prompt-candidates-v1", candidates: [{ text: 'Fix "AH-002" and delete files' }, { text: 'Fix "AH-002" and upload results' }] }
    }
  ])("rejects $name", ({ value }) => {
    expect(validatePromptCandidateSet(value, 'Fix "AH-002" without side effects.', 4_000).ok).toBe(false)
  })

  it("changes the cache key for every output-affecting input", () => {
    const base = {
      inputHash: "input",
      optimizerVersion: "o1",
      generatorVersion: "g1",
      templateVersion: "t1",
      schemaVersion: "s1",
      policy: "optimize",
      origin: "workbench:create",
      interactionPolicy: "desktop-inline",
      locale: "zh-CN",
      contextSignature: "ctx",
      pluginSignature: "plugin",
      skillSignature: "skill",
      attachmentSignature: "attachment",
      providerId: "openai",
      modelId: "gpt"
    }
    expect(buildPromptArtifactCacheKey(base))
      .not.toBe(buildPromptArtifactCacheKey({ ...base, locale: "en-US" }))
  })
})
~~~

Create src/main/runtime/__tests__/prompt-candidate-generator.test.ts:

~~~typescript
import { describe, expect, it, vi } from "vitest"
import { PromptCandidateGenerator } from "../prompt-candidate-generator"

describe("PromptCandidateGenerator", () => {
  it("uses one no-tools JSON call and validates before returning", async () => {
    const invoke = vi.fn(async () => JSON.stringify({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Fix the login regression and run its focused tests." },
        { text: "Reproduce the login regression, apply a minimal fix, and verify the affected tests." }
      ]
    }))
    const generator = new PromptCandidateGenerator({ invoke })
    const result = await generator.generate({
      originalPrompt: "Fix the login regression",
      maxPromptChars: 4_000
    })
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      tools: [],
      toolChoice: "none",
      responseFormat: "json"
    }))
    expect(result).toHaveLength(2)
  })
})
~~~

- [ ] **Step 2: Run both tests and verify RED**

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/prompt-candidate-validator.test.ts src/main/runtime/__tests__/prompt-candidate-generator.test.ts
~~~

Expected: FAIL because the cache, validator, and generator modules do not exist.

- [ ] **Step 3: Implement the bounded LRU**

Create src/prompt-core/lru-cache.ts:

~~~typescript
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>()

  constructor(private readonly options: {
    capacity: number
    ttlMs: number
    now?: () => number
  }) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError("LRU capacity must be a positive integer")
    }
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs })
    while (this.entries.size > this.options.capacity) {
      const oldest = this.entries.keys().next().value as K | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  get size(): number {
    return this.entries.size
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now()
  }
}
~~~

- [ ] **Step 4: Implement strict candidate validation and complete cache keys**

Create src/prompt-core/prompt-candidate-validator.ts. The implementation must:

- require schemaVersion prompt-candidates-v1;
- require two or three candidates;
- trim and normalize NFKC whitespace;
- reject normalized duplicates and over-limit candidates;
- preserve quoted strings, URLs, numeric identifiers, Windows/POSIX paths, and sentences containing negation constraints;
- reject destructive, execution, network-send, or privilege terms not present in the source;
- return only frozen strings and never copy IDs, owners, or timestamps into cacheable output.

Use this public surface:

~~~typescript
import { canonicalJson, sha256Hex } from "./canonical-json"

export type PromptCandidateValidation =
  | { ok: true; candidates: readonly string[] }
  | { ok: false; error: string }

const NEW_PRIVILEGE_FAMILIES = [
  /\b(?:delete|remove|erase|format|rm)\b|(?:删除|移除|清空|格式化)/iu,
  /\b(?:execute|run command|shell|powershell|bash)\b|(?:执行命令|运行脚本)/iu,
  /\b(?:upload|send externally|publish|deploy)\b|(?:上传|外发|发布|部署)/iu
]

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ")
}

function protectedFragments(source: string): string[] {
  const fragments = new Set<string>()
  for (const match of source.matchAll(/["'“”‘’]([^"'“”‘’]{1,256})["'“”‘’]/gu)) fragments.add(match[1])
  for (const match of source.matchAll(/\b[A-Za-z]:\\[^\s,;]+|(?:^|\s)\/[^\s,;]+/gu)) fragments.add(match[0].trim())
  for (const match of source.matchAll(/https?:\/\/[^\s]+|\b[A-Z]{2,}-\d+\b|\b\d+(?:\.\d+)*\b/gu)) fragments.add(match[0])
  for (const sentence of source.split(/[\n.!?。！？]+/u)) {
    if (/\b(?:do not|must not|without|never)\b|(?:不要|不得|禁止|不能|不允许)/iu.test(sentence)) {
      fragments.add(normalizedText(sentence))
    }
  }
  return [...fragments].filter(Boolean)
}

export function validatePromptCandidateSet(
  value: unknown,
  sourcePrompt: string,
  maxPromptChars: number
): PromptCandidateValidation {
  if (!value || typeof value !== "object") return { ok: false, error: "candidate response must be an object" }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== "prompt-candidates-v1") return { ok: false, error: "unsupported candidate schema" }
  if (!Array.isArray(record.candidates) || record.candidates.length < 2 || record.candidates.length > 3) {
    return { ok: false, error: "candidate count must be two or three" }
  }
  const source = normalizedText(sourcePrompt)
  const protectedValues = protectedFragments(source)
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const item of record.candidates) {
    const text = normalizedText(String((item as Record<string, unknown>)?.text || ""))
    const key = text.toLocaleLowerCase()
    if (!text || text.length > maxPromptChars) return { ok: false, error: "candidate length is invalid" }
    if (seen.has(key)) return { ok: false, error: "candidate texts must be distinct" }
    if (protectedValues.some(fragment => !text.includes(fragment))) {
      return { ok: false, error: "candidate lost a protected literal or constraint" }
    }
    for (const family of NEW_PRIVILEGE_FAMILIES) {
      family.lastIndex = 0
      const candidateHasPrivilege = family.test(text)
      family.lastIndex = 0
      const sourceHasPrivilege = family.test(source)
      if (candidateHasPrivilege && !sourceHasPrivilege) {
        return { ok: false, error: "candidate introduced a new privilege or side effect" }
      }
    }
    seen.add(key)
    candidates.push(text)
  }
  return { ok: true, candidates: Object.freeze(candidates) }
}

export function buildPromptArtifactCacheKey(input: Readonly<Record<string, string>>): string {
  return sha256Hex(canonicalJson(input))
}
~~~

- [ ] **Step 5: Implement a no-tools model adapter**

Create src/main/runtime/prompt-candidate-generator.ts:

~~~typescript
import { validatePromptCandidateSet } from "../../prompt-core/prompt-candidate-validator"

export interface PromptCandidateInvocation {
  systemPrompt: string
  userPrompt: string
  tools: readonly never[]
  toolChoice: "none"
  responseFormat: "json"
}

export class PromptCandidateGenerator {
  constructor(private readonly deps: {
    invoke: (input: PromptCandidateInvocation) => Promise<string>
  }) {}

  async generate(input: {
    originalPrompt: string
    maxPromptChars: number
  }): Promise<readonly string[]> {
    const raw = await this.deps.invoke({
      systemPrompt: [
        "Return JSON only.",
        "Use schemaVersion prompt-candidates-v1.",
        "Return two or three materially distinct Prompt candidates.",
        "Preserve paths, quoted literals, negations, requested output forms, and safety constraints.",
        "Do not add facts, permissions, destructive actions, tools, or external side effects."
      ].join("\n"),
      userPrompt: input.originalPrompt,
      tools: [],
      toolChoice: "none",
      responseFormat: "json"
    })
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error("Prompt candidate model returned invalid JSON")
    }
    const validation = validatePromptCandidateSet(parsed, input.originalPrompt, input.maxPromptChars)
    if (!validation.ok) throw new Error(validation.error)
    return validation.candidates
  }
}
~~~

- [ ] **Step 6: Run RED-to-GREEN verification**

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/prompt-candidate-validator.test.ts src/main/runtime/__tests__/prompt-candidate-generator.test.ts
npm.cmd run typecheck
~~~

Expected: both files pass and typecheck exits 0.

- [ ] **Step 7: Commit Task 3**

~~~powershell
git add src/prompt-core/lru-cache.ts src/prompt-core/prompt-candidate-validator.ts src/prompt-core/__tests__/prompt-candidate-validator.test.ts src/main/runtime/prompt-candidate-generator.ts src/main/runtime/__tests__/prompt-candidate-generator.test.ts
git commit -m "feat(prompt): validate and cache optimization candidates"
~~~

---

### Task 4: Ingress registry and auditable PromptPreparationService

**Files:**

- Create: src/main/runtime/prompt-ingress-registry.ts
- Create: src/main/runtime/prompt-preparation-service.ts
- Create: src/main/runtime/prompt-decision-port.ts
- Create: src/main/runtime/prompt-preparation-composition.ts
- Create: src/main/runtime/prompt-cache-context.ts
- Create: src/main/runtime/__tests__/prompt-preparation-service.test.ts
- Create: src/main/runtime/__tests__/prompt-decision-port.test.ts
- Create: src/main/runtime/__tests__/prompt-preparation-composition.test.ts
- Modify: src/main/runtime/prompt-optimizer.ts:6-87
- Modify: src/main/runtime/types.ts:129-151
- Modify: src/main/runtime/store.ts:352-363

- [ ] **Step 1: Write failing service lifecycle tests**

Create src/main/runtime/__tests__/prompt-preparation-service.test.ts:

~~~typescript
import { describe, expect, it, vi } from "vitest"
import { PromptPreparationService } from "../prompt-preparation-service"

function serviceFixture() {
  let sequence = 0
  const audit = vi.fn()
  const optimize = vi.fn((prompt: string) => ({
    optimizedPrompt: "[Prepared]\n" + prompt,
    artifact: { intent: "implementation" }
  }))
  const generateCandidates = vi.fn(async () => [
    "Fix the login regression and run focused tests.",
    "Reproduce the login regression, apply a minimal fix, and verify it."
  ])
  const decisionPort = { decide: vi.fn(async () => ({ kind: "candidate" as const, index: 1 })) }
  const decisionPorts = { for: vi.fn(() => decisionPort) }
  return {
    audit,
    optimize,
    generateCandidates,
    decisionPort,
    service: new PromptPreparationService({
      id: prefix => prefix + "-" + (++sequence),
      now: () => 123,
      audit,
      optimize,
      generateCandidates,
      decisionPorts
    })
  }
}

describe("PromptPreparationService", () => {
  it("creates and finalizes exactly one root session", async () => {
    const fixture = serviceFixture()
    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Run tests",
      cacheContext: {
        locale: "en-US",
        contextSignature: "ctx",
        pluginSignature: "plugins",
        skillSignature: "skills",
        attachmentSignature: "attachments",
        providerId: "openai",
        modelId: "gpt"
      }
    })
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.session.preparationCount).toBe(1)
    expect(result.envelope.sessionId).toBe(result.session.sessionId)
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:prepared"])
  })

  it("keeps one session awaiting retry/original/custom when candidate generation fails", async () => {
    const fixture = serviceFixture()
    fixture.generateCandidates.mockRejectedValueOnce(new Error("candidate outage"))
    fixture.decisionPort.decide
      .mockResolvedValueOnce({ kind: "retry-candidates" })
      .mockResolvedValueOnce({ kind: "candidate", index: 0 })
    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "把这个弄好",
      cacheContext: {
        locale: "zh-CN",
        contextSignature: "ctx",
        pluginSignature: "plugins",
        skillSignature: "skills",
        attachmentSignature: "attachments",
        providerId: "openai",
        modelId: "gpt"
      }
    })
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    const decisions = fixture.decisionPort.decide.mock.calls.map(call => call[0])
    expect(decisions).toHaveLength(2)
    expect(new Set(decisions.map(decision => decision.sessionId)).size).toBe(1)
    expect(decisions.map(decision => decision.attempt)).toEqual([1, 2])
    expect(decisions[0]).toMatchObject({ candidateError: "candidate outage", candidates: [] })
    expect(result.session.candidateAttemptCount).toBe(2)
    expect(fixture.audit.mock.calls.map(call => call[0].kind)).not.toContain("prompt:preparation-failed")
    expect(fixture.audit.mock.calls.filter(call => call[0].kind === "prompt:preparation-started")).toHaveLength(1)
    expect(fixture.audit.mock.calls.filter(call => call[0].kind === "prompt:prepared")).toHaveLength(1)
  })

  it("reuses the prior selection without optimizing effective text again", async () => {
    const fixture = serviceFixture()
    const previous = {
      envelopeId: "previous-envelope",
      sessionId: "previous-session",
      rootInputId: "previous-input",
      displayOriginalPrompt: "把登录修好",
      effectivePrompt: "Reproduce the login failure, fix the root cause, and run focused tests.",
      origin: "workbench:create" as const,
      policy: "optimize" as const,
      status: "candidate-selected" as const,
      optimizerVersion: "prompt-preparation-v1",
      inputHash: "input-hash",
      preparedTextHash: "prepared-hash",
      optimizationCount: 1 as const,
      finalizedAt: 1
    }
    const result = await fixture.service.prepareRoot({
      origin: "workbench:retry",
      prompt: previous.displayOriginalPrompt,
      reuseEnvelope: previous,
      cacheContext: {
        locale: "zh-CN",
        contextSignature: "ctx",
        pluginSignature: "plugins",
        skillSignature: "skills",
        attachmentSignature: "attachments",
        providerId: "openai",
        modelId: "gpt"
      }
    })
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.envelope).toMatchObject({
      status: "reused-selection",
      effectivePrompt: previous.effectivePrompt,
      optimizationCount: 1
    })
    expect(fixture.optimize).toHaveBeenCalledWith(previous.displayOriginalPrompt, expect.anything())
    expect(fixture.generateCandidates).not.toHaveBeenCalled()
  })

  it("explicit re-optimize ignores the prior effective text and starts candidates from the original", async () => {
    const fixture = serviceFixture()
    const previous = {
      envelopeId: "previous-envelope",
      sessionId: "previous-session",
      rootInputId: "previous-input",
      displayOriginalPrompt: "Fix this",
      effectivePrompt: "Old selected effective Prompt",
      origin: "workbench:create" as const,
      policy: "optimize" as const,
      status: "candidate-selected" as const,
      optimizerVersion: "prompt-preparation-v1",
      inputHash: "input-hash",
      preparedTextHash: "prepared-hash",
      optimizationCount: 1 as const,
      finalizedAt: 1
    }
    const result = await fixture.service.prepareRoot({
      origin: "workbench:retry",
      prompt: previous.displayOriginalPrompt,
      reuseEnvelope: previous,
      retryStrategy: "reoptimize",
      cacheContext: {
        locale: "en-US",
        contextSignature: "ctx",
        pluginSignature: "plugins",
        skillSignature: "skills",
        attachmentSignature: "attachments",
        providerId: "openai",
        modelId: "gpt"
      }
    })
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(fixture.generateCandidates).toHaveBeenCalledWith(previous.displayOriginalPrompt, expect.anything())
    expect(result.envelope.status).toBe("candidate-selected")
    expect(result.envelope.effectivePrompt).not.toBe(previous.effectivePrompt)
  })

  it("keeps cache ownership outside cached values", async () => {
    const fixture = serviceFixture()
    const input = {
      origin: "workbench:create" as const,
      prompt: "把这个弄好",
      cacheContext: {
        locale: "zh-CN",
        contextSignature: "ctx",
        pluginSignature: "plugins",
        skillSignature: "skills",
        attachmentSignature: "attachments",
        providerId: "openai",
        modelId: "gpt"
      }
    }
    const first = await fixture.service.prepareRoot(input)
    const second = await fixture.service.prepareRoot(input)
    expect(first.kind).toBe("ready")
    expect(second.kind).toBe("ready")
    if (first.kind !== "ready" || second.kind !== "ready") return
    expect(first.session.sessionId).not.toBe(second.session.sessionId)
    expect(first.envelope.envelopeId).not.toBe(second.envelope.envelopeId)
    expect(fixture.generateCandidates).toHaveBeenCalledTimes(1)
  })
})
~~~

- [ ] **Step 2: Run the service test and verify RED**

~~~powershell
npm.cmd run test -- --run src/main/runtime/__tests__/prompt-preparation-service.test.ts
~~~

Expected: FAIL because the registry and service do not exist.

- [ ] **Step 3: Add the exhaustive ingress registry**

Create src/main/runtime/prompt-ingress-registry.ts:

~~~typescript
import type {
  PromptDecisionCapability,
  PromptOrigin,
  PromptPolicy,
  PromptSessionScope
} from "../../shared/prompt-contract"

export interface PromptIngressRegistration {
  readonly policy: PromptPolicy
  readonly scope: PromptSessionScope
  readonly decisionCapability: PromptDecisionCapability
}

export const PROMPT_INGRESS_REGISTRY: Readonly<Record<PromptOrigin, PromptIngressRegistration>> =
  Object.freeze({
    "workbench:create": { policy: "optimize", scope: "root", decisionCapability: "desktop-inline" },
    "workbench:retry": { policy: "optimize", scope: "root", decisionCapability: "desktop-inline" },
    "hub:websocket": { policy: "optimize", scope: "root", decisionCapability: "websocket" },
    "cli:headless": { policy: "optimize", scope: "root", decisionCapability: "terminal" },
    "quick-complete:prompt-enhancer": { policy: "structured", scope: "draft", decisionCapability: "desktop-inline" },
    "quick-complete:sdd-requirements": { policy: "structured", scope: "root", decisionCapability: "none" },
    "quick-complete:inline-edit": { policy: "structured", scope: "root", decisionCapability: "none" },
    "quick-complete:browser-summary": { policy: "structured", scope: "root", decisionCapability: "none" },
    "quick-complete:browser-analysis": { policy: "structured", scope: "root", decisionCapability: "none" },
    "external-proxy:openai": { policy: "passthrough", scope: "none", decisionCapability: "client-owned" },
    "external-proxy:anthropic": { policy: "passthrough", scope: "none", decisionCapability: "client-owned" },
    "external-proxy:agent": { policy: "passthrough", scope: "none", decisionCapability: "client-owned" },
    "internal:schedule": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:agentic-round": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:prompt-candidate": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:loop-candidate": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:loop-synthesizer": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:loop-judge": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:loop-executor": { policy: "internal", scope: "none", decisionCapability: "none" },
    "internal:model-diagnostic": { policy: "internal", scope: "none", decisionCapability: "none" }
  })

export function requirePromptIngress(origin: PromptOrigin): PromptIngressRegistration {
  const registration = PROMPT_INGRESS_REGISTRY[origin]
  if (!registration) throw new Error("Unregistered Prompt ingress: " + String(origin))
  return registration
}
~~~

- [ ] **Step 4: Implement the service with separate pure caches**

Create src/main/runtime/prompt-preparation-service.ts around the following API.
The service must keep a private terminal-session set so finalize/cancel/fail are
idempotent and mutually exclusive. Audit payloads contain IDs, hashes, origin,
policy, status, versions, cache status, and counts, but never duplicate raw
Prompt text.

~~~typescript
import type {
  PromptEnvelope,
  PromptOrigin,
  PromptPreparationSession
} from "../../shared/prompt-contract"
import type { DecisionOwner } from "../../shared/decision-contract"
import { hashPromptText } from "../../prompt-core/canonical-json"
import { LruCache } from "../../prompt-core/lru-cache"
import {
  PROMPT_OPTIMIZER_VERSION,
  analyzePrompt,
  finalizePromptEnvelope,
  shouldGeneratePromptCandidates,
  startPromptPreparation,
  withPreparationState
} from "../../prompt-core/prompt-preparation-core"
import { buildPromptArtifactCacheKey } from "../../prompt-core/prompt-candidate-validator"
import { requirePromptIngress } from "./prompt-ingress-registry"

export interface PromptCacheContext {
  locale: string
  contextSignature: string
  pluginSignature: string
  skillSignature: string
  attachmentSignature: string
  providerId: string
  modelId: string
}

export type PromptSelection =
  | { kind: "original" }
  | { kind: "candidate"; index: number }
  | { kind: "custom"; text: string }
  | { kind: "retry-candidates" }
  | { kind: "decision-required" }
  | { kind: "cancelled" }

export interface PromptDecisionInput {
  owner?: DecisionOwner
  sessionId: string
  origin: PromptOrigin
  attempt: number
  originalPrompt: string
  candidates: readonly string[]
  candidateError?: string
  retryAllowed: boolean
}

export interface PromptDecisionPort {
  decide(input: PromptDecisionInput): Promise<PromptSelection>
}

export interface PromptDecisionPortRouter {
  for(origin: PromptOrigin, capability: PromptDecisionCapability): PromptDecisionPort
}

export type PromptPreparationOutcome =
  | { kind: "ready"; session: PromptPreparationSession; envelope: PromptEnvelope; artifact: unknown }
  | { kind: "decision-required"; session: PromptPreparationSession; candidates: readonly string[]; candidateError?: string }
  | { kind: "cancelled"; session: PromptPreparationSession }
  | { kind: "failed"; session: PromptPreparationSession; error: string }

export class PromptPreparationService {
  private readonly artifactCache = new LruCache<string, unknown>({
    capacity: 512,
    ttlMs: Number.MAX_SAFE_INTEGER
  })
  private readonly candidateCache = new LruCache<string, readonly string[]>({
    capacity: 128,
    ttlMs: 30 * 60 * 1_000
  })
  private readonly terminalSessions = new Set<string>()

  constructor(private readonly deps: {
    id: (prefix: string) => string
    now: () => number
    audit: (event: { kind: string; payload: Record<string, unknown> }) => void
    optimize: (prompt: string, context: PromptCacheContext) => { optimizedPrompt: string; artifact: unknown }
    generateCandidates: (prompt: string, context: PromptCacheContext) => Promise<readonly string[]>
    decisionPorts: PromptDecisionPortRouter
  }) {}

  async prepareRoot(input: {
    origin: PromptOrigin
    prompt: string
    cacheContext: PromptCacheContext
    decisionOwner?: DecisionOwner
    reuseEnvelope?: PromptEnvelope
    retryStrategy?: "reuse-selection" | "reoptimize"
  }): Promise<PromptPreparationOutcome> {
    const registration = requirePromptIngress(input.origin)
    if (registration.scope === "none") throw new Error("Ingress does not create a Prompt session")
    const original = String(input.prompt).trim()
    const session = startPromptPreparation({
      sessionId: this.deps.id("prompt-session"),
      rootInputId: this.deps.id("root-input"),
      origin: input.origin,
      policy: registration.policy,
      prompt: original,
      retryOfEnvelopeId: input.reuseEnvelope?.envelopeId
    })
    this.deps.audit({ kind: "prompt:preparation-started", payload: this.sessionAudit(session) })
    try {
      const cacheKey = buildPromptArtifactCacheKey({
        inputHash: session.inputHash,
        optimizerVersion: PROMPT_OPTIMIZER_VERSION,
        generatorVersion: "prompt-candidate-generator-v1",
        templateVersion: "prompt-candidate-template-v1",
        schemaVersion: "prompt-candidates-v1",
        policy: registration.policy,
        origin: input.origin,
        interactionPolicy: registration.decisionCapability,
        locale: input.cacheContext.locale,
        contextSignature: input.cacheContext.contextSignature,
        pluginSignature: input.cacheContext.pluginSignature,
        skillSignature: input.cacheContext.skillSignature,
        attachmentSignature: input.cacheContext.attachmentSignature,
        providerId: input.cacheContext.providerId,
        modelId: input.cacheContext.modelId
      })
      let artifact = this.artifactCache.get(cacheKey)
      let optimizedPrompt = original
      if (registration.policy === "optimize") {
        const optimized = this.deps.optimize(original, input.cacheContext)
        optimizedPrompt = optimized.optimizedPrompt
        artifact = artifact ?? optimized.artifact
        this.artifactCache.set(cacheKey, artifact)
      }
      if (input.reuseEnvelope && input.retryStrategy !== "reoptimize") {
        return this.ready(session, original, input.reuseEnvelope.effectivePrompt, "reused-selection", artifact)
      }
      if (registration.policy === "structured") {
        return this.ready(session, original, original, "structured", artifact)
      }
      const analysis = analyzePrompt(original)
      if (!shouldGeneratePromptCandidates(analysis)) {
        const status = optimizedPrompt === original ? "unchanged" : "optimized"
        return this.ready(session, original, optimizedPrompt, status, artifact)
      }
      return this.resolveCandidateDecision({
        session,
        original,
        artifact,
        cacheKey,
        cacheContext: input.cacheContext,
        owner: input.decisionOwner,
        capability: registration.decisionCapability
      })
    } catch (error) {
      return this.failed(session, error)
    }
  }

  private async resolveCandidateDecision(input: {
    session: PromptPreparationSession
    original: string
    artifact: unknown
    cacheKey: string
    cacheContext: PromptCacheContext
    owner?: DecisionOwner
    capability: PromptDecisionCapability
  }): Promise<PromptPreparationOutcome> {
    const maxAttempts = 3
    let session = input.session
    while (session.candidateAttemptCount < maxAttempts) {
      const attempt = session.candidateAttemptCount + 1
      session = withPreparationState(session, "awaiting-decision", attempt)
      let candidates = this.candidateCache.get(input.cacheKey) || Object.freeze([] as string[])
      let candidateError: string | undefined
      if (candidates.length === 0) {
        try {
          candidates = await this.deps.generateCandidates(input.original, input.cacheContext)
          this.candidateCache.set(input.cacheKey, Object.freeze([...candidates]))
        } catch (error) {
          candidateError = error instanceof Error ? error.message : String(error)
        }
      }
      this.deps.audit({
        kind: "prompt:candidate-attempted",
        payload: {
          ...this.sessionAudit(session),
          attempt,
          status: candidateError ? "failed" : "validated",
          candidateCount: candidates.length
        }
      })
      const port = this.deps.decisionPorts.for(session.origin, input.capability)
      const selection = await port.decide({
        owner: input.owner,
        sessionId: session.sessionId,
        origin: session.origin,
        attempt,
        originalPrompt: input.original,
        candidates,
        candidateError,
        retryAllowed: attempt < maxAttempts
      })
      if (selection.kind === "retry-candidates") {
        if (!candidateError || attempt >= maxAttempts) throw new Error("Prompt candidate retry is not available")
        continue
      }
      if (selection.kind === "decision-required") {
        return { kind: "decision-required", session, candidates, candidateError }
      }
      if (selection.kind === "cancelled") return this.cancelled(session)
      if (selection.kind === "original") return this.ready(session, input.original, input.original, "unchanged", input.artifact)
      if (selection.kind === "custom") return this.ready(session, input.original, selection.text, "custom-selected", input.artifact)
      const selected = candidates[selection.index]
      if (!selected) throw new Error("Prompt candidate selection is out of range")
      return this.ready(session, input.original, selected, "candidate-selected", input.artifact)
    }
    throw new Error("Prompt candidate attempt limit reached without a decision")
  }

  private ready(
    session: PromptPreparationSession,
    originalPrompt: string,
    effectivePrompt: string,
    status: PromptEnvelope["status"],
    artifact: unknown
  ): PromptPreparationOutcome {
    this.claimTerminal(session.sessionId)
    const envelope = finalizePromptEnvelope({
      session,
      envelopeId: this.deps.id("prompt-envelope"),
      displayOriginalPrompt: originalPrompt,
      effectivePrompt,
      status,
      optimizerVersion: PROMPT_OPTIMIZER_VERSION,
      finalizedAt: this.deps.now()
    })
    this.deps.audit({
      kind: "prompt:prepared",
      payload: {
        envelopeId: envelope.envelopeId,
        sessionId: envelope.sessionId,
        rootInputId: envelope.rootInputId,
        origin: envelope.origin,
        policy: envelope.policy,
        status: envelope.status,
        optimizerVersion: envelope.optimizerVersion,
        inputHash: envelope.inputHash,
        preparedTextHash: envelope.preparedTextHash,
        optimizationCount: envelope.optimizationCount
      }
    })
    return { kind: "ready", session: Object.freeze({ ...session, state: "finalized" }), envelope, artifact }
  }

  private cancelled(session: PromptPreparationSession): PromptPreparationOutcome {
    this.claimTerminal(session.sessionId)
    const terminal = Object.freeze({ ...session, state: "cancelled" as const })
    this.deps.audit({ kind: "prompt:preparation-cancelled", payload: this.sessionAudit(terminal) })
    return { kind: "cancelled", session: terminal }
  }

  private failed(session: PromptPreparationSession, error: unknown): PromptPreparationOutcome {
    this.claimTerminal(session.sessionId)
    const terminal = Object.freeze({ ...session, state: "failed" as const })
    this.deps.audit({
      kind: "prompt:preparation-failed",
      payload: { ...this.sessionAudit(terminal), error: error instanceof Error ? error.message : String(error) }
    })
    return { kind: "failed", session: terminal, error: error instanceof Error ? error.message : String(error) }
  }

  private claimTerminal(sessionId: string): void {
    if (this.terminalSessions.has(sessionId)) throw new Error("Prompt preparation already terminal")
    this.terminalSessions.add(sessionId)
  }

  private sessionAudit(session: PromptPreparationSession): Record<string, unknown> {
    return {
      sessionId: session.sessionId,
      rootInputId: session.rootInputId,
      origin: session.origin,
      policy: session.policy,
      state: session.state,
      inputHash: session.inputHash,
      preparationCount: session.preparationCount,
      optimizationCount: session.optimizationCount,
      candidateAttemptCount: session.candidateAttemptCount,
      retryOfEnvelopeId: session.retryOfEnvelopeId
    }
  }
}
~~~

Create src/main/runtime/prompt-decision-port.ts as the explicit adapter to the Decision Runtime plan:

~~~typescript
import { createPromptDecisionRequest } from "./decision-request-factories"
import type { DecisionService } from "./decision-service"
import type { PromptDecisionInput, PromptDecisionPort, PromptSelection } from "./prompt-preparation-service"

export class WorkbenchPromptDecisionPort implements PromptDecisionPort {
  constructor(private readonly decisions: DecisionService) {}

  async decide(input: PromptDecisionInput): Promise<PromptSelection> {
    if (!input.owner || input.owner.type !== "turn") throw new Error("Workbench Prompt decision requires a Turn owner")
    const options = input.candidateError
      ? [
          ...(input.retryAllowed ? [{ id: "retry-optimization", label: "Retry optimization", description: input.candidateError }] : []),
          { id: "original", label: "Keep original", description: input.originalPrompt }
        ]
      : [
          { id: "original", label: "Keep original", description: input.originalPrompt },
          ...input.candidates.map((candidate, index) => ({
            id: "candidate-" + index,
            label: "Candidate " + (index + 1),
            description: candidate
          }))
        ]
    const resolution = await this.decisions.request(createPromptDecisionRequest({
      owner: input.owner,
      kind: "single-select",
      title: "Choose the prepared Prompt",
      description: input.candidateError || "The original request is broad or ambiguous.",
      options,
      minSelections: 1,
      maxSelections: 1,
      allowCustom: true,
      customInput: { placeholder: "Write another version", maxChars: 512 * 1024 },
      idempotencyKey: "prompt-session:" + input.sessionId + ":attempt:" + input.attempt
    }))
    if (resolution.status === "cancelled" || resolution.status === "timeout" || resolution.status === "stale" || resolution.status === "denied") {
      return { kind: "cancelled" }
    }
    if (resolution.text) return { kind: "custom", text: resolution.text }
    const optionId = resolution.selectedOptionIds?.[0]
    if (optionId === "retry-optimization") return { kind: "retry-candidates" }
    if (optionId === "original") return { kind: "original" }
    const match = /^candidate-(\d+)$/.exec(optionId || "")
    if (!match) throw new Error("Prompt decision returned an unknown option")
    return { kind: "candidate", index: Number(match[1]) }
  }
}
~~~

Add this file and a focused adapter test to Task 4's file list and commit command. The Workbench create/retry wiring passes the already-created Turn owner into prepareRoot.decisionOwner; Hub and CLI provide their own PromptDecisionPort implementations in Task 7.

Create src/main/runtime/prompt-cache-context.ts so every referenced cache builder is defined:

~~~typescript
import { canonicalJson, sha256Hex } from "../../prompt-core/canonical-json"
import type { PromptCacheContext } from "./prompt-preparation-service"

const signature = (value: unknown): string => sha256Hex(canonicalJson(value))

export function promptCacheContext(input: {
  locale: string
  workspaceRoot: string | null
  contextProjection: unknown
  plugins: unknown
  skills: unknown
  attachments: unknown
  providerId: string
  modelId: string
}): PromptCacheContext {
  return {
    locale: input.locale,
    contextSignature: signature({ workspaceRoot: input.workspaceRoot, contextProjection: input.contextProjection }),
    pluginSignature: signature(input.plugins),
    skillSignature: signature(input.skills),
    attachmentSignature: signature(input.attachments),
    providerId: input.providerId,
    modelId: input.modelId
  }
}

export function hubPromptCacheContext(input: {
  locale?: string
  workspaceRoot?: string | null
  contextSignature?: string
  pluginSignature?: string
  skillSignature?: string
  attachmentSignature?: string
  providerId: string
  modelId: string
}): PromptCacheContext {
  return {
    locale: input.locale || "en-US",
    contextSignature: input.contextSignature || signature({ workspaceRoot: input.workspaceRoot || null }),
    pluginSignature: input.pluginSignature || signature([]),
    skillSignature: input.skillSignature || signature([]),
    attachmentSignature: input.attachmentSignature || signature([]),
    providerId: input.providerId,
    modelId: input.modelId
  }
}
~~~

Create src/main/runtime/prompt-preparation-composition.ts as the only production constructor:

~~~typescript
import { randomUUID } from "node:crypto"
import type { DecisionService } from "./decision-service"
import { optimizePromptForDispatch } from "./prompt-optimizer"
import { PromptCandidateGenerator, type PromptCandidateInvocation } from "./prompt-candidate-generator"
import {
  PromptPreparationService,
  type PromptDecisionPort,
  type PromptDecisionPortRouter
} from "./prompt-preparation-service"
import { WorkbenchPromptDecisionPort } from "./prompt-decision-port"
import type { HubPromptDecisionPort } from "../hub/prompt-decision-channel"

class UnsupportedPromptDecisionPort implements PromptDecisionPort {
  async decide(): Promise<{ kind: "decision-required" }> {
    return { kind: "decision-required" }
  }
}

export function createPromptPreparationComposition(input: {
  decisionService: DecisionService
  hubDecisionPort: HubPromptDecisionPort
  invokeCandidateModel(request: PromptCandidateInvocation): Promise<string>
  audit(event: { kind: string; payload: Record<string, unknown> }): void
}) {
  const workbenchPort = new WorkbenchPromptDecisionPort(input.decisionService)
  const unsupportedPort = new UnsupportedPromptDecisionPort()
  const decisionPorts: PromptDecisionPortRouter = {
    for(_origin, capability) {
      if (capability === "desktop-inline") return workbenchPort
      if (capability === "websocket") return input.hubDecisionPort
      if (capability === "none" || capability === "client-owned") return unsupportedPort
      throw new Error("Terminal Prompt decisions must use the Electron-free headless composition")
    }
  }
  const candidateGenerator = new PromptCandidateGenerator({ invoke: input.invokeCandidateModel })
  const promptPreparationService = new PromptPreparationService({
    id: prefix => prefix + "-" + randomUUID(),
    now: () => Date.now(),
    audit: input.audit,
    optimize: (prompt, context) => {
      const result = optimizePromptForDispatch({ prompt })
      return { optimizedPrompt: result.optimizedPrompt, artifact: result }
    },
    generateCandidates: (prompt, context) => candidateGenerator.generate({
      originalPrompt: prompt,
      maxPromptChars: 512 * 1024
    }),
    decisionPorts
  })
  return { promptPreparationService, candidateGenerator, decisionPorts }
}
~~~

In src/main/index.ts construct this composition once after DecisionService,
HubServer, ProviderManager, and runtimeStore exist. The candidate invocation
uses a no-tools internal:prompt-candidate DispatchEnvelope; the audit callback
persists audit-safe session/attempt events. Add a composition test that proves
desktop-inline selects WorkbenchPromptDecisionPort, websocket selects
HubPromptDecisionPort, and unsupported capabilities return decision-required.

- [ ] **Step 5: Expose pure optimizer artifacts and protect audit events**

Keep optimizePromptForDispatch in
src/main/runtime/prompt-optimizer.ts:73, but make it the injected local
optimizer implementation rather than the owner of IDs or session state.

Add these RuntimeEvent kinds in src/main/runtime/types.ts:134:

~~~typescript
| "prompt:preparation-started"
| "prompt:candidate-attempted"
| "prompt:prepared"
| "prompt:preparation-cancelled"
| "prompt:preparation-failed"
| "dispatch:prepared"
~~~

Add the same Prompt audit kinds to PROTECTED_EVENT_KINDS in
src/main/runtime/store.ts:353.

- [ ] **Step 6: Run service/core tests and typecheck**

~~~powershell
npm.cmd run test -- --run src/main/runtime/__tests__/prompt-preparation-service.test.ts src/prompt-core/__tests__/prompt-preparation-core.test.ts src/prompt-core/__tests__/prompt-candidate-validator.test.ts
npm.cmd run typecheck
~~~

Expected: all focused files pass and typecheck exits 0.

- [ ] **Step 7: Commit Task 4**

~~~powershell
git add src/main/runtime/prompt-ingress-registry.ts src/main/runtime/prompt-preparation-service.ts src/main/runtime/prompt-decision-port.ts src/main/runtime/prompt-preparation-composition.ts src/main/runtime/prompt-cache-context.ts src/main/runtime/__tests__/prompt-preparation-service.test.ts src/main/runtime/__tests__/prompt-decision-port.test.ts src/main/runtime/__tests__/prompt-preparation-composition.test.ts src/main/runtime/prompt-optimizer.ts src/main/runtime/types.ts src/main/runtime/store.ts
git commit -m "feat(prompt): add auditable preparation service"
~~~

---

### Task 5: Workbench create/retry persistence and effective history

**Files:**

- Modify: src/main/runtime/types.ts:101-116
- Modify: src/main/runtime/store.ts and RuntimeMutation from Decision Runtime Tasks B/F
- Modify: src/main/runtime/__tests__/store.test.ts:26-39
- Modify: src/shared/ipc-contract.ts:533-594
- Modify: src/renderer/vite-env.d.ts:835-894
- Modify: src/main/runtime/workbench-turn-runner.ts
- Modify: src/main/runtime/thread-execution-coordinator.ts
- Modify: src/main/ipc/turns-ipc.ts
- Modify: src/main/index.ts:200-251 only
- Modify: src/main/ipc/__tests__/turns-ipc-validation.test.ts
- Modify: src/main/runtime/__tests__/thread-execution-coordinator.test.ts
- Create: src/main/__tests__/prompt-turn-wiring.test.ts

- [ ] **Step 1: Write failing persistence and source-wiring tests**

Append to src/main/runtime/__tests__/store.test.ts:

~~~typescript
it("persists original/effective Prompt and immutable root envelope", async () => {
  const { WorkbenchRuntimeStore } = await import("../store")
  const runtime = new WorkbenchRuntimeStore()
  runtimes.push(runtime)
  const envelope = Object.freeze({
    envelopeId: "envelope-1",
    sessionId: "session-1",
    rootInputId: "input-1",
    displayOriginalPrompt: "把登录弄好",
    effectivePrompt: "Reproduce the login failure, fix its root cause, and run focused tests.",
    origin: "workbench:create" as const,
    policy: "optimize" as const,
    status: "candidate-selected" as const,
    optimizerVersion: "prompt-preparation-v1",
    inputHash: "input-hash",
    preparedTextHash: "prepared-hash",
    optimizationCount: 1 as const,
    finalizedAt: 1
  })
  const created = await runtime.createQueuedSubmission({
    payload: {
      prompt: envelope.displayOriginalPrompt,
      mode: "auto",
      workspaceId: null
    },
    ownerWebContentsId: 7,
    source: "create"
  })

  await runtime.commitRuntimeMutation(tx => {
    tx.attachPromptEnvelope(created.turn.id, envelope)
  })

  const turn = runtime.getTurn(created.turn.id)!
  expect(turn.prompt).toBe(envelope.displayOriginalPrompt)
  expect(turn.displayOriginalPrompt).toBe(envelope.displayOriginalPrompt)
  expect(turn.effectivePrompt).toBe(envelope.effectivePrompt)
  expect(turn.promptEnvelope).toEqual(envelope)
  expect(runtime.listTurns(created.thread.id)).toHaveLength(1)

  await expect(runtime.commitRuntimeMutation(tx => {
    tx.attachPromptEnvelope(created.turn.id, { ...envelope, envelopeId: "replacement" })
  })).rejects.toThrow("already has a PromptEnvelope")
})
~~~

Create src/main/__tests__/prompt-turn-wiring.test.ts:

~~~typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const runnerSource = readFileSync(
  join(process.cwd(), "src/main/runtime/workbench-turn-runner.ts"),
  "utf8"
)
const turnsIpcSource = readFileSync(join(process.cwd(), "src/main/ipc/turns-ipc.ts"), "utf8")
const indexSource = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

describe("Workbench Prompt wiring", () => {
  it("prepares the coordinator-created Turn with its trusted owner", () => {
    expect(runnerSource).toContain("runtimeStore.getTurn(submission.turnId)")
    expect(runnerSource).toContain('type: "turn"')
    expect(runnerSource).toContain("turnId: turn.id")
    expect(runnerSource).toContain("webContentsId: submission.ownerWebContentsId")
    expect(runnerSource).toContain("decisionOwner")
    expect(runnerSource).toContain('origin: "workbench:create"')
    expect(runnerSource).toContain('origin: "workbench:retry"')
    expect(runnerSource).not.toContain("createTurn(")
  })

  it("atomically attaches the finalized envelope to that same Turn", () => {
    expect(runnerSource).toContain("commitRuntimeMutation")
    expect(runnerSource).toContain("attachPromptEnvelope(turn.id, prepared.envelope)")
  })

  it("uses effective Prompt for model history and recent routing context", () => {
    expect(runnerSource).toContain("previous.effectivePrompt || previous.prompt")
    expect(runnerSource).toContain("turn.effectivePrompt || turn.prompt")
  })

  it("uses typed retry strategy and never compounds the effective Prompt", () => {
    expect(turnsIpcSource).toContain('"reuse-selection"')
    expect(turnsIpcSource).toContain('"reoptimize"')
    expect(runnerSource).toContain("retryStrategy: submission.retryStrategy")
    expect(runnerSource).toContain("reuseEnvelope: retryOfTurn?.promptEnvelope")
    expect(runnerSource).not.toContain("prompt: retryOfTurn.effectivePrompt")
  })

  it("keeps create/retry handlers out of main/index", () => {
    expect(indexSource).not.toContain('typedHandle("turns:create"')
    expect(indexSource).not.toContain('typedHandle("turns:retry"')
  })
})
~~~

- [ ] **Step 2: Run both tests and verify RED**

~~~powershell
npm.cmd run test -- --run src/main/runtime/__tests__/store.test.ts src/main/__tests__/prompt-turn-wiring.test.ts
~~~

Expected: FAIL because RuntimeMutation cannot attach a PromptEnvelope yet and
the extracted Workbench runner does not own Prompt preparation.

- [ ] **Step 3: Extend Turn persistence without breaking old stored state**

Add to WorkbenchTurn in src/main/runtime/types.ts:101:

~~~typescript
displayOriginalPrompt?: string
effectivePrompt?: string
promptEnvelope?: PromptEnvelope
~~~

Import PromptEnvelope from src/shared/prompt-contract.ts. Extend RuntimeMutation
with an atomic, write-once operation:

~~~typescript
attachPromptEnvelope(turnId: string, envelope: PromptEnvelope): WorkbenchTurn
~~~

Implement it against the cloned mutation draft. It must require the existing
Turn, reject replacing an already-attached envelope, and update only that Turn:

~~~typescript
attachPromptEnvelope(turnId, envelope) {
  const turn = draft.turns.find(candidate => candidate.id === turnId)
  if (!turn) throw new Error(`Turn not found: ${turnId}`)
  if (turn.promptEnvelope) throw new Error(`Turn ${turnId} already has a PromptEnvelope`)
  turn.prompt = envelope.displayOriginalPrompt
  turn.displayOriginalPrompt = envelope.displayOriginalPrompt
  turn.effectivePrompt = envelope.effectivePrompt
  turn.promptEnvelope = envelope
  return turn
}
~~~

Do not add these fields to the production createTurn path and do not create a
second Turn. Keep prompt as a backward-compatible display alias. Loading
version-1 state must not rewrite existing records; all consumers use field
fallbacks.

Mirror these optional fields in WorkbenchTurnLike at
src/shared/ipc-contract.ts:535 and WorkbenchTurn in
src/renderer/vite-env.d.ts:835.

- [ ] **Step 4: Prepare the already-created create/retry Turn in the runner**

In src/main/runtime/workbench-turn-runner.ts, start from the immutable queued
submission created by ThreadExecutionCoordinator. Resolve the Turn before any
Prompt decision and construct its owner from the trusted persisted sender:

~~~typescript
const turn = runtimeStore.getTurn(submission.turnId)
const thread = runtimeStore.getThread(submission.threadId)
if (!turn || !thread) throw new Error(`Queued Turn is missing: ${submission.turnId}`)

const decisionOwner: DecisionOwner = {
  type: "turn",
  workspaceId: thread.workspaceId ?? null,
  threadId: thread.id,
  turnId: turn.id,
  webContentsId: submission.ownerWebContentsId
}

const retryOfTurn = submission.retryOfTurnId
  ? runtimeStore.getTurn(submission.retryOfTurnId)
  : undefined
if (submission.source === "retry" && !retryOfTurn) {
  throw new Error(`Retry source Turn is missing: ${submission.retryOfTurnId}`)
}

const originalPrompt = retryOfTurn
  ? retryOfTurn.displayOriginalPrompt || retryOfTurn.prompt
  : turn.displayOriginalPrompt || turn.prompt
const prepared = await promptPreparationService.prepareRoot({
  origin: submission.source === "retry" ? "workbench:retry" : "workbench:create",
  prompt: promptWithGoalContext(originalPrompt, getWorkbenchGoal(thread.id)),
  cacheContext: promptCacheContext({
    workspaceId: thread.workspaceId,
    attachments: turn.attachments || [],
    locale: submission.input.locale,
    modelSelection: turnModelSelection
  }),
  decisionOwner,
  reuseEnvelope: retryOfTurn?.promptEnvelope,
  retryStrategy: submission.source === "retry"
    ? submission.retryStrategy
    : undefined
})
if (prepared.kind !== "ready") {
  throw new Error(prepared.kind === "failed" ? prepared.error : "Prompt preparation cancelled")
}
const promptOptimization = prepared.artifact as PromptOptimizerResult
const effectiveUserPrompt = prepared.envelope.effectivePrompt

await runtimeStore.commitRuntimeMutation(tx => {
  tx.attachPromptEnvelope(turn.id, prepared.envelope)
})
~~~

Use effectiveUserPrompt for pre-dispatch hooks, routing, workspace/plugin
augmentation, budget estimation, messages, and dispatch. Prompt audit events can
reference turn.id immediately because the Turn predates prepareRoot; never
buffer raw candidate text in runtime events. WorkbenchTurnRunner.start() must
contain no createTurn call.

- [ ] **Step 5: Carry explicit retry policy through typed IPC**

Add a shared typed retry input and validate the enum in turns-ipc.ts:

~~~typescript
interface TurnRetryInputLike {
  turnId: string
  retryStrategy?: "reuse-selection" | "reoptimize"
}
~~~

turns:retry passes this value to
ThreadExecutionCoordinator.enqueueRetry(input, event.sender.id). The coordinator
atomically creates the new retry Turn and persists the normalized strategy on
its QueuedThreadSubmission before acknowledging IPC. Omission normalizes to
reuse-selection; reoptimize is allowed only through this typed field. The runner
uses submission.retryStrategy in the prepareRoot call above, with the new retry
Turn's DecisionOwner. Never pass retryOfTurn.promptEnvelope.effectivePrompt to
the optimizer and never reuse the old Turn as the decision owner.

- [ ] **Step 6: Correct history and recent Prompt semantics**

Change src/main/index.ts:208 to:

~~~typescript
const previousPrompt = previous.effectivePrompt || previous.prompt
messages.push({ role: "user", content: promptWithAttachments(previousPrompt, previous.attachments) })
~~~

Change src/main/index.ts:250 to:

~~~typescript
.map(turn => turn.effectivePrompt || turn.prompt)
~~~

Rendering continues to use displayOriginalPrompt || prompt.

- [ ] **Step 7: Run focused and compatibility tests**

~~~powershell
npm.cmd run test -- --run src/main/runtime/__tests__/store.test.ts src/main/__tests__/prompt-turn-wiring.test.ts src/main/runtime/__tests__/prompt-optimizer.test.ts src/main/runtime/__tests__/dispatch-planner.test.ts
npm.cmd run test -- --run src/main/runtime/__tests__/thread-execution-coordinator.test.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts
npm.cmd run typecheck
~~~

Expected: all focused tests pass, create/retry both prepare the coordinator-created
Turn with its own DecisionOwner, and typecheck exits 0.

- [ ] **Step 8: Commit Task 5**

~~~powershell
git add src/main/runtime/types.ts src/main/runtime/store.ts src/main/runtime/__tests__/store.test.ts src/main/runtime/workbench-turn-runner.ts src/main/runtime/thread-execution-coordinator.ts src/main/ipc/turns-ipc.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/runtime/__tests__/thread-execution-coordinator.test.ts src/shared/ipc-contract.ts src/renderer/vite-env.d.ts src/main/index.ts src/main/__tests__/prompt-turn-wiring.test.ts
git commit -m "feat(prompt): persist effective Prompt across retries"
~~~

---

### Task 6: DispatchEnvelope and real send-boundary verification

**Files:**

- Create: src/main/runtime/dispatch-envelope.ts
- Create: src/main/providers/__tests__/client-dispatch-envelope.test.ts
- Modify: src/main/providers/client.ts:26-88
- Modify: src/main/hub/dispatcher.ts:202-220, 398-510, 874-914, 1465-1479, and 1637-1655
- Modify: src/main/agentic/executor.ts:88-115
- Modify: src/main/runtime/schedule-helpers.ts:155-168 and 216-241

- [ ] **Step 1: Write failing payload-hash and fail-closed tests**

Create src/main/providers/__tests__/client-dispatch-envelope.test.ts:

~~~typescript
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProviderClient } from "../client"
import {
  canonicalProviderPayload,
  createDispatchEnvelope
} from "../../runtime/dispatch-envelope"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ProviderClient DispatchEnvelope boundary", () => {
  it("rejects a payload changed after envelope creation before fetch", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const provider = {
      id: "p1", name: "P1", kind: "openai-compatible", baseUrl: "https://example.test",
      apiKey: "secret", enabled: true, builtIn: false,
      capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: "off", level: "medium" },
      models: []
    } as any
    const model = {
      id: "m1", label: "M1", contextWindow: 8_000,
      supportsTools: false, supportsVision: false, supportsThinking: false
    } as any
    const binding = {
      agentId: "test", providerId: "p1", modelId: "m1",
      temperature: 0, maxOutputTokens: 100
    } as any
    const client = new ProviderClient(provider, model, binding, { mode: "off", level: "medium" })
    const originalMessages = [{ role: "user" as const, content: "original" }]
    const payload = canonicalProviderPayload({
      providerId: "p1",
      modelId: "m1",
      protocol: "chat_completions",
      messages: originalMessages,
      systemPrompt: "",
      tools: [],
      toolChoice: null,
      thinking: { mode: "off", level: "medium" }
    })
    const envelope = createDispatchEnvelope({
      dispatchId: "dispatch-1",
      lineage: {
        origin: "workbench:create",
        policy: "optimize",
        rootInputId: "input-1",
        rootEnvelopeId: "envelope-1",
        rootPreparedTextHash: "root-hash"
      },
      payload
    })
    await client.stream({
      messages: [{ role: "user", content: "tampered" }],
      dispatchEnvelope: envelope
    }, {})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses a payload hash distinct from the root prepared-text hash", () => {
    const payload = canonicalProviderPayload({
      providerId: "p1",
      modelId: "m1",
      protocol: "chat_completions",
      messages: [{ role: "user", content: "prepared root plus workspace context" }],
      systemPrompt: "system",
      tools: [],
      toolChoice: null,
      thinking: null
    })
    const envelope = createDispatchEnvelope({
      dispatchId: "dispatch-2",
      lineage: {
        origin: "workbench:create",
        policy: "optimize",
        rootPreparedTextHash: "root-prepared-hash"
      },
      payload
    })
    expect(envelope.canonicalPayloadHash).not.toBe(envelope.rootPreparedTextHash)
  })
})
~~~

- [ ] **Step 2: Run the test and verify RED**

~~~powershell
npm.cmd run test -- --run src/main/providers/__tests__/client-dispatch-envelope.test.ts
~~~

Expected: FAIL because dispatch-envelope.ts and dispatchEnvelope CallOptions do
not exist.

- [ ] **Step 3: Implement canonical call payload and child lineage**

Create src/main/runtime/dispatch-envelope.ts:

~~~typescript
import type {
  CanonicalDispatchPayload,
  DispatchEnvelope,
  PromptDispatchLineage
} from "../../shared/prompt-contract"
import { canonicalJson, sha256Hex } from "../../prompt-core/canonical-json"

export function canonicalProviderPayload(input: {
  providerId: string
  modelId: string
  protocol: string
  systemPrompt?: string
  messages: readonly unknown[]
  attachments?: readonly unknown[]
  tools?: readonly unknown[]
  toolChoice?: unknown
  thinking?: unknown
  contextLayers?: readonly string[]
}): CanonicalDispatchPayload {
  return Object.freeze({
    providerId: input.providerId,
    modelId: input.modelId,
    protocol: input.protocol,
    systemPrompt: input.systemPrompt || "",
    messages: Object.freeze(input.messages.map(message => Object.freeze({ ...(message as object) }))) as CanonicalDispatchPayload["messages"],
    attachments: Object.freeze([...(input.attachments || [])]),
    tools: Object.freeze([...(input.tools || [])]),
    toolChoice: input.toolChoice === undefined ? null : input.toolChoice,
    thinking: input.thinking === undefined ? null : input.thinking,
    contextLayers: Object.freeze([...(input.contextLayers || [])])
  })
}

export function createDispatchEnvelope(input: {
  dispatchId: string
  lineage: PromptDispatchLineage
  payload: CanonicalDispatchPayload
}): DispatchEnvelope {
  return Object.freeze({
    dispatchId: input.dispatchId,
    ...input.lineage,
    providerId: input.payload.providerId,
    modelId: input.payload.modelId,
    canonicalPayloadHash: sha256Hex(canonicalJson(input.payload)),
    optimizationCount: 0
  })
}

export function verifyDispatchEnvelope(
  envelope: DispatchEnvelope,
  payload: CanonicalDispatchPayload
): void {
  if (envelope.providerId !== payload.providerId || envelope.modelId !== payload.modelId) {
    throw new Error("DispatchEnvelope provider/model mismatch")
  }
  const currentHash = sha256Hex(canonicalJson(payload))
  if (currentHash !== envelope.canonicalPayloadHash) {
    throw new Error("DispatchEnvelope canonical payload hash mismatch")
  }
}

export function childDispatchLineage(
  parent: PromptDispatchLineage,
  parentDispatchId: string,
  origin: PromptDispatchLineage["origin"]
): PromptDispatchLineage {
  return Object.freeze({
    origin,
    policy: "internal",
    rootInputId: parent.rootInputId,
    rootEnvelopeId: parent.rootEnvelopeId,
    rootPreparedTextHash: parent.rootPreparedTextHash,
    parentDispatchId
  })
}
~~~

- [ ] **Step 4: Verify immediately before every ProviderClient send**

Add a required dispatchEnvelope field to CallOptions in
src/main/providers/client.ts:26:

~~~typescript
dispatchEnvelope: DispatchEnvelope
attachments?: readonly unknown[]
contextLayers?: readonly string[]
~~~

At ProviderClient.stream lines 68-81, resolve provider/model/thinking, build the
canonical payload from the exact ordered system Prompt, messages, tools,
toolChoice, attachments, context layers, and thinking values, then call
verifyDispatchEnvelope before choosing the provider protocol method.

Do not catch the mismatch and continue. The existing catch may report it
through onError, but fetch must remain uncalled.

- [ ] **Step 5: Carry root lineage to HTTP, stdio, ACP, and agentic rounds**

Extend DispatchOptions in src/main/hub/dispatcher.ts:202 with:

~~~typescript
lineage: PromptDispatchLineage
parentDispatchId?: string
~~~

At each actual call boundary:

1. Resolve the final provider/model.
2. Build the canonical payload from the final system Prompt/messages or final
   local agentPrompt.
3. Create a cryptographically random dispatch ID.
4. Emit dispatch:prepared with hashes and lineage.
5. Pass the envelope into ProviderClient or verify it immediately before
   adapter.send/adapter.runPrompt.

For src/main/agentic/executor.ts:99-115, create a new internal envelope for each
iteration. Use the previous iteration dispatch ID as parentDispatchId and retain
the same rootInputId/rootEnvelopeId/rootPreparedTextHash.

For src/main/runtime/schedule-helpers.ts:231, pass:

~~~typescript
lineage: childDispatchLineage(
  input.lineage,
  input.parentDispatchId,
  "internal:schedule"
)
~~~

The schedule step must not call PromptPreparationService and must retain
optimizationCount 0.

- [ ] **Step 6: Run boundary, Dispatcher, and agentic tests**

~~~powershell
npm.cmd run test -- --run src/main/providers/__tests__/client-dispatch-envelope.test.ts src/main/hub/__tests__/provider-direct.test.ts src/main/agentic/__tests__/executor.test.ts src/main/runtime/__tests__/schedules.test.ts
npm.cmd run typecheck
~~~

Expected: all selected tests pass, no test reaches fetch with a mismatched hash,
and typecheck exits 0.

- [ ] **Step 7: Commit Task 6**

~~~powershell
git add src/main/runtime/dispatch-envelope.ts src/main/providers/__tests__/client-dispatch-envelope.test.ts src/main/providers/client.ts src/main/hub/dispatcher.ts src/main/agentic/executor.ts src/main/runtime/schedule-helpers.ts
git commit -m "feat(prompt): verify every dispatch payload envelope"
~~~

---

### Task 7: Register Hub, CLI, QuickComplete, proxy, and diagnostic funnels

**Files:**

- Create: src/main/hub/prompt-decision-channel.ts
- Create: src/main/hub/__tests__/prompt-decision-channel.test.ts
- Modify: src/main/index.ts:527-547
- Modify: src/shared/decision-contract.ts
- Modify: src/main/runtime/decision-service.ts
- Modify: src/main/runtime/__tests__/decision-service.test.ts
- Modify: src/main/runtime/headless-run.ts:23-44 and 176-200
- Modify: src/main/runtime/__tests__/headless-run.test.ts
- Modify: scripts/agenthub-cli.mjs:108 onward
- Modify: src/shared/ipc-contract.ts:321-334 and 4590-4602
- Modify: src/preload/index.ts:488-489
- Modify: src/main/ipc/missing-ipc.ts:233-279
- Modify: src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts:40-140
- Modify: src/renderer/vite-env.d.ts:2054-2063
- Modify: src/renderer/workbench/PromptEnhancer.tsx:39-43
- Modify: src/renderer/sdd/components/SddRequirementsList.tsx:526-531
- Modify: src/renderer/workbench/InlineEditAffordance.tsx:49
- Modify: src/renderer/workbench/components/panels/BrowserPanel.tsx:139-142 and 159-162
- Modify: src/main/routing/proxy.ts:283-473
- Modify: src/main/runtime/models-center.ts:135-179

- [ ] **Step 1: Write failing ingress behavior tests**

Add to src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts:

~~~typescript
it.each([
  "quick-complete:prompt-enhancer",
  "quick-complete:sdd-requirements",
  "quick-complete:inline-edit",
  "quick-complete:browser-summary",
  "quick-complete:browser-analysis"
] as const)("accepts registered structured origin %s", async origin => {
  const providerMgr = {
    getProvider: vi.fn(),
    getEnabledProviders: vi.fn()
  }
  const { registerMissingIpc } = await import("../missing-ipc")
  registerMissingIpc({
    dispatcher: null,
    runtimeStore: null,
    registry: null,
    providerMgr,
    proxy: null,
    hub: null,
    getMainWindow: () => null,
    memory: () => null
  })
  const handler = electronMock.handlers.get("ai:quickComplete")
  await handler?.({}, { origin, prompt: "structured input" })
  expect(ProviderClient).toHaveBeenCalledTimes(1)
})

it("rejects QuickComplete without a registered origin", async () => {
  const providerMgr = {
    getProvider: vi.fn(),
    getEnabledProviders: vi.fn()
  }
  const { registerMissingIpc } = await import("../missing-ipc")
  registerMissingIpc({
    dispatcher: null,
    runtimeStore: null,
    registry: null,
    providerMgr,
    proxy: null,
    hub: null,
    getMainWindow: () => null,
    memory: () => null
  })
  const handler = electronMock.handlers.get("ai:quickComplete")
  expect(handler?.({}, { prompt: "missing origin" }))
    .toEqual({ ok: false, error: "Invalid IPC payload: input.origin is invalid" })
})
~~~

Add to src/main/runtime/__tests__/headless-run.test.ts:

~~~typescript
const dependencies = {
  preparePrompt: vi.fn(async () => ({
    kind: "decision-required" as const,
    sessionId: "session-1",
    candidates: ["Repair the focused defect.", "Audit and repair the whole module."]
  })),
  spawnAgent: vi.fn(async (prompt: string) => ({
    ok: true,
    status: "completed" as const,
    stdout: prompt,
    stderr: "",
    exitCode: 0
  }))
}

it("returns decision_required without dispatch for ambiguous non-TTY input", async () => {
  const result = await runHeadlessAgent({
    prompt: "把这个弄好",
    workspace: workspaceRoot,
    nonInteractive: true
  }, dependencies)
  expect(result.status).toBe("decision_required")
  expect(dependencies.spawnAgent).not.toHaveBeenCalled()
})

it("dispatches the finalized CLI effective Prompt once", async () => {
  dependencies.preparePrompt.mockResolvedValueOnce({
    kind: "ready" as const,
    envelope: { effectivePrompt: "Repair the focused defect." }
  })
  const result = await runHeadlessAgent({
    prompt: "把这个弄好",
    workspace: workspaceRoot,
    nonInteractive: false
  }, dependencies)
  expect(result.status).toBe("completed")
  expect(dependencies.spawnAgent).toHaveBeenCalledTimes(1)
  expect(dependencies.spawnAgent.mock.calls[0][0]).not.toBe("把这个弄好")
})
it("selects an indexed TTY candidate", async () => {
  const io = promptIo(["2"])
  await expect(pickPromptInTty({
    originalPrompt: "original",
    candidates: ["candidate one", "candidate two"]
  }, io)).resolves.toEqual({ kind: "candidate", index: 1 })
  expect(io.close).toHaveBeenCalledOnce()
})

it("accepts a non-empty custom TTY Prompt", async () => {
  const io = promptIo(["3", "my exact custom prompt"])
  await expect(pickPromptInTty({
    originalPrompt: "original",
    candidates: ["candidate one", "candidate two"]
  }, io)).resolves.toEqual({ kind: "custom", text: "my exact custom prompt" })
})
~~~

Create src/main/hub/__tests__/prompt-decision-channel.test.ts. Use a real
DecisionService fixture and a PromptPreparationService wired to the Hub port:

~~~typescript
it("emits a bounded request and resumes the same Hub preparation promise", async () => {
  const fixture = hubPromptFixture({ sessionId: "hub-a", supportsProtocol: true })
  const preparation = fixture.startPreparation()
  const frame = await fixture.nextRequest()
  expect(frame).toMatchObject({
    type: "prompt:decision_request",
    payload: { sessionId: "hub-a" }
  })
  expect(frame.payload.candidates).toHaveLength(2)
  expect(JSON.stringify(frame).length).toBeLessThanOrEqual(HUB_PROMPT_DECISION_FRAME_MAX_BYTES)

  await expect(fixture.channel.resolve({
    type: "prompt:decision_resolve",
    payload: {
      requestId: frame.payload.requestId,
      sessionId: "hub-a",
      kind: "candidate",
      candidateIndex: 0
    }
  }, { type: "hub", sessionId: "hub-a" })).resolves.toEqual({ accepted: true })
  await expect(preparation).resolves.toMatchObject({
    kind: "ready",
    envelope: { effectivePrompt: fixture.candidates[0] }
  })
})

it("rejects a resolver authenticated as another Hub session", async () => {
  const fixture = hubPromptFixture({ sessionId: "hub-a", supportsProtocol: true })
  const preparation = fixture.startPreparation()
  const frame = await fixture.nextRequest()
  await expect(fixture.channel.resolve({
    type: "prompt:decision_resolve",
    payload: { requestId: frame.payload.requestId, sessionId: "hub-a", kind: "original" }
  }, { type: "hub", sessionId: "hub-b" })).resolves.toEqual({ accepted: false })
  expect(await promiseState(preparation)).toBe("pending")
  await fixture.cancel()
})

it("returns decision_required without dispatch for an unsupported client", async () => {
  const fixture = hubPromptFixture({ sessionId: "hub-a", supportsProtocol: false })
  await expect(fixture.handleChat("fix it")).resolves.toMatchObject({
    type: "decision_required",
    code: "PROMPT_DECISION_REQUIRED"
  })
  expect(fixture.dispatch).not.toHaveBeenCalled()
})
~~~

- [ ] **Step 2: Run QuickComplete and CLI tests and verify RED**

~~~powershell
npm.cmd run test -- --run src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts src/main/runtime/__tests__/headless-run.test.ts src/main/hub/__tests__/prompt-decision-channel.test.ts
~~~

Expected: FAIL because origin is not required and headless input has no
preparation result.

- [ ] **Step 3: Require a structured QuickComplete origin**

Change QuickCompleteInputLike in src/shared/ipc-contract.ts:321:

~~~typescript
export type QuickCompleteOriginLike =
  | "quick-complete:prompt-enhancer"
  | "quick-complete:sdd-requirements"
  | "quick-complete:inline-edit"
  | "quick-complete:browser-summary"
  | "quick-complete:browser-analysis"

export interface QuickCompleteInputLike {
  origin: QuickCompleteOriginLike
  prompt: string
  systemPrompt?: string
  providerId?: string
  modelId?: string
  timeoutMs?: number
  workspaceRoot?: string
}
~~~

At validateQuickCompleteInput lines 4595-4601 validate origin with the exact
five-value enum before prompt.

Add origin at every Renderer caller:

- PromptEnhancer.tsx: origin quick-complete:prompt-enhancer
- SddRequirementsList.tsx: origin quick-complete:sdd-requirements
- InlineEditAffordance.tsx: origin quick-complete:inline-edit
- BrowserPanel summary call: origin quick-complete:browser-summary
- BrowserPanel analysis call: origin quick-complete:browser-analysis

The preload remains a typed passthrough and does not invent an origin.

Add a dedicated draft-candidate IPC rather than reusing the one-string QuickComplete result:

~~~typescript
export interface PromptCandidateInputLike {
  origin: "quick-complete:prompt-enhancer"
  prompt: string
  draftHash: string
}

export interface PromptCandidateResultLike {
  candidates: string[]
  draftHash: string
}
~~~

Register ai:promptCandidates in missing-ipc.ts. Its handler invokes PromptCandidateGenerator with tools disabled, returns only a validated 2-3 item candidate set, and echoes the draftHash. Add the channel to ipc-contract.ts, preload/index.ts, vite-env.d.ts, and missing-ipc-quick-complete.test.ts.

Replace PromptEnhancer's immediate onEnhanced callback with onCandidates. The Renderer creates the local DraftDecisionItem defined by the Decision Runtime plan:

~~~typescript
const result = await window.electronAPI.ai.promptCandidates({
  origin: "quick-complete:prompt-enhancer",
  prompt: text,
  draftHash
})
if (result.draftHash !== currentDraftHash()) return
onCandidates({
  original: text,
  candidates: result.candidates,
  draftHash: result.draftHash,
  draftRevision
})
~~~

The local item maps original plus every candidate to stable local option IDs and keeps DecisionBar's existing Other/custom input. It never calls turns:resolveDecision. This replaces the temporary one-enhanced-option adapter from the Decision Runtime plan and satisfies the final 2-3 candidate requirement.

- [ ] **Step 4: Prepare structured QuickComplete and attach its root lineage**

At src/main/ipc/missing-ipc.ts:233:

1. Require the registry entry.
2. Start one structured preparation session.
3. Finalize the unchanged structured Prompt with optimizationCount 0.
4. Add workspace context only after finalization.
5. Build a separate DispatchEnvelope for the expanded provider payload.
6. Pass the envelope to ProviderClient.stream.

The resulting root prepared-text hash therefore covers input.prompt, while the
dispatch hash covers workspace context, systemPrompt, provider/model, and final
messages.

- [ ] **Step 5: Prepare Hub and CLI roots with capability-aware decisions**

Create src/main/hub/prompt-decision-channel.ts. Extend the Decision Runtime
contract so resolver authority cannot confuse Renderer and Hub identities:

~~~typescript
export type DecisionResolverScope =
  | { type: "webContents"; webContentsId: number; workspaceId: string | null }
  | { type: "hub"; sessionId: string }
~~~

DecisionService.resolve accepts this union. A Turn owner matches only a
webContents scope with the same trusted webContentsId/workspace; a Hub owner
matches only a Hub scope with the same authenticated sessionId. Update existing
Renderer callers to pass type: "webContents". Never derive resolver scope from
a WebSocket payload.

Implement a per-authenticated-session Hub port and bounded wire frames:

~~~typescript
export const HUB_PROMPT_DECISION_FRAME_MAX_BYTES = 64 * 1024
const MAX_CANDIDATES = 3
const MAX_CANDIDATE_CHARS = 16 * 1024
const MAX_CUSTOM_CHARS = 512 * 1024

export class HubPromptDecisionChannel implements PromptDecisionPort {
  constructor(private readonly input: {
    sessionId: string
    supportsProtocol: boolean
    decisions: DecisionService
    send(frame: HubPromptDecisionRequestFrame | HubDecisionRequiredFrame): void
  }) {}

  async decide(input: PromptDecisionInput): Promise<PromptSelection> {
    if (input.owner?.type !== "hub" || input.owner.sessionId !== this.input.sessionId) {
      throw new Error("Hub Prompt decision owner does not match the authenticated session")
    }
    if (!this.input.supportsProtocol) return { kind: "decision-required" }
    assertBoundedCandidates(input.candidates, MAX_CANDIDATES, MAX_CANDIDATE_CHARS)
    const request = createPromptDecisionRequest({
      owner: { type: "hub", sessionId: this.input.sessionId },
      input,
      maxCustomChars: MAX_CUSTOM_CHARS
    })
    const continuation = this.input.decisions.request(request)
    const frame = toBoundedHubPromptDecisionRequest(request, input)
    if (Buffer.byteLength(JSON.stringify(frame), "utf8") > HUB_PROMPT_DECISION_FRAME_MAX_BYTES) {
      throw new Error("Hub Prompt decision frame exceeds the transport limit")
    }
    this.input.send(frame)
    return toPromptSelection(await continuation)
  }

  resolve(frame: HubPromptDecisionResolveFrame, scope: DecisionResolverScope) {
    const parsed = validateHubPromptDecisionResolve(frame, MAX_CUSTOM_CHARS)
    if (scope.type !== "hub" ||
        scope.sessionId !== this.input.sessionId ||
        parsed.payload.sessionId !== scope.sessionId) {
      return Promise.resolve({ accepted: false })
    }
    return this.input.decisions.resolve(toDecisionSubmission(parsed.payload), scope)
  }
}
~~~

prompt:decision_request contains only bounded requestId, sessionId, attempt,
original preview, 2-3 candidates, retryAllowed, and custom-input limits.
prompt:decision_resolve contains requestId, sessionId, and exactly one of
original/candidate/custom/retry/cancel. The WebSocket handler constructs
{ type: "hub", sessionId: authenticatedSession.id } from connection state and
passes that scope to resolve. The DecisionService continuation awaited by
decide is the same promise awaited by PromptPreparationService.

At src/main/index.ts:527, a Hub chat request advertises
payload.promptDecisionProtocol === true. For every chat:message:

~~~typescript
const decisionOwner: DecisionOwner = {
  type: "hub",
  sessionId: authenticatedSession.id
}
const promptDecisions = new HubPromptDecisionChannel({
  sessionId: authenticatedSession.id,
  supportsProtocol: message.payload.promptDecisionProtocol === true,
  decisions: decisionService,
  send: frame => authenticatedSession.send(frame)
})
const prepared = await promptPreparationService.prepareRoot({
  origin: "hub:websocket",
  prompt: message.payload.text,
  cacheContext: hubPromptCacheContext(message.payload),
  decisionOwner
})
~~~

If candidates are required and the client did not advertise the protocol,
broadcast:

~~~typescript
{
  type: "decision_required",
  code: "PROMPT_DECISION_REQUIRED",
  sessionId: session.sessionId,
  candidates
}
~~~

and return before Dispatcher dispatch. A capable client resolves through the
Hub decision protocol and the same session resumes.

In src/main/runtime/headless-run.ts, import only src/prompt-core and injected
candidate/selection adapters; do not import Electron, runtime store, workspace
manager, or main-process singletons. TTY presents indexed candidates plus keep
original/custom. Non-TTY returns status decision_required with bounded JSON and
does not spawn an Agent. scripts/agenthub-cli.mjs prints that JSON and exits
with the documented non-zero decision-required code.

Add this Electron-free boundary in headless-run.ts and call it before the existing spawn/persist branch:

~~~typescript
export type HeadlessPromptPreparation =
  | { kind: "ready"; envelope: Pick<PromptEnvelope, "effectivePrompt"> }
  | { kind: "decision-required"; sessionId: string; candidates: readonly string[] }

export interface HeadlessRunDependencies {
  preparePrompt(input: { prompt: string; workspace: string; nonInteractive: boolean }): Promise<HeadlessPromptPreparation>
  spawnAgent(prompt: string, input: HeadlessRunInput): Promise<HeadlessRunResult>
}

export async function runHeadlessAgent(input: HeadlessRunInput, dependencies: HeadlessRunDependencies): Promise<HeadlessRunResult> {
  const prepared = await dependencies.preparePrompt({
    prompt: input.prompt,
    workspace: input.workspace,
    nonInteractive: input.nonInteractive === true
  })
  if (prepared.kind === "decision-required") {
    const now = new Date().toISOString()
    return {
      runId: "decision-" + prepared.sessionId,
      ok: false,
      status: "decision_required",
      workspace: input.workspace,
      promptChars: input.prompt.length,
      mode: input.mode || "auto",
      agent: input.agentBinary || input.agentId || null,
      mock: Boolean(input.mock),
      dryRun: Boolean(input.dryRun),
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      exitCode: 6,
      error: JSON.stringify({ code: "PROMPT_DECISION_REQUIRED", sessionId: prepared.sessionId, candidates: prepared.candidates }),
      stdout: "",
      stderr: ""
    }
  }
  return dependencies.spawnAgent(prepared.envelope.effectivePrompt, input)
}
~~~

Extend HeadlessRunInput with nonInteractive?: boolean and HeadlessRunRecord.status with decision_required. Production dependencies reuse the pure preparation core and the existing spawn/persist function; tests inject deterministic ports as shown above.

- [ ] **Step 6: Register passthrough proxy and internal diagnostic calls**

At src/main/routing/proxy.ts:

- OpenAI route uses external-proxy:openai.
- Anthropic route uses external-proxy:anthropic.
- Agent route uses external-proxy:agent.
- None creates a PromptPreparationSession.
- Each creates a passthrough DispatchEnvelope over the exact converted payload.

At src/main/runtime/models-center.ts:163-179 use
internal:model-diagnostic, optimizationCount 0, no root envelope, and its own
dispatch hash.

After all callers are migrated, make CallOptions.dispatchEnvelope required at
compile time and retain the runtime missing-envelope error.

- [ ] **Step 7: Run every affected ingress test**

~~~powershell
npm.cmd run test -- --run src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/runtime/__tests__/headless-run.test.ts src/main/runtime/__tests__/provider-doctor.test.ts src/main/providers/__tests__/client-dispatch-envelope.test.ts src/main/hub/__tests__/provider-direct.test.ts
npm.cmd run typecheck
~~~

Expected: all selected tests pass, every QuickComplete caller typechecks with
an origin, and no model call omits a DispatchEnvelope.

- [ ] **Step 8: Commit Task 7**

~~~powershell
git add src/main/index.ts src/main/runtime/headless-run.ts src/main/runtime/__tests__/headless-run.test.ts scripts/agenthub-cli.mjs src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/missing-ipc.ts src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts src/renderer/vite-env.d.ts src/renderer/workbench/PromptEnhancer.tsx src/renderer/sdd/components/SddRequirementsList.tsx src/renderer/workbench/InlineEditAffordance.tsx src/renderer/workbench/components/panels/BrowserPanel.tsx src/main/routing/proxy.ts src/main/runtime/models-center.ts
git commit -m "feat(prompt): register every AI input funnel"
~~~

---

### Task 8: Exhaustive ingress contract and full verification

**Files:**

- Create: src/main/runtime/__tests__/prompt-ingress-contract.test.ts
- Modify: src/main/__tests__/prompt-turn-wiring.test.ts
- Test: all Prompt/core/runtime/provider/IPC suites

- [ ] **Step 1: Write the failing exhaustive source contract**

Create src/main/runtime/__tests__/prompt-ingress-contract.test.ts:

~~~typescript
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  PROMPT_INGRESS_REGISTRY,
  requirePromptIngress
} from "../prompt-ingress-registry"

const ROOT = process.cwd()

const EXPECTED_CALLSITES = [
  { file: "src/main/index.ts", origin: "workbench:create", marker: 'typedHandle("turns:create"' },
  { file: "src/main/index.ts", origin: "workbench:retry", marker: 'typedHandle("turns:retry"' },
  { file: "src/main/index.ts", origin: "hub:websocket", marker: 'message.type === "chat:message"' },
  { file: "src/main/runtime/headless-run.ts", origin: "cli:headless", marker: "runHeadless" },
  { file: "src/main/ipc/missing-ipc.ts", origin: "quick-complete", marker: 'typedHandle("ai:quickComplete"' },
  { file: "src/main/routing/proxy.ts", origin: "external-proxy", marker: "streamWithFailover" },
  { file: "src/main/runtime/models-center.ts", origin: "internal:model-diagnostic", marker: "client.stream" },
  { file: "src/main/runtime/schedule-helpers.ts", origin: "internal:schedule", marker: "dispatcher.dispatch" },
  { file: "src/main/agentic/executor.ts", origin: "internal:agentic-round", marker: "client.stream" }
] as const

describe("Prompt ingress contract", () => {
  it("contains no unregistered registry key", () => {
    for (const origin of Object.keys(PROMPT_INGRESS_REGISTRY)) {
      expect(() => requirePromptIngress(origin as keyof typeof PROMPT_INGRESS_REGISTRY)).not.toThrow()
    }
  })

  it.each(EXPECTED_CALLSITES)("$file registers $origin", ({ file, origin, marker }) => {
    const source = readFileSync(join(ROOT, file), "utf8")
    expect(source).toContain(marker)
    if (origin === "quick-complete") {
      expect(source).toContain("requirePromptIngress(input.origin)")
    } else if (origin === "external-proxy") {
      expect(source).toMatch(/external-proxy:(?:openai|anthropic|agent)/u)
    } else {
      expect(source).toContain(origin)
    }
  })

  it("requires an envelope at every direct ProviderClient stream call", () => {
    const files = [
      "src/main/hub/dispatcher.ts",
      "src/main/agentic/executor.ts",
      "src/main/ipc/missing-ipc.ts",
      "src/main/routing/proxy.ts",
      "src/main/runtime/models-center.ts"
    ]
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8")
      const streamCalls = source.match(/client\.stream\s*\(\s*\{/gu) || []
      const envelopeFields = source.match(/dispatchEnvelope\s*:/gu) || []
      expect(envelopeFields.length, file).toBeGreaterThanOrEqual(streamCalls.length)
    }
  })

  it("keeps internal calls out of root preparation", () => {
    const schedule = readFileSync(join(ROOT, "src/main/runtime/schedule-helpers.ts"), "utf8")
    const agentic = readFileSync(join(ROOT, "src/main/agentic/executor.ts"), "utf8")
    expect(schedule).not.toContain("prepareRoot(")
    expect(agentic).not.toContain("prepareRoot(")
    expect(schedule).toContain("optimizationCount")
    expect(agentic).toContain("optimizationCount")
  })
})
~~~

- [ ] **Step 2: Run the contract test and verify RED**

~~~powershell
npm.cmd run test -- --run src/main/runtime/__tests__/prompt-ingress-contract.test.ts
~~~

Expected: FAIL for any missing origin marker, direct model call without
dispatchEnvelope, or internal call that starts a root session.

- [ ] **Step 3: Close only the reported funnel gaps**

For each failure:

1. Identify whether it is a root, structured, passthrough, or internal origin.
2. Add the exact registry origin at the owning caller.
3. Root/structured calls use PromptPreparationService.
4. Passthrough/internal calls create only DispatchEnvelope.
5. Add no generic fallback origin.
6. Re-run the contract after each correction.

Do not weaken the expected callsite list or use a catch-all origin to make the
test green.

- [ ] **Step 4: Prove retry, cache, and double-hash invariants together**

Run:

~~~powershell
npm.cmd run test -- --run src/prompt-core/__tests__/canonical-json.test.ts src/prompt-core/__tests__/prompt-preparation-core.test.ts src/prompt-core/__tests__/prompt-candidate-validator.test.ts src/main/runtime/__tests__/prompt-preparation-service.test.ts src/main/providers/__tests__/client-dispatch-envelope.test.ts src/main/__tests__/prompt-turn-wiring.test.ts src/main/runtime/__tests__/prompt-ingress-contract.test.ts
~~~

Expected: all Prompt pipeline tests pass. The assertions must demonstrate:

- one preparation-started and one prepared event per dispatched root;
- no envelope for cancelled/failed sessions;
- retry status reused-selection without candidate generation;
- fresh session/envelope IDs on cache hits;
- distinct prepared-text and canonical payload hashes;
- internal count 0 with retained root lineage.

- [ ] **Step 5: Run full project verification from a fresh command**

~~~powershell
npm.cmd run typecheck
npm.cmd run test -- --reporter=dot
npm.cmd run build
npm.cmd run test:e2e
git diff --check
git status --short
~~~

Expected:

- typecheck exits 0;
- the full Vitest suite has zero failures;
- build exits 0;
- Playwright E2E has zero new failures;
- git diff --check exits 0;
- git status lists only intended Prompt pipeline changes plus the pre-existing
  protected dirty-worktree changes.

Record any pre-existing baseline-red result separately. Do not describe a
baseline failure as introduced by this implementation, and do not describe an
unrun command as passing.

- [ ] **Step 6: Review the final diff against every invariant**

Use:

~~~powershell
git diff -- src/shared/prompt-contract.ts src/prompt-core src/main/runtime/prompt-ingress-registry.ts src/main/runtime/prompt-preparation-service.ts src/main/runtime/prompt-candidate-generator.ts src/main/runtime/dispatch-envelope.ts src/main/providers/client.ts src/main/hub/dispatcher.ts src/main/index.ts src/main/ipc/missing-ipc.ts src/main/routing/proxy.ts src/main/runtime/headless-run.ts scripts/agenthub-cli.mjs
~~~

Verify line by line that no root path bypasses preparation, no internal path
creates a root session, no retry feeds effectivePrompt into the optimizer, and
no cache value stores request/session/owner state.

- [ ] **Step 7: Commit Task 8**

~~~powershell
git add src/main/runtime/__tests__/prompt-ingress-contract.test.ts src/main/__tests__/prompt-turn-wiring.test.ts
git commit -m "test(prompt): enforce every AI ingress contract"
~~~

---

## Completion evidence required in the handoff

The final handoff must include:

- the exact count of registered origins by policy;
- the focused Prompt test file/test counts;
- fresh typecheck, full Vitest, build, and E2E exit status;
- one captured Workbench create audit sequence;
- one retry audit sequence showing reused-selection;
- one structured QuickComplete sequence showing optimizationCount 0;
- one Schedule or Agentic child sequence showing root lineage plus a distinct
  canonicalPayloadHash;
- confirmation that the dirty worktree's unrelated changes were neither
  staged, reverted, nor reformatted.
