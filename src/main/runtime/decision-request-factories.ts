import { randomUUID } from 'node:crypto'
import type {
  DecisionKind,
  DecisionOption,
  DecisionOwner,
  DecisionRequest,
  DecisionSource
} from '../../shared/decision-contract'
import { ACP_PROTOCOL_OPTION_ID_MAX_CHARS } from '../../shared/acp-permission'

declare const CREATED_DECISION_BRAND: unique symbol

const createdDecisionRequests = new WeakSet<object>()
const PRIVILEGED_KEYS = ['allowRemember', 'deadlineMs', 'metadata'] as const
const CUSTOM_INPUT_MAX_CHARS = 512 * 1024
const REQUEST_KEYS = new Set([
  'schemaVersion',
  'id',
  'owner',
  'source',
  'kind',
  'title',
  'description',
  'options',
  'minSelections',
  'maxSelections',
  'allowCustom',
  'customInput',
  'allowRemember',
  'idempotencyKey',
  'createdAt',
  'deadlineMs',
  'metadata'
])
const OWNER_KEYS = new Set([
  'type',
  'threadId',
  'turnId',
  'workspaceId',
  'webContentsId',
  'sessionId'
])
const TURN_OWNER_KEYS = new Set(['type', 'threadId', 'turnId', 'workspaceId', 'webContentsId'])
const HUB_OWNER_KEYS = new Set(['type', 'sessionId'])
const OPTION_KEYS = new Set(['id', 'label', 'description', 'preview', 'tone'])
const CUSTOM_INPUT_KEYS = new Set(['placeholder', 'maxChars'])
const METADATA_KEYS = new Set(['agentId', 'risk', 'toolName', 'action', 'target', 'preview'])
const AGENT_INPUT_KEYS = new Set([
  'owner',
  'title',
  'description',
  'kind',
  'options',
  'idempotencyKey',
  'allowCustom',
  'customInput',
  'minSelections',
  'maxSelections',
  ...PRIVILEGED_KEYS
])
const AGENT_OPTION_KEYS = new Set(['id', 'label', 'description', 'tone', 'preview'])
const NEUTRAL_INPUT_KEYS = new Set([
  'owner',
  'title',
  'description',
  'kind',
  'options',
  'minSelections',
  'maxSelections',
  'allowCustom',
  'customInput',
  'idempotencyKey'
])
const NEUTRAL_OPTION_KEYS = new Set(['id', 'label', 'description', 'preview'])
const TOOL_INPUT_KEYS = new Set([
  'owner',
  'agentId',
  'tool',
  'toolName',
  'action',
  'target',
  'preview',
  'risk',
  'deadlineMs',
  'allowRemember',
  'idempotencyKey'
])
const GUARD_INPUT_KEYS = new Set([
  'owner',
  'agentId',
  'role',
  'risk',
  'reasons',
  'deadlineMs',
  'idempotencyKey'
])
const ACP_INPUT_KEYS = new Set([
  'owner',
  'agentId',
  'title',
  'toolName',
  'options',
  'deadlineMs',
  'idempotencyKey'
])
const ACP_OPTION_KEYS = new Set(['optionId', 'name', 'kind', 'description'])
const DECISION_SOURCES = new Set<DecisionSource>([
  'prompt-optimizer',
  'agent',
  'router',
  'tool',
  'guard',
  'acp',
  'multi-model-loop'
])
const DECISION_KINDS = new Set<DecisionKind>([
  'confirm',
  'single-select',
  'multi-select',
  'text'
])
const OPTION_TONES = new Set<NonNullable<DecisionOption['tone']>>([
  'default',
  'safe',
  'warning',
  'danger'
])
const DECISION_RISKS = new Set<NonNullable<NonNullable<DecisionRequest['metadata']>['risk']>>([
  'low',
  'medium',
  'high',
  'critical'
])

export const AGENT_TEXT_DEFAULT_MAX_CHARS = 16 * 1024

export type CreatedDecisionRequest = DecisionRequest & {
  readonly [CREATED_DECISION_BRAND]: true
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
  agentId: string
  title: string
  toolName: string
  options: AcpPermissionOptionInput[]
  deadlineMs?: number
  idempotencyKey?: string
}

function cardinality(kind: DecisionKind, optionCount: number): [number, number] {
  if (kind === 'multi-select') return [1, optionCount]
  if (kind === 'text') return [0, 0]
  return [1, 1]
}

