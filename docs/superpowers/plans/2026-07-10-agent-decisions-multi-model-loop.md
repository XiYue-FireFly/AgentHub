# Agent Decisions and Multi-Model Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured same-turn Agent decisions and an explicitly enabled, bounded multi-model fusion loop that accepts only a prepared root Prompt, uses distinct resolved models, keeps all internal streams hidden, and releases one final answer.

**Architecture:** The production Dispatcher remains the only model transport. A typed decision tool continues the existing HTTP tool loop, while a synchronous DispatchHandle exposes cancellation before an asynchronous branch finishes. MultiModelLoopRunner receives an already prepared root envelope, selects read-only routes by resolved provider/model identity, reserves each round's aggregate budget atomically, and performs candidate, synthesis, and judge calls for at most three rounds. Plain stdio transports are excluded because their side effects cannot be constrained in code.

**Tech Stack:** Electron 33, Node.js 24, TypeScript 5.6, Vitest 4, React 18, existing ProviderManager, Dispatcher, RuntimeStore, and agentic HTTP/ACP transports.

---

## Execution boundaries

- Treat docs/superpowers/specs/2026-07-10-multi-model-loop-prompt-decisions-design.md as the acceptance source.
- Preserve all unrelated dirty-worktree changes. Stage only paths named in each task.
- Do not extend src/main/loop/agent-loop.ts or src/main/loop/multi-model-aggregator.ts.
- This plan consumes the prepared-root envelope produced by the Prompt Preparation plan. Internal candidate, synthesizer, judge, and executor calls always carry optimizationCount: 0.
- Current anchors: Dispatcher options at src/main/hub/dispatcher.ts:202-220; dispatch lifecycle at :341-395; binding selection at :649-692 and :830-884; cancellation at :1123-1180; ACP at :1615-1676; provider resolution at src/main/providers/manager.ts:668-748; agentic schemas at src/main/agentic/tools.ts:27-81; agentic loop at src/main/agentic/executor.ts:29-192; budget checks at src/main/runtime/budget-center.ts:54-140.

## File responsibility map

- src/main/agentic/user-decision-tool.ts: neutral Agent decision schema, validation, and tool-result serialization.
- src/main/agentic/user-decision-adapter.ts: bind one authoritative DecisionOwner to DecisionService and expose per-Agent AgentDecisionRequester callbacks.
- src/main/hub/dispatch-capabilities.ts: transport-level capability checks shared by Dispatcher and tests.
- src/main/runtime/multi-model-routes.ts: resolved route deduplication and role topology selection.
- src/main/runtime/budget-reservations.ts: synchronous aggregate reservation ledger.
- src/main/runtime/multi-model-loop-prompts.ts: pure role Prompts, Judge parser, and deterministic revision selection.
- src/main/runtime/multi-model-loop.ts: bounded orchestration, cancellation, partial-failure handling, and one final release.
- src/main/runtime/multi-model-dispatch.ts: prepared-root gate and ordinary-versus-fusion selection.
- Existing Dispatcher, agentic executor, runtime types, IPC contract, main wiring, and Composer files receive narrow integration edits only.

### Task 1: Structured request_user_decision tool across HTTP and Agent transports

**Files:**
- Create: src/main/agentic/user-decision-tool.ts
- Create: src/main/agentic/user-decision-adapter.ts
- Create: src/main/agentic/user-decision-transport.ts
- Create: src/main/agentic/__tests__/user-decision-tool.test.ts
- Create: src/main/agentic/__tests__/user-decision-adapter.test.ts
- Create: src/main/agentic/__tests__/user-decision-transport.test.ts
- Create: src/main/hub/__tests__/dispatcher-decision-transport.test.ts
- Modify: src/main/agentic/executor.ts:8-12,29-51,94-188
- Modify: src/main/hub/adapters/agent-adapter.ts:4-16
- Modify: src/main/hub/adapters/stdio-adapter.ts:87-93,258-285
- Modify: src/main/hub/dispatcher.ts:202-220,1059-1090

- [ ] **Step 1: Write the failing schema and continuation tests**

Create src/main/agentic/__tests__/user-decision-tool.test.ts:

~~~ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requests: [] as any[],
  script: [] as Array<(callbacks: any) => void>,
  streamIndex: 0,
  executeToolCalls: 0
}))

vi.mock('../../providers/client', () => ({
  buildProviderClient: () => ({
    stream: (request: any, callbacks: any) => {
      h.requests.push(request)
      const step = h.script[h.streamIndex++]
      step(callbacks)
    }
  })
}))

vi.mock('../tools', () => ({
  AGENTIC_TOOLS: [],
  executeTool: async () => {
    h.executeToolCalls += 1
    return { ok: true, output: 'unexpected workspace tool' }
  }
}))

beforeEach(() => {
  h.requests = []
  h.script = []
  h.streamIndex = 0
  h.executeToolCalls = 0
  vi.resetModules()
})

describe('request_user_decision', () => {
  it('rejects duplicate options and privileged Agent fields', async () => {
    const { parseAgentDecisionInput } = await import('../user-decision-tool')
    expect(() => parseAgentDecisionInput({
      idempotencyKey: 'step-1',
      title: 'Choose scope',
      options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }]
    })).toThrow(/unique/)
    expect(() => parseAgentDecisionInput({
      idempotencyKey: 'step-2',
      title: 'Approve command',
      options: [{ id: 'yes', label: 'Yes' }],
      risk: 'critical'
    })).toThrow(/unsupported field: risk/)
  })

  it('waits for a typed choice and resumes the same HTTP tool loop', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [
      callbacks => callbacks.onDone({
        finishReason: 'tool_calls',
        toolCalls: [{
          id: 'decision-1',
          function: {
            name: 'request_user_decision',
            arguments: JSON.stringify({
              idempotencyKey: 'scope-step',
              title: 'Choose scope',
              options: [
                { id: 'focused', label: 'Focused repair' },
                { id: 'full', label: 'Full audit' }
              ]
            })
          }
        }]
      }),
      callbacks => {
        callbacks.onContent('continued')
        callbacks.onDone({ finishReason: 'stop' })
      }
    ]
    const requestUserDecision = vi.fn(async () => ({
      status: 'selected' as const,
      selectedOptionIds: ['focused'],
      resolvedAt: 10
    }))

    const result = await runAgenticHttp({
      userText: 'repair it',
      systemPrompt: 'system',
      resolved: {} as any,
      thinking: {} as any,
      root: 'C:\\workspace',
      isCancelled: () => false,
      requestUserDecision,
      emit: { delta: () => {}, activity: () => {} }
    })

    expect(requestUserDecision).toHaveBeenCalledTimes(1)
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'decision-1',
      content: JSON.stringify({
        status: 'selected',
        selectedOptionIds: ['focused'],
        resolvedAt: 10
      })
    })
    expect(h.executeToolCalls).toBe(0)
    expect(result.content).toBe('continued')
  })
})
~~~

- [ ] **Step 2: Write the failing DecisionService adapter tests**

Create src/main/agentic/__tests__/user-decision-adapter.test.ts. This test deliberately uses DecisionOwner.type from the shared contract; DecisionOwner has no kind discriminator:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import type { DecisionOwner } from '../../../shared/decision-contract'
import { createUserDecisionAdapter } from '../user-decision-adapter'

describe('createUserDecisionAdapter', () => {
  it('maps an Agent multi-select request to the trusted factory and DecisionService', async () => {
    const signal = new AbortController().signal
    const request = vi.fn(async (_request: unknown, _options: unknown) => ({
      requestId: 'decision-1',
      status: 'selected' as const,
      selectedOptionIds: ['focused', 'tests'],
      resolvedAt: 25
    }))
    const owner: DecisionOwner = {
      type: 'turn',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceId: 'workspace-1',
      webContentsId: 42
    }
    const adapter = createUserDecisionAdapter({
      decisionService: { request } as any,
      owner
    })

    const resolution = await adapter.forAgent('codex', signal)({
      idempotencyKey: 'scope-step',
      title: 'Choose scope',
      description: 'Select every required workstream.',
      options: [
        { id: 'focused', label: 'Focused repair' },
        { id: 'tests', label: 'Regression tests' }
      ],
      selectionMode: 'multi',
      minSelections: 1,
      maxSelections: 2,
      allowCustom: false
    })

    expect(request).toHaveBeenCalledTimes(1)
    const [createdRequest, options] = request.mock.calls[0]
    expect(createdRequest).toMatchObject({
      owner,
      source: 'agent',
      kind: 'multi-select',
      minSelections: 1,
      maxSelections: 2,
      allowRemember: false,
      idempotencyKey: 'codex:scope-step'
    })
    expect(createdRequest.owner.type).toBe('turn')
    expect(createdRequest.owner).not.toHaveProperty('kind')
    expect(options).toEqual({ signal })
    expect(resolution).toEqual({
      status: 'selected',
      selectedOptionIds: ['focused', 'tests'],
      text: undefined,
      resolvedAt: 25
    })
  })

  it('maps custom input and terminal denial without exposing privileged fields', async () => {
    const request = vi.fn(async (_request: unknown, _options: unknown) => ({
      requestId: 'decision-2',
      status: 'denied' as const,
      resolvedAt: 30
    }))
    const owner: DecisionOwner = {
      type: 'hub',
      sessionId: 'hub-session-1'
    }
    const adapter = createUserDecisionAdapter({
      decisionService: { request } as any,
      owner
    })

    const resolution = await adapter.forAgent('claude')({
      idempotencyKey: 'format-step',
      title: 'Choose output format',
      options: [{ id: 'markdown', label: 'Markdown' }],
      selectionMode: 'single',
      minSelections: 1,
      maxSelections: 1,
      allowCustom: true
    })

    const [createdRequest] = request.mock.calls[0]
    expect(createdRequest).toMatchObject({
      owner: { type: 'hub', sessionId: 'hub-session-1' },
      kind: 'single-select',
      allowCustom: true,
      customInput: {
        placeholder: 'Enter another answer',
        maxChars: 16 * 1024
      },
      allowRemember: false,
      idempotencyKey: 'claude:format-step'
    })
    expect(createdRequest).not.toHaveProperty('deadlineMs')
    expect(createdRequest.metadata).toBeUndefined()
    expect(resolution).toEqual({
      status: 'denied',
      selectedOptionIds: undefined,
      text: undefined,
      resolvedAt: 30
    })
  })
})
~~~

- [ ] **Step 3: Write the failing structured transport and same-Turn checkpoint tests**

Create src/main/agentic/__tests__/user-decision-transport.test.ts. A decision is a protocol object, never text that merely resembles a question:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import {
  continueAgentDecisionEvent,
  parseAgentDecisionRequestEvent
} from '../user-decision-transport'

const request = {
  idempotencyKey: 'scope-step',
  title: 'Choose scope',
  options: [
    { id: 'focused', label: 'Focused repair' },
    { id: 'full', label: 'Full audit' }
  ],
  selectionMode: 'single' as const,
  minSelections: 1,
  maxSelections: 1,
  allowCustom: false
}

describe('structured Agent decision transport', () => {
  it('accepts only an object decision_request event and never parses prose', async () => {
    expect(parseAgentDecisionRequestEvent('Please choose A or B')).toBeNull()
    expect(parseAgentDecisionRequestEvent(JSON.stringify({
      type: 'decision_request',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      continuation: { mode: 'live' },
      request
    }))).toBeNull()

    const event = parseAgentDecisionRequestEvent({
      type: 'decision_request',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      continuation: { mode: 'live' },
      request
    })
    expect(event).toMatchObject({ type: 'decision_request', requestId: 'request-1' })

    const requestUserDecision = vi.fn()
    const outcome = await continueAgentDecisionEvent({
      protocol: 'stdio-plain',
      event: 'Please choose A or B',
      requestUserDecision
    })
    expect(requestUserDecision).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      status: 'unavailable',
      delivery: 'best-effort',
      reason: 'structured-decision-unsupported'
    })
  })

  it('resumes a live-capable structured session with a decision_result event', async () => {
    const resumeLive = vi.fn(async () => undefined)
    const redispatchCheckpoint = vi.fn(async () => undefined)
    const outcome = await continueAgentDecisionEvent({
      protocol: 'stdio-ndjson',
      event: {
        type: 'decision_request',
        version: 1,
        requestId: 'request-1',
        sessionId: 'session-1',
        continuation: { mode: 'live' },
        request
      },
      requestUserDecision: vi.fn(async () => ({
        status: 'selected' as const,
        selectedOptionIds: ['focused'],
        resolvedAt: 20
      })),
      resumeLive,
      redispatchCheckpoint
    })

    expect(resumeLive).toHaveBeenCalledWith({
      type: 'decision_result',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      resolution: {
        status: 'selected',
        selectedOptionIds: ['focused'],
        resolvedAt: 20
      }
    })
    expect(redispatchCheckpoint).not.toHaveBeenCalled()
    expect(outcome.status).toBe('resumed-live')
  })
})
~~~

Create src/main/hub/__tests__/dispatcher-decision-transport.test.ts. This test exercises the Dispatcher checkpoint seam directly and proves that it re-dispatches the same Agent inside the existing Turn while retaining session, context, and root lineage:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import { Dispatcher } from '../dispatcher'
import type {
  AgentDecisionCheckpointResult,
  AgentDecisionCheckpointState
} from '../../agentic/user-decision-transport'

