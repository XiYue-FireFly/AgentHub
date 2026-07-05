/**
 * ProviderManager
 *
 * Responsibilities:
 *   1. Load and persist ProvidersConfig.
 *   2. Manage provider CRUD, enabled state, and health checks.
 *   3. Resolve agent routes through resolveBinding(agentId).
 */

import { EventEmitter } from 'events'
import { store, encryptSecret, decryptSecretDetailed } from '../store'
import {
  ProvidersConfig,
  ProviderDefinition,
  AgentRouteBinding,
  ThinkingConfig,
  ProviderKind,
  ModelDefinition,
  ModelRouteSettings,
  ThinkingLevel
} from './types'
import { BUILTIN_PROVIDERS, THINKING_BUDGET_TOKENS } from './presets'
import { createLogger } from '../logger'
import { appendAppEventLog } from '../runtime/app-event-log'

const log = createLogger('Providers')
const STORAGE_KEY = 'providers.config.v1'

const CONFIG_VERSION = 1
const SECRET_ENCRYPTION_WARNING_EVENT = 'secret-encryption-warning'

function defaultConfig(): ProvidersConfig {
  return {
    providers: BUILTIN_PROVIDERS.map((p, index) => ({
      ...p,
      createdAt: p.createdAt ?? index,
      sortOrder: p.sortOrder ?? index,
      models: p.models.map(m => ({ ...m }))
    })),
    routing: {
      bindings: defaultBindings(),
      fallbackChain: [],
      strategy: 'single'
    },
    modelRoutes: { ...DEFAULT_MODEL_ROUTE_SETTINGS },
    activeBindingId: null,
    version: CONFIG_VERSION
  }
}

const LEGACY_CODEX_PROVIDER_ID = 'anthropic'
const LEGACY_CODEX_MODEL_ID = 'claude-sonnet-4-5'
const LEGACY_CLAUDE_PROVIDER_ID = 'openai'
const LEGACY_CLAUDE_MODEL_ID = 'gpt-4o'

const DEFAULT_CODEX_PROVIDER_ID = 'openai'
const DEFAULT_CODEX_MODEL_ID = 'gpt-4o'
const DEFAULT_CLAUDE_PROVIDER_ID = 'anthropic'
const DEFAULT_CLAUDE_MODEL_ID = 'claude-sonnet-4-5'
const LOCAL_CLAUDE_CONFIG_PROVIDER_ID = '__claude_local_config__'
const DEFAULT_CONTEXT_WINDOW = 258_000
const DEFAULT_MODEL_ROUTE_SETTINGS: ModelRouteSettings = {
  codexInjectionMode: 'official_account',
  codexInternalModelLock: true,
  codexSlots: []
}
const COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude"
] as const

export type FetchModelsOverride = {
  baseUrl?: string
  apiKey?: string
  kind?: ProviderKind
}

export interface ProviderSecretEncryptionWarning {
  providerId: string
  message: string
}

export function isProviderRuntimeUsable(provider?: ProviderDefinition | null): provider is ProviderDefinition {
  return !!provider && provider.enabled && !!provider.apiKey && !provider.apiKeyLocked
}

/**
 * Default agent routes. Users can override them in Settings.
 */
export function defaultBindings(): AgentRouteBinding[] {
  return [
    {
      agentId: 'codex',
      providerId: DEFAULT_CODEX_PROVIDER_ID,
      modelId: DEFAULT_CODEX_MODEL_ID,
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    },
    {
      agentId: 'claude',
      providerId: DEFAULT_CLAUDE_PROVIDER_ID,
      modelId: DEFAULT_CLAUDE_MODEL_ID,
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.4,
      maxOutputTokens: 8192
    },
    {
      agentId: 'openclaw',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'off', level: 'low', collapseInUI: true },
      temperature: 0.1,
      maxOutputTokens: 4096
    },
    {
      agentId: 'hermes',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'low', budgetTokens: THINKING_BUDGET_TOKENS.low, collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    },
    {
      agentId: 'marvis',
      providerId: 'hunyuan',
      modelId: 'hunyuan-turbos-latest',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'low', collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    },
    {
      agentId: 'minimax-code',
      providerId: 'minimax',
      modelId: 'MiniMax-M2.7',
      // Default StdIO route to the desktop OpenCode runtime; it uses desktop login state and does not need an API key.
      protocol: 'stdio-plain',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  ]
}

export function claudeCurrentProviderId(config: ProvidersConfig): string | null {
  return config.routing.bindings.find(binding => binding.agentId === 'claude')?.providerId ?? null
}

export function sortProvidersForClaude(providers: ProviderDefinition[], currentProviderId: string | null): ProviderDefinition[] {
  const withIndex = providers.map((provider, index) => ({ provider, index }))
  return withIndex
    .sort((a, b) => {
      const aLocal = isClaudeLocalConfigProvider(a.provider)
      const bLocal = isClaudeLocalConfigProvider(b.provider)
      if (aLocal !== bLocal) return aLocal ? -1 : 1

      const aCurrent = !!currentProviderId && a.provider.id === currentProviderId
      const bCurrent = !!currentProviderId && b.provider.id === currentProviderId
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1

      const aEnabled = !!a.provider.enabled
      const bEnabled = !!b.provider.enabled
      if (aEnabled !== bEnabled) return aEnabled ? -1 : 1

      return providerSortKey(a.provider, a.index) - providerSortKey(b.provider, b.index)
        || String(a.provider.createdAt ?? '').localeCompare(String(b.provider.createdAt ?? ''))
        || a.provider.id.localeCompare(b.provider.id)
    })
    .map(entry => entry.provider)
}

