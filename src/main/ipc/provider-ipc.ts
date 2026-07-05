/**
 * Provider & Routing IPC handlers.
 *
 * Extracted from index.ts to isolate provider management IPC registrations.
 * Dependencies are injected at registration time.
 */

import { BrowserWindow } from 'electron'
import { IpcPayloadValidationError } from '../../shared/ipc-contract'
import { typedHandle } from './typed-ipc'

interface ProviderIpcDeps {
  providerMgr: any
  registerAgentsFromBindings: () => void
}

let registered = false
let warningListenerRegistered = false
let configChangedListenerRegistered = false
const MASKED_SECRET = '********'

/** Strip sensitive API keys from config before sending to renderer. */
function isMaskedApiKey(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return /^[*•]+$/.test(trimmed)
}

function stripApiKeys(config: any): any {
  if (!config || typeof config !== 'object') return config
  const clone = JSON.parse(JSON.stringify(config))
  if (Array.isArray(clone.providers)) {
    for (const p of clone.providers) {
      if (p && typeof p === 'object') {
        delete p.customHeaders
        p.apiKey = p.apiKey ? MASKED_SECRET : ''
        p.apiKeyLocked = !!p.apiKeyLocked
      }
    }
  }
  return redactSensitiveFields(clone)
}

function redactSensitiveFields(value: any, key = ''): any {
  if (Array.isArray(value)) return value.map(item => redactSensitiveFields(item, key))
  if (!value || typeof value !== 'object') {
    return isSensitiveFieldName(key) && value ? MASKED_SECRET : value
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    value[childKey] = redactSensitiveFields(childValue, childKey)
  }
  return value
}

function isSensitiveFieldName(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!normalized) return false
  if (normalized.includes('apikey')) return true
  if (['authorization', 'password', 'secret', 'credential', 'bearer'].some(part => normalized.includes(part))) return true
  if (normalized.endsWith('token')) return true
  return ['token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken'].includes(normalized)
}

function sendToAllWindows(channel: string, payload: any): void {
  for (const webContents of BrowserWindow.getAllWindows().map(window => window.webContents)) {
    if (!webContents.isDestroyed()) webContents.send(channel, payload)
  }
}

function validateNewProviderCreateShape(provider: any): string | null {
  if (!provider || typeof provider !== 'object') return 'provider must be an object'
  if (typeof provider.name !== 'string' || !provider.name.trim()) return 'provider.name must not be empty'
  if (!['openai', 'anthropic', 'gemini', 'openai-compatible', 'custom'].includes(provider.kind)) return 'provider.kind must be valid'
  if (typeof provider.baseUrl !== 'string' || !provider.baseUrl.trim()) return 'provider.baseUrl must not be empty'
  if (typeof provider.enabled !== 'boolean') return 'provider.enabled must be a boolean'
  if (typeof provider.builtIn !== 'boolean') return 'provider.builtIn must be a boolean'
  if (!Array.isArray(provider.models)) return 'provider.models must be an array'
  if (!provider.capabilities || typeof provider.capabilities !== 'object') return 'provider.capabilities must be an object'
  if (!provider.defaultThinking || typeof provider.defaultThinking !== 'object') return 'provider.defaultThinking must be an object'
  return null
}

export function registerProviderIpc(deps: ProviderIpcDeps): void {
  const { providerMgr, registerAgentsFromBindings } = deps

  if (!warningListenerRegistered) {
    warningListenerRegistered = true
    providerMgr.onSecretEncryptionWarning?.((warning: { providerId: string; message: string }) => {
      sendToAllWindows('providers:warning', warning)
    })
  }

  if (!configChangedListenerRegistered) {
    configChangedListenerRegistered = true
    providerMgr.on?.('config:changed', () => {
      sendToAllWindows('providers:configChanged', stripApiKeys(providerMgr.getConfig()))
    })
  }

  if (registered) return
  registered = true

  typedHandle("providers:get", async () => stripApiKeys(providerMgr.getConfig()))
  typedHandle("providers:upsert", async (_e, p) => {
    const existing = p?.id ? providerMgr.getProvider(p.id) : null
    if (!existing) {
      const createIssue = validateNewProviderCreateShape(p)
      if (createIssue) throw new IpcPayloadValidationError('providers:upsert', createIssue)
    }
    const next = p && isMaskedApiKey(p.apiKey) && existing ? { ...p, apiKey: existing.apiKey } : p
    providerMgr.upsertProvider(next)
    registerAgentsFromBindings()
    return stripApiKeys(providerMgr.getConfig())
  })
  typedHandle("providers:delete", async (_e, id) => { const ok = providerMgr.deleteProvider(id); if (ok) registerAgentsFromBindings(); return ok })
  typedHandle("providers:setEnabled", async (_e, id, enabled) => { providerMgr.setProviderEnabled(id, enabled); return stripApiKeys(providerMgr.getConfig()) })
  typedHandle("providers:setKey", async (_e, id, key) => {
    if (isMaskedApiKey(key)) return stripApiKeys(providerMgr.getConfig())
    providerMgr.setProviderApiKey(id, key)
    if (key) await providerMgr.fetchModels(id).catch(() => null)
    registerAgentsFromBindings()
    return stripApiKeys(providerMgr.getConfig())
  })
  typedHandle("providers:fetchModels", async (_e, id, override) => {
    const r = await providerMgr.fetchModels(id, override)
    return { ...r, config: stripApiKeys(providerMgr.getConfig()) }
  })
  typedHandle("providers:reorderForClaude", async (_e, orderedIds) => {
    providerMgr.reorderProvidersForClaude(Array.isArray(orderedIds) ? orderedIds : [])
    return stripApiKeys(providerMgr.getConfig())
  })
  typedHandle("providers:health", async (_e, id) => providerMgr.checkProviderHealth(id))
  typedHandle("providers:healthAll", async () => {
    const providers = providerMgr.getProviders()
    const results: any = {}
    const entries = await Promise.all(
      providers.map(async (p: any) => {
        try {
          return { id: p.id, health: await providerMgr.checkProviderHealth(p.id) }
        } catch {
          return { id: p.id, health: { ok: false, error: 'health check failed' } }
        }
      })
    )
    for (const e of entries) results[e.id] = e.health
    return results
  })

  // Routing
  typedHandle("routing:setBinding", async (_e, b) => { providerMgr.upsertBinding(b); registerAgentsFromBindings(); return providerMgr.getBindings() })
  typedHandle("routing:removeBinding", async (_e, agentId) => { providerMgr.removeBinding(agentId); registerAgentsFromBindings(); return providerMgr.getBindings() })
  typedHandle("routing:setFallback", async (_e, chain) => { providerMgr.setFallbackChain(chain); return stripApiKeys(providerMgr.getConfig()).routing })
  typedHandle("routing:setStrategy", async (_e, s) => { providerMgr.setStrategy(s); return stripApiKeys(providerMgr.getConfig()).routing })
  typedHandle("routing:setBindingThinking", async (_e, agentId, t) => { providerMgr.setBindingThinking(agentId, t); return providerMgr.getBindings() })
  typedHandle("routing:setProviderThinking", async (_e, id, t) => { providerMgr.setProviderThinking(id, t); return stripApiKeys(providerMgr.getConfig()) })
  typedHandle("routing:activeBinding", async (_e, agentId) => { providerMgr.setActiveBinding(agentId); return stripApiKeys(providerMgr.getConfig()).activeBindingId })
}