describe('Dispatcher decision checkpoint continuation', () => {
  it('re-dispatches the same Agent with the same turnId and a child dispatch lineage', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.sendToAgent = vi.fn(async () => ({ content: 'continued' }))
    const task = { id: 'task-1' } as any
    const state: AgentDecisionCheckpointState = {
      version: 1,
      turnId: 'turn-1',
      threadId: 'thread-1',
      agentId: 'claude',
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      requestId: 'request-1',
      lineage: {
        origin: 'workbench:create',
        policy: 'optimize',
        rootInputId: 'input-1',
        rootEnvelopeId: 'envelope-1',
        rootPreparedTextHash: 'prepared-hash'
      },
      dispatchEnvelope: {
        origin: 'workbench:create',
        policy: 'optimize',
        rootInputId: 'input-1',
        rootEnvelopeId: 'envelope-1',
        rootPreparedTextHash: 'prepared-hash',
        dispatchId: 'dispatch-1',
        providerId: 'local-cli',
        modelId: 'claude',
        canonicalPayloadHash: 'payload-hash',
        optimizationCount: 0
      },
      context: {
        prompt: 'repair it',
        conversationText: 'repair it'
      }
    }
    const result: AgentDecisionCheckpointResult = {
      type: 'decision_result',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      resolution: {
        status: 'selected',
        selectedOptionIds: ['focused'],
        resolvedAt: 20
      }
    }

    await dispatcher.redispatchDecisionCheckpoint({
      task,
      state,
      result,
      opts: {
        turnId: 'turn-1',
        threadId: 'thread-1',
        lineage: state.lineage
      }
    })

    expect(dispatcher.sendToAgent).toHaveBeenCalledWith(
      task,
      'claude',
      expect.stringContaining('"checkpointId":"checkpoint-1"'),
      expect.objectContaining({
        turnId: 'turn-1',
        threadId: 'thread-1',
        lineage: expect.objectContaining({
          origin: 'internal:agentic-round',
          rootInputId: 'input-1',
          rootEnvelopeId: 'envelope-1',
          rootPreparedTextHash: 'prepared-hash',
          parentDispatchId: 'dispatch-1'
        })
      })
    )
  })
})
~~~

- [ ] **Step 4: Run all Task 1 tests and confirm RED**

Run:

~~~powershell
npm.cmd run test -- --run src/main/agentic/__tests__/user-decision-tool.test.ts src/main/agentic/__tests__/user-decision-adapter.test.ts src/main/agentic/__tests__/user-decision-transport.test.ts src/main/hub/__tests__/dispatcher-decision-transport.test.ts
~~~

Expected: FAIL because the three Agent decision modules and Dispatcher.redispatchDecisionCheckpoint do not exist. The RED suite also proves that treating prose as a decision request, resuming a new session, changing turnId, dropping root lineage, or reusing dispatch-1 as the new DispatchEnvelope cannot satisfy the assertions.

- [ ] **Step 5: Add the strict tool contract**

Create src/main/agentic/user-decision-tool.ts:

~~~ts
export const REQUEST_USER_DECISION_TOOL_NAME = 'request_user_decision'

export interface AgentDecisionOption {
  id: string
  label: string
  description?: string
}

export interface AgentDecisionInput {
  idempotencyKey: string
  title: string
  description?: string
  options: AgentDecisionOption[]
  selectionMode: 'single' | 'multi'
  minSelections: number
  maxSelections: number
  allowCustom: boolean
}

export interface AgentDecisionResolution {
  status: 'selected' | 'submitted' | 'denied' | 'cancelled' | 'timeout' | 'stale'
  selectedOptionIds?: string[]
  text?: string
  resolvedAt: number
}

export type AgentDecisionRequester = (input: AgentDecisionInput) => Promise<AgentDecisionResolution>

const ALLOWED_FIELDS = new Set([
  'idempotencyKey',
  'title',
  'description',
  'options',
  'selectionMode',
  'minSelections',
  'maxSelections',
  'allowCustom'
])

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be a non-empty string')
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(label + ' exceeds ' + max + ' characters')
  return normalized
}

export function parseAgentDecisionInput(value: unknown): AgentDecisionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('decision input must be an object')
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error('unsupported field: ' + key)
  }
  const idempotencyKey = boundedString(record.idempotencyKey, 'idempotencyKey', 128)
  const title = boundedString(record.title, 'title', 200)
  const description = record.description === undefined
    ? undefined
    : boundedString(record.description, 'description', 2_000)
  if (!Array.isArray(record.options) || record.options.length < 1 || record.options.length > 8) {
    throw new Error('options must contain between 1 and 8 items')
  }
  const seen = new Set<string>()
  const options = record.options.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('options[' + index + '] must be an object')
    const option = entry as Record<string, unknown>
    for (const key of Object.keys(option)) {
      if (!['id', 'label', 'description'].includes(key)) throw new Error('unsupported option field: ' + key)
    }
    const id = boundedString(option.id, 'options[' + index + '].id', 64)
    if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('option id contains unsupported characters')
    if (seen.has(id)) throw new Error('option ids must be unique')
    seen.add(id)
    return {
      id,
      label: boundedString(option.label, 'options[' + index + '].label', 200),
      description: option.description === undefined
        ? undefined
        : boundedString(option.description, 'options[' + index + '].description', 1_000)
    }
  })
  const selectionMode = record.selectionMode === undefined ? 'single' : record.selectionMode
  if (selectionMode !== 'single' && selectionMode !== 'multi') throw new Error('selectionMode must be single or multi')
  const minSelections = record.minSelections === undefined ? 1 : Number(record.minSelections)
  const maxSelections = record.maxSelections === undefined
    ? selectionMode === 'single' ? 1 : options.length
    : Number(record.maxSelections)
  if (!Number.isInteger(minSelections) || !Number.isInteger(maxSelections)) throw new Error('selection bounds must be integers')
  if (minSelections < 1 || maxSelections < minSelections || maxSelections > options.length) {
    throw new Error('selection bounds are inconsistent with options')
  }
  if (selectionMode === 'single' && (minSelections !== 1 || maxSelections !== 1)) {
    throw new Error('single selection requires minSelections=1 and maxSelections=1')
  }
  if (record.allowCustom !== undefined && typeof record.allowCustom !== 'boolean') {
    throw new Error('allowCustom must be boolean')
  }
  return {
    idempotencyKey,
    title,
    description,
    options,
    selectionMode,
    minSelections,
    maxSelections,
    allowCustom: record.allowCustom === true
  }
}

export const REQUEST_USER_DECISION_TOOL = {
  type: 'function',
  function: {
    name: REQUEST_USER_DECISION_TOOL_NAME,
    description: 'Pause this turn and ask the user to choose from neutral options.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        options: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              label: { type: 'string', minLength: 1, maxLength: 200 },
              description: { type: 'string', maxLength: 1000 }
            },
            required: ['id', 'label']
          }
        },
        selectionMode: { type: 'string', enum: ['single', 'multi'] },
        minSelections: { type: 'integer', minimum: 1, maximum: 8 },
        maxSelections: { type: 'integer', minimum: 1, maximum: 8 },
        allowCustom: { type: 'boolean' }
      },
      required: ['idempotencyKey', 'title', 'options']
    }
  }
} as const
~~~

- [ ] **Step 6: Implement the DecisionService adapter**

Create src/main/agentic/user-decision-adapter.ts. The adapter accepts only the shared DecisionOwner union, whose discriminator is type. It delegates privileged request construction to createAgentDecisionRequest and waiting/cancellation to DecisionService.request:

~~~ts
import type {
  DecisionOwner,
  DecisionResolution
} from '../../shared/decision-contract'
import {
  createAgentDecisionRequest
} from '../runtime/decision-request-factories'
import type { DecisionService } from '../runtime/decision-service'
import type {
  AgentDecisionInput,
  AgentDecisionRequester,
  AgentDecisionResolution
} from './user-decision-tool'

export interface UserDecisionAdapter {
  forAgent(agentId: string, signal?: AbortSignal): AgentDecisionRequester
}

export function createUserDecisionAdapter(input: {
  decisionService: DecisionService
  owner: DecisionOwner
}): UserDecisionAdapter {
  if (input.owner.type !== 'turn' && input.owner.type !== 'hub') {
    throw new Error('Unsupported DecisionOwner type.')
  }

  return {
    forAgent(agentId: string, signal?: AbortSignal): AgentDecisionRequester {
      const normalizedAgentId = agentId.trim()
      if (!normalizedAgentId) throw new Error('Agent decision requires an agentId.')

      return async (decision: AgentDecisionInput): Promise<AgentDecisionResolution> => {
        const request = createAgentDecisionRequest({
          owner: input.owner,
          title: decision.title,
          description: decision.description,
          kind: decision.selectionMode === 'multi' ? 'multi-select' : 'single-select',
          options: decision.options.map(option => ({
            id: option.id,
            label: option.label,
            description: option.description
          })),
          idempotencyKey: normalizedAgentId + ':' + decision.idempotencyKey,
          allowCustom: decision.allowCustom,
          customInput: decision.allowCustom
            ? {
                placeholder: 'Enter another answer',
                maxChars: 16 * 1024
              }
            : undefined,
          minSelections: decision.minSelections,
          maxSelections: decision.maxSelections
        })
        const resolution: DecisionResolution = await input.decisionService.request(request, { signal })
        return {
          status: resolution.status,
          selectedOptionIds: resolution.selectedOptionIds,
          text: resolution.text,
          resolvedAt: resolution.resolvedAt
        }
      }
    }
  }
}
~~~

The adapter deliberately does not construct raw DecisionRequest objects, set allowRemember, deadlineMs, risk, tone, target, preview, or metadata. Those fields remain controlled by the trusted factories from the Decision runtime plan.

- [ ] **Step 7: Continue the HTTP tool loop with the validated result**

In src/main/agentic/executor.ts import the new definitions, add requestUserDecision to RunAgenticParams, include REQUEST_USER_DECISION_TOOL in the provider tool list, and insert this branch before guardedToolFor(name):

~~~ts
import {
  REQUEST_USER_DECISION_TOOL,
  REQUEST_USER_DECISION_TOOL_NAME,
  parseAgentDecisionInput,
  type AgentDecisionRequester
} from './user-decision-tool'

// Add inside RunAgenticParams:
requestUserDecision?: AgentDecisionRequester

// Replace tools: AGENTIC_TOOLS in client.stream request:
tools: [...AGENTIC_TOOLS, REQUEST_USER_DECISION_TOOL],

// Insert immediately after name/parsed/stepId/label/detail are computed:
if (name === REQUEST_USER_DECISION_TOOL_NAME) {
  p.emit.activity({ id: stepId, kind: 'decision', tool: name, label, detail, status: 'awaiting' })
  let content: string
  try {
    const input = parseAgentDecisionInput(parsed)
    if (!p.requestUserDecision) throw new Error('No interactive decision channel is available.')
    const resolution = await p.requestUserDecision(input)
    content = JSON.stringify(resolution)
    p.emit.activity({ id: stepId, kind: 'decision', tool: name, label, detail, output: content, status: 'done' })
  } catch (error) {
    content = JSON.stringify({
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error)
    })
    p.emit.activity({ id: stepId, kind: 'decision', tool: name, label, detail, output: content, status: 'error' })
  }
  messages.push({ role: 'tool', tool_call_id: tc.id, content })
  if (p.isCancelled()) break
  continue
}
~~~

Import UserDecisionAdapter into src/main/hub/dispatcher.ts, add it to DispatchOptions, and pass the per-Agent requester into runAgenticHttp:

~~~ts
import type { UserDecisionAdapter } from '../agentic/user-decision-adapter'

// Add inside DispatchOptions:
userDecisionAdapter?: UserDecisionAdapter

// Add inside the runAgenticHttp parameter object in runAgenticHttpBranch:
requestUserDecision: opts.userDecisionAdapter?.forAgent(agentId),
~~~

- [ ] **Step 8: Implement the strict structured-event and checkpoint schemas**

Create src/main/agentic/user-decision-transport.ts. The parser accepts an already-decoded object from a structured protocol frame. It deliberately does not JSON.parse strings, so ordinary prose and even a JSON-looking string cannot become a decision request:

~~~ts
import type { DispatchEnvelope, PromptDispatchLineage } from '../../shared/prompt-contract'
import type { ChatCompletionMessage } from '../providers/types'
import {
  parseAgentDecisionInput,
  type AgentDecisionInput,
  type AgentDecisionRequester,
  type AgentDecisionResolution
} from './user-decision-tool'

export interface AgentDecisionRequestEvent {
  type: 'decision_request'
  version: 1
  requestId: string
  sessionId: string
  continuation:
    | { mode: 'live' }
    | { mode: 'checkpoint'; checkpointId: string }
  request: AgentDecisionInput
}

export interface AgentDecisionResultEvent {
  type: 'decision_result'
  version: 1
  requestId: string
  sessionId: string
  resolution: AgentDecisionResolution
}

export interface AgentDecisionCheckpointState {
  version: 1
  turnId: string
  threadId?: string
  agentId: string
  sessionId: string
  checkpointId: string
  requestId: string
  lineage: PromptDispatchLineage
  dispatchEnvelope: DispatchEnvelope
  context: {
    prompt: string
    conversationText?: string
    messages?: ChatCompletionMessage[]
  }
}

export interface AgentDecisionCheckpointResult extends AgentDecisionResultEvent {
  checkpointId: string
}

export type AgentDecisionTransportOutcome =
  | { status: 'ignored' }
  | {
      status: 'unavailable'
      delivery: 'best-effort'
      reason: 'structured-decision-unsupported' | 'decision-channel-unavailable' | 'continuation-unavailable'
    }
  | { status: 'resumed-live'; result: AgentDecisionResultEvent }
  | { status: 'redispatched-checkpoint'; result: AgentDecisionCheckpointResult }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(field + ' must be a non-empty string')
  return value.trim()
}

export function parseAgentDecisionRequestEvent(value: unknown): AgentDecisionRequestEvent | null {
  const event = record(value)
  if (!event || event.type !== 'decision_request') return null
  if (event.version !== 1) throw new Error('decision_request.version must be 1')
  const continuation = record(event.continuation)
  if (!continuation || (continuation.mode !== 'live' && continuation.mode !== 'checkpoint')) {
    throw new Error('decision_request.continuation is invalid')
  }
  const parsedContinuation = continuation.mode === 'live'
    ? { mode: 'live' as const }
    : {
        mode: 'checkpoint' as const,
        checkpointId: requiredString(continuation.checkpointId, 'checkpointId')
      }
  return {
    type: 'decision_request',
    version: 1,
    requestId: requiredString(event.requestId, 'requestId'),
    sessionId: requiredString(event.sessionId, 'sessionId'),
    continuation: parsedContinuation,
    request: parseAgentDecisionInput(event.request)
  }
}