function isClaudeLocalConfigProvider(provider: ProviderDefinition): boolean {
  return provider.id === LOCAL_CLAUDE_CONFIG_PROVIDER_ID
}

function providerSortKey(provider: ProviderDefinition, fallbackIndex: number): number {
  if (typeof provider.sortOrder === 'number' && Number.isFinite(provider.sortOrder)) return provider.sortOrder
  if (typeof provider.createdAt === 'number' && Number.isFinite(provider.createdAt)) return provider.createdAt
  return fallbackIndex
}

export function buildClaudeProviderReorderIds(
  regularProviders: Array<{ id: string; isActive?: boolean }>,
  sourceIndex: number,
  destinationIndex: number
): string[] {
  const activeProvider = regularProviders.find(provider => provider.isActive) ?? null
  const others = regularProviders.filter(provider => !provider.isActive)
  const nextOthers = Array.from(others)
  const [moved] = nextOthers.splice(sourceIndex, 1)
  if (!moved) return regularProviders.map(provider => provider.id)
  const safeDestinationIndex = Math.min(Math.max(destinationIndex, 0), nextOthers.length)
  nextOthers.splice(safeDestinationIndex, 0, moved)
  if (!activeProvider) return nextOthers.map(provider => provider.id)
  const homeIndex = regularProviders.findIndex(provider => provider.id === activeProvider.id)
  const safeHomeIndex = Math.min(Math.max(homeIndex, 0), nextOthers.length)
  const nextFull = Array.from(nextOthers)
  nextFull.splice(safeHomeIndex, 0, activeProvider)
  return nextFull.map(provider => provider.id)
}

export function deriveModelListCandidates(baseUrl: string, kind: ProviderKind, apiKey = ''): string[] {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return []
  const candidates: string[] = []
  const push = (candidate: string) => {
    const trimmed = candidate.trim()
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed)
  }

  if (kind === 'gemini') {
    push(`${base}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`)
    return candidates
  }

  if (kind === 'anthropic') {
    if (base.endsWith('/v1')) {
      push(`${base}/models`)
      push(`${base}/v1/models`)
    } else {
      push(`${base}/v1/models`)
    }
    push(`${base}/models?limit=200`)
  } else {
    push(`${base}/models`)
    push(`${base}/v1/models`)
  }

  if (base.endsWith('/anthropic')) {
    const stripped = base.slice(0, -'/anthropic'.length).replace(/\/+$/, '')
    if (stripped) push(`${stripped}/v1/models`)
  }

  for (const suffix of COMPAT_SUFFIXES) {
    if (suffix === '/anthropic') continue
    if (kind === 'anthropic' && suffix.endsWith('/anthropic')) continue
    if (!base.endsWith(suffix)) continue
    const stripped = base.slice(0, -suffix.length).replace(/\/+$/, '')
    if (stripped) {
      push(`${stripped}/v1/models`)
      if (kind !== 'anthropic') push(`${stripped}/models`)
    }
    break
  }

  try {
    const url = new URL(base)
    const origin = url.origin.replace(/\/+$/, '')
    push(`${origin}/v1/models`)
  } catch {
    // Non-URL input is validated by the request path; keep deterministic candidates above.
  }

  return candidates
}

export function parseFetchedModels(value: any, kind: ProviderKind): Array<{ id: string; label?: string; contextWindow?: number }> {
  const rawItems = Array.isArray(value?.data)
    ? value.data
    : Array.isArray(value)
      ? value
      : Array.isArray(value?.models)
        ? value.models
        : []

  const seen = new Set<string>()
  const result: Array<{ id: string; label?: string; contextWindow?: number }> = []
  for (const item of rawItems) {
    const id = modelIdFromFetchedItem(item, kind)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = typeof item?.display_name === 'string'
      ? item.display_name
      : typeof item?.displayName === 'string'
        ? item.displayName
        : typeof item?.name === 'string' && kind !== 'gemini'
          ? item.name
          : id
    const contextWindow =
      numberValue(item?.context_window) ||
      numberValue(item?.contextWindow) ||
      numberValue(item?.max_context_window) ||
      numberValue(item?.inputTokenLimit)
    result.push({ id, label, contextWindow })
  }
  return result
}

function modelIdFromFetchedItem(item: any, kind: ProviderKind): string {
  if (typeof item === 'string') return item.trim()
  if (!item || typeof item !== 'object') return ''
  if (typeof item.id === 'string') return item.id.trim()
  if (kind === 'gemini' && typeof item.name === 'string') return item.name.replace(/^models\//, '').trim()
  if (typeof item.name === 'string') return item.name.trim()
  return ''
}

function numberValue(value: any): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function normalizeModelRouteSettings(value: any): ModelRouteSettings {
  return {
    fallbackModelId: typeof value?.fallbackModelId === 'string' ? value.fallbackModelId : undefined,
    codexDefaultModel: typeof value?.codexDefaultModel === 'string' ? value.codexDefaultModel : undefined,
    codexInjectionMode: value?.codexInjectionMode === 'third_party_api' || value?.codexInjectionMode === 'lan_share'
      ? value.codexInjectionMode
      : DEFAULT_MODEL_ROUTE_SETTINGS.codexInjectionMode,
    codexInternalModelLock: typeof value?.codexInternalModelLock === 'boolean'
      ? value.codexInternalModelLock
      : DEFAULT_MODEL_ROUTE_SETTINGS.codexInternalModelLock,
    codexSlots: Array.isArray(value?.codexSlots)
      ? value.codexSlots
        .filter((slot: any) => slot && typeof slot.slot === 'string' && typeof slot.targetModelId === 'string')
        .map((slot: any) => ({
          slot: slot.slot,
          targetModelId: slot.targetModelId,
          mode: slot.mode === 'official_account' || slot.mode === 'lan_share' ? slot.mode : 'third_party_api',
          source: typeof slot.source === 'string' ? slot.source : 'agenthub'
        }))
      : []
  }
}

function isCodexInternalModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  return /^gpt-5(\.|-|$)/.test(id) || /^o[0-9].*mini/.test(id)
}