function brand(request: DecisionRequest): CreatedDecisionRequest {
  validateDecisionRequest(request)

  const owner = request.owner.type === 'turn'
    ? Object.freeze({
        type: request.owner.type,
        threadId: request.owner.threadId,
        turnId: request.owner.turnId,
        workspaceId: request.owner.workspaceId,
        webContentsId: request.owner.webContentsId
      })
    : Object.freeze({
        type: request.owner.type,
        sessionId: request.owner.sessionId
      })
  const options = Object.freeze(
    request.options.map(option => Object.freeze({
      id: option.id,
      label: option.label,
      description: option.description,
      preview: option.preview,
      tone: option.tone
    }))
  ) as readonly DecisionOption[]
  const customInput = request.customInput
    ? Object.freeze({
        placeholder: request.customInput.placeholder,
        maxChars: request.customInput.maxChars
      })
    : undefined
  const metadata = request.metadata
    ? Object.freeze({
        agentId: request.metadata.agentId,
        risk: request.metadata.risk,
        toolName: request.metadata.toolName,
        action: request.metadata.action,
        target: request.metadata.target,
        preview: request.metadata.preview
      })
    : undefined

  const created = Object.freeze({
    schemaVersion: request.schemaVersion,
    id: request.id,
    owner,
    source: request.source,
    kind: request.kind,
    title: request.title,
    description: request.description,
    options,
    minSelections: request.minSelections,
    maxSelections: request.maxSelections,
    allowCustom: request.allowCustom,
    customInput,
    allowRemember: request.allowRemember,
    idempotencyKey: request.idempotencyKey,
    createdAt: request.createdAt,
    ...(request.deadlineMs === undefined ? {} : { deadlineMs: request.deadlineMs }),
    metadata
  }) as CreatedDecisionRequest
  createdDecisionRequests.add(created)
  return created
}

export function isCreatedDecisionRequest(value: unknown): value is CreatedDecisionRequest {
  return typeof value === 'object' && value !== null && createdDecisionRequests.has(value)
}

function hasOwn(input: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertDataObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string
): asserts value is Record<PropertyKey, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`)
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new Error(`${label} contains an unknown field`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(`${label} must use data properties`)
    }
  }
}

function assertDataArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${label} must be a plain array`)
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    const index = typeof key === 'string' ? Number(key) : Number.NaN
    if (
      typeof key !== 'string' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= value.length ||
      String(index) !== key
    ) {
      throw new Error(`${label} contains an unknown field`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      throw new Error(`${label} must use data properties`)
    }
  }
}

function validateOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`)
  }
}

function validateOptionalInteger(value: unknown, label: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value))) {
    throw new Error(`${label} must be an integer`)
  }
}

function validateOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be a string`)
  }
}

