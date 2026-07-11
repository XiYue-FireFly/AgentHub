/// <reference types="vite/client" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../shared/ipc-types.ts" />

// Shared type contracts from src/shared/ipc-types.ts
// Renderer-side reference: these types mirror the main process definitions.
// ipc-types.ts is the canonical source of truth; this file provides ambient
// globals for the renderer process.

interface HubStatus {
  running: boolean
  url: string
  proxyUrl: string
  clientCount: number
  agents: Array<{
    id: string
    name: string
    status: string
    capabilities: string[]
    providerId?: string
    modelId?: string
    errorCount?: number
  }>
  tasks: Array<{
    id: string
    text: string
    mode: DispatchPreset
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    createdAt: Date
  }>
}

type AgentCapabilityLike = 'fs-read' | 'fs-write' | 'exec' | 'agentic-loop' | 'skills' | 'system-control'
type AgenticProtocolLike = 'http' | 'stdio-plain' | 'acp'
type AgenticModeLike = 'all' | 'selected'
type AgenticApprovalPolicyLike = 'allow' | 'ask' | 'deny'
type AgenticGuardedToolLike = 'write' | 'exec'
type AgenticApprovalPresetLike = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'
type TakeoverAppLike = 'codex' | 'claude' | 'hermes' | 'openclaw'

interface AgentCapabilityStateLike {
  agentId: string
  name: string
  protocol: AgenticProtocolLike
  nativeCli: boolean
  httpAgentic: boolean
  capabilities: AgentCapabilityLike[]
}

interface AgenticApprovalConfigLike {
  version: 1
  preset?: AgenticApprovalPresetLike
  default: Record<AgenticGuardedToolLike, AgenticApprovalPolicyLike>
  overrides: Record<string, Partial<Record<AgenticGuardedToolLike, AgenticApprovalPolicyLike>>>
}

interface TakeoverStateLike {
  supported: boolean
  configPath: string
  configExists: boolean
  takenOver: boolean
  model: string | null
  current: string | null
}

type TakeoverStatusResultLike = Record<TakeoverAppLike, TakeoverStateLike> | { error: string }
type TakeoverMutationResultLike = TakeoverStateLike | { ok: false; error: string }