function codexSlotCandidates(settings: ModelRouteSettings, requested: string): string[] {
  if (settings.codexInjectionMode !== 'third_party_api' && settings.codexInjectionMode !== 'lan_share') return []
  const explicit = settings.codexSlots
    .filter(slot => slot.mode === settings.codexInjectionMode && slot.slot === requested)
    .map(slot => slot.targetModelId)
  const priority = [settings.codexDefaultModel, settings.fallbackModelId].filter(Boolean) as string[]
  return [...explicit, ...priority]
}

function normalizeModel(model: ModelDefinition, providerId: string): ModelDefinition {
  return {
    ...model,
    enabled: model.enabled ?? true,
    providerId: model.providerId || providerId,
    contextWindow: model.contextWindow || DEFAULT_CONTEXT_WINDOW,
    timeoutMs: typeof model.timeoutMs === 'number' && model.timeoutMs > 0 ? Math.round(model.timeoutMs) : undefined,
    retryCount: typeof model.retryCount === 'number' && model.retryCount > 0 ? Math.min(Math.round(model.retryCount), 5) : 0,
    reasoningEnabled: model.reasoningEnabled ?? model.supportsThinking,
    defaultReasoningLevel: model.defaultReasoningLevel || model.defaultThinkingLevel || (model.supportsThinking ? 'medium' : undefined),
    supportedReasoningLevels: Array.isArray(model.supportedReasoningLevels) ? model.supportedReasoningLevels : (model.supportsThinking ? ['minimal', 'low', 'medium', 'high', 'xhigh'] : [])
  }
}

function normalizeModels(models: ModelDefinition[], providerId: string): ModelDefinition[] {
  return (models || []).filter(model => model?.id).map(model => normalizeModel(model, providerId))
}

function splitModelRef(ref: string, fallbackProviderId: string): [string, string] {
  const index = ref.indexOf('/')
  if (index <= 0) return [fallbackProviderId, ref]
  return [ref.slice(0, index), ref.slice(index + 1)]
}

function modelRouteResult(
  provider: ProviderDefinition,
  model: ModelDefinition,
  requestedModelId: string,
  routeReason: 'direct' | 'upstream' | 'fallback_unknown' | 'codex_slot' | 'codex_internal_locked' | 'disabled'
) {
  const upstreamModelId = model.upstreamModel?.trim() || model.id
  return {
    provider,
    model,
    requestedModelId,
    upstreamModelId,
    routeReason: routeReason === 'direct' && upstreamModelId !== model.id ? 'upstream' as const : routeReason
  }
}

function modelDefinitionFromFetched(
  fetched: { id: string; label?: string; contextWindow?: number },
  provider: ProviderDefinition,
  previous?: ModelDefinition
): ModelDefinition {
  if (previous) {
    return normalizeModel({
      ...previous,
      label: previous.label || fetched.label || fetched.id,
      contextWindow: fetched.contextWindow || previous.contextWindow || DEFAULT_CONTEXT_WINDOW
    }, provider.id)
  }
  const thinkRe = /think|reason|r1|o[134](-|$)|gpt-5|claude-(opus|sonnet)-4|gemini-2\.5/i
  const supportsThinking = provider.capabilities.nativeThinking || thinkRe.test(fetched.id)
  const defaultReasoningLevel: ThinkingLevel = /opus|o3|o4|r1|reason/i.test(fetched.id) ? 'high' : 'medium'
  return normalizeModel({
    id: fetched.id,
    label: fetched.label || fetched.id,
    enabled: true,
    providerId: provider.id,
    contextWindow: fetched.contextWindow || DEFAULT_CONTEXT_WINDOW,
    supportsTools: true,
    supportsVision: /vision|4o|omni|gemini|claude/i.test(fetched.id),
    supportsThinking,
    reasoningEnabled: supportsThinking,
    defaultReasoningLevel,
    supportedReasoningLevels: supportsThinking ? ['minimal', 'low', 'medium', 'high', 'xhigh'] : []
  }, provider.id)
}

export function migrateLegacySwappedOfficialBindings(bindings: AgentRouteBinding[]): AgentRouteBinding[] {
  const codex = bindings.find(b => b.agentId === 'codex')
  const claude = bindings.find(b => b.agentId === 'claude')
  const codexLooksLegacy =
    codex?.providerId === LEGACY_CODEX_PROVIDER_ID &&
    codex?.modelId === LEGACY_CODEX_MODEL_ID
  const claudeLooksLegacy =
    claude?.providerId === LEGACY_CLAUDE_PROVIDER_ID &&
    claude?.modelId === LEGACY_CLAUDE_MODEL_ID

  if (!codexLooksLegacy || !claudeLooksLegacy) return bindings

  return bindings.map(binding => {
    if (binding.agentId === 'codex') {
      return {
        ...binding,
        providerId: DEFAULT_CODEX_PROVIDER_ID,
        modelId: DEFAULT_CODEX_MODEL_ID
      }
    }
    if (binding.agentId === 'claude') {
      return {
        ...binding,
        providerId: DEFAULT_CLAUDE_PROVIDER_ID,
        modelId: DEFAULT_CLAUDE_MODEL_ID,
        thinking: {
          ...binding.thinking,
          budgetTokens: binding.thinking.budgetTokens ?? THINKING_BUDGET_TOKENS.medium
        }
      }
    }
    return binding
  })
}

