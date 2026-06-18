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
    cancel: (taskId: string) => ipcRenderer.invoke('hub:cancel', taskId),
    onStatus: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('hub:status-update', handler)
      return () => ipcRenderer.removeListener('hub:status-update', handler)
    },
    onStream: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('dispatch:stream', handler)
      return () => ipcRenderer.removeListener('dispatch:stream', handler)
    }
  },
  proxy: {
    info: () => ipcRenderer.invoke('proxy:info')
  },
  agents: {
    locate: () => ipcRenderer.invoke('agents:locate')
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
    upsert: (p: any) => ipcRenderer.invoke('providers:upsert', p),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('providers:setEnabled', id, enabled),
    setKey: (id: string, key: string) => ipcRenderer.invoke('providers:setKey', id, key),
    health: (id: string) => ipcRenderer.invoke('providers:health', id),
    healthAll: () => ipcRenderer.invoke('providers:healthAll'),
    fetchModels: (id: string) => ipcRenderer.invoke('providers:fetchModels', id)
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
  onChatResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat:response', handler)
    return () => ipcRenderer.removeListener('chat:response', handler)
  },
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value)
  },
  memory: {
    catalog: () => ipcRenderer.invoke('memory:catalog'),
    list: (category?: string) => ipcRenderer.invoke('memory:list', category),
    search: (query: string, category?: string) => ipcRenderer.invoke('memory:search', query, category),
    addEntry: (entry: any) => ipcRenderer.invoke('memory:addEntry', entry),
    delete: (id: string) => ipcRenderer.invoke('memory:delete', id),
    loadState: () => ipcRenderer.invoke('memory:loadState'),
    saveState: (state: any) => ipcRenderer.invoke('memory:saveState', state)
  },
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
    pickFiles: () => ipcRenderer.invoke('app:pickFiles'),
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
    select: (threadId: string | null) => ipcRenderer.invoke('threads:select', threadId)
  },
  turns: {
    create: (input: { threadId?: string | null; workspaceId?: string | null; prompt: string; mode?: string; targetAgent?: string | null; thinking?: any; modelSelection?: ModelSelection; attachments?: any[]; customSchedule?: any }) =>
      ipcRenderer.invoke('turns:create', input),
    cancel: (turnId: string) => ipcRenderer.invoke('turns:cancel', turnId),
    cancelAgent: (turnId: string, agentId: string) => ipcRenderer.invoke('turns:cancelAgent', turnId, agentId),
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
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
    run: (input: { id?: string; text?: string }) => ipcRenderer.invoke('commands:run', input)
  },
  ecc: {
    status: () => ipcRenderer.invoke('ecc:status'),
    update: () => ipcRenderer.invoke('ecc:update')
  },
  terminal: {
    run: (input: { workspaceId?: string | null; command: string }) => ipcRenderer.invoke('terminal:run', input),
    cancel: (runId: string) => ipcRenderer.invoke('terminal:cancel', runId),
    history: () => ipcRenderer.invoke('terminal:history')
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
    upsert: (input: any) => ipcRenderer.invoke('mcp:upsert', input),
    remove: (id: string) => ipcRenderer.invoke('mcp:remove', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('mcp:setEnabled', id, enabled),
    test: (id: string, workspaceId?: string | null) => ipcRenderer.invoke('mcp:test', id, workspaceId)
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
    capture: (attachment: any) => ipcRenderer.invoke('browser:capture', attachment)
  },
  usage: {
    stats: (range?: 'all' | '90d' | '30d' | '7d', view?: 'overview' | 'models') => ipcRenderer.invoke('usage:stats', range, view)
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
    setApprovalDefault: (tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny') =>
      ipcRenderer.invoke('agentic:setApprovalDefault', tool, policy),
    setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny' | null) =>
      ipcRenderer.invoke('agentic:setApprovalOverride', agentId, tool, policy),
    resolveApproval: (requestId: string, approved: boolean) =>
      ipcRenderer.invoke('agentic:resolveApproval', requestId, approved)
  },
  // --- /AgentHub skills + native agentic ---
  platform: process.platform
}

contextBridge.exposeInMainWorld('electronAPI', api)