interface ElectronAPI {
  hub: {
    getStatus: () => Promise<HubStatus>
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
    onWarning?: (callback: (warning: { providerId: string; message: string }) => void) => () => void
    onConfigChanged?: (callback: (config: ProvidersConfig) => void) => () => void
  }
  takeover: {
    status: () => Promise<TakeoverStatusResultLike>
    apply: (app: string, modelRef: string) => Promise<TakeoverMutationResultLike>
    restore: (app: string) => Promise<TakeoverMutationResultLike>
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
    info: () => Promise<{ url: string; running: boolean }>
  }
  agents: {
    locate: () => Promise<LocalAgentStatus[]>
  }
  win: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    isMaximized: () => Promise<boolean>
    close: () => Promise<void>
    onMaximized: (callback: (maximized: boolean) => void) => () => void
  }
  windows: {
    openWorkbench: () => Promise<{ id: number }>
  }
  store: {
    get: (key: string, defaultValue?: unknown) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<boolean>
  }
  memory: {
    catalog: () => Promise<MemoryCatalog>
    getSettings: () => Promise<MemorySettingsState>
    updateSettings: (patch: Partial<MemorySettingsState>) => Promise<MemorySettingsState>
    list: (category?: MemoryCategory) => Promise<MemoryEntry[]>
    search: (query: string, category?: MemoryCategory) => Promise<MemoryEntry[]>
    addEntry: (entry: MemoryEntryInput) => Promise<MemoryEntry>
    importConversation: (source: string, content: string) => Promise<MemoryEntry[]>
    listCandidates: () => Promise<MemoryEntry[]>
    approveCandidate: (id: string) => Promise<MemoryEntry | null>
    updateEntry: (id: string, patch: MemoryEntryPatch) => Promise<MemoryEntry | null>
    disableEntry: (id: string) => Promise<MemoryEntry | null>
    delete: (id: string) => Promise<boolean>
    restore: (id: string) => Promise<MemoryEntry | null>
  }
  memoryStudio: {
    scoreQuality: (entry: MemoryQualityInput) => Promise<MemoryQualityScore>
    detectConflicts: (entries: MemoryConflictEntry[]) => Promise<MemoryConflict[]>
  }
  app: {
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
    openPath: (input: { path: string; target?: 'editor' | 'antigravity' | 'explorer' | 'system' | 'vscode' | 'cursor' | 'windsurf' | 'zed' | 'file-manager'; line?: number; column?: number; workspaceRoot?: string | null }) => Promise<{ ok: boolean; path: string; target: string; error?: string }>
    resolvePath: (input: { path: string; workspaceRoot?: string | null }) => Promise<{ ok: boolean; path: string; error?: string }>
    readTextFile: (input: { path: string; workspaceRoot?: string | null }) => Promise<{ ok: boolean; path: string; content?: string; error?: string }>
    pickFolder: (options?: { defaultPath?: string }) => Promise<string | null>
    pickFiles: (options?: { defaultPath?: string }) => Promise<string[] | null>
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
    onMenuCommand: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
  }
  workspaces: {
    list: () => Promise<WorkbenchWorkspace[]>
    create: (input: WorkbenchWorkspaceCreateInput) => Promise<WorkbenchWorkspace>
    update: (id: string, patch: WorkbenchWorkspaceUpdatePatch) => Promise<WorkbenchWorkspace>
    remove: (id: string) => Promise<boolean>
    getActive: () => Promise<string | null>
    setActive: (id: string | null) => Promise<string | null>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
  }
  threads: {
    list: (workspaceId?: string | null) => Promise<WorkbenchThread[]>
    create: (input: ThreadCreateInput) => Promise<WorkbenchThread>
    rename: (threadId: string, title: string) => Promise<WorkbenchThread>
    delete: (threadId: string) => Promise<boolean>
    select: (threadId: string | null) => Promise<string | null>
    fork: (input: ThreadForkInput) => Promise<WorkbenchThread>
  }
  turns: {
    create: (input: TurnCreateInput) => Promise<TurnCreateResult>
    cancel: (turnId: string) => Promise<boolean>
    cancelAgent: (turnId: string, agentId: string) => Promise<boolean>
    resolveGuard: (requestId: string, approved: boolean) => Promise<boolean>
    retry: (turnId: string) => Promise<TurnCreateResult>
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
    options: () => Promise<Array<{ agentId: string; label: string; status: 'idle' | 'busy' | 'error' | 'off'; installed: boolean; configured: boolean }>>
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
  terminalPty: {
    create: (payload: { sessionId: string; cwd?: string; cols?: number; rows?: number }) => Promise<{ ok: boolean; message?: string; reattached?: boolean }>
    write: (payload: { sessionId: string; data: string }) => Promise<void>
    resize: (payload: { sessionId: string; cols: number; rows: number }) => Promise<void>
    dispose: (sessionId: string) => Promise<void>
    onData: (handler: (payload: { sessionId: string; data: string }) => void) => () => void
    onExit: (handler: (payload: { sessionId: string; exitCode: number }) => void) => () => void
  }
  tasks: {
    delete: (taskId: string) => Promise<boolean>
    clearCompleted: (workspaceId?: string | null) => Promise<boolean>
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
    listTools: (id: string, workspaceId?: string | null) => Promise<McpServerToolsResult>
    // MCP 系统级控制配置
    getSystemConfig: () => Promise<McpSystemConfig>
    setSystemConfig: (config: Partial<McpSystemConfig>) => Promise<void>
    setSystemEnabled: (enabled: boolean) => Promise<void>
  }
  worktrees: {
    list: (parentWorkspaceId?: string | null) => Promise<WorktreeItem[]>
    create: (input: { parentWorkspaceId: string; branch?: string; path?: string }) => Promise<WorktreeItem>
    remove: (id: string, force?: boolean) => Promise<boolean>
    sync: (id: string) => Promise<WorktreeItem>
    open: (id: string) => Promise<WorkbenchWorkspace>
  }
  todos: {
    list: (threadId: string) => Promise<ThreadTodo[]>
    set: (threadId: string, todos: ThreadTodoSetInput) => Promise<ThreadTodo[]>
    upsert: (input: { threadId: string; id?: string; content: string; status?: ThreadTodoStatus; source?: ThreadTodoSource }) => Promise<ThreadTodo>
    delete: (threadId: string, todoId: string) => Promise<boolean>
    clear: (threadId: string) => Promise<boolean>
    syncFromMarkdown: (threadId: string, markdown: string, sourceContext?: ThreadTodoSyncSourceContext) => Promise<ThreadTodo[]>
  }
  updates: {
    status: () => Promise<UpdateStatus>
    check: (channel?: 'stable' | 'preview') => Promise<UpdateStatus>
    setChannel: (channel: 'stable' | 'preview') => Promise<UpdateStatus>
    download: () => Promise<UpdateStatus>
    install: () => Promise<UpdateStatus>
    openDownload: () => Promise<void>
  }
  browser: {
    open: (input: { workspaceId?: string | null; url?: string }) => Promise<BrowserSession>
    capture: (attachment: Partial<BrowserContextAttachment>) => Promise<BrowserContextAttachment>
    summarize: (snapshot: BrowserPageSnapshot) => Promise<string>
    extractText: (html: string) => Promise<string>
    analyzePrompt: (snapshot: BrowserPageSnapshot, request?: string) => Promise<string>
  }
  usage: {
    stats: (range?: UsageRange, view?: UsageView) => Promise<UsageStats>
    records: (filter?: UsageRecordFilter, page?: number, pageSize?: number) => Promise<PaginatedUsageRecords>
    recordDetail: (id: string) => Promise<UsageRequestRecord | null>
    pricingList: () => Promise<UsagePricingRule[]>
    pricingUpsert: (rule: Partial<UsagePricingRule> & { modelId: string }) => Promise<UsagePricingRule>
    pricingDelete: (idOrModelId: string, providerId?: string) => Promise<boolean>
  }
  budget: {
    get: () => Promise<BudgetConfig>
    update: (patch: Partial<BudgetConfig>) => Promise<BudgetConfig>
    check: (dailySpent: number, monthlySpent: number, requestTokens: number, requestCostUsd?: number) => Promise<BudgetCheckResult>
    estimateDispatch: (input: TurnCreateInput) => Promise<BudgetEstimate>
  }
  goals: {
    get: (threadId?: string | null) => Promise<WorkbenchGoal | null>
    set: (threadId: string, goal: string, loopLimit?: number) => Promise<WorkbenchGoal>
    clear: (threadId: string) => Promise<WorkbenchGoal | null>
  }
  // --- AgentHub skills + native agentic (Claude-B 新增) ---
  skills: {
    list: () => Promise<SkillDef[]>
    builtins: () => Promise<SkillInput[]>
    scanLocal: () => Promise<LocalSkillCandidate[]>
    importLocal: (sourcePath: string) => Promise<SkillDef>
    refreshLocal: () => Promise<LocalSkillCandidate[]>
    add: (input: SkillInput) => Promise<SkillDef>
    update: (id: string, patch: Partial<SkillInput>) => Promise<SkillDef | undefined>
    remove: (id: string) => Promise<boolean>
    getInstalls: () => Promise<SkillInstalls>
    install: (agentId: string, skillId: string) => Promise<SkillInstalls>
    uninstall: (agentId: string, skillId: string) => Promise<SkillInstalls>
  }
  agentic: {
    capabilities: () => Promise<AgentCapabilityStateLike[]>
    getEnabled: () => Promise<string[]>
    setEnabled: (agentId: string, on: boolean) => Promise<string[]>
    getMode: () => Promise<AgenticModeLike>
    setMode: (mode: AgenticModeLike) => Promise<AgenticModeLike>
    getApprovalConfig: () => Promise<AgenticApprovalConfigLike>
    getPendingApprovalIds: () => Promise<string[]>
    setApprovalPreset: (preset: AgenticApprovalPresetLike) => Promise<AgenticApprovalConfigLike>
    setApprovalDefault: (tool: AgenticGuardedToolLike, policy: AgenticApprovalPolicyLike) => Promise<AgenticApprovalConfigLike>
    setApprovalOverride: (agentId: string, tool: AgenticGuardedToolLike, policy: AgenticApprovalPolicyLike | null) => Promise<AgenticApprovalConfigLike>
    resolveApproval: (requestId: string, approved: boolean) => Promise<boolean>
  }
  prompts: {
    list: (category?: PromptCategory) => Promise<PromptEntry[]>
    get: (id: string) => Promise<PromptEntry | null>
    upsert: (input: PromptUpsertInput) => Promise<PromptEntry>
    delete: (id: string) => Promise<boolean>
    search: (query: string) => Promise<PromptEntry[]>
    slashCommands: () => Promise<PromptEntry[]>
    incrementUse: (id: string) => Promise<void>
    seedDefaults: () => Promise<void>
  }
  shortcuts: {
    list: (category?: ShortcutCategory) => Promise<ShortcutBinding[]>
    get: (id: string) => Promise<ShortcutBinding | null>
    update: (id: string, key: string) => Promise<ShortcutBinding | null>
    reset: (id: string) => Promise<ShortcutBinding | null>
    resetAll: () => Promise<void>
    conflicts: () => Promise<ShortcutConflict[]>
  }
  diagnostics: {
    run: () => Promise<LegacyDiagnosticSuite>
    logPath: () => Promise<{ path: string }>
    recentLogs: (limit?: number) => Promise<RecentAppEventLogs>
  }
  diagnosticsSuite: {
    run: () => Promise<DiagnosticReport>
  }
  backup: {
    create: () => Promise<BackupCreateResult>
    list: () => Promise<BackupMeta[]>
    restore: (filename: string) => Promise<BackupRestoreResult>
    delete: (filename: string) => Promise<boolean>
  }
  sync: {
    export: (passphrase: string) => Promise<{ ok: boolean; filename?: string; path?: string; keys?: string[]; error?: string }>
    list: () => Promise<Array<{ filename: string; createdAt: string; sizeBytes: number; keys: string[] }>>
    preview: (filename: string) => Promise<{ ok: boolean; keys?: string[]; createdAt?: string; appVersion?: string; error?: string }>
    import: (filename: string, passphrase: string) => Promise<{ ok: boolean; restored?: string[]; error?: string }>
    delete: (filename: string) => Promise<boolean>
    webdavGetConfig: () => Promise<{ url: string; username: string; passwordSet: boolean; remoteFileName?: string; enabled?: boolean; autoSyncMinutes?: number }>
    webdavSetConfig: (config: { url: string; username: string; password?: string; remoteFileName?: string; enabled?: boolean; autoSyncMinutes?: number }) => Promise<{ url: string; username: string; passwordSet: boolean; remoteFileName?: string; enabled?: boolean; autoSyncMinutes?: number }>
    webdavTest: (config?: { url?: string; username?: string; password?: string; remoteFileName?: string }) => Promise<{ ok: boolean; status?: number; error?: string; remoteUrl?: string }>
    webdavPush: (passphrase: string, config?: { url?: string; username?: string; password?: string }) => Promise<{ ok: boolean; error?: string; keys?: string[]; remoteUrl?: string }>
    webdavPull: (passphrase: string, config?: { url?: string; username?: string; password?: string }) => Promise<{ ok: boolean; error?: string; restored?: string[]; remoteUrl?: string }>
  }
  conversation: {
    exportMarkdown: (data: ConversationExportData) => Promise<string>
    exportHtml: (data: ConversationExportData) => Promise<string>
    exportFile: (data: ConversationExportData, format: ConversationExportFormat, path: string) => Promise<ConversationExportFileResult>
  }
  conversationImport: {
    importFile: (filePath: string) => Promise<ConversationImportResult>
    importJson: (json: string) => Promise<ConversationImportResult>
    branch: (conversation: ImportedConversation, index: number) => Promise<ConversationBranchResult>
    summarize: (conversation: ImportedConversation) => Promise<ConversationSummary>
  }
  notifications: {
    list: (unreadOnly?: boolean) => Promise<AppNotification[]>
    unreadCount: () => Promise<number>
    push: (input: AppNotificationInput) => Promise<AppNotification>
    markRead: (id: string) => Promise<boolean>
    markAllRead: () => Promise<number>
    delete: (id: string) => Promise<boolean>
    clearAll: () => Promise<void>
  }
  onboarding: {
    getState: () => Promise<OnboardingState>
    shouldShow: () => Promise<boolean>
    completeStep: (step: OnboardingStep, skipped?: boolean) => Promise<OnboardingState>
    skipAll: () => Promise<void>
    reset: () => Promise<void>
    nextStep: () => Promise<OnboardingStep | null>
  }
  workspaceFiles: {
    list: (rootPath: string, max?: number) => Promise<Array<{ path: string; relativePath: string; name: string; extension: string; isDirectory: boolean; sizeBytes: number }>>
    search: (rootPath: string, query: string, max?: number) => Promise<Array<{ path: string; relativePath: string; name: string; extension: string; isDirectory: boolean; sizeBytes: number }>>
    preview: (filePath: string, maxLines?: number) => Promise<{ ok: boolean; content?: string; error?: string }>
    read: (workspaceRoot: string, relPath: string) => Promise<{ ok: boolean; content: string; path: string; error?: string }>
    write: (workspaceRoot: string, relPath: string, content: string) => Promise<{ ok: boolean; error?: string }>
    readImage: (workspaceRoot: string, relPath: string) => Promise<{ ok: boolean; dataUrl: string; mimeType: string; size: number; error?: string }>
    listDirectory: (workspaceRoot: string, relPath: string) => Promise<{ ok: boolean; entries: Array<{ name: string; type: 'file' | 'directory'; path: string }>; error?: string }>
  }
  github: {
    checkCli: () => Promise<GitHubCliStatus>
    listPrs: (state?: GitHubListState, limit?: number) => Promise<GitHubPr[]>
    listIssues: (state?: GitHubListState, limit?: number) => Promise<GitHubIssue[]>
    currentBranchPr: () => Promise<GitHubCurrentBranchPr>
  }
  workflows: {
    list: (category?: string) => Promise<WorkflowDefinition[]>
    get: (id: string) => Promise<WorkflowDefinition | null>
    upsert: (input: Partial<WorkflowDefinition> & { name: string; steps: WorkflowStep[] }) => Promise<WorkflowDefinition>
    delete: (id: string) => Promise<boolean>
    search: (query: string) => Promise<WorkflowDefinition[]>
    seed: () => Promise<WorkflowDefinition[]>
  }
  slashCommands: {
    list: () => Promise<SlashCommand[]>
    get: (shortcut: string) => Promise<SlashCommand | null>
    save: (input: SlashCommandSaveInput) => Promise<SlashCommandSaveResult>
    delete: (shortcut: string) => Promise<boolean>
    resolve: (shortcut: string, params: Record<string, string>) => Promise<SlashCommandResolveResult>
    validate: (shortcut: string) => Promise<SlashCommandValidationResult>
    conflict: (shortcut: string) => Promise<SlashCommandConflictResult>
  }
  workflowCenter: {
    substituteVars: (template: string, vars: WorkflowVariable[]) => Promise<string>
    evaluateCondition: (condition: string, vars: WorkflowVariable[]) => Promise<boolean>
    saveRun: (record: WorkflowRunRecord) => Promise<boolean>
    runHistory: () => Promise<WorkflowRunRecord[]>
    runHistoryFor: (workflowId: string) => Promise<WorkflowRunRecord[]>
  }
  teams: {
    list: () => Promise<TeamPreset[]>
    save: (input: TeamPresetSaveInput) => Promise<TeamPreset>
    delete: (id: string) => Promise<boolean>
    defaultFirefly: (agentIds: string[]) => Promise<TeamMember[]>
  }
  projectKnowledge: {
    detectTechStack: (rootPath: string) => Promise<DetectedTechStack>
    generateSummary: (rootPath: string, entries: ProjectKnowledgeEntry[]) => Promise<string>
  }
  inlineEdit: {
    buildPrompt: (request: InlineEditRequest) => Promise<string>
    validate: (original: string, replacement: string) => Promise<InlineEditValidationResult>
    apply: (content: string, startLine: number, endLine: number, replacement: string) => Promise<InlineEditApplyResult>
  }
  terminalAi: {
    buildPrompt: (userPrompt: string, context: TerminalContext) => Promise<string>
    suggestCommand: (intent: string, context: TerminalContext) => Promise<string>
    explainOutput: (context: TerminalContext) => Promise<string>
  }
  ai: {
    quickComplete: (input: QuickCompleteInputLike) => Promise<QuickCompleteResultLike>
  }
  models: {
    list: (providers?: ProviderForModelList[]) => Promise<ModelRouteInfo[]>
    routeSettingsGet: () => Promise<ModelRouteSettings>
    routeSettingsSet: (patch: Partial<ModelRouteSettings>) => Promise<ModelRouteSettings>
    updateRoute: (providerId: string, modelId: string, patch: ModelRoutePatch) => Promise<ProviderModel | null>
    test: (input: ModelRouteTestInput) => Promise<ModelRouteTestResult>
    exportCodexCatalog: () => Promise<CodexCatalogExportResult>
    toggleFavorite: (providerId: string, modelId: string) => Promise<boolean>
    toggleHidden: (providerId: string, modelId: string) => Promise<boolean>
    favorites: () => Promise<string[]>
    hidden: () => Promise<string[]>
  }
  memoryGraph: {
    build: (entries: MemoryEntry[]) => Promise<MemoryGraph>
    cleanupSuggestions: (graph: MemoryGraph) => Promise<MemoryGraphNode[]>
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
    marketplaceList: (registryUrl?: string) => Promise<{ ok: boolean; plugins: any[]; error?: string; source?: string }>
    marketplaceInstall: (pluginId: string, options?: { requireSignature?: boolean; registryUrl?: string }) => Promise<{ ok: boolean; error?: string; plugin?: any; plugins?: any[] }>
    trustList: () => Promise<Array<{ id: string; name?: string; publicKeyPem: string; addedAt?: string }>>
    trustAdd: (publisher: { id: string; name?: string; publicKeyPem: string }) => Promise<Array<{ id: string; name?: string; publicKeyPem: string; addedAt?: string }>>
    trustRemove: (id: string) => Promise<Array<{ id: string; name?: string; publicKeyPem: string; addedAt?: string }>>
  }
  projectMap: {
    build: (rootPath: string, maxDepth?: number) => Promise<ProjectMap | null>
    search: (map: ProjectMap, query: string) => Promise<ProjectNode[]>
  }
  release: {
    checks: () => Promise<ReleaseReport>
  }
  agentLoop: {
    getConfig: () => Promise<AgentLoopConfig>
    getStatus: () => Promise<AgentLoopStatus>
    getAgents: () => Promise<AgentLoopAgent[]>
    refreshAgents: () => Promise<AgentLoopAgent[]>
    getRouteInfo: (prompt: string) => Promise<AgentLoopRouteInfo>
  }
  sdd: {
    createDraft: (workspaceRoot: string, title: string, template?: string) => Promise<SddDraft>
    getDraft: (workspaceRoot: string, draftId: string) => Promise<SddDraft | null>
    updateDraft: (workspaceRoot: string, draftId: string, content: string, designContext?: SddDesignContext) => Promise<void>
    updateDesignContext: (workspaceRoot: string, draftId: string, designContext: SddDesignContext) => Promise<void>
    deleteDraft: (workspaceRoot: string, draftId: string) => Promise<void>
    listDrafts: (workspaceRoot: string) => Promise<SddDraftMeta[]>
    parseBlocks: (content: string) => Promise<SddRequirementBlock[]>
    parsePlanCovers: (planMarkdown: string) => Promise<SddPlanItem[]>
    computeTrace: (workspaceRoot: string, draftId: string, planMarkdown?: string) => Promise<SddTrace | null>
    saveTrace: (workspaceRoot: string, draftId: string, trace: SddTrace) => Promise<void>
    getTrace: (workspaceRoot: string, draftId: string) => Promise<SddTrace | null>
    getHistory: (workspaceRoot: string, draftId: string) => Promise<SddDraftHistoryEntry[]>
    saveHistory: (workspaceRoot: string, draftId: string, entries: SddDraftHistoryEntry[]) => Promise<void>
    clearHistory: (workspaceRoot: string, draftId: string) => Promise<void>
    exists: (workspaceRoot: string, draftId: string) => Promise<boolean>
  }
  firefly: {
    createState: () => Promise<FireflyState>
    completeRole: (state: FireflyState, role: FireflyRole, output: string) => Promise<FireflyState>
    getRoleContext: (state: FireflyState, role: FireflyRole, prompt: string, memory?: string, project?: string) => Promise<FireflyRoleContext>
    isComplete: (state: FireflyState) => Promise<boolean>
    getOutput: (state: FireflyState) => Promise<string | null>
    listTemplates: () => Promise<Array<{
      id: string
      name: string
      version: number
      description?: string
      roles: string[]
      schedule: { nodes: Array<{ id: string; role: string; label: string }>; edges: Array<{ from: string; to: string }> }
      defaultMode: string
    }>>
    getTemplate: (id: string) => Promise<{
      id: string
      name: string
      version: number
      description?: string
      roles: string[]
      schedule: { nodes: Array<{ id: string; role: string; label: string }>; edges: Array<{ from: string; to: string }> }
      defaultMode: string
    } | null>
  }
  platform: string
}