export async function continueAgentDecisionEvent(input: {
  protocol: 'stdio-ndjson' | 'stdio-plain'
  event: unknown
  requestUserDecision?: AgentDecisionRequester
  checkpointState?: AgentDecisionCheckpointState
  resumeLive?: (result: AgentDecisionResultEvent) => Promise<void>
  redispatchCheckpoint?: (input: {
    state: AgentDecisionCheckpointState
    result: AgentDecisionCheckpointResult
  }) => Promise<void>
}): Promise<AgentDecisionTransportOutcome> {
  if (input.protocol === 'stdio-plain') {
    return {
      status: 'unavailable',
      delivery: 'best-effort',
      reason: 'structured-decision-unsupported'
    }
  }
  const event = parseAgentDecisionRequestEvent(input.event)
  if (!event) return { status: 'ignored' }
  if (!input.requestUserDecision) {
    return { status: 'unavailable', delivery: 'best-effort', reason: 'decision-channel-unavailable' }
  }
  const resolution = await input.requestUserDecision(event.request)
  const result: AgentDecisionResultEvent = {
    type: 'decision_result',
    version: 1,
    requestId: event.requestId,
    sessionId: event.sessionId,
    resolution
  }
  if (event.continuation.mode === 'live') {
    if (!input.resumeLive) {
      return { status: 'unavailable', delivery: 'best-effort', reason: 'continuation-unavailable' }
    }
    await input.resumeLive(result)
    return { status: 'resumed-live', result }
  }

  const state = input.checkpointState
  if (
    !state || !input.redispatchCheckpoint ||
    state.requestId !== event.requestId ||
    state.sessionId !== event.sessionId ||
    state.checkpointId !== event.continuation.checkpointId
  ) {
    return { status: 'unavailable', delivery: 'best-effort', reason: 'continuation-unavailable' }
  }
  const checkpointResult: AgentDecisionCheckpointResult = {
    ...result,
    checkpointId: event.continuation.checkpointId
  }
  await input.redispatchCheckpoint({ state, result: checkpointResult })
  return { status: 'redispatched-checkpoint', result: checkpointResult }
}
~~~

- [ ] **Step 9: Wire live structured frames and same-Turn checkpoint re-dispatch**

Extend AgentAdapter in src/main/hub/adapters/agent-adapter.ts with an explicit structured-event continuation contract:

~~~ts
import type { AgentDecisionResultEvent } from '../../agentic/user-decision-transport'

decisionContinuation?: 'none' | 'live' | 'checkpoint'
onProtocolEvent?: ((event: unknown) => void) | null
resumeDecision?(result: AgentDecisionResultEvent): Promise<void>
~~~

In src/main/hub/adapters/stdio-adapter.ts, initialize decisionContinuation to none and onProtocolEvent to null. A supported structured adapter sets protocol to stdio-ndjson and selects live or checkpoint explicitly. Only the stdio-ndjson frame decoder may emit decision_request; stdio-plain continues to stream every string as content:

~~~ts
protocol: 'stdio-plain' | 'stdio-ndjson' = 'stdio-plain'
decisionContinuation: 'none' | 'live' | 'checkpoint' = 'none'
onProtocolEvent: ((event: unknown) => void) | null = null

private consumeActivityLine(line: string): void {
  if (this.protocol === 'stdio-ndjson') {
    let frame: unknown
    try { frame = JSON.parse(line) } catch { frame = undefined }
    if (
      frame !== null && typeof frame === 'object' && !Array.isArray(frame) &&
      (frame as Record<string, unknown>).type === 'decision_request'
    ) {
      this.onProtocolEvent?.(frame)
      return
    }
  }
  const parser = this.activityParser
  if (!parser) return
  let parsed: { steps?: any[]; content?: string; usage?: any } | null
  try {
    parsed = parser(line)
  } catch {
    parsed = { content: line.endsWith('\n') ? line : line + '\n' }
  }
  if (!parsed) return
  if (parsed.steps) {
    for (const step of parsed.steps) this.onActivity?.(step)
  }
  if (parsed.usage) this.onUsage?.(parsed.usage)
  if (parsed.content) this.handleOutput(parsed.content)
}

async resumeDecision(result: AgentDecisionResultEvent): Promise<void> {
  if (
    this.protocol !== 'stdio-ndjson' ||
    this.decisionContinuation !== 'live' ||
    !this.proc?.stdin?.writable
  ) {
    throw new Error('Structured live decision continuation is unavailable.')
  }
  this.proc.stdin.write(JSON.stringify(result) + '\n')
}
~~~

For a live-capable adapter, keep stdin open after the initial structured request and write decision_result to that same proc; do not spawn another process or change sessionId. A checkpoint-capable adapter may exit, but the Dispatcher must re-enter the same task and Turn. In Dispatcher.sendToAgentStdio, set onProtocolEvent only when adapter.protocol is stdio-ndjson, build AgentDecisionCheckpointState from opts.turnId, opts.threadId, agentId, the event session/checkpoint IDs, the current prompt/messages, opts.lineage, and task.latestDispatchEnvelope, and serialize event handling. The checkpoint callback stops the current process and stores a pending checkpoint; after that attempt settles, invoke redispatchDecisionCheckpoint. Always clear onProtocolEvent in cleanup.

Add this concrete Dispatcher method in src/main/hub/dispatcher.ts:

~~~ts
import { childDispatchLineage } from '../runtime/dispatch-envelope'
import type {
  AgentDecisionCheckpointResult,
  AgentDecisionCheckpointState
} from '../agentic/user-decision-transport'

async redispatchDecisionCheckpoint(input: {
  task: DispatchTask
  state: AgentDecisionCheckpointState
  result: AgentDecisionCheckpointResult
  opts: DispatchOptions
}): Promise<{ content: string; error?: string }> {
  const { state, result, opts } = input
  if (!opts.turnId || state.turnId !== opts.turnId) {
    throw new Error('Decision checkpoint must resume inside the same turnId.')
  }
  if (state.threadId !== opts.threadId || state.sessionId !== result.sessionId) {
    throw new Error('Decision checkpoint session/context mismatch.')
  }
  const resumePayload = JSON.stringify({
    type: 'decision_checkpoint_resume',
    version: 1,
    sessionId: state.sessionId,
    checkpointId: state.checkpointId,
    context: state.context,
    result
  })
  return this.sendToAgent(
    input.task,
    state.agentId,
    resumePayload,
    {
      ...opts,
      turnId: state.turnId,
      threadId: state.threadId,
      lineage: childDispatchLineage(
        state.lineage,
        state.dispatchEnvelope.dispatchId,
        'internal:agentic-round'
      )
    }
  )
}
~~~

This method intentionally passes the existing DispatchTask and exact agentId to sendToAgent. The next canonical send boundary must create and verify a new DispatchEnvelope; state.dispatchEnvelope is used only as the parent, never reused. The prepared root IDs/hash remain unchanged, the original prompt is not prepared or optimized again, and stdio-plain prose such as “Please choose A or B” remains ordinary output with the structured best-effort unavailable capability result shown in Step 3.

- [ ] **Step 10: Run the focused tests and confirm GREEN**

Run:

~~~powershell
npm.cmd run test -- --run src/main/agentic/__tests__/user-decision-tool.test.ts src/main/agentic/__tests__/user-decision-adapter.test.ts src/main/agentic/__tests__/user-decision-transport.test.ts src/main/agentic/__tests__/executor.test.ts src/main/hub/__tests__/dispatcher-decision-transport.test.ts
~~~

Expected: PASS; HTTP resumes the same tool loop, live stdio-ndjson resumes the same session, checkpoint stdio-ndjson re-dispatches the same Agent under the same turnId with retained context and child lineage, every new send receives an independent DispatchEnvelope, and stdio-plain never interprets prose as a decision_request and reports structured unavailable/best-effort capability.

- [ ] **Step 11: Stage only this task and commit**

~~~powershell
git add src/main/agentic/user-decision-tool.ts src/main/agentic/user-decision-adapter.ts src/main/agentic/user-decision-transport.ts src/main/agentic/__tests__/user-decision-tool.test.ts src/main/agentic/__tests__/user-decision-adapter.test.ts src/main/agentic/__tests__/user-decision-transport.test.ts src/main/agentic/executor.ts src/main/hub/adapters/agent-adapter.ts src/main/hub/adapters/stdio-adapter.ts src/main/hub/__tests__/dispatcher-decision-transport.test.ts src/main/hub/dispatcher.ts
git commit -m "feat(agentic): add structured user decisions"
~~~

### Task 2: Cancellable Dispatcher branch handle

**Files:**
- Create: src/main/hub/__tests__/dispatcher-branch.test.ts
- Modify: src/main/hub/dispatcher.ts:202-220,261-278,341-395,1123-1180

- [ ] **Step 1: Write the failing handle tests**

Create src/main/hub/__tests__/dispatcher-branch.test.ts:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import { Dispatcher } from '../dispatcher'
import type { PromptDispatchLineage } from '../../../shared/prompt-contract'

