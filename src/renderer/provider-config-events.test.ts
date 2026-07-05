import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('provider config events', () => {
  it('subscribes renderer config to provider change events and keeps manual reload as fallback', () => {
    const app = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
    const preload = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf8')
    const providerIpc = readFileSync(join(process.cwd(), 'src/main/ipc/provider-ipc.ts'), 'utf8')

    expect(providerIpc).toContain("'config:changed'")
    expect(providerIpc).toContain("'providers:configChanged'")
    expect(preload).toContain('onConfigChanged')
    expect(preload).toContain("ipcRenderer.on('providers:configChanged'")
    expect(app).toContain('window.electronAPI.providers.onConfigChanged')
    expect(app).toContain('applyProviderConfig(cfg)')
    expect(app).toContain('onReload: reloadConfig')
  })

  it('does not call loadConfig after normal provider writes that already return or broadcast config', () => {
    const app = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
    const settingsStart = app.indexOf('const onSetEnabled')
    const settingsEnd = app.indexOf('const onRuntimeAgentStatus', settingsStart)
    const settingsActions = app.slice(settingsStart, settingsEnd)

    expect(settingsStart).toBeGreaterThan(-1)
    expect(settingsEnd).toBeGreaterThan(settingsStart)
    expect(settingsActions).not.toContain('loadConfig(); refreshStatus()')
    expect(settingsActions).toContain('catch { loadConfig() }')
  })
})
