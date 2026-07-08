/**
 * Missing IPC Handlers.
 *
 * Registers handlers for channels exposed in preload but previously missing
 * from main process. Covers turns, hub cancel, tasks, skills, agentic, app,
 * proxy, agents, takeover, and AI quick-complete.
 */

import { shell, dialog, app } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import * as fs from 'node:fs'
import { getWorkspaceManager } from '../hub/workspace'
import { getSkillManager } from '../skills/manager'
import { BUILTIN_SKILLS } from '../skills/types'
import { getCapabilityMatrix } from '../agentic/capabilities'
import { getAgenticConfig } from '../agentic/config'
import { getApprovalConfig } from '../agentic/approval'
import { openWithEditor } from '../runtime/open-target'
import { takeoverStatus, takeoverApply, takeoverRestore } from '../routing/takeover'
import { getCachedLocalAgentStatuses } from '../runtime/local-agents'
import { ProviderClient } from '../providers/client'
import type { AgentRouteBinding, ThinkingConfig } from '../providers/types'
import { workspaceContextPromptForRoot } from '../runtime/workspace-context'
import { compactTextByTokenBudget } from '../runtime/token-economy'
import { resolvePathWithinAllowedBases } from './path-guards'
import { assertRegisteredWorkspaceRoot } from './workspace-root-guard'
import { isSensitiveTextFilePath } from './sensitive-files'
import { typedHandle } from './typed-ipc'

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
  const { dispatcher, runtimeStore, providerMgr, proxy, getMainWindow } = deps

  // --- Turns (turns:create/cancel/cancelAgent/resolveGuard/retry are in index.ts) ---

  // --- Tasks ---
  typedHandle('tasks:delete', async (_event, taskId) => {
    runtimeStore?.deleteTask?.(taskId)
    if (dispatcher) dispatcher.deleteTask?.(taskId)
    return true
  })

  typedHandle('tasks:clearCompleted', async (_event, workspaceId) => {
    runtimeStore?.clearCompletedTasks?.(workspaceId)
    if (dispatcher) dispatcher.clearCompleted?.()
    return true
  })

  // --- Skills ---
  typedHandle("skills:list", async () => {
    return getSkillManager().list()
  })
  typedHandle("skills:builtins", async () => {
    return BUILTIN_SKILLS
  })
  typedHandle("skills:scanLocal", async () => {
    return getSkillManager().scanLocal({ refresh: true })
  })
  typedHandle("skills:importLocal", async (_e, sourcePath) => {
    return getSkillManager().importLocal(sourcePath)
  })
  typedHandle("skills:refreshLocal", async () => {
    return getSkillManager().scanLocal({ refresh: true })
  })
  typedHandle("skills:add", async (_e, input) => {
    return getSkillManager().add(input)
  })
  typedHandle("skills:update", async (_e, id, patch) => {
    return getSkillManager().update(id, patch)
  })
  typedHandle("skills:remove", async (_e, id) => {
    return getSkillManager().remove(id)
  })
  typedHandle("skills:getInstalls", async () => {
    return getSkillManager().getInstalls()
  })
  typedHandle("skills:install", async (_e, agentId, skillId) => {
    return getSkillManager().install(agentId, skillId)
  })
  typedHandle("skills:uninstall", async (_e, agentId, skillId) => {
    return getSkillManager().uninstall(agentId, skillId)
  })

  // --- Agentic ---
  typedHandle("agentic:capabilities", async () => {
    return getCapabilityMatrix()
  })
  typedHandle("agentic:getEnabled", async () => {
    return getAgenticConfig().getEnabled()
  })
  typedHandle("agentic:setEnabled", async (_e, agentId, on) => {
    return getAgenticConfig().setEnabled(agentId, on)
  })
  typedHandle("agentic:getMode", async () => {
    return getAgenticConfig().getMode()
  })
  typedHandle("agentic:setMode", async (_e, mode) => {
    return getAgenticConfig().setMode(mode)
  })
  typedHandle("agentic:getApprovalConfig", async () => {
    return getApprovalConfig().getConfig()
  })
  typedHandle("agentic:setApprovalPreset", async (_e, preset) => {
    return getApprovalConfig().setPreset(preset)
  })
  typedHandle("agentic:setApprovalDefault", async (_e, tool, policy) => {
    return getApprovalConfig().setDefault(tool, policy)
  })
  typedHandle("agentic:setApprovalOverride", async (_e, agentId, tool, policy) => {
    return getApprovalConfig().setOverride(agentId, tool, policy)
  })
  typedHandle("agentic:resolveApproval", async (_e, requestId, approved) => {
    return dispatcher?.resolveApproval(requestId, approved) ?? false
  })

  // --- App ---
  typedHandle('app:openExternal', async (_e, url) => {
    if (url && (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:'))) {
      await shell.openExternal(url)
      return { ok: true }
    }
    return { ok: false, error: 'Invalid URL scheme' }
  })
  typedHandle('app:openPath', async (_e, input) => {
    try {
      const resolvedPath = resolveAppPath(input?.path || '', input?.workspaceRoot)
      const target = input.target || 'system'
      const result = await openWithEditor(target, resolvedPath, input.line, input.column)
      return { ...result, path: resolvedPath, target }
    } catch (e: any) { return { ok: false, path: input?.path || '', target: input?.target || 'system', error: e?.message } }
  })
  typedHandle('app:resolvePath', async (_e, input) => {
    try {
      return { ok: true, path: resolveAppPath(input?.path || '', input?.workspaceRoot) }
    } catch (e: any) { return { ok: false, path: input?.path || '', error: e?.message } }
  })
  typedHandle('app:readTextFile', async (_e, input) => {
    let resolved = input?.path || ''
    try {
      const rawPath = input?.path || ''
      // Block sensitive file extensions
      if (isSensitiveTextFilePath(rawPath)) return { ok: false, path: rawPath, error: 'Access to sensitive file type denied' }
      // Resolve and validate path is within allowed directories
      const activeId = getWorkspaceManager()?.getActive()
      const ws = activeId ? getWorkspaceManager()?.getById(activeId) : null
      const root = resolveAppBase(input?.workspaceRoot, ws?.rootPath)
      const userData = app.getPath('userData')
      resolved = resolvePathWithinAllowedBases(rawPath, root, [root, userData])
      const st = await fs.promises.stat(resolved)
      if (st.size > 1_000_000) return { ok: false, path: resolved, error: 'File too large' }
      const content = await fs.promises.readFile(resolved, 'utf-8')
      return { ok: true, path: resolved, content }
    } catch (e: any) { return { ok: false, path: resolved, error: e?.message } }
  })
  typedHandle('app:pickFolder', async (_e, options) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: options?.defaultPath })
    return result.canceled ? null : result.filePaths[0]
  })
  typedHandle('app:pickFiles', async (_e, options) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], defaultPath: options?.defaultPath })
    return result.canceled ? null : result.filePaths
  })

  // --- Proxy Info ---
  typedHandle("proxy:info", async () => ({
    url: proxy?.getUrl?.() || '',
    running: proxy?.isRunning?.() || false
  }))

  // --- Agents Locate ---
  typedHandle("agents:locate", async () => {
    return getCachedLocalAgentStatuses()
  })

  // --- Takeover ---
  typedHandle("takeover:status", async () => {
    try {
      return takeoverStatus()
    } catch (e: any) {
      return { error: e?.message || String(e) }
    }
  })
  typedHandle("takeover:apply", async (_e, app, modelRef) => {
    try {
      const proxyOpenAIUrl = proxy?.getUrl?.() || ''
      const proxyOrigin = proxyOpenAIUrl.replace(/\/v1$/, '')
      if (!proxy?.isRunning?.()) {
        return { ok: false as const, error: 'Proxy is not running. Start the proxy first.' }
      }
      return takeoverApply(app, modelRef, proxyOpenAIUrl, proxyOrigin)
    } catch (e: any) {
      return { ok: false as const, error: e?.message || String(e) }
    }
  })
  typedHandle("takeover:restore", async (_e, app) => {
    try {
      return takeoverRestore(app)
    } catch (e: any) {
      return { ok: false as const, error: e?.message || String(e) }
    }
  })

  // --- AI Quick Complete ---
  typedHandle("ai:quickComplete", async (_e, input) => {
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
      const workspaceContext = compactTextByTokenBudget(workspaceContextPromptForRoot(input.workspaceRoot), 2_000).text
      const prompt = compactTextByTokenBudget([workspaceContext, input.prompt].filter(Boolean).join('\n\n'), 12_000).text
      await client.stream({
        messages: [{ role: 'user', content: prompt }],
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
  const root = resolveAppBase(workspaceRoot, ws?.rootPath)
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  return resolvePathWithinAllowedBases(p, root, [root, userData, home])
}

function resolveAppBase(workspaceRoot?: string | null, activeWorkspaceRoot?: string | null): string {
  if (workspaceRoot) return assertRegisteredWorkspaceRoot(workspaceRoot)
  return activeWorkspaceRoot || app.getPath('userData')
}