const rootLineage: PromptDispatchLineage = {
  origin: 'workbench:create',
  policy: 'optimize',
  rootInputId: 'input-1',
  rootEnvelopeId: 'envelope-1',
  rootPreparedTextHash: 'prepared-hash-1'
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function dispatcherWithBlockedAgent() {
  const dispatcher = new Dispatcher({ getAll: () => [] } as any, { process: async () => {} } as any)
  const gate = deferred<void>()
  const seenLineages: PromptDispatchLineage[] = []
  ;(dispatcher as any).resolveTargets = () => [{ agentId: 'codex' }]
  ;(dispatcher as any).sendToAgent = async (task: any, _agentId: string, _text: string, options: any) => {
    seenLineages.push(options.lineage)
    await gate.promise
    if (task.status !== 'cancelled') task.results.set('codex', 'done')
    return task.status === 'cancelled' ? { content: '', error: 'cancelled' } : { content: 'done' }
  }
  return { dispatcher, gate, seenLineages }
}

describe('Dispatcher.startDispatch', () => {
  it('returns a stable task id before the branch settles', async () => {
    const { dispatcher, gate, seenLineages } = dispatcherWithBlockedAgent()
    const handle = dispatcher.startDispatch('hello', 'auto', 'codex', { lineage: rootLineage })
    expect(handle.taskId).toMatch(/^task-/)
    expect(dispatcher.getRecentTasks().some(task => task.id === handle.taskId)).toBe(true)
    gate.resolve()
    await expect(handle.result).resolves.toMatchObject({ id: handle.taskId, status: 'completed' })
    expect(seenLineages).toEqual([rootLineage])
  })

  it('links an AbortSignal and settles cancellation once', async () => {
    const { dispatcher, gate } = dispatcherWithBlockedAgent()
    const controller = new AbortController()
    const finished = vi.fn()
    dispatcher.on('task:finished', finished)
    const handle = dispatcher.startDispatch('hello', 'auto', 'codex', {
      lineage: rootLineage,
      signal: controller.signal
    })
    controller.abort('turn cancelled')
    gate.resolve()
    await expect(handle.result).resolves.toMatchObject({ status: 'cancelled', error: 'turn cancelled' })
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('cancels at an absolute deadline and clears the timer', async () => {
    vi.useFakeTimers()
    const { dispatcher, gate } = dispatcherWithBlockedAgent()
    const handle = dispatcher.startDispatch('hello', 'auto', 'codex', {
      lineage: rootLineage,
      deadline: Date.now() + 100
    })
    await vi.advanceTimersByTimeAsync(101)
    gate.resolve()
    await expect(handle.result).resolves.toMatchObject({ status: 'cancelled' })
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
~~~

- [ ] **Step 2: Run the test and confirm RED**

~~~powershell
npm.cmd test -- src/main/hub/__tests__/dispatcher-branch.test.ts --reporter=dot
~~~

Expected: FAIL because Dispatcher has no startDispatch method or branch cancellation controls; removing lineage from the call must also fail typecheck because the Prompt plan makes DispatchOptions.lineage required.

- [ ] **Step 3: Add the handle and branch metadata types**

Do not redeclare DispatchOptions as a parallel interface. Import the Prompt plan contracts from src/shared/prompt-contract.ts, retain its required lineage and optional parentDispatchId members, and append only the branch controls to that same existing interface:

~~~ts
import type {
  DispatchEnvelope,
  PromptDispatchLineage
} from '../../shared/prompt-contract'

export type DispatchCapabilityMode = 'normal' | 'read-only'

export interface DispatchHandle<T> {
  taskId: string
  result: Promise<T>
  cancel(reason?: string): Promise<void>
}

// Edit this one existing declaration in place. Do not add a second DispatchOptions type.
export interface DispatchOptions {
  thinking?: ThinkingConfig
  modelSelection?: ModelSelection
  systemPrompt?: string
  messages?: ChatCompletionMessage[]
  conversationText?: string
  workspaceId?: string | null
  turnId?: string
  threadId?: string
  streamMeta?: Record<string, any>
  preserveCurrentMessage?: boolean
  lineage: PromptDispatchLineage
  parentDispatchId?: string
  signal?: AbortSignal
  deadline?: number
  parentRunId?: string
  branchId?: string
  sessionKey?: string
  budgetReservationId?: string
  visibility?: 'chat' | 'run'
  capabilityMode?: DispatchCapabilityMode
  userDecisionAdapter?: UserDecisionAdapter
}

// Add this member inside the existing DispatchTask declaration:
latestDispatchEnvelope?: DispatchEnvelope
~~~

The Prompt plan's actual send boundary remains authoritative: after resolving the final provider/model and constructing the exact canonical payload, it creates and verifies a new DispatchEnvelope, assigns task.latestDispatchEnvelope to that envelope, and only then sends. Branch metadata and streamMeta are audit projections; neither is a substitute for the verified DispatchEnvelope.

After signal becomes available in this task, replace the Task 1 forwarding expression with the signal-aware form so cancellation terminalizes the same DecisionService waiter:

~~~ts
requestUserDecision: opts.userDecisionAdapter?.forAgent(agentId, opts.signal),
~~~

- [ ] **Step 4: Split synchronous task creation from asynchronous execution**

Replace the current dispatch method with these methods, moving the existing execution block into executeDispatchTask:

~~~ts
startDispatch(
  text: string,
  mode: DispatchMode = 'auto',
  targetAgent?: string,
  opts: DispatchOptions
): DispatchHandle<DispatchTask> {
  if (opts.modelSelection?.source === 'provider') {
    throw new Error('Provider model selections must run through provider direct dispatch, not local agent routing.')
  }
  const taskId = 'task-' + (++this.taskCounter)
  const effectiveMode: DispatchMode = targetAgent ? 'auto' : mode
  const task: DispatchTask = {
    id: taskId,
    text,
    mode: effectiveMode,
    targetAgent,
    status: 'pending',
    results: new Map(),
    thinking: new Map(),
    errors: new Map(),
    usage: new Map(),
    thinkingSummary: new Map(),
    createdAt: new Date()
  }
  if (opts.turnId) (task as any).__turnId = opts.turnId
  ;(task as any).__lineage = opts.lineage
  this.stableTaskIds.set(task, taskId)
  this.tasks.set(taskId, task)
  this.inFlightTaskIds.add(taskId)
  const forcedMeta = opts.branchId ? {
    ...(opts.streamMeta || {}),
    parentRunId: opts.parentRunId,
    branchId: opts.branchId,
    sessionKey: opts.sessionKey,
    budgetReservationId: opts.budgetReservationId,
    rootInputId: opts.lineage.rootInputId,
    rootEnvelopeId: opts.lineage.rootEnvelopeId,
    rootPreparedTextHash: opts.lineage.rootPreparedTextHash,
    parentDispatchId: opts.lineage.parentDispatchId,
    visibility: opts.visibility || 'run'
  } : opts.streamMeta
  if (forcedMeta) this.streamMetaByTask.set(task.id, forcedMeta)
  this.emit('task:created', this.taskSnapshot(task, taskId))
  const unbind = this.bindBranchCancellation(taskId, opts)
  const result = this.executeDispatchTask(task, text, effectiveMode, targetAgent, opts)
    .finally(unbind)
  return Object.freeze({
    taskId,
    result,
    cancel: async (reason = 'cancelled') => {
      this.cancel(taskId, reason)
    }
  })
}

async dispatch(
  text: string,
  mode: DispatchMode = 'auto',
  targetAgent?: string,
  opts: DispatchOptions
): Promise<DispatchTask> {
  return this.startDispatch(text, mode, targetAgent, opts).result
}

private async executeDispatchTask(
  task: DispatchTask,
  text: string,
  effectiveMode: DispatchMode,
  targetAgent: string | undefined,
  opts: DispatchOptions
): Promise<DispatchTask> {
  if (task.status === 'cancelled') return this.finishCancelledBeforeStart(task, targetAgent || 'dispatcher')
  task.status = 'running'
  try {
    if (effectiveMode === 'orchestrate') {
      await this.runOrchestrate(task, text, opts)
    } else {
      const targets = this.resolveTargets(task, effectiveMode, targetAgent)
      if (targets.length === 0) {
        throw new Error('No available provider for the requested routing. Open Settings -> Providers to configure API keys.')
      }
      if (effectiveMode === 'chain') {
        let currentText = text
        for (const target of targets) {
          const response = await this.sendToAgent(task, target.agentId, currentText, opts)
          if ((task as any).status === 'cancelled' || response.error) break
          currentText = response.content
        }
      } else {
        await Promise.all(targets.map(target => this.sendToAgent(task, target.agentId, text, opts)))
      }
      if ((task as any).status !== 'cancelled') {
        task.status = task.errors.size > 0 ? 'failed' : 'completed'
      }
    }
  } catch (error) {
    if (task.status !== 'cancelled') {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
    }
  }
  return this.finishTask(task, task.id)
}

private bindBranchCancellation(taskId: string, opts: DispatchOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => this.cancel(taskId, String(opts.signal?.reason || 'cancelled'))
  if (opts.signal) {
    if (opts.signal.aborted) onAbort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  if (opts.deadline !== undefined) {
    timer = setTimeout(() => this.cancel(taskId, 'branch deadline exceeded'), Math.max(0, opts.deadline - Date.now()))
  }
  return () => {
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
~~~

Change cancel to accept pending tasks and preserve the reason:

~~~ts
cancel(taskId: string, reason = 'cancelled'): boolean {
  const task = this.tasks.get(taskId)
  if (!task || (task.status !== 'pending' && task.status !== 'running')) return false
  task.status = 'cancelled'
  task.error = reason
  for (const [key, stop] of this.activeAgentStops) {
    if (key.startsWith(taskId + ':')) stop()
  }
  this.settleTaskPendingApprovals(taskId)
  return true
}
~~~

- [ ] **Step 5: Run branch and existing Dispatcher tests**

~~~powershell
npm.cmd test -- src/main/hub/__tests__/dispatcher-branch.test.ts src/main/hub/__tests__/provider-direct.test.ts src/main/hub/__tests__/orchestrator-e2e.test.ts --reporter=dot
~~~

Expected: PASS and every cancelled task emits task:finished once.

- [ ] **Step 6: Stage only this task and commit**

~~~powershell
git add src/main/hub/dispatcher.ts src/main/hub/__tests__/dispatcher-branch.test.ts
git commit -m "feat(dispatcher): expose cancellable branch handles"
~~~

### Task 3: Enforce read-only HTTP and ACP branches

**Files:**
- Create: src/main/hub/dispatch-capabilities.ts
- Create: src/main/hub/__tests__/dispatcher-capabilities.test.ts
- Modify: src/main/agentic/tools.ts:27-81,195-228
- Modify: src/main/agentic/executor.ts:29-51,83-103
- Modify: src/main/agentic/__tests__/user-decision-tool.test.ts:18-22
- Modify: src/main/hub/dispatcher.ts:830-884,1059-1090,1615-1655

- [ ] **Step 1: Write failing capability tests**

Create src/main/hub/__tests__/dispatcher-capabilities.test.ts:

~~~ts
import { describe, expect, it } from 'vitest'
import { READ_ONLY_AGENTIC_TOOLS, executeTool } from '../../agentic/tools'
import { assertCapabilityTransport, shouldRequestAcpPermission } from '../dispatch-capabilities'

describe('read-only dispatch capability', () => {
  it('exposes only read and decision tools', () => {
    const names = READ_ONLY_AGENTIC_TOOLS.map(tool => tool.function.name)
    expect(names).toEqual(['fs_read', 'fs_list'])
    expect(names).not.toContain('fs_write')
    expect(names).not.toContain('exec')
  })

  it('rejects a forged mutating call even when the workspace exists', async () => {
    await expect(executeTool('fs_write', { path: 'x.txt', content: 'x' }, {
      root: process.cwd(),
      readOnly: true
    })).resolves.toEqual({
      ok: false,
      output: 'Rejected: read-only capability forbids file writes.'
    })
  })

  it('excludes stdio-plain and denies ACP mutation permissions', () => {
    expect(() => assertCapabilityTransport('stdio-plain', 'read-only')).toThrow(/READ_ONLY_TRANSPORT_UNSUPPORTED/)
    expect(() => assertCapabilityTransport('acp', 'read-only')).not.toThrow()
    expect(shouldRequestAcpPermission('read-only')).toBe(false)
    expect(shouldRequestAcpPermission('normal')).toBe(true)
  })
})
~~~

- [ ] **Step 2: Run the tests and confirm RED**

~~~powershell
npm.cmd test -- src/main/hub/__tests__/dispatcher-capabilities.test.ts --reporter=dot
~~~

Expected: FAIL because READ_ONLY_AGENTIC_TOOLS and dispatch-capabilities.ts do not exist.

- [ ] **Step 3: Add the transport capability helpers**

Create src/main/hub/dispatch-capabilities.ts:

~~~ts
import type { DispatchCapabilityMode } from './dispatcher'

export type DispatchTransportProtocol = 'http' | 'acp' | 'stdio-plain' | string | undefined

export function assertCapabilityTransport(
  protocol: DispatchTransportProtocol,
  mode: DispatchCapabilityMode = 'normal'
): void {
  if (mode === 'read-only' && protocol === 'stdio-plain') {
    const error = new Error('READ_ONLY_TRANSPORT_UNSUPPORTED: stdio-plain cannot enforce read-only execution')
    ;(error as Error & { code?: string }).code = 'READ_ONLY_TRANSPORT_UNSUPPORTED'
    throw error
  }
}

export function shouldRequestAcpPermission(mode: DispatchCapabilityMode = 'normal'): boolean {
  return mode !== 'read-only'
}
~~~

- [ ] **Step 4: Filter schemas and retain execution-time enforcement**

In src/main/agentic/tools.ts export the filtered list and use stable rejection text:

~~~ts
export const READ_ONLY_AGENTIC_TOOLS = AGENTIC_TOOLS.filter(tool =>
  tool.function.name === 'fs_read' || tool.function.name === 'fs_list'
)

// Replace the read-only fs_write result:
if (ctx.readOnly) return { ok: false, output: 'Rejected: read-only capability forbids file writes.' }

// Replace the read-only exec result:
if (ctx.readOnly) return { ok: false, output: 'Rejected: read-only capability forbids command execution.' }
~~~

In src/main/agentic/executor.ts add capabilityMode and choose schemas/context:

~~~ts
import { AGENTIC_TOOLS, READ_ONLY_AGENTIC_TOOLS, executeTool, ToolContext } from './tools'

// Add inside RunAgenticParams:
capabilityMode?: 'normal' | 'read-only'

// Replace ToolContext construction:
const ctx: ToolContext = {
  root: p.root || process.cwd(),
  readOnly: p.capabilityMode === 'read-only' || !p.root
}

// Before the round loop:
const workspaceTools = p.capabilityMode === 'read-only' ? READ_ONLY_AGENTIC_TOOLS : AGENTIC_TOOLS
const availableTools = [...workspaceTools, REQUEST_USER_DECISION_TOOL]

// Pass availableTools to client.stream:
tools: availableTools,
~~~

Update the tools mock in user-decision-tool.test.ts:

~~~ts
vi.mock('../tools', () => ({
  AGENTIC_TOOLS: [],
  READ_ONLY_AGENTIC_TOOLS: [],
  executeTool: async () => {
    h.executeToolCalls += 1
    return { ok: true, output: 'unexpected workspace tool' }
  }
}))
~~~

- [ ] **Step 5: Wire the Dispatcher gates**

At the start of sendToAgent, validate the selected transport:

~~~ts
const capabilityMode = opts.capabilityMode || 'normal'
assertCapabilityTransport(binding?.protocol, capabilityMode)
~~~

Pass capabilityMode to runAgenticHttp:

~~~ts
capabilityMode: opts.capabilityMode || 'normal',
~~~

Replace ACP permission callback in sendToAgentAcp:

~~~ts
onRequestPermission: (request: any) => {
  if (!shouldRequestAcpPermission(opts.capabilityMode || 'normal')) return Promise.resolve(false)
  return this.requestAcpPermission(task, agentId, request)
}
~~~

- [ ] **Step 6: Run focused security regressions**

~~~powershell
npm.cmd test -- src/main/hub/__tests__/dispatcher-capabilities.test.ts src/main/agentic/__tests__/tools.test.ts src/main/agentic/__tests__/executor.test.ts src/main/agentic/__tests__/user-decision-tool.test.ts --reporter=dot
~~~

Expected: PASS; write/exec schemas are absent in read-only mode, forged mutations fail, ACP denies without opening approval, and stdio-plain is rejected.

- [ ] **Step 7: Stage only this task and commit**

~~~powershell
git add src/main/hub/dispatch-capabilities.ts src/main/hub/__tests__/dispatcher-capabilities.test.ts src/main/agentic/tools.ts src/main/agentic/executor.ts src/main/agentic/__tests__/user-decision-tool.test.ts src/main/hub/dispatcher.ts
git commit -m "feat(dispatcher): enforce read-only fusion branches"
~~~

### Task 4: Resolve and deduplicate concrete model routes

**Files:**
- Create: src/main/runtime/multi-model-routes.ts
- Create: src/main/runtime/__tests__/multi-model-routes.test.ts

- [ ] **Step 1: Write failing route-selection tests**

Create src/main/runtime/__tests__/multi-model-routes.test.ts:

~~~ts
import { describe, expect, it } from 'vitest'
import { resolveDistinctFusionRoutes, selectFusionTopology } from '../multi-model-routes'

function source() {
  const bindings = [
    { agentId: 'codex-a', providerId: 'p1', modelId: 'alias-a', protocol: 'http' },
    { agentId: 'codex-b', providerId: 'p1', modelId: 'alias-b', protocol: 'http' },
    { agentId: 'claude', providerId: 'p2', modelId: 'claude-4', protocol: 'http' },
    { agentId: 'gemini', providerId: 'p3', modelId: 'gemini-3', protocol: 'acp' },
    { agentId: 'plain', providerId: 'local-cli', modelId: 'plain', protocol: 'stdio-plain' }
  ] as any[]
  return {
    getBindings: () => bindings,
    resolveBinding: (agentId: string) => {
      if (agentId === 'plain') return null
      if (agentId.startsWith('codex')) {
        return { provider: { id: 'p1' }, model: { id: 'alias', upstreamModel: 'gpt-5' } }
      }
      if (agentId === 'claude') return { provider: { id: 'p2' }, model: { id: 'claude-4' } }
      return { provider: { id: 'p3' }, model: { id: 'gemini-3' } }
    }
  }
}

describe('resolveDistinctFusionRoutes', () => {
  it('deduplicates by resolved provider/model instead of Agent id', () => {
    const routes = resolveDistinctFusionRoutes(source() as any)
    expect(routes.map(route => route.agentId)).toEqual(['codex-a', 'claude', 'gemini'])
    expect(routes.map(route => route.key)).toEqual(['p1\u0000gpt-5', 'p2\u0000claude-4', 'p3\u0000gemini-3'])
    expect(routes.some(route => route.protocol === 'stdio-plain')).toBe(false)
  })

  it('uses spare distinct routes for synthesizer and judge when available', () => {
    const routes = [
      { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
      { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' },
      { key: 'p3\u0000m3', agentId: 'c', providerId: 'p3', modelId: 'm3', protocol: 'http' },
      { key: 'p4\u0000m4', agentId: 'd', providerId: 'p4', modelId: 'm4', protocol: 'http' },
      { key: 'p5\u0000m5', agentId: 'e', providerId: 'p5', modelId: 'm5', protocol: 'http' }
    ] as any
    const topology = selectFusionTopology(routes, 3)
    expect(topology.candidates.map(route => route.agentId)).toEqual(['a', 'b', 'c'])
    expect(topology.synthesizer.agentId).toBe('d')
    expect(topology.judge.agentId).toBe('e')
  })
})
~~~

- [ ] **Step 2: Run the test and confirm RED**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/multi-model-routes.test.ts --reporter=dot
~~~

Expected: FAIL because multi-model-routes.ts does not exist.

- [ ] **Step 3: Implement stable resolved-route selection**

Create src/main/runtime/multi-model-routes.ts:

~~~ts
export interface FusionBinding {
  agentId: string
  providerId: string
  modelId: string
  protocol?: string
}

export interface FusionRouteSource {
  getBindings(): FusionBinding[]
  resolveBinding(agentId: string): {
    provider: { id: string }
    model: { id: string; upstreamModel?: string }
  } | null
}

export interface ResolvedFusionRoute {
  key: string
  agentId: string
  providerId: string
  modelId: string
  protocol: 'http' | 'acp'
}

export interface FusionTopology {
  candidates: ResolvedFusionRoute[]
  synthesizer: ResolvedFusionRoute
  judge: ResolvedFusionRoute
}

export function resolveDistinctFusionRoutes(source: FusionRouteSource, maxRoutes = 8): ResolvedFusionRoute[] {
  const routes: ResolvedFusionRoute[] = []
  const seen = new Set<string>()
  for (const binding of source.getBindings()) {
    if (binding.protocol === 'stdio-plain') continue
    const resolved = source.resolveBinding(binding.agentId)
    if (!resolved) continue
    const providerId = resolved.provider.id
    const modelId = resolved.model.upstreamModel || resolved.model.id
    const key = providerId + '\u0000' + modelId
    if (seen.has(key)) continue
    seen.add(key)
    routes.push({
      key,
      agentId: binding.agentId,
      providerId,
      modelId,
      protocol: binding.protocol === 'acp' ? 'acp' : 'http'
    })
    if (routes.length === maxRoutes) break
  }
  return routes
}

export function selectFusionTopology(routes: ResolvedFusionRoute[], candidateLimit = 3): FusionTopology {
  const candidateCount = Math.min(Math.max(candidateLimit, 2), 3, routes.length)
  if (candidateCount < 2) throw new Error('MULTI_MODEL_UNAVAILABLE: at least two distinct resolved models are required')
  const candidates = routes.slice(0, candidateCount)
  const synthesizer = routes[candidateCount] || candidates[0]
  const judge = routes.find(route =>
    route.key !== synthesizer.key && !candidates.some(candidate => candidate.key === route.key)
  ) || candidates.find(route => route.key !== synthesizer.key) || candidates[0]
  return { candidates, synthesizer, judge }
}
~~~

- [ ] **Step 4: Run route tests and confirm GREEN**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/multi-model-routes.test.ts --reporter=dot
~~~

Expected: PASS; duplicate resolved models collapse and role selection remains deterministic.

- [ ] **Step 5: Stage only this task and commit**

~~~powershell
git add src/main/runtime/multi-model-routes.ts src/main/runtime/__tests__/multi-model-routes.test.ts
git commit -m "feat(runtime): select distinct fusion model routes"
~~~

### Task 5: Atomic aggregate budget reservations

**Files:**
- Create: src/main/runtime/budget-reservations.ts
- Create: src/main/runtime/__tests__/budget-reservations.test.ts

- [ ] **Step 1: Write failing reservation tests**

Create src/main/runtime/__tests__/budget-reservations.test.ts:

~~~ts
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

describe('BudgetReservationCenter', () => {
  it('counts active reservations before admitting another fan-out', () => {
    const center = new BudgetReservationCenter(() => ({
      config: blockingConfig,
      dailySpentUsd: 1,
      monthlySpentUsd: 1
    }))
    const first = center.reserve('run-1', { tokens: 8_000, costUsd: 6, requests: 3 })
    const second = center.reserve('run-2', { tokens: 4_000, costUsd: 4, requests: 2 })
    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, reason: 'Daily budget ($10) exceeded' })
  })

  it('releases idempotently and permits a later reservation', () => {
    const center = new BudgetReservationCenter(() => ({
      config: blockingConfig,
      dailySpentUsd: 1,
      monthlySpentUsd: 1
    }))
    const first = center.reserve('run-1', { tokens: 8_000, costUsd: 6, requests: 3 })
    if (!first.ok) throw new Error(first.reason)
    expect(center.release(first.receipt.id)).toBe(true)
    expect(center.release(first.receipt.id)).toBe(false)
    expect(center.reserve('run-2', { tokens: 4_000, costUsd: 4, requests: 2 }).ok).toBe(true)
  })

  it('enforces token limits even when cost is unpriced', () => {
    const center = new BudgetReservationCenter(() => ({
      config: blockingConfig,
      dailySpentUsd: 0,
      monthlySpentUsd: 0
    }))
    expect(center.reserve('large', { tokens: 20_001, costUsd: null, requests: 3 })).toEqual({
      ok: false,
      reason: 'Request exceeds 20000 token limit'
    })
  })
})
~~~

- [ ] **Step 2: Run the tests and confirm RED**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/budget-reservations.test.ts --reporter=dot
~~~

Expected: FAIL because budget-reservations.ts does not exist.

- [ ] **Step 3: Implement the synchronous reservation ledger**

Create src/main/runtime/budget-reservations.ts:

~~~ts
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
    if (!ownerId.trim()) return { ok: false, reason: 'Budget reservation owner is required' }
    if (!Number.isFinite(amount.tokens) || amount.tokens < 0 || !Number.isInteger(amount.requests) || amount.requests < 1) {
      return { ok: false, reason: 'Budget reservation amount is invalid' }
    }
    const current = this.snapshot()
    let activeCost = 0
    for (const receipt of this.active.values()) activeCost += receipt.costUsd || 0
    const check = checkBudget(
      current.config,
      current.dailySpentUsd + activeCost,
      current.monthlySpentUsd + activeCost,
      amount.tokens,
      amount.costUsd
    )
    if (!check.allowed) return { ok: false, reason: check.reason || 'Budget reservation denied' }
    const receipt: BudgetReservationReceipt = Object.freeze({
      id: randomUUID(),
      ownerId,
      tokens: amount.tokens,
      costUsd: amount.costUsd,
      requests: amount.requests,
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
~~~

- [ ] **Step 4: Run budget tests and confirm GREEN**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/budget-reservations.test.ts src/main/runtime/__tests__/budget-center.test.ts --reporter=dot
~~~

Expected: PASS; the second reservation sees the first, and release is idempotent.

- [ ] **Step 5: Stage only this task and commit**

~~~powershell
git add src/main/runtime/budget-reservations.ts src/main/runtime/__tests__/budget-reservations.test.ts
git commit -m "feat(runtime): reserve aggregate fusion budgets"
~~~

### Task 6: Pure loop Prompts, Judge parser, and score selection

**Files:**
- Create: src/main/runtime/multi-model-loop-prompts.ts
- Create: src/main/runtime/__tests__/multi-model-loop-prompts.test.ts

- [ ] **Step 1: Write failing Prompt and Judge tests**

Create src/main/runtime/__tests__/multi-model-loop-prompts.test.ts:

~~~ts
import { describe, expect, it } from 'vitest'
import {
  buildCandidatePrompt,
  buildJudgePrompt,
  parseJudgeResult,
  selectBestRevision
} from '../multi-model-loop-prompts'

describe('multi-model loop Prompts and Judge parsing', () => {
  it('carries the prepared root and prior Judge feedback without adding tools', () => {
    expect(buildCandidatePrompt({
      effectivePrompt: 'Repair login',
      round: 2,
      candidateIndex: 1,
      feedback: 'Preserve the refresh-token behavior.'
    })).toContain('Repair login')
    expect(buildCandidatePrompt({
      effectivePrompt: 'Repair login',
      round: 2,
      candidateIndex: 1,
      feedback: 'Preserve the refresh-token behavior.'
    })).toContain('Preserve the refresh-token behavior.')
    expect(buildJudgePrompt({
      effectivePrompt: 'Repair login',
      revisionId: 'revision-2',
      revision: 'Candidate answer'
    })).toContain('"verdict":"PASS|REVISE"')
  })

  it.each([
    ['not json'],
    ['{"verdict":"PASS","score":100.5,"revisionId":"revision-1","feedback":"","unresolved":[]}'],
    ['{"verdict":"PASS","score":101,"revisionId":"revision-1","feedback":"","unresolved":[]}'],
    ['{"verdict":"PASS","score":90,"revisionId":"wrong","feedback":"","unresolved":[]}']
  ])('fails malformed Judge output closed: %s', raw => {
    expect(parseJudgeResult(raw, 'revision-1')).toMatchObject({
      valid: false,
      verdict: 'REVISE',
      score: 0,
      revisionId: 'revision-1'
    })
  })

  it('accepts one fenced JSON object and applies deterministic tie-breaks', () => {
    expect(parseJudgeResult(
      '~~~json\n{"verdict":"PASS","score":90,"revisionId":"revision-2","feedback":"ok","unresolved":[]}\n~~~',
      'revision-2'
    )).toMatchObject({ valid: true, verdict: 'PASS', score: 90 })
    expect(selectBestRevision([
      { revisionId: 'revision-b', content: 'b', round: 2, judge: { valid: true, verdict: 'REVISE', score: 90, revisionId: 'revision-b', feedback: '', unresolved: [] } },
      { revisionId: 'revision-a', content: 'a', round: 2, judge: { valid: true, verdict: 'REVISE', score: 90, revisionId: 'revision-a', feedback: '', unresolved: [] } },
      { revisionId: 'revision-c', content: 'c', round: 1, judge: { valid: true, verdict: 'REVISE', score: 90, revisionId: 'revision-c', feedback: '', unresolved: [] } }
    ])?.revisionId).toBe('revision-a')
  })
})
~~~

- [ ] **Step 2: Run the tests and confirm RED**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/multi-model-loop-prompts.test.ts --reporter=dot
~~~

Expected: FAIL because multi-model-loop-prompts.ts does not exist.

- [ ] **Step 3: Implement pure Prompt builders and strict parsing**

Create src/main/runtime/multi-model-loop-prompts.ts:

~~~ts
export interface JudgeResult {
  valid: boolean
  verdict: 'PASS' | 'REVISE'
  score: number
  revisionId: string
  feedback: string
  unresolved: string[]
}

export interface ScoredRevision {
  revisionId: string
  content: string
  round: number
  judge: JudgeResult
}

export function buildCandidatePrompt(input: {
  effectivePrompt: string
  round: number
  candidateIndex: number
  feedback?: string
}): string {
  return [
    '[Multi-model candidate]',
    'Round: ' + input.round,
    'Candidate: ' + input.candidateIndex,
    'Analyze independently. Read-only workspace inspection is allowed. Do not write files or run commands.',
    input.feedback ? 'Judge feedback from the prior round:\n' + input.feedback : '',
    'Prepared root request:\n' + input.effectivePrompt
  ].filter(Boolean).join('\n\n')
}

export function buildSynthesisPrompt(input: {
  effectivePrompt: string
  round: number
  candidates: Array<{ routeKey: string; content: string }>
}): string {
  const evidence = input.candidates.map((candidate, index) =>
    '[Candidate ' + (index + 1) + ' ' + candidate.routeKey + ']\n' + candidate.content
  ).join('\n\n')
  return [
    '[Multi-model synthesizer]',
    'Round: ' + input.round,
    'Produce one revision. Preserve material disagreements and unresolved evidence. Do not perform side effects.',
    'Prepared root request:\n' + input.effectivePrompt,
    evidence
  ].join('\n\n')
}

export function buildJudgePrompt(input: {
  effectivePrompt: string
  revisionId: string
  revision: string
}): string {
  return [
    '[Independent Judge]',
    'Evaluate correctness, completeness, faithfulness, and unresolved risks.',
    'Return exactly one JSON object with this shape:',
    '{"verdict":"PASS|REVISE","score":0,"revisionId":"' + input.revisionId + '","feedback":"","unresolved":[]}',
    'Score must be an integer from 0 through 100. revisionId must match exactly.',
    'Prepared root request:\n' + input.effectivePrompt,
    'Revision:\n' + input.revision
  ].join('\n\n')
}

function stripSingleFence(raw: string): string {
  const text = raw.trim()
  const match = text.match(/^~~~(?:json)?\s*([\s\S]*?)\s*~~~$/i)
  return match ? match[1].trim() : text
}

export function parseJudgeResult(raw: string, expectedRevisionId: string): JudgeResult {
  const invalid = (feedback: string): JudgeResult => ({
    valid: false,
    verdict: 'REVISE',
    score: 0,
    revisionId: expectedRevisionId,
    feedback,
    unresolved: []
  })
  try {
    const value = JSON.parse(stripSingleFence(raw))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Judge result is not an object.')
    const keys = Object.keys(value).sort()
    if (keys.join(',') !== ['feedback', 'revisionId', 'score', 'unresolved', 'verdict'].join(',')) {
      return invalid('Judge result has unexpected fields.')
    }
    if (value.verdict !== 'PASS' && value.verdict !== 'REVISE') return invalid('Judge verdict is invalid.')
    if (!Number.isInteger(value.score) || value.score < 0 || value.score > 100) return invalid('Judge score is invalid.')
    if (value.revisionId !== expectedRevisionId) return invalid('Judge revisionId does not match.')
    if (typeof value.feedback !== 'string') return invalid('Judge feedback is invalid.')
    if (!Array.isArray(value.unresolved) || value.unresolved.some((item: unknown) => typeof item !== 'string')) {
      return invalid('Judge unresolved list is invalid.')
    }
    return {
      valid: true,
      verdict: value.verdict,
      score: value.score,
      revisionId: value.revisionId,
      feedback: value.feedback,
      unresolved: value.unresolved
    }
  } catch {
    return invalid('Judge output is not valid JSON.')
  }
}

export function selectBestRevision(revisions: ScoredRevision[]): ScoredRevision | undefined {
  return [...revisions]
    .filter(revision => revision.judge.valid)
    .sort((left, right) =>
      right.judge.score - left.judge.score ||
      right.round - left.round ||
      left.revisionId.localeCompare(right.revisionId)
    )[0]
}
~~~

- [ ] **Step 4: Run Prompt/Judge tests and confirm GREEN**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/multi-model-loop-prompts.test.ts --reporter=dot
~~~

Expected: PASS; malformed results become REVISE/0 and ties select score, later round, then lexical revision ID.

- [ ] **Step 5: Stage only this task and commit**

~~~powershell
git add src/main/runtime/multi-model-loop-prompts.ts src/main/runtime/__tests__/multi-model-loop-prompts.test.ts
git commit -m "feat(runtime): add fusion prompts and judge validation"
~~~

### Task 7: Parallel MultiModelLoopRunner with one gated release

**Files:**
- Create: src/main/runtime/multi-model-loop.ts
- Create: src/main/runtime/__tests__/multi-model-loop.test.ts
- Modify: src/shared/prompt-contract.ts:151-170
- Modify: src/main/runtime/prompt-ingress-registry.ts:1114-1132
- Modify: src/main/runtime/__tests__/prompt-ingress-registry.test.ts

- [ ] **Step 1: Write failing bounded-loop tests**

Create src/main/runtime/__tests__/multi-model-loop.test.ts:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import { MultiModelLoopRunner, type LoopDispatchGateway } from '../multi-model-loop'
import { BudgetReservationCenter } from '../budget-reservations'
import { requirePromptIngress } from '../prompt-ingress-registry'
import type {
  DispatchEnvelope,
  PromptDispatchLineage,
  PromptEnvelope
} from '../../../shared/prompt-contract'

const routes = [
  { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
  { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' },
  { key: 'p3\u0000m3', agentId: 'c', providerId: 'p3', modelId: 'm3', protocol: 'http' }
] as any

function rootEnvelope(envelopeId: string, effectivePrompt: string): PromptEnvelope {
  return {
    envelopeId,
    sessionId: 'session-' + envelopeId,
    rootInputId: 'input-' + envelopeId,
    displayOriginalPrompt: effectivePrompt,
    effectivePrompt,
    origin: 'workbench:create',
    policy: 'optimize',
    status: 'optimized',
    optimizerVersion: 'prompt-preparation-v1',
    inputHash: 'input-hash-' + envelopeId,
    preparedTextHash: 'prepared-hash-' + envelopeId,
    optimizationCount: 1,
    finalizedAt: 1
  }
}

function rootLineage(envelope: PromptEnvelope): PromptDispatchLineage {
  return {
    origin: envelope.origin,
    policy: envelope.policy,
    rootInputId: envelope.rootInputId,
    rootEnvelopeId: envelope.envelopeId,
    rootPreparedTextHash: envelope.preparedTextHash
  }
}

function gatewayFor(judgeVerdicts: Array<'PASS' | 'REVISE'>): {
  gateway: LoopDispatchGateway
  calls: any[]
  cancelled: string[]
} {
  const calls: any[] = []
  const cancelled: string[] = []
  const gateway: LoopDispatchGateway = {
    start(request) {
      calls.push(request)
      const id = 'task-' + calls.length
      let content = request.role + '-content'
      if (request.role === 'judge') {
        const verdict = judgeVerdicts.shift() || 'PASS'
        content = JSON.stringify({
          verdict,
          score: verdict === 'PASS' ? 95 : 60,
          revisionId: request.revisionId,
          feedback: verdict === 'PASS' ? '' : 'Address the missing edge case.',
          unresolved: []
        })
      }
      const dispatchEnvelope: DispatchEnvelope = {
        dispatchId: id,
        ...request.options.lineage,
        providerId: request.route.providerId,
        modelId: request.route.modelId,
        canonicalPayloadHash: 'canonical-' + id,
        optimizationCount: 0
      }
      return {
        taskId: id,
        result: Promise.resolve({ status: 'completed', content, dispatchEnvelope }),
        cancel: async reason => { cancelled.push(reason || 'cancelled') }
      }
    }
  }
  return { gateway, calls, cancelled }
}

function reservationCenter() {
  return new BudgetReservationCenter(() => ({
    config: {
      version: 1,
      dailyLimitUsd: 100,
      monthlyLimitUsd: 1000,
      perRequestMaxTokens: 100_000,
      perRequestMaxCostUsd: 50,
      notifyAtPercent: 80,
      blockWhenExceeded: true,
      suggestCheaperModel: true
    },
    dailySpentUsd: 0,
    monthlySpentUsd: 0
  }))
}

describe('MultiModelLoopRunner', () => {
  it('uses only the four registered internal Loop origins', () => {
    const origins = [
      'internal:loop-candidate',
      'internal:loop-synthesizer',
      'internal:loop-judge',
      'internal:loop-executor'
    ] as const
    for (const origin of origins) {
      expect(requirePromptIngress(origin)).toEqual({
        policy: 'internal',
        scope: 'none',
        decisionCapability: 'none'
      })
    }
  })

  it('runs candidates in parallel, stops on PASS, and releases one chat event', async () => {
    const scripted = gatewayFor(['PASS'])
    const events: any[] = []
    const runner = new MultiModelLoopRunner({
      gateway: scripted.gateway,
      reservations: reservationCenter(),
      emit: event => events.push(event),
      estimateRound: count => ({ tokens: 1_000 * count, costUsd: count, requests: count + 2 }),
      estimateSingle: () => ({ tokens: 1_000, costUsd: 1, requests: 1 })
    })
    const envelope = rootEnvelope('env-1', 'Repair login')
    const result = await runner.run({
      runId: 'run-1',
      envelope,
      lineage: rootLineage(envelope),
      routes,
      turnId: 'turn-1',
      threadId: 'thread-1',
      deadline: Date.now() + 30_000,
      branchTimeoutMs: 5_000,
      maxCandidates: 2,
      maxRounds: 3,
      requiresExecution: false
    })
    expect(result.mode).toBe('fusion')
    expect(scripted.calls.filter(call => call.role === 'candidate')).toHaveLength(2)
    expect(scripted.calls.every(call =>
      call.options.visibility === 'run' &&
      call.options.optimizationCount === 0 &&
      call.options.capabilityMode === 'read-only'
    )).toBe(true)
    const candidateCalls = scripted.calls.filter(call => call.role === 'candidate')
    expect(candidateCalls.every(call =>
      call.origin === 'internal:loop-candidate' &&
      call.options.lineage.rootEnvelopeId === envelope.envelopeId &&
      call.options.lineage.rootPreparedTextHash === envelope.preparedTextHash
    )).toBe(true)
    const synthesis = scripted.calls.find(call => call.role === 'synthesizer')
    const judge = scripted.calls.find(call => call.role === 'judge')
    expect(synthesis.origin).toBe('internal:loop-synthesizer')
    expect(synthesis.options.lineage.parentDispatchId).toBe('task-1')
    expect(judge.origin).toBe('internal:loop-judge')
    expect(judge.options.lineage.parentDispatchId).toBe(synthesis.branchId === 'round-1-synthesizer' ? 'task-3' : '')
    expect(events.filter(event => event.visibility === 'chat')).toHaveLength(1)
    expect(events.find(event => event.visibility === 'chat')).toMatchObject({ gatedRelease: true })
  })

  it('allows at most one normal-capability Executor after acceptance', async () => {
    const scripted = gatewayFor(['PASS'])
    const runner = new MultiModelLoopRunner({
      gateway: scripted.gateway,
      reservations: reservationCenter(),
      emit: () => {},
      estimateRound: count => ({ tokens: 1_000 * count, costUsd: count, requests: count + 2 }),
      estimateSingle: () => ({ tokens: 1_000, costUsd: 1, requests: 1 })
    })
    const envelope = rootEnvelope('env-2', 'Implement login repair')
    await runner.run({
      runId: 'run-2',
      envelope,
      lineage: rootLineage(envelope),
      routes,
      turnId: 'turn-2',
      threadId: 'thread-2',
      deadline: Date.now() + 30_000,
      branchTimeoutMs: 5_000,
      maxCandidates: 3,
      maxRounds: 3,
      requiresExecution: true
    })
    const executors = scripted.calls.filter(call => call.role === 'executor')
    expect(executors).toHaveLength(1)
    expect(executors[0].options.capabilityMode).toBe('normal')
    expect(executors[0].options.visibility).toBe('run')
    expect(executors[0].origin).toBe('internal:loop-executor')
    expect(executors[0].options.lineage.parentDispatchId).toBeTruthy()
  })

  it('cancels every live branch when the root signal aborts', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => {})
    const gateway: LoopDispatchGateway = {
      start: request => ({
        taskId: request.branchId,
        result: new Promise(() => {}),
        cancel
      })
    }
    const runner = new MultiModelLoopRunner({
      gateway,
      reservations: reservationCenter(),
      emit: () => {},
      estimateRound: count => ({ tokens: 1_000 * count, costUsd: count, requests: count + 2 }),
      estimateSingle: () => ({ tokens: 1_000, costUsd: 1, requests: 1 })
    })
    const envelope = rootEnvelope('env-3', 'Analyze')
    const running = runner.run({
      runId: 'run-3',
      envelope,
      lineage: rootLineage(envelope),
      routes,
      turnId: 'turn-3',
      threadId: 'thread-3',
      signal: controller.signal,
      deadline: Date.now() + 30_000,
      branchTimeoutMs: 5_000,
      maxCandidates: 3,
      maxRounds: 3,
      requiresExecution: false
    })
    await Promise.resolve()
    controller.abort('user cancelled')
    await expect(running).rejects.toThrow(/user cancelled/)
    expect(cancel).toHaveBeenCalledTimes(3)
  })
})
~~~

- [ ] **Step 2: Run the tests and confirm RED**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/multi-model-loop.test.ts --reporter=dot
~~~

Expected: FAIL because multi-model-loop.ts and the four registered internal Loop origins do not exist; once the module exists, the maxCandidates: 2 assertion must still fail if the Runner hard-codes three branches or omits verified root/parent lineage.

- [ ] **Step 3: Implement the gateway and runner contracts**

Extend the Prompt plan's single PROMPT_ORIGINS source and exhaustive registry with these exact values; do not create a second Loop-only origin type outside the shared contract:

~~~ts
// Append inside PROMPT_ORIGINS in src/shared/prompt-contract.ts:
'internal:loop-candidate',
'internal:loop-synthesizer',
'internal:loop-judge',
'internal:loop-executor'

// Append inside PROMPT_INGRESS_REGISTRY in src/main/runtime/prompt-ingress-registry.ts:
'internal:loop-candidate': { policy: 'internal', scope: 'none', decisionCapability: 'none' },
'internal:loop-synthesizer': { policy: 'internal', scope: 'none', decisionCapability: 'none' },
'internal:loop-judge': { policy: 'internal', scope: 'none', decisionCapability: 'none' },
'internal:loop-executor': { policy: 'internal', scope: 'none', decisionCapability: 'none' }
~~~

Create src/main/runtime/multi-model-loop.ts with these public contracts:

~~~ts
import type { DispatchHandle } from '../hub/dispatcher'
import type {
  DispatchEnvelope,
  PromptDispatchLineage,
  PromptEnvelope,
  PromptOrigin
} from '../../shared/prompt-contract'
import { childDispatchLineage } from './dispatch-envelope'
import type { BudgetReservationAmount, BudgetReservationCenter } from './budget-reservations'
import { selectFusionTopology, type ResolvedFusionRoute } from './multi-model-routes'
import {
  buildCandidatePrompt,
  buildJudgePrompt,
  buildSynthesisPrompt,
  parseJudgeResult,
  selectBestRevision,
  type ScoredRevision
} from './multi-model-loop-prompts'

export type LoopRole = 'candidate' | 'synthesizer' | 'judge' | 'executor'
export type LoopPromptOrigin =
  | 'internal:loop-candidate'
  | 'internal:loop-synthesizer'
  | 'internal:loop-judge'
  | 'internal:loop-executor'

export const LOOP_ORIGIN_BY_ROLE = {
  candidate: 'internal:loop-candidate',
  synthesizer: 'internal:loop-synthesizer',
  judge: 'internal:loop-judge',
  executor: 'internal:loop-executor'
} as const satisfies Record<LoopRole, PromptOrigin>

export interface LoopBranchResult {
  status: 'completed' | 'failed' | 'cancelled'
  content: string
  error?: string
  dispatchEnvelope: DispatchEnvelope
}

export interface LoopDispatchRequest {
  role: LoopRole
  origin: LoopPromptOrigin
  route: ResolvedFusionRoute
  prompt: string
  branchId: string
  revisionId?: string
  options: {
    parentRunId: string
    sessionKey: string
    signal?: AbortSignal
    deadline: number
    budgetReservationId: string
    visibility: 'run'
    capabilityMode: 'normal' | 'read-only'
    optimizationCount: 0
    turnId: string
    threadId: string
    lineage: PromptDispatchLineage
  }
}

export interface LoopDispatchGateway {
  start(request: LoopDispatchRequest): DispatchHandle<LoopBranchResult>
}

export interface MultiModelLoopEvent {
  kind: string
  runId: string
  round?: number
  visibility: 'run' | 'chat'
  gatedRelease?: boolean
  content?: string
  metadata?: Record<string, unknown>
}

export interface MultiModelLoopDependencies {
  gateway: LoopDispatchGateway
  reservations: BudgetReservationCenter
  emit(event: MultiModelLoopEvent): void
  estimateRound(candidateCount: number, round: number): BudgetReservationAmount
  estimateSingle(role: 'candidate' | 'executor'): BudgetReservationAmount
}

export interface MultiModelLoopInput {
  runId: string
  envelope: PromptEnvelope
  lineage: PromptDispatchLineage
  routes: ResolvedFusionRoute[]
  turnId: string
  threadId: string
  signal?: AbortSignal
  deadline: number
  branchTimeoutMs: number
  maxCandidates: 2 | 3
  maxRounds: number
  requiresExecution: boolean
}

export interface MultiModelLoopResult {
  content: string
  mode: 'fusion' | 'degraded'
  rounds: number
  budgetLimited: boolean
  unverified: boolean
  failures: string[]
}
~~~

- [ ] **Step 4: Implement bounded rounds, cancellation, and final release**

Add this class below the contracts in src/main/runtime/multi-model-loop.ts:

~~~ts
export class MultiModelLoopRunner {
  constructor(private readonly deps: MultiModelLoopDependencies) {}

  async run(input: MultiModelLoopInput): Promise<MultiModelLoopResult> {
    if (!input.envelope.envelopeId || !input.envelope.effectivePrompt) {
      throw new Error('Prepared root Prompt envelope is required.')
    }
    if (
      input.lineage.rootInputId !== input.envelope.rootInputId ||
      input.lineage.rootEnvelopeId !== input.envelope.envelopeId ||
      input.lineage.rootPreparedTextHash !== input.envelope.preparedTextHash
    ) {
      throw new Error('Multi-model root lineage does not match the prepared Prompt envelope.')
    }
    const topology = selectFusionTopology(input.routes, input.maxCandidates)
    const maxRounds = Math.min(Math.max(input.maxRounds, 1), 3)
    const active = new Set<DispatchHandle<LoopBranchResult>>()
    const failures: string[] = []
    const revisions: ScoredRevision[] = []
    const synthesisDispatchIds = new Map<string, string>()
    let latestJudgeDispatchId: string | undefined
    let finalReleased = false

    const cancelAll = async (reason: string) => {
      await Promise.allSettled([...active].map(handle => handle.cancel(reason)))
    }
    const onAbort = () => { void cancelAll(String(input.signal?.reason || 'cancelled')) }
    input.signal?.addEventListener('abort', onAbort, { once: true })

    const dispatch = async (
      role: LoopDispatchRequest['role'],
      route: ResolvedFusionRoute,
      prompt: string,
      branchId: string,
      reservationId: string,
      revisionId?: string,
      parentDispatchId?: string
    ): Promise<LoopBranchResult> => {
      if (input.signal?.aborted) throw new Error(String(input.signal.reason || 'cancelled'))
      const origin = LOOP_ORIGIN_BY_ROLE[role]
      const lineage: PromptDispatchLineage = parentDispatchId
        ? childDispatchLineage(input.lineage, parentDispatchId, origin)
        : {
            origin,
            policy: 'internal',
            rootInputId: input.lineage.rootInputId,
            rootEnvelopeId: input.lineage.rootEnvelopeId,
            rootPreparedTextHash: input.lineage.rootPreparedTextHash
          }
      const handle = this.deps.gateway.start({
        role,
        origin,
        route,
        prompt,
        branchId,
        revisionId,
        options: {
          parentRunId: input.runId,
          sessionKey: input.threadId + ':' + input.runId + ':' + branchId,
          signal: input.signal,
          deadline: Math.min(input.deadline, Date.now() + input.branchTimeoutMs),
          budgetReservationId: reservationId,
          visibility: 'run',
          capabilityMode: role === 'executor' ? 'normal' : 'read-only',
          optimizationCount: 0,
          turnId: input.turnId,
          threadId: input.threadId,
          lineage
        }
      })
      active.add(handle)
      try {
        return await handle.result
      } finally {
        active.delete(handle)
      }
    }

    const release = async (
      content: string,
      mode: 'fusion' | 'degraded',
      rounds: number,
      budgetLimited: boolean,
      unverified: boolean,
      acceptedParentDispatchId?: string
    ): Promise<MultiModelLoopResult> => {
      let releasedContent = content
      if (input.requiresExecution) {
        const executorBudget = this.deps.reservations.reserve(
          input.runId + ':executor',
          this.deps.estimateSingle('executor')
        )
        if (executorBudget.ok) {
          try {
            const executor = await dispatch(
              'executor',
              topology.candidates[0],
              [
                '[Final Executor]',
                'Execute the accepted synthesis once under normal approval policy.',
                'Prepared root request:\n' + input.envelope.effectivePrompt,
                'Accepted synthesis:\n' + content
              ].join('\n\n'),
              'executor',
              executorBudget.receipt.id
              ,
              undefined,
              acceptedParentDispatchId
            )
            if (executor.status === 'completed' && executor.content) releasedContent = executor.content
            else failures.push(executor.error || 'Final Executor failed.')
          } finally {
            this.deps.reservations.release(executorBudget.receipt.id)
          }
        } else {
          failures.push(executorBudget.reason)
          budgetLimited = true
        }
      }
      if (finalReleased) throw new Error('Multi-model final output was released more than once.')
      finalReleased = true
      this.deps.emit({
        kind: 'multi-model:final',
        runId: input.runId,
        visibility: 'chat',
        gatedRelease: true,
        content: releasedContent,
        metadata: { mode, rounds, budgetLimited, unverified, failures: [...failures] }
      })
      return { content: releasedContent, mode, rounds, budgetLimited, unverified, failures }
    }

    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        const reservation = this.deps.reservations.reserve(
          input.runId + ':round:' + round,
          this.deps.estimateRound(topology.candidates.length, round)
        )
        if (!reservation.ok) {
          if (round === 1) {
            const singleBudget = this.deps.reservations.reserve(
              input.runId + ':single',
              this.deps.estimateSingle('candidate')
            )
            if (!singleBudget.ok) throw new Error(singleBudget.reason)
            try {
              const single = await dispatch(
                'candidate',
                topology.candidates[0],
                buildCandidatePrompt({
                  effectivePrompt: input.envelope.effectivePrompt,
                  round: 1,
                  candidateIndex: 1
                }),
                'single-fallback',
                singleBudget.receipt.id
              )
              if (single.status !== 'completed') throw new Error(single.error || 'Single-model fallback failed.')
              return await release(
                single.content,
                'degraded',
                1,
                true,
                true,
                single.dispatchEnvelope.dispatchId
              )
            } finally {
              this.deps.reservations.release(singleBudget.receipt.id)
            }
          }
          const best = selectBestRevision(revisions)
          if (!best) throw new Error(reservation.reason)
          return await release(
            best.content,
            'fusion',
            round - 1,
            true,
            false,
            synthesisDispatchIds.get(best.revisionId)
          )
        }

        try {
          this.deps.emit({ kind: 'multi-model:round-started', runId: input.runId, round, visibility: 'run' })
          const feedback = revisions.at(-1)?.judge.feedback
          const settled = await Promise.allSettled(topology.candidates.map((route, index) =>
            dispatch(
              'candidate',
              route,
              buildCandidatePrompt({
                effectivePrompt: input.envelope.effectivePrompt,
                round,
                candidateIndex: index + 1,
                feedback
              }),
              'round-' + round + '-candidate-' + (index + 1),
              reservation.receipt.id,
              undefined,
              latestJudgeDispatchId
            ).then(result => ({ route, result }))
          ))
          const successful = settled.flatMap(item => {
            if (item.status === 'rejected') {
              failures.push(item.reason instanceof Error ? item.reason.message : String(item.reason))
              return []
            }
            if (item.value.result.status !== 'completed' || !item.value.result.content) {
              failures.push(item.value.result.error || item.value.route.key + ' failed')
              return []
            }
            return [{
              routeKey: item.value.route.key,
              content: item.value.result.content,
              dispatchEnvelope: item.value.result.dispatchEnvelope
            }]
          })
          if (successful.length === 0) throw new Error('All multi-model candidates failed: ' + failures.join('; '))
          if (successful.length === 1) {
            return await release(
              successful[0].content,
              'degraded',
              round,
              false,
              true,
              successful[0].dispatchEnvelope.dispatchId
            )
          }

          const revisionId = 'revision-' + round
          const synthesis = await dispatch(
            'synthesizer',
            topology.synthesizer,
            buildSynthesisPrompt({
              effectivePrompt: input.envelope.effectivePrompt,
              round,
              candidates: successful.map(candidate => ({
                routeKey: candidate.routeKey,
                content: candidate.content
              }))
            }),
            'round-' + round + '-synthesizer',
            reservation.receipt.id,
            revisionId,
            successful[0].dispatchEnvelope.dispatchId
          )
          if (synthesis.status !== 'completed' || !synthesis.content) {
            throw new Error(synthesis.error || 'Synthesizer failed.')
          }
          const judged = await dispatch(
            'judge',
            topology.judge,
            buildJudgePrompt({
              effectivePrompt: input.envelope.effectivePrompt,
              revisionId,
              revision: synthesis.content
            }),
            'round-' + round + '-judge',
            reservation.receipt.id,
            revisionId,
            synthesis.dispatchEnvelope.dispatchId
          )
          const judge = parseJudgeResult(judged.content, revisionId)
          revisions.push({ revisionId, content: synthesis.content, round, judge })
          synthesisDispatchIds.set(revisionId, synthesis.dispatchEnvelope.dispatchId)
          latestJudgeDispatchId = judged.dispatchEnvelope.dispatchId
          if (judge.verdict === 'PASS') {
            return await release(
              synthesis.content,
              'fusion',
              round,
              false,
              false,
              synthesis.dispatchEnvelope.dispatchId
            )
          }
        } finally {
          this.deps.reservations.release(reservation.receipt.id)
        }
      }

      const best = selectBestRevision(revisions)
      if (best) {
        return await release(
          best.content,
          'fusion',
          maxRounds,
          false,
          false,
          synthesisDispatchIds.get(best.revisionId)
        )
      }
      const finalRevision = revisions.at(-1)
      if (!finalRevision) throw new Error('No multi-model revision was produced.')
      return await release(
        finalRevision.content,
        'fusion',
        maxRounds,
        false,
        true,
        synthesisDispatchIds.get(finalRevision.revisionId)
      )
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
      if (input.signal?.aborted) await cancelAll(String(input.signal.reason || 'cancelled'))
    }
  }
}
~~~

- [ ] **Step 5: Run loop tests and confirm GREEN**

~~~powershell
npm.cmd test -- src/main/runtime/__tests__/multi-model-loop.test.ts src/main/runtime/__tests__/multi-model-loop-prompts.test.ts src/main/runtime/__tests__/budget-reservations.test.ts --reporter=dot
~~~

Expected: PASS; maxCandidates limits fan-out to two or three, every role uses its registered internal origin, each result carries an independently verified DispatchEnvelope with retained root/parent lineage, candidate branches are read-only/run-visible, PASS stops immediately, cancellation reaches every live handle, and one Executor is the maximum.

- [ ] **Step 6: Stage only this task and commit**

~~~powershell
git add src/main/runtime/multi-model-loop.ts src/main/runtime/__tests__/multi-model-loop.test.ts src/shared/prompt-contract.ts src/main/runtime/prompt-ingress-registry.ts src/main/runtime/__tests__/prompt-ingress-registry.test.ts
git commit -m "feat(runtime): add bounded multi-model loop"
~~~

### Task 8: Wire prepared-root dispatch, explicit Fusion toggle, and integration coverage

**Files:**
- Create: src/main/runtime/multi-model-dispatch.ts
- Create: src/main/hub/__tests__/multi-model-loop-e2e.test.ts
- Modify: src/main/runtime/types.ts:101-116
- Modify: src/shared/ipc-contract.ts:533-564,4782-4990
- Modify: src/renderer/workbench/utils/dispatchRequest.ts:1-72
- Modify: src/renderer/workbench/__tests__/dispatchRequest.test.ts
- Modify: src/renderer/workbench/ComposerBar.tsx:48-102,250-297,819-1060
- Modify: src/renderer/workbench/WorkbenchMainContent.tsx:80-100,310-335
- Modify: src/renderer/workbench/WorkbenchLayout.tsx:140-155,950-1010,1440-1460
- Modify: src/main/index.ts:588-790,818-990

- [ ] **Step 1: Write failing prepared-root gate tests**

Create src/main/hub/__tests__/multi-model-loop-e2e.test.ts:

~~~ts
import { describe, expect, it, vi } from 'vitest'
import { dispatchPreparedTurn } from '../../runtime/multi-model-dispatch'
import type { PromptEnvelope } from '../../../shared/prompt-contract'

describe('prepared turn multi-model dispatch', () => {
  it('refuses a raw string without a finalized root envelope', async () => {
    await expect(dispatchPreparedTurn({
      envelope: undefined,
      fusion: { enabled: true, maxCandidates: 3, maxRounds: 3, allowExecutor: false }
    } as any, {
      dispatchOrdinary: vi.fn(),
      runFusion: vi.fn()
    })).rejects.toThrow(/finalized Prompt envelope/)
  })

  it('routes ordinary and Fusion modes with the effective prepared Prompt', async () => {
    const envelope: PromptEnvelope = {
      envelopeId: 'env-1',
      sessionId: 'session-1',
      rootInputId: 'input-1',
      displayOriginalPrompt: 'Original request',
      effectivePrompt: 'Optimized request',
      origin: 'workbench:create',
      policy: 'optimize',
      status: 'optimized',
      optimizerVersion: 'prompt-preparation-v1',
      inputHash: 'input-hash-1',
      preparedTextHash: 'hash-1',
      optimizationCount: 1,
      finalizedAt: 1
    }
    const dispatchOrdinary = vi.fn(async () => ({ content: 'ordinary' }))
    const runFusion = vi.fn(async () => ({ content: 'fusion' }))

    await dispatchPreparedTurn({
      envelope,
      fusion: { enabled: false, maxCandidates: 3, maxRounds: 3, allowExecutor: false }
    }, { dispatchOrdinary, runFusion })
    await dispatchPreparedTurn({
      envelope,
      fusion: { enabled: true, maxCandidates: 3, maxRounds: 3, allowExecutor: false }
    }, { dispatchOrdinary, runFusion })

    expect(dispatchOrdinary).toHaveBeenCalledWith(envelope)
    expect(runFusion).toHaveBeenCalledWith(envelope, {
      enabled: true,
      maxCandidates: 3,
      maxRounds: 3,
      allowExecutor: false
    })
  })
})
~~~

Add this expectation to src/renderer/workbench/__tests__/dispatchRequest.test.ts:

~~~ts
it('snapshots the explicit multi-model Fusion toggle into the turn request', () => {
  expect(resolve({
    multiModelFusion: true,
    overrides: {}
  } as any)).toMatchObject({
    multiModelFusion: {
      enabled: true,
      maxCandidates: 3,
      maxRounds: 3,
      allowExecutor: true
    }
  })
})
~~~

- [ ] **Step 2: Run integration tests and confirm RED**

~~~powershell
npm.cmd test -- src/main/hub/__tests__/multi-model-loop-e2e.test.ts src/renderer/workbench/__tests__/dispatchRequest.test.ts --reporter=dot
~~~

Expected: FAIL because multi-model-dispatch.ts and multiModelFusion request fields do not exist.

- [ ] **Step 3: Add the prepared-root dispatch gate**

Create src/main/runtime/multi-model-dispatch.ts:

~~~ts
import type { PromptEnvelope } from '../../shared/prompt-contract'

export interface MultiModelFusionConfig {
  enabled: boolean
  maxCandidates: 2 | 3
  maxRounds: 1 | 2 | 3
  allowExecutor: boolean
}

export interface PreparedTurnDispatch {
  envelope: PromptEnvelope | undefined
  fusion: MultiModelFusionConfig
}

export async function dispatchPreparedTurn<T>(
  input: PreparedTurnDispatch,
  dependencies: {
    dispatchOrdinary(envelope: PromptEnvelope): Promise<T>
    runFusion(envelope: PromptEnvelope, config: MultiModelFusionConfig): Promise<T>
  }
): Promise<T> {
  if (!input.envelope?.envelopeId || !input.envelope.effectivePrompt) {
    throw new Error('A finalized Prompt envelope is required before routing.')
  }
  if (input.fusion.enabled) return dependencies.runFusion(input.envelope, input.fusion)
  return dependencies.dispatchOrdinary(input.envelope)
}
~~~

- [ ] **Step 4: Extend runtime and IPC types with bounded Fusion settings**

Add to src/main/runtime/types.ts and mirror it in src/shared/ipc-contract.ts:

~~~ts
export interface MultiModelFusionConfig {
  enabled: boolean
  maxCandidates: 2 | 3
  maxRounds: 1 | 2 | 3
  allowExecutor: boolean
}

// Add to WorkbenchTurn and TurnCreateInputLike:
multiModelFusion?: MultiModelFusionConfig
~~~

Add this validator and invoke it from validateTurnCreateInput:

~~~ts
function validateMultiModelFusion(value: unknown): string | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'payload.multiModelFusion must be an object'
  const record = value as Record<string, unknown>
  if (typeof record.enabled !== 'boolean') return 'payload.multiModelFusion.enabled must be boolean'
  if (record.maxCandidates !== 2 && record.maxCandidates !== 3) {
    return 'payload.multiModelFusion.maxCandidates must be 2 or 3'
  }
  if (record.maxRounds !== 1 && record.maxRounds !== 2 && record.maxRounds !== 3) {
    return 'payload.multiModelFusion.maxRounds must be 1, 2, or 3'
  }
  if (typeof record.allowExecutor !== 'boolean') return 'payload.multiModelFusion.allowExecutor must be boolean'
  return null
}

// Add inside validateTurnCreateInput:
validateMultiModelFusion(record.multiModelFusion) ||
~~~

- [ ] **Step 5: Carry an explicit persisted Composer toggle through request snapshots**

Extend dispatchRequest.ts input/output types and returned payload:

~~~ts
multiModelFusion?: boolean

multiModelFusion: {
  enabled: input.multiModelFusion === true,
  maxCandidates: 3,
  maxRounds: 3,
  allowExecutor: true
}
~~~

In WorkbenchLayout.tsx create persisted state:

~~~ts
const [multiModelFusion, setMultiModelFusion] = useState(
  () => window.localStorage.getItem('agenthub.multiModelFusion.v1') === 'true'
)

useEffect(() => {
  window.localStorage.setItem('agenthub.multiModelFusion.v1', String(multiModelFusion))
}, [multiModelFusion])
~~~

Pass multiModelFusion and setMultiModelFusion through WorkbenchMainContent to ComposerBar. Add these props to ComposerBar:

~~~ts
multiModelFusion: boolean
setMultiModelFusion: (enabled: boolean) => void
~~~

Include multiModelFusion when resolving the send request and add this control immediately before the existing model picker:

~~~tsx
<button
  type="button"
  className={'wb-composer-fusion-toggle' + (multiModelFusion ? ' active' : '')}
  aria-pressed={multiModelFusion}
  title={tr('多模型融合：候选、综合、评审后只输出一次', 'Multi-model fusion: candidate, synthesize, judge, then release once')}
  onClick={() => setMultiModelFusion(!multiModelFusion)}
>
  {tr('融合', 'Fusion')}
</button>
~~~

- [ ] **Step 6: Adapt the production Dispatcher to the loop gateway**

In src/main/index.ts import the shared owner type and the adapter factory. Construct the owner only after the Turn exists. DecisionOwner uses type: 'turn'; kind is reserved for the decision request:

~~~ts
import type { DecisionOwner } from '../shared/decision-contract'
import { createUserDecisionAdapter } from './agentic/user-decision-adapter'

const decisionOwner: DecisionOwner = {
  type: 'turn',
  threadId: thread.id,
  turnId: turn.id,
  workspaceId: workspaceId ?? thread.workspaceId ?? null,
  webContentsId: _event.sender.id
}
const userDecisionAdapter = createUserDecisionAdapter({
  decisionService,
  owner: decisionOwner
})

const loopGateway: LoopDispatchGateway = {
  start(request) {
    const handle = activeDispatcher.startDispatch(
      request.prompt,
      'auto',
      request.route.agentId,
      {
        workspaceId: workspaceId ?? thread.workspaceId ?? null,
        turnId: request.options.turnId,
        threadId: request.options.threadId,
        parentRunId: request.options.parentRunId,
        branchId: request.branchId,
        sessionKey: request.options.sessionKey,
        signal: request.options.signal,
        deadline: request.options.deadline,
        budgetReservationId: request.options.budgetReservationId,
        visibility: 'run',
        capabilityMode: request.options.capabilityMode,
        userDecisionAdapter,
        lineage: request.options.lineage,
        parentDispatchId: request.options.lineage.parentDispatchId,
        streamMeta: {
          visibility: 'run',
          optimizationCount: 0,
          role: request.role,
          origin: request.origin,
          gatedRelease: false
        }
      }
    )
    return {
      taskId: handle.taskId,
      cancel: handle.cancel,
      result: handle.result.then(task => {
        if (!task.latestDispatchEnvelope) {
          throw new Error('Dispatcher send boundary did not return a verified DispatchEnvelope.')
        }
        return {
          status: task.status === 'completed' ? 'completed' : task.status === 'cancelled' ? 'cancelled' : 'failed',
          content: task.results.get(request.route.agentId) || [...task.results.values()].join('\n\n'),
          error: task.error || task.errors.get(request.route.agentId),
          dispatchEnvelope: task.latestDispatchEnvelope
        }
      })
    }
  }
}
~~~

Pass the same userDecisionAdapter in the DispatchOptions object of every ordinary activeDispatcher.dispatch call for this Turn. Dispatcher selects the actual agentId and invokes userDecisionAdapter.forAgent(agentId, opts.signal), so both ordinary HTTP agentic execution and Fusion branches use the same authoritative owner and same-Turn DecisionService continuation.

After Prompt preparation has finalized its envelope, replace the ordinary-versus-Fusion branch with dispatchPreparedTurn. The runner receives the envelope effectivePrompt and internal calls never invoke optimizePromptForDispatch:

~~~ts
const fusionConfig = payload.multiModelFusion || {
  enabled: false,
  maxCandidates: 3,
  maxRounds: 3,
  allowExecutor: true
}

const runner = dispatchPreparedTurn({
  envelope: promptPreparation.envelope,
  fusion: fusionConfig
}, {
  dispatchOrdinary: async envelope => ordinaryDispatch(envelope.effectivePrompt),
  runFusion: async (envelope, config) => {
    const routes = resolveDistinctFusionRoutes({
      getBindings: () => getProviderManager().getBindings(),
      resolveBinding: agentId => getProviderManager().resolveBinding(agentId)
    })
    const loop = new MultiModelLoopRunner({
      gateway: loopGateway,
      reservations: dispatchBudgetReservations,
      emit: event => runtimeStore.appendSystemEvent(
        thread.id,
        turn.id,
        event.kind as any,
        'multi-model-loop',
        event
      ),
      estimateRound: candidateCount => ({
        tokens: budgetEstimate.totalTokens * (candidateCount + 2),
        costUsd: budgetEstimate.estimatedCostUsd == null
          ? null
          : budgetEstimate.estimatedCostUsd * (candidateCount + 2),
        requests: candidateCount + 2
      }),
      estimateSingle: () => ({
        tokens: budgetEstimate.totalTokens,
        costUsd: budgetEstimate.estimatedCostUsd,
        requests: 1
      })
    })
    return loop.run({
      runId: turn.id,
      envelope,
      lineage: {
        origin: envelope.origin,
        policy: envelope.policy,
        rootInputId: envelope.rootInputId,
        rootEnvelopeId: envelope.envelopeId,
        rootPreparedTextHash: envelope.preparedTextHash
      },
      routes,
      turnId: turn.id,
      threadId: thread.id,
      deadline: Date.now() + 10 * 60 * 1000,
      branchTimeoutMs: 2 * 60 * 1000,
      maxCandidates: config.maxCandidates,
      maxRounds: config.maxRounds,
      requiresExecution: config.allowExecutor &&
        ['implementation', 'bugfix', 'operations'].includes(promptOptimization.intent)
    })
  }
})
~~~

Apply the same dispatchPreparedTurn boundary to turns:retry using the retry preparation envelope. Build the retry owner with the new Turn and the trusted sender:

~~~ts
const retryDecisionOwner: DecisionOwner = {
  type: 'turn',
  threadId: thread.id,
  turnId: created.turn.id,
  workspaceId: thread.workspaceId ?? null,
  webContentsId: _event.sender.id
}
const retryUserDecisionAdapter = createUserDecisionAdapter({
  decisionService,
  owner: retryDecisionOwner
})
~~~

Pass retryUserDecisionAdapter to every retry Dispatcher call. Do not call the optimizer from MultiModelLoopRunner or the gateway.

- [ ] **Step 7: Run focused integration and contract tests**

~~~powershell
npm.cmd test -- src/main/hub/__tests__/multi-model-loop-e2e.test.ts src/main/runtime/__tests__/multi-model-loop.test.ts src/renderer/workbench/__tests__/dispatchRequest.test.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts --reporter=dot
~~~

Expected: PASS; missing envelopes fail before routing, toggle-off uses ordinary dispatch, toggle-on uses Fusion, every child has optimizationCount: 0, and only one chat-visible final event exists.

- [ ] **Step 8: Run full verification**

~~~powershell
npm.cmd run typecheck
npm.cmd test -- --reporter=dot
npm.cmd run build
npm.cmd run test:e2e
git diff --check
~~~

Expected: typecheck, tests, build, E2E, and whitespace checks pass. If lint is also run, classify the known baseline errors in src/main/runtime/git.ts and src/main/runtime/plugin-marketplace.ts separately from this feature.

- [ ] **Step 9: Stage only this task and commit**

~~~powershell
git add src/main/runtime/multi-model-dispatch.ts src/main/hub/__tests__/multi-model-loop-e2e.test.ts src/main/runtime/types.ts src/shared/ipc-contract.ts src/renderer/workbench/utils/dispatchRequest.ts src/renderer/workbench/__tests__/dispatchRequest.test.ts src/renderer/workbench/ComposerBar.tsx src/renderer/workbench/WorkbenchMainContent.tsx src/renderer/workbench/WorkbenchLayout.tsx src/main/index.ts
git commit -m "feat(runtime): wire prepared multi-model fusion"
~~~

## Final acceptance audit

- [ ] One root user input reaches Prompt preparation before Router or Fusion.
- [ ] No internal candidate, synthesizer, Judge, or Executor starts another root optimization session.
- [ ] Fusion requires at least two distinct resolved provider/model keys.
- [ ] Candidate, synthesizer, and Judge branches are code-gated read-only.
- [ ] stdio-plain is never selected for a read-only Fusion role.
- [ ] Each round reserves its aggregate budget before any branch starts and releases it on success, failure, or cancellation.
- [ ] PASS stops immediately; three REVISE rounds select score, later round, then lexical revision ID.
- [ ] One successful candidate is labeled degraded; zero successful candidates fails with combined errors.
- [ ] At most one side-effecting Executor runs after acceptance.
- [ ] All child streams are visibility: run and exactly one gated final event is visibility: chat.
- [ ] Root cancellation cancels all live handles, timers, approvals, and decision waits without restarting the Turn.