function validateOptionalNonBlankString(value: unknown, label: string): void {
  if (value !== undefined && !isNonBlankString(value)) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDecisionSource(value: unknown): value is DecisionSource {
  return typeof value === 'string' && DECISION_SOURCES.has(value as DecisionSource)
}

function isDecisionKind(value: unknown): value is DecisionKind {
  return typeof value === 'string' && DECISION_KINDS.has(value as DecisionKind)
}

function validateDecisionOwner(value: unknown): asserts value is DecisionOwner {
  assertDataObject(value, OWNER_KEYS, 'Decision owner')

  if (value.type === 'turn') {
    assertDataObject(value, TURN_OWNER_KEYS, 'Turn decision owner')
    if (
      !isNonBlankString(value.threadId) ||
      !isNonBlankString(value.turnId) ||
      (value.workspaceId !== null && !isNonBlankString(value.workspaceId)) ||
      !Number.isInteger(value.webContentsId) ||
      (value.webContentsId as number) < 1
    ) {
      throw new Error('Turn decision owner is invalid')
    }
    return
  }

  if (value.type === 'hub') {
    assertDataObject(value, HUB_OWNER_KEYS, 'Hub decision owner')
    if (!isNonBlankString(value.sessionId)) throw new Error('Hub decision owner is invalid')
    return
  }

  throw new Error('Unsupported decision owner type')
}

export function validateDecisionRequest(value: unknown): asserts value is DecisionRequest {
  assertDataObject(value, REQUEST_KEYS, 'Decision request')

  const request = value
  if (request.schemaVersion !== 1) throw new Error('Unsupported decision schema version')
  if (!isDecisionSource(request.source)) throw new Error('Unsupported decision source')
  if (!isDecisionKind(request.kind)) throw new Error('Unsupported decision kind')
  if (!isNonBlankString(request.id) || !isNonBlankString(request.title)) {
    throw new Error('Decision id and title are required')
  }
  validateDecisionOwner(request.owner)
  if (request.description !== undefined && typeof request.description !== 'string') {
    throw new Error('Decision description must be a string')
  }
  assertDataArray(request.options, 'Decision options')
  if (request.options.length > 8) throw new Error('Decision options must contain at most 8 items')

  const optionIds: string[] = []
  let hasPrivilegedOption = false
  let hasOptionPreview = false
  for (const option of request.options) {
    assertDataObject(option, OPTION_KEYS, 'Decision option')
    if (!isNonBlankString(option.id)) throw new Error('Decision option IDs must be non-empty')
    if (!isNonBlankString(option.label)) throw new Error('Decision option labels must be non-empty')
    if (option.description !== undefined && typeof option.description !== 'string') {
      throw new Error('Decision option descriptions must be strings')
    }
    if (option.preview !== undefined && typeof option.preview !== 'string') {
      throw new Error('Decision option previews must be strings')
    }
    if (
      option.tone !== undefined &&
      (typeof option.tone !== 'string' || !OPTION_TONES.has(option.tone as NonNullable<DecisionOption['tone']>))
    ) {
      throw new Error('Decision option tone is invalid')
    }
    optionIds.push(option.id)
    hasPrivilegedOption ||= option.tone !== undefined
    hasOptionPreview ||= option.preview !== undefined
  }
  if (new Set(optionIds).size !== optionIds.length) {
    throw new Error('Decision option IDs must be unique')
  }

  if (
    typeof request.minSelections !== 'number' ||
    !Number.isInteger(request.minSelections) ||
    typeof request.maxSelections !== 'number' ||
    !Number.isInteger(request.maxSelections)
  ) {
    throw new Error('Decision cardinality must use integers')
  }
  if (typeof request.allowCustom !== 'boolean' || typeof request.allowRemember !== 'boolean') {
    throw new Error('Decision flags must be booleans')
  }

  if (request.kind === 'confirm' || request.kind === 'single-select') {
    if (request.options.length === 0) throw new Error('Single decisions require at least one option')
    if (request.minSelections !== 1 || request.maxSelections !== 1) {
      throw new Error('Single decisions require exactly one selection')
    }
  } else if (request.kind === 'multi-select') {
    if (
      request.options.length === 0 ||
      !Number.isInteger(request.minSelections) ||
      !Number.isInteger(request.maxSelections) ||
      request.minSelections < 1 ||
      request.maxSelections < request.minSelections ||
      request.maxSelections > request.options.length
    ) {
      throw new Error('Multi-select cardinality is invalid')
    }
  } else if (request.kind === 'text') {
    if (
      request.options.length !== 0 ||
      request.minSelections !== 0 ||
      request.maxSelections !== 0 ||
      !request.allowCustom
    ) {
      throw new Error('Text decisions require custom input only')
    }
  }

  if (request.allowCustom && request.customInput === undefined) {
    throw new Error('Decision custom input configuration is required')
  }
  if (!request.allowCustom && request.customInput !== undefined) {
    throw new Error('Decision custom input requires allowCustom')
  }
  if (request.customInput !== undefined) {
    assertDataObject(request.customInput, CUSTOM_INPUT_KEYS, 'Decision custom input')
    if (
      request.customInput.placeholder !== undefined &&
      typeof request.customInput.placeholder !== 'string'
    ) {
      throw new Error('Decision custom input placeholder must be a string')
    }
    const maxChars = request.customInput.maxChars
    if (
      typeof maxChars !== 'number' ||
      !Number.isInteger(maxChars) ||
      maxChars < 1 ||
      maxChars > CUSTOM_INPUT_MAX_CHARS
    ) {
      throw new Error('Custom input limit is invalid')
    }
  }

  if (request.idempotencyKey !== undefined && !isNonBlankString(request.idempotencyKey)) {
    throw new Error('Decision idempotency key must be non-empty')
  }
  if (
    typeof request.createdAt !== 'number' ||
    !Number.isFinite(request.createdAt) ||
    request.createdAt < 0
  ) {
    throw new Error('Decision creation time is invalid')
  }
  if (
    request.deadlineMs !== undefined &&
    (!Number.isInteger(request.deadlineMs) || (request.deadlineMs as number) <= 0)
  ) {
    throw new Error('Decision deadline must be a positive integer')
  }

  if (request.metadata !== undefined) {
    assertDataObject(request.metadata, METADATA_KEYS, 'Decision metadata')
    for (const key of ['agentId', 'toolName', 'action', 'target', 'preview'] as const) {
      const metadataValue = request.metadata[key]
      if (metadataValue !== undefined && !isNonBlankString(metadataValue)) {
        throw new Error('Decision metadata fields must be non-empty strings')
      }
    }
    if (
      request.metadata.risk !== undefined &&
      (
        typeof request.metadata.risk !== 'string' ||
        !DECISION_RISKS.has(
          request.metadata.risk as NonNullable<NonNullable<DecisionRequest['metadata']>['risk']>
        )
      )
    ) {
      throw new Error('Decision metadata risk is invalid')
    }
  }

  const privilegedSource = request.source === 'tool' || request.source === 'guard' || request.source === 'acp'
  if (!privilegedSource) {
    const agentPreview = request.source === 'agent' && hasOptionPreview
    if (
      request.allowRemember ||
      request.deadlineMs !== undefined ||
      request.metadata !== undefined ||
      hasPrivilegedOption ||
      agentPreview
    ) {
      throw new Error('Untrusted source contains privileged decision fields')
    }
  }
  if (request.source !== 'tool' && request.allowRemember) {
    throw new Error('Only Tool decisions can enable remember')
  }
}

export function createAgentDecisionRequest(input: AgentDecisionInput): CreatedDecisionRequest {
  assertDataObject(input, AGENT_INPUT_KEYS, 'Agent decision input')
  assertDataArray(input.options, 'Agent decision options')
  for (const option of input.options) {
    assertDataObject(option, AGENT_OPTION_KEYS, 'Agent decision option')
  }
  if (input.customInput !== undefined) {
    assertDataObject(input.customInput, CUSTOM_INPUT_KEYS, 'Agent custom input')
    validateOptionalString(input.customInput.placeholder, 'Agent custom input placeholder')
    validateOptionalInteger(input.customInput.maxChars, 'Agent custom input limit')
  }
  for (const key of PRIVILEGED_KEYS) {
    if (hasOwn(input, key)) throw new Error('Agent requests cannot set privileged decision fields')
  }
  if (input.options.some(option => hasOwn(option, 'tone') || hasOwn(option, 'preview'))) {
    throw new Error('Agent requests cannot set privileged decision fields')
  }
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) {
    throw new Error('Agent decision requires an idempotency key')
  }
  validateOptionalString(input.description, 'Agent decision description')
  validateOptionalBoolean(input.allowCustom, 'Agent decision allowCustom')
  validateOptionalInteger(input.minSelections, 'Agent decision minimum selections')
  validateOptionalInteger(input.maxSelections, 'Agent decision maximum selections')

  const [defaultMin, defaultMax] = cardinality(input.kind, input.options.length)
  const allowCustom = input.allowCustom ?? input.kind === 'text'
  const customInput = allowCustom || input.customInput
    ? {
        placeholder: input.customInput?.placeholder,
        maxChars: input.customInput?.maxChars ?? AGENT_TEXT_DEFAULT_MAX_CHARS
      }
    : undefined

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
    allowCustom,
    customInput,
    allowRemember: false,
    idempotencyKey: input.idempotencyKey,
    createdAt: Date.now()
  })
}

