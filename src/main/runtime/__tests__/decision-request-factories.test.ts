import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DecisionRequest } from '../../../shared/decision-contract'
import {
  AGENT_TEXT_DEFAULT_MAX_CHARS,
  createAcpDecisionRequest,
  createAgentDecisionRequest,
  createGuardDecisionRequest,
  createMultiModelLoopDecisionRequest,
  createPromptDecisionRequest,
  createRouterDecisionRequest,
  createToolDecisionRequest,
  isCreatedDecisionRequest,
  validateDecisionRequest
} from '../decision-request-factories'

const owner = {
  type: 'turn' as const,
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  webContentsId: 7
}

function assertCreatedRequestIsDeeplyReadonly(
  created: ReturnType<typeof createToolDecisionRequest>
): void {
  // @ts-expect-error Created decision request fields are immutable.
  created.title = 'Changed'
  // @ts-expect-error Created decision owners cannot be replaced.
  created.owner = owner
  if (created.owner.type === 'turn') {
    // @ts-expect-error Created decision owner fields are immutable.
    created.owner.threadId = 'changed-thread'
  }
  // @ts-expect-error Created decision option arrays are immutable.
  created.options.push({ id: 'later', label: 'Later' })
  // @ts-expect-error Created decision option fields are immutable.
  created.options[0]!.label = 'Changed'
  if (created.customInput) {
    // @ts-expect-error Created decision custom-input fields are immutable.
    created.customInput.maxChars = 2
  }
  if (created.metadata) {
    // @ts-expect-error Created decision metadata fields are immutable.
    created.metadata.risk = 'critical'
  }
}

void assertCreatedRequestIsDeeplyReadonly

function request(patch: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    owner,
    source: 'agent',
    kind: 'single-select',
    title: 'Choose one',
    options: [{ id: 'one', label: 'One' }],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: false,
    createdAt: Date.now(),
    ...patch
  }
}

