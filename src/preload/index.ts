import { contextBridge, ipcRenderer } from 'electron'
import { typedInvoke } from './typed-ipc'
import type { IpcArgs, IpcResult } from '../shared/ipc-contract'

const api = {
  hub: {
    getStatus: () => typedInvoke('hub:status')
  },
  proxy: {
    info: () => typedInvoke('proxy:info')
  },
  agents: {
    locate: () => typedInvoke('agents:locate')
  },
  dialog: {
    selectDirectory: () => typedInvoke('dialog:selectDirectory')
  },
  win: {
    minimize: () => typedInvoke('win:minimize'),
    maximizeToggle: () => typedInvoke('win:maximizeToggle'),
    isMaximized: () => typedInvoke('win:isMaximized'),
    close: () => typedInvoke('win:close'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const handler = (_event: any, v: boolean) => callback(v)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    }
  },
  providers: {
    get: () => typedInvoke('providers:get'),
    upsert: (p: Record<string, unknown>) => typedInvoke('providers:upsert', p),
    delete: (id: string) => typedInvoke('providers:delete', id),
    setEnabled: (id: string, enabled: boolean) => typedInvoke('providers:setEnabled', id, enabled),
    setKey: (id: string, key: string) => typedInvoke('providers:setKey', id, key),
    health: (id: string) => typedInvoke('providers:health', id),
    healthAll: () => typedInvoke('providers:healthAll'),
    fetchModels: (id: string, override?: { baseUrl?: string; apiKey?: string; kind?: string }) => typedInvoke('providers:fetchModels', id, override),
    reorderForClaude: (orderedIds: string[]) => typedInvoke('providers:reorderForClaude', orderedIds),
    onWarning: (callback: (warning: { providerId: string; message: string }) => void) => {
      const handler = (_event: any, warning: any) => callback(warning)
      ipcRenderer.on('providers:warning', handler)
      return () => ipcRenderer.removeListener('providers:warning', handler)
    },
    onConfigChanged: (callback: (config: IpcResult<'providers:get'>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, config: IpcResult<'providers:get'>) => callback(config)
      ipcRenderer.on('providers:configChanged', handler)
      return () => ipcRenderer.removeListener('providers:configChanged', handler)
    }
  },
  takeover: {
    status: () => typedInvoke('takeover:status'),
    apply: (app: string, modelRef: string) => typedInvoke('takeover:apply', app, modelRef),
    restore: (app: string) => typedInvoke('takeover:restore', app)
  },
  routing: {
    setBinding: (b: any) => typedInvoke('routing:setBinding', b),
    removeBinding: (agentId: string) => typedInvoke('routing:removeBinding', agentId),
    setFallback: (chain: string[]) => typedInvoke('routing:setFallback', chain),
    setStrategy: (s: string) => typedInvoke('routing:setStrategy', s),
    setBindingThinking: (agentId: string, t: any) => typedInvoke('routing:setBindingThinking', agentId, t),
    setProviderThinking: (id: string, t: any) => typedInvoke('routing:setProviderThinking', id, t),
    activeBinding: (agentId: string) => typedInvoke('routing:activeBinding', agentId)
  },
  store: {
    get: (key: string, defaultValue?: IpcArgs<'store:get'>[1]) => typedInvoke('store:get', key, defaultValue),
    set: (key: string, value: IpcArgs<'store:set'>[1]) => typedInvoke('store:set', key, value)
  },
  memory: {
    catalog: () => typedInvoke('memory:catalog'),
    getSettings: () => typedInvoke('memory:getSettings'),
    updateSettings: (patch: IpcArgs<'memory:updateSettings'>[0]) => typedInvoke('memory:updateSettings', patch),
    list: (category?: IpcArgs<'memory:list'>[0]) => typedInvoke('memory:list', category),
    search: (query: string, category?: IpcArgs<'memory:search'>[1]) => typedInvoke('memory:search', query, category),
    addEntry: (entry: IpcArgs<'memory:addEntry'>[0]) => typedInvoke('memory:addEntry', entry),
    importConversation: (source: string, content: string) => typedInvoke('memory:importConversation', source, content),
    listCandidates: () => typedInvoke('memory:listCandidates'),
    approveCandidate: (id: string) => typedInvoke('memory:approveCandidate', id),
    updateEntry: (id: string, patch: IpcArgs<'memory:updateEntry'>[1]) => typedInvoke('memory:updateEntry', id, patch),
    disableEntry: (id: string) => typedInvoke('memory:disableEntry', id),
    delete: (id: string) => typedInvoke('memory:delete', id),
    restore: (id: string) => typedInvoke('memory:restore', id)
  },
  app: {
    openExternal: (url: string) => typedInvoke('app:openExternal', url),
    openPath: (input: IpcArgs<'app:openPath'>[0]) => {
      if (!input || typeof input.path !== 'string') return Promise.reject(new Error('Invalid path'))
      return typedInvoke('app:openPath', input)
    },
    resolvePath: (input: IpcArgs<'app:resolvePath'>[0]) => {
      if (!input || typeof input.path !== 'string') return Promise.reject(new Error('Invalid path'))
      return typedInvoke('app:resolvePath', input)
    },
    readTextFile: (input: IpcArgs<'app:readTextFile'>[0]) => typedInvoke('app:readTextFile', input),
    pickFolder: (options?: IpcArgs<'app:pickFolder'>[0]) => typedInvoke('app:pickFolder', options),
    pickFiles: (options?: IpcArgs<'app:pickFiles'>[0]) => typedInvoke('app:pickFiles', options),
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => {
      const handler = (_event: any, link: any) => callback(link)
      ipcRenderer.on('app:deep-link', handler)
      return () => ipcRenderer.removeListener('app:deep-link', handler)
    },
    onMenuCommand: (callback: (link: { action: string; params: Record<string, string> }) => void) => {
      const handler = (_event: any, link: any) => callback(link)
      ipcRenderer.on('app:menu-command', handler)
      return () => ipcRenderer.removeListener('app:menu-command', handler)
    }
  },
  workspaces: {
    list: () => typedInvoke('workspaces:list'),
    create: (input: IpcArgs<'workspaces:create'>[0]) => typedInvoke('workspaces:create', input),
    update: (id: string, patch: IpcArgs<'workspaces:update'>[1]) =>
      typedInvoke('workspaces:update', id, patch),
    remove: (id: string) => typedInvoke('workspaces:remove', id),
    getActive: () => typedInvoke('workspaces:getActive'),
    setActive: (id: string | null) => typedInvoke('workspaces:setActive', id)
  },
  threads: {
    list: (workspaceId?: string | null) => typedInvoke('threads:list', workspaceId),
    create: (input: IpcArgs<'threads:create'>[0]) => typedInvoke('threads:create', input),
    rename: (threadId: string, title: string) => typedInvoke('threads:rename', threadId, title),
    delete: (threadId: string) => typedInvoke('threads:delete', threadId),
    select: (threadId: string | null) => typedInvoke('threads:select', threadId),
    fork: (input: IpcArgs<'threads:fork'>[0]) => typedInvoke('threads:fork', input)
  },
  turns: {
    create: (input: IpcArgs<'turns:create'>[0]) =>
      typedInvoke('turns:create', input),
    cancel: (turnId: string) => typedInvoke('turns:cancel', turnId),
    cancelAgent: (turnId: string, agentId: string) => typedInvoke('turns:cancelAgent', turnId, agentId),
    resolveGuard: (requestId: string, approved: boolean) => typedInvoke('turns:resolveGuard', requestId, approved),
    retry: (turnId: string) => typedInvoke('turns:retry', turnId)
  },
  runtime: {
    snapshot: (workspaceId?: string | null) => typedInvoke('runtime:snapshot', workspaceId),
    eventsSince: (threadId: string, seq?: number) => typedInvoke('runtime:eventsSince', threadId, seq ?? 0),
    onEvent: (callback: (event: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('runtime:event', handler)
      return () => ipcRenderer.removeListener('runtime:event', handler)
    }
  },
  context: {
    projection: (input: IpcArgs<'context:projection'>[0]) =>
      typedInvoke('context:projection', input)
  },
  localAgents: {
    detect: () => typedInvoke('localAgents:detect'),
    status: () => typedInvoke('localAgents:status'),
    options: () => typedInvoke('localAgents:options'),
    configure: (agentId: string, patch: IpcArgs<'localAgents:configure'>[1]) =>
      typedInvoke('localAgents:configure', agentId, patch)
  },
  localModels: {
    scan: (agentId?: string | null) => typedInvoke('localModels:scan', agentId),
    readConfig: (agentId: string) => typedInvoke('localModels:readConfig', agentId)
  },
  settings: {
    getRunTimeout: () => typedInvoke('settings:getRunTimeout'),
    setRunTimeout: (value: number) => typedInvoke('settings:setRunTimeout', value)
  },
  schedules: {
    list: () => typedInvoke('schedules:list'),
    runPreview: (preset: IpcArgs<'schedules:runPreview'>[0]) => typedInvoke('schedules:runPreview', preset)
  },
  routes: {
    explain: (turnId: string) => typedInvoke('routes:explain', turnId)
  },
  commands: {
    list: () => typedInvoke('commands:list'),
    run: (input: IpcArgs<'commands:run'>[0]) => typedInvoke('commands:run', input)
  },
  workflows: {
    list: (category?: IpcArgs<'workflows:list'>[0]) => typedInvoke('workflows:list', category),
    get: (id: string) => typedInvoke('workflows:get', id),
    upsert: (input: IpcArgs<'workflows:upsert'>[0]) => typedInvoke('workflows:upsert', input),
    delete: (id: string) => typedInvoke('workflows:delete', id),
    search: (query: string) => typedInvoke('workflows:search', query),
    seed: () => typedInvoke('workflows:seed')
  },
  ecc: {
    status: () => typedInvoke('ecc:status'),
    update: () => typedInvoke('ecc:update')
  },
  terminal: {
    run: (input: IpcArgs<'terminal:run'>[0]) => {
      if (!input || typeof input.command !== 'string' || !input.command.trim()) {
        return Promise.reject(new Error('Invalid terminal command'))
      }
      return typedInvoke('terminal:run', input)
    },
    cancel: (runId: string) => typedInvoke('terminal:cancel', runId),
    history: () => typedInvoke('terminal:history')
  },
  // --- Terminal PTY Sessions (Kun-inspired) ---
  terminalPty: {
    create: (payload: { sessionId: string; cwd?: string; cols?: number; rows?: number }) =>
      typedInvoke('terminal:create', payload),
    write: (payload: { sessionId: string; data: string }) =>
      typedInvoke('terminal:write', payload),
    resize: (payload: { sessionId: string; cols: number; rows: number }) =>
      typedInvoke('terminal:resize', payload),
    dispose: (sessionId: string) =>
      typedInvoke('terminal:dispose', sessionId),
    onData: (handler: (payload: { sessionId: string; data: string }) => void) => {
      const wrapped = (_event: any, payload: any) => handler(payload)
      ipcRenderer.on('terminal:data', wrapped)
      return () => ipcRenderer.removeListener('terminal:data', wrapped)
    },
    onExit: (handler: (payload: { sessionId: string; exitCode: number }) => void) => {
      const wrapped = (_event: any, payload: any) => handler(payload)
      ipcRenderer.on('terminal:exit', wrapped)
      return () => ipcRenderer.removeListener('terminal:exit', wrapped)
    }
  },
  tasks: {
    delete: (taskId: string) => typedInvoke('tasks:delete', taskId),
    clearCompleted: () => typedInvoke('tasks:clearCompleted')
  },
  git: {
    status: (workspaceId?: string | null) => typedInvoke('git:status', workspaceId),
    branches: (workspaceId?: string | null) => typedInvoke('git:branches', workspaceId),
    checkoutBranch: (workspaceId: string | null, branch: string) => typedInvoke('git:checkoutBranch', workspaceId, branch),
    createBranch: (workspaceId: string | null, branch: string, checkout?: boolean) => typedInvoke('git:createBranch', workspaceId, branch, checkout),
    renameBranch: (workspaceId: string | null, oldName: string, newName: string) => typedInvoke('git:renameBranch', workspaceId, oldName, newName),
    deleteBranch: (workspaceId: string | null, branch: string, force?: boolean) => typedInvoke('git:deleteBranch', workspaceId, branch, force),
    log: (workspaceId?: string | null, limit?: number) => typedInvoke('git:log', workspaceId, limit),
    diff: (workspaceId?: string | null, filePath?: string) => typedInvoke('git:diff', workspaceId, filePath),
    diffs: (workspaceId?: string | null) => typedInvoke('git:diffs', workspaceId),
    commitDetails: (workspaceId: string | null, sha: string) => typedInvoke('git:commitDetails', workspaceId, sha),
    commitDiff: (workspaceId: string | null, sha: string, filePath?: string) => typedInvoke('git:commitDiff', workspaceId, sha, filePath),
    stageFile: (workspaceId: string | null, filePath: string) => typedInvoke('git:stageFile', workspaceId, filePath),
    stageAll: (workspaceId: string | null) => typedInvoke('git:stageAll', workspaceId),
    unstageFile: (workspaceId: string | null, filePath: string) => typedInvoke('git:unstageFile', workspaceId, filePath),
    revertFile: (workspaceId: string | null, filePath: string) => typedInvoke('git:revertFile', workspaceId, filePath),
    revertAll: (workspaceId: string | null) => typedInvoke('git:revertAll', workspaceId),
    commit: (workspaceId: string | null, message: string, filePaths?: string[]) => typedInvoke('git:commit', workspaceId, message, filePaths),
    fetch: (workspaceId: string | null, remote?: string) => typedInvoke('git:fetch', workspaceId, remote),
    pull: (workspaceId: string | null, remote?: string, branch?: string) => typedInvoke('git:pull', workspaceId, remote, branch),
    push: (workspaceId: string | null, remote?: string, branch?: string) => typedInvoke('git:push', workspaceId, remote, branch),
    sync: (workspaceId: string | null) => typedInvoke('git:sync', workspaceId),
    updateBranch: (workspaceId: string | null, branch: string) => typedInvoke('git:updateBranch', workspaceId, branch),
    query: (input: IpcArgs<'git:query'>[0]) => typedInvoke('git:query', input)
  },
  mcp: {
    list: (workspaceId?: string | null) => typedInvoke('mcp:list', workspaceId),
    scanLocal: (workspaceId?: string | null) => typedInvoke('mcp:scanLocal', workspaceId),
    upsert: (input: IpcArgs<'mcp:upsert'>[0]) => typedInvoke('mcp:upsert', input),
    remove: (id: string) => typedInvoke('mcp:remove', id),
    setEnabled: (id: string, enabled: boolean, workspaceId?: string | null) => typedInvoke('mcp:setEnabled', id, enabled, workspaceId),
    test: (id: string, workspaceId?: string | null) => typedInvoke('mcp:test', id, workspaceId),
    listTools: (id: string, workspaceId?: string | null) => typedInvoke('mcp:listTools', id, workspaceId),
    // MCP 系统级控制配置
    getSystemConfig: () => typedInvoke('mcp:getSystemConfig'),
    setSystemConfig: (config: IpcArgs<'mcp:setSystemConfig'>[0]) => typedInvoke('mcp:setSystemConfig', config),
    setSystemEnabled: (enabled: boolean) => typedInvoke('mcp:setSystemEnabled', enabled)
  },
  worktrees: {
    list: (parentWorkspaceId?: string | null) => typedInvoke('worktrees:list', parentWorkspaceId),
    create: (input: IpcArgs<'worktrees:create'>[0]) => typedInvoke('worktrees:create', input),
    remove: (id: string, force?: boolean) => typedInvoke('worktrees:remove', id, force),
    sync: (id: string) => typedInvoke('worktrees:sync', id),
    open: (id: string) => typedInvoke('worktrees:open', id)
  },
  todos: {
    list: (threadId: string) => typedInvoke('todos:list', threadId),
    set: (threadId: string, todos: IpcArgs<'todos:set'>[1]) => typedInvoke('todos:set', threadId, todos),
    upsert: (input: IpcArgs<'todos:upsert'>[0]) => typedInvoke('todos:upsert', input),
    delete: (threadId: string, todoId: string) => typedInvoke('todos:delete', threadId, todoId),
    clear: (threadId: string) => typedInvoke('todos:clear', threadId),
    syncFromMarkdown: (threadId: string, markdown: string, sourceContext?: IpcArgs<'todos:syncFromMarkdown'>[2]) =>
      typedInvoke('todos:syncFromMarkdown', threadId, markdown, sourceContext)
  },
  updates: {
    status: () => typedInvoke('updates:status'),
    check: (channel?: IpcArgs<'updates:check'>[0]) => typedInvoke('updates:check', channel),
    setChannel: (channel: IpcArgs<'updates:setChannel'>[0]) => typedInvoke('updates:setChannel', channel),
    openDownload: () => typedInvoke('updates:openDownload')
  },
  browser: {
    open: (input: IpcArgs<'browser:open'>[0]) => typedInvoke('browser:open', input),
    capture: (attachment: IpcArgs<'browser:capture'>[0]) => typedInvoke('browser:capture', attachment),
    summarize: (snapshot: IpcArgs<'browser:summarize'>[0]) => typedInvoke('browser:summarize', snapshot),
    extractText: (html: string) => typedInvoke('browser:extractText', html),
    analyzePrompt: (snapshot: IpcArgs<'browser:analyzePrompt'>[0], request?: string) => typedInvoke('browser:analyzePrompt', snapshot, request)
  },
  usage: {
    stats: (range?: IpcArgs<'usage:stats'>[0], view?: IpcArgs<'usage:stats'>[1]) => typedInvoke('usage:stats', range, view),
    records: (filter?: IpcArgs<'usage:records'>[0], page?: number, pageSize?: number) => typedInvoke('usage:records', filter, page, pageSize),
    recordDetail: (id: string) => typedInvoke('usage:recordDetail', id),
    pricingList: () => typedInvoke('usage:pricing:list'),
    pricingUpsert: (rule: IpcArgs<'usage:pricing:upsert'>[0]) => typedInvoke('usage:pricing:upsert', rule),
    pricingDelete: (idOrModelId: string, providerId?: string) => typedInvoke('usage:pricing:delete', idOrModelId, providerId)
  },
  goals: {
    get: (threadId?: string | null) => typedInvoke('goals:get', threadId),
    set: (threadId: string, goal: string, loopLimit?: number) => typedInvoke('goals:set', threadId, goal, loopLimit),
    clear: (threadId: string) => typedInvoke('goals:clear', threadId)
  },
  // --- AgentHub skills + native agentic (Claude-B 新增) ---
  skills: {
    list: () => typedInvoke('skills:list'),
    builtins: () => typedInvoke('skills:builtins'),
    scanLocal: () => typedInvoke('skills:scanLocal'),
    importLocal: (sourcePath: string) => typedInvoke('skills:importLocal', sourcePath),
    refreshLocal: () => typedInvoke('skills:refreshLocal'),
    add: (input: IpcArgs<'skills:add'>[0]) => typedInvoke('skills:add', input),
    update: (id: string, patch: IpcArgs<'skills:update'>[1]) => typedInvoke('skills:update', id, patch),
    remove: (id: string) => typedInvoke('skills:remove', id),
    getInstalls: () => typedInvoke('skills:getInstalls'),
    install: (agentId: string, skillId: string) => typedInvoke('skills:install', agentId, skillId),
    uninstall: (agentId: string, skillId: string) => typedInvoke('skills:uninstall', agentId, skillId)
  },
  agentic: {
    capabilities: () => typedInvoke('agentic:capabilities'),
    getEnabled: () => typedInvoke('agentic:getEnabled'),
    setEnabled: (agentId: string, on: boolean) => typedInvoke('agentic:setEnabled', agentId, on),
    getMode: () => typedInvoke('agentic:getMode'),
    setMode: (mode: IpcArgs<'agentic:setMode'>[0]) => typedInvoke('agentic:setMode', mode),
    // 写/执行审批门禁
    getApprovalConfig: () => typedInvoke('agentic:getApprovalConfig'),
    setApprovalPreset: (preset: IpcArgs<'agentic:setApprovalPreset'>[0]) =>
      typedInvoke('agentic:setApprovalPreset', preset),
    setApprovalDefault: (tool: IpcArgs<'agentic:setApprovalDefault'>[0], policy: IpcArgs<'agentic:setApprovalDefault'>[1]) =>
      typedInvoke('agentic:setApprovalDefault', tool, policy),
    setApprovalOverride: (agentId: string, tool: IpcArgs<'agentic:setApprovalOverride'>[1], policy: IpcArgs<'agentic:setApprovalOverride'>[2]) =>
      typedInvoke('agentic:setApprovalOverride', agentId, tool, policy),
    resolveApproval: (requestId: string, approved: boolean) =>
      typedInvoke('agentic:resolveApproval', requestId, approved)
  },
  // --- Prompt Library ---
  prompts: {
    list: (category?: IpcArgs<'prompts:list'>[0]) => typedInvoke('prompts:list', category),
    get: (id: string) => typedInvoke('prompts:get', id),
    upsert: (input: IpcArgs<'prompts:upsert'>[0]) => typedInvoke('prompts:upsert', input),
    delete: (id: string) => typedInvoke('prompts:delete', id),
    search: (query: string) => typedInvoke('prompts:search', query),
    slashCommands: () => typedInvoke('prompts:slashCommands'),
    incrementUse: (id: string) => typedInvoke('prompts:incrementUse', id),
    seedDefaults: () => typedInvoke('prompts:seedDefaults')
  },
  // --- Keyboard Shortcuts ---
  shortcuts: {
    list: (category?: IpcArgs<'shortcuts:list'>[0]) => typedInvoke('shortcuts:list', category),
    get: (id: string) => typedInvoke('shortcuts:get', id),
    update: (id: string, key: string) => typedInvoke('shortcuts:update', id, key),
    reset: (id: string) => typedInvoke('shortcuts:reset', id),
    resetAll: () => typedInvoke('shortcuts:resetAll'),
    conflicts: () => typedInvoke('shortcuts:conflicts')
  },
  // --- Diagnostics ---
  diagnostics: {
    run: () => typedInvoke('diagnostics:run'),
    logPath: () => typedInvoke('logs:path'),
    recentLogs: (limit?: number) => typedInvoke('logs:recent', limit)
  },
  // --- Backup ---
  backup: {
    create: () => typedInvoke('backup:create'),
    list: () => typedInvoke('backup:list'),
    restore: (filename: string) => typedInvoke('backup:restore', filename),
    delete: (filename: string) => typedInvoke('backup:delete', filename)
  },
  // --- Conversation Export ---
  conversation: {
    exportMarkdown: (data: IpcArgs<'conversation:exportMarkdown'>[0]) => typedInvoke('conversation:exportMarkdown', data),
    exportHtml: (data: IpcArgs<'conversation:exportHtml'>[0]) => typedInvoke('conversation:exportHtml', data),
    exportFile: (data: IpcArgs<'conversation:exportFile'>[0], format: IpcArgs<'conversation:exportFile'>[1], path: string) =>
      typedInvoke('conversation:exportFile', data, format, path)
  },
  // --- Notifications ---
  notifications: {
    list: (unreadOnly?: boolean) => typedInvoke('notifications:list', unreadOnly),
    unreadCount: () => typedInvoke('notifications:unreadCount'),
    push: (input: IpcArgs<'notifications:push'>[0]) => typedInvoke('notifications:push', input),
    markRead: (id: string) => typedInvoke('notifications:markRead', id),
    markAllRead: () => typedInvoke('notifications:markAllRead'),
    delete: (id: string) => typedInvoke('notifications:delete', id),
    clearAll: () => typedInvoke('notifications:clearAll')
  },
  // --- Onboarding ---
  onboarding: {
    getState: () => typedInvoke('onboarding:getState'),
    shouldShow: () => typedInvoke('onboarding:shouldShow'),
    completeStep: (step: IpcArgs<'onboarding:completeStep'>[0], skipped?: boolean) =>
      typedInvoke('onboarding:completeStep', step, skipped),
    skipAll: () => typedInvoke('onboarding:skipAll'),
    reset: () => typedInvoke('onboarding:reset'),
    nextStep: () => typedInvoke('onboarding:nextStep')
  },
  // --- Workspace Files ---
  workspaceFiles: {
    list: (rootPath: string, max?: number) => typedInvoke('workspaceFiles:list', rootPath, max),
    search: (rootPath: string, query: string, max?: number) => typedInvoke('workspaceFiles:search', rootPath, query, max),
    preview: (filePath: string, maxLines?: number) => typedInvoke('workspaceFiles:preview', filePath, maxLines),
    read: (workspaceRoot: string, relPath: string) => typedInvoke('workspaceFiles:read', workspaceRoot, relPath),
    write: (workspaceRoot: string, relPath: string, content: string) => typedInvoke('workspaceFiles:write', workspaceRoot, relPath, content),
    readImage: (workspaceRoot: string, relPath: string) => typedInvoke('workspaceFiles:readImage', workspaceRoot, relPath),
    listDirectory: (workspaceRoot: string, relPath: string) => typedInvoke('workspaceFiles:listDirectory', workspaceRoot, relPath)
  },
  // --- GitHub Integration ---
  github: {
    checkCli: () => typedInvoke('github:checkCli'),
    listPrs: (state?: IpcArgs<'github:listPrs'>[0], limit?: number) => typedInvoke('github:listPrs', state, limit),
    listIssues: (state?: IpcArgs<'github:listIssues'>[0], limit?: number) => typedInvoke('github:listIssues', state, limit),
    currentBranchPr: () => typedInvoke('github:currentBranchPr')
  },
  // --- Slash Commands ---
  slashCommands: {
    list: () => typedInvoke('slashCommands:list'),
    get: (shortcut: string) => typedInvoke('slashCommands:get', shortcut),
    save: (input: IpcArgs<'slashCommands:save'>[0]) => typedInvoke('slashCommands:save', input),
    delete: (shortcut: string) => typedInvoke('slashCommands:delete', shortcut),
    resolve: (shortcut: string, params: IpcArgs<'slashCommands:resolve'>[1]) =>
      typedInvoke('slashCommands:resolve', shortcut, params),
    validate: (shortcut: string) => typedInvoke('slashCommands:validate', shortcut),
    conflict: (shortcut: string) => typedInvoke('slashCommands:conflict', shortcut)
  },
  // --- Conversation Import ---
  conversationImport: {
    importFile: (filePath: string) => typedInvoke('conversation:importFile', filePath),
    importJson: (json: string) => typedInvoke('conversation:importJson', json),
    branch: (conversation: IpcArgs<'conversation:branch'>[0], index: number) => typedInvoke('conversation:branch', conversation, index),
    summarize: (conversation: IpcArgs<'conversation:summarize'>[0]) => typedInvoke('conversation:summarize', conversation)
  },
  // --- Memory Graph ---
  memoryGraph: {
    build: (entries: IpcArgs<'memory:graph'>[0]) => typedInvoke('memory:graph', entries),
    cleanupSuggestions: (graph: IpcArgs<'memory:cleanupSuggestions'>[0]) => typedInvoke('memory:cleanupSuggestions', graph)
  },
  // --- Plugin Manager ---
  plugins: {
    scan: (workspaceRoot?: string) => typedInvoke('plugins:scan', workspaceRoot),
    validate: (manifest: IpcArgs<'plugins:validate'>[0]) => typedInvoke('plugins:validate', manifest),
    contributions: (plugins: IpcArgs<'plugins:contributions'>[0]) => typedInvoke('plugins:contributions', plugins),
    repositories: () => typedInvoke('plugins:repositories'),
    importRepository: (input: IpcArgs<'plugins:importRepository'>[0]) => typedInvoke('plugins:importRepository', input)
  },
  // --- Project Map ---
  projectMap: {
    build: (rootPath: string, maxDepth?: number) => typedInvoke('projectMap:build', rootPath, maxDepth),
    search: (map: IpcArgs<'projectMap:search'>[0], query: string) => typedInvoke('projectMap:search', map, query)
  },
  // --- Release Workspace ---
  release: {
    checks: () => typedInvoke('release:checks')
  },
  // --- Terminal AI ---
  terminalAi: {
    buildPrompt: (userPrompt: string, context: IpcArgs<'terminalAi:buildPrompt'>[1]) => typedInvoke('terminalAi:buildPrompt', userPrompt, context),
    suggestCommand: (intent: string, context: IpcArgs<'terminalAi:suggestCommand'>[1]) => typedInvoke('terminalAi:suggestCommand', intent, context),
    explainOutput: (context: IpcArgs<'terminalAi:explainOutput'>[0]) => typedInvoke('terminalAi:explainOutput', context)
  },
  // --- Inline Edit ---
  inlineEdit: {
    buildPrompt: (request: IpcArgs<'inlineEdit:buildPrompt'>[0]) => typedInvoke('inlineEdit:buildPrompt', request),
    validate: (original: string, replacement: string) => typedInvoke('inlineEdit:validate', original, replacement),
    apply: (content: string, startLine: number, endLine: number, replacement: string) =>
      typedInvoke('inlineEdit:apply', content, startLine, endLine, replacement)
  },
  // --- AI Quick Complete (lightweight standalone LLM call) ---
  ai: {
    quickComplete: (input: IpcArgs<'ai:quickComplete'>[0]) =>
      typedInvoke('ai:quickComplete', input)
  },
  // --- P4-F1: Models Center ---
  models: {
    list: (providers?: IpcArgs<'models:list'>[0]) => typedInvoke('models:list', providers),
    routeSettingsGet: () => typedInvoke('models:routeSettings:get'),
    routeSettingsSet: (patch: IpcArgs<'models:routeSettings:set'>[0]) => typedInvoke('models:routeSettings:set', patch),
    updateRoute: (providerId: string, modelId: string, patch: IpcArgs<'models:updateRoute'>[2]) =>
      typedInvoke('models:updateRoute', providerId, modelId, patch),
    test: (input: IpcArgs<'models:test'>[0]) => typedInvoke('models:test', input),
    exportCodexCatalog: () => typedInvoke('models:exportCodexCatalog'),
    toggleFavorite: (providerId: string, modelId: string) => typedInvoke('models:toggleFavorite', providerId, modelId),
    toggleHidden: (providerId: string, modelId: string) => typedInvoke('models:toggleHidden', providerId, modelId),
    favorites: () => typedInvoke('models:favorites'),
    hidden: () => typedInvoke('models:hidden')
  },
  // --- P4-F2: Budget Center ---
  budget: {
    get: () => typedInvoke('budget:get'),
    update: (patch: IpcArgs<'budget:update'>[0]) => typedInvoke('budget:update', patch),
    check: (dailySpent: number, monthlySpent: number, requestTokens: number) => typedInvoke('budget:check', dailySpent, monthlySpent, requestTokens)
  },
  // --- P4-F3: Memory Studio ---
  memoryStudio: {
    scoreQuality: (entry: IpcArgs<'memory:scoreQuality'>[0]) => typedInvoke('memory:scoreQuality', entry),
    detectConflicts: (entries: IpcArgs<'memory:detectConflicts'>[0]) => typedInvoke('memory:detectConflicts', entries)
  },
  // --- P4-F4: Workflow Center ---
  workflowCenter: {
    substituteVars: (template: string, vars: IpcArgs<'workflow:substituteVars'>[1]) => typedInvoke('workflow:substituteVars', template, vars),
    evaluateCondition: (condition: string, vars: IpcArgs<'workflow:evaluateCondition'>[1]) => typedInvoke('workflow:evaluateCondition', condition, vars),
    saveRun: (record: IpcArgs<'workflow:saveRun'>[0]) => typedInvoke('workflow:saveRun', record),
    runHistory: () => typedInvoke('workflow:runHistory'),
    runHistoryFor: (workflowId: string) => typedInvoke('workflow:runHistoryFor', workflowId)
  },
  // --- P4-F5: Team Builder ---
  teams: {
    list: () => typedInvoke('teams:list'),
    save: (input: IpcArgs<'teams:save'>[0]) => typedInvoke('teams:save', input),
    delete: (id: string) => typedInvoke('teams:delete', id),
    defaultFirefly: (agentIds: string[]) => typedInvoke('teams:defaultFirefly', agentIds)
  },
  // --- P4-F6: Project Knowledge ---
  projectKnowledge: {
    detectTechStack: (rootPath: string) => typedInvoke('knowledge:detectTechStack', rootPath),
    generateSummary: (rootPath: string, entries: IpcArgs<'knowledge:generateSummary'>[1]) => typedInvoke('knowledge:generateSummary', rootPath, entries)
  },
  // --- P4-F7: Plugin Manager ---
  pluginManager: {
    install: (manifest: IpcArgs<'plugins:install'>[0]) => typedInvoke('plugins:install', manifest),
    uninstall: (id: string) => typedInvoke('plugins:uninstall', id),
    toggle: (id: string) => typedInvoke('plugins:toggle', id),
    listInstalled: () => typedInvoke('plugins:listInstalled'),
    enabledContributions: () => typedInvoke('plugins:enabledContributions')
  },
  // --- P4-F8: Diagnostics Suite ---
  diagnosticsSuite: {
    run: () => typedInvoke('diagnostics:runSuite')
  },
  // --- Agent Loop ---
  agentLoop: {
    getConfig: () => typedInvoke('agentLoop:getConfig'),
    getStatus: () => typedInvoke('agentLoop:getStatus'),
    getAgents: () => typedInvoke('agentLoop:getAgents'),
    refreshAgents: () => typedInvoke('agentLoop:refreshAgents'),
    getRouteInfo: (prompt: string) => typedInvoke('agentLoop:getRouteInfo', prompt)
  },
  // --- SDD (Spec Driven Development) ---
  sdd: {
    createDraft: (workspaceRoot: string, title: string, template?: string) =>
      typedInvoke('sdd:createDraft', workspaceRoot, title, template),
    getDraft: (workspaceRoot: string, draftId: string) =>
      typedInvoke('sdd:getDraft', workspaceRoot, draftId),
    updateDraft: (workspaceRoot: string, draftId: string, content: string) =>
      typedInvoke('sdd:updateDraft', workspaceRoot, draftId, content),
    updateDesignContext: (workspaceRoot: string, draftId: string, designContext: IpcArgs<'sdd:updateDesignContext'>[2]) =>
      typedInvoke('sdd:updateDesignContext', workspaceRoot, draftId, designContext),
    deleteDraft: (workspaceRoot: string, draftId: string) =>
      typedInvoke('sdd:deleteDraft', workspaceRoot, draftId),
    listDrafts: (workspaceRoot: string) =>
      typedInvoke('sdd:listDrafts', workspaceRoot),
    parseBlocks: (content: string) =>
      typedInvoke('sdd:parseBlocks', content),
    parsePlanCovers: (planMarkdown: string) =>
      typedInvoke('sdd:parsePlanCovers', planMarkdown),
    computeTrace: (workspaceRoot: string, draftId: string, planMarkdown?: string) =>
      typedInvoke('sdd:computeTrace', workspaceRoot, draftId, planMarkdown),
    saveTrace: (workspaceRoot: string, draftId: string, trace: IpcArgs<'sdd:saveTrace'>[2]) =>
      typedInvoke('sdd:saveTrace', workspaceRoot, draftId, trace),
    getTrace: (workspaceRoot: string, draftId: string) =>
      typedInvoke('sdd:getTrace', workspaceRoot, draftId),
    getHistory: (workspaceRoot: string, draftId: string) =>
      typedInvoke('sdd:getHistory', workspaceRoot, draftId),
    saveHistory: (workspaceRoot: string, draftId: string, entries: IpcArgs<'sdd:saveHistory'>[2]) =>
      typedInvoke('sdd:saveHistory', workspaceRoot, draftId, entries),
    clearHistory: (workspaceRoot: string, draftId: string) =>
      typedInvoke('sdd:clearHistory', workspaceRoot, draftId),
    exists: (workspaceRoot: string, draftId: string) =>
      typedInvoke('sdd:exists', workspaceRoot, draftId),
  },
  // --- P1-2: Firefly State Machine ---
  firefly: {
    createState: () => typedInvoke('firefly:createState'),
    completeRole: (state: IpcArgs<'firefly:completeRole'>[0], role: IpcArgs<'firefly:completeRole'>[1], output: string) =>
      typedInvoke('firefly:completeRole', state, role, output),
    getRoleContext: (
      state: IpcArgs<'firefly:getRoleContext'>[0],
      role: IpcArgs<'firefly:getRoleContext'>[1],
      prompt: string,
      memory?: string,
      project?: string
    ) => typedInvoke('firefly:getRoleContext', state, role, prompt, memory, project),
    isComplete: (state: IpcArgs<'firefly:isComplete'>[0]) => typedInvoke('firefly:isComplete', state),
    getOutput: (state: IpcArgs<'firefly:getOutput'>[0]) => typedInvoke('firefly:getOutput', state)
  },
  // --- /AgentHub skills + native agentic ---
  platform: process.platform
}

contextBridge.exposeInMainWorld('electronAPI', api)
