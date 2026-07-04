/**
 * Missing IPC Handlers.
 *
 * Registers handlers for channels exposed in preload but previously missing
 * from main process. Covers turns, hub cancel, tasks, skills, agentic, app,
 * proxy, agents, takeover, and AI quick-complete.
 */

import { ipcMain, shell, dialog, app } from 'electron'
import { extname } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { getWorkspaceManager } from '../hub/workspace'
import { getSkillManager } from '../skills/manager'
import { BUILTIN_SKILLS } from '../skills/types'
import { getCapabilityMatrix } from '../agentic/capabilities'
import { getAgenticConfig } from '../agentic/config'
import { getApprovalConfig, resolvePendingApproval } from '../agentic/approval'
import { openWithEditor } from '../runtime/open-target'
import { takeoverStatus, takeoverApply, takeoverRestore } from '../routing/takeover'
import { getCachedLocalAgentStatuses } from '../runtime/local-agents'
import { ProviderClient } from '../providers/client'
import type { AgentRouteBinding, ThinkingConfig } from '../providers/types'
import { resolvePathWithinAllowedBases } from './path-guards'

const SENSITIVE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.keystore', '.jks', '.ssh', '.ovpn', '.kdbx'
])

interface MissingIpcDeps {
  dispatcher: any
  runtimeStore: any
  registry: any
  providerMgr: any
  proxy: any
  hub: any
  getMainWindow: () => any
  memory: () => any
}