type WorkbenchTurnStatus = import('../shared/turn-status').WorkbenchTurnStatus
type DispatchPreset = 'auto' | 'broadcast' | 'chain' | 'orchestrate' | 'lead-workers' | 'parallel-review' | 'firefly-custom' | 'custom'
type MemoryCategory = 'conversation' | 'task' | 'skill' | 'file' | 'system' | 'preference' | 'project' | 'style' | 'decision' | 'correction' | 'imported_conversation'
type MemoryEntryStatus = 'candidate' | 'approved' | 'disabled'

interface MemoryEntryInput {
  id?: string
  category: MemoryCategory
  title: string
  summary?: string
  content?: string
  source?: string
  tags?: string[]
  status?: MemoryEntryStatus
  confidence?: number
  metadata?: Record<string, unknown>
}

type MemoryEntryPatch = Partial<MemoryEntryInput>

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
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt?: string
  disabledAt?: string
}

interface MemorySettingsState {
  enabled: boolean
}

interface MemoryCatalog {
  version: 1
  root: string
  entries: MemoryEntry[]
  counts: Record<MemoryCategory, number>
  settings: MemorySettingsState
  runtimeUpdatedAt?: string
}

interface MemoryGraphNode {
  id: string
  label: string
  category: string
  status: string
  pinned: boolean
  useCount: number
  importance: number
  tags: string[]
}

