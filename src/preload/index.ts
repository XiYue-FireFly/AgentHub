import { contextBridge, ipcRenderer } from 'electron'

interface ModelSelection {
  providerId: string
  modelId: string
  agentId?: string
  source?: 'provider' | 'local-cli'
}

const api = {
  hub: {
    getStatus: () => ipcRenderer.invoke('hub:status'),
    routePreview: (text: string) => ipcRenderer.invoke('hub:routePreview', text),
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any; modelSelection?: ModelSelection; workspaceId?: string | null }) =>
      ipcRenderer.invoke('hub:dispatch', { text, mode: mode || 'auto', targetAgent, thinking: opts?.thinking, modelSelection: opts?.modelSelection, workspaceId: opts?.workspaceId ?? null }),
    cancel: (taskId: string) => ipcRenderer.invoke('hub:cancel', taskId)
  },
  proxy: {
    info: () => ipcRenderer.invoke('proxy:info')
  },
  agents: {
    locate: () => ipcRenderer.invoke('agents:locate')
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory')
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    close: () => ipcRenderer.invoke('win:close'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const handler = (_event: any, v: boolean) => callback(v)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    }
  },
  providers: {
    get: () => ipcRenderer.invoke('providers:get'),
    upsert: (p: Record<string, unknown>) => ipcRenderer.invoke('providers:upsert', p),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('providers:setEnabled', id, enabled),
    setKey: (id: string, key: string) => ipcRenderer.invoke('providers:setKey', id, key),
    health: (id: string) => ipcRenderer.invoke('providers:health', id),
    healthAll: () => ipcRenderer.invoke('providers:healthAll'),
    fetchModels: (id: string, override?: { baseUrl?: string; apiKey?: string; kind?: string }) => ipcRenderer.invoke('providers:fetchModels', id, override),
    reorderForClaude: (orderedIds: string[]) => ipcRenderer.invoke('providers:reorderForClaude', orderedIds),
    onWarning: (callback: (warning: { providerId: string; message: string }) => void) => {
      const handler = (_event: any, warning: any) => callback(warning)
      ipcRenderer.on('providers:warning', handler)
      return () => ipcRenderer.removeListener('providers:warning', handler)
    }
  },
  takeover: {
    status: () => ipcRenderer.invoke('takeover:status'),
    apply: (app: string, modelRef: string) => ipcRenderer.invoke('takeover:apply', app, modelRef),
    restore: (app: string) => ipcRenderer.invoke('takeover:restore', app)
  },
  routing: {
    setBinding: (b: any) => ipcRenderer.invoke('routing:setBinding', b),
    removeBinding: (agentId: string) => ipcRenderer.invoke('routing:removeBinding', agentId),
    setFallback: (chain: string[]) => ipcRenderer.invoke('routing:setFallback', chain),
    setStrategy: (s: string) => ipcRenderer.invoke('routing:setStrategy', s),
    setBindingThinking: (agentId: string, t: any) => ipcRenderer.invoke('routing:setBindingThinking', agentId, t),
    setProviderThinking: (id: string, t: any) => ipcRenderer.invoke('routing:setProviderThinking', id, t),
    activeBinding: (agentId: string) => ipcRenderer.invoke('routing:activeBinding', agentId)
  },
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value)
  },
  memory: {
    catalog: () => ipcRenderer.invoke('memory:catalog'),
    getSettings: () => ipcRenderer.invoke('memory:getSettings'),
    updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('memory:updateSettings', patch),
    list: (category?: string) => ipcRenderer.invoke('memory:list', category),
    search: (query: string, category?: string) => ipcRenderer.invoke('memory:search', query, category),
    addEntry: (entry: Record<string, unknown>) => ipcRenderer.invoke('memory:addEntry', entry),
    importConversation: (source: string, content: string) => ipcRenderer.invoke('memory:importConversation', source, content),
    listCandidates: () => ipcRenderer.invoke('memory:listCandidates'),
    approveCandidate: (id: string) => ipcRenderer.invoke('memory:approveCandidate', id),
    updateEntry: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('memory:updateEntry', id, patch),
    disableEntry: (id: string) => ipcRenderer.invoke('memory:disableEntry', id),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    restore: (id: string) => ipcRenderer.invoke('memory:restore', id),
    loadState: () => ipcRenderer.invoke('memory:loadState'),
    saveState: (state: any) => ipcRenderer.invoke('memory:saveState', state)
  },
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    openPath: (input: { path: string; target?: 'editor' | 'antigravity' | 'explorer' | 'system' | 'vscode' | 'cursor' | 'windsurf' | 'zed' | 'file-manager'; line?: number; column?: number; workspaceRoot?: string | null }) => {
      if (!input || typeof input.path !== 'string') return Promise.reject(new Error('Invalid path'))
      return ipcRenderer.invoke('app:openPath', input)
    },
    resolvePath: (input: { path: string; workspaceRoot?: string | null }) => {
      if (!input || typeof input.path !== 'string') return Promise.reject(new Error('Invalid path'))
      return ipcRenderer.invoke('app:resolvePath', input)
    },
    readTextFile: (input: { path: string; workspaceRoot?: string | null }) => ipcRenderer.invoke('app:readTextFile', input),
    pickFolder: (options?: { defaultPath?: string }) => ipcRenderer.invoke('app:pickFolder', options),
    pickFiles: (options?: { defaultPath?: string }) => ipcRenderer.invoke('app:pickFiles', options),
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
    list: () => ipcRenderer.invoke('workspaces:list'),
    create: (input: { name: string; rootPath: string }) => ipcRenderer.invoke('workspaces:create', input),
    update: (id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) =>
      ipcRenderer.invoke('workspaces:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('workspaces:remove', id),
    getActive: () => ipcRenderer.invoke('workspaces:getActive'),
    setActive: (id: string | null) => ipcRenderer.invoke('workspaces:setActive', id)
  },
  threads: {
    list: (workspaceId?: string | null) => ipcRenderer.invoke('threads:list', workspaceId),
    create: (input: { workspaceId?: string | null; title?: string }) => ipcRenderer.invoke('threads:create', input),
    rename: (threadId: string, title: string) => ipcRenderer.invoke('threads:rename', threadId, title),
    delete: (threadId: string) => ipcRenderer.invoke('threads:delete', threadId),
    select: (threadId: string | null) => ipcRenderer.invoke('threads:select', threadId),
    fork: (input: { sourceThreadId: string; sourceTurnId: string; message: string }) => ipcRenderer.invoke('threads:fork', input)
  },
  turns: {
    create: (input: { threadId?: string | null; workspaceId?: string | null; prompt: string; mode?: string; targetAgent?: string | null; thinking?: any; modelSelection?: ModelSelection; attachments?: any[]; customSchedule?: any }) =>
      ipcRenderer.invoke('turns:create', input),
    cancel: (turnId: string) => ipcRenderer.invoke('turns:cancel', turnId),
    cancelAgent: (turnId: string, agentId: string) => ipcRenderer.invoke('turns:cancelAgent', turnId, agentId),
    resolveGuard: (requestId: string, approved: boolean) => ipcRenderer.invoke('turns:resolveGuard', requestId, approved),
    retry: (turnId: string) => ipcRenderer.invoke('turns:retry', turnId)
  },
  runtime: {
    snapshot: (workspaceId?: string | null) => ipcRenderer.invoke('runtime:snapshot', workspaceId),
    eventsSince: (threadId: string, seq?: number) => ipcRenderer.invoke('runtime:eventsSince', threadId, seq ?? 0),
    onEvent: (callback: (event: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('runtime:event', handler)
      return () => ipcRenderer.removeListener('runtime:event', handler)
    }
  },
  context: {
    projection: (input: { threadId?: string | null; workspaceId?: string | null; prompt?: string; attachments?: any[]; writeDraft?: any; pinnedBlocks?: any[] }) =>
      ipcRenderer.invoke('context:projection', input)
  },
  localAgents: {
    detect: () => ipcRenderer.invoke('localAgents:detect'),
    status: () => ipcRenderer.invoke('localAgents:status'),
    options: () => ipcRenderer.invoke('localAgents:options'),
    configure: (agentId: string, patch: { binary?: string; args?: string; protocol?: 'stdio-plain' | 'acp' }) =>
      ipcRenderer.invoke('localAgents:configure', agentId, patch)
  },
  localModels: {
    scan: (agentId?: string | null) => ipcRenderer.invoke('localModels:scan', agentId),
    readConfig: (agentId: string) => ipcRenderer.invoke('localModels:readConfig', agentId)
  },
  settings: {
    getRunTimeout: () => ipcRenderer.invoke('settings:getRunTimeout'),
    setRunTimeout: (value: number) => ipcRenderer.invoke('settings:setRunTimeout', value)
  },
  schedules: {
    list: () => ipcRenderer.invoke('schedules:list'),
    runPreview: (preset: string) => ipcRenderer.invoke('schedules:runPreview', preset)
  },
  routes: {
    explain: (turnId: string) => ipcRenderer.invoke('routes:explain', turnId)
  },
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
    run: (input: { id?: string; text?: string }) => ipcRenderer.invoke('commands:run', input)
  },
  workflows: {
    list: (category?: string) => ipcRenderer.invoke('workflows:list', category),
    get: (id: string) => ipcRenderer.invoke('workflows:get', id),
    upsert: (input: Record<string, unknown>) => ipcRenderer.invoke('workflows:upsert', input),
    delete: (id: string) => ipcRenderer.invoke('workflows:delete', id),
    search: (query: string) => ipcRenderer.invoke('workflows:search', query),
    seed: () => ipcRenderer.invoke('workflows:seed')
  },
  ecc: {
    status: () => ipcRenderer.invoke('ecc:status'),
    update: () => ipcRenderer.invoke('ecc:update')
  },
  terminal: {
    run: (input: { workspaceId?: string | null; command: string }) => {
      if (!input || typeof input.command !== 'string' || !input.command.trim()) {
        return Promise.reject(new Error('Invalid terminal command'))
      }
      return ipcRenderer.invoke('terminal:run', input)
    },
    cancel: (runId: string) => ipcRenderer.invoke('terminal:cancel', runId),
    history: () => ipcRenderer.invoke('terminal:history')
  },
  // --- Terminal PTY Sessions (Kun-inspired) ---
  terminalPty: {
    create: (payload: { sessionId: string; cwd?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', payload),
    write: (payload: { sessionId: string; data: string }) =>
      ipcRenderer.invoke('terminal:write', payload),
    resize: (payload: { sessionId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:resize', payload),
    dispose: (sessionId: string) =>
      ipcRenderer.invoke('terminal:dispose', sessionId),
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
    delete: (taskId: string) => ipcRenderer.invoke('tasks:delete', taskId),
    clearCompleted: () => ipcRenderer.invoke('tasks:clearCompleted')
  },
  git: {
    status: (workspaceId?: string | null) => ipcRenderer.invoke('git:status', workspaceId),
    branches: (workspaceId?: string | null) => ipcRenderer.invoke('git:branches', workspaceId),
    checkoutBranch: (workspaceId: string | null, branch: string) => ipcRenderer.invoke('git:checkoutBranch', workspaceId, branch),
    createBranch: (workspaceId: string | null, branch: string, checkout?: boolean) => ipcRenderer.invoke('git:createBranch', workspaceId, branch, checkout),
    renameBranch: (workspaceId: string | null, oldName: string, newName: string) => ipcRenderer.invoke('git:renameBranch', workspaceId, oldName, newName),
    deleteBranch: (workspaceId: string | null, branch: string, force?: boolean) => ipcRenderer.invoke('git:deleteBranch', workspaceId, branch, force),
    log: (workspaceId?: string | null, limit?: number) => ipcRenderer.invoke('git:log', workspaceId, limit),
    diff: (workspaceId?: string | null, filePath?: string) => ipcRenderer.invoke('git:diff', workspaceId, filePath),
    diffs: (workspaceId?: string | null) => ipcRenderer.invoke('git:diffs', workspaceId),
    commitDetails: (workspaceId: string | null, sha: string) => ipcRenderer.invoke('git:commitDetails', workspaceId, sha),
    commitDiff: (workspaceId: string | null, sha: string, filePath?: string) => ipcRenderer.invoke('git:commitDiff', workspaceId, sha, filePath),
    stageFile: (workspaceId: string | null, filePath: string) => ipcRenderer.invoke('git:stageFile', workspaceId, filePath),
    stageAll: (workspaceId: string | null) => ipcRenderer.invoke('git:stageAll', workspaceId),
    unstageFile: (workspaceId: string | null, filePath: string) => ipcRenderer.invoke('git:unstageFile', workspaceId, filePath),
    revertFile: (workspaceId: string | null, filePath: string) => ipcRenderer.invoke('git:revertFile', workspaceId, filePath),
    revertAll: (workspaceId: string | null) => ipcRenderer.invoke('git:revertAll', workspaceId),
    commit: (workspaceId: string | null, message: string, filePaths?: string[]) => ipcRenderer.invoke('git:commit', workspaceId, message, filePaths),
    fetch: (workspaceId: string | null, remote?: string) => ipcRenderer.invoke('git:fetch', workspaceId, remote),
    pull: (workspaceId: string | null, remote?: string, branch?: string) => ipcRenderer.invoke('git:pull', workspaceId, remote, branch),
    push: (workspaceId: string | null, remote?: string, branch?: string) => ipcRenderer.invoke('git:push', workspaceId, remote, branch),
    sync: (workspaceId: string | null) => ipcRenderer.invoke('git:sync', workspaceId),
    updateBranch: (workspaceId: string | null, branch: string) => ipcRenderer.invoke('git:updateBranch', workspaceId, branch),
    query: (input: { workspaceId?: string | null; threadId?: string | null; query?: string }) => ipcRenderer.invoke('git:query', input)
  },
  mcp: {
    list: (workspaceId?: string | null) => ipcRenderer.invoke('mcp:list', workspaceId),
    scanLocal: (workspaceId?: string | null) => ipcRenderer.invoke('mcp:scanLocal', workspaceId),
    upsert: (input: Record<string, unknown>) => ipcRenderer.invoke('mcp:upsert', input),
    remove: (id: string) => ipcRenderer.invoke('mcp:remove', id),
    setEnabled: (id: string, enabled: boolean, workspaceId?: string | null) => ipcRenderer.invoke('mcp:setEnabled', id, enabled, workspaceId),
    test: (id: string, workspaceId?: string | null) => ipcRenderer.invoke('mcp:test', id, workspaceId),
    listTools: (id: string, workspaceId?: string | null) => ipcRenderer.invoke('mcp:listTools', id, workspaceId),
    // MCP 系统级控制配置
    getSystemConfig: () => ipcRenderer.invoke('mcp:getSystemConfig'),
    setSystemConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('mcp:setSystemConfig', config),
    setSystemEnabled: (enabled: boolean) => ipcRenderer.invoke('mcp:setSystemEnabled', enabled)
  },
  worktrees: {
    list: (parentWorkspaceId?: string | null) => ipcRenderer.invoke('worktrees:list', parentWorkspaceId),
    create: (input: { parentWorkspaceId: string; branch?: string; path?: string }) => ipcRenderer.invoke('worktrees:create', input),
    remove: (id: string, force?: boolean) => ipcRenderer.invoke('worktrees:remove', id, force),
    sync: (id: string) => ipcRenderer.invoke('worktrees:sync', id),
    open: (id: string) => ipcRenderer.invoke('worktrees:open', id)
  },
  todos: {
    list: (threadId: string) => ipcRenderer.invoke('todos:list', threadId),
    set: (threadId: string, todos: any[]) => ipcRenderer.invoke('todos:set', threadId, todos),
    upsert: (input: { threadId: string; id?: string; content: string; status?: string; source?: any }) => ipcRenderer.invoke('todos:upsert', input),
    delete: (threadId: string, todoId: string) => ipcRenderer.invoke('todos:delete', threadId, todoId),
    clear: (threadId: string) => ipcRenderer.invoke('todos:clear', threadId),
    syncFromMarkdown: (threadId: string, markdown: string) => ipcRenderer.invoke('todos:syncFromMarkdown', threadId, markdown)
  },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: (channel?: 'stable' | 'preview') => ipcRenderer.invoke('updates:check', channel),
    setChannel: (channel: 'stable' | 'preview') => ipcRenderer.invoke('updates:setChannel', channel),
    openDownload: () => ipcRenderer.invoke('updates:openDownload')
  },
  browser: {
    open: (input: { workspaceId?: string | null; url?: string }) => ipcRenderer.invoke('browser:open', input),
    capture: (attachment: any) => ipcRenderer.invoke('browser:capture', attachment),
    summarize: (snapshot: any) => ipcRenderer.invoke('browser:summarize', snapshot),
    extractText: (html: string) => ipcRenderer.invoke('browser:extractText', html),
    analyzePrompt: (snapshot: any, request?: string) => ipcRenderer.invoke('browser:analyzePrompt', snapshot, request)
  },
  usage: {
    stats: (range?: 'all' | '90d' | '30d' | '7d', view?: 'overview' | 'models' | 'requests' | 'providers' | 'pricing') => ipcRenderer.invoke('usage:stats', range, view),
    records: (filter?: any, page?: number, pageSize?: number) => ipcRenderer.invoke('usage:records', filter, page, pageSize),
    recordDetail: (id: string) => ipcRenderer.invoke('usage:recordDetail', id),
    pricingList: () => ipcRenderer.invoke('usage:pricing:list'),
    pricingUpsert: (rule: any) => ipcRenderer.invoke('usage:pricing:upsert', rule),
    pricingDelete: (idOrModelId: string, providerId?: string) => ipcRenderer.invoke('usage:pricing:delete', idOrModelId, providerId)
  },
  goals: {
    get: (threadId?: string | null) => ipcRenderer.invoke('goals:get', threadId),
    set: (threadId: string, goal: string, loopLimit?: number) => ipcRenderer.invoke('goals:set', threadId, goal, loopLimit),
    clear: (threadId: string) => ipcRenderer.invoke('goals:clear', threadId)
  },
  // --- AgentHub skills + native agentic (Claude-B 新增) ---
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    builtins: () => ipcRenderer.invoke('skills:builtins'),
    scanLocal: () => ipcRenderer.invoke('skills:scanLocal'),
    importLocal: (sourcePath: string) => ipcRenderer.invoke('skills:importLocal', sourcePath),
    refreshLocal: () => ipcRenderer.invoke('skills:refreshLocal'),
    add: (input: any) => ipcRenderer.invoke('skills:add', input),
    update: (id: string, patch: any) => ipcRenderer.invoke('skills:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('skills:remove', id),
    getInstalls: () => ipcRenderer.invoke('skills:getInstalls'),
    install: (agentId: string, skillId: string) => ipcRenderer.invoke('skills:install', agentId, skillId),
    uninstall: (agentId: string, skillId: string) => ipcRenderer.invoke('skills:uninstall', agentId, skillId)
  },
  agentic: {
    capabilities: () => ipcRenderer.invoke('agentic:capabilities'),
    getEnabled: () => ipcRenderer.invoke('agentic:getEnabled'),
    setEnabled: (agentId: string, on: boolean) => ipcRenderer.invoke('agentic:setEnabled', agentId, on),
    getMode: () => ipcRenderer.invoke('agentic:getMode'),
    setMode: (mode: 'all' | 'selected') => ipcRenderer.invoke('agentic:setMode', mode),
    // 写/执行审批门禁
    getApprovalConfig: () => ipcRenderer.invoke('agentic:getApprovalConfig'),
    setApprovalPreset: (preset: 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom') =>
      ipcRenderer.invoke('agentic:setApprovalPreset', preset),
    setApprovalDefault: (tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny') =>
      ipcRenderer.invoke('agentic:setApprovalDefault', tool, policy),
    setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny' | null) =>
      ipcRenderer.invoke('agentic:setApprovalOverride', agentId, tool, policy),
    resolveApproval: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('agentic:resolveApproval', requestId, approved)
  },
  // --- Prompt Library ---
  prompts: {
    list: (category?: string) => ipcRenderer.invoke('prompts:list', category),
    get: (id: string) => ipcRenderer.invoke('prompts:get', id),
    upsert: (input: any) => ipcRenderer.invoke('prompts:upsert', input),
    delete: (id: string) => ipcRenderer.invoke('prompts:delete', id),
    search: (query: string) => ipcRenderer.invoke('prompts:search', query),
    slashCommands: () => ipcRenderer.invoke('prompts:slashCommands'),
    incrementUse: (id: string) => ipcRenderer.invoke('prompts:incrementUse', id),
    seedDefaults: () => ipcRenderer.invoke('prompts:seedDefaults')
  },
  // --- Keyboard Shortcuts ---
  shortcuts: {
    list: (category?: string) => ipcRenderer.invoke('shortcuts:list', category),
    get: (id: string) => ipcRenderer.invoke('shortcuts:get', id),
    update: (id: string, key: string) => ipcRenderer.invoke('shortcuts:update', id, key),
    reset: (id: string) => ipcRenderer.invoke('shortcuts:reset', id),
    resetAll: () => ipcRenderer.invoke('shortcuts:resetAll'),
    conflicts: () => ipcRenderer.invoke('shortcuts:conflicts')
  },
  // --- Diagnostics ---
  diagnostics: {
    run: () => ipcRenderer.invoke('diagnostics:run'),
    logPath: () => ipcRenderer.invoke('logs:path')
  },
  // --- Backup ---
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (filename: string) => ipcRenderer.invoke('backup:restore', filename),
    delete: (filename: string) => ipcRenderer.invoke('backup:delete', filename)
  },
  // --- Conversation Export ---
  conversation: {
    exportMarkdown: (data: any) => ipcRenderer.invoke('conversation:exportMarkdown', data),
    exportHtml: (data: any) => ipcRenderer.invoke('conversation:exportHtml', data),
    exportFile: (data: any, format: string, path: string) => ipcRenderer.invoke('conversation:exportFile', data, format, path)
  },
  // --- Notifications ---
  notifications: {
    list: (unreadOnly?: boolean) => ipcRenderer.invoke('notifications:list', unreadOnly),
    unreadCount: () => ipcRenderer.invoke('notifications:unreadCount'),
    push: (input: any) => ipcRenderer.invoke('notifications:push', input),
    markRead: (id: string) => ipcRenderer.invoke('notifications:markRead', id),
    markAllRead: () => ipcRenderer.invoke('notifications:markAllRead'),
    delete: (id: string) => ipcRenderer.invoke('notifications:delete', id),
    clearAll: () => ipcRenderer.invoke('notifications:clearAll')
  },
  // --- Onboarding ---
  onboarding: {
    getState: () => ipcRenderer.invoke('onboarding:getState'),
    shouldShow: () => ipcRenderer.invoke('onboarding:shouldShow'),
    completeStep: (step: string, skipped?: boolean) => ipcRenderer.invoke('onboarding:completeStep', step, skipped),
    skipAll: () => ipcRenderer.invoke('onboarding:skipAll'),
    reset: () => ipcRenderer.invoke('onboarding:reset'),
    nextStep: () => ipcRenderer.invoke('onboarding:nextStep')
  },
  // --- Workspace Files ---
  workspaceFiles: {
    list: (rootPath: string, max?: number) => ipcRenderer.invoke('workspaceFiles:list', rootPath, max),
    search: (rootPath: string, query: string, max?: number) => ipcRenderer.invoke('workspaceFiles:search', rootPath, query, max),
    preview: (filePath: string, maxLines?: number) => ipcRenderer.invoke('workspaceFiles:preview', filePath, maxLines),
    read: (workspaceRoot: string, relPath: string) => ipcRenderer.invoke('workspaceFiles:read', workspaceRoot, relPath),
    write: (workspaceRoot: string, relPath: string, content: string) => ipcRenderer.invoke('workspaceFiles:write', workspaceRoot, relPath, content),
    readImage: (workspaceRoot: string, relPath: string) => ipcRenderer.invoke('workspaceFiles:readImage', workspaceRoot, relPath),
    listDirectory: (workspaceRoot: string, relPath: string) => ipcRenderer.invoke('workspaceFiles:listDirectory', workspaceRoot, relPath)
  },
  // --- GitHub Integration ---
  github: {
    checkCli: () => ipcRenderer.invoke('github:checkCli'),
    listPrs: (state?: string, limit?: number) => ipcRenderer.invoke('github:listPrs', state, limit),
    listIssues: (state?: string, limit?: number) => ipcRenderer.invoke('github:listIssues', state, limit),
    currentBranchPr: () => ipcRenderer.invoke('github:currentBranchPr')
  },
  // --- Slash Commands ---
  slashCommands: {
    list: () => ipcRenderer.invoke('slashCommands:list'),
    get: (shortcut: string) => ipcRenderer.invoke('slashCommands:get', shortcut),
    save: (input: any) => ipcRenderer.invoke('slashCommands:save', input),
    delete: (shortcut: string) => ipcRenderer.invoke('slashCommands:delete', shortcut),
    resolve: (shortcut: string, params: any) => ipcRenderer.invoke('slashCommands:resolve', shortcut, params),
    validate: (shortcut: string) => ipcRenderer.invoke('slashCommands:validate', shortcut),
    conflict: (shortcut: string) => ipcRenderer.invoke('slashCommands:conflict', shortcut)
  },
  // --- Conversation Import ---
  conversationImport: {
    importFile: (filePath: string) => ipcRenderer.invoke('conversation:importFile', filePath),
    importJson: (json: string) => ipcRenderer.invoke('conversation:importJson', json),
    branch: (conversation: any, index: number) => ipcRenderer.invoke('conversation:branch', conversation, index),
    summarize: (conversation: any) => ipcRenderer.invoke('conversation:summarize', conversation)
  },
  // --- Memory Graph ---
  memoryGraph: {
    build: (entries: any[]) => ipcRenderer.invoke('memory:graph', entries),
    cleanupSuggestions: (graph: any) => ipcRenderer.invoke('memory:cleanupSuggestions', graph)
  },
  // --- Plugin Manager ---
  plugins: {
    scan: (workspaceRoot?: string) => ipcRenderer.invoke('plugins:scan', workspaceRoot),
    validate: (manifest: any) => ipcRenderer.invoke('plugins:validate', manifest),
    contributions: (plugins: any[]) => ipcRenderer.invoke('plugins:contributions', plugins),
    repositories: () => ipcRenderer.invoke('plugins:repositories'),
    importRepository: (input: { url: string; id?: string; name?: string; branch?: string }) => ipcRenderer.invoke('plugins:importRepository', input)
  },
  // --- Project Map ---
  projectMap: {
    build: (rootPath: string, maxDepth?: number) => ipcRenderer.invoke('projectMap:build', rootPath, maxDepth),
    search: (map: any, query: string) => ipcRenderer.invoke('projectMap:search', map, query)
  },
  // --- Release Workspace ---
  release: {
    checks: () => ipcRenderer.invoke('release:checks')
  },
  // --- Terminal AI ---
  terminalAi: {
    buildPrompt: (userPrompt: string, context: any) => ipcRenderer.invoke('terminalAi:buildPrompt', userPrompt, context),
    suggestCommand: (intent: string, context: any) => ipcRenderer.invoke('terminalAi:suggestCommand', intent, context),
    explainOutput: (context: any) => ipcRenderer.invoke('terminalAi:explainOutput', context)
  },
  // --- Inline Edit ---
  inlineEdit: {
    buildPrompt: (request: any) => ipcRenderer.invoke('inlineEdit:buildPrompt', request),
    validate: (original: string, replacement: string) => ipcRenderer.invoke('inlineEdit:validate', original, replacement),
    apply: (content: string, startLine: number, endLine: number, replacement: string) => ipcRenderer.invoke('inlineEdit:apply', content, startLine, endLine, replacement)
  },
  // --- AI Quick Complete (lightweight standalone LLM call) ---
  ai: {
    quickComplete: (input: { prompt: string; systemPrompt?: string; providerId?: string; modelId?: string; timeoutMs?: number }) =>
      ipcRenderer.invoke('ai:quickComplete', input)
  },
  // --- P4-F1: Models Center ---
  models: {
    list: (providers?: any[]) => ipcRenderer.invoke('models:list', providers),
    routeSettingsGet: () => ipcRenderer.invoke('models:routeSettings:get'),
    routeSettingsSet: (patch: any) => ipcRenderer.invoke('models:routeSettings:set', patch),
    updateRoute: (providerId: string, modelId: string, patch: any) => ipcRenderer.invoke('models:updateRoute', providerId, modelId, patch),
    test: (input: { providerId: string; modelId: string; upstreamModel?: string }) => ipcRenderer.invoke('models:test', input),
    exportCodexCatalog: () => ipcRenderer.invoke('models:exportCodexCatalog'),
    toggleFavorite: (providerId: string, modelId: string) => ipcRenderer.invoke('models:toggleFavorite', providerId, modelId),
    toggleHidden: (providerId: string, modelId: string) => ipcRenderer.invoke('models:toggleHidden', providerId, modelId),
    favorites: () => ipcRenderer.invoke('models:favorites'),
    hidden: () => ipcRenderer.invoke('models:hidden')
  },
  // --- P4-F2: Budget Center ---
  budget: {
    get: () => ipcRenderer.invoke('budget:get'),
    update: (patch: Record<string, unknown>) => ipcRenderer.invoke('budget:update', patch),
    check: (dailySpent: number, monthlySpent: number, requestTokens: number) => ipcRenderer.invoke('budget:check', dailySpent, monthlySpent, requestTokens)
  },
  // --- P4-F3: Memory Studio ---
  memoryStudio: {
    scoreQuality: (entry: Record<string, unknown>) => ipcRenderer.invoke('memory:scoreQuality', entry),
    detectConflicts: (entries: Record<string, unknown>[]) => ipcRenderer.invoke('memory:detectConflicts', entries)
  },
  // --- P4-F4: Workflow Center ---
  workflowCenter: {
    substituteVars: (template: string, vars: Record<string, unknown>[]) => ipcRenderer.invoke('workflow:substituteVars', template, vars),
    evaluateCondition: (condition: string, vars: Record<string, unknown>[]) => ipcRenderer.invoke('workflow:evaluateCondition', condition, vars),
    saveRun: (record: Record<string, unknown>) => ipcRenderer.invoke('workflow:saveRun', record),
    runHistory: () => ipcRenderer.invoke('workflow:runHistory'),
    runHistoryFor: (workflowId: string) => ipcRenderer.invoke('workflow:runHistoryFor', workflowId)
  },
  // --- P4-F5: Team Builder ---
  teams: {
    list: () => ipcRenderer.invoke('teams:list'),
    save: (input: Record<string, unknown>) => ipcRenderer.invoke('teams:save', input),
    delete: (id: string) => ipcRenderer.invoke('teams:delete', id),
    defaultFirefly: (agentIds: string[]) => ipcRenderer.invoke('teams:defaultFirefly', agentIds)
  },
  // --- P4-F6: Project Knowledge ---
  projectKnowledge: {
    detectTechStack: (rootPath: string) => ipcRenderer.invoke('knowledge:detectTechStack', rootPath),
    generateSummary: (rootPath: string, entries: Record<string, unknown>[]) => ipcRenderer.invoke('knowledge:generateSummary', rootPath, entries)
  },
  // --- P4-F7: Plugin Manager ---
  pluginManager: {
    install: (manifest: Record<string, unknown>) => ipcRenderer.invoke('plugins:install', manifest),
    uninstall: (id: string) => ipcRenderer.invoke('plugins:uninstall', id),
    toggle: (id: string) => ipcRenderer.invoke('plugins:toggle', id),
    listInstalled: () => ipcRenderer.invoke('plugins:listInstalled'),
    enabledContributions: () => ipcRenderer.invoke('plugins:enabledContributions')
  },
  // --- P4-F8: Diagnostics Suite ---
  diagnosticsSuite: {
    run: () => ipcRenderer.invoke('diagnostics:runSuite')
  },
  // --- Agent Loop ---
  agentLoop: {
    getConfig: () => ipcRenderer.invoke('agentLoop:getConfig'),
    getStatus: () => ipcRenderer.invoke('agentLoop:getStatus'),
    getAgents: () => ipcRenderer.invoke('agentLoop:getAgents'),
    refreshAgents: () => ipcRenderer.invoke('agentLoop:refreshAgents'),
    getRouteInfo: (prompt: string) => ipcRenderer.invoke('agentLoop:getRouteInfo', prompt)
  },
  // --- SDD (Spec Driven Development) ---
  sdd: {
    createDraft: (workspaceRoot: string, title: string, template?: string) =>
      ipcRenderer.invoke('sdd:createDraft', workspaceRoot, title, template),
    getDraft: (workspaceRoot: string, draftId: string) =>
      ipcRenderer.invoke('sdd:getDraft', workspaceRoot, draftId),
    updateDraft: (workspaceRoot: string, draftId: string, content: string) =>
      ipcRenderer.invoke('sdd:updateDraft', workspaceRoot, draftId, content),
    updateDesignContext: (workspaceRoot: string, draftId: string, designContext: Record<string, unknown>) =>
      ipcRenderer.invoke('sdd:updateDesignContext', workspaceRoot, draftId, designContext),
    deleteDraft: (workspaceRoot: string, draftId: string) =>
      ipcRenderer.invoke('sdd:deleteDraft', workspaceRoot, draftId),
    listDrafts: (workspaceRoot: string) =>
      ipcRenderer.invoke('sdd:listDrafts', workspaceRoot),
    parseBlocks: (content: string) =>
      ipcRenderer.invoke('sdd:parseBlocks', content),
    parsePlanCovers: (planMarkdown: string) =>
      ipcRenderer.invoke('sdd:parsePlanCovers', planMarkdown),
    computeTrace: (workspaceRoot: string, draftId: string, planMarkdown?: string) =>
      ipcRenderer.invoke('sdd:computeTrace', workspaceRoot, draftId, planMarkdown),
    saveTrace: (workspaceRoot: string, draftId: string, trace: Record<string, unknown>) =>
      ipcRenderer.invoke('sdd:saveTrace', workspaceRoot, draftId, trace),
    getTrace: (workspaceRoot: string, draftId: string) =>
      ipcRenderer.invoke('sdd:getTrace', workspaceRoot, draftId),
    exists: (workspaceRoot: string, draftId: string) =>
      ipcRenderer.invoke('sdd:exists', workspaceRoot, draftId),
  },
  // --- P1-2: Firefly State Machine ---
  firefly: {
    createState: () => ipcRenderer.invoke('firefly:createState'),
    completeRole: (state: Record<string, unknown>, role: string, output: string) => ipcRenderer.invoke('firefly:completeRole', state, role, output),
    getRoleContext: (state: Record<string, unknown>, role: string, prompt: string, memory?: string, project?: string) => ipcRenderer.invoke('firefly:getRoleContext', state, role, prompt, memory, project),
    isComplete: (state: Record<string, unknown>) => ipcRenderer.invoke('firefly:isComplete', state),
    getOutput: (state: Record<string, unknown>) => ipcRenderer.invoke('firefly:getOutput', state)
  },
  // --- /AgentHub skills + native agentic ---
  platform: process.platform
}

contextBridge.exposeInMainWorld('electronAPI', api)