export class ProviderManager extends EventEmitter {
  private cfg: ProvidersConfig
  private secretsUnlocked = false
  /** MED-20: Debounce timer for health-check saves */
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private warnedSecretEncryptionProviders = new Set<string>()
  private configRevision = 0
  private sortedConfigSnapshot: ProvidersConfig | null = null
  private sortedConfigSnapshotRevision = -1

  constructor() {
    super()
    this.cfg = this.load()
  }

  private load(): ProvidersConfig {
    try {
      const raw = store.get(STORAGE_KEY)
      if (raw) {
        // Keep apiKey in persisted form here; unlockSecrets() runs after app ready.
        const sane = this.sanitize(raw)
        return this.mergeWithBuiltins(sane)
      }
    } catch (e) {
      log.warn('load failed, fallback to defaults:', e)
    }
    return defaultConfig()
  }

  /** Sanitize stored config without dropping valid provider data because one field is malformed. */
  private sanitize(raw: any): ProvidersConfig {
    const d = defaultConfig()
    if (!raw || typeof raw !== 'object') return d
    const r: any = (raw.routing && typeof raw.routing === 'object') ? raw.routing : {}
    return {
      providers: Array.isArray(raw.providers)
        ? raw.providers.filter((p: any) => p && typeof p.id === 'string')
        : d.providers,
      routing: {
        bindings: Array.isArray(r.bindings)
          ? r.bindings.filter((b: any) => b && typeof b.agentId === 'string')
          : d.routing.bindings,
        fallbackChain: Array.isArray(r.fallbackChain) ? r.fallbackChain : d.routing.fallbackChain,
        strategy: r.strategy || d.routing.strategy
      },
      modelRoutes: normalizeModelRouteSettings(raw.modelRoutes),
      activeBindingId: typeof raw.activeBindingId === 'string' ? raw.activeBindingId : null,
      version: typeof raw.version === 'number' ? raw.version : undefined
    }
  }

  /**
   * Decrypt provider API keys after app ready. Plain legacy keys are kept in memory
   * and encrypted on the next save.
   */
  unlockSecrets(): void {
    if (this.secretsUnlocked) return
    for (const p of this.cfg.providers) {
      const result = decryptSecretDetailed(p.apiKey || '')
      if (result.ok) {
        p.apiKey = result.value
        delete p.apiKeyLocked
        delete p.apiKeyError
      } else {
        p.apiKey = result.value
        p.apiKeyLocked = true
        p.apiKeyError = result.error || 'Failed to decrypt API key'
        if (!this.warnedSecretEncryptionProviders.has(p.id)) {
          this.warnedSecretEncryptionProviders.add(p.id)
          log.warn(`Failed to decrypt API key for provider ${p.id}; preserving encrypted value until the user re-enters it:`, p.apiKeyError)
          this.emit(SECRET_ENCRYPTION_WARNING_EVENT, { providerId: p.id, message: p.apiKeyError } satisfies ProviderSecretEncryptionWarning)
        }
      }
    }
    this.secretsUnlocked = true
    this.invalidateConfigSnapshot()
  }

  /** Merge stored config with current built-in providers. */
  private mergeWithBuiltins(stored: ProvidersConfig): ProvidersConfig {
    const defaults = defaultConfig()
    const storedProviders = new Map(stored.providers.map(p => [p.id, p]))

    const providers = defaults.providers.map(def => {
      const saved = storedProviders.get(def.id)
      if (!saved) return def
      // Restore apiKey from stored config.
      return {
        ...def,
        apiKey: saved.apiKey || '',
        enabled: saved.enabled ?? def.enabled,
        baseUrl: saved.baseUrl || def.baseUrl,
        customHeaders: saved.customHeaders || def.customHeaders,
        note: saved.note || def.note,
        modelFetch: saved.modelFetch,
        createdAt: saved.createdAt ?? def.createdAt,
        sortOrder: saved.sortOrder ?? def.sortOrder,
        modelMapping: saved.modelMapping || def.modelMapping,
        protocolOverride: saved.protocolOverride || def.protocolOverride,
        defaultThinking: saved.defaultThinking || def.defaultThinking,
        models: normalizeModels(saved.models && saved.models.length > 0 ? saved.models : def.models, def.id)
      }
    })

    // Preserve custom providers.
    for (const sp of stored.providers) {
      if (!sp.builtIn && !providers.find(p => p.id === sp.id)) {
        providers.push({ ...sp, models: normalizeModels(sp.models || [], sp.id) })
      }
    }

    const storedBindings = migrateLegacySwappedOfficialBindings(
      stored.routing?.bindings?.length ? [...stored.routing.bindings] : defaults.routing.bindings
    )
    // Add missing default bindings introduced by newer versions.
    for (const db of defaults.routing.bindings) {
      if (!storedBindings.find(b => b.agentId === db.agentId)) storedBindings.push(db)
    }

    return {
      providers,
      routing: {
        bindings: storedBindings,
        fallbackChain: stored.routing?.fallbackChain || defaults.routing.fallbackChain,
        strategy: stored.routing?.strategy || defaults.routing.strategy
      },
      modelRoutes: normalizeModelRouteSettings(stored.modelRoutes),
      activeBindingId: stored.activeBindingId ?? defaults.activeBindingId
    }
  }