function createTrustedDecisionRequest(
  source: DecisionSource,
  input: Omit<DecisionRequest, 'schemaVersion' | 'id' | 'createdAt' | 'source'>
): CreatedDecisionRequest {
  return brand({
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: Date.now(),
    source,
    owner: input.owner,
    kind: input.kind,
    title: input.title,
    description: input.description,
    options: input.options,
    minSelections: input.minSelections,
    maxSelections: input.maxSelections,
    allowCustom: input.allowCustom,
    customInput: input.customInput,
    allowRemember: input.allowRemember,
    idempotencyKey: input.idempotencyKey,
    deadlineMs: input.deadlineMs,
    metadata: input.metadata
  })
}

function createNeutralDecisionRequest(
  source: 'prompt-optimizer' | 'router' | 'multi-model-loop',
  input: NeutralDecisionInput
): CreatedDecisionRequest {
  assertDataObject(input, NEUTRAL_INPUT_KEYS, 'Neutral decision input')
  assertDataArray(input.options, 'Neutral decision options')
  for (const option of input.options) {
    assertDataObject(option, NEUTRAL_OPTION_KEYS, 'Neutral decision option')
  }
  if (input.customInput !== undefined) {
    assertDataObject(input.customInput, CUSTOM_INPUT_KEYS, 'Neutral custom input')
    validateOptionalString(input.customInput.placeholder, 'Neutral custom input placeholder')
    validateOptionalInteger(input.customInput.maxChars, 'Neutral custom input limit')
  }
  validateOptionalString(input.description, 'Neutral decision description')
  validateOptionalBoolean(input.allowCustom, 'Neutral decision allowCustom')
  validateOptionalInteger(input.minSelections, 'Neutral decision minimum selections')
  validateOptionalInteger(input.maxSelections, 'Neutral decision maximum selections')
  validateOptionalNonBlankString(input.idempotencyKey, 'Neutral decision idempotency key')
  const [defaultMin, defaultMax] = cardinality(input.kind, input.options.length)
  const allowCustom = input.allowCustom ?? input.kind === 'text'
  const customInput = allowCustom
    ? input.customInput ?? { maxChars: CUSTOM_INPUT_MAX_CHARS }
    : input.customInput

  return createTrustedDecisionRequest(source, {
    owner: input.owner,
    kind: input.kind,
    title: input.title,
    description: input.description,
    options: input.options,
    minSelections: input.minSelections ?? defaultMin,
    maxSelections: input.maxSelections ?? defaultMax,
    allowCustom,
    customInput,
    allowRemember: false,
    idempotencyKey: input.idempotencyKey
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
  assertDataObject(input, TOOL_INPUT_KEYS, 'Tool decision input')
  if (input.tool !== 'write' && input.tool !== 'exec') {
    throw new Error('Tool decision type must be write or exec')
  }
  for (const key of ['agentId', 'toolName', 'action', 'target', 'preview'] as const) {
    if (!isNonBlankString(input[key])) throw new Error(`Tool decision ${key} is required`)
  }
  if (!DECISION_RISKS.has(input.risk)) throw new Error('Tool decision risk is invalid')
  if (input.allowRemember !== undefined && typeof input.allowRemember !== 'boolean') {
    throw new Error('Tool decision allowRemember must be a boolean')
  }
  validateOptionalInteger(input.deadlineMs, 'Tool decision deadline')
  validateOptionalNonBlankString(input.idempotencyKey, 'Tool decision idempotency key')

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
  assertDataObject(input, GUARD_INPUT_KEYS, 'Guard decision input')
  if (!isNonBlankString(input.agentId) || !isNonBlankString(input.role)) {
    throw new Error('Guard decision agent and role are required')
  }
  if (!DECISION_RISKS.has(input.risk)) throw new Error('Guard decision risk is invalid')
  assertDataArray(input.reasons, 'Guard decision reasons')
  if (input.reasons.length === 0 || input.reasons.some(reason => !isNonBlankString(reason))) {
    throw new Error('Guard decision reasons must be non-empty strings')
  }
  validateOptionalInteger(input.deadlineMs, 'Guard decision deadline')
  validateOptionalNonBlankString(input.idempotencyKey, 'Guard decision idempotency key')
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
  assertDataObject(input, ACP_INPUT_KEYS, 'ACP decision input')
  if (!isNonBlankString(input.agentId) || !isNonBlankString(input.title) || !isNonBlankString(input.toolName)) {
    throw new Error('ACP agent, title, and tool name are required')
  }
  assertDataArray(input.options, 'ACP options')
  for (const option of input.options) {
    assertDataObject(option, ACP_OPTION_KEYS, 'ACP option')
    for (const key of ['name', 'kind', 'description'] as const) {
      if (option[key] !== undefined && typeof option[key] !== 'string') {
        throw new Error(`ACP option ${key} must be a string`)
      }
    }
  }
  validateOptionalInteger(input.deadlineMs, 'ACP decision deadline')
  validateOptionalNonBlankString(input.idempotencyKey, 'ACP decision idempotency key')
  const optionIds = input.options.map(option => option.optionId)
  if (
    optionIds.some(id => typeof id !== 'string' || !id.trim() || id.length > ACP_PROTOCOL_OPTION_ID_MAX_CHARS) ||
    new Set(optionIds).size !== optionIds.length
  ) {
    throw new Error('ACP option IDs must be non-empty and unique; IDs must be bounded')
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
      agentId: input.agentId,
      toolName: input.toolName,
      action: 'acp_permission'
    }
  })
}
