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
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' must be a non-empty string')
  }
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(label + ' exceeds ' + max + ' characters')
  return normalized
}

function optionalInteger(value: unknown, defaultValue: number): number {
  if (value === undefined) return defaultValue
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('selection bounds must be integers')
  }
  return value
}

export function parseAgentDecisionInput(value: unknown): AgentDecisionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('decision input must be an object')
  }

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
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('options[' + index + '] must be an object')
    }

    const option = entry as Record<string, unknown>
    for (const key of Object.keys(option)) {
      if (!['id', 'label', 'description'].includes(key)) {
        throw new Error('unsupported option field: ' + key)
      }
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
  if (selectionMode !== 'single' && selectionMode !== 'multi') {
    throw new Error('selectionMode must be single or multi')
  }

  const minSelections = optionalInteger(record.minSelections, 1)
  const maxSelections = optionalInteger(
    record.maxSelections,
    selectionMode === 'single' ? 1 : options.length
  )
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