  private save(): void {
    // Encrypt API keys before persisting. Locked keys are already encrypted
    // ciphertext and must be preserved unchanged.
    const persisted = JSON.parse(JSON.stringify(this.cfg)) as ProvidersConfig
    persisted.providers = persisted.providers.map(p => {
      if (p.apiKeyLocked) return { ...p, apiKey: p.apiKey || '', apiKeyLocked: undefined, apiKeyError: undefined }
      try {
        return { ...p, apiKey: encryptSecret(p.apiKey || '') }
      } catch (error: any) {
        const message = error?.message || String(error)
        if (!this.warnedSecretEncryptionProviders.has(p.id)) {
          this.warnedSecretEncryptionProviders.add(p.id)
          log.warn(`Failed to encrypt API key for provider ${p.id}; preserving current value for this save:`, message)
          this.emit(SECRET_ENCRYPTION_WARNING_EVENT, { providerId: p.id, message } satisfies ProviderSecretEncryptionWarning)
        }
        return { ...p, apiKey: p.apiKey || '' }
      }
    })
    persisted.version = CONFIG_VERSION
    store.set(STORAGE_KEY, persisted)
    this.invalidateConfigSnapshot()
    this.emit('config:changed', this.cfg)
  }

  onSecretEncryptionWarning(listener: (warning: ProviderSecretEncryptionWarning) => void): () => void {
    this.on(SECRET_ENCRYPTION_WARNING_EVENT, listener)
    return () => this.off(SECRET_ENCRYPTION_WARNING_EVENT, listener)
  }