export function registerMissingIpc(deps: MissingIpcDeps): void {
  const { dispatcher, providerMgr, proxy, getMainWindow } = deps

  // --- Turns (turns:create/cancel/cancelAgent/resolveGuard/retry are in index.ts) ---

  // --- Hub Cancel ---
  ipcMain.handle("hub:cancel", async (_event, taskId: string) => {
    if (dispatcher) dispatcher.cancel(taskId)
    return true
  })

  // --- Tasks ---
  ipcMain.handle("tasks:delete", async (_event, taskId: string) => {
    if (dispatcher) dispatcher.deleteTask?.(taskId)
    return true
  })

  ipcMain.handle("tasks:clearCompleted", async () => {
    if (dispatcher) dispatcher.clearCompleted?.()
    return true
  })

  // --- Skills ---
  ipcMain.handle("skills:list", async () => {
    return getSkillManager().list()
  })
  ipcMain.handle("skills:builtins", async () => {
    return BUILTIN_SKILLS
  })
  ipcMain.handle("skills:scanLocal", async () => {
    return getSkillManager().scanLocal({ refresh: true })
  })
  ipcMain.handle("skills:importLocal", async (_e, sourcePath: string) => {
    return getSkillManager().importLocal(sourcePath)
  })
  ipcMain.handle("skills:refreshLocal", async () => {
    return getSkillManager().scanLocal({ refresh: true })
  })
  ipcMain.handle("skills:add", async (_e, input: any) => {
    return getSkillManager().add(input)
  })
  ipcMain.handle("skills:update", async (_e, id: string, patch: any) => {
    return getSkillManager().update(id, patch)
  })
  ipcMain.handle("skills:remove", async (_e, id: string) => {
    return getSkillManager().remove(id)
  })
  ipcMain.handle("skills:getInstalls", async () => {
    return getSkillManager().getInstalls()
  })
  ipcMain.handle("skills:install", async (_e, agentId: string, skillId: string) => {
    return getSkillManager().install(agentId, skillId)
  })
  ipcMain.handle("skills:uninstall", async (_e, agentId: string, skillId: string) => {
    return getSkillManager().uninstall(agentId, skillId)
  })

  // --- Agentic ---
  ipcMain.handle("agentic:capabilities", async () => {
    return getCapabilityMatrix()
  })
  ipcMain.handle("agentic:getEnabled", async () => {
    return getAgenticConfig().getEnabled()
  })
  ipcMain.handle("agentic:setEnabled", async (_e, agentId: string, on: boolean) => {
    return getAgenticConfig().setEnabled(agentId, on)
  })
  ipcMain.handle("agentic:getMode", async () => {
    return getAgenticConfig().getMode()
  })
  ipcMain.handle("agentic:setMode", async (_e, mode: string) => {
    return getAgenticConfig().setMode(mode as any)
  })
  ipcMain.handle("agentic:getApprovalConfig", async () => {
    return getApprovalConfig().getConfig()
  })
  ipcMain.handle("agentic:setApprovalPreset", async (_e, preset: string) => {
    return getApprovalConfig().setPreset(preset as any)
  })
  ipcMain.handle("agentic:setApprovalDefault", async (_e, tool: string, policy: string) => {
    return getApprovalConfig().setDefault(tool as any, policy as any)
  })
  ipcMain.handle("agentic:setApprovalOverride", async (_e, agentId: string, tool: string, policy: string | null) => {
    return getApprovalConfig().setOverride(agentId, tool as any, policy as any)
  })
  ipcMain.handle("agentic:resolveApproval", async (_e, requestId: string, approved: boolean) => {
    return resolvePendingApproval(requestId, approved ? 'approved' : 'denied')
  })

  // --- App ---
  ipcMain.handle("app:openExternal", async (_e, url: string) => {
    if (url && (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:'))) {
      await shell.openExternal(url)
      return { ok: true }
    }
    return { ok: false, error: 'Invalid URL scheme' }
  })
  ipcMain.handle("app:openPath", async (_e, input: { path: string; target?: string; line?: number; column?: number; workspaceRoot?: string | null }) => {
    try {
      const resolvedPath = resolveAppPath(input?.path || '', input?.workspaceRoot)
      const target = input.target || 'system'
      const result = await openWithEditor(target, resolvedPath, input.line, input.column)
      return { ...result, path: resolvedPath, target }
    } catch (e: any) { return { ok: false, path: input?.path || '', target: input?.target || 'system', error: e?.message } }
  })
  ipcMain.handle("app:resolvePath", async (_e, input: { path: string; workspaceRoot?: string | null }) => {
    try {
      return { ok: true, path: resolveAppPath(input?.path || '', input?.workspaceRoot) }
    } catch (e: any) { return { ok: false, path: input?.path || '', error: e?.message } }
  })
  ipcMain.handle("app:readTextFile", async (_e, input: { path: string; workspaceRoot?: string | null }) => {
    try {
      const rawPath = input.path || ''
      // Block sensitive file extensions
      const ext = extname(rawPath).toLowerCase()
      if (SENSITIVE_EXTENSIONS.has(ext)) return { ok: false, error: 'Access to sensitive file type denied' }
      // Resolve and validate path is within allowed directories
      const activeId = getWorkspaceManager()?.getActive()
      const ws = activeId ? getWorkspaceManager()?.getById(activeId) : null
      const root = input?.workspaceRoot || ws?.rootPath || app.getPath('userData')
      const userData = app.getPath('userData')
      const resolved = resolvePathWithinAllowedBases(rawPath, root, [root, userData])
      const st = statSync(resolved)
      if (st.size > 1_000_000) return { ok: false, error: 'File too large' }
      return { ok: true, content: readFileSync(resolved, 'utf-8') }
    } catch (e: any) { return { ok: false, error: e?.message } }
  })
  ipcMain.handle("app:pickFolder", async (_e, options?: { defaultPath?: string }) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: options?.defaultPath })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle("app:pickFiles", async (_e, options?: { defaultPath?: string }) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], defaultPath: options?.defaultPath })
    return result.canceled ? null : result.filePaths
  })

  // --- Proxy Info ---
  ipcMain.handle("proxy:info", () => ({
    url: proxy?.getUrl?.() || '',
    running: proxy?.isRunning?.() || false
  }))

  // --- Agents Locate ---
  ipcMain.handle("agents:locate", async () => {
    return getCachedLocalAgentStatuses()
  })

  // --- Takeover ---
  ipcMain.handle("takeover:status", async () => {
    try {
      return takeoverStatus()
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  })
  ipcMain.handle("takeover:apply", async (_e, app: string, modelRef: string) => {
    try {
      const proxyOpenAIUrl = proxy?.getUrl?.() || ''
      const proxyOrigin = proxyOpenAIUrl.replace(/\/v1$/, '')
      if (!proxy?.isRunning?.()) {
        return { ok: false, error: 'Proxy is not running. Start the proxy first.' }
      }
      return takeoverApply(app, modelRef, proxyOpenAIUrl, proxyOrigin)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })
  ipcMain.handle("takeover:restore", async (_e, app: string) => {
    try {
      return takeoverRestore(app)
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  })

  // --- AI Quick Complete ---
  ipcMain.handle("ai:quickComplete", async (_e, input: { prompt: string; systemPrompt?: string; providerId?: string; modelId?: string; timeoutMs?: number }) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      if (typeof input?.prompt !== 'string' || !input.prompt.trim()) {
        return { ok: false, error: 'empty prompt' }
      }
      const provider = input.providerId ? providerMgr.getProvider(input.providerId) : providerMgr.getEnabledProviders()?.[0]
      if (!provider) return { ok: false, error: 'No provider available' }
      const modelId = input.modelId || provider.models?.[0]?.id || 'gpt-4'
      const model = provider.models?.find((item: any) => item.id === modelId) || {
        id: modelId,
        label: modelId,
        contextWindow: 258_000,
        supportsTools: false,
        supportsVision: false,
        supportsThinking: false
      }
      const binding: AgentRouteBinding = {
        agentId: 'quick-complete',
        providerId: provider.id,
        modelId,
        thinkingAllow: ['off'],
        thinking: { mode: 'off', level: 'medium' },
        maxOutputTokens: 2048,
        temperature: 0.2,
        protocol: 'http'
      }
      const thinking: ThinkingConfig = { mode: 'off', level: 'medium' }
      const client = new ProviderClient(provider, model, binding, thinking)
      const controller = new AbortController()
      timeout = setTimeout(() => controller.abort(), input.timeoutMs || 30000)
      let content = ''
      let errorMessage = ''
      await client.stream({
        messages: [{ role: 'user', content: input.prompt }],
        systemPrompt: input.systemPrompt,
        signal: controller.signal
      }, {
        onContent: delta => { content += delta },
        onDone: final => { content = final.content || content },
        onError: err => { errorMessage = err.message }
      })
      clearTimeout(timeout)
      if (errorMessage) return { ok: false, error: errorMessage }
      return { ok: true, content }
    } catch (e: any) { if (timeout) clearTimeout(timeout); return { ok: false, error: e?.message } }
  })
}

function resolveAppPath(pathText: string, workspaceRoot?: string | null): string {
  const p = pathText || ''
  const activeId = getWorkspaceManager()?.getActive()
  const ws = activeId ? getWorkspaceManager()?.getById(activeId) : null
  const root = workspaceRoot || ws?.rootPath || app.getPath('userData')
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  return resolvePathWithinAllowedBases(p, root, [root, userData, home])
}