interface MemoryGraphEdge {
  source: string
  target: string
  type: 'tag' | 'category' | 'similarity'
  weight: number
  label?: string
}

interface MemoryGraph {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  stats: {
    totalNodes: number
    totalEdges: number
    isolatedNodes: number
    categories: Record<string, number>
  }
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

type ModelReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

interface ProviderModel {
  id: string
  label: string
  contextWindow?: number
  enabled?: boolean
  upstreamModel?: string
  timeoutMs?: number
  retryCount?: number
  reasoningEnabled?: boolean
  defaultReasoningLevel?: string
  supportedReasoningLevels?: string[]
  codexAlias?: string
  description?: string
  supportsTools?: boolean
  supportsVision?: boolean
  supportsThinking?: boolean
}

interface ProviderForModelList {
  id: string
  name: string
  kind?: string
  enabled: boolean
  apiKey?: string
  apiKeyLocked?: boolean
  protocolOverride?: string
  capabilities?: { protocol?: string }
  models: ProviderModel[]
}

interface ModelRouteInfo {
  providerId: string
  providerName: string
  providerEnabled: boolean
  providerHasKey: boolean
  providerKeyLocked?: boolean
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

interface ModelRoutePatch {
  enabled?: boolean
  upstreamModel?: string
  timeoutMs?: number
  retryCount?: number
  reasoningEnabled?: boolean
  defaultReasoningLevel?: ModelReasoningLevel
  supportedReasoningLevels?: ModelReasoningLevel[]
  codexAlias?: string
  description?: string
}

interface ModelRouteSettings {
  fallbackModelId?: string
  codexDefaultModel?: string
  codexInjectionMode: 'official_account' | 'third_party_api' | 'lan_share'
  codexInternalModelLock: boolean
  codexSlots: Array<{ slot: string; targetModelId: string; mode: 'official_account' | 'third_party_api' | 'lan_share'; source: string }>
}

interface ModelRouteTestInput {
  providerId: string
  modelId: string
  upstreamModel?: string
}

interface ModelRouteTestResult {
  ok: boolean
  providerId: string
  modelId: string
  upstreamModel?: string
  routeReason?: string
  latencyMs: number
  usage?: unknown
  contentPreview?: string
  error?: string
}

interface CodexCatalogExportResult {
  ok: boolean
  path?: string
  content: string
  count: number
  error?: string
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
  result: string | null
  error?: string
}

interface ThreadCreateInput {
  workspaceId?: string | null
  title?: string
}

interface ThreadForkInput {
  sourceThreadId: string
  sourceTurnId: string
  message: string
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

interface TurnCreateInput {
  threadId?: string | null
  workspaceId?: string | null
  prompt: string
  mode?: DispatchPreset
  targetAgent?: string | null
  thinking?: unknown
  modelSelection?: ModelSelection
  attachments?: WorkbenchAttachment[]
  customSchedule?: SchedulePreview
}

interface TurnCreateResult {
  thread: WorkbenchThread
  turn: WorkbenchTurn
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
  ts?: number  // 别名，用于向后兼容
}

interface WorkbenchSnapshot {
  threads: WorkbenchThread[]
  turns: WorkbenchTurn[]
  runs: AgentRunNode[]
  hiddenTaskTurnIds?: string[]
  activeThreadId: string | null
}

type ScheduleArtifactMode = 'summary' | 'full' | 'files' | 'custom'
type ScheduleApprovalPolicy = 'inherit' | 'auto' | 'ask' | 'require' | 'skip'

interface ScheduleGraphNode {
  id: string
  label: string
  agentId: string
  role: string
  mode: string
  promptTemplate?: string
  approvalPolicy?: ScheduleApprovalPolicy
}

interface ScheduleGraphEdge {
  id: string
  from: string
  to: string
  artifactMode: ScheduleArtifactMode
}

interface ScheduleGraph {
  version: 1
  nodes: ScheduleGraphNode[]
  edges: ScheduleGraphEdge[]
  layout: Record<string, { x: number; y: number }>
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
  graph?: ScheduleGraph
}

interface WorkbenchCommand {
  id: string
  label: string
  description: string
  descriptionZh?: string
  descriptionEn?: string
  category: 'session' | 'agent' | 'schedule' | 'tool' | 'skill' | 'workspace' | 'ecc' | 'plugin'
  insertText?: string
  action: 'insert' | 'new-thread' | 'clear-thread' | 'show-context' | 'open-panel' | 'run-terminal' | 'run-git' | 'use-schedule' | 'use-skill' | 'use-agent' | 'set-goal' | 'run-loop'
  source: 'builtin' | 'schedule' | 'skill' | 'local-agent' | 'ecc' | 'plugin'
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

interface SkillCategory {
  id: string
  label: string
}

type SkillCategoryInput = string | Partial<SkillCategory> | null | undefined

interface SkillDef {
  id: string
  name: string
  category: SkillCategory
  description: string
  instructions: string
  tags: string[]
  source: string
  createdAt: number
  updatedAt: number
}

interface SkillInput {
  name: string
  category?: SkillCategoryInput
  description?: string
  instructions: string
  tags?: string[]
  source?: string
}

type SkillInstalls = Record<string, string[]>

interface WorkbenchWorkspace {
  id: string
  name: string
  rootPath: string
  bootstrapFiles?: string[]
  createdAt: number
  updatedAt: number
}

interface WorkbenchWorkspaceCreateInput {
  name: string
  rootPath: string
}

interface WorkbenchWorkspaceUpdatePatch {
  name?: string
  rootPath?: string
  bootstrapFiles?: string[]
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

interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

interface McpServerToolsResult {
  ok: boolean
  tools: McpToolInfo[]
  error?: string
  resources?: number
  prompts?: number
}

interface McpSystemConfig {
  version: number
  enabled: boolean
  allowedCategories: ('read' | 'write' | 'exec')[]
  defaultPolicy: 'allow' | 'ask' | 'deny'
  timeoutMs: number
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
  cacheSavingsUsd: number | null
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
  cacheSavingsUsd: number | null
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
  cacheSavingsUsd: number | null
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
  inputSurfaceTokens?: number
  totalTokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  reasoningTokens?: number
  cacheHitRate?: number | null
  costUsd: number | null
  hasUnpriced: boolean
  cacheSavingsUsd: number | null
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
  threadId?: string
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
  cacheSavingsUsd: number | null
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

type ShortcutCategory = 'navigation' | 'action' | 'editor' | 'agent'

interface ShortcutBinding {
  id: string
  label: string
  labelZh: string
  defaultKey: string
  key: string
  category: ShortcutCategory
  system: boolean
}

interface ShortcutConflict {
  key: string
  ids: string[]
}

type AppNotificationCategory = 'task' | 'approval' | 'mcp' | 'system' | 'workflow' | 'memory' | 'error'

type AppNotificationAction =
  | { type: 'navigate'; target: string }
  | { type: 'open-url'; url: string }

interface AppNotification {
  id: string
  title: string
  body: string
  category: AppNotificationCategory
  read: boolean
  action?: AppNotificationAction
  createdAt: string
}

type AppNotificationInput = Omit<AppNotification, 'id' | 'read' | 'createdAt'>

type OnboardingStep =
  | 'select-language'
  | 'bind-provider'
  | 'detect-agents'
  | 'choose-default-agent'
  | 'test-mcp'
  | 'enable-skills'
  | 'create-workspace'
  | 'send-first-message'

interface OnboardingState {
  version: 1
  completed: boolean
  completedAt?: string
  completedSteps: OnboardingStep[]
  skippedSteps: OnboardingStep[]
}

interface BackupMeta {
  id: string
  filename: string
  createdAt: string
  sizeBytes: number
  keys: string[]
  version: string
}

type BackupCreateResult = BackupMeta & { error?: string }

interface BackupRestoreResult {
  restored: string[]
  error?: string
}

type ConversationMessageRole = 'user' | 'assistant' | 'system' | 'tool'
type ConversationExportFormat = 'markdown' | 'json' | 'html'

interface ConversationToolCall {
  name: string
  args?: string
  result?: string
}

interface ConversationExportMessage {
  role: ConversationMessageRole
  content: string
  agentId?: string
  timestamp?: string
  toolCalls?: ConversationToolCall[]
  thinking?: string
  attachments?: Array<{ name: string; kind: string }>
}

interface ConversationExportData {
  version: 1
  title: string
  exportedAt: string
  messages: ConversationExportMessage[]
  metadata?: {
    workspaceId?: string
    agentIds?: string[]
    turnCount?: number
  }
}

interface ConversationExportFileResult {
  ok: boolean
  path: string
  error?: string
}

interface ImportedConversationMessage {
  role: ConversationMessageRole
  content: string
  agentId?: string
  timestamp?: string
  toolCalls?: ConversationToolCall[]
  thinking?: string
}

interface ImportedConversation {
  version: number
  title: string
  exportedAt?: string
  messages: ImportedConversationMessage[]
  metadata?: Record<string, unknown>
}

interface ConversationImportResult {
  ok: boolean
  conversation?: ImportedConversation
  messageCount?: number
  error?: string
  warnings?: string[]
}

interface ConversationBranchResult {
  ok: boolean
  messages?: ImportedConversationMessage[]
  error?: string
}

interface ConversationSummary {
  title: string
  messageCount: number
  userMessages: number
  assistantMessages: number
  agentIds: string[]
  firstMessage: string
  lastMessage: string
}

type AgentLoopMode = 'auto' | 'single'

interface AgentLoopConfig {
  maxSteps: number
  timeoutMs: number
  enableDelegation: boolean
  mode: AgentLoopMode
}

interface AgentLoopStatus {
  available: boolean
  activeTasks: number
}

interface AgentLoopAgent {
  id: string
  name: string
  role: string
  capabilities: string[]
  version?: string
  path?: string
}

interface AgentLoopRouteInfo {
  taskType: string
  selectedAgent: string
  confidence: number
  reasoning: string
  suggestedRole: string
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

interface BrowserPageSnapshot {
  url: string
  title: string
  textContent: string
  meta: {
    description?: string
    keywords?: string[]
    ogTitle?: string
    ogDescription?: string
  }
  links: Array<{ text: string; href: string }>
  hasForms: boolean
  capturedAt: string
}

type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

interface ThreadTodoSource {
  kind: 'manual' | 'plan' | 'agent'
  threadId?: string
  turnId?: string
  gitHeadAtDispatch?: string | null
  gitRootAtDispatch?: string
  relativePath?: string
  contentHash?: string
  workspaceRoot?: string
  draftId?: string
  planItemId?: string
}

type ThreadTodoSyncSourceContext = Pick<ThreadTodoSource, 'workspaceRoot' | 'draftId' | 'relativePath'>
type ThreadTodoSetInput = Array<Pick<ThreadTodo, 'id' | 'content' | 'status' | 'source'>>

interface ThreadTodo {
  id: string
  threadId: string
  content: string
  status: ThreadTodoStatus
  source?: ThreadTodoSource
  updatedAt: number
}

interface UpdateStatus {
  version: string
  channel: 'stable' | 'preview'
  state?: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  checking: boolean
  available?: boolean
  downloaded?: boolean
  latestVersion?: string
  downloadUrl?: string
  downloadProgress?: number
  releaseName?: string
  releaseDate?: string
  error?: string
  checkedAt?: number
  canCheck?: boolean
  canDownload?: boolean
  canInstall?: boolean
  devMode?: boolean
}

type ReleaseCheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

interface ReleaseCheck {
  id: string
  name: string
  nameZh: string
  status: ReleaseCheckStatus
  message: string
  autoFixable?: boolean
}

interface ReleaseReport {
  version: string
  timestamp: string
  checks: ReleaseCheck[]
  summary: {
    pass: number
    fail: number
    warn: number
    skip: number
  }
  ready: boolean
}

type PromptCategory = 'general' | 'coding' | 'review' | 'research' | 'writing' | 'custom'

interface PromptEntry {
  id: string
  name: string
  body: string
  category: PromptCategory
  tags: string[]
  isSlashCommand: boolean
  shortcut?: string
  createdAt: string
  updatedAt: string
  useCount: number
}

type PromptUpsertInput = Partial<PromptEntry> & {
  name: string
  body: string
}

interface MemoryQualityInput {
  title: string
  summary?: string
  content?: string
  tags?: string[]
  confidence?: number
  category: string
}

interface MemoryQualityScore {
  entryId: string
  score: number
  reasons: string[]
}

interface MemoryConflictEntry {
  id: string
  title: string
  summary?: string
  category: string
}

interface MemoryConflict {
  entryA: string
  entryB: string
  reason: string
}

interface BudgetConfig {
  version: 1
  dailyLimitUsd: number | null
  monthlyLimitUsd: number | null
  perRequestMaxTokens: number | null
  perRequestMaxCostUsd: number | null
  notifyAtPercent: number
  blockWhenExceeded: boolean
  suggestCheaperModel: boolean
}

interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  warning?: string
}

interface BudgetEstimate {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedRequests: number
  estimatedCostUsd: number | null
  hasUnpriced: boolean
  dailySpentUsd: number
  monthlySpentUsd: number
  projectedDailyUsd: number | null
  projectedMonthlyUsd: number | null
  check: BudgetCheckResult
}

interface InlineEditRange {
  filePath: string
  startLine: number
  endLine: number
  selectedText: string
  fullContent?: string
}

interface InlineEditRequest {
  range: InlineEditRange
  instruction: string
  providerId?: string
  modelId?: string
}

interface InlineEditValidationResult {
  valid: boolean
  warnings: string[]
}

interface InlineEditApplyResult {
  ok: boolean
  content?: string
  newStartLine?: number
  newEndLine?: number
  error?: string
}

interface AppEventLogEntry {
  ts?: string
  kind?: string
  raw?: string
  parseError?: string
  [key: string]: unknown
}

interface RecentAppEventLogs {
  path: string
  entries: AppEventLogEntry[]
  scannedLines: number
  truncated: boolean
  parseWarnings: string[]
  error?: string
}

type DiagnosticSuiteStatus = 'pass' | 'warn' | 'fail' | 'skip'
type DiagnosticSuiteCategory = 'system' | 'providers' | 'agents' | 'mcp' | 'memory' | 'workspace'

interface LegacyDiagnosticResult {
  id: string
  name: string
  nameZh: string
  category: DiagnosticSuiteCategory
  status: DiagnosticSuiteStatus
  message: string
  details?: string
  durationMs?: number
}

interface LegacyDiagnosticSuite {
  timestamp: string
  results: LegacyDiagnosticResult[]
  summary: {
    pass: number
    warn: number
    fail: number
    skip: number
    total: number
  }
}

type DiagnosticLevel = 'pass' | 'warn' | 'fail' | 'skip' | 'auto-fix'
type DiagnosticCategory = 'system' | 'providers' | 'agents' | 'mcp' | 'memory' | 'workspace' | 'storage' | 'security'

interface DiagnosticCheck {
  id: string
  name: string
  category: DiagnosticCategory
  level: DiagnosticLevel
  message: string
  detail?: string
  autoFixable: boolean
  durationMs?: number
}

interface DiagnosticReport {
  timestamp: string
  checks: DiagnosticCheck[]
  summary: {
    pass: number
    warn: number
    fail: number
    skip: number
    autoFix: number
    total: number
  }
  overall: 'healthy' | 'degraded' | 'critical'
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
  candidates: Array<{
    source: 'desktop' | 'terminal'
    label: string
    path: string
    verification?: 'version' | 'manual'
    note?: string
    kind?: 'path-detected' | 'desktop-candidate' | 'stdio-headless' | 'acp' | 'needs-login' | 'needs-args'
  }>
  workspaceSession: 'per-dispatch' | 'persistent'
  diagnostic?: { code: string; message: string; action?: string }
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

interface SlashCommand {
  shortcut: string
  name: string
  body: string
  category: string
  params: string[]
  system: boolean
}

interface SlashCommandSaveInput {
  id?: string
  shortcut: string
  name: string
  body: string
  category?: string
}

interface SlashCommandSaveResult {
  ok: boolean
  command?: SlashCommand
  error?: string
}

interface SlashCommandResolveResult {
  ok: boolean
  body?: string
  error?: string
}

interface SlashCommandValidationResult {
  valid: boolean
  error?: string
}

interface SlashCommandConflictResult {
  conflict: boolean
  conflictingName?: string
}

type GitHubListState = 'open' | 'closed' | 'all'
type GitHubPrState = 'open' | 'closed' | 'merged'
type GitHubIssueState = 'open' | 'closed'

interface GitHubCliStatus {
  available: boolean
  authenticated: boolean
  version?: string
  error?: string
}

interface GitHubPr {
  number: number
  title: string
  state: GitHubPrState
  author: string
  url: string
  branch: string
  createdAt: string
  labels: string[]
}

interface GitHubIssue {
  number: number
  title: string
  state: GitHubIssueState
  author: string
  url: string
  labels: string[]
  createdAt: string
}

interface GitHubCurrentBranchPr {
  branch: string
  pr?: GitHubPr
}

interface WorkflowVariable {
  name: string
  value: string
  type: 'string' | 'number' | 'boolean'
}

interface WorkflowRunRecord {
  workflowId: string
  runId: string
  workflowName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  stepResults: Array<{ stepId: string; status: string; output?: string; error?: string }>
}

type TeamRole = 'main' | 'router' | 'reviewer' | 'executor' | 'gatekeeper' | 'summarizer' | 'expert'

interface TeamMember {
  role: TeamRole
  agentId: string
  systemPrompt?: string
}

interface TeamPreset {
  id: string
  name: string
  description: string
  members: TeamMember[]
  createdAt: string
  updatedAt: string
  useCount: number
}

type TeamPresetSaveInput = Partial<TeamPreset> & {
  name: string
  members: TeamMember[]
}

interface DetectedTechStack {
  language: string
  framework?: string
  packageManager?: string
  testFramework?: string
  buildTool?: string
}

interface ProjectKnowledgeEntry {
  title: string
  content: string
  category: string
}

type FireflyRole = 'router' | 'main' | 'reviewer' | 'executor' | 'gatekeeper'

type FireflyPhase =
  | 'idle'
  | 'router_decision'
  | 'main_candidate'
  | 'review_verdict'
  | 'executor_actions'
  | 'gatekeeper_verdict'
  | 'final_release'
  | 'blocked'
  | 'error'

interface FireflyState {
  phase: FireflyPhase
  currentRole: FireflyRole | null
  routerOutput?: string
  mainOutput?: string
  reviewerOutput?: string
  executorOutput?: string
  gatekeeperOutput?: string
  approvedActions: string[]
  rejectedActions: string[]
  guardReasons: string[]
  blockedByGuard: boolean
  startedAt: number
  roleTimings: Map<FireflyRole, { startedAt: number; completedAt?: number }>
}

interface FireflyRoleContext {
  messages: string[]
  constraints: string[]
}

interface TerminalContext {
  recentCommands: string[]
  recentOutput: string[]
  cwd?: string
  lastExitCode?: number
}

interface QuickCompleteInputLike {
  prompt: string
  systemPrompt?: string
  providerId?: string
  modelId?: string
  timeoutMs?: number
  workspaceRoot?: string
}

interface QuickCompleteResultLike {
  ok: boolean
  content?: string
  error?: string
}

interface ProjectNode {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  sizeBytes?: number
  children?: ProjectNode[]
  language?: string
}

interface ProjectMap {
  root: string
  nodes: ProjectNode[]
  stats: {
    totalFiles: number
    totalDirectories: number
    totalSize: number
    languages: Record<string, number>
  }
}

// ============================================================
// SDD (Spec Driven Development) Types
// ============================================================

type SddStatus = 'draft' | 'planned' | 'building' | 'done' | 'verified'

interface SddAcceptanceCriterion {
  text: string
  checked: boolean
}

interface SddRequirementBlock {
  id: string
  title: string
  status: SddStatus
  description: string
  acceptanceCriteria: SddAcceptanceCriterion[]
  lineNumber: number
}

interface SddDesignContext {
  designType?: 'brand' | 'product'
  brandColor?: string
  tone?: string[]
}

interface SddDraft {
  id: string
  workspaceRoot: string
  relativePath: string
  title: string
  content: string
  designContext?: SddDesignContext
  createdAt: string
  updatedAt: string
}

interface SddDraftMeta {
  id: string
  workspaceRoot: string
  relativePath: string
  title: string
  createdAt: string
  updatedAt: string
}

interface SddDraftHistoryEntry {
  version: number
  timestamp: string
  content: string
  title: string
  message: string
  author: 'user' | 'system' | 'ai'
  truncated?: boolean
}

interface SddCommitEvidence {
  sha: string
  shortSha: string
  summary?: string
  files?: Array<{
    path: string
    oldPath?: string | null
    status: string
    additions?: number
    deletions?: number
  }>
  linkedAt: string
  turnId?: string
  threadId?: string
}

interface SddPlanItem {
  id: string
  text: string
  covers: string[]
  status: 'pending' | 'in_progress' | 'completed'
  lineNumber: number
  turnId?: string
  commits?: SddCommitEvidence[]
}

interface SddTrace {
  draftId: string
  requirementBlocks: SddRequirementBlock[]
  planItems: SddPlanItem[]
  coverage: Record<string, string[]>
  derivedStatuses: Record<string, SddStatus>
  uncoveredRequirementIds: string[]
  timestamp: string
}

interface Window {
  electronAPI: ElectronAPI
}
