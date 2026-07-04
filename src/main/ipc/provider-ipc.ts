/**
 * Provider & Routing IPC handlers.
 *
 * Extracted from index.ts to isolate provider management IPC registrations.
 * Dependencies are injected at registration time.
 */

import { BrowserWindow, ipcMain } from 'electron'

interface ProviderIpcDeps {
  providerMgr: any
  registerAgentsFromBindings: () => void
}

let registered = false
let warningListenerRegistered = false

/** Strip sensitive API keys from config before sending to renderer. */
function isMaskedApiKey(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return /^[•*]+$/.test(trimmed) || trimmed.includes('鈥⑩€')
}

function stripApiKeys(config: any): any {
  if (!config || typeof config !== 'object') return config
  const clone = JSON.parse(JSON.stringify(config))
  if (Array.isArray(clone.providers)) {
    for (const p of clone.providers) {
      if (p && typeof p === 'object') {
        p.apiKey = p.apiKey ? '••••••••' : ''
      }
    }
  }
  return clone
}

export function registerProviderIpc(deps: ProviderIpcDeps): void {
  const { providerMgr, registerAgentsFromBindings } = deps

  if (!warningListenerRegistered) {
    warningListenerRegistered = true
    providerMgr.onSecretEncryptionWarning?.((warning: { providerId: string; message: string }) => {
      for (const webContents of BrowserWindow.getAllWindows().map(window => window.webContents)) {
        if (!webContents.isDestroyed()) webContents.send('providers:warning', warning)
      }
    })
  }

  if (registered) return
  registered = true

  ipcMain.handle("providers:get", async () => stripApiKeys(providerMgr.getConfig()))
  ipcMain.handle("providers:upsert", async (_e, p) => {
    const existing = p?.id ? providerMgr.getProvider(p.id) : null
    const next = p && isMaskedApiKey(p.apiKey) && existing ? { ...p, apiKey: existing.apiKey } : p
    providerMgr.upsertProvider(next)
    registerAgentsFromBindings()
    return stripApiKeys(providerMgr.getConfig())
  })
  ipcMain.handle("providers:delete", async (_e, id) => { const ok = providerMgr.deleteProvider(id); if (ok) registerAgentsFromBindings(); return ok })
  ipcMain.handle("providers:setEnabled", async (_e, id, enabled) => { providerMgr.setProviderEnabled(id, enabled); return stripApiKeys(providerMgr.getConfig()) })
  ipcMain.handle("providers:setKey", async (_e, id, key) => {
    if (isMaskedApiKey(key)) return stripApiKeys(providerMgr.getConfig())
    providerMgr.setProviderApiKey(id, key)
    if (key) await providerMgr.fetchModels(id).catch(() => null)
    registerAgentsFromBindings()
    return stripApiKeys(providerMgr.getConfig())
  })
  ipcMain.handle("providers:fetchModels", async (_e, id, override) => {
    const r = await providerMgr.fetchModels(id, override)
    return { ...r, config: stripApiKeys(providerMgr.getConfig()) }
  })
  ipcMain.handle("providers:reorderForClaude", async (_e, orderedIds) => {
    providerMgr.reorderProvidersForClaude(Array.isArray(orderedIds) ? orderedIds : [])
    return stripApiKeys(providerMgr.getConfig())
  })
  ipcMain.handle("providers:health", async (_e, id) => providerMgr.checkProviderHealth(id))
  ipcMain.handle("providers:healthAll", async () => {
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
  ipcMain.handle("routing:setBinding", async (_e, b) => { providerMgr.upsertBinding(b); registerAgentsFromBindings(); return providerMgr.getBindings() })
  ipcMain.handle("routing:removeBinding", async (_e, agentId) => { providerMgr.removeBinding(agentId); registerAgentsFromBindings(); return providerMgr.getBindings() })
  ipcMain.handle("routing:setFallback", async (_e, chain) => { providerMgr.setFallbackChain(chain); return stripApiKeys(providerMgr.getConfig()).routing })
  ipcMain.handle("routing:setStrategy", async (_e, s) => { providerMgr.setStrategy(s); return stripApiKeys(providerMgr.getConfig()).routing })
  ipcMain.handle("routing:setBindingThinking", async (_e, agentId, t) => { providerMgr.setBindingThinking(agentId, t); return providerMgr.getBindings() })
  ipcMain.handle("routing:setProviderThinking", async (_e, id, t) => { providerMgr.setProviderThinking(id, t); return stripApiKeys(providerMgr.getConfig()) })
  ipcMain.handle("routing:activeBinding", async (_e, agentId) => { providerMgr.setActiveBinding(agentId); return stripApiKeys(providerMgr.getConfig()).activeBindingId })
}