  /** MED-20: Debounced save for health checks to avoid excessive disk writes */
  private scheduleSave(delayMs = 300): void {
    this.invalidateConfigSnapshot()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, delayMs)
  }
  // ---- Queries ----
  private invalidateConfigSnapshot(): void {
    this.configRevision += 1
    this.sortedConfigSnapshot = null
    this.sortedConfigSnapshotRevision = -1
  }

  private cloneConfig(config: ProvidersConfig): ProvidersConfig {
    return JSON.parse(JSON.stringify(config)) as ProvidersConfig
  }

  getConfig(): ProvidersConfig {
    if (!Array.isArray(this.cfg.providers) || this.cfg.providers.length === 0) {
      this.cfg = this.mergeWithBuiltins({ ...this.cfg, providers: [] })
      this.scheduleSave()
    }
    if (!this.sortedConfigSnapshot || this.sortedConfigSnapshotRevision !== this.configRevision) {
      const config = this.cloneConfig(this.cfg)
      config.providers = sortProvidersForClaude(config.providers, claudeCurrentProviderId(config))
      this.sortedConfigSnapshot = config
      this.sortedConfigSnapshotRevision = this.configRevision
    }
    return this.cloneConfig(this.sortedConfigSnapshot)
  }

  getProviders(): ProviderDefinition[] {
    return this.cfg.providers
  }

  getEnabledProviders(): ProviderDefinition[] {
    return this.cfg.providers.filter(isProviderRuntimeUsable)
  }

  getProvider(id: string): ProviderDefinition | undefined {
    return this.cfg.providers.find(p => p.id === id)
  }

  getClaudeCurrentProviderId(): string | null {
    return claudeCurrentProviderId(this.cfg)
  }

  getBindings(): AgentRouteBinding[] {
    return this.cfg.routing.bindings
  }

  getModelRouteSettings(): ModelRouteSettings {
    return JSON.parse(JSON.stringify(normalizeModelRouteSettings(this.cfg.modelRoutes)))
  }

  setModelRouteSettings(patch: Partial<ModelRouteSettings>): ModelRouteSettings {
    this.cfg.modelRoutes = normalizeModelRouteSettings({ ...this.cfg.modelRoutes, ...patch })
    this.save()
    return this.getModelRouteSettings()
  }

  getBinding(agentId: string): AgentRouteBinding | undefined {
    return this.cfg.routing.bindings.find(b => b.agentId === agentId)
  }

 /** Resolve Agent -> (Provider, Model, Thinking); fallback when the primary provider is unavailable. */
 resolveBinding(agentId: string): { provider: ProviderDefinition; model: import('./types').ModelDefinition; binding: AgentRouteBinding; thinking: ThinkingConfig } | null {
 const binding = this.getBinding(agentId)
 if (!binding) return null

 let provider = this.getProvider(binding.providerId)
 let usingFallbackProvider = false
 if (!isProviderRuntimeUsable(provider)) {
 for (const id of this.cfg.routing.fallbackChain) {
 const p = this.getProvider(id)
 if (isProviderRuntimeUsable(p)) {
 provider = p
 usingFallbackProvider = p.id !== binding.providerId
 break
 }
 }
 }
 if (!isProviderRuntimeUsable(provider)) return null

 // LOW-35: When using fallback provider, prefer enabled models with similar capabilities (tools support)
 const enabledModels = provider.models.filter(m => m.enabled !== false)
 const model = usingFallbackProvider
   ? (enabledModels.find(m => m.id === binding.modelId) ?? enabledModels.find(m => m.supportsTools) ?? enabledModels[0])
   : enabledModels.find(m => m.id === binding.modelId)
 if (!model) return null
 return { provider, model, binding, thinking: binding.thinking }
 }

  resolveModelRoute(providerId: string, modelId: string, opts: { allowFallback?: boolean; codexSlot?: string } = {}): {
    provider: ProviderDefinition
    model: ModelDefinition
    requestedModelId: string
    upstreamModelId: string
    routeReason: 'direct' | 'upstream' | 'fallback_unknown' | 'codex_slot' | 'codex_internal_locked' | 'disabled'
  } | null {
    const provider = this.getProvider(providerId)
    if (!isProviderRuntimeUsable(provider)) return null
    const settings = normalizeModelRouteSettings(this.cfg.modelRoutes)
    let requestedModelId = modelId
    let reason: 'direct' | 'upstream' | 'fallback_unknown' | 'codex_slot' | 'codex_internal_locked' | 'disabled' = 'direct'
    if (opts.codexSlot) {
      const slot = settings.codexSlots.find(item => item.slot === opts.codexSlot)
      if (slot?.targetModelId) {
        requestedModelId = slot.targetModelId
        reason = 'codex_slot'
      } else if (settings.codexInternalModelLock && settings.codexDefaultModel) {
        requestedModelId = settings.codexDefaultModel
        reason = 'codex_internal_locked'
      }
    }

    const model = provider.models.find(item => item.id === requestedModelId)
    if ((!model || model.enabled === false) && opts.allowFallback !== false && settings.fallbackModelId) {
      const [fallbackProviderId, fallbackModelId] = splitModelRef(settings.fallbackModelId, provider.id)
      const fallbackProvider = this.getProvider(fallbackProviderId)
      const fallbackModel = fallbackProvider?.models.find(item => item.id === fallbackModelId)
      if (isProviderRuntimeUsable(fallbackProvider) && fallbackModel && fallbackModel.enabled !== false) {
        return modelRouteResult(fallbackProvider, fallbackModel, modelId, 'fallback_unknown')
      }
    }
    if (!model) return null
    if (model.enabled === false) return null
    return modelRouteResult(provider, model, requestedModelId, reason)
  }

  resolveGlobalModelRoute(modelId: string): {
    provider: ProviderDefinition
    model: ModelDefinition
    requestedModelId: string
    upstreamModelId: string
    routeReason: 'direct' | 'upstream' | 'fallback_unknown' | 'codex_slot' | 'codex_internal_locked' | 'disabled'
    lockedFromModel?: string
  } | null {
    const requested = modelId.trim()
    if (!requested) return null
    const settings = normalizeModelRouteSettings(this.cfg.modelRoutes)
    const candidateRefs = codexSlotCandidates(settings, requested)
    for (const ref of candidateRefs) {
      const match = this.resolveConfiguredModelRef(ref)
      if (match) return { ...modelRouteResult(match.provider, match.model, requested, 'codex_slot'), lockedFromModel: undefined }
    }

    if (settings.codexInternalModelLock && isCodexInternalModel(requested)) {
      const target = settings.codexDefaultModel ? this.resolveConfiguredModelRef(settings.codexDefaultModel) : null
      const fallback = settings.fallbackModelId ? this.resolveConfiguredModelRef(settings.fallbackModelId) : null
      const match = target || fallback
      if (match) {
        const direct = match.model.id === requested
        return {
          ...modelRouteResult(match.provider, match.model, requested, direct ? 'direct' : 'codex_internal_locked'),
          lockedFromModel: direct ? undefined : requested
        }
      }
      return null
    }

    const direct = this.findEnabledModelById(requested)
    if (direct) return modelRouteResult(direct.provider, direct.model, requested, 'direct')

    if (settings.fallbackModelId) {
      const fallback = this.resolveConfiguredModelRef(settings.fallbackModelId)
      if (fallback && fallback.model.id !== requested) {
        return modelRouteResult(fallback.provider, fallback.model, requested, 'fallback_unknown')
      }
    }
    return null
  }

  private resolveConfiguredModelRef(ref: string): { provider: ProviderDefinition; model: ModelDefinition } | null {
    const [providerId, modelId] = splitModelRef(ref, '')
    if (providerId) {
      const provider = this.getProvider(providerId)
      const model = provider?.models.find(item => item.id === modelId)
      if (isProviderRuntimeUsable(provider) && model && model.enabled !== false) return { provider, model }
    }
    return this.findEnabledModelById(ref)
  }

  private findEnabledModelById(modelId: string): { provider: ProviderDefinition; model: ModelDefinition } | null {
    for (const provider of this.cfg.providers) {
      if (!isProviderRuntimeUsable(provider)) continue
      const model = provider.models.find(item => item.id === modelId && item.enabled !== false)
      if (model) return { provider, model }
    }
    return null
  }

  updateModelRoute(providerId: string, modelId: string, patch: Partial<ModelDefinition>): ModelDefinition | null {
    const provider = this.getProvider(providerId)
    if (!provider) return null
    const index = provider.models.findIndex(model => model.id === modelId)
    if (index < 0) return null
    const previous = provider.models[index]
    provider.models[index] = normalizeModel({ ...previous, ...patch, id: previous.id, providerId }, provider.id)
    this.save()
    return JSON.parse(JSON.stringify(provider.models[index]))
  }

  // ---- Mutations ----
  upsertProvider(p: ProviderDefinition): void {
    const idx = this.cfg.providers.findIndex(x => x.id === p.id)
    if (idx >= 0) {
      const existing = this.cfg.providers[idx]
      const apiKeyChanged = p.apiKey !== existing.apiKey
      this.cfg.providers[idx] = {
        ...existing,
        ...p,
        models: normalizeModels(p.models || this.cfg.providers[idx].models || [], p.id),
        createdAt: this.cfg.providers[idx].createdAt ?? p.createdAt ?? Date.now(),
        apiKeyLocked: apiKeyChanged ? undefined : p.apiKeyLocked ?? existing.apiKeyLocked,
        apiKeyError: apiKeyChanged ? undefined : p.apiKeyError ?? existing.apiKeyError
      }
    } else {
      this.cfg.providers.push({
        ...p,
        models: normalizeModels(p.models || [], p.id),
        createdAt: p.createdAt ?? Date.now(),
        sortOrder: p.sortOrder ?? this.nextProviderSortOrder()
      })
    }
    this.save()
  }

  reorderProvidersForClaude(orderedIds: string[]): ProviderDefinition[] {
    const currentProviderId = this.getClaudeCurrentProviderId()
    const order = orderedIds.filter(id => id && id !== LOCAL_CLAUDE_CONFIG_PROVIDER_ID)
    for (const [index, id] of order.entries()) {
      if (id === currentProviderId) continue
      const provider = this.getProvider(id)
      if (!provider) continue
      provider.sortOrder = index
    }
    this.save()
    return this.getConfig().providers
  }

  deleteProvider(id: string): boolean {
    const target = this.getProvider(id)
    if (!target || target.builtIn) return false
    this.cfg.providers = this.cfg.providers.filter(p => p.id !== id)
    // Remove related routes.
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter(b => b.providerId !== id)
    this.cfg.routing.fallbackChain = this.cfg.routing.fallbackChain.filter(x => x !== id)
    this.save()
    return true
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    const p = this.getProvider(id)
    if (!p) return
    p.enabled = enabled
    this.save()
  }

  setProviderApiKey(id: string, key: string): void {
    const p = this.getProvider(id)
    if (!p) return
    p.apiKey = key
    delete p.apiKeyLocked
    delete p.apiKeyError
    if (key && !p.enabled) p.enabled = true
    this.save()
  }

  upsertBinding(b: AgentRouteBinding): void {
    const idx = this.cfg.routing.bindings.findIndex(x => x.agentId === b.agentId)
    if (idx >= 0) this.cfg.routing.bindings[idx] = b
    else this.cfg.routing.bindings.push(b)
    this.save()
  }

  removeBinding(agentId: string): void {
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter(b => b.agentId !== agentId)
    this.save()
  }

  setFallbackChain(chain: string[]): void {
    this.cfg.routing.fallbackChain = chain
    this.save()
  }

  setStrategy(s: ProvidersConfig['routing']['strategy']): void {
    this.cfg.routing.strategy = s
    this.save()
  }

  setActiveBinding(agentId: string | null): void {
    this.cfg.activeBindingId = agentId
    this.save()
  }

  setProviderThinking(providerId: string, t: ThinkingConfig): void {
    const p = this.getProvider(providerId)
    if (!p) return
    p.defaultThinking = t
    this.save()
  }

  setBindingThinking(agentId: string, t: ThinkingConfig): void {
    const b = this.getBinding(agentId)
    if (!b) return
    b.thinking = t
    this.save()
  }

  private nextProviderSortOrder(): number {
    return this.cfg.providers.reduce((max, provider, index) => {
      const value = typeof provider.sortOrder === 'number' ? provider.sortOrder : index
      return Math.max(max, value)
    }, -1) + 1
  }

  // ---- Health checks ----
  async checkProviderHealth(id: string): Promise<import('./types').ProviderHealth> {
    const p = this.getProvider(id)
    if (!p) return { reachable: false, status: 'error', lastCheck: Date.now(), error: 'Provider not found' }
    if (p.apiKeyLocked) {
      const h: import('./types').ProviderHealth = { reachable: false, status: 'unauthorized', lastCheck: Date.now(), error: 'API key is locked; re-enter it to unlock this provider.' }
      p.health = h
      this.scheduleSave()
      return h
    }
    if (!p.apiKey) {
      const h: import('./types').ProviderHealth = { reachable: false, status: 'unauthorized', lastCheck: Date.now(), error: 'API key is not configured' }
      p.health = h
      this.scheduleSave()
      return h
    }
    const start = Date.now()
    try {
      const url = this.healthUrl(p)
      const headers = this.buildHeaders(p)
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8000) })
      const latencyMs = Date.now() - start
      // 401/403 means auth failed even though the server responded.
      const unauthorized = res.status === 401 || res.status === 403
      const h: import('./types').ProviderHealth = {
        reachable: !unauthorized && res.status < 500,
        status: unauthorized ? 'unauthorized' : (res.status < 400 ? 'ok' : 'error'),
        lastCheck: Date.now(),
        latencyMs,
        error: unauthorized ? `Authentication failed (HTTP ${res.status})` : (res.status >= 400 ? `HTTP ${res.status}` : undefined)
      }
      p.health = h
      this.scheduleSave()
      return h
    } catch (e: any) {
      const h: import('./types').ProviderHealth = { reachable: false, status: 'unreachable', lastCheck: Date.now(), latencyMs: Date.now() - start, error: e?.message || String(e) }
      p.health = h
      this.scheduleSave()
      return h
    }
  }

  /**
   * Fetch model lists from provider APIs and merge by id while preserving
   * manually configured model route fields.
   */
  /**
   * Build candidate model-list URLs; fetchModels tries them in order.
   */
  private buildModelsUrlCandidates(p: ProviderDefinition): string[] {
    return deriveModelListCandidates(p.baseUrl, p.kind, p.apiKey)
  }

  async fetchModels(id: string, override?: FetchModelsOverride): Promise<{ ok: boolean; count?: number; error?: string }> {
    const p = this.getProvider(id)
    if (!p) return { ok: false, error: 'Provider not found' }
    const requestProvider: ProviderDefinition = {
      ...p,
      baseUrl: override?.baseUrl?.trim().replace(/\/+$/, '') || p.baseUrl,
      apiKey: override?.apiKey ?? p.apiKey,
      kind: override?.kind || p.kind,
      apiKeyLocked: override?.apiKey ? false : p.apiKeyLocked,
      apiKeyError: override?.apiKey ? undefined : p.apiKeyError
    }
    if (!requestProvider.apiKey) return this.recordModelFetchFailure(p, 'API key is not configured')
    if (requestProvider.apiKeyLocked) return this.recordModelFetchFailure(p, 'API key is locked; re-enter it to unlock this provider.')
    try {
      const candidates = this.buildModelsUrlCandidates(requestProvider)
      let lastError = ""
      for (const url of candidates) {
        const res = await fetch(url, { method: 'GET', headers: this.buildHeaders(requestProvider), signal: AbortSignal.timeout(10000) })
        // Try the next candidate for 404/405 responses.
        if (res.status === 404 || res.status === 405) {
          lastError = `HTTP ${res.status} from ${url.replace(requestProvider.apiKey || "", "REDACTED")}`
          continue
        }
        if (res.status >= 400) return this.recordModelFetchFailure(p, `HTTP ${res.status}`)
        const j: any = await res.json()

        let raw = parseFetchedModels(j, requestProvider.kind)
        if (requestProvider.kind === "gemini") {
          raw = raw.filter(model => {
            const source = (j.models || []).find((m: any) => String(m.name || '').replace(/^models\//, '') === model.id)
            return !source?.supportedGenerationMethods || source.supportedGenerationMethods.includes("generateContent")
          })
        }
        raw = raw.filter(m => m.id).slice(0, 300)
        if (raw.length === 0) {
          lastError = `Model endpoint returned no models from ${url.replace(requestProvider.apiKey || "", "REDACTED")}`
          continue
        }

        const old = new Map(p.models.map(m => [m.id, m]))
        const nextModels = raw.map(m => modelDefinitionFromFetched(m, requestProvider, old.get(m.id)))
        // MED-19: Assemble complete provider patch before applying to avoid partial state
        Object.assign(p, {
          baseUrl: requestProvider.baseUrl,
          apiKey: requestProvider.apiKey,
          apiKeyLocked: undefined,
          apiKeyError: undefined,
          kind: requestProvider.kind,
          enabled: requestProvider.apiKey && !p.enabled ? true : p.enabled,
          models: nextModels,
          modelFetch: {
            status: "ok",
            lastAttemptAt: Date.now(),
            lastSuccessAt: Date.now(),
            lastSuccessCount: nextModels.length
          }
        })
        this.save()
        appendAppEventLog('providers:fetchModels:ok', { providerId: p.id, baseUrl: p.baseUrl, kind: p.kind, count: p.models.length })
        return { ok: true, count: p.models.length }
      } // end for: all candidates returned 404/405 or empty model lists
      if (lastError) return this.recordModelFetchFailure(p, lastError)
      return this.recordModelFetchFailure(p, "All candidate model endpoints failed")
    } catch (e: any) {
      return this.recordModelFetchFailure(p, e?.message || String(e))
    }
  }

  private recordModelFetchFailure(p: ProviderDefinition, error: string): { ok: false; error: string; count: number } {
    p.modelFetch = {
      status: 'error',
      lastAttemptAt: Date.now(),
      lastSuccessAt: p.modelFetch?.lastSuccessAt,
      lastSuccessCount: p.modelFetch?.lastSuccessCount ?? p.models.length,
      error
    }
    this.save()
    appendAppEventLog('providers:fetchModels:error', { providerId: p.id, baseUrl: p.baseUrl, kind: p.kind, error, count: p.models.length })
    return { ok: false, error, count: p.models.length }
  }

  private healthUrl(p: ProviderDefinition): string {
    switch (p.kind) {
      case 'openai':
      case 'openai-compatible':
      case 'custom':
        return `${p.baseUrl.replace(/\/$/, '')}/models`
      case 'anthropic':
        return `${p.baseUrl.replace(/\/$/, '')}/models`
      case 'gemini':
        return `${p.baseUrl.replace(/\/$/, '')}/models?key=${encodeURIComponent(p.apiKey)}`
      default:
        return `${p.baseUrl.replace(/\/$/, '')}/models`
    }
  }

  buildHeaders(p: ProviderDefinition): Record<string, string> {
    const sanitize = (v: string) => Array.from(v).filter((char) => char.charCodeAt(0) <= 0xff).join('')
    const sanitizedCustom: Record<string, string> = {}
    for (const [k, v] of Object.entries(p.customHeaders || {})) {
      sanitizedCustom[k] = sanitize(v)
    }
    const headers: Record<string, string> = { 'content-type': 'application/json', ...sanitizedCustom }
    const safeKey = sanitize(p.apiKey || '')
    switch (p.kind) {
      case 'openai':
      case 'openai-compatible':
      case 'custom':
        headers['authorization'] = `Bearer ${safeKey}`
        headers['x-api-key'] = safeKey
        break
      case 'anthropic':
        headers['authorization'] = `Bearer ${safeKey}`
        headers['x-api-key'] = safeKey
        headers['anthropic-version'] = '2023-06-01'
        break
      case 'gemini':
        // Gemini authenticates through query string, not headers.
        break
    }
    return headers
  }
}

let _instance: ProviderManager | null = null
export function getProviderManager(): ProviderManager {
  if (!_instance) _instance = new ProviderManager()
  return _instance
}
