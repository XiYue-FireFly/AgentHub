/// <reference types="vite/client" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../shared/ipc-types.ts" />

// Shared type contracts from src/shared/ipc-types.ts
// Renderer-side reference: these types mirror the main process definitions.
// ipc-types.ts is the canonical source of truth; this file provides ambient
// globals for the renderer process.

interface ElectronAPI {
  hub: {
    getStatus: () => Promise<any>
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any; modelSelection?: ModelSelection; workspaceId?: string | null }) => Promise<any>
    cancel: (taskId: string) => Promise<boolean>
    onStatus: (callback: (data: { running: boolean }) => void) => () => void
    onStream: (callback: (data: any) => void) => () => void
  }
  providers: {
    get: () => Promise<any> // ProvidersConfig — typed in shared/ipc-types.ts
    upsert: (p: any) => Promise<any>
    delete: (id: string) => Promise<boolean>
    setEnabled: (id: string, enabled: boolean) => Promise<any>
    setKey: (id: string, key: string) => Promise<any>
    health: (id: string) => Promise<any>
    healthAll: () => Promise<any>
    fetchModels: (id: string, override?: { baseUrl?: string; apiKey?: string; kind?: string }) => Promise<{ ok: boolean; count?: number; error?: string; config?: any }>
    reorderForClaude: (orderedIds: string[]) => Promise<any>
  }
  takeover: {
    status: () => Promise<Record<string, {
      supported: boolean; configPath: string; configExists: boolean
      takenOver: boolean; model: string | null; current: string | null
    }>>
    apply: (app: string, modelRef: string) => Promise<any>
    restore: (app: string) => Promise<any>
  }
  routing: {
    setBinding: (b: any) => Promise<any>
    removeBinding: (agentId: string) => Promise<any>
    setFallback: (chain: string[]) => Promise<any>
    setStrategy: (s: string) => Promise<any>
    setBindingThinking: (agentId: string, t: any) => Promise<any>
    setProviderThinking: (id: string, t: any) => Promise<any>
    activeBinding: (agentId: string) => Promise<any>
  }
  proxy: {
    info: () => Promise<{ url: string; openaiUrl?: string; anthropicUrl?: string; running: boolean }>
  }
  agents: {
    locate: () => Promise<Record<string, Array<{ source: 'desktop' | 'terminal'; label: string; path: string }>>>
  }
  win: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    isMaximized: () => Promise<boolean>
    close: () => Promise<void>
    onMaximized: (callback: (maximized: boolean) => void) => () => void
  }
  // LOW-24: Moved onChatResponse into chat namespace
  chat: {
    onResponse: (callback: (data: any) => void) => () => void
  }
  store: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<boolean>
  }
  memory: {
    catalog: () => Promise<any>
    getSettings: () => Promise<{ enabled: boolean }>
    updateSettings: (patch: { enabled?: boolean }) => Promise<{ enabled: boolean }>
    list: (category?: MemoryCategory) => Promise<any[]>
    search: (query: string, category?: MemoryCategory) => Promise<any[]>
    addEntry: (entry: any) => Promise<any>
    importConversation: (source: string, content: string) => Promise<MemoryEntry[]>
    listCandidates: () => Promise<MemoryEntry[]>
    approveCandidate: (id: string) => Promise<MemoryEntry | null>
    updateEntry: (id: string, patch: Partial<MemoryEntry>) => Promise<MemoryEntry | null>
    disableEntry: (id: string) => Promise<MemoryEntry | null>
    delete: (id: string) => Promise<boolean>
    loadState: () => Promise<{ messages?: any[]; tasks?: any[] }>
    saveState: (state: { messages: any[]; tasks: any[] }) => Promise<any>
  }
  app: {
    openExternal: (url: string) => Promise<void>
    openPath: (input: { path: string; target?: 'editor' | 'antigravity' | 'explorer' | 'system' | 'vscode' | 'cursor' | 'windsurf' | 'zed' | 'file-manager'; line?: number; column?: number; workspaceRoot?: string | null }) => Promise<{ ok: boolean; path: string; target: string; error?: string }>
    resolvePath: (input: { path: string; workspaceRoot?: string | null }) => Promise<{ ok: boolean; path: string; error?: string }>
    readTextFile: (input: { path: string; workspaceRoot?: string | null }) => Promise<{ ok: boolean; path: string; content?: string; error?: string }>
    pickFolder: (options?: { defaultPath?: string }) => Promise<string | null>
    pickFiles: (options?: { defaultPath?: string }) => Promise<WorkbenchAttachment[]>
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
    onMenuCommand: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
  }
  workspaces: {
    list: () => Promise<Array<{ id: string; name: string; rootPath: string; createdAt: number; updatedAt: number }>>
    create: (input: { name: string; rootPath: string }) => Promise<{ id: string; name: string; rootPath: string }>
    update: (id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) => Promise<any>
    remove: (id: string) => Promise<boolean>
    getActive: () => Promise<string | null>
    setActive: (id: string | null) => Promise<string | null>
  }
  threads: {
    list: (workspaceId?: string | null) => Promise<WorkbenchThread[]>
    create: (input: { workspaceId?: string | null; title?: string }) => Promise<WorkbenchThread>
    rename: (threadId: string, title: string) => Promise<WorkbenchThread>
    delete: (threadId: string) => Promise<boolean>
    select: (threadId: string | null) => Promise<string | null>
    fork: (input: { sourceThreadId: string; sourceTurnId: string; message: string }) => Promise<WorkbenchThread>
  }
  turns: {
    create: (input: { threadId?: string | null; workspaceId?: string | null; prompt: string; mode?: DispatchPreset; targetAgent?: string | null; thinking?: any; modelSelection?: ModelSelection; attachments?: WorkbenchAttachment[]; customSchedule?: SchedulePreview }) => Promise<any>
    cancel: (turnId: string) => Promise<boolean>
    cancelAgent: (turnId: string, agentId: string) => Promise<boolean>
    resolveGuard: (requestId: string, approved: boolean) => Promise<boolean>
    retry: (turnId: string) => Promise<any>
  }
  runtime: {
    snapshot: (workspaceId?: string | null) => Promise<WorkbenchSnapshot>
    eventsSince: (threadId: string, seq?: number) => Promise<RuntimeEvent[]>
    onEvent: (callback: (event: RuntimeEvent) => void) => () => void
  }
  context: {
    projection: (input: { threadId?: string | null; workspaceId?: string | null; prompt?: string; attachments?: WorkbenchAttachment[]; writeDraft?: { title: string; content: string } | null; pinnedBlocks?: ContextBlock[] }) => Promise<ContextProjection>
  }
  localAgents: {
    detect: () => Promise<LocalAgentStatus[]>
    status: () => Promise<LocalAgentStatus[]>
    options: () => Promise<Array<{ id: string; label: string; status: string; source: string }>>
    configure: (agentId: string, patch: { binary?: string; args?: string; protocol?: 'stdio-plain' | 'acp' }) => Promise<LocalAgentStatus[]>
  }
  localModels: {
    scan: (agentId?: string | null) => Promise<LocalModelConfig[]>
    readConfig: (agentId: string) => Promise<LocalModelConfig | null>
  }
  settings: {
    getRunTimeout: () => Promise<{ value: number; defaultMs: number; minMs: number; maxMs: number }>
    setRunTimeout: (value: number) => Promise<{ value: number; defaultMs: number; minMs: number; maxMs: number }>
  }
  schedules: {
    list: () => Promise<SchedulePreview[]>
    runPreview: (preset: DispatchPreset) => Promise<SchedulePreview>
  }
  routes: {
    explain: (turnId: string) => Promise<any[]>
  }
  commands: {
    list: () => Promise<WorkbenchCommand[]>
    run: (input: { id?: string; text?: string }) => Promise<WorkbenchCommand | null>
  }
  ecc: {
    status: () => Promise<EccCommandStatus>
    update: () => Promise<EccCommandStatus>
  }
  terminal: {
    run: (input: { workspaceId?: string | null; command: string }) => Promise<TerminalRun>
    cancel: (runId: string) => Promise<boolean>
    history: () => Promise<TerminalRun[]>
  }
  tasks: {
    delete: (taskId: string) => Promise<boolean>
    clearCompleted: () => Promise<boolean>
  }
  git: {
    status: (workspaceId?: string | null) => Promise<GitStatus>
    branches: (workspaceId?: string | null) => Promise<GitBranchListResponse>
    checkoutBranch: (workspaceId: string | null, branch: string) => Promise<GitStatus>
    createBranch: (workspaceId: string | null, branch: string, checkout?: boolean) => Promise<GitStatus>
    renameBranch: (workspaceId: string | null, oldName: string, newName: string) => Promise<GitBranchListResponse>
    deleteBranch: (workspaceId: string | null, branch: string, force?: boolean) => Promise<GitBranchListResponse>
    log: (workspaceId?: string | null, limit?: number) => Promise<GitLogResponse>
    diff: (workspaceId?: string | null, filePath?: string) => Promise<string>
    diffs: (workspaceId?: string | null) => Promise<GitFileDiff[]>
    commitDetails: (workspaceId: string | null, sha: string) => Promise<GitCommitDetails>
    commitDiff: (workspaceId: string | null, sha: string, filePath?: string) => Promise<GitCommitDiff[]>
    stageFile: (workspaceId: string | null, filePath: string) => Promise<GitStatus>
    stageAll: (workspaceId: string | null) => Promise<GitStatus>
    unstageFile: (workspaceId: string | null, filePath: string) => Promise<GitStatus>
    revertFile: (workspaceId: string | null, filePath: string) => Promise<GitStatus>
    revertAll: (workspaceId: string | null) => Promise<GitStatus>
    commit: (workspaceId: string | null, message: string, filePaths?: string[]) => Promise<{ hash: string }>
    fetch: (workspaceId: string | null, remote?: string) => Promise<GitStatus>
    pull: (workspaceId: string | null, remote?: string, branch?: string) => Promise<GitStatus>
    push: (workspaceId: string | null, remote?: string, branch?: string) => Promise<GitStatus>
    sync: (workspaceId: string | null) => Promise<GitStatus>
    updateBranch: (workspaceId: string | null, branch: string) => Promise<{ branch: string; status: "success" | "no-op" | "blocked"; message: string }>
    query: (input: { workspaceId?: string | null; threadId?: string | null; query?: string }) => Promise<GitQueryResult>
  }
  mcp: {
    list: (workspaceId?: string | null) => Promise<McpServerConfig[]>
    scanLocal: (workspaceId?: string | null) => Promise<McpServerConfig[]>
    upsert: (input: Partial<McpServerConfig> & { name: string }) => Promise<McpServerConfig>
    remove: (id: string) => Promise<boolean>
    setEnabled: (id: string, enabled: boolean, workspaceId?: string | null) => Promise<McpServerConfig | null>
    test: (id: string, workspaceId?: string | null) => Promise<McpServerConfig>
    listTools: (id: string, workspaceId?: string | null) => Promise<{ ok: boolean; tools: { name: string; description?: string }[]; error?: string }>
  }
  worktrees: {
    list: (parentWorkspaceId?: string | null) => Promise<WorktreeItem[]>
    create: (input: { parentWorkspaceId: string; branch?: string; path?: string }) => Promise<WorktreeItem>
    remove: (id: string, force?: boolean) => Promise<boolean>
    sync: (id: string) => Promise<WorktreeItem>
    open: (id: string) => Promise<any>
  }
  todos: {
    list: (threadId: string) => Promise<ThreadTodo[]>
    set: (threadId: string, todos: ThreadTodo[]) => Promise<ThreadTodo[]>
    upsert: (input: { threadId: string; id?: string; content: string; status?: ThreadTodoStatus; source?: any }) => Promise<ThreadTodo>
    delete: (threadId: string, todoId: string) => Promise<boolean>
    clear: (threadId: string) => Promise<boolean>
    syncFromMarkdown: (threadId: string, markdown: string) => Promise<ThreadTodo[]>
  }
  updates: {
    status: () => Promise<UpdateStatus>
    check: (channel?: 'stable' | 'preview') => Promise<UpdateStatus>
    setChannel: (channel: 'stable' | 'preview') => Promise<UpdateStatus>
    openDownload: () => Promise<boolean>
  }
  browser: {
    open: (input: { workspaceId?: string | null; url?: string }) => Promise<BrowserSession>
    capture: (attachment: BrowserContextAttachment) => Promise<BrowserContextAttachment>
    summarize: (snapshot: any) => Promise<string>
    extractText: (html: string) => Promise<string>
    analyzePrompt: (snapshot: any, request?: string) => Promise<string>
  }
  usage: {
    stats: (range?: UsageRange, view?: UsageView) => Promise<UsageStats>
    records: (filter?: UsageRecordFilter, page?: number, pageSize?: number) => Promise<PaginatedUsageRecords>
    recordDetail: (id: string) => Promise<UsageRequestRecord | null>
    pricingList: () => Promise<UsagePricingRule[]>
    pricingUpsert: (rule: Partial<UsagePricingRule> & { modelId: string }) => Promise<UsagePricingRule>
    pricingDelete: (idOrModelId: string, providerId?: string) => Promise<boolean>
  }
  goals: {
    get: (threadId?: string | null) => Promise<WorkbenchGoal | null>
    set: (threadId: string, goal: string, loopLimit?: number) => Promise<WorkbenchGoal>
    clear: (threadId: string) => Promise<WorkbenchGoal | null>
  }
  // --- AgentHub skills + native agentic (Claude-B 新增) ---
  skills: {
    list: () => Promise<Array<{ id: string; name: string; description: string; instructions: string; tags: string[]; category?: { id: string; label: string }; source: string; createdAt: number; updatedAt: number }>>
    builtins: () => Promise<Array<{ name: string; description?: string; instructions: string; tags?: string[]; category?: { id: string; label: string } | string; source?: string }>>
    scanLocal: () => Promise<LocalSkillCandidate[]>
    importLocal: (sourcePath: string) => Promise<any>
    refreshLocal: () => Promise<LocalSkillCandidate[]>
    add: (input: { name: string; description?: string; instructions: string; tags?: string[]; category?: { id: string; label: string } | string; source?: string }) => Promise<any>
    update: (id: string, patch: { name?: string; description?: string; instructions?: string; tags?: string[]; category?: { id: string; label: string } | string; source?: string }) => Promise<any>
    remove: (id: string) => Promise<boolean>
    getInstalls: () => Promise<Record<string, string[]>>
    install: (agentId: string, skillId: string) => Promise<Record<string, string[]>>
    uninstall: (agentId: string, skillId: string) => Promise<Record<string, string[]>>
  }
  agentic: {
    capabilities: () => Promise<Array<{ agentId: string; name: string; protocol: 'http' | 'stdio-plain' | 'acp'; nativeCli: boolean; httpAgentic: boolean; capabilities: string[] }>>
    getEnabled: () => Promise<string[]>
    setEnabled: (agentId: string, on: boolean) => Promise<string[]>
    getMode: () => Promise<'all' | 'selected'>
    setMode: (mode: 'all' | 'selected') => Promise<'all' | 'selected'>
    getApprovalConfig: () => Promise<{ version: 1; preset?: 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'; default: { write: 'allow' | 'ask' | 'deny'; exec: 'allow' | 'ask' | 'deny' }; overrides: Record<string, { write?: 'allow' | 'ask' | 'deny'; exec?: 'allow' | 'ask' | 'deny' }> }>
    setApprovalPreset: (preset: 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom') => Promise<any>
    setApprovalDefault: (tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny') => Promise<any>
    setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'ask' | 'deny' | null) => Promise<any>
    resolveApproval: (requestId: string, approved: boolean) => Promise<boolean>
  }
  prompts: {
    list: (category?: string) => Promise<any[]>
    get: (id: string) => Promise<any | null>
    upsert: (input: any) => Promise<any>
    delete: (id: string) => Promise<boolean>
    search: (query: string) => Promise<any[]>
    slashCommands: () => Promise<any[]>
    incrementUse: (id: string) => Promise<void>
    seedDefaults: () => Promise<void>
  }
  shortcuts: {
    list: (category?: string) => Promise<any[]>
    get: (id: string) => Promise<any | null>
    update: (id: string, key: string) => Promise<any | null>
    reset: (id: string) => Promise<any | null>
    resetAll: () => Promise<void>
    conflicts: () => Promise<Array<{ key: string; ids: string[] }>>
  }
  diagnostics: {
    run: () => Promise<{ timestamp: string; results: Array<{ id: string; name: string; status: string; message: string }>; summary: { pass: number; warn: number; fail: number; skip: number; total: number } }>
    logPath: () => Promise<{ path: string }>
  }
  backup: {
    create: () => Promise<{ id: string; filename: string; createdAt: string; sizeBytes: number; keys: string[] }>
    list: () => Promise<Array<{ id: string; filename: string; createdAt: string; sizeBytes: number; keys: string[] }>>
    restore: (filename: string) => Promise<{ restored: string[]; error?: string }>
    delete: (filename: string) => Promise<boolean>
  }
  conversation: {
    exportMarkdown: (data: any) => Promise<string>
    exportHtml: (data: any) => Promise<string>
    exportFile: (data: any, format: string, path: string) => Promise<{ ok: boolean; path: string; error?: string }>
  }
  notifications: {
    list: (unreadOnly?: boolean) => Promise<Array<{ id: string; title: string; body: string; category: string; read: boolean; createdAt: string; action?: any }>>
    unreadCount: () => Promise<number>
    push: (input: any) => Promise<any>
    markRead: (id: string) => Promise<boolean>
    markAllRead: () => Promise<number>
    delete: (id: string) => Promise<boolean>
    clearAll: () => Promise<void>
  }
  onboarding: {
    getState: () => Promise<{ version: number; completed: boolean; completedAt?: string; completedSteps: string[]; skippedSteps: string[] }>
    shouldShow: () => Promise<boolean>
    completeStep: (step: string, skipped?: boolean) => Promise<any>
    skipAll: () => Promise<void>
    reset: () => Promise<void>
    nextStep: () => Promise<string | null>
  }
  workspaceFiles: {
    list: (rootPath: string, max?: number) => Promise<Array<{ path: string; relativePath: string; name: string; extension: string; isDirectory: boolean; sizeBytes: number }>>
    search: (rootPath: string, query: string, max?: number) => Promise<Array<{ path: string; relativePath: string; name: string; extension: string; isDirectory: boolean; sizeBytes: number }>>
    preview: (filePath: string, maxLines?: number) => Promise<{ ok: boolean; content?: string; error?: string }>
  }
  github: {
    checkCli: () => Promise<{ available: boolean; authenticated: boolean; version?: string; error?: string }>
    listPrs: (state?: string, limit?: number) => Promise<Array<{ number: number; title: string; state: string; author: string; url: string; branch: string; createdAt: string; labels: string[] }>>
    listIssues: (state?: string, limit?: number) => Promise<Array<{ number: number; title: string; state: string; author: string; url: string; labels: string[]; createdAt: string }>>
    currentBranchPr: () => Promise<{ branch: string; pr?: any }>
  }
  workflows: {
    list: (category?: string) => Promise<WorkflowDefinition[]>
    get: (id: string) => Promise<WorkflowDefinition | null>
    upsert: (input: Partial<WorkflowDefinition> & { name: string; steps: WorkflowStep[] }) => Promise<WorkflowDefinition>
    delete: (id: string) => Promise<boolean>
    search: (query: string) => Promise<WorkflowDefinition[]>
    seed: () => Promise<WorkflowDefinition[]>
  }
  inlineEdit: {
    buildPrompt: (request: any) => Promise<string>
    validate: (original: string, replacement: string) => Promise<{ valid: boolean; warnings?: string[] }>
    apply: (content: string, startLine: number, endLine: number, replacement: string) => Promise<{ ok: boolean; content?: string; error?: string }>
  }
  terminalAi: {
    buildPrompt: (userPrompt: string, context: any) => Promise<string>
    suggestCommand: (intent: string, context: any) => Promise<string>
    explainOutput: (context: any) => Promise<string>
  }
  ai: {
    quickComplete: (input: { prompt: string; systemPrompt?: string; providerId?: string; modelId?: string; timeoutMs?: number }) =>
      Promise<{ content: string; error?: string }>
  }
  models: {
    list: (providers?: any[]) => Promise<ModelRouteInfo[]>
    routeSettingsGet: () => Promise<ModelRouteSettings>
    routeSettingsSet: (patch: Partial<ModelRouteSettings>) => Promise<ModelRouteSettings>
    updateRoute: (providerId: string, modelId: string, patch: Partial<ModelRouteInfo>) => Promise<any>
    test: (input: { providerId: string; modelId: string; upstreamModel?: string }) => Promise<{ ok: boolean; latencyMs: number; error?: string; contentPreview?: string; usage?: any; upstreamModel?: string; routeReason?: string }>
    exportCodexCatalog: () => Promise<{ ok: boolean; path?: string; content: string; count: number; error?: string }>
    toggleFavorite: (providerId: string, modelId: string) => Promise<boolean>
    toggleHidden: (providerId: string, modelId: string) => Promise<boolean>
    favorites: () => Promise<string[]>
    hidden: () => Promise<string[]>
  }
  memoryGraph: {
    build: (entries: any[]) => Promise<any>
    cleanupSuggestions: (graph: any) => Promise<any[]>
  }
  plugins: {
    scan: (workspaceRoot?: string) => Promise<any[]>
    validate: (manifest: any) => Promise<{ valid: boolean; errors?: string[] }>
    contributions: (plugins: any[]) => Promise<{
      commands: Array<{ pluginId: string; id: string; label: string }>
      skills: Array<{ pluginId: string; id: string; path: string; content?: string }>
      prompts: Array<{ pluginId: string; id: string; name: string; body: string }>
    }>
    repositories: () => Promise<Array<{ id: string; name: string; url: string; description?: string; source: 'builtin' }>>
    importRepository: (input: { url: string; id?: string; name?: string; branch?: string }) => Promise<{ ok: boolean; plugin?: any; plugins?: any[]; path?: string; error?: string; diagnostics?: string[] }>
  }
  projectMap: {
    build: (rootPath: string, maxDepth?: number) => Promise<any>
    search: (map: any, query: string) => Promise<any[]>
  }
  release: {
    checks: () => Promise<any>
  }
  platform: string
}

type WorkbenchTurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
type DispatchPreset = 'auto' | 'broadcast' | 'chain' | 'orchestrate' | 'lead-workers' | 'parallel-review' | 'firefly-custom' | 'custom'
type MemoryCategory = 'conversation' | 'task' | 'skill' | 'file' | 'system' | 'preference' | 'project' | 'style' | 'decision' | 'correction' | 'imported_conversation'
type MemoryEntryStatus = 'candidate' | 'approved' | 'disabled'

interface MemoryEntry {
  id: string
  category: MemoryCategory
  title: string
  summary: string
  content?: string
  source?: string
  tags: string[]
  status?: MemoryEntryStatus
  confidence?: number
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
}

interface WorkbenchAttachment {
  id: string
  kind: 'file' | 'image' | 'text'
  name: string
  path?: string
  mime?: string
  size?: number
  dataUrl?: string
  text?: string
  createdAt?: number
}

type ContextBlockKind = 'recent_turns' | 'compaction_summary' | 'attachment' | 'memory' | 'browser' | 'skill' | 'write_draft' | 'workspace_file' | 'workspace_state'
type ContextBlockParticipation = 'selected' | 'pinned_next_send' | 'carried_over' | 'excluded'

interface ContextBlock {
  id: string
  kind: ContextBlockKind
  title: string
  detail?: string
  content?: string
  sourceRef?: string
  estimateTokens?: number
  participation: ContextBlockParticipation
  pinned?: boolean
  createdAt: number
}

interface ContextProjection {
  threadId: string | null
  workspaceId: string | null
  blocks: ContextBlock[]
  totalEstimateTokens: number
  compacted: boolean
  createdAt: number
}

interface ModelSelection {
  providerId: string
  modelId: string
  agentId?: string
  source?: 'provider' | 'local-cli'
}

interface ModelRouteInfo {
  providerId: string
  providerName: string
  providerEnabled: boolean
  providerHasKey: boolean
  providerProtocol: string
  modelId: string
  label: string
  contextWindow: number
  enabled: boolean
  upstreamModel?: string
  timeoutMs?: number
  retryCount?: number
  reasoningEnabled?: boolean
  defaultReasoningLevel?: string
  supportedReasoningLevels?: string[]
  codexAlias?: string
  description?: string
  supportsTools: boolean
  supportsVision: boolean
  supportsThinking: boolean
  isFavorite: boolean
  isHidden: boolean
}

interface ModelRouteSettings {
  fallbackModelId?: string
  codexDefaultModel?: string
  codexInjectionMode: 'official_account' | 'third_party_api' | 'lan_share'
  codexInternalModelLock: boolean
  codexSlots: Array<{ slot: string; targetModelId: string; mode: 'official_account' | 'third_party_api' | 'lan_share'; source: string }>
}

interface LocalModelConfig {
  agentId: string
  source: 'codex' | 'gemini' | 'claude'
  modelId?: string
  authMode?: 'api-key' | 'oauth' | 'unknown' | 'missing'
  baseUrl?: string
  configPath: string
  status: 'ok' | 'missing' | 'partial' | 'error'
  error?: string
  models?: Array<{ id: string; label?: string; contextWindow?: number; capabilities?: string[] }>
}

interface GitQueryResult {
  threadId: string
  turnId: string
  command: string
  content: string
}

interface WorkbenchThread {
  id: string
  workspaceId: string | null
  title: string
  createdAt: number
  updatedAt: number
  lastTurnStatus?: WorkbenchTurnStatus
}

interface WorkbenchTurn {
  id: string
  threadId: string
  prompt: string
  attachments?: WorkbenchAttachment[]
  contextProjection?: ContextProjection
  mode: DispatchPreset
  customSchedule?: SchedulePreview
  targetAgent?: string | null
  modelSelection?: ModelSelection
  thinking?: any
  status: WorkbenchTurnStatus
  taskIds: string[]
  createdAt: number
  completedAt?: number
}

interface AgentRunNode {
  id: string
  turnId: string
  agentId: string
  role: 'lead' | 'worker' | 'reviewer' | 'synthesizer' | 'target' | 'router' | 'executor' | 'gatekeeper'
  status: WorkbenchTurnStatus
  parentRunId?: string
  startedAt: number
  endedAt?: number
}

interface RuntimeEvent {
  id: string
  threadId: string
  turnId: string
  seq: number
  kind: string
  agentId?: string
  payload: any
  createdAt: number
}

interface WorkbenchSnapshot {
  threads: WorkbenchThread[]
  turns: WorkbenchTurn[]
  runs: AgentRunNode[]
  activeThreadId: string | null
}

interface SchedulePreview {
  preset: DispatchPreset
  label: string
  labelZh?: string
  labelEn?: string
  description: string
  descriptionZh?: string
  descriptionEn?: string
  steps: Array<{ id: string; label: string; labelZh?: string; labelEn?: string; agentId: string; role: string; mode: string; dependsOn?: string[] }>
}

interface WorkbenchCommand {
  id: string
  label: string
  description: string
  descriptionZh?: string
  descriptionEn?: string
  category: 'session' | 'agent' | 'schedule' | 'tool' | 'skill' | 'workspace' | 'ecc'
  insertText?: string
  action: 'insert' | 'new-thread' | 'clear-thread' | 'show-context' | 'open-panel' | 'run-terminal' | 'run-git' | 'use-schedule' | 'use-skill' | 'use-agent' | 'set-goal' | 'run-loop'
  source: 'builtin' | 'schedule' | 'skill' | 'local-agent' | 'ecc'
  payload?: Record<string, any>
}

interface WorkbenchGoal {
  threadId: string
  goal: string
  createdAt: number
  updatedAt: number
  loopLimit: number
  status: 'active' | 'cleared'
}

interface EccCommandStatus {
  version: number
  count: number
  source: 'bundled' | 'updated'
  updatedAt: number | null
  lastError?: string
}

interface LocalSkillCandidate {
  id: string
  name: string
  description: string
  instructions: string
  tags: string[]
  category?: { id: string; label: string }
  sourcePath: string
  agentSource: string
}

interface McpServerConfig {
  id: string
  name: string
  source: 'user' | 'workspace' | 'local' | 'ecc' | 'kun' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'ccgui'
  enabled: boolean
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  cwd?: string
  url?: string
  timeoutMs?: number
  trustScope?: string
  trustedWorkspaceRoots?: string[]
  sourcePath?: string
  status?: 'unknown' | 'ok' | 'error'
  error?: string
}

type UsageRange = 'all' | '90d' | '30d' | '7d'
type UsageView = 'overview' | 'models' | 'requests' | 'providers' | 'pricing'
type UsageSource = 'actual' | 'estimated' | 'none'

interface UsageHeatmapDay {
  date: string
  turns: number
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheSavingsTokens: number
  costUsd: number | null
  hasUnpriced: boolean
  level: 0 | 1 | 2 | 3 | 4
  selected?: boolean
}

interface UsageModelRow {
  modelId: string
  providerId?: string
  agentId?: string
  turns: number
  requests: number
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheSavingsTokens: number
  costUsd: number | null
  hasUnpriced: boolean
}

interface UsageProviderRow {
  providerId: string
  turns: number
  requests: number
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheSavingsTokens: number
  costUsd: number | null
  hasUnpriced: boolean
}

interface UsageRequestRecord {
  id: string
  eventId: string
  threadId: string
  turnId: string
  agentId?: string
  providerId: string
  modelId: string
  requestModelId?: string
  source: UsageSource
  status: 'completed' | 'failed' | 'cancelled'
  createdAt: number
  latencyMs?: number
  firstTokenMs?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  billableInputTokens: number
  totalTokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  reasoningTokens?: number
  costUsd: number | null
  hasUnpriced: boolean
  promptPreview?: string
  responsePreview?: string
  errorMessage?: string
  rawUsage?: any
}

interface UsagePricingRule {
  id: string
  providerId?: string
  modelId: string
  displayName?: string
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  cacheReadUsdPerMillion?: number
  cacheCreationUsdPerMillion?: number
  createdAt: number
  updatedAt: number
}

interface UsageRecordFilter {
  range?: UsageRange
  from?: number
  to?: number
  providerId?: string
  modelId?: string
  agentId?: string
  source?: UsageSource | 'all'
  status?: 'completed' | 'failed' | 'cancelled' | 'all'
  query?: string
  sortBy?: 'createdAt' | 'tokens' | 'cost' | 'latencyMs'
  sortDir?: 'asc' | 'desc'
}

interface PaginatedUsageRecords {
  records: UsageRequestRecord[]
  total: number
  page: number
  pageSize: number
}

interface UsageStats {
  range: UsageRange
  view: UsageView
  sessions: number
  messages: number
  totalTokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheSavingsTokens: number
  billableInputTokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  cost: number | null
  costUsd: number | null
  hasUnpriced: boolean
  cacheSavings: number | null
  contextSavings: number | null
  cacheRate: number | null
  requests: number
  heatmap: UsageHeatmapDay[]
  models: UsageModelRow[]
  providers: UsageProviderRow[]
}

interface TerminalRun {
  id: string
  workspaceId: string | null
  command: string
  cwd: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  stdout: string
  stderr: string
  exitCode: number | null
  createdAt: number
  completedAt?: number
}

interface GitStatus {
  workspaceId: string | null
  rootPath: string | null
  isRepo: boolean
  branch: string
  upstream?: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  stagedFiles: GitFileStatus[]
  unstagedFiles: GitFileStatus[]
  totalAdditions: number
  totalDeletions: number
  error?: string
}

interface GitFileStatus {
  path: string
  status: string
  index: string
  workingTree: string
  additions: number
  deletions: number
  oldPath?: string
  isDiffOnlyFallback?: boolean
  mutationDisabled?: boolean
}

interface GitBranch {
  name: string
  current: boolean
  isCurrent?: boolean
  isRemote?: boolean
  remote?: string | null
  upstream?: string | null
  lastCommit?: number
  headSha?: string | null
  ahead?: number
  behind?: number
}

interface GitBranchListResponse {
  branches: Array<Pick<GitBranch, "name" | "current">>
  localBranches: GitBranch[]
  remoteBranches: GitBranch[]
  currentBranch: string | null
  repositoryState: "git_repository" | "not_git_repository" | "unknown"
  diagnostic?: { kind: string; reason?: string | null; message?: string | null; workspaceId?: string | null; pathKind?: string | null } | null
}

interface GitLogEntry {
  sha: string
  shortSha: string
  hash: string
  summary: string
  message: string
  author: string
  authorEmail?: string
  timestamp: number
  date: string
}

interface GitLogResponse {
  total: number
  entries: GitLogEntry[]
  ahead: number
  behind: number
  aheadEntries: GitLogEntry[]
  behindEntries: GitLogEntry[]
  upstream: string | null
}

interface GitFileDiff {
  path: string
  status?: string
  diff: string
  isBinary?: boolean
  isImage?: boolean
  isDiffOnlyFallback?: boolean
  oldImageData?: string | null
  newImageData?: string | null
  oldImageMime?: string | null
  newImageMime?: string | null
}

interface GitCommitDiff {
  path: string
  status: string
  diff: string
  isBinary?: boolean
  isImage?: boolean
  oldImageData?: string | null
  newImageData?: string | null
  oldImageMime?: string | null
  newImageMime?: string | null
}

interface GitCommitDetails {
  sha: string
  shortSha: string
  summary: string
  message: string
  author: string
  authorEmail: string
  committer: string
  committerEmail: string
  authorTime: number
  commitTime: number
  parents: string[]
  files: Array<{ path: string; oldPath?: string | null; status: string; additions: number; deletions: number; isBinary?: boolean; isImage?: boolean; diff: string; lineCount: number; truncated: boolean }>
  totalAdditions: number
  totalDeletions: number
}

interface WorktreeItem {
  id: string
  parentWorkspaceId: string
  path: string
  branch: string
  status: 'clean' | 'dirty' | 'missing'
  createdAt: number
}

interface BrowserSession {
  id: string
  workspaceId: string | null
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
}

interface BrowserContextAttachment {
  url: string
  title: string
  text: string
  headings: string[]
  links: Array<{ text: string; href: string }>
  forms: string[]
  capturedAt: number
}

type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

interface ThreadTodo {
  id: string
  threadId: string
  content: string
  status: ThreadTodoStatus
  source?: any
  updatedAt: number
}

interface UpdateStatus {
  version: string
  channel: 'stable' | 'preview'
  checking: boolean
  latestVersion?: string
  downloadUrl?: string
  error?: string
  checkedAt?: number
}

interface LocalAgentStatus {
  agentId: string
  label: string
  installed: boolean
  configured: boolean
  protocol?: string
  binary?: string
  args?: string
  version?: string
  manualOnly?: boolean
  candidateKind?: 'cli' | 'desktop'
  requiresPromptArg?: boolean
  note?: string
  loginState: 'unknown' | 'ready' | 'needs-login' | 'not-installed'
  candidates: Array<{ source: 'desktop' | 'terminal'; label: string; path: string }>
  workspaceSession: 'per-dispatch' | 'persistent'
  error?: string
}

type WorkflowStepType = 'prompt' | 'agent' | 'skill' | 'review' | 'gate'

interface WorkflowStep {
  id: string
  type: WorkflowStepType
  label: string
  agentId?: string
  prompt?: string
  skillId?: string
  dependsOn?: string[]
  requiresApproval?: boolean
}

interface WorkflowDefinition {
  id: string
  name: string
  description: string
  category: 'development' | 'review' | 'research' | 'deployment' | 'custom'
  steps: WorkflowStep[]
  tags: string[]
  createdAt: string
  updatedAt: string
  useCount: number
  pinned?: boolean
}

interface Window {
  electronAPI: ElectronAPI
}