describe('decision request factories', () => {
  it('recognizes only the exact frozen request returned by a public factory', () => {
    const created = createPromptDecisionRequest({
      owner,
      title: 'Choose one',
      kind: 'single-select',
      options: [{ id: 'one', label: 'One' }]
    })
    const spread = { ...created }
    const tamperedSpread = { ...created, title: 'Tampered' }
    const copiedSymbols = Object.fromEntries(
      Reflect.ownKeys(created).map(key => [key, Reflect.get(created, key)])
    )

    expect(isCreatedDecisionRequest(created)).toBe(true)
    expect(isCreatedDecisionRequest(spread)).toBe(false)
    expect(isCreatedDecisionRequest(tamperedSpread)).toBe(false)
    expect(isCreatedDecisionRequest(copiedSymbols)).toBe(false)
    expect(isCreatedDecisionRequest({})).toBe(false)
    expect(isCreatedDecisionRequest(null)).toBe(false)
  })

  it('creates neutral Agent requests without privileged fields', () => {
    const created = createAgentDecisionRequest({
      owner,
      title: 'Choose scope',
      kind: 'single-select',
      options: [
        { id: 'focused', label: 'Focused repair' },
        { id: 'audit', label: 'Full audit' }
      ],
      idempotencyKey: 'agent-1:step-2:scope'
    })

    expect(created.source).toBe('agent')
    expect(created.allowRemember).toBe(false)
    expect(created.deadlineMs).toBeUndefined()
    expect(created.metadata).toBeUndefined()
    expect(created.options.every(option => option.tone === undefined && option.preview === undefined)).toBe(true)
  })

  it('rejects every generic Agent attempt to set privileged decision fields', () => {
    const base = {
      owner,
      title: 'Run command',
      kind: 'confirm' as const,
      options: [{ id: 'allow', label: 'Allow' }],
      idempotencyKey: 'agent-1:step-3:permission'
    }

    for (const privileged of [
      { allowRemember: false },
      { deadlineMs: 0 },
      { metadata: {} },
      { options: [{ id: 'allow', label: 'Allow', tone: 'danger' }] },
      { options: [{ id: 'allow', label: 'Allow', tone: undefined }] },
      { options: [{ id: 'allow', label: 'Allow', preview: 'npm.cmd test' }] },
      { options: [{ id: 'allow', label: 'Allow', preview: undefined }] }
    ]) {
      expect(() => createAgentDecisionRequest({ ...base, ...privileged } as never)).toThrow(
        'privileged decision fields'
      )
    }

    expect(() => createAgentDecisionRequest({ ...base, idempotencyKey: '   ' })).toThrow('idempotency key')
  })

  it('preserves a nonblank Agent idempotency key exactly', () => {
    const idempotencyKey = '  agent-1:step-3:exact  '
    const created = createAgentDecisionRequest({
      owner,
      title: 'Choose one',
      kind: 'single-select',
      options: [{ id: 'one', label: 'One' }],
      idempotencyKey
    })

    expect(created.idempotencyKey).toBe(idempotencyKey)
  })

  it('rejects duplicate IDs and invalid single, multi, and text cardinality', () => {
    expect(() => validateDecisionRequest(request({
      options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }]
    }))).toThrow('unique')

    expect(() => validateDecisionRequest(request({ minSelections: 0, maxSelections: 1 }))).toThrow(
      'exactly one selection'
    )
    expect(() => validateDecisionRequest(request({
      kind: 'multi-select',
      options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }],
      minSelections: 2,
      maxSelections: 1
    }))).toThrow('Multi-select cardinality')
    expect(() => validateDecisionRequest(request({
      kind: 'text',
      options: [],
      minSelections: 1,
      maxSelections: 1,
      allowCustom: true,
      customInput: { maxChars: 100 }
    }))).toThrow('custom input only')
  })

  it('creates safe ordered Tool and Guard requests with privileged metadata', () => {
    const tool = createToolDecisionRequest({
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
    const guard = createGuardDecisionRequest({
      owner,
      agentId: 'codex',
      role: 'reviewer',
      risk: 'high',
      reasons: ['unsafe path', 'untrusted argument'],
      deadlineMs: 60_000
    })

    expect(tool.source).toBe('tool')
    expect(tool.options.map(option => option.id)).toEqual(['deny', 'allow-once'])
    expect(tool.allowCustom).toBe(false)
    expect(tool.metadata).toEqual(expect.objectContaining({
      risk: 'medium',
      agentId: 'codex',
      target: 'npm.cmd test'
    }))
    expect(guard.options.map(option => option.id)).toEqual(['deny', 'allow-once'])
    expect(guard.allowRemember).toBe(false)
    expect(guard.allowCustom).toBe(false)
    expect(guard.metadata).toEqual(expect.objectContaining({
      risk: 'high',
      action: 'guard:reviewer'
    }))
  })

  it('keeps Prompt, Router, and Multi-model Loop requests neutral', () => {
    const factories = [
      createPromptDecisionRequest,
      createRouterDecisionRequest,
      createMultiModelLoopDecisionRequest
    ]

    const created = factories.map(factory => factory({
      owner,
      title: 'Choose a candidate',
      kind: 'single-select',
      options: [{ id: 'candidate', label: 'Candidate', preview: 'Display-safe preview' }]
    }))

    expect(created.map(item => item.source)).toEqual(['prompt-optimizer', 'router', 'multi-model-loop'])
    for (const item of created) {
      expect(item.allowRemember).toBe(false)
      expect(item.deadlineMs).toBeUndefined()
      expect(item.metadata).toBeUndefined()
      expect(item.options[0]?.preview).toBe('Display-safe preview')
      expect(item.options[0]?.tone).toBeUndefined()
    }
  })

  it('preserves exact ACP option IDs and rejects duplicate or blank IDs', () => {
    const created = createAcpDecisionRequest({
      owner,
      title: 'Allow ACP operation?',
      toolName: 'filesystem',
      options: [
        { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
        { optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once' }
      ]
    })

    expect(created.options.map(option => option.id)).toEqual(['deny.exact', 'allow.once/exact'])
    expect(created.allowCustom).toBe(false)
    expect(created.allowRemember).toBe(false)
    expect(created.metadata).toEqual({ toolName: 'filesystem', action: 'acp_permission' })

    expect(() => createAcpDecisionRequest({
      owner,
      title: 'Duplicate',
      toolName: 'filesystem',
      options: [{ optionId: 'same' }, { optionId: 'same' }]
    })).toThrow('non-empty and unique')
    expect(() => createAcpDecisionRequest({
      owner,
      title: 'Blank',
      toolName: 'filesystem',
      options: [{ optionId: '   ' }]
    })).toThrow('non-empty and unique')
  })

  it('defaults ordinary Agent text to 16 KiB and enforces the 512 KiB ceiling', () => {
    const created = createAgentDecisionRequest({
      owner,
      title: 'Describe the desired change',
      kind: 'text',
      options: [],
      idempotencyKey: 'agent-1:step-4:text'
    })

    expect(AGENT_TEXT_DEFAULT_MAX_CHARS).toBe(16 * 1024)
    expect(created.minSelections).toBe(0)
    expect(created.maxSelections).toBe(0)
    expect(created.allowCustom).toBe(true)
    expect(created.customInput?.maxChars).toBe(16 * 1024)

    expect(() => createAgentDecisionRequest({
      owner,
      title: 'Too much text',
      kind: 'text',
      options: [],
      idempotencyKey: 'agent-1:step-5:text',
      customInput: { maxChars: 512 * 1024 + 1 }
    })).toThrow('Custom input limit')
  })

  it('rejects zero-option selections, blank IDs, oversized option sets, and missing text custom input', () => {
    expect(() => validateDecisionRequest(request({ options: [] }))).toThrow('at least one option')
    expect(() => validateDecisionRequest(request({ options: [{ id: '   ', label: 'Blank' }] }))).toThrow(
      'non-empty'
    )
    expect(() => validateDecisionRequest(request({
      options: Array.from({ length: 9 }, (_, index) => ({ id: String(index), label: String(index) }))
    }))).toThrow('at most 8')
    expect(() => validateDecisionRequest(request({
      kind: 'text',
      options: [],
      minSelections: 0,
      maxSelections: 0,
      allowCustom: true
    }))).toThrow('custom input')
  })

  it('enforces schema and confirm option/cardinality boundaries', () => {
    expect(() => validateDecisionRequest(request({ schemaVersion: 2 as 1 }))).toThrow('schema version')
    expect(() => validateDecisionRequest(request({
      kind: 'confirm',
      options: [],
      minSelections: 1,
      maxSelections: 1
    }))).toThrow('at least one option')
    expect(() => validateDecisionRequest(request({
      kind: 'confirm',
      options: [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }],
      minSelections: 0,
      maxSelections: 1
    }))).toThrow('exactly one selection')
    expect(() => validateDecisionRequest(request({
      kind: 'confirm',
      options: [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }],
      minSelections: 1,
      maxSelections: 1
    }))).not.toThrow()
  })

  it('enforces multi-select zero, minimum, maximum, and valid edge boundaries', () => {
    expect(() => validateDecisionRequest(request({
      kind: 'multi-select',
      options: [],
      minSelections: 1,
      maxSelections: 1
    }))).toThrow('Multi-select cardinality')
    expect(() => validateDecisionRequest(request({
      kind: 'multi-select',
      options: [{ id: 'one', label: 'One' }],
      minSelections: 0,
      maxSelections: 1
    }))).toThrow('Multi-select cardinality')
    expect(() => validateDecisionRequest(request({
      kind: 'multi-select',
      options: [{ id: 'one', label: 'One' }],
      minSelections: 1,
      maxSelections: 2
    }))).toThrow('Multi-select cardinality')
    expect(() => validateDecisionRequest(request({
      kind: 'multi-select',
      options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }],
      minSelections: 1,
      maxSelections: 2
    }))).not.toThrow()
  })

  it('requires text requests to have zero options', () => {
    const textRequest = {
      kind: 'text' as const,
      options: [] as DecisionRequest['options'],
      minSelections: 0,
      maxSelections: 0,
      allowCustom: true
    }

    expect(() => validateDecisionRequest(request({
      ...textRequest,
      options: [{ id: 'unexpected', label: 'Unexpected' }],
      customInput: { maxChars: 1 }
    }))).toThrow('custom input only')
  })

  it('requires custom input limits and accepts only the exact valid boundaries', () => {
    const textRequest = {
      kind: 'text' as const,
      options: [] as DecisionRequest['options'],
      minSelections: 0,
      maxSelections: 0,
      allowCustom: true
    }

    expect(() => validateDecisionRequest(request({ ...textRequest, customInput: { maxChars: 1 } }))).not.toThrow()
    expect(() => validateDecisionRequest(request({
      ...textRequest,
      customInput: { maxChars: 512 * 1024 }
    }))).not.toThrow()
    expect(() => validateDecisionRequest(request({ ...textRequest, customInput: { maxChars: 0 } }))).toThrow(
      'Custom input limit'
    )
    expect(() => validateDecisionRequest(request({
      ...textRequest,
      customInput: { maxChars: 512 * 1024 + 1 }
    }))).toThrow('Custom input limit')
    expect(() => validateDecisionRequest(request({
      ...textRequest,
      customInput: {} as DecisionRequest['customInput']
    }))).toThrow('Custom input limit')
  })

  it('defensively clones and freezes nested authoritative request data', () => {
    const mutableOwner = { ...owner }
    const options = [{ id: 'one', label: 'Original', preview: 'Original preview' }]
    const customInput = { placeholder: 'Original placeholder', maxChars: 1_024 }
    const created = createPromptDecisionRequest({
      owner: mutableOwner,
      title: 'Choose safely',
      kind: 'single-select',
      options,
      allowCustom: true,
      customInput
    })

    mutableOwner.threadId = 'mutated-thread'
    options[0]!.label = 'Mutated label'
    options[0]!.preview = 'Mutated preview'
    customInput.placeholder = 'Mutated placeholder'
    customInput.maxChars = 2_048

    expect(created.owner).toEqual(owner)
    expect(created.options[0]).toEqual({ id: 'one', label: 'Original', preview: 'Original preview' })
    expect(created.customInput).toEqual({ placeholder: 'Original placeholder', maxChars: 1_024 })
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.owner)).toBe(true)
    expect(Object.isFrozen(created.options)).toBe(true)
    expect(Object.isFrozen(created.options[0])).toBe(true)
    expect(Object.isFrozen(created.customInput)).toBe(true)

    const tool = createToolDecisionRequest({
      owner,
      agentId: 'codex',
      tool: 'write',
      toolName: 'write',
      action: 'write_file',
      target: 'safe.txt',
      preview: 'safe content',
      risk: 'low'
    })
    expect(Object.isFrozen(tool.metadata)).toBe(true)
    expect(Reflect.set(tool.metadata!, 'risk', 'critical')).toBe(false)
    expect(tool.metadata?.risk).toBe('low')
  })

  it('rejects malformed request identity and privileged fields on neutral sources', () => {
    expect(() => validateDecisionRequest(request({ id: '   ' }))).toThrow('id and title')
    expect(() => validateDecisionRequest(request({ title: '   ' }))).toThrow('id and title')
    expect(() => validateDecisionRequest(request({ allowRemember: true }))).toThrow('privileged decision fields')
    expect(() => validateDecisionRequest(request({ deadlineMs: 1_000 }))).toThrow('privileged decision fields')
    expect(() => validateDecisionRequest(request({ metadata: { risk: 'high' } }))).toThrow(
      'privileged decision fields'
    )
  })

  it('rejects unknown discriminants and malformed turn or hub owners', () => {
    const malformed = [
      request({ source: 'unknown' as DecisionRequest['source'] }),
      request({ kind: 'choice' as DecisionRequest['kind'] }),
      request({ owner: null as unknown as DecisionRequest['owner'] }),
      request({ owner: { type: 'turn', threadId: ' ', turnId: 'turn-1', workspaceId: null, webContentsId: 7 } }),
      request({ owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: 42, webContentsId: 7 } as unknown as DecisionRequest['owner'] }),
      request({ owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 1.5 } }),
      request({ owner: { type: 'hub', sessionId: '   ' } })
    ]

    for (const value of malformed) {
      expect(() => validateDecisionRequest(value)).toThrow()
    }
  })

  it('validates every request field at runtime', () => {
    const privileged = (patch: Partial<DecisionRequest>): DecisionRequest => request({
      source: 'tool',
      ...patch
    })
    const malformed = [
      request({ description: 42 as unknown as string }),
      request({ options: [null as unknown as DecisionRequest['options'][number]] }),
      request({ options: [{ id: 'one', label: '   ' }] }),
      request({ options: [{ id: 'one', label: 'One', tone: 'loud' as 'default' }] }),
      request({ options: [{ id: 'one', label: 'One', preview: 42 as unknown as string }] }),
      request({ minSelections: 1.5 }),
      request({ allowCustom: 'yes' as unknown as boolean, customInput: { maxChars: 1 } }),
      privileged({ allowRemember: 'yes' as unknown as boolean }),
      request({ idempotencyKey: '   ' }),
      request({ createdAt: Number.NaN }),
      request({ createdAt: Number.POSITIVE_INFINITY }),
      request({ createdAt: -1 }),
      privileged({ deadlineMs: 0 }),
      privileged({ deadlineMs: 1.5 }),
      privileged({ metadata: null as unknown as DecisionRequest['metadata'] }),
      privileged({ metadata: { risk: 'severe' as 'low' } }),
      privileged({ metadata: { target: 42 as unknown as string } })
    ]

    for (const value of malformed) {
      expect(() => validateDecisionRequest(value)).toThrow()
    }
  })

  it('validates custom-input objects and their consistency', () => {
    const textRequest = {
      kind: 'text' as const,
      options: [] as DecisionRequest['options'],
      minSelections: 0,
      maxSelections: 0,
      allowCustom: true
    }

    expect(() => validateDecisionRequest(request({
      ...textRequest,
      customInput: { placeholder: 42 as unknown as string, maxChars: 1 }
    }))).toThrow()
    expect(() => validateDecisionRequest(request({
      allowCustom: false,
      customInput: { maxChars: 1 }
    }))).toThrow('requires allowCustom')
    expect(() => validateDecisionRequest(request({
      ...textRequest,
      customInput: [] as unknown as NonNullable<DecisionRequest['customInput']>
    }))).toThrow()
  })

  it('rejects malformed untyped input at every public factory boundary', () => {
    const invalidCalls = [
      () => createAgentDecisionRequest({
        owner,
        title: 'Agent',
        kind: 'single-select',
        options: [{ id: 'one', label: '   ' }],
        idempotencyKey: 'agent:one'
      } as any),
      () => createPromptDecisionRequest({
        owner: null,
        title: 'Prompt',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One' }]
      } as any),
      () => createRouterDecisionRequest({
        owner,
        title: 'Router',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One' }],
        allowCustom: 'yes',
        customInput: { maxChars: 1 }
      } as any),
      () => createMultiModelLoopDecisionRequest({
        owner,
        title: 'Loop',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One' }],
        idempotencyKey: '   '
      } as any),
      () => createToolDecisionRequest({
        owner,
        agentId: 'codex',
        tool: 'delete',
        toolName: 'delete',
        action: 'delete_file',
        target: 'important.txt',
        preview: 'delete important.txt',
        risk: 'high'
      } as any),
      () => createGuardDecisionRequest({
        owner,
        agentId: 'codex',
        role: 'reviewer',
        risk: 'high',
        reasons: []
      } as any),
      () => createAcpDecisionRequest({
        owner,
        title: 'ACP',
        toolName: '   ',
        options: [{ optionId: 'allow-once' }]
      } as any)
    ]

    for (const invoke of invalidCalls) {
      expect(invoke).toThrow()
    }
  })

  it('rejects unknown own keys throughout raw request graphs', () => {
    const opaque = { mutable: true }
    const hidden = request()
    Object.defineProperty(hidden, 'opaque', { value: opaque })
    const symbolKeyed = request()
    Object.defineProperty(symbolKeyed, Symbol('opaque'), { value: opaque })
    const malformed = [
      { ...request(), opaque },
      hidden,
      symbolKeyed,
      request({ owner: { ...owner, opaque } as unknown as DecisionRequest['owner'] }),
      request({
        options: [{ id: 'one', label: 'One', opaque } as unknown as DecisionRequest['options'][number]]
      }),
      request({
        kind: 'text',
        options: [],
        minSelections: 0,
        maxSelections: 0,
        allowCustom: true,
        customInput: { maxChars: 1, opaque } as unknown as NonNullable<DecisionRequest['customInput']>
      }),
      request({
        source: 'tool',
        metadata: { risk: 'low', opaque } as unknown as NonNullable<DecisionRequest['metadata']>
      })
    ]

    for (const value of malformed) {
      expect(() => validateDecisionRequest(value)).toThrow()
    }
  })

  it('rejects unknown fields and nested objects at every public factory boundary', () => {
    const opaque = { mutable: true }
    const invalidCalls = [
      () => createAgentDecisionRequest({
        owner,
        title: 'Agent',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One', target: 'secret.txt', opaque }],
        idempotencyKey: 'agent:unknown-option'
      } as any),
      () => createPromptDecisionRequest({
        owner,
        title: 'Prompt',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One' }],
        opaque
      } as any),
      () => createRouterDecisionRequest({
        owner: { ...owner, opaque },
        title: 'Router',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One' }]
      } as any),
      () => createMultiModelLoopDecisionRequest({
        owner,
        title: 'Loop',
        kind: 'single-select',
        options: [{ id: 'one', label: 'One', opaque }]
      } as any),
      () => createToolDecisionRequest({
        owner,
        agentId: 'codex',
        tool: 'exec',
        toolName: 'exec',
        action: 'run_command',
        target: 'npm.cmd test',
        preview: 'npm.cmd test',
        risk: 'low',
        opaque
      } as any),
      () => createGuardDecisionRequest({
        owner,
        agentId: 'codex',
        role: 'reviewer',
        risk: 'low',
        reasons: ['review required'],
        opaque
      } as any),
      () => createAcpDecisionRequest({
        owner,
        title: 'ACP',
        toolName: 'filesystem',
        options: [{ optionId: 'allow-once', opaque }]
      } as any)
    ]

    for (const invoke of invalidCalls) {
      expect(invoke).toThrow()
    }
  })

  it('rejects accessors without invoking them', () => {
    let knownReads = 0
    const knownAccessor = {
      owner,
      kind: 'single-select' as const,
      options: [{ id: 'one', label: 'One' }]
    }
    Object.defineProperty(knownAccessor, 'title', {
      enumerable: true,
      get: () => {
        knownReads += 1
        return knownReads === 1 ? 'Prompt' : 'Changed'
      }
    })

    let unknownReads = 0
    const unknownAccessor = {
      owner,
      title: 'Prompt',
      kind: 'single-select' as const,
      options: [{ id: 'one', label: 'One' }]
    }
    Object.defineProperty(unknownAccessor, 'opaque', {
      enumerable: true,
      get: () => {
        unknownReads += 1
        return { mutable: true }
      }
    })

    expect(() => createPromptDecisionRequest(knownAccessor as any)).toThrow()
    expect(() => createPromptDecisionRequest(unknownAccessor as any)).toThrow()
    expect(knownReads).toBe(0)
    expect(unknownReads).toBe(0)
  })

  it('rejects explicit null for every optional factory field', () => {
    const agentBase = {
      owner,
      title: 'Agent',
      kind: 'single-select' as const,
      options: [{ id: 'one', label: 'One' }],
      idempotencyKey: 'agent:null-check'
    }
    const neutralBase = {
      owner,
      title: 'Neutral',
      kind: 'single-select' as const,
      options: [{ id: 'one', label: 'One' }]
    }
    const toolBase = {
      owner,
      agentId: 'codex',
      tool: 'exec' as const,
      toolName: 'exec',
      action: 'run_command',
      target: 'npm.cmd test',
      preview: 'npm.cmd test',
      risk: 'low' as const
    }
    const guardBase = {
      owner,
      agentId: 'codex',
      role: 'reviewer',
      risk: 'low' as const,
      reasons: ['review required']
    }
    const acpBase = {
      owner,
      title: 'ACP',
      toolName: 'filesystem',
      options: [{ optionId: 'allow-once' }]
    }
    const invalidCalls = [
      () => createAgentDecisionRequest({ ...agentBase, allowCustom: null } as any),
      () => createAgentDecisionRequest({ ...agentBase, minSelections: null } as any),
      () => createAgentDecisionRequest({ ...agentBase, maxSelections: null } as any),
      () => createAgentDecisionRequest({
        ...agentBase,
        allowCustom: true,
        customInput: { maxChars: null }
      } as any),
      () => createPromptDecisionRequest({ ...neutralBase, allowCustom: null } as any),
      () => createRouterDecisionRequest({ ...neutralBase, minSelections: null } as any),
      () => createMultiModelLoopDecisionRequest({ ...neutralBase, maxSelections: null } as any),
      () => createPromptDecisionRequest({
        ...neutralBase,
        allowCustom: true,
        customInput: { maxChars: null }
      } as any),
      () => createToolDecisionRequest({ ...toolBase, deadlineMs: null } as any),
      () => createToolDecisionRequest({ ...toolBase, allowRemember: null } as any),
      () => createToolDecisionRequest({ ...toolBase, idempotencyKey: null } as any),
      () => createGuardDecisionRequest({ ...guardBase, deadlineMs: null } as any),
      () => createGuardDecisionRequest({ ...guardBase, idempotencyKey: null } as any),
      () => createAcpDecisionRequest({ ...acpBase, deadlineMs: null } as any),
      () => createAcpDecisionRequest({ ...acpBase, idempotencyKey: null } as any)
    ]

    for (const invoke of invalidCalls) {
      expect(invoke).toThrow()
    }
  })
})
