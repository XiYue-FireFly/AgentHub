export interface WorkspaceFileEntry {
  path: string
  relativePath: string
  name: string
  extension: string
  isDirectory: boolean
  sizeBytes: number
}

export interface WorkspaceFileReadResult {
  ok: boolean
  content: string
  path: string
  error?: string
}

export interface WorkspaceFileWriteResult {
  ok: boolean
  error?: string
}

export interface WorkspaceImageReadResult {
  ok: boolean
  dataUrl: string
  mimeType: string
  size: number
  error?: string
}

export interface WorkspaceDirectoryListResult {
  ok: boolean
  entries: Array<{ name: string; type: 'directory' | 'file'; path: string }>
  error?: string
}

export interface WorkbenchWorkspaceLike {
  id: string
  name: string
  rootPath: string
  bootstrapFiles?: string[]
  createdAt: number
  updatedAt: number
}

export interface WorkbenchWorkspaceCreateInputLike {
  name: string
  rootPath: string
}

export interface WorkbenchWorkspaceUpdatePatchLike {
  name?: string
  rootPath?: string
  bootstrapFiles?: string[]
}

export interface WorktreeItemLike {
  id: string
  parentWorkspaceId: string
  path: string
  branch: string
  status: 'clean' | 'dirty' | 'missing'
  createdAt: number
}

export interface WorktreeCreateInputLike {
  parentWorkspaceId: string
  branch?: string
  path?: string
}

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'custom' | string
export type ThinkingMode = 'off' | 'auto' | 'enabled'
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | string

export interface ProviderThinkingConfig {
  mode: ThinkingMode
  level: ThinkingLevel
  budgetTokens?: number
  collapseInUI?: boolean
}

export interface ProviderModelLike extends Record<string, unknown> {
  id: string
  label?: string
  contextWindow?: number
  enabled?: boolean
  supportsTools?: boolean
  supportsVision?: boolean
  supportsThinking?: boolean
}

export interface ProviderDefinitionLike extends Record<string, unknown> {
  id: string
  name?: string
  kind?: ProviderKind
  baseUrl?: string
  apiKey?: string
  apiKeyLocked?: boolean
  apiKeyError?: string
  enabled?: boolean
  builtIn?: boolean
  models?: ProviderModelLike[]
}

export interface ProviderRouteBindingLike extends Record<string, unknown> {
  agentId: string
  providerId: string
  modelId: string
  thinkingAllow?: ThinkingMode[]
  thinking?: ProviderThinkingConfig
  protocol?: 'http' | 'stdio-plain' | 'acp'
  binary?: string
  args?: string
}

export interface ProviderRoutingConfigLike extends Record<string, unknown> {
  bindings?: ProviderRouteBindingLike[]
  fallbackChain?: string[]
  strategy?: 'single' | 'load-balance' | 'cost-aware' | string
}

export interface ProvidersConfigLike extends Record<string, unknown> {
  providers: ProviderDefinitionLike[]
  routing?: ProviderRoutingConfigLike
  activeBindingId?: string | null
}

export interface ProviderHealthLike extends Record<string, unknown> {
  reachable: boolean
  status?: 'ok' | 'unauthorized' | 'error' | 'unreachable' | string
  lastCheck?: number
  latencyMs?: number
  error?: string
}

export interface ProviderHealthFailureLike extends Record<string, unknown> {
  ok: false
  error: string
}

export type ProviderHealthResultLike = ProviderHealthLike | ProviderHealthFailureLike

export type AgentCapabilityLike = 'fs-read' | 'fs-write' | 'exec' | 'agentic-loop' | 'skills' | 'system-control'
export type AgenticProtocolLike = 'http' | 'stdio-plain' | 'acp'

export interface AgentCapabilityStateLike {
  agentId: string
  name: string
  protocol: AgenticProtocolLike
  nativeCli: boolean
  httpAgentic: boolean
  capabilities: AgentCapabilityLike[]
}

export type AgenticModeLike = 'all' | 'selected'
export type AgenticApprovalPolicyLike = 'allow' | 'ask' | 'deny'
export type AgenticGuardedToolLike = 'write' | 'exec'
export type AgenticApprovalPresetLike = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'

export interface AgenticApprovalConfigLike {
  version: 1
  preset?: AgenticApprovalPresetLike
  default: Record<AgenticGuardedToolLike, AgenticApprovalPolicyLike>
  overrides: Record<string, Partial<Record<AgenticGuardedToolLike, AgenticApprovalPolicyLike>>>
}

export interface ProviderFetchModelsOverride {
  baseUrl?: string
  apiKey?: string
  kind?: string
}

export interface ProviderFetchModelsResult {
  ok: boolean
  count?: number
  error?: string
  config?: ProvidersConfigLike
}

export type WorkflowStepType = 'prompt' | 'agent' | 'skill' | 'review' | 'gate'
export type WorkflowCategory = 'development' | 'review' | 'research' | 'deployment' | 'custom'

export interface WorkflowStepLike {
  id: string
  type: WorkflowStepType
  label: string
  agentId?: string
  prompt?: string
  skillId?: string
  dependsOn?: string[]
  requiresApproval?: boolean
}

export interface WorkflowDefinitionLike {
  id: string
  name: string
  description: string
  category: WorkflowCategory
  steps: WorkflowStepLike[]
  tags: string[]
  createdAt: string
  updatedAt: string
  useCount: number
  pinned?: boolean
}

export type WorkflowUpsertInput = Partial<WorkflowDefinitionLike> & {
  name: string
  steps: WorkflowStepLike[]
}

export interface WorkflowVariableLike {
  name: string
  value: string
  type: 'string' | 'number' | 'boolean'
}

export interface WorkflowRunRecordLike {
  workflowId: string
  runId: string
  workflowName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  stepResults: Array<{ stepId: string; status: string; output?: string; error?: string }>
}

export type TeamRole = 'main' | 'router' | 'reviewer' | 'executor' | 'gatekeeper' | 'summarizer' | 'expert'

export interface TeamMemberLike {
  role: TeamRole
  agentId: string
  systemPrompt?: string
}

export interface TeamPresetLike {
  id: string
  name: string
  description: string
  members: TeamMemberLike[]
  createdAt: string
  updatedAt: string
  useCount: number
}

export type TeamPresetSaveInput = Partial<TeamPresetLike> & {
  name: string
  members: TeamMemberLike[]
}

export interface DetectedTechStackLike {
  language: string
  framework?: string
  packageManager?: string
  testFramework?: string
  buildTool?: string
}

export interface ProjectKnowledgeEntryLike {
  title: string
  content: string
  category: string
}

export type FireflyRole = 'router' | 'main' | 'reviewer' | 'executor' | 'gatekeeper'

export type FireflyPhase =
  | 'idle'
  | 'router_decision'
  | 'main_candidate'
  | 'review_verdict'
  | 'executor_actions'
  | 'gatekeeper_verdict'
  | 'final_release'
  | 'blocked'
  | 'error'

export interface FireflyStateLike {
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

export interface FireflyRoleContextLike {
  messages: string[]
  constraints: string[]
}

export interface TerminalContextLike {
  recentCommands: string[]
  recentOutput: string[]
  cwd?: string
  lastExitCode?: number
}

export interface QuickCompleteInputLike {
  prompt: string
  systemPrompt?: string
  providerId?: string
  modelId?: string
  timeoutMs?: number
  workspaceRoot?: string
}

export interface QuickCompleteResultLike {
  ok: boolean
  content?: string
  error?: string
}

export interface TerminalRunInputLike {
  workspaceId?: string | null
  command: string
}

export interface TerminalRunLike {
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

export interface TerminalPtyCreateInputLike {
  sessionId: string
  cwd?: string
  cols?: number
  rows?: number
}

export interface TerminalPtyCreateResultLike {
  ok: boolean
  message?: string
  reattached?: boolean
}

export interface TerminalPtyWriteInputLike {
  sessionId: string
  data: string
}

export interface TerminalPtyResizeInputLike {
  sessionId: string
  cols: number
  rows: number
}

export interface WorkbenchThreadLike {
  id: string
  workspaceId: string | null
  title: string
  createdAt: number
  updatedAt: number
  lastTurnStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
}

export interface ThreadCreateInputLike {
  workspaceId?: string | null
  title?: string
}

export interface ThreadForkInputLike {
  sourceThreadId: string
  sourceTurnId: string
  message: string
}

export interface WorkbenchAttachmentLike {
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

export type AppOpenPathTargetLike =
  | 'editor'
  | 'antigravity'
  | 'explorer'
  | 'system'
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'file-manager'
  | string

export interface AppOpenPathInputLike {
  path: string
  target?: AppOpenPathTargetLike
  line?: number
  column?: number
  workspaceRoot?: string | null
}

export interface AppResolvePathInputLike {
  path: string
  workspaceRoot?: string | null
}

export interface AppReadTextFileInputLike {
  path: string
  workspaceRoot?: string | null
}

export interface AppOpenExternalResultLike {
  ok: boolean
  error?: string
}

export interface AppOpenPathResultLike {
  ok: boolean
  path: string
  target: string
  error?: string
}

export interface AppResolvePathResultLike {
  ok: boolean
  path: string
  error?: string
}

export interface AppReadTextFileResultLike {
  ok: boolean
  path: string
  content?: string
  error?: string
}

export interface AppPickOptionsLike {
  defaultPath?: string
}

export type ContextBlockKindLike =
  | 'recent_turns'
  | 'compaction_summary'
  | 'attachment'
  | 'memory'
  | 'browser'
  | 'skill'
  | 'write_draft'
  | 'workspace_file'
  | 'workspace_state'

export type ContextBlockParticipationLike = 'selected' | 'pinned_next_send' | 'carried_over' | 'excluded'

export interface ContextBlockLike {
  id: string
  kind: ContextBlockKindLike
  title: string
  detail?: string
  content?: string
  sourceRef?: string
  estimateTokens?: number
  participation: ContextBlockParticipationLike
  pinned?: boolean
  createdAt: number
}

export interface ContextProjectionInputLike {
  threadId?: string | null
  workspaceId?: string | null
  prompt?: string
  attachments?: WorkbenchAttachmentLike[]
  writeDraft?: { title: string; content: string } | null
  pinnedBlocks?: ContextBlockLike[]
}

export interface ContextProjectionLike {
  threadId: string | null
  workspaceId: string | null
  blocks: ContextBlockLike[]
  totalEstimateTokens: number
  compacted: boolean
  createdAt: number
}

export interface GitQueryInputLike {
  workspaceId?: string | null
  threadId?: string | null
  query?: string
}

export interface GitQueryResultLike {
  threadId: string
  turnId: string
  result: string | null
  error?: string
}

export interface RuntimeModelSelectionLike {
  providerId: string
  modelId: string
  agentId?: string
  source?: 'provider' | 'local-cli'
}

export type WorkbenchTurnStatusLike = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface WorkbenchTurnLike {
  id: string
  threadId: string
  prompt: string
  attachments?: WorkbenchAttachmentLike[]
  contextProjection?: ContextProjectionLike
  mode: DispatchPreset
  customSchedule?: SchedulePreview
  targetAgent?: string | null
  modelSelection?: RuntimeModelSelectionLike
  thinking?: unknown
  status: WorkbenchTurnStatusLike
  taskIds: string[]
  createdAt: number
  completedAt?: number
}

export interface TurnCreateInputLike {
  threadId?: string | null
  workspaceId?: string | null
  prompt: string
  mode?: DispatchPreset
  targetAgent?: string | null
  thinking?: unknown
  modelSelection?: RuntimeModelSelectionLike
  attachments?: WorkbenchAttachmentLike[]
  customSchedule?: SchedulePreview
}

export type TurnCreateResultLike = {
  thread: WorkbenchThreadLike
  turn: WorkbenchTurnLike
}

export interface AgentRunNodeLike {
  id: string
  turnId: string
  agentId: string
  role: ScheduleStepRole
  status: WorkbenchTurnStatusLike
  parentRunId?: string
  startedAt: number
  endedAt?: number
}

export interface RuntimeEventLike {
  id: string
  threadId: string
  turnId: string
  seq: number
  kind: string
  agentId?: string
  payload: unknown
  createdAt: number
  ts?: number
}

export interface WorkbenchSnapshotLike {
  threads: WorkbenchThreadLike[]
  turns: WorkbenchTurnLike[]
  runs: AgentRunNodeLike[]
  hiddenTaskTurnIds?: string[]
  activeThreadId: string | null
}

export interface HubStatusAgentLike {
  id: string
  name: string
  status: string
  capabilities: string[]
  providerId?: string
  modelId?: string
  errorCount?: number
}

export type HubStatusTaskStatusLike = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface HubStatusTaskLike {
  id: string
  text: string
  mode: DispatchPreset
  status: HubStatusTaskStatusLike
  createdAt: Date
}

export interface HubStatusLike {
  running: boolean
  url: string
  proxyUrl: string
  clientCount: number
  agents: HubStatusAgentLike[]
  tasks: HubStatusTaskLike[]
}

export interface ProxyInfoLike {
  url: string
  running: boolean
}

export type TakeoverAppLike = 'codex' | 'claude' | 'hermes' | 'openclaw'

export interface TakeoverStateLike {
  supported: boolean
  configPath: string
  configExists: boolean
  takenOver: boolean
  model: string | null
  current: string | null
}

export type TakeoverStatusResultLike = Record<TakeoverAppLike, TakeoverStateLike> | { error: string }
export type TakeoverMutationResultLike = TakeoverStateLike | { ok: false; error: string }

export interface GitFileStatusLike {
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

export interface GitStatusLike {
  workspaceId: string | null
  rootPath: string | null
  isRepo: boolean
  branch: string
  upstream?: string | null
  ahead: number
  behind: number
  files: GitFileStatusLike[]
  stagedFiles: GitFileStatusLike[]
  unstagedFiles: GitFileStatusLike[]
  totalAdditions: number
  totalDeletions: number
  error?: string
}

export interface GitBranchLike {
  name: string
  current: boolean
  isCurrent: boolean
  isRemote?: boolean
  remote?: string | null
  upstream?: string | null
  lastCommit?: number
  headSha?: string | null
  ahead: number
  behind: number
}

export interface GitBranchListResponseLike {
  branches: Array<Pick<GitBranchLike, 'name' | 'current'>>
  localBranches: GitBranchLike[]
  remoteBranches: GitBranchLike[]
  currentBranch: string | null
  repositoryState: 'git_repository' | 'not_git_repository' | 'unknown'
  diagnostic?: {
    kind: string
    reason?: string | null
    message?: string | null
    workspaceId?: string | null
    pathKind?: string | null
  } | null
}

export interface GitLogEntryLike {
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

export interface GitLogResponseLike {
  total: number
  entries: GitLogEntryLike[]
  ahead: number
  behind: number
  aheadEntries: GitLogEntryLike[]
  behindEntries: GitLogEntryLike[]
  upstream: string | null
}

export interface GitFileDiffLike {
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

export interface GitCommitDiffLike {
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

export interface GitCommitFileChangeLike {
  path: string
  oldPath?: string | null
  status: string
  additions: number
  deletions: number
  isBinary?: boolean
  isImage?: boolean
  diff: string
  lineCount: number
  truncated: boolean
}

export interface GitCommitDetailsLike {
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
  files: GitCommitFileChangeLike[]
  totalAdditions: number
  totalDeletions: number
}

export interface GitCommitResultLike {
  hash: string
}

export interface GitUpdateBranchResultLike {
  branch: string
  status: 'success' | 'no-op' | 'blocked'
  message: string
}

export type ShortcutCategory = 'navigation' | 'action' | 'editor' | 'agent'

export interface ShortcutBindingLike {
  id: string
  label: string
  labelZh: string
  defaultKey: string
  key: string
  category: ShortcutCategory
  system: boolean
}

export interface ShortcutConflictLike {
  key: string
  ids: string[]
}

export type NotificationCategoryLike = 'task' | 'approval' | 'mcp' | 'system' | 'workflow' | 'memory' | 'error'

export type NotificationActionLike =
  | { type: 'navigate'; target: string }
  | { type: 'open-url'; url: string }

export interface NotificationLike {
  id: string
  title: string
  body: string
  category: NotificationCategoryLike
  read: boolean
  action?: NotificationActionLike
  createdAt: string
}

export type NotificationPushInput = Omit<NotificationLike, 'id' | 'read' | 'createdAt'>

export type OnboardingStepLike =
  | 'select-language'
  | 'bind-provider'
  | 'detect-agents'
  | 'choose-default-agent'
  | 'test-mcp'
  | 'enable-skills'
  | 'create-workspace'
  | 'send-first-message'

export interface OnboardingStateLike {
  version: 1
  completed: boolean
  completedAt?: string
  completedSteps: OnboardingStepLike[]
  skippedSteps: OnboardingStepLike[]
}

export interface BackupMetaLike {
  id: string
  filename: string
  createdAt: string
  sizeBytes: number
  keys: string[]
  version: string
}

export type BackupCreateResultLike = BackupMetaLike & { error?: string }

export interface BackupRestoreResultLike {
  restored: string[]
  error?: string
}

export interface BrowserOpenInputLike {
  workspaceId?: string | null
  url?: string
}

export interface BrowserSessionLike {
  id: string
  workspaceId: string | null
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserContextAttachmentLike {
  url: string
  title: string
  text: string
  headings: string[]
  links: Array<{ text: string; href: string }>
  forms: string[]
  capturedAt: number
}

export interface BrowserPageSnapshotLike {
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

export type StoreValueLike = unknown

export type ConversationMessageRoleLike = 'user' | 'assistant' | 'system' | 'tool'
export type ConversationExportFormatLike = 'markdown' | 'json' | 'html'

export interface ConversationToolCallLike {
  name: string
  args?: string
  result?: string
}

export interface ConversationAttachmentLike {
  name: string
  kind: string
}

export interface ConversationMessageLike {
  role: ConversationMessageRoleLike
  content: string
  agentId?: string
  timestamp?: string
  toolCalls?: ConversationToolCallLike[]
  thinking?: string
  attachments?: ConversationAttachmentLike[]
}

export interface ConversationExportDataLike {
  version: 1
  title: string
  exportedAt: string
  messages: ConversationMessageLike[]
  metadata?: {
    workspaceId?: string
    agentIds?: string[]
    turnCount?: number
  }
}

export interface ConversationExportFileResultLike {
  ok: boolean
  path: string
  error?: string
}

export interface ImportedConversationMessageLike {
  role: ConversationMessageRoleLike
  content: string
  agentId?: string
  timestamp?: string
  toolCalls?: ConversationToolCallLike[]
  thinking?: string
}

export interface ImportedConversationLike {
  version: number
  title: string
  exportedAt?: string
  messages: ImportedConversationMessageLike[]
  metadata?: Record<string, unknown>
}

export interface ConversationImportResultLike {
  ok: boolean
  conversation?: ImportedConversationLike
  messageCount?: number
  error?: string
  warnings?: string[]
}

export interface ConversationBranchResultLike {
  ok: boolean
  messages?: ImportedConversationMessageLike[]
  error?: string
}

export interface ConversationSummaryLike {
  title: string
  messageCount: number
  userMessages: number
  assistantMessages: number
  agentIds: string[]
  firstMessage: string
  lastMessage: string
}

export type AgentLoopModeLike = 'auto' | 'single'

export interface AgentLoopConfigLike {
  maxSteps: number
  timeoutMs: number
  enableDelegation: boolean
  mode: AgentLoopModeLike
}

export interface AgentLoopStatusLike {
  available: boolean
  activeTasks: number
}

export interface AgentLoopAgentLike {
  id: string
  name: string
  role: string
  capabilities: string[]
  version?: string
  path?: string
}

export interface AgentLoopRouteInfoLike {
  taskType: string
  selectedAgent: string
  confidence: number
  reasoning: string
  suggestedRole: string
}

export type ModelReasoningLevelLike = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ModelRouteInfoLike {
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

export interface ModelListProviderModelLike {
  id: string
  label: string
  contextWindow?: number
  supportsTools?: boolean
  supportsVision?: boolean
  supportsThinking?: boolean
  enabled?: boolean
  upstreamModel?: string
  timeoutMs?: number
  retryCount?: number
  reasoningEnabled?: boolean
  defaultReasoningLevel?: string
  supportedReasoningLevels?: string[]
  codexAlias?: string
  description?: string
}

export interface ModelListProviderLike {
  id: string
  name: string
  kind?: ProviderKind
  enabled: boolean
  apiKey?: string
  protocolOverride?: string
  capabilities?: { protocol?: string }
  models: ModelListProviderModelLike[]
}

export type ModelRouteModeLike = 'official_account' | 'third_party_api' | 'lan_share'

export interface CodexSlotAssignmentLike {
  slot: string
  targetModelId: string
  mode: ModelRouteModeLike
  source: string
}

export interface ModelRouteSettingsLike {
  fallbackModelId?: string
  codexDefaultModel?: string
  codexInjectionMode: ModelRouteModeLike
  codexInternalModelLock: boolean
  codexSlots: CodexSlotAssignmentLike[]
}

export interface ModelRoutePatchLike {
  enabled?: boolean
  upstreamModel?: string
  timeoutMs?: number
  retryCount?: number
  reasoningEnabled?: boolean
  defaultReasoningLevel?: ModelReasoningLevelLike
  supportedReasoningLevels?: ModelReasoningLevelLike[]
  codexAlias?: string
  description?: string
}

export interface ModelRouteTestInputLike {
  providerId: string
  modelId: string
  upstreamModel?: string
}

export interface ModelRouteTestResultLike {
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

export interface CodexCatalogExportResultLike {
  ok: boolean
  path?: string
  content: string
  count: number
  error?: string
}

export type McpServerSourceLike = 'user' | 'workspace' | 'local' | 'ecc' | 'kun' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'ccgui'
export type McpTransportLike = 'stdio' | 'sse' | 'http'
export type McpStatusLike = 'unknown' | 'ok' | 'error'

export interface McpServerConfigLike {
  id: string
  name: string
  source: McpServerSourceLike
  enabled: boolean
  transport: McpTransportLike
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
  status?: McpStatusLike
  error?: string
}

export type McpServerUpsertInputLike = Partial<McpServerConfigLike> & { name: string }

export interface McpToolInfoLike {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpServerToolsResultLike {
  ok: boolean
  tools: McpToolInfoLike[]
  error?: string
  resources?: number
  prompts?: number
}

export interface McpSystemConfigLike {
  version: number
  enabled: boolean
  allowedCategories: Array<'read' | 'write' | 'exec'>
  defaultPolicy: 'allow' | 'ask' | 'deny'
  timeoutMs: number
}

export interface SkillCategoryLike {
  id: string
  label: string
}

export type SkillCategoryInputLike = string | Partial<SkillCategoryLike> | null | undefined

export interface SkillDefLike {
  id: string
  name: string
  category: SkillCategoryLike
  description: string
  instructions: string
  tags: string[]
  source: string
  createdAt: number
  updatedAt: number
}

export interface SkillInputLike {
  name: string
  category?: SkillCategoryInputLike
  description?: string
  instructions: string
  tags?: string[]
  source?: string
}

export type SkillPatchLike = Partial<SkillInputLike>
export type SkillInstallsLike = Record<string, string[]>

export interface LocalSkillCandidateLike {
  id: string
  name: string
  description: string
  instructions: string
  tags: string[]
  category?: SkillCategoryLike
  sourcePath: string
  agentSource: string
}

export interface PluginCommandContribution {
  id: string
  label: string
}

export interface PluginSlashCommandContribution {
  id: string
  label: string
  description?: string
  insertText?: string
  promptTemplate?: string
}

export interface PluginSkillContribution {
  id: string
  path: string
  content?: string
}

export interface PluginPromptContribution {
  id: string
  name: string
  body: string
}

export interface PluginActivityParserContribution {
  id: string
  pattern: string
  flags?: string
  kind?: string
  fields?: Record<string, string>
}

export interface PluginPreDispatchHookContribution {
  id: string
  pattern?: string
  appendContext?: string
  denyMessage?: string
  requireApproval?: boolean
  message?: string
}

export interface PluginContributionSet {
  commands?: PluginCommandContribution[]
  slashCommands?: PluginSlashCommandContribution[]
  skills?: PluginSkillContribution[]
  prompts?: PluginPromptContribution[]
  activityParsers?: PluginActivityParserContribution[]
  preDispatchHooks?: PluginPreDispatchHookContribution[]
}

export interface PluginManifestLike {
  id?: string
  name: string
  version: string
  description?: string
  author?: string
  dependencies?: Array<{ name: string; version: string; optional: boolean }>
  contributes?: PluginContributionSet
}

export interface PluginEntryLike {
  id: string
  manifest: PluginManifestLike
  path: string
  enabled: boolean
  source: 'local' | 'global'
}

export interface PluginValidationResult {
  valid: boolean
  errors: string[]
}

export interface PluginContributionsResult {
  commands: Array<PluginCommandContribution & { pluginId: string }>
  slashCommands: Array<PluginSlashCommandContribution & { pluginId: string }>
  skills: Array<PluginSkillContribution & { pluginId: string }>
  prompts: Array<PluginPromptContribution & { pluginId: string }>
  activityParsers: Array<PluginActivityParserContribution & { pluginId: string }>
  preDispatchHooks: Array<PluginPreDispatchHookContribution & { pluginId: string }>
}

export interface PluginRepositoryPresetLike {
  id: string
  name: string
  url: string
  description?: string
  source: 'builtin'
}

export interface PluginRepositoryImportInput {
  url: string
  id?: string
  name?: string
  branch?: string
}

export interface PluginRepositoryImportResultLike {
  ok: boolean
  plugin?: PluginEntryLike
  plugins?: PluginEntryLike[]
  path?: string
  error?: string
  diagnostics?: string[]
}

export interface InstalledPluginLike {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  dependencies: Array<{ name: string; version: string; optional: boolean }>
  installedAt: string
  updatedAt: string
  enabled: boolean
  contributes: PluginContributionSet
}

export interface WorkbenchGoal {
  threadId: string
  goal: string
  createdAt: number
  updatedAt: number
  loopLimit: number
  status: 'active' | 'cleared'
}

export interface RunTimeoutSettings {
  value: number
  defaultMs: number
  minMs: number
  maxMs: number
}

export interface LocalAgentBinaryCandidate {
  source: 'desktop' | 'terminal'
  label: string
  path: string
  verification?: 'version' | 'manual'
  note?: string
  kind?: 'path-detected' | 'desktop-candidate' | 'stdio-headless' | 'acp' | 'needs-login' | 'needs-args'
}

export interface LocalAgentStatusLike {
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
  candidates: LocalAgentBinaryCandidate[]
  workspaceSession: 'per-dispatch' | 'persistent'
  diagnostic?: { code: string; message: string; action?: string }
  error?: string
}

export interface LocalAgentConfigurePatch {
  binary?: string
  args?: string
  protocol?: 'stdio-plain' | 'acp'
}

export interface LocalAgentOptionLike {
  agentId: string
  label: string
  status: 'idle' | 'busy' | 'error' | 'off'
  installed: boolean
  configured: boolean
}

export type LocalModelAuthMode = 'api-key' | 'oauth' | 'unknown' | 'missing'
export type LocalModelStatus = 'ok' | 'missing' | 'partial' | 'error'
export type LocalModelSource = 'codex' | 'gemini' | 'claude'

export interface LocalModelInfoLike {
  id: string
  label?: string
  contextWindow?: number
  capabilities?: string[]
}

export interface LocalModelConfigLike {
  agentId: string
  source: LocalModelSource
  modelId?: string
  authMode?: LocalModelAuthMode
  baseUrl?: string
  configPath: string
  status: LocalModelStatus
  error?: string
  models?: LocalModelInfoLike[]
}

export type DispatchPreset =
  | 'auto'
  | 'broadcast'
  | 'chain'
  | 'orchestrate'
  | 'lead-workers'
  | 'parallel-review'
  | 'firefly-custom'
  | 'custom'

export type WorkbenchCommandCategory = 'session' | 'agent' | 'schedule' | 'tool' | 'skill' | 'workspace' | 'ecc' | 'plugin'
export type WorkbenchCommandAction =
  | 'insert'
  | 'new-thread'
  | 'clear-thread'
  | 'show-context'
  | 'open-panel'
  | 'run-terminal'
  | 'run-git'
  | 'use-schedule'
  | 'use-skill'
  | 'use-agent'
  | 'set-goal'
  | 'run-loop'
export type WorkbenchCommandSource = 'builtin' | 'schedule' | 'skill' | 'local-agent' | 'ecc' | 'plugin'

export interface WorkbenchCommand {
  id: string
  label: string
  description: string
  descriptionZh?: string
  descriptionEn?: string
  category: WorkbenchCommandCategory
  insertText?: string
  action: WorkbenchCommandAction
  source: WorkbenchCommandSource
  payload?: Record<string, unknown>
}

export interface WorkbenchCommandRunInput {
  id?: string
  text?: string
}

export type ScheduleStepRole = 'lead' | 'worker' | 'reviewer' | 'synthesizer' | 'target' | 'router' | 'executor' | 'gatekeeper'
export type ScheduleStepMode = 'auto' | 'broadcast' | 'chain' | 'orchestrate'
export type ScheduleArtifactMode = 'summary' | 'full' | 'files' | 'custom'
export type ScheduleApprovalPolicy = 'inherit' | 'auto' | 'ask' | 'require' | 'skip'

export interface ScheduleStep {
  id: string
  label: string
  labelZh?: string
  labelEn?: string
  agentId: string
  role: ScheduleStepRole
  mode: ScheduleStepMode
  dependsOn?: string[]
}

export interface ScheduleGraphNode {
  id: string
  label: string
  agentId: string
  role: ScheduleStepRole
  mode: ScheduleStepMode
  promptTemplate?: string
  approvalPolicy?: ScheduleApprovalPolicy
}

export interface ScheduleGraphEdge {
  id: string
  from: string
  to: string
  artifactMode: ScheduleArtifactMode
}

export interface ScheduleGraph {
  version: 1
  nodes: ScheduleGraphNode[]
  edges: ScheduleGraphEdge[]
  layout: Record<string, { x: number; y: number }>
}

export interface SchedulePreview {
  preset: DispatchPreset
  label: string
  labelZh?: string
  labelEn?: string
  description: string
  descriptionZh?: string
  descriptionEn?: string
  steps: ScheduleStep[]
  graph?: ScheduleGraph
}

export interface EccCommandStatus {
  version: number
  count: number
  source: 'bundled' | 'updated'
  updatedAt: number | null
  lastError?: string
}

export type UpdateChannel = 'stable' | 'preview'

export interface UpdateStatus {
  version: string
  channel: UpdateChannel
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

export type ReleaseCheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface ReleaseCheckLike {
  id: string
  name: string
  nameZh: string
  status: ReleaseCheckStatus
  message: string
  autoFixable?: boolean
}

export interface ReleaseReportLike {
  version: string
  timestamp: string
  checks: ReleaseCheckLike[]
  summary: {
    pass: number
    fail: number
    warn: number
    skip: number
  }
  ready: boolean
}

export interface AppEventLogEntryLike {
  ts?: string
  kind?: string
  raw?: string
  parseError?: string
  [key: string]: unknown
}

export interface RecentAppEventLogsLike {
  path: string
  entries: AppEventLogEntryLike[]
  scannedLines: number
  truncated: boolean
  parseWarnings: string[]
  error?: string
}

export type DiagnosticSuiteStatusLike = 'pass' | 'warn' | 'fail' | 'skip'
export type DiagnosticSuiteCategoryLike = 'system' | 'providers' | 'agents' | 'mcp' | 'memory' | 'workspace'

export interface DiagnosticSuiteResultLike {
  id: string
  name: string
  nameZh: string
  category: DiagnosticSuiteCategoryLike
  status: DiagnosticSuiteStatusLike
  message: string
  details?: string
  durationMs?: number
}

export interface LegacyDiagnosticSuiteLike {
  timestamp: string
  results: DiagnosticSuiteResultLike[]
  summary: {
    pass: number
    warn: number
    fail: number
    skip: number
    total: number
  }
}

export type DiagnosticLevel = 'pass' | 'warn' | 'fail' | 'skip' | 'auto-fix'
export type DiagnosticCategory = 'system' | 'providers' | 'agents' | 'mcp' | 'memory' | 'workspace' | 'storage' | 'security'

export interface DiagnosticCheckLike {
  id: string
  name: string
  category: DiagnosticCategory
  level: DiagnosticLevel
  message: string
  detail?: string
  autoFixable: boolean
  durationMs?: number
}

export interface DiagnosticReportLike {
  timestamp: string
  checks: DiagnosticCheckLike[]
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

export type UsageRange = 'all' | '90d' | '30d' | '7d'
export type UsageView = 'overview' | 'models' | 'requests' | 'providers' | 'pricing'
export type UsageSource = 'actual' | 'estimated' | 'none'

export type PromptCategory = 'general' | 'coding' | 'review' | 'research' | 'writing' | 'custom'

export interface PromptEntryLike {
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

export type PromptUpsertInput = Partial<PromptEntryLike> & {
  name: string
  body: string
}

export interface SlashCommandLike {
  shortcut: string
  name: string
  body: string
  category: string
  params: string[]
  system: boolean
}

export interface SlashCommandSaveInput {
  id?: string
  shortcut: string
  name: string
  body: string
  category?: string
}

export interface SlashCommandSaveResultLike {
  ok: boolean
  command?: SlashCommandLike
  error?: string
}

export type SlashCommandParams = Record<string, string>

export interface SlashCommandResolveResultLike {
  ok: boolean
  body?: string
  error?: string
}

export interface SlashCommandValidationResultLike {
  valid: boolean
  error?: string
}

export interface SlashCommandConflictResultLike {
  conflict: boolean
  conflictingName?: string
}

export type GitHubListState = 'open' | 'closed' | 'all'
export type GitHubPrState = 'open' | 'closed' | 'merged'
export type GitHubIssueState = 'open' | 'closed'

export interface GitHubCliStatusLike {
  available: boolean
  authenticated: boolean
  version?: string
  error?: string
}

export interface GitHubPrLike {
  number: number
  title: string
  state: GitHubPrState
  author: string
  url: string
  branch: string
  createdAt: string
  labels: string[]
}

export interface GitHubIssueLike {
  number: number
  title: string
  state: GitHubIssueState
  author: string
  url: string
  labels: string[]
  createdAt: string
}

export interface GitHubCurrentBranchPrLike {
  branch: string
  pr?: GitHubPrLike
}

export type MemoryCategoryLike =
  | 'conversation'
  | 'task'
  | 'skill'
  | 'file'
  | 'system'
  | 'preference'
  | 'project'
  | 'style'
  | 'decision'
  | 'correction'
  | 'imported_conversation'

export type MemoryEntryStatusLike = 'candidate' | 'approved' | 'disabled'

export interface MemoryEntryInputLike {
  id?: string
  category: MemoryCategoryLike
  title: string
  summary?: string
  content?: string
  source?: string
  tags?: string[]
  status?: MemoryEntryStatusLike
  confidence?: number
  metadata?: Record<string, unknown>
}

export type MemoryEntryPatchLike = Partial<MemoryEntryInputLike>

export interface MemoryEntryLike extends MemoryEntryInputLike {
  id: string
  category: MemoryCategoryLike
  summary: string
  tags: string[]
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface MemorySettingsStateLike {
  enabled: boolean
}

export interface MemoryCatalogLike {
  version: 1
  root: string
  entries: MemoryEntryLike[]
  counts: Record<MemoryCategoryLike, number>
  settings: MemorySettingsStateLike
  runtimeUpdatedAt?: string
}

export interface MemoryGraphNodeLike {
  id: string
  label: string
  category: string
  status: string
  pinned: boolean
  useCount: number
  importance: number
  tags: string[]
}

export interface MemoryGraphEdgeLike {
  source: string
  target: string
  type: 'tag' | 'category' | 'similarity'
  weight: number
  label?: string
}

export interface MemoryGraphLike {
  nodes: MemoryGraphNodeLike[]
  edges: MemoryGraphEdgeLike[]
  stats: {
    totalNodes: number
    totalEdges: number
    isolatedNodes: number
    categories: Record<string, number>
  }
}

export interface MemoryQualityInputLike {
  title: string
  summary?: string
  content?: string
  tags?: string[]
  confidence?: number
  category: string
}

export interface MemoryQualityScoreLike {
  entryId: string
  score: number
  reasons: string[]
}

export interface MemoryConflictEntryLike {
  id: string
  title: string
  summary?: string
  category: string
}

export interface MemoryConflictLike {
  entryA: string
  entryB: string
  reason: string
}

export interface BudgetConfigLike {
  version: 1
  dailyLimitUsd: number | null
  monthlyLimitUsd: number | null
  perRequestMaxTokens: number | null
  perRequestMaxCostUsd: number | null
  notifyAtPercent: number
  blockWhenExceeded: boolean
  suggestCheaperModel: boolean
}

export type BudgetConfigPatch = Partial<BudgetConfigLike>

export interface BudgetCheckResultLike {
  allowed: boolean
  reason?: string
  warning?: string
}

export interface BudgetEstimateLike {
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
  check: BudgetCheckResultLike
}

export interface InlineEditRangeLike {
  filePath: string
  startLine: number
  endLine: number
  selectedText: string
  fullContent?: string
}

export interface InlineEditRequestLike {
  range: InlineEditRangeLike
  instruction: string
  providerId?: string
  modelId?: string
}

export interface InlineEditValidationResultLike {
  valid: boolean
  warnings: string[]
}

export interface InlineEditApplyResultLike {
  ok: boolean
  content?: string
  newStartLine?: number
  newEndLine?: number
  error?: string
}

export interface ProjectNodeLike {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  sizeBytes?: number
  children?: ProjectNodeLike[]
  language?: string
}

export interface ProjectMapLike {
  root: string
  nodes: ProjectNodeLike[]
  stats: {
    totalFiles: number
    totalDirectories: number
    totalSize: number
    languages: Record<string, number>
  }
}

export interface UsageHeatmapDayLike {
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

export interface UsageModelRowLike {
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

export interface UsageProviderRowLike {
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

export interface UsageRequestRecordLike {
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
  rawUsage?: unknown
}

export interface UsagePricingRuleLike {
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

export interface UsageRecordFilterLike {
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

export interface PaginatedUsageRecordsLike {
  records: UsageRequestRecordLike[]
  total: number
  page: number
  pageSize: number
}

export interface UsageStatsLike {
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
  heatmap: UsageHeatmapDayLike[]
  models: UsageModelRowLike[]
  providers: UsageProviderRowLike[]
}

export type ThreadTodoStatus = 'pending' | 'in_progress' | 'completed'

export interface ThreadTodoSource {
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

export interface ThreadTodo {
  id: string
  threadId: string
  content: string
  status: ThreadTodoStatus
  source?: ThreadTodoSource
  updatedAt: number
}

export type ThreadTodoSetInput = Array<Pick<ThreadTodo, 'id' | 'content' | 'status' | 'source'>>

export interface ThreadTodoUpsertInput {
  threadId: string
  id?: string
  content: string
  status?: ThreadTodoStatus
  source?: ThreadTodoSource
}

export type ThreadTodoSyncSourceContext = Pick<ThreadTodoSource, 'workspaceRoot' | 'draftId' | 'relativePath'>

export type SddStatus = 'draft' | 'planned' | 'building' | 'done' | 'verified'

export interface SddAcceptanceCriterion {
  text: string
  checked: boolean
}

export interface SddRequirementBlock {
  id: string
  title: string
  status: SddStatus
  description: string
  acceptanceCriteria: SddAcceptanceCriterion[]
  lineNumber: number
}

export type SddDesignType = 'brand' | 'product'

export interface SddDesignContext {
  designType?: SddDesignType
  brandColor?: string
  tone?: string[]
}

export interface SddDraft {
  id: string
  workspaceRoot: string
  relativePath: string
  title: string
  content: string
  designContext?: SddDesignContext
  createdAt: string
  updatedAt: string
}

export interface SddDraftMeta {
  id: string
  workspaceRoot: string
  relativePath: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface SddCommitEvidence {
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

export interface SddPlanItem {
  id: string
  text: string
  covers: string[]
  status: 'pending' | 'in_progress' | 'completed'
  lineNumber: number
  turnId?: string
  commits?: SddCommitEvidence[]
}

export interface SddTrace {
  draftId: string
  requirementBlocks: SddRequirementBlock[]
  planItems: SddPlanItem[]
  coverage: Record<string, string[]>
  derivedStatuses: Record<string, SddStatus>
  uncoveredRequirementIds: string[]
  timestamp: string
}

export interface SddDraftHistoryEntryLike {
  version: number
  timestamp: string
  content: string
  title: string
  message: string
  author: 'user' | 'system' | 'ai'
  truncated?: boolean
}

export interface IpcContract {
  'win:minimize': {
    args: []
    result: void
  }
  'win:maximizeToggle': {
    args: []
    result: boolean
  }
  'win:isMaximized': {
    args: []
    result: boolean
  }
  'win:close': {
    args: []
    result: void
  }
  'windows:openWorkbench': {
    args: []
    result: { id: number }
  }
  'hub:status': {
    args: []
    result: HubStatusLike
  }
  'proxy:info': {
    args: []
    result: ProxyInfoLike
  }
  'agents:locate': {
    args: []
    result: LocalAgentStatusLike[]
  }
  'dialog:selectDirectory': {
    args: []
    result: string | null
  }
  'app:openExternal': {
    args: [url: string]
    result: AppOpenExternalResultLike
  }
  'app:openPath': {
    args: [input: AppOpenPathInputLike]
    result: AppOpenPathResultLike
  }
  'app:resolvePath': {
    args: [input: AppResolvePathInputLike]
    result: AppResolvePathResultLike
  }
  'app:readTextFile': {
    args: [input: AppReadTextFileInputLike]
    result: AppReadTextFileResultLike
  }
  'app:pickFolder': {
    args: [options?: AppPickOptionsLike]
    result: string | null
  }
  'app:pickFiles': {
    args: [options?: AppPickOptionsLike]
    result: string[] | null
  }
  'takeover:status': {
    args: []
    result: TakeoverStatusResultLike
  }
  'takeover:apply': {
    args: [app: string, modelRef: string]
    result: TakeoverMutationResultLike
  }
  'takeover:restore': {
    args: [app: string]
    result: TakeoverMutationResultLike
  }
  'providers:get': {
    args: []
    result: ProvidersConfigLike
  }
  'providers:upsert': {
    args: [provider: Record<string, unknown>]
    result: ProvidersConfigLike
  }
  'providers:delete': {
    args: [id: string]
    result: boolean
  }
  'providers:setEnabled': {
    args: [id: string, enabled: boolean]
    result: ProvidersConfigLike
  }
  'providers:setKey': {
    args: [id: string, key: string]
    result: ProvidersConfigLike
  }
  'providers:health': {
    args: [id: string]
    result: ProviderHealthLike
  }
  'providers:healthAll': {
    args: []
    result: Record<string, ProviderHealthResultLike>
  }
  'providers:fetchModels': {
    args: [id: string, override?: ProviderFetchModelsOverride]
    result: ProviderFetchModelsResult
  }
  'providers:reorderForClaude': {
    args: [orderedIds: string[]]
    result: ProvidersConfigLike
  }
  'routing:setBinding': {
    args: [binding: ProviderRouteBindingLike]
    result: ProviderRouteBindingLike[]
  }
  'routing:removeBinding': {
    args: [agentId: string]
    result: ProviderRouteBindingLike[]
  }
  'routing:setFallback': {
    args: [chain: string[]]
    result: ProviderRoutingConfigLike | undefined
  }
  'routing:setStrategy': {
    args: [strategy: string]
    result: ProviderRoutingConfigLike | undefined
  }
  'routing:setBindingThinking': {
    args: [agentId: string, thinking: ProviderThinkingConfig]
    result: ProviderRouteBindingLike[]
  }
  'routing:setProviderThinking': {
    args: [id: string, thinking: ProviderThinkingConfig]
    result: ProvidersConfigLike
  }
  'routing:activeBinding': {
    args: [agentId: string]
    result: string | null
  }
  'store:get': {
    args: [key: string, defaultValue?: StoreValueLike]
    result: StoreValueLike
  }
  'store:set': {
    args: [key: string, value: StoreValueLike]
    result: boolean
  }
  'conversation:exportMarkdown': {
    args: [data: ConversationExportDataLike]
    result: string
  }
  'conversation:exportHtml': {
    args: [data: ConversationExportDataLike]
    result: string
  }
  'conversation:exportFile': {
    args: [data: ConversationExportDataLike, format: ConversationExportFormatLike, path: string]
    result: ConversationExportFileResultLike
  }
  'conversation:importFile': {
    args: [filePath: string]
    result: ConversationImportResultLike
  }
  'conversation:importJson': {
    args: [json: string]
    result: ConversationImportResultLike
  }
  'conversation:branch': {
    args: [conversation: ImportedConversationLike, index: number]
    result: ConversationBranchResultLike
  }
  'conversation:summarize': {
    args: [conversation: ImportedConversationLike]
    result: ConversationSummaryLike
  }
  'agentLoop:getConfig': {
    args: []
    result: AgentLoopConfigLike
  }
  'agentLoop:getStatus': {
    args: []
    result: AgentLoopStatusLike
  }
  'agentLoop:getAgents': {
    args: []
    result: AgentLoopAgentLike[]
  }
  'agentLoop:refreshAgents': {
    args: []
    result: AgentLoopAgentLike[]
  }
  'agentLoop:getRouteInfo': {
    args: [prompt: string]
    result: AgentLoopRouteInfoLike
  }
  'models:list': {
    args: [providers?: ModelListProviderLike[]]
    result: ModelRouteInfoLike[]
  }
  'models:routeSettings:get': {
    args: []
    result: ModelRouteSettingsLike
  }
  'models:routeSettings:set': {
    args: [patch: Partial<ModelRouteSettingsLike>]
    result: ModelRouteSettingsLike
  }
  'models:updateRoute': {
    args: [providerId: string, modelId: string, patch: ModelRoutePatchLike]
    result: ModelListProviderModelLike | null
  }
  'models:test': {
    args: [input: ModelRouteTestInputLike]
    result: ModelRouteTestResultLike
  }
  'models:exportCodexCatalog': {
    args: []
    result: CodexCatalogExportResultLike
  }
  'models:toggleFavorite': {
    args: [providerId: string, modelId: string]
    result: boolean
  }
  'models:toggleHidden': {
    args: [providerId: string, modelId: string]
    result: boolean
  }
  'models:favorites': {
    args: []
    result: string[]
  }
  'models:hidden': {
    args: []
    result: string[]
  }
  'mcp:list': {
    args: [workspaceId?: string | null]
    result: McpServerConfigLike[]
  }
  'mcp:scanLocal': {
    args: [workspaceId?: string | null]
    result: McpServerConfigLike[]
  }
  'mcp:upsert': {
    args: [input: McpServerUpsertInputLike]
    result: McpServerConfigLike
  }
  'mcp:remove': {
    args: [id: string]
    result: boolean
  }
  'mcp:setEnabled': {
    args: [id: string, enabled: boolean, workspaceId?: string | null]
    result: McpServerConfigLike | null
  }
  'mcp:test': {
    args: [id: string, workspaceId?: string | null]
    result: McpServerConfigLike
  }
  'mcp:listTools': {
    args: [id: string, workspaceId?: string | null]
    result: McpServerToolsResultLike
  }
  'mcp:getSystemConfig': {
    args: []
    result: McpSystemConfigLike
  }
  'mcp:setSystemConfig': {
    args: [config: Partial<McpSystemConfigLike>]
    result: void
  }
  'mcp:setSystemEnabled': {
    args: [enabled: boolean]
    result: void
  }
  'worktrees:list': {
    args: [parentWorkspaceId?: string | null]
    result: WorktreeItemLike[]
  }
  'worktrees:create': {
    args: [input: WorktreeCreateInputLike]
    result: WorktreeItemLike
  }
  'worktrees:remove': {
    args: [id: string, force?: boolean]
    result: boolean
  }
  'worktrees:sync': {
    args: [id: string]
    result: WorktreeItemLike
  }
  'worktrees:open': {
    args: [id: string]
    result: WorkbenchWorkspaceLike
  }
  'workspaces:list': {
    args: []
    result: WorkbenchWorkspaceLike[]
  }
  'workspaces:create': {
    args: [input: WorkbenchWorkspaceCreateInputLike]
    result: WorkbenchWorkspaceLike
  }
  'workspaces:update': {
    args: [id: string, patch: WorkbenchWorkspaceUpdatePatchLike]
    result: WorkbenchWorkspaceLike
  }
  'workspaces:remove': {
    args: [id: string]
    result: boolean
  }
  'workspaces:getActive': {
    args: []
    result: string | null
  }
  'workspaces:setActive': {
    args: [id: string | null]
    result: string | null
  }
  'workflows:list': {
    args: [category?: WorkflowCategory]
    result: WorkflowDefinitionLike[]
  }
  'workflows:get': {
    args: [id: string]
    result: WorkflowDefinitionLike | null
  }
  'workflows:upsert': {
    args: [input: WorkflowUpsertInput]
    result: WorkflowDefinitionLike
  }
  'workflows:delete': {
    args: [id: string]
    result: boolean
  }
  'workflows:search': {
    args: [query: string]
    result: WorkflowDefinitionLike[]
  }
  'workflows:seed': {
    args: []
    result: WorkflowDefinitionLike[]
  }
  'plugins:scan': {
    args: [workspaceRoot?: string]
    result: PluginEntryLike[]
  }
  'plugins:validate': {
    args: [manifest: unknown]
    result: PluginValidationResult
  }
  'plugins:contributions': {
    args: [plugins: PluginEntryLike[]]
    result: PluginContributionsResult
  }
  'plugins:repositories': {
    args: []
    result: PluginRepositoryPresetLike[]
  }
  'plugins:importRepository': {
    args: [input: PluginRepositoryImportInput]
    result: PluginRepositoryImportResultLike
  }
  'plugins:install': {
    args: [manifest: PluginManifestLike & { id: string }]
    result: InstalledPluginLike
  }
  'plugins:uninstall': {
    args: [id: string]
    result: boolean
  }
  'plugins:toggle': {
    args: [id: string]
    result: boolean | null
  }
  'plugins:listInstalled': {
    args: []
    result: InstalledPluginLike[]
  }
  'plugins:enabledContributions': {
    args: []
    result: PluginContributionSet
  }
  'localAgents:detect': {
    args: []
    result: LocalAgentStatusLike[]
  }
  'localAgents:status': {
    args: []
    result: LocalAgentStatusLike[]
  }
  'localAgents:options': {
    args: []
    result: LocalAgentOptionLike[]
  }
  'localAgents:configure': {
    args: [agentId: string, patch: LocalAgentConfigurePatch]
    result: LocalAgentStatusLike[]
  }
  'localModels:scan': {
    args: [agentId?: string | null]
    result: LocalModelConfigLike[]
  }
  'localModels:readConfig': {
    args: [agentId: string]
    result: LocalModelConfigLike | null
  }
  'goals:get': {
    args: [threadId?: string | null]
    result: WorkbenchGoal | null
  }
  'goals:set': {
    args: [threadId: string, goal: string, loopLimit?: number]
    result: WorkbenchGoal
  }
  'goals:clear': {
    args: [threadId: string]
    result: WorkbenchGoal | null
  }
  'settings:getRunTimeout': {
    args: []
    result: RunTimeoutSettings
  }
  'settings:setRunTimeout': {
    args: [value: number]
    result: RunTimeoutSettings
  }
  'commands:list': {
    args: []
    result: WorkbenchCommand[]
  }
  'commands:run': {
    args: [input: WorkbenchCommandRunInput]
    result: WorkbenchCommand | null
  }
  'schedules:list': {
    args: []
    result: SchedulePreview[]
  }
  'schedules:runPreview': {
    args: [preset: DispatchPreset]
    result: SchedulePreview
  }
  'ecc:status': {
    args: []
    result: EccCommandStatus
  }
  'ecc:update': {
    args: []
    result: EccCommandStatus
  }
  'updates:status': {
    args: []
    result: UpdateStatus
  }
  'updates:check': {
    args: [channel?: UpdateChannel]
    result: UpdateStatus
  }
  'updates:setChannel': {
    args: [channel: UpdateChannel]
    result: UpdateStatus
  }
  'updates:download': {
    args: []
    result: UpdateStatus
  }
  'updates:install': {
    args: []
    result: UpdateStatus
  }
  'updates:openDownload': {
    args: []
    result: void
  }
  'routes:explain': {
    args: [turnId: string]
    result: Array<Record<string, unknown>>
  }
  'logs:path': {
    args: []
    result: { path: string }
  }
  'logs:recent': {
    args: [limit?: number]
    result: RecentAppEventLogsLike
  }
  'diagnostics:runSuite': {
    args: []
    result: DiagnosticReportLike
  }
  'diagnostics:run': {
    args: []
    result: LegacyDiagnosticSuiteLike
  }
  'projectMap:build': {
    args: [rootPath: string, maxDepth?: number]
    result: ProjectMapLike | null
  }
  'projectMap:search': {
    args: [map: ProjectMapLike, query: string]
    result: ProjectNodeLike[]
  }
  'github:checkCli': {
    args: []
    result: GitHubCliStatusLike
  }
  'github:listPrs': {
    args: [state?: GitHubListState, limit?: number]
    result: GitHubPrLike[]
  }
  'github:listIssues': {
    args: [state?: GitHubListState, limit?: number]
    result: GitHubIssueLike[]
  }
  'github:currentBranchPr': {
    args: []
    result: GitHubCurrentBranchPrLike
  }
  'release:checks': {
    args: []
    result: ReleaseReportLike
  }
  'git:status': {
    args: [workspaceId?: string | null]
    result: GitStatusLike
  }
  'git:branches': {
    args: [workspaceId?: string | null]
    result: GitBranchListResponseLike
  }
  'git:checkoutBranch': {
    args: [workspaceId: string | null, branch: string]
    result: GitStatusLike
  }
  'git:createBranch': {
    args: [workspaceId: string | null, branch: string, checkout?: boolean]
    result: GitStatusLike
  }
  'git:renameBranch': {
    args: [workspaceId: string | null, oldName: string, newName: string]
    result: GitBranchListResponseLike
  }
  'git:deleteBranch': {
    args: [workspaceId: string | null, branch: string, force?: boolean]
    result: GitBranchListResponseLike
  }
  'git:log': {
    args: [workspaceId?: string | null, limit?: number]
    result: GitLogResponseLike
  }
  'git:diff': {
    args: [workspaceId?: string | null, filePath?: string]
    result: string
  }
  'git:diffs': {
    args: [workspaceId?: string | null]
    result: GitFileDiffLike[]
  }
  'git:commitDetails': {
    args: [workspaceId: string | null, sha: string]
    result: GitCommitDetailsLike
  }
  'git:commitDiff': {
    args: [workspaceId: string | null, sha: string, filePath?: string]
    result: GitCommitDiffLike[]
  }
  'git:stageFile': {
    args: [workspaceId: string | null, filePath: string]
    result: GitStatusLike
  }
  'git:stageAll': {
    args: [workspaceId: string | null]
    result: GitStatusLike
  }
  'git:unstageFile': {
    args: [workspaceId: string | null, filePath: string]
    result: GitStatusLike
  }
  'git:revertFile': {
    args: [workspaceId: string | null, filePath: string]
    result: GitStatusLike
  }
  'git:revertAll': {
    args: [workspaceId: string | null]
    result: GitStatusLike
  }
  'git:commit': {
    args: [workspaceId: string | null, message: string, filePaths?: string[]]
    result: GitCommitResultLike
  }
  'git:fetch': {
    args: [workspaceId: string | null, remote?: string]
    result: GitStatusLike
  }
  'git:pull': {
    args: [workspaceId: string | null, remote?: string, branch?: string]
    result: GitStatusLike
  }
  'git:push': {
    args: [workspaceId: string | null, remote?: string, branch?: string]
    result: GitStatusLike
  }
  'git:sync': {
    args: [workspaceId: string | null]
    result: GitStatusLike
  }
  'git:updateBranch': {
    args: [workspaceId: string | null, branch: string]
    result: GitUpdateBranchResultLike
  }
  'git:query': {
    args: [input: GitQueryInputLike]
    result: GitQueryResultLike
  }
  'context:projection': {
    args: [input: ContextProjectionInputLike]
    result: ContextProjectionLike
  }
  'terminal:run': {
    args: [input: TerminalRunInputLike]
    result: TerminalRunLike
  }
  'terminal:cancel': {
    args: [runId: string]
    result: boolean
  }
  'terminal:history': {
    args: []
    result: TerminalRunLike[]
  }
  'terminal:create': {
    args: [payload: TerminalPtyCreateInputLike]
    result: TerminalPtyCreateResultLike
  }
  'terminal:write': {
    args: [payload: TerminalPtyWriteInputLike]
    result: void
  }
  'terminal:resize': {
    args: [payload: TerminalPtyResizeInputLike]
    result: void
  }
  'terminal:dispose': {
    args: [sessionId: string]
    result: void
  }
  'tasks:delete': {
    args: [taskId: string]
    result: boolean
  }
  'tasks:clearCompleted': {
    args: [workspaceId?: string | null]
    result: boolean
  }
  'skills:list': {
    args: []
    result: SkillDefLike[]
  }
  'skills:builtins': {
    args: []
    result: SkillInputLike[]
  }
  'skills:scanLocal': {
    args: []
    result: LocalSkillCandidateLike[]
  }
  'skills:importLocal': {
    args: [sourcePath: string]
    result: SkillDefLike
  }
  'skills:refreshLocal': {
    args: []
    result: LocalSkillCandidateLike[]
  }
  'skills:add': {
    args: [input: SkillInputLike]
    result: SkillDefLike
  }
  'skills:update': {
    args: [id: string, patch: SkillPatchLike]
    result: SkillDefLike | undefined
  }
  'skills:remove': {
    args: [id: string]
    result: boolean
  }
  'skills:getInstalls': {
    args: []
    result: SkillInstallsLike
  }
  'skills:install': {
    args: [agentId: string, skillId: string]
    result: SkillInstallsLike
  }
  'skills:uninstall': {
    args: [agentId: string, skillId: string]
    result: SkillInstallsLike
  }
  'agentic:capabilities': {
    args: []
    result: AgentCapabilityStateLike[]
  }
  'agentic:getEnabled': {
    args: []
    result: string[]
  }
  'agentic:setEnabled': {
    args: [agentId: string, on: boolean]
    result: string[]
  }
  'agentic:getMode': {
    args: []
    result: AgenticModeLike
  }
  'agentic:setMode': {
    args: [mode: AgenticModeLike]
    result: AgenticModeLike
  }
  'agentic:getApprovalConfig': {
    args: []
    result: AgenticApprovalConfigLike
  }
  'agentic:setApprovalPreset': {
    args: [preset: AgenticApprovalPresetLike]
    result: AgenticApprovalConfigLike
  }
  'agentic:setApprovalDefault': {
    args: [tool: AgenticGuardedToolLike, policy: AgenticApprovalPolicyLike]
    result: AgenticApprovalConfigLike
  }
  'agentic:setApprovalOverride': {
    args: [agentId: string, tool: AgenticGuardedToolLike, policy: AgenticApprovalPolicyLike | null]
    result: AgenticApprovalConfigLike
  }
  'agentic:resolveApproval': {
    args: [requestId: string, approved: boolean]
    result: boolean
  }
  'threads:list': {
    args: [workspaceId?: string | null]
    result: WorkbenchThreadLike[]
  }
  'threads:create': {
    args: [input: ThreadCreateInputLike]
    result: WorkbenchThreadLike
  }
  'threads:rename': {
    args: [threadId: string, title: string]
    result: WorkbenchThreadLike
  }
  'threads:delete': {
    args: [threadId: string]
    result: boolean
  }
  'threads:select': {
    args: [threadId: string | null]
    result: string | null
  }
  'threads:fork': {
    args: [input: ThreadForkInputLike]
    result: WorkbenchThreadLike
  }
  'turns:create': {
    args: [payload: TurnCreateInputLike]
    result: TurnCreateResultLike
  }
  'turns:retry': {
    args: [turnId: string]
    result: TurnCreateResultLike
  }
  'turns:cancel': {
    args: [turnId: string]
    result: boolean
  }
  'turns:cancelAgent': {
    args: [turnId: string, agentId: string]
    result: boolean
  }
  'turns:resolveGuard': {
    args: [requestId: string, approved: boolean]
    result: boolean
  }
  'runtime:snapshot': {
    args: [workspaceId?: string | null]
    result: WorkbenchSnapshotLike
  }
  'runtime:eventsSince': {
    args: [threadId: string, seq?: number]
    result: RuntimeEventLike[]
  }
  'shortcuts:list': {
    args: [category?: ShortcutCategory]
    result: ShortcutBindingLike[]
  }
  'shortcuts:get': {
    args: [id: string]
    result: ShortcutBindingLike | null
  }
  'shortcuts:update': {
    args: [id: string, key: string]
    result: ShortcutBindingLike | null
  }
  'shortcuts:reset': {
    args: [id: string]
    result: ShortcutBindingLike | null
  }
  'shortcuts:resetAll': {
    args: []
    result: void
  }
  'shortcuts:conflicts': {
    args: []
    result: ShortcutConflictLike[]
  }
  'slashCommands:list': {
    args: []
    result: SlashCommandLike[]
  }
  'slashCommands:get': {
    args: [shortcut: string]
    result: SlashCommandLike | null
  }
  'slashCommands:save': {
    args: [input: SlashCommandSaveInput]
    result: SlashCommandSaveResultLike
  }
  'slashCommands:delete': {
    args: [shortcut: string]
    result: boolean
  }
  'slashCommands:resolve': {
    args: [shortcut: string, params: SlashCommandParams]
    result: SlashCommandResolveResultLike
  }
  'slashCommands:validate': {
    args: [shortcut: string]
    result: SlashCommandValidationResultLike
  }
  'slashCommands:conflict': {
    args: [shortcut: string]
    result: SlashCommandConflictResultLike
  }
  'notifications:list': {
    args: [unreadOnly?: boolean]
    result: NotificationLike[]
  }
  'notifications:unreadCount': {
    args: []
    result: number
  }
  'notifications:push': {
    args: [input: NotificationPushInput]
    result: NotificationLike
  }
  'notifications:markRead': {
    args: [id: string]
    result: boolean
  }
  'notifications:markAllRead': {
    args: []
    result: number
  }
  'notifications:delete': {
    args: [id: string]
    result: boolean
  }
  'notifications:clearAll': {
    args: []
    result: void
  }
  'onboarding:getState': {
    args: []
    result: OnboardingStateLike
  }
  'onboarding:shouldShow': {
    args: []
    result: boolean
  }
  'onboarding:completeStep': {
    args: [step: OnboardingStepLike, skipped?: boolean]
    result: OnboardingStateLike
  }
  'onboarding:skipAll': {
    args: []
    result: void
  }
  'onboarding:reset': {
    args: []
    result: void
  }
  'onboarding:nextStep': {
    args: []
    result: OnboardingStepLike | null
  }
  'backup:create': {
    args: []
    result: BackupCreateResultLike
  }
  'backup:list': {
    args: []
    result: BackupMetaLike[]
  }
  'backup:restore': {
    args: [filename: string]
    result: BackupRestoreResultLike
  }
  'backup:delete': {
    args: [filename: string]
    result: boolean
  }
  'usage:stats': {
    args: [range?: UsageRange, view?: UsageView]
    result: UsageStatsLike
  }
  'usage:records': {
    args: [filter?: UsageRecordFilterLike, page?: number, pageSize?: number]
    result: PaginatedUsageRecordsLike
  }
  'usage:recordDetail': {
    args: [id: string]
    result: UsageRequestRecordLike | null
  }
  'usage:pricing:list': {
    args: []
    result: UsagePricingRuleLike[]
  }
  'usage:pricing:upsert': {
    args: [rule: Partial<UsagePricingRuleLike> & { modelId: string }]
    result: UsagePricingRuleLike
  }
  'usage:pricing:delete': {
    args: [idOrModelId: string, providerId?: string]
    result: boolean
  }
  'prompts:list': {
    args: [category?: PromptCategory]
    result: PromptEntryLike[]
  }
  'prompts:get': {
    args: [id: string]
    result: PromptEntryLike | null
  }
  'prompts:upsert': {
    args: [input: PromptUpsertInput]
    result: PromptEntryLike
  }
  'prompts:delete': {
    args: [id: string]
    result: boolean
  }
  'prompts:search': {
    args: [query: string]
    result: PromptEntryLike[]
  }
  'prompts:slashCommands': {
    args: []
    result: PromptEntryLike[]
  }
  'prompts:incrementUse': {
    args: [id: string]
    result: void
  }
  'prompts:seedDefaults': {
    args: []
    result: void
  }
  'memory:catalog': {
    args: []
    result: MemoryCatalogLike
  }
  'memory:getSettings': {
    args: []
    result: MemorySettingsStateLike
  }
  'memory:updateSettings': {
    args: [patch: Partial<MemorySettingsStateLike>]
    result: MemorySettingsStateLike
  }
  'memory:list': {
    args: [category?: MemoryCategoryLike]
    result: MemoryEntryLike[]
  }
  'memory:search': {
    args: [query: string, category?: MemoryCategoryLike]
    result: MemoryEntryLike[]
  }
  'memory:addEntry': {
    args: [entry: MemoryEntryInputLike]
    result: MemoryEntryLike
  }
  'memory:importConversation': {
    args: [source: string, content: string]
    result: MemoryEntryLike[]
  }
  'memory:listCandidates': {
    args: []
    result: MemoryEntryLike[]
  }
  'memory:approveCandidate': {
    args: [id: string]
    result: MemoryEntryLike | null
  }
  'memory:updateEntry': {
    args: [id: string, patch: MemoryEntryPatchLike]
    result: MemoryEntryLike | null
  }
  'memory:disableEntry': {
    args: [id: string]
    result: MemoryEntryLike | null
  }
  'memory:delete': {
    args: [id: string]
    result: boolean
  }
  'memory:restore': {
    args: [id: string]
    result: MemoryEntryLike | null
  }
  'memory:graph': {
    args: [entries: MemoryEntryLike[]]
    result: MemoryGraphLike
  }
  'memory:cleanupSuggestions': {
    args: [graph: MemoryGraphLike]
    result: MemoryGraphNodeLike[]
  }
  'memory:scoreQuality': {
    args: [entry: MemoryQualityInputLike]
    result: MemoryQualityScoreLike
  }
  'memory:detectConflicts': {
    args: [entries: MemoryConflictEntryLike[]]
    result: MemoryConflictLike[]
  }
  'budget:get': {
    args: []
    result: BudgetConfigLike
  }
  'budget:update': {
    args: [patch: BudgetConfigPatch]
    result: BudgetConfigLike
  }
  'budget:check': {
    args: [dailySpent: number, monthlySpent: number, requestTokens: number, requestCostUsd?: number]
    result: BudgetCheckResultLike
  }
  'budget:estimateDispatch': {
    args: [payload: TurnCreateInputLike]
    result: BudgetEstimateLike
  }
  'inlineEdit:buildPrompt': {
    args: [request: InlineEditRequestLike]
    result: string
  }
  'inlineEdit:validate': {
    args: [original: string, replacement: string]
    result: InlineEditValidationResultLike
  }
  'inlineEdit:apply': {
    args: [content: string, startLine: number, endLine: number, replacement: string]
    result: InlineEditApplyResultLike
  }
  'workflow:substituteVars': {
    args: [template: string, vars: WorkflowVariableLike[]]
    result: string
  }
  'workflow:evaluateCondition': {
    args: [condition: string, vars: WorkflowVariableLike[]]
    result: boolean
  }
  'workflow:saveRun': {
    args: [record: WorkflowRunRecordLike]
    result: boolean
  }
  'workflow:runHistory': {
    args: []
    result: WorkflowRunRecordLike[]
  }
  'workflow:runHistoryFor': {
    args: [workflowId: string]
    result: WorkflowRunRecordLike[]
  }
  'teams:list': {
    args: []
    result: TeamPresetLike[]
  }
  'teams:save': {
    args: [input: TeamPresetSaveInput]
    result: TeamPresetLike
  }
  'teams:delete': {
    args: [id: string]
    result: boolean
  }
  'teams:defaultFirefly': {
    args: [agentIds: string[]]
    result: TeamMemberLike[]
  }
  'knowledge:detectTechStack': {
    args: [rootPath: string]
    result: DetectedTechStackLike
  }
  'knowledge:generateSummary': {
    args: [rootPath: string, entries: ProjectKnowledgeEntryLike[]]
    result: string
  }
  'firefly:createState': {
    args: []
    result: FireflyStateLike
  }
  'firefly:completeRole': {
    args: [state: FireflyStateLike, role: FireflyRole, output: string]
    result: FireflyStateLike
  }
  'firefly:getRoleContext': {
    args: [state: FireflyStateLike, role: FireflyRole, prompt: string, memory?: string, project?: string]
    result: FireflyRoleContextLike
  }
  'firefly:isComplete': {
    args: [state: FireflyStateLike]
    result: boolean
  }
  'firefly:getOutput': {
    args: [state: FireflyStateLike]
    result: string | null
  }
  'terminalAi:buildPrompt': {
    args: [userPrompt: string, context: TerminalContextLike]
    result: string
  }
  'terminalAi:suggestCommand': {
    args: [intent: string, context: TerminalContextLike]
    result: string
  }
  'terminalAi:explainOutput': {
    args: [context: TerminalContextLike]
    result: string
  }
  'ai:quickComplete': {
    args: [input: QuickCompleteInputLike]
    result: QuickCompleteResultLike
  }
  'browser:open': {
    args: [input: BrowserOpenInputLike]
    result: BrowserSessionLike
  }
  'browser:capture': {
    args: [attachment: Partial<BrowserContextAttachmentLike>]
    result: BrowserContextAttachmentLike
  }
  'browser:summarize': {
    args: [snapshot: BrowserPageSnapshotLike]
    result: string
  }
  'browser:extractText': {
    args: [html: string]
    result: string
  }
  'browser:analyzePrompt': {
    args: [snapshot: BrowserPageSnapshotLike, request?: string]
    result: string
  }
  'todos:list': {
    args: [threadId: string]
    result: ThreadTodo[]
  }
  'todos:set': {
    args: [threadId: string, todos: ThreadTodoSetInput]
    result: ThreadTodo[]
  }
  'todos:upsert': {
    args: [input: ThreadTodoUpsertInput]
    result: ThreadTodo
  }
  'todos:delete': {
    args: [threadId: string, todoId: string]
    result: boolean
  }
  'todos:clear': {
    args: [threadId: string]
    result: boolean
  }
  'todos:syncFromMarkdown': {
    args: [threadId: string, markdown: string, sourceContext?: ThreadTodoSyncSourceContext]
    result: ThreadTodo[]
  }
  'workspaceFiles:list': {
    args: [rootPath: string, max?: number]
    result: WorkspaceFileEntry[]
  }
  'workspaceFiles:search': {
    args: [rootPath: string, query: string, max?: number]
    result: WorkspaceFileEntry[]
  }
  'workspaceFiles:preview': {
    args: [filePath: string, maxLines?: number]
    result: { ok: boolean; content?: string; error?: string }
  }
  'workspaceFiles:read': {
    args: [workspaceRoot: string, relPath: string]
    result: WorkspaceFileReadResult
  }
  'workspaceFiles:write': {
    args: [workspaceRoot: string, relPath: string, content: string]
    result: WorkspaceFileWriteResult
  }
  'workspaceFiles:readImage': {
    args: [workspaceRoot: string, relPath: string]
    result: WorkspaceImageReadResult
  }
  'workspaceFiles:listDirectory': {
    args: [workspaceRoot: string, relPath: string]
    result: WorkspaceDirectoryListResult
  }
  'sdd:createDraft': {
    args: [workspaceRoot: string, title: string, template?: string]
    result: SddDraft | null
  }
  'sdd:getDraft': {
    args: [workspaceRoot: string, draftId: string]
    result: SddDraft | null
  }
  'sdd:updateDraft': {
    args: [workspaceRoot: string, draftId: string, content: string]
    result: void
  }
  'sdd:updateDesignContext': {
    args: [workspaceRoot: string, draftId: string, designContext: SddDesignContext]
    result: void
  }
  'sdd:deleteDraft': {
    args: [workspaceRoot: string, draftId: string]
    result: void
  }
  'sdd:listDrafts': {
    args: [workspaceRoot: string]
    result: SddDraftMeta[]
  }
  'sdd:parseBlocks': {
    args: [content: string]
    result: unknown
  }
  'sdd:parsePlanCovers': {
    args: [planMarkdown: string]
    result: unknown
  }
  'sdd:computeTrace': {
    args: [workspaceRoot: string, draftId: string, planMarkdown?: string]
    result: SddTrace | null
  }
  'sdd:saveTrace': {
    args: [workspaceRoot: string, draftId: string, trace: SddTrace]
    result: void
  }
  'sdd:getTrace': {
    args: [workspaceRoot: string, draftId: string]
    result: SddTrace | null
  }
  'sdd:getHistory': {
    args: [workspaceRoot: string, draftId: string]
    result: SddDraftHistoryEntryLike[]
  }
  'sdd:saveHistory': {
    args: [workspaceRoot: string, draftId: string, entries: SddDraftHistoryEntryLike[]]
    result: void
  }
  'sdd:clearHistory': {
    args: [workspaceRoot: string, draftId: string]
    result: void
  }
  'sdd:exists': {
    args: [workspaceRoot: string, draftId: string]
    result: boolean
  }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<K extends IpcChannel> = IpcContract[K]['args']
export type IpcResult<K extends IpcChannel> = IpcContract[K]['result']

export interface IpcRuntimeValidationFailure {
  error: string
  respond: boolean
  response?: unknown
}

type IpcRuntimeValidator = (args: readonly unknown[]) => string | null
type IpcInvalidResponseFactory = (args: readonly unknown[], error: string) => unknown

interface IpcRuntimeValidationSpec {
  validate: IpcRuntimeValidator
  response?: IpcInvalidResponseFactory
}

export class IpcPayloadValidationError extends Error {
  readonly code = 'IPC_PAYLOAD_INVALID'
  readonly channel: string

  constructor(channel: string, reason: string) {
    const message = reason.startsWith('Invalid IPC payload: ') ? reason.slice('Invalid IPC payload: '.length) : reason
    super(`Invalid IPC payload for ${channel}: ${message}`)
    this.name = 'IpcPayloadValidationError'
    this.channel = channel
  }
}

const MAX_TERMINAL_DIMENSION = 1000
const MAX_TERMINAL_WRITE_CHARS = 256 * 1024
const MAX_MCP_STRING_CHARS = 8192
const MAX_MCP_ARGS = 128
const MAX_MCP_RECORD_ENTRIES = 128
const MAX_MCP_TIMEOUT_MS = 120_000
const MAX_PROVIDER_MODELS = 1000
const MAX_ROUTE_CHAIN = 128
const MAX_CODEX_SLOTS = 64
const MAX_PLUGIN_CONTRIBUTIONS = 256
const MAX_PLUGIN_DEPENDENCIES = 128
const MAX_BACKUP_FILENAME_CHARS = 160
const MAX_PROJECT_PATH_CHARS = 4096
const MAX_PROJECT_MAP_DEPTH = 16
const MAX_PROJECT_MAP_NODES = 10000
const MAX_PROJECT_LANGUAGE_ENTRIES = 512
const MAX_KNOWLEDGE_ENTRIES = 100
const MAX_KNOWLEDGE_ENTRY_CHARS = 64 * 1024
const MAX_THREAD_TODOS = 120
const MAX_TODO_CONTENT_CHARS = 2048
const MAX_TODO_MARKDOWN_CHARS = 256 * 1024
const MAX_WORKFLOW_STEPS = 64
const MAX_WORKFLOW_TAGS = 32
const MAX_WORKFLOW_STEP_DEPENDS = 32
const MAX_TEAM_MEMBERS = 16
const MAX_SYSTEM_PROMPT_CHARS = 64 * 1024
const MAX_PROMPT_BODY_CHARS = 256 * 1024
const MAX_PROMPT_TAGS = 32
const MAX_USAGE_QUERY_CHARS = 512
const MAX_USAGE_ID_CHARS = 512
const MAX_BUDGET_USD = 1_000_000
const MAX_BUDGET_TOKENS = 10_000_000
const MAX_GOAL_CHARS = 4000
const MAX_COMMAND_TEXT_CHARS = 8192
const MAX_COMMAND_ID_CHARS = 512
const MAX_NOTIFICATION_TEXT_CHARS = 4096
const MAX_INLINE_EDIT_TEXT_CHARS = 512 * 1024
const MAX_INLINE_EDIT_INSTRUCTION_CHARS = 4096
const MAX_SLASH_COMMAND_BODY_CHARS = 256 * 1024
const MAX_SLASH_COMMAND_PARAMS = 64
const MIN_RUN_TIMEOUT_MS = 60 * 1000
const MAX_RUN_TIMEOUT_MS = 60 * 60 * 1000
const MAX_WORKFLOW_VARIABLES = 128
const MAX_WORKFLOW_TEMPLATE_CHARS = 64 * 1024
const MAX_WORKFLOW_HISTORY_STEPS = 128
const MAX_WORKFLOW_OUTPUT_CHARS = 64 * 1024
const MAX_TERMINAL_CONTEXT_LINES = 200
const MAX_TERMINAL_CONTEXT_LINE_CHARS = 4096
const MAX_QUICK_COMPLETE_PROMPT_CHARS = 256 * 1024
const MAX_BROWSER_TEXT_CHARS = 512 * 1024
const MAX_BROWSER_LINKS = 512
const MAX_BROWSER_KEYWORDS = 128
const MAX_BROWSER_HEADINGS = 256
const MAX_BROWSER_FORMS = 64
const MAX_FIREFLY_STATE_TEXT_CHARS = 256 * 1024
const MAX_FIREFLY_LIST_ITEMS = 128
const MAX_TURN_PROMPT_CHARS = 512 * 1024
const MAX_TURN_ATTACHMENTS = 32
const MAX_ATTACHMENT_TEXT_CHARS = 512 * 1024
const MAX_ATTACHMENT_DATA_URL_CHARS = 8 * 1024 * 1024
const MAX_SCHEDULE_STEPS = 32
const MAX_SCHEDULE_DEPENDS = 32
const MAX_SKILL_NAME_CHARS = 120
const MAX_SKILL_DESCRIPTION_CHARS = 400
const MAX_SKILL_INSTRUCTIONS_CHARS = 40_000
const MAX_SKILL_TAGS = 12
const MAX_SKILL_TAG_CHARS = 40
const MAX_SKILL_SOURCE_CHARS = 400
const MAX_MEMORY_TITLE_CHARS = 512
const MAX_MEMORY_TEXT_CHARS = 256 * 1024
const MAX_MEMORY_TAGS = 32
const MAX_MEMORY_TAG_CHARS = 64
const MAX_MEMORY_METADATA_ENTRIES = 64
const MAX_MEMORY_GRAPH_ENTRIES = 1000
const MAX_MEMORY_GRAPH_EDGES = 5000
const MAX_STORE_VALUE_DEPTH = 6
const MAX_STORE_RECORD_ENTRIES = 256
const MAX_STORE_ARRAY_ITEMS = 1000
const MAX_CONTEXT_PINNED_BLOCKS = 128
const MAX_CONVERSATION_MESSAGES = 5000
const MAX_CONVERSATION_CONTENT_CHARS = 512 * 1024
const MAX_CONVERSATION_TOOL_CALLS = 128
const MAX_CONVERSATION_ATTACHMENTS = 128
const MAX_MODEL_LIST_PROVIDERS = 1000

const FIREFLY_ROLES = ['router', 'main', 'reviewer', 'executor', 'gatekeeper'] as const
const FIREFLY_PHASES = [
  'idle',
  'router_decision',
  'main_candidate',
  'review_verdict',
  'executor_actions',
  'gatekeeper_verdict',
  'final_release',
  'blocked',
  'error'
] as const
const DISPATCH_PRESETS = ['auto', 'broadcast', 'chain', 'orchestrate', 'lead-workers', 'parallel-review', 'firefly-custom', 'custom'] as const
const SCHEDULE_STEP_ROLES = ['lead', 'worker', 'reviewer', 'synthesizer', 'target', 'router', 'executor', 'gatekeeper'] as const
const SCHEDULE_STEP_MODES = ['auto', 'broadcast', 'chain', 'orchestrate'] as const
const SCHEDULE_ARTIFACT_MODES = ['summary', 'full', 'files', 'custom'] as const
const SCHEDULE_APPROVAL_POLICIES = ['inherit', 'auto', 'ask', 'require', 'skip'] as const
const AGENTIC_MODES = ['all', 'selected'] as const
const AGENTIC_APPROVAL_PRESETS = ['read-only', 'auto', 'full-access', 'ask-all', 'custom'] as const
const AGENTIC_GUARDED_TOOLS = ['write', 'exec'] as const
const AGENTIC_APPROVAL_POLICIES = ['allow', 'ask', 'deny'] as const
const MEMORY_CATEGORIES = [
  'conversation',
  'task',
  'skill',
  'file',
  'system',
  'preference',
  'project',
  'style',
  'decision',
  'correction',
  'imported_conversation'
] as const
const MEMORY_STATUSES = ['candidate', 'approved', 'disabled'] as const

function ipcError(reason: string): string {
  return `Invalid IPC payload: ${reason}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function validateString(value: unknown, label: string, options: { optional?: boolean; allowEmpty?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be a string`
  if (typeof value !== 'string') return `${label} must be a string`
  if (!options.allowEmpty && !value.trim()) return `${label} must not be empty`
  if (value.includes('\0')) return `${label} must not contain NUL bytes`
  return null
}

function validateStringArray(value: unknown, label: string, options: { optional?: boolean; allowEmpty?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an array`
  if (!Array.isArray(value)) return `${label} must be an array`
  for (const [index, item] of value.entries()) {
    const issue = validateString(item, `${label}[${index}]`, { allowEmpty: options.allowEmpty })
    if (issue) return issue
  }
  return null
}

function validateBoundedStringArray(
  value: unknown,
  label: string,
  options: { optional?: boolean; allowEmpty?: boolean; maxItems?: number; maxStringLength?: number } = {}
): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an array`
  if (!Array.isArray(value)) return `${label} must be an array`
  const maxItems = options.maxItems ?? MAX_MCP_ARGS
  if (value.length > maxItems) return `${label} must contain at most ${maxItems} items`
  for (const [index, item] of value.entries()) {
    const issue = validateBoundedString(item, `${label}[${index}]`, {
      allowEmpty: options.allowEmpty,
      max: options.maxStringLength ?? MAX_MCP_STRING_CHARS
    })
    if (issue) return issue
  }
  return null
}

function validateBoolean(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be a boolean`
  return typeof value === 'boolean' ? null : `${label} must be a boolean`
}

function validateNumber(
  value: unknown,
  label: string,
  options: { optional?: boolean; integer?: boolean; min?: number; max?: number } = {}
): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be a number`
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a finite number`
  if (options.integer && !Number.isInteger(value)) return `${label} must be an integer`
  if (options.min !== undefined && value < options.min) return `${label} must be at least ${options.min}`
  if (options.max !== undefined && value > options.max) return `${label} must be at most ${options.max}`
  return null
}

function validateRecord(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  return isRecord(value) ? null : `${label} must be an object`
}

function validateNoArgs(args: readonly unknown[]): string | null {
  return args.length === 0 ? null : 'expected no arguments'
}

function validateWorkspaceId(value: unknown, label = 'workspaceId', options: { optional?: boolean } = {}): string | null {
  if (value === null) return null
  if (value === undefined) return options.optional ? null : `${label} must be a string or null`
  return validateString(value, label)
}

function validateEnum(value: unknown, label: string, allowed: readonly string[], options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be one of: ${allowed.join(', ')}`
  if (typeof value !== 'string') return `${label} must be one of: ${allowed.join(', ')}`
  return allowed.includes(value) ? null : `${label} must be one of: ${allowed.join(', ')}`
}

function validateBoundedString(value: unknown, label: string, options: { optional?: boolean; allowEmpty?: boolean; max?: number } = {}): string | null {
  const issue = validateString(value, label, { optional: options.optional, allowEmpty: options.allowEmpty })
  if (issue || value === undefined || value === null) return issue
  const max = options.max ?? MAX_MCP_STRING_CHARS
  return typeof value === 'string' && value.length > max ? `${label} must be at most ${max} characters` : null
}

function validateOptionalPath(value: unknown, label: string): string | null {
  return validateString(value, label, { optional: true, allowEmpty: true })
}

function validateAppPathInput(args: readonly unknown[], label: string, options: { openTarget?: boolean } = {}): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, label)
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  const baseIssue = validateString(record.path, `${label}.path`) || validateOptionalPath(record.workspaceRoot, `${label}.workspaceRoot`)
  if (baseIssue || !options.openTarget) return baseIssue
  return (
    validateString(record.target, `${label}.target`, { optional: true, allowEmpty: true }) ||
    validateNumber(record.line, `${label}.line`, { optional: true, integer: true, min: 1 }) ||
    validateNumber(record.column, `${label}.column`, { optional: true, integer: true, min: 1 })
  )
}

function validatePickOptions(args: readonly unknown[], label: string): string | null {
  const options = args[0]
  if (options === undefined || options === null) return null
  const recordIssue = validateRecord(options, label)
  if (recordIssue) return recordIssue
  return validateOptionalPath((options as Record<string, unknown>).defaultPath, `${label}.defaultPath`)
}

function validateWorkspaceFileArgs(
  args: readonly unknown[],
  options: { includeContent?: boolean; allowEmptyRelPath?: boolean } = {}
): string | null {
  return (
    validateString(args[0], 'workspaceRoot') ||
    validateString(args[1], 'relPath', { allowEmpty: options.allowEmptyRelPath }) ||
    (options.includeContent ? validateString(args[2], 'content', { allowEmpty: true }) : null)
  )
}

function validateWorkspaceListArgs(args: readonly unknown[], includeQuery = false): string | null {
  return (
    validateString(args[0], 'rootPath') ||
    (includeQuery ? validateString(args[1], 'query', { allowEmpty: true }) : null) ||
    validateNumber(args[includeQuery ? 2 : 1], 'max', { optional: true, integer: true, min: 1, max: 10000 })
  )
}

function validateBackupFilename(value: unknown, label = 'filename'): string | null {
  const issue = validateBoundedString(value, label, { max: MAX_BACKUP_FILENAME_CHARS })
  if (issue) return issue
  const filename = value as string
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return `${label} must not contain path separators or traversal`
  }
  return /^agenthub-backup-[A-Za-z0-9._-]+\.json$/.test(filename)
    ? null
    : `${label} must be an AgentHub backup JSON filename`
}

function validateProjectRootPath(value: unknown, label = 'rootPath'): string | null {
  return validateBoundedString(value, label, { max: MAX_PROJECT_PATH_CHARS })
}

function validateProjectMapBuild(args: readonly unknown[]): string | null {
  return (
    validateProjectRootPath(args[0]) ||
    validateNumber(args[1], 'maxDepth', { optional: true, integer: true, min: 0, max: MAX_PROJECT_MAP_DEPTH })
  )
}

function validateProjectLanguages(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_PROJECT_LANGUAGE_ENTRIES) {
    return `${label} must contain at most ${MAX_PROJECT_LANGUAGE_ENTRIES} entries`
  }
  for (const [language, count] of entries) {
    const issue = (
      validateBoundedString(language, `${label} key`, { max: 256 }) ||
      validateNumber(count, `${label}.${language}`, { integer: true, min: 0 })
    )
    if (issue) return issue
  }
  return null
}

function validateProjectNodeArray(
  value: unknown,
  label: string,
  state: { count: number },
  depth = 0
): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (depth > MAX_PROJECT_MAP_DEPTH) return `${label} must be at most ${MAX_PROJECT_MAP_DEPTH} levels deep`
  if (state.count + value.length > MAX_PROJECT_MAP_NODES) {
    return `map.nodes must contain at most ${MAX_PROJECT_MAP_NODES} items`
  }
  state.count += value.length
  for (const [index, node] of value.entries()) {
    const nodeLabel = `${label}[${index}]`
    const recordIssue = validateRecord(node, nodeLabel)
    if (recordIssue) return recordIssue
    const record = node as Record<string, unknown>
    const fieldIssue = (
      validateBoundedString(record.name, `${nodeLabel}.name`, { max: 512 }) ||
      validateBoundedString(record.path, `${nodeLabel}.path`, { max: MAX_PROJECT_PATH_CHARS }) ||
      validateEnum(record.type, `${nodeLabel}.type`, ['file', 'directory']) ||
      validateBoundedString(record.extension, `${nodeLabel}.extension`, { optional: true, allowEmpty: true, max: 64 }) ||
      validateNumber(record.sizeBytes, `${nodeLabel}.sizeBytes`, { optional: true, integer: true, min: 0 }) ||
      validateBoundedString(record.language, `${nodeLabel}.language`, { optional: true, allowEmpty: true, max: 256 })
    )
    if (fieldIssue) return fieldIssue
    if (record.children !== undefined && record.children !== null) {
      const childIssue = validateProjectNodeArray(record.children, `${nodeLabel}.children`, state, depth + 1)
      if (childIssue) return childIssue
    }
  }
  return null
}

function validateProjectMap(value: unknown, label = 'map'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const baseIssue = (
    validateProjectRootPath(record.root, `${label}.root`) ||
    validateProjectNodeArray(record.nodes, `${label}.nodes`, { count: 0 })
  )
  if (baseIssue) return baseIssue
  const statsIssue = validateRecord(record.stats, `${label}.stats`)
  if (statsIssue) return statsIssue
  const stats = record.stats as Record<string, unknown>
  return (
    validateNumber(stats.totalFiles, `${label}.stats.totalFiles`, { integer: true, min: 0 }) ||
    validateNumber(stats.totalDirectories, `${label}.stats.totalDirectories`, { integer: true, min: 0 }) ||
    validateNumber(stats.totalSize, `${label}.stats.totalSize`, { integer: true, min: 0 }) ||
    validateProjectLanguages(stats.languages, `${label}.stats.languages`)
  )
}

function validateProjectMapSearch(args: readonly unknown[]): string | null {
  return validateProjectMap(args[0]) || validateBoundedString(args[1], 'query', { allowEmpty: true, max: 512 })
}

function validateKnowledgeEntries(value: unknown, label = 'entries'): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_KNOWLEDGE_ENTRIES) return `${label} must contain at most ${MAX_KNOWLEDGE_ENTRIES} items`
  for (const [index, entry] of value.entries()) {
    const entryLabel = `${label}[${index}]`
    const recordIssue = validateRecord(entry, entryLabel)
    if (recordIssue) return recordIssue
    const record = entry as Record<string, unknown>
    const fieldIssue = (
      validateBoundedString(record.title, `${entryLabel}.title`, { max: 512 }) ||
      validateBoundedString(record.content, `${entryLabel}.content`, { allowEmpty: true, max: MAX_KNOWLEDGE_ENTRY_CHARS }) ||
      validateBoundedString(record.category, `${entryLabel}.category`, { max: 256 })
    )
    if (fieldIssue) return fieldIssue
  }
  return null
}

function validateThreadTodoStatus(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  return validateEnum(value, label, ['pending', 'in_progress', 'completed'], options)
}

function validateThreadTodoSource(value: unknown, label = 'source', options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.kind, `${label}.kind`, ['manual', 'plan', 'agent']) ||
    validateBoundedString(record.threadId, `${label}.threadId`, { optional: true, max: 256 }) ||
    validateBoundedString(record.turnId, `${label}.turnId`, { optional: true, max: 256 }) ||
    validateBoundedString(record.gitHeadAtDispatch, `${label}.gitHeadAtDispatch`, { optional: true, allowEmpty: true, max: 128 }) ||
    validateBoundedString(record.gitRootAtDispatch, `${label}.gitRootAtDispatch`, { optional: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateBoundedString(record.relativePath, `${label}.relativePath`, { optional: true, allowEmpty: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateBoundedString(record.contentHash, `${label}.contentHash`, { optional: true, max: 128 }) ||
    validateBoundedString(record.workspaceRoot, `${label}.workspaceRoot`, { optional: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateBoundedString(record.draftId, `${label}.draftId`, { optional: true, max: 256 }) ||
    validateBoundedString(record.planItemId, `${label}.planItemId`, { optional: true, max: 256 })
  )
}

function validateThreadTodoSetItem(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.id, `${label}.id`, { optional: true, max: 256 }) ||
    validateBoundedString(record.content, `${label}.content`, { max: MAX_TODO_CONTENT_CHARS }) ||
    validateThreadTodoStatus(record.status, `${label}.status`) ||
    validateThreadTodoSource(record.source, `${label}.source`, { optional: true })
  )
}

function validateThreadTodoSet(args: readonly unknown[]): string | null {
  const threadIssue = validateString(args[0], 'threadId')
  if (threadIssue) return threadIssue
  const todos = args[1]
  if (!Array.isArray(todos)) return 'todos must be an array'
  if (todos.length > MAX_THREAD_TODOS) return `todos must contain at most ${MAX_THREAD_TODOS} items`
  for (const [index, todo] of todos.entries()) {
    const issue = validateThreadTodoSetItem(todo, `todos[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateThreadTodoUpsert(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateString(record.threadId, 'input.threadId') ||
    validateBoundedString(record.id, 'input.id', { optional: true, max: 256 }) ||
    validateBoundedString(record.content, 'input.content', { max: MAX_TODO_CONTENT_CHARS }) ||
    validateThreadTodoStatus(record.status, 'input.status', { optional: true }) ||
    validateThreadTodoSource(record.source, 'input.source', { optional: true })
  )
}

function validateThreadTodoSyncSource(value: unknown, label = 'sourceContext'): string | null {
  if (value === undefined || value === null) return null
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.workspaceRoot, `${label}.workspaceRoot`, { optional: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateBoundedString(record.draftId, `${label}.draftId`, { optional: true, max: 256 }) ||
    validateBoundedString(record.relativePath, `${label}.relativePath`, { optional: true, allowEmpty: true, max: MAX_PROJECT_PATH_CHARS })
  )
}

function validateThreadTodoSync(args: readonly unknown[]): string | null {
  return (
    validateString(args[0], 'threadId') ||
    validateBoundedString(args[1], 'markdown', { allowEmpty: true, max: MAX_TODO_MARKDOWN_CHARS }) ||
    validateThreadTodoSyncSource(args[2])
  )
}

function validateWorkflowStep(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const baseIssue = (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateEnum(record.type, `${label}.type`, ['prompt', 'agent', 'skill', 'review', 'gate']) ||
    validateBoundedString(record.label, `${label}.label`, { max: 512 }) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { optional: true, max: 256 }) ||
    validateBoundedString(record.prompt, `${label}.prompt`, { optional: true, allowEmpty: true, max: MAX_SYSTEM_PROMPT_CHARS }) ||
    validateBoundedString(record.skillId, `${label}.skillId`, { optional: true, max: 256 }) ||
    validateBoolean(record.requiresApproval, `${label}.requiresApproval`, { optional: true })
  )
  if (baseIssue) return baseIssue
  if (record.dependsOn === undefined || record.dependsOn === null) return null
  return validateBoundedStringArray(record.dependsOn, `${label}.dependsOn`, {
    maxItems: MAX_WORKFLOW_STEP_DEPENDS,
    maxStringLength: 256
  })
}

function validateWorkflowSteps(value: unknown, label = 'input.steps'): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_WORKFLOW_STEPS) return `${label} must contain at most ${MAX_WORKFLOW_STEPS} items`
  for (const [index, step] of value.entries()) {
    const issue = validateWorkflowStep(step, `${label}[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateWorkflowUpsert(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.id, 'input.id', { optional: true, max: 256 }) ||
    validateBoundedString(record.name, 'input.name', { max: 512 }) ||
    validateBoundedString(record.description, 'input.description', { optional: true, allowEmpty: true, max: 4096 }) ||
    validateEnum(record.category, 'input.category', ['development', 'review', 'research', 'deployment', 'custom'], { optional: true }) ||
    validateWorkflowSteps(record.steps) ||
    validateBoundedStringArray(record.tags, 'input.tags', { optional: true, allowEmpty: true, maxItems: MAX_WORKFLOW_TAGS, maxStringLength: 128 }) ||
    validateBoolean(record.pinned, 'input.pinned', { optional: true })
  )
}

function validateTeamMember(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.role, `${label}.role`, ['main', 'router', 'reviewer', 'executor', 'gatekeeper', 'summarizer', 'expert']) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { max: 256 }) ||
    validateBoundedString(record.systemPrompt, `${label}.systemPrompt`, { optional: true, allowEmpty: true, max: MAX_SYSTEM_PROMPT_CHARS })
  )
}

function validateTeamMembers(value: unknown, label = 'input.members'): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_TEAM_MEMBERS) return `${label} must contain at most ${MAX_TEAM_MEMBERS} items`
  for (const [index, member] of value.entries()) {
    const issue = validateTeamMember(member, `${label}[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateTeamPresetSave(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.id, 'input.id', { optional: true, max: 256 }) ||
    validateBoundedString(record.name, 'input.name', { max: 512 }) ||
    validateBoundedString(record.description, 'input.description', { optional: true, allowEmpty: true, max: 4096 }) ||
    validateTeamMembers(record.members)
  )
}

function validatePromptShortcut(value: unknown, label: string): string | null {
  const issue = validateBoundedString(value, label, { optional: true, max: 128 })
  if (issue || value === undefined || value === null) return issue
  return /^\/[^\s/][^\s]*$/.test(value as string) ? null : `${label} must start with / and contain no whitespace`
}

function validatePromptUpsert(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.id, 'input.id', { optional: true, max: 256 }) ||
    validateBoundedString(record.name, 'input.name', { max: 512 }) ||
    validateBoundedString(record.body, 'input.body', { allowEmpty: true, max: MAX_PROMPT_BODY_CHARS }) ||
    validateEnum(record.category, 'input.category', ['general', 'coding', 'review', 'research', 'writing', 'custom'], { optional: true }) ||
    validateBoundedStringArray(record.tags, 'input.tags', { optional: true, allowEmpty: true, maxItems: MAX_PROMPT_TAGS, maxStringLength: 128 }) ||
    validateBoolean(record.isSlashCommand, 'input.isSlashCommand', { optional: true }) ||
    validatePromptShortcut(record.shortcut, 'input.shortcut')
  )
}

function validateNullableNumber(
  value: unknown,
  label: string,
  options: { optional?: boolean; integer?: boolean; min?: number; max?: number } = {}
): string | null {
  if (value === null) return null
  return validateNumber(value, label, options)
}

function validateUsageFilter(value: unknown, label = 'filter'): string | null {
  if (value === undefined || value === null) return null
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.range, `${label}.range`, ['all', '90d', '30d', '7d'], { optional: true }) ||
    validateNumber(record.from, `${label}.from`, { optional: true, integer: true, min: 0 }) ||
    validateNumber(record.to, `${label}.to`, { optional: true, integer: true, min: 0 }) ||
    validateBoundedString(record.threadId, `${label}.threadId`, { optional: true, max: MAX_USAGE_ID_CHARS }) ||
    validateBoundedString(record.providerId, `${label}.providerId`, { optional: true, max: MAX_USAGE_ID_CHARS }) ||
    validateBoundedString(record.modelId, `${label}.modelId`, { optional: true, max: MAX_USAGE_ID_CHARS }) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { optional: true, max: MAX_USAGE_ID_CHARS }) ||
    validateEnum(record.source, `${label}.source`, ['actual', 'estimated', 'none', 'all'], { optional: true }) ||
    validateEnum(record.status, `${label}.status`, ['completed', 'failed', 'cancelled', 'all'], { optional: true }) ||
    validateBoundedString(record.query, `${label}.query`, { optional: true, allowEmpty: true, max: MAX_USAGE_QUERY_CHARS }) ||
    validateEnum(record.sortBy, `${label}.sortBy`, ['createdAt', 'tokens', 'cost', 'latencyMs'], { optional: true }) ||
    validateEnum(record.sortDir, `${label}.sortDir`, ['asc', 'desc'], { optional: true })
  )
}

function validateUsagePricingRule(args: readonly unknown[]): string | null {
  const rule = args[0]
  const recordIssue = validateRecord(rule, 'rule')
  if (recordIssue) return recordIssue
  const record = rule as Record<string, unknown>
  return (
    validateBoundedString(record.modelId, 'rule.modelId', { max: MAX_USAGE_ID_CHARS }) ||
    validateBoundedString(record.id, 'rule.id', { optional: true, max: MAX_USAGE_ID_CHARS }) ||
    validateBoundedString(record.providerId, 'rule.providerId', { optional: true, max: MAX_USAGE_ID_CHARS }) ||
    validateBoundedString(record.displayName, 'rule.displayName', { optional: true, allowEmpty: true, max: 512 }) ||
    validateNumber(record.inputUsdPerMillion, 'rule.inputUsdPerMillion', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(record.outputUsdPerMillion, 'rule.outputUsdPerMillion', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(record.cacheReadUsdPerMillion, 'rule.cacheReadUsdPerMillion', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(record.cacheCreationUsdPerMillion, 'rule.cacheCreationUsdPerMillion', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(record.createdAt, 'rule.createdAt', { optional: true, integer: true, min: 0 }) ||
    validateNumber(record.updatedAt, 'rule.updatedAt', { optional: true, integer: true, min: 0 })
  )
}

function validateBudgetPatch(args: readonly unknown[]): string | null {
  const patch = args[0]
  const recordIssue = validateRecord(patch, 'patch')
  if (recordIssue) return recordIssue
  const record = patch as Record<string, unknown>
  return (
    validateNumber(record.version, 'patch.version', { optional: true, integer: true, min: 1, max: 1 }) ||
    validateNullableNumber(record.dailyLimitUsd, 'patch.dailyLimitUsd', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNullableNumber(record.monthlyLimitUsd, 'patch.monthlyLimitUsd', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNullableNumber(record.perRequestMaxTokens, 'patch.perRequestMaxTokens', { optional: true, integer: true, min: 0, max: MAX_BUDGET_TOKENS }) ||
    validateNullableNumber(record.perRequestMaxCostUsd, 'patch.perRequestMaxCostUsd', { optional: true, min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(record.notifyAtPercent, 'patch.notifyAtPercent', { optional: true, min: 0, max: 100 }) ||
    validateBoolean(record.blockWhenExceeded, 'patch.blockWhenExceeded', { optional: true }) ||
    validateBoolean(record.suggestCheaperModel, 'patch.suggestCheaperModel', { optional: true })
  )
}

function validateBudgetCheck(args: readonly unknown[]): string | null {
  return (
    validateNumber(args[0], 'dailySpent', { min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(args[1], 'monthlySpent', { min: 0, max: MAX_BUDGET_USD }) ||
    validateNumber(args[2], 'requestTokens', { integer: true, min: 0, max: MAX_BUDGET_TOKENS }) ||
    validateNumber(args[3], 'requestCostUsd', { optional: true, min: 0, max: MAX_BUDGET_USD })
  )
}

function validateOptionalGoalThreadId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return validateString(value, 'threadId')
}

function validateGoalSet(args: readonly unknown[]): string | null {
  return (
    validateString(args[0], 'threadId') ||
    validateBoundedString(args[1], 'goal', { max: MAX_GOAL_CHARS }) ||
    validateNumber(args[2], 'loopLimit', { optional: true, integer: true, min: 1, max: 20 })
  )
}

function validateCommandRunInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.id, 'input.id', { optional: true, max: MAX_COMMAND_ID_CHARS }) ||
    validateBoundedString(record.text, 'input.text', { optional: true, allowEmpty: true, max: MAX_COMMAND_TEXT_CHARS })
  )
}

function validateNotificationAction(value: unknown, label = 'input.action'): string | null {
  if (value === undefined || value === null) return null
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const typeIssue = validateEnum(record.type, `${label}.type`, ['navigate', 'open-url'])
  if (typeIssue) return typeIssue
  if (record.type === 'navigate') {
    return validateBoundedString(record.target, `${label}.target`, { max: 512 })
  }
  const urlIssue = validateBoundedString(record.url, `${label}.url`, { max: 4096 })
  if (urlIssue) return urlIssue
  try {
    const url = new URL(record.url as string)
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : `${label}.url must use http or https`
  } catch {
    return `${label}.url must be a valid URL`
  }
}

function validateNotificationPush(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.title, 'input.title', { max: 512 }) ||
    validateBoundedString(record.body, 'input.body', { allowEmpty: true, max: MAX_NOTIFICATION_TEXT_CHARS }) ||
    validateEnum(record.category, 'input.category', ['task', 'approval', 'mcp', 'system', 'workflow', 'memory', 'error']) ||
    validateNotificationAction(record.action)
  )
}

function validateOnboardingStep(value: unknown, label = 'step'): string | null {
  return validateEnum(value, label, [
    'select-language',
    'bind-provider',
    'detect-agents',
    'choose-default-agent',
    'test-mcp',
    'enable-skills',
    'create-workspace',
    'send-first-message'
  ])
}

function validateInlineEditRange(value: unknown, label = 'request.range'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const baseIssue = (
    validateBoundedString(record.filePath, `${label}.filePath`, { allowEmpty: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateNumber(record.startLine, `${label}.startLine`, { integer: true, min: 1 }) ||
    validateNumber(record.endLine, `${label}.endLine`, { integer: true, min: 1 }) ||
    validateBoundedString(record.selectedText, `${label}.selectedText`, { allowEmpty: true, max: MAX_INLINE_EDIT_TEXT_CHARS }) ||
    validateBoundedString(record.fullContent, `${label}.fullContent`, { optional: true, allowEmpty: true, max: MAX_INLINE_EDIT_TEXT_CHARS })
  )
  if (baseIssue) return baseIssue
  return (record.endLine as number) >= (record.startLine as number)
    ? null
    : `${label}.endLine must be greater than or equal to ${label}.startLine`
}

function validateInlineEditBuildPrompt(args: readonly unknown[]): string | null {
  const request = args[0]
  const recordIssue = validateRecord(request, 'request')
  if (recordIssue) return recordIssue
  const record = request as Record<string, unknown>
  return (
    validateInlineEditRange(record.range) ||
    validateBoundedString(record.instruction, 'request.instruction', { max: MAX_INLINE_EDIT_INSTRUCTION_CHARS }) ||
    validateBoundedString(record.providerId, 'request.providerId', { optional: true, allowEmpty: true, max: 256 }) ||
    validateBoundedString(record.modelId, 'request.modelId', { optional: true, allowEmpty: true, max: 512 })
  )
}

function validateInlineEditApply(args: readonly unknown[]): string | null {
  const lineIssue = (
    validateBoundedString(args[0], 'content', { allowEmpty: true, max: MAX_INLINE_EDIT_TEXT_CHARS }) ||
    validateNumber(args[1], 'startLine', { integer: true, min: 1 }) ||
    validateNumber(args[2], 'endLine', { integer: true, min: 1 }) ||
    validateBoundedString(args[3], 'replacement', { allowEmpty: true, max: MAX_INLINE_EDIT_TEXT_CHARS })
  )
  if (lineIssue) return lineIssue
  return (args[2] as number) >= (args[1] as number)
    ? null
    : 'endLine must be greater than or equal to startLine'
}

function validateShortcutKey(value: unknown, label = 'key'): string | null {
  return validateBoundedString(value, label, { max: 128 })
}

function validateSlashShortcut(value: unknown, label = 'shortcut'): string | null {
  const issue = validateBoundedString(value, label, { max: 32 })
  if (issue) return issue
  const shortcut = value as string
  if (!shortcut.startsWith('/')) return `${label} must start with /`
  if (shortcut.length < 2) return `${label} must have at least one character after /`
  return /^\/[a-z0-9_-]+$/i.test(shortcut)
    ? null
    : `${label} can only contain letters, numbers, hyphens, and underscores`
}

function validateSlashCommandSave(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.id, 'input.id', { optional: true, max: 256 }) ||
    validateSlashShortcut(record.shortcut, 'input.shortcut') ||
    validateBoundedString(record.name, 'input.name', { max: 512 }) ||
    validateBoundedString(record.body, 'input.body', { max: MAX_SLASH_COMMAND_BODY_CHARS }) ||
    validateBoundedString(record.category, 'input.category', { optional: true, max: 128 })
  )
}

function validateSlashCommandParams(value: unknown, label = 'params'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_SLASH_COMMAND_PARAMS) return `${label} must contain at most ${MAX_SLASH_COMMAND_PARAMS} entries`
  for (const [key, paramValue] of entries) {
    if (!/^\w+$/.test(key)) return `${label}.${key} key must contain only letters, numbers, and underscores`
    const issue = validateBoundedString(paramValue, `${label}.${key}`, { allowEmpty: true, max: 4096 })
    if (issue) return issue
  }
  return null
}

function validateWorkflowVariables(value: unknown, label = 'vars'): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_WORKFLOW_VARIABLES) return `${label} must contain at most ${MAX_WORKFLOW_VARIABLES} items`
  for (const [index, variable] of value.entries()) {
    const itemLabel = `${label}[${index}]`
    const recordIssue = validateRecord(variable, itemLabel)
    if (recordIssue) return recordIssue
    const record = variable as Record<string, unknown>
    const issue = (
      validateBoundedString(record.name, `${itemLabel}.name`, { max: 128 }) ||
      validateBoundedString(record.value, `${itemLabel}.value`, { allowEmpty: true, max: 8192 }) ||
      validateEnum(record.type, `${itemLabel}.type`, ['string', 'number', 'boolean'])
    )
    if (issue) return issue
  }
  return null
}

function validateWorkflowStepResults(value: unknown, label = 'record.stepResults'): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_WORKFLOW_HISTORY_STEPS) return `${label} must contain at most ${MAX_WORKFLOW_HISTORY_STEPS} items`
  for (const [index, step] of value.entries()) {
    const itemLabel = `${label}[${index}]`
    const recordIssue = validateRecord(step, itemLabel)
    if (recordIssue) return recordIssue
    const record = step as Record<string, unknown>
    const issue = (
      validateBoundedString(record.stepId, `${itemLabel}.stepId`, { max: 256 }) ||
      validateBoundedString(record.status, `${itemLabel}.status`, { max: 64 }) ||
      validateBoundedString(record.output, `${itemLabel}.output`, { optional: true, allowEmpty: true, max: MAX_WORKFLOW_OUTPUT_CHARS }) ||
      validateBoundedString(record.error, `${itemLabel}.error`, { optional: true, allowEmpty: true, max: MAX_WORKFLOW_OUTPUT_CHARS })
    )
    if (issue) return issue
  }
  return null
}

function validateWorkflowRunRecord(args: readonly unknown[]): string | null {
  const recordValue = args[0]
  const recordIssue = validateRecord(recordValue, 'record')
  if (recordIssue) return recordIssue
  const record = recordValue as Record<string, unknown>
  return (
    validateBoundedString(record.workflowId, 'record.workflowId', { max: 256 }) ||
    validateBoundedString(record.runId, 'record.runId', { max: 256 }) ||
    validateBoundedString(record.workflowName, 'record.workflowName', { max: 512 }) ||
    validateBoundedString(record.startedAt, 'record.startedAt', { max: 128 }) ||
    validateBoundedString(record.completedAt, 'record.completedAt', { optional: true, max: 128 }) ||
    validateEnum(record.status, 'record.status', ['running', 'succeeded', 'failed', 'cancelled']) ||
    validateWorkflowStepResults(record.stepResults)
  )
}

function validateTerminalContext(value: unknown, label = 'context'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedStringArray(record.recentCommands, `${label}.recentCommands`, { maxItems: MAX_TERMINAL_CONTEXT_LINES, maxStringLength: MAX_TERMINAL_CONTEXT_LINE_CHARS, allowEmpty: true }) ||
    validateBoundedStringArray(record.recentOutput, `${label}.recentOutput`, { maxItems: MAX_TERMINAL_CONTEXT_LINES, maxStringLength: MAX_TERMINAL_CONTEXT_LINE_CHARS, allowEmpty: true }) ||
    validateBoundedString(record.cwd, `${label}.cwd`, { optional: true, allowEmpty: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateNumber(record.lastExitCode, `${label}.lastExitCode`, { optional: true, integer: true, min: -1_000_000, max: 1_000_000 })
  )
}

function validateQuickCompleteInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.prompt, 'input.prompt', { max: MAX_QUICK_COMPLETE_PROMPT_CHARS }) ||
    validateBoundedString(record.systemPrompt, 'input.systemPrompt', { optional: true, allowEmpty: true, max: MAX_QUICK_COMPLETE_PROMPT_CHARS }) ||
    validateBoundedString(record.providerId, 'input.providerId', { optional: true, max: 256 }) ||
    validateBoundedString(record.modelId, 'input.modelId', { optional: true, max: 512 }) ||
    validateBoundedString(record.workspaceRoot, 'input.workspaceRoot', { optional: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateNumber(record.timeoutMs, 'input.timeoutMs', { optional: true, integer: true, min: 1000, max: 300000 })
  )
}

function validateBrowserUrl(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  const issue = validateBoundedString(value, label, { optional: options.optional, allowEmpty: true, max: 4096 })
  if (issue || value === undefined || value === null || value === '') return issue
  try {
    const parsed = new URL(value as string)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.href === 'about:blank'
      ? null
      : `${label} must use http, https, or about:blank`
  } catch {
    return `${label} must be a valid URL`
  }
}

function validateBrowserOpenInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateWorkspaceId(record.workspaceId, 'input.workspaceId', { optional: true }) ||
    validateBrowserUrl(record.url, 'input.url', { optional: true })
  )
}

function validateBrowserLink(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.text, `${label}.text`, { allowEmpty: true, max: 1024 }) ||
    validateBoundedString(record.href, `${label}.href`, { allowEmpty: true, max: 4096 })
  )
}

function validateBrowserLinks(value: unknown, label = 'links', options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an array`
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_BROWSER_LINKS) return `${label} must contain at most ${MAX_BROWSER_LINKS} items`
  for (const [index, link] of value.entries()) {
    const issue = validateBrowserLink(link, `${label}[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateBrowserCapture(args: readonly unknown[]): string | null {
  const attachment = args[0]
  const recordIssue = validateRecord(attachment, 'attachment')
  if (recordIssue) return recordIssue
  const record = attachment as Record<string, unknown>
  return (
    validateBoundedString(record.url, 'attachment.url', { optional: true, allowEmpty: true, max: 4096 }) ||
    validateBoundedString(record.title, 'attachment.title', { optional: true, allowEmpty: true, max: 1024 }) ||
    validateBoundedString(record.text, 'attachment.text', { optional: true, allowEmpty: true, max: MAX_BROWSER_TEXT_CHARS }) ||
    validateBoundedStringArray(record.headings, 'attachment.headings', { optional: true, allowEmpty: true, maxItems: MAX_BROWSER_HEADINGS, maxStringLength: 1024 }) ||
    validateBrowserLinks(record.links, 'attachment.links', { optional: true }) ||
    validateBoundedStringArray(record.forms, 'attachment.forms', { optional: true, allowEmpty: true, maxItems: MAX_BROWSER_FORMS, maxStringLength: 1024 }) ||
    validateNumber(record.capturedAt, 'attachment.capturedAt', { optional: true, integer: true, min: 0 })
  )
}

function validateBrowserMeta(value: unknown, label = 'snapshot.meta'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.description, `${label}.description`, { optional: true, allowEmpty: true, max: 4096 }) ||
    validateBoundedStringArray(record.keywords, `${label}.keywords`, { optional: true, allowEmpty: true, maxItems: MAX_BROWSER_KEYWORDS, maxStringLength: 256 }) ||
    validateBoundedString(record.ogTitle, `${label}.ogTitle`, { optional: true, allowEmpty: true, max: 1024 }) ||
    validateBoundedString(record.ogDescription, `${label}.ogDescription`, { optional: true, allowEmpty: true, max: 4096 })
  )
}

function validateBrowserSnapshot(value: unknown, label = 'snapshot'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.url, `${label}.url`, { allowEmpty: true, max: 4096 }) ||
    validateBoundedString(record.title, `${label}.title`, { allowEmpty: true, max: 1024 }) ||
    validateBoundedString(record.textContent, `${label}.textContent`, { allowEmpty: true, max: MAX_BROWSER_TEXT_CHARS }) ||
    validateBrowserMeta(record.meta, `${label}.meta`) ||
    validateBrowserLinks(record.links, `${label}.links`) ||
    validateBoolean(record.hasForms, `${label}.hasForms`) ||
    validateBoundedString(record.capturedAt, `${label}.capturedAt`, { max: 128 })
  )
}

function validateFireflyRole(value: unknown, label = 'role'): string | null {
  return validateEnum(value, label, FIREFLY_ROLES)
}

function validateNullableFireflyRole(value: unknown, label: string): string | null {
  if (value === null) return null
  return validateFireflyRole(value, label)
}

function validateFireflyTiming(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const issue = (
    validateNumber(record.startedAt, `${label}.startedAt`, { integer: true, min: 0 }) ||
    validateNumber(record.completedAt, `${label}.completedAt`, { optional: true, integer: true, min: 0 })
  )
  if (issue) return issue
  if (typeof record.completedAt === 'number' && record.completedAt < (record.startedAt as number)) {
    return `${label}.completedAt must be greater than or equal to ${label}.startedAt`
  }
  return null
}

function validateFireflyRoleTimings(value: unknown, label = 'state.roleTimings'): string | null {
  if (!(value instanceof Map) && !Array.isArray(value)) return `${label} must be a Map or entries array`
  const entries = value instanceof Map ? Array.from(value.entries()) : value
  if (entries.length > FIREFLY_ROLES.length) return `${label} must contain at most ${FIREFLY_ROLES.length} entries`
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    if (!Array.isArray(entry) || entry.length !== 2) return `${label}[${index}] must be a [role, timing] entry`
    const [role, timing] = entry
    const roleIssue = validateFireflyRole(role, `${label}[${index}][0]`)
    if (roleIssue) return roleIssue
    if (seen.has(role as string)) return `${label} must not contain duplicate role ${role as string}`
    seen.add(role as string)
    const timingIssue = validateFireflyTiming(timing, `${label}[${index}][1]`)
    if (timingIssue) return timingIssue
  }
  return null
}

function validateFireflyState(value: unknown, label = 'state'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.phase, `${label}.phase`, FIREFLY_PHASES) ||
    validateNullableFireflyRole(record.currentRole, `${label}.currentRole`) ||
    validateBoundedString(record.routerOutput, `${label}.routerOutput`, { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedString(record.mainOutput, `${label}.mainOutput`, { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedString(record.reviewerOutput, `${label}.reviewerOutput`, { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedString(record.executorOutput, `${label}.executorOutput`, { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedString(record.gatekeeperOutput, `${label}.gatekeeperOutput`, { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedStringArray(record.approvedActions, `${label}.approvedActions`, {
      allowEmpty: true,
      maxItems: MAX_FIREFLY_LIST_ITEMS,
      maxStringLength: MAX_COMMAND_TEXT_CHARS
    }) ||
    validateBoundedStringArray(record.rejectedActions, `${label}.rejectedActions`, {
      allowEmpty: true,
      maxItems: MAX_FIREFLY_LIST_ITEMS,
      maxStringLength: MAX_COMMAND_TEXT_CHARS
    }) ||
    validateBoundedStringArray(record.guardReasons, `${label}.guardReasons`, {
      allowEmpty: true,
      maxItems: MAX_FIREFLY_LIST_ITEMS,
      maxStringLength: MAX_COMMAND_TEXT_CHARS
    }) ||
    validateBoolean(record.blockedByGuard, `${label}.blockedByGuard`) ||
    validateNumber(record.startedAt, `${label}.startedAt`, { integer: true, min: 0 }) ||
    validateFireflyRoleTimings(record.roleTimings, `${label}.roleTimings`)
  )
}

function validateFireflyCompleteRole(args: readonly unknown[]): string | null {
  return validateFireflyState(args[0]) || validateFireflyRole(args[1]) || validateBoundedString(args[2], 'output', { allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS })
}

function validateFireflyRoleContext(args: readonly unknown[]): string | null {
  return (
    validateFireflyState(args[0]) ||
    validateFireflyRole(args[1]) ||
    validateBoundedString(args[2], 'prompt', { max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedString(args[3], 'memory', { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS }) ||
    validateBoundedString(args[4], 'project', { optional: true, allowEmpty: true, max: MAX_FIREFLY_STATE_TEXT_CHARS })
  )
}

function validateRuntimeModelSelection(value: unknown, label = 'modelSelection', options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.providerId, `${label}.providerId`, { max: 256 }) ||
    validateBoundedString(record.modelId, `${label}.modelId`, { max: 512 }) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { optional: true, allowEmpty: true, max: 256 }) ||
    validateEnum(record.source, `${label}.source`, ['provider', 'local-cli'], { optional: true })
  )
}

function validateWorkbenchAttachment(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateEnum(record.kind, `${label}.kind`, ['file', 'image', 'text']) ||
    validateBoundedString(record.name, `${label}.name`, { max: 512 }) ||
    validateBoundedString(record.path, `${label}.path`, { optional: true, allowEmpty: true, max: MAX_PROJECT_PATH_CHARS }) ||
    validateBoundedString(record.mime, `${label}.mime`, { optional: true, allowEmpty: true, max: 256 }) ||
    validateNumber(record.size, `${label}.size`, { optional: true, integer: true, min: 0, max: 1024 * 1024 * 1024 }) ||
    validateBoundedString(record.dataUrl, `${label}.dataUrl`, { optional: true, allowEmpty: true, max: MAX_ATTACHMENT_DATA_URL_CHARS }) ||
    validateBoundedString(record.text, `${label}.text`, { optional: true, allowEmpty: true, max: MAX_ATTACHMENT_TEXT_CHARS }) ||
    validateNumber(record.createdAt, `${label}.createdAt`, { optional: true, integer: true, min: 0 })
  )
}

function validateWorkbenchAttachments(value: unknown, label = 'payload.attachments'): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_TURN_ATTACHMENTS) return `${label} must contain at most ${MAX_TURN_ATTACHMENTS} items`
  for (const [index, attachment] of value.entries()) {
    const issue = validateWorkbenchAttachment(attachment, `${label}[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateScheduleStep(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const dependsIssue = record.dependsOn === undefined || record.dependsOn === null
    ? null
    : validateBoundedStringArray(record.dependsOn, `${label}.dependsOn`, { maxItems: MAX_SCHEDULE_DEPENDS, maxStringLength: 256 })
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateBoundedString(record.label, `${label}.label`, { max: 512 }) ||
    validateBoundedString(record.labelZh, `${label}.labelZh`, { optional: true, allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.labelEn, `${label}.labelEn`, { optional: true, allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { max: 256 }) ||
    validateEnum(record.role, `${label}.role`, SCHEDULE_STEP_ROLES) ||
    validateEnum(record.mode, `${label}.mode`, SCHEDULE_STEP_MODES) ||
    dependsIssue
  )
}

function validateScheduleGraphNode(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateBoundedString(record.label, `${label}.label`, { max: 512 }) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { max: 256 }) ||
    validateEnum(record.role, `${label}.role`, SCHEDULE_STEP_ROLES) ||
    validateEnum(record.mode, `${label}.mode`, SCHEDULE_STEP_MODES) ||
    validateBoundedString(record.promptTemplate, `${label}.promptTemplate`, { optional: true, allowEmpty: true, max: 64 * 1024 }) ||
    validateEnum(record.approvalPolicy, `${label}.approvalPolicy`, SCHEDULE_APPROVAL_POLICIES, { optional: true })
  )
}

function validateScheduleGraphEdge(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateBoundedString(record.from, `${label}.from`, { max: 256 }) ||
    validateBoundedString(record.to, `${label}.to`, { max: 256 }) ||
    validateEnum(record.artifactMode, `${label}.artifactMode`, SCHEDULE_ARTIFACT_MODES)
  )
}

function validateScheduleGraph(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const versionIssue = validateNumber(record.version, `${label}.version`, { integer: true, min: 1, max: 1 })
  if (versionIssue) return versionIssue
  if (!Array.isArray(record.nodes)) return `${label}.nodes must be an array`
  if (!Array.isArray(record.edges)) return `${label}.edges must be an array`
  if (record.nodes.length > MAX_SCHEDULE_STEPS) return `${label}.nodes must contain at most ${MAX_SCHEDULE_STEPS} items`
  if (record.edges.length > MAX_SCHEDULE_STEPS * MAX_SCHEDULE_DEPENDS) return `${label}.edges has too many items`

  const nodeIds = new Set<string>()
  for (const [index, node] of record.nodes.entries()) {
    const issue = validateScheduleGraphNode(node, `${label}.nodes[${index}]`)
    if (issue) return issue
    const id = (node as Record<string, unknown>).id
    if (typeof id === 'string') {
      if (nodeIds.has(id)) return `${label}.nodes must not contain duplicate node id ${id}`
      nodeIds.add(id)
    }
  }

  const edgeIds = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const [index, edge] of record.edges.entries()) {
    const issue = validateScheduleGraphEdge(edge, `${label}.edges[${index}]`)
    if (issue) return issue
    const item = edge as Record<string, unknown>
    const id = item.id
    const from = item.from
    const to = item.to
    if (typeof id === 'string') {
      if (edgeIds.has(id)) return `${label}.edges must not contain duplicate edge id ${id}`
      edgeIds.add(id)
    }
    if (typeof from === 'string' && !nodeIds.has(from)) return `${label}.edges[${index}].from references missing node ${from}`
    if (typeof to === 'string' && !nodeIds.has(to)) return `${label}.edges[${index}].to references missing node ${to}`
    if (typeof from === 'string' && typeof to === 'string') {
      if (from === to) return `${label}.edges[${index}] must not point to itself`
      adjacency.set(from, [...(adjacency.get(from) || []), to])
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const next of adjacency.get(nodeId) || []) {
      if (visit(next)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  for (const nodeId of nodeIds) {
    if (visit(nodeId)) return `${label}.edges must not contain cycles`
  }

  const layoutIssue = validateRecord(record.layout, `${label}.layout`)
  if (layoutIssue) return layoutIssue
  const layout = record.layout as Record<string, unknown>
  for (const [nodeId, point] of Object.entries(layout)) {
    if (!nodeIds.has(nodeId)) return `${label}.layout contains unknown node ${nodeId}`
    const pointIssue = validateRecord(point, `${label}.layout.${nodeId}`)
    if (pointIssue) return pointIssue
    const pointRecord = point as Record<string, unknown>
    const issue = validateNumber(pointRecord.x, `${label}.layout.${nodeId}.x`, { min: -100000, max: 100000 }) ||
      validateNumber(pointRecord.y, `${label}.layout.${nodeId}.y`, { min: -100000, max: 100000 })
    if (issue) return issue
  }
  return null
}

function validateSchedulePreview(value: unknown, label = 'payload.customSchedule'): string | null {
  if (value === undefined || value === null) return null
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  const baseIssue = (
    validateEnum(record.preset, `${label}.preset`, DISPATCH_PRESETS) ||
    validateBoundedString(record.label, `${label}.label`, { max: 512 }) ||
    validateBoundedString(record.labelZh, `${label}.labelZh`, { optional: true, allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.labelEn, `${label}.labelEn`, { optional: true, allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.description, `${label}.description`, { allowEmpty: true, max: 4096 }) ||
    validateBoundedString(record.descriptionZh, `${label}.descriptionZh`, { optional: true, allowEmpty: true, max: 4096 }) ||
    validateBoundedString(record.descriptionEn, `${label}.descriptionEn`, { optional: true, allowEmpty: true, max: 4096 })
  )
  if (baseIssue) return baseIssue
  if (!Array.isArray(record.steps)) return `${label}.steps must be an array`
  if (record.steps.length > MAX_SCHEDULE_STEPS) return `${label}.steps must contain at most ${MAX_SCHEDULE_STEPS} items`
  const seen = new Set<string>()
  for (const [index, step] of record.steps.entries()) {
    const issue = validateScheduleStep(step, `${label}.steps[${index}]`)
    if (issue) return issue
    const id = (step as Record<string, unknown>).id
    if (typeof id === 'string') {
      if (seen.has(id)) return `${label}.steps must not contain duplicate step id ${id}`
      seen.add(id)
    }
  }
  const graphIssue = validateScheduleGraph(record.graph, `${label}.graph`)
  if (graphIssue) return graphIssue
  return null
}

function validateTurnCreateInput(args: readonly unknown[]): string | null {
  const payload = args[0]
  const recordIssue = validateRecord(payload, 'payload')
  if (recordIssue) return recordIssue
  const record = payload as Record<string, unknown>
  return (
    validateBoundedString(record.threadId, 'payload.threadId', { optional: true, allowEmpty: true, max: 256 }) ||
    validateWorkspaceId(record.workspaceId, 'payload.workspaceId', { optional: true }) ||
    validateBoundedString(record.prompt, 'payload.prompt', { max: MAX_TURN_PROMPT_CHARS }) ||
    validateEnum(record.mode, 'payload.mode', DISPATCH_PRESETS, { optional: true }) ||
    validateBoundedString(record.targetAgent, 'payload.targetAgent', { optional: true, allowEmpty: true, max: 256 }) ||
    (hasOwn(record, 'thinking') ? validateThinkingConfig(record.thinking, 'payload.thinking') : null) ||
    validateRuntimeModelSelection(record.modelSelection, 'payload.modelSelection', { optional: true }) ||
    validateWorkbenchAttachments(record.attachments) ||
    validateSchedulePreview(record.customSchedule)
  )
}

function validateSkillCategory(value: unknown, label = 'input.category', options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be a string or object`
  if (typeof value === 'string') return validateBoundedString(value, label, { allowEmpty: true, max: 128 })
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return `${label} must be a string or object`
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.id, `${label}.id`, { optional: true, allowEmpty: true, max: 128 }) ||
    validateBoundedString(record.label, `${label}.label`, { optional: true, allowEmpty: true, max: 256 })
  )
}

function validateSkillTags(value: unknown, label = 'input.tags', options: { optional?: boolean; nullable?: boolean } = {}): string | null {
  if (value === null && !options.nullable) return `${label} must be an array`
  return validateBoundedStringArray(value, label, {
    optional: options.optional,
    allowEmpty: false,
    maxItems: MAX_SKILL_TAGS,
    maxStringLength: MAX_SKILL_TAG_CHARS
  })
}

function validateSkillInputRecord(record: Record<string, unknown>, label: string, options: { patch?: boolean } = {}): string | null {
  return (
    (options.patch
      ? validatePresentBoundedString(record, 'name', `${label}.name`, { max: MAX_SKILL_NAME_CHARS })
      : validateBoundedString(record.name, `${label}.name`, { max: MAX_SKILL_NAME_CHARS })) ||
    (hasOwn(record, 'category') ? validateSkillCategory(record.category, `${label}.category`, { optional: true }) : null) ||
    validatePresentBoundedString(record, 'description', `${label}.description`, { allowEmpty: true, max: MAX_SKILL_DESCRIPTION_CHARS }) ||
    (options.patch
      ? validatePresentBoundedString(record, 'instructions', `${label}.instructions`, { max: MAX_SKILL_INSTRUCTIONS_CHARS })
      : validateBoundedString(record.instructions, `${label}.instructions`, { max: MAX_SKILL_INSTRUCTIONS_CHARS })) ||
    (hasOwn(record, 'tags') ? validateSkillTags(record.tags, `${label}.tags`, { optional: true }) : null) ||
    validatePresentBoundedString(record, 'source', `${label}.source`, { allowEmpty: true, max: MAX_SKILL_SOURCE_CHARS })
  )
}

function validateSkillInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  return validateSkillInputRecord(input as Record<string, unknown>, 'input')
}

function validateSkillPatch(args: readonly unknown[]): string | null {
  const patch = args[1]
  const patchIssue = validateRecord(patch, 'patch')
  if (patchIssue) return validateBoundedString(args[0], 'id', { max: 256 }) || patchIssue
  return validateBoundedString(args[0], 'id', { max: 256 }) || validateSkillInputRecord(patch as Record<string, unknown>, 'patch', { patch: true })
}

function validateMemoryCategory(value: unknown, label = 'category', options: { optional?: boolean } = {}): string | null {
  return validateEnum(value, label, MEMORY_CATEGORIES, options)
}

function validateMemoryTags(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  return validateBoundedStringArray(value, label, {
    optional: options.optional,
    maxItems: MAX_MEMORY_TAGS,
    maxStringLength: MAX_MEMORY_TAG_CHARS
  })
}

function validateMemoryMetadata(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_MEMORY_METADATA_ENTRIES) return `${label} must contain at most ${MAX_MEMORY_METADATA_ENTRIES} entries`
  for (const [key, item] of entries) {
    const keyIssue = validateBoundedString(key, `${label} key`, { max: 128 })
    if (keyIssue) return keyIssue
    if (item === null || item === undefined || ['string', 'number', 'boolean'].includes(typeof item)) {
      if (typeof item === 'string') {
        const issue = validateBoundedString(item, `${label}.${key}`, { allowEmpty: true, max: 4096 })
        if (issue) return issue
      } else if (typeof item === 'number' && !Number.isFinite(item)) {
        return `${label}.${key} must be finite`
      }
      continue
    }
    if (Array.isArray(item)) {
      if (item.length > 64) return `${label}.${key} must contain at most 64 items`
      for (const [index, entry] of item.entries()) {
        if (entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) return `${label}.${key}[${index}] must be a primitive value`
      }
      continue
    }
    return `${label}.${key} must be a primitive value or primitive array`
  }
  return null
}

function validateMemoryEntryRecord(record: Record<string, unknown>, label: string, options: { patch?: boolean; quality?: boolean; conflict?: boolean } = {}): string | null {
  return (
    validateBoundedString(record.id, `${label}.id`, { optional: !options.conflict, max: 256 }) ||
    (options.patch
      ? validatePresentEnum(record, 'category', `${label}.category`, MEMORY_CATEGORIES)
      : options.quality || options.conflict
      ? validateBoundedString(record.category, `${label}.category`, { max: 128 })
      : validateMemoryCategory(record.category, `${label}.category`)) ||
    (options.patch
      ? validatePresentBoundedString(record, 'title', `${label}.title`, { max: MAX_MEMORY_TITLE_CHARS })
      : validateBoundedString(record.title, `${label}.title`, { max: MAX_MEMORY_TITLE_CHARS })) ||
    validatePresentBoundedString(record, 'summary', `${label}.summary`, { allowEmpty: true, max: MAX_MEMORY_TEXT_CHARS }) ||
    (options.conflict ? null : validatePresentBoundedString(record, 'content', `${label}.content`, { allowEmpty: true, max: MAX_MEMORY_TEXT_CHARS })) ||
    (options.conflict ? null : validatePresentBoundedString(record, 'source', `${label}.source`, { allowEmpty: true, max: MAX_PROJECT_PATH_CHARS })) ||
    (options.conflict || !hasOwn(record, 'tags') ? null : validateMemoryTags(record.tags, `${label}.tags`, { optional: true })) ||
    (options.conflict || !hasOwn(record, 'status') ? null : validateEnum(record.status, `${label}.status`, MEMORY_STATUSES, { optional: true })) ||
    (options.conflict || !hasOwn(record, 'confidence') ? null : validateNumber(record.confidence, `${label}.confidence`, { optional: true, min: 0, max: 1 })) ||
    (options.conflict || !hasOwn(record, 'metadata') ? null : validateMemoryMetadata(record.metadata, `${label}.metadata`, { optional: true }))
  )
}

function validateMemoryEntryInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'entry')
  if (recordIssue) return recordIssue
  return validateMemoryEntryRecord(input as Record<string, unknown>, 'entry')
}

function validateMemoryEntryPatch(args: readonly unknown[]): string | null {
  const patch = args[1]
  const patchIssue = validateRecord(patch, 'patch')
  if (patchIssue) return validateBoundedString(args[0], 'id', { max: 256 }) || patchIssue
  return validateBoundedString(args[0], 'id', { max: 256 }) || validateMemoryEntryRecord(patch as Record<string, unknown>, 'patch', { patch: true })
}

function validateMemoryEntryArray(value: unknown, label = 'entries'): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_MEMORY_GRAPH_ENTRIES) return `${label} must contain at most ${MAX_MEMORY_GRAPH_ENTRIES} items`
  for (const [index, entry] of value.entries()) {
    const recordIssue = validateRecord(entry, `${label}[${index}]`)
    if (recordIssue) return recordIssue
    const issue = validateMemoryEntryRecord(entry as Record<string, unknown>, `${label}[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateMemoryGraph(value: unknown, label = 'graph'): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.nodes)) return `${label}.nodes must be an array`
  if (record.nodes.length > MAX_MEMORY_GRAPH_ENTRIES) return `${label}.nodes must contain at most ${MAX_MEMORY_GRAPH_ENTRIES} items`
  for (const [index, node] of record.nodes.entries()) {
    const nodeIssue = validateRecord(node, `${label}.nodes[${index}]`)
    if (nodeIssue) return nodeIssue
    const nodeRecord = node as Record<string, unknown>
    const issue = (
      validateBoundedString(nodeRecord.id, `${label}.nodes[${index}].id`, { max: 256 }) ||
      validateBoundedString(nodeRecord.label, `${label}.nodes[${index}].label`, { max: MAX_MEMORY_TITLE_CHARS }) ||
      validateBoundedString(nodeRecord.category, `${label}.nodes[${index}].category`, { max: 128 }) ||
      validateBoundedString(nodeRecord.status, `${label}.nodes[${index}].status`, { max: 128 }) ||
      validateBoolean(nodeRecord.pinned, `${label}.nodes[${index}].pinned`) ||
      validateNumber(nodeRecord.useCount, `${label}.nodes[${index}].useCount`, { integer: true, min: 0 }) ||
      validateNumber(nodeRecord.importance, `${label}.nodes[${index}].importance`, { min: 0, max: 1 }) ||
      validateMemoryTags(nodeRecord.tags, `${label}.nodes[${index}].tags`)
    )
    if (issue) return issue
  }
  if (!Array.isArray(record.edges)) return `${label}.edges must be an array`
  if (record.edges.length > MAX_MEMORY_GRAPH_EDGES) return `${label}.edges must contain at most ${MAX_MEMORY_GRAPH_EDGES} items`
  for (const [index, edge] of record.edges.entries()) {
    const edgeIssue = validateRecord(edge, `${label}.edges[${index}]`)
    if (edgeIssue) return edgeIssue
    const edgeRecord = edge as Record<string, unknown>
    const issue = (
      validateBoundedString(edgeRecord.source, `${label}.edges[${index}].source`, { max: 256 }) ||
      validateBoundedString(edgeRecord.target, `${label}.edges[${index}].target`, { max: 256 }) ||
      validateEnum(edgeRecord.type, `${label}.edges[${index}].type`, ['tag', 'category', 'similarity']) ||
      validateNumber(edgeRecord.weight, `${label}.edges[${index}].weight`, { min: 0, max: 1 }) ||
      validateBoundedString(edgeRecord.label, `${label}.edges[${index}].label`, { optional: true, allowEmpty: true, max: 256 })
    )
    if (issue) return issue
  }
  return validateRecord(record.stats, `${label}.stats`)
}

function validateMemoryConflictEntries(args: readonly unknown[]): string | null {
  const entries = args[0]
  if (!Array.isArray(entries)) return 'entries must be an array'
  if (entries.length > MAX_MEMORY_GRAPH_ENTRIES) return `entries must contain at most ${MAX_MEMORY_GRAPH_ENTRIES} items`
  for (const [index, entry] of entries.entries()) {
    const recordIssue = validateRecord(entry, `entries[${index}]`)
    if (recordIssue) return recordIssue
    const issue = validateMemoryEntryRecord(entry as Record<string, unknown>, `entries[${index}]`, { conflict: true })
    if (issue) return issue
  }
  return null
}

function validateWorkspaceCreateInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return validateString(record.name, 'input.name') || validateString(record.rootPath, 'input.rootPath')
}

function validateWorkspaceUpdateInput(args: readonly unknown[]): string | null {
  const patch = args[1]
  const patchIssue = validateRecord(patch, 'patch')
  if (patchIssue) return validateString(args[0], 'id') || patchIssue
  const record = patch as Record<string, unknown>
  return (
    validateString(args[0], 'id') ||
    validateString(record.name, 'patch.name', { optional: true, allowEmpty: true }) ||
    validateString(record.rootPath, 'patch.rootPath', { optional: true, allowEmpty: true }) ||
    validateStringArray(record.bootstrapFiles, 'patch.bootstrapFiles', { optional: true })
  )
}

function validateWorktreeCreateInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateString(record.parentWorkspaceId, 'input.parentWorkspaceId') ||
    validateString(record.branch, 'input.branch', { optional: true, allowEmpty: true }) ||
    validateString(record.path, 'input.path', { optional: true, allowEmpty: true })
  )
}

function validateGitPathMutation(args: readonly unknown[]): string | null {
  return validateWorkspaceId(args[0]) || validateString(args[1], 'filePath')
}

function validateGitBranchMutation(args: readonly unknown[], labels: string[]): string | null {
  const workspaceIssue = validateWorkspaceId(args[0])
  if (workspaceIssue) return workspaceIssue
  for (const [index, label] of labels.entries()) {
    const issue = validateString(args[index + 1], label)
    if (issue) return issue
  }
  return null
}

function validateGitRemoteArgs(args: readonly unknown[]): string | null {
  return (
    validateWorkspaceId(args[0]) ||
    validateString(args[1], 'remote', { optional: true, allowEmpty: true }) ||
    validateString(args[2], 'branch', { optional: true, allowEmpty: true })
  )
}

function validateGitCommit(args: readonly unknown[]): string | null {
  return (
    validateWorkspaceId(args[0]) ||
    validateString(args[1], 'message') ||
    validateStringArray(args[2], 'filePaths', { optional: true })
  )
}

function validateTerminalRun(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return validateWorkspaceId(record.workspaceId, 'input.workspaceId', { optional: true }) || validateString(record.command, 'input.command')
}

function validateTerminalCreate(args: readonly unknown[]): string | null {
  const payload = args[0]
  const recordIssue = validateRecord(payload, 'payload')
  if (recordIssue) return recordIssue
  const record = payload as Record<string, unknown>
  return (
    validateString(record.sessionId, 'payload.sessionId') ||
    validateString(record.cwd, 'payload.cwd', { optional: true, allowEmpty: true }) ||
    validateNumber(record.cols, 'payload.cols', { optional: true, integer: true, min: 1, max: MAX_TERMINAL_DIMENSION }) ||
    validateNumber(record.rows, 'payload.rows', { optional: true, integer: true, min: 1, max: MAX_TERMINAL_DIMENSION })
  )
}

function validateTerminalWrite(args: readonly unknown[]): string | null {
  const payload = args[0]
  const recordIssue = validateRecord(payload, 'payload')
  if (recordIssue) return recordIssue
  const record = payload as Record<string, unknown>
  const dataIssue = validateString(record.data, 'payload.data', { allowEmpty: true })
  if (dataIssue) return dataIssue
  if (typeof record.data === 'string' && record.data.length > MAX_TERMINAL_WRITE_CHARS) {
    return `payload.data must be at most ${MAX_TERMINAL_WRITE_CHARS} characters`
  }
  return validateString(record.sessionId, 'payload.sessionId')
}

function validateTerminalResize(args: readonly unknown[]): string | null {
  const payload = args[0]
  const recordIssue = validateRecord(payload, 'payload')
  if (recordIssue) return recordIssue
  const record = payload as Record<string, unknown>
  return (
    validateString(record.sessionId, 'payload.sessionId') ||
    validateNumber(record.cols, 'payload.cols', { integer: true, min: 1, max: MAX_TERMINAL_DIMENSION }) ||
    validateNumber(record.rows, 'payload.rows', { integer: true, min: 1, max: MAX_TERMINAL_DIMENSION })
  )
}

function validateSddDraftArgs(args: readonly unknown[], options: { draftId?: boolean; content?: boolean; designContext?: boolean; trace?: boolean; planMarkdown?: boolean; history?: boolean } = {}): string | null {
  return (
    validateString(args[0], 'workspaceRoot') ||
    (options.draftId ? validateString(args[1], 'draftId') : null) ||
    (options.content ? validateString(args[2], 'content', { allowEmpty: true }) : null) ||
    (options.designContext ? validateRecord(args[2], 'designContext') : null) ||
    (options.trace ? validateRecord(args[2], 'trace') : null) ||
    (options.planMarkdown ? validateString(args[2], 'planMarkdown', { optional: true, allowEmpty: true }) : null) ||
    (options.history ? validateSddHistoryEntries(args[2]) : null)
  )
}

function validateSddHistoryEntries(value: unknown): string | null {
  if (!Array.isArray(value)) return 'history must be an array'
  if (value.length > 20) return 'history must contain at most 20 entries'
  for (const [index, entry] of value.entries()) {
    const label = `history[${index}]`
    const recordIssue = validateRecord(entry, label)
    if (recordIssue) return recordIssue
    const record = entry as Record<string, unknown>
    const versionIssue = validateNumber(record.version, `${label}.version`, { integer: true, min: 1 })
    if (versionIssue) return versionIssue
    const stringIssue =
      validateString(record.timestamp, `${label}.timestamp`) ||
      validateString(record.content, `${label}.content`, { allowEmpty: true }) ||
      validateString(record.title, `${label}.title`, { allowEmpty: true }) ||
      validateString(record.message, `${label}.message`, { allowEmpty: true })
    if (stringIssue) return stringIssue
    const authorIssue = validateEnum(record.author, `${label}.author`, ['user', 'system', 'ai'])
    if (authorIssue) return authorIssue
    if (record.truncated !== undefined && typeof record.truncated !== 'boolean') return `${label}.truncated must be a boolean`
  }
  return null
}

function validateMcpStringRecord(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_MCP_RECORD_ENTRIES) return `${label} must contain at most ${MAX_MCP_RECORD_ENTRIES} entries`
  for (const [key, entryValue] of entries) {
    const keyIssue = validateBoundedString(key, `${label} key`, { max: 256 })
    if (keyIssue) return keyIssue
    const valueIssue = validateBoundedString(entryValue, `${label}.${key}`, { allowEmpty: true })
    if (valueIssue) return valueIssue
  }
  return null
}

function validateMcpUrl(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  const stringIssue = validateBoundedString(value, label, { optional: options.optional })
  if (stringIssue || value === undefined || value === null) return stringIssue
  try {
    const parsed = new URL(value as string)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? null : `${label} must use http or https`
  } catch {
    return `${label} must be a valid URL`
  }
}

function validateMcpServerInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  const explicitTransportIssue = validateEnum(record.transport, 'input.transport', ['stdio', 'sse', 'http'], { optional: true })
  if (explicitTransportIssue) return explicitTransportIssue
  const transport = typeof record.transport === 'string'
    ? record.transport
    : (typeof record.url === 'string' ? 'http' : 'stdio')
  const argsIssue = record.args === undefined || record.args === null
    ? null
    : validateBoundedStringArray(record.args, 'input.args', { allowEmpty: true, maxItems: MAX_MCP_ARGS })
  return (
    validateBoundedString(record.name, 'input.name', { max: 256 }) ||
    validateBoundedString(record.id, 'input.id', { optional: true, max: 256 }) ||
    validateBoolean(record.enabled, 'input.enabled', { optional: true }) ||
    argsIssue ||
    validateMcpStringRecord(record.env, 'input.env', { optional: true }) ||
    validateMcpStringRecord(record.headers, 'input.headers', { optional: true }) ||
    validateBoundedString(record.cwd, 'input.cwd', { optional: true, allowEmpty: true }) ||
    validateNumber(record.timeoutMs, 'input.timeoutMs', { optional: true, integer: true, min: 250, max: MAX_MCP_TIMEOUT_MS }) ||
    validateBoundedString(record.trustScope, 'input.trustScope', { optional: true, allowEmpty: true, max: 256 }) ||
    validateBoundedStringArray(record.trustedWorkspaceRoots, 'input.trustedWorkspaceRoots', { optional: true, maxItems: MAX_MCP_ARGS }) ||
    (transport === 'stdio'
      ? validateBoundedString(record.command, 'input.command')
      : validateMcpUrl(record.url, 'input.url'))
  )
}

function validateMcpSystemConfig(args: readonly unknown[]): string | null {
  const config = args[0]
  const recordIssue = validateRecord(config, 'config')
  if (recordIssue) return recordIssue
  const record = config as Record<string, unknown>
  if ('allowedCategories' in record) {
    if (!Array.isArray(record.allowedCategories)) return 'config.allowedCategories must be an array'
    for (const [index, category] of record.allowedCategories.entries()) {
      const categoryIssue = validateEnum(category, `config.allowedCategories[${index}]`, ['read', 'write', 'exec'])
      if (categoryIssue) return categoryIssue
    }
  }
  if ('version' in record) {
    const issue = validateNumber(record.version, 'config.version', { integer: true, min: 1, max: 1 })
    if (issue) return issue
  }
  if ('enabled' in record) {
    const issue = validateBoolean(record.enabled, 'config.enabled')
    if (issue) return issue
  }
  if ('defaultPolicy' in record) {
    const issue = validateEnum(record.defaultPolicy, 'config.defaultPolicy', ['allow', 'ask', 'deny'])
    if (issue) return issue
  }
  if ('timeoutMs' in record) {
    const issue = validateNumber(record.timeoutMs, 'config.timeoutMs', { integer: true, min: 250, max: MAX_MCP_TIMEOUT_MS })
    if (issue) return issue
  }
  return null
}

function validateMcpServerId(args: readonly unknown[], workspaceIndex = 1): string | null {
  return validateString(args[0], 'id') || validateWorkspaceId(args[workspaceIndex], 'workspaceId', { optional: true })
}

function validateHttpUrl(value: unknown, label: string, options: { optional?: boolean; allowEmpty?: boolean } = {}): string | null {
  const issue = validateBoundedString(value, label, { optional: options.optional, allowEmpty: options.allowEmpty })
  if (issue || value === undefined || value === null || (options.allowEmpty && value === '')) return issue
  try {
    const parsed = new URL(value as string)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? null : `${label} must use http or https`
  } catch {
    return `${label} must be a valid URL`
  }
}

function validatePresentBoundedString(record: Record<string, unknown>, key: string, label: string, options: { allowEmpty?: boolean; max?: number } = {}): string | null {
  return hasOwn(record, key) ? validateBoundedString(record[key], label, options) : null
}

function validatePresentBoolean(record: Record<string, unknown>, key: string, label: string): string | null {
  return hasOwn(record, key) ? validateBoolean(record[key], label) : null
}

function validatePresentNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  options: { integer?: boolean; min?: number; max?: number } = {}
): string | null {
  return hasOwn(record, key) ? validateNumber(record[key], label, options) : null
}

function validatePresentEnum(record: Record<string, unknown>, key: string, label: string, allowed: readonly string[]): string | null {
  return hasOwn(record, key) ? validateEnum(record[key], label, allowed) : null
}

function validateJsonLikeValue(
  value: unknown,
  label: string,
  options: { maxDepth?: number; maxRecordEntries?: number; maxArrayItems?: number; maxStringLength?: number } = {}
): string | null {
  const maxDepth = options.maxDepth ?? MAX_STORE_VALUE_DEPTH
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) return `${label} must be a finite number`
    if (typeof value === 'string') return validateBoundedString(value, label, { allowEmpty: true, max: options.maxStringLength ?? MAX_MCP_STRING_CHARS })
    return null
  }
  if (value === undefined) return `${label} must be JSON-serializable`
  if (maxDepth <= 0) return `${label} must not exceed nesting depth`
  if (Array.isArray(value)) {
    const maxArrayItems = options.maxArrayItems ?? MAX_STORE_ARRAY_ITEMS
    if (value.length > maxArrayItems) return `${label} must contain at most ${maxArrayItems} items`
    for (const [index, item] of value.entries()) {
      const issue = validateJsonLikeValue(item, `${label}[${index}]`, { ...options, maxDepth: maxDepth - 1 })
      if (issue) return issue
    }
    return null
  }
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const entries = Object.entries(value as Record<string, unknown>)
  const maxRecordEntries = options.maxRecordEntries ?? MAX_STORE_RECORD_ENTRIES
  if (entries.length > maxRecordEntries) return `${label} must contain at most ${maxRecordEntries} entries`
  for (const [key, item] of entries) {
    const keyIssue = validateBoundedString(key, `${label} key`, { max: 256 })
    if (keyIssue) return keyIssue
    const issue = validateJsonLikeValue(item, `${label}.${key}`, { ...options, maxDepth: maxDepth - 1 })
    if (issue) return issue
  }
  return null
}

function validateStoreGet(args: readonly unknown[]): string | null {
  if (args.length > 2) return 'expected at most 2 arguments'
  return (
    validateBoundedString(args[0], 'key', { max: 512 }) ||
    (args.length > 1 && args[1] !== undefined ? validateJsonLikeValue(args[1], 'defaultValue') : null)
  )
}

function validateStoreSet(args: readonly unknown[]): string | null {
  return (
    validateBoundedString(args[0], 'key', { max: 512 }) ||
    validateJsonLikeValue(args[1], 'value')
  )
}

function validateTakeoverApp(value: unknown, label = 'app'): string | null {
  return validateEnum(value, label, ['codex', 'claude', 'hermes', 'openclaw'])
}

function validateThreadCreate(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateWorkspaceId(record.workspaceId, 'input.workspaceId', { optional: true }) ||
    validateBoundedString(record.title, 'input.title', { optional: true, allowEmpty: true, max: 512 })
  )
}

function validateThreadFork(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateBoundedString(record.sourceThreadId, 'input.sourceThreadId', { max: 256 }) ||
    validateBoundedString(record.sourceTurnId, 'input.sourceTurnId', { max: 256 }) ||
    validateBoundedString(record.message, 'input.message', { max: MAX_TURN_PROMPT_CHARS })
  )
}

function validateNullableThreadId(value: unknown, label = 'threadId'): string | null {
  if (value === null) return null
  return validateBoundedString(value, label, { max: 256 })
}

function validateContextBlock(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateEnum(record.kind, `${label}.kind`, ['recent_turns', 'compaction_summary', 'attachment', 'memory', 'browser', 'skill', 'write_draft', 'workspace_file', 'workspace_state']) ||
    validateBoundedString(record.title, `${label}.title`, { max: 512 }) ||
    validatePresentBoundedString(record, 'detail', `${label}.detail`, { allowEmpty: true, max: 4096 }) ||
    validatePresentBoundedString(record, 'content', `${label}.content`, { allowEmpty: true, max: MAX_ATTACHMENT_TEXT_CHARS }) ||
    validatePresentBoundedString(record, 'sourceRef', `${label}.sourceRef`, { allowEmpty: true, max: 1024 }) ||
    validatePresentNumber(record, 'estimateTokens', `${label}.estimateTokens`, { integer: true, min: 0, max: 10_000_000 }) ||
    validateEnum(record.participation, `${label}.participation`, ['selected', 'pinned_next_send', 'carried_over', 'excluded']) ||
    validatePresentBoolean(record, 'pinned', `${label}.pinned`) ||
    validateNumber(record.createdAt, `${label}.createdAt`, { min: 0 })
  )
}

function validateContextBlocks(value: unknown, label = 'input.pinnedBlocks'): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_CONTEXT_PINNED_BLOCKS) return `${label} must contain at most ${MAX_CONTEXT_PINNED_BLOCKS} items`
  for (const [index, block] of value.entries()) {
    const issue = validateContextBlock(block, `${label}[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateWriteDraft(value: unknown, label = 'input.writeDraft'): string | null {
  if (value === undefined || value === null) return null
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateBoundedString(record.title, `${label}.title`, { allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.content, `${label}.content`, { allowEmpty: true, max: MAX_ATTACHMENT_TEXT_CHARS })
  )
}

function validateContextProjectionInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateWorkspaceId(record.workspaceId, 'input.workspaceId', { optional: true }) ||
    validateWorkspaceId(record.threadId, 'input.threadId', { optional: true }) ||
    validateBoundedString(record.prompt, 'input.prompt', { optional: true, allowEmpty: true, max: MAX_TURN_PROMPT_CHARS }) ||
    validateWorkbenchAttachments(record.attachments, 'input.attachments') ||
    validateWriteDraft(record.writeDraft) ||
    validateContextBlocks(record.pinnedBlocks)
  )
}

function validateOptionalAgentId(value: unknown, label = 'agentId'): string | null {
  if (value === undefined || value === null) return null
  return validateBoundedString(value, label, { max: 256 })
}

function validateGithubListArgs(args: readonly unknown[]): string | null {
  return (
    validateEnum(args[0], 'state', ['open', 'closed', 'all'], { optional: true }) ||
    validateNumber(args[1], 'limit', { optional: true, integer: true, min: 1, max: 100 })
  )
}

function validateConversationToolCalls(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_CONVERSATION_TOOL_CALLS) return `${label} must contain at most ${MAX_CONVERSATION_TOOL_CALLS} items`
  for (const [index, toolCall] of value.entries()) {
    const itemLabel = `${label}[${index}]`
    const recordIssue = validateRecord(toolCall, itemLabel)
    if (recordIssue) return recordIssue
    const record = toolCall as Record<string, unknown>
    const issue = (
      validateBoundedString(record.name, `${itemLabel}.name`, { max: 256 }) ||
      validateBoundedString(record.args, `${itemLabel}.args`, { optional: true, allowEmpty: true, max: MAX_CONVERSATION_CONTENT_CHARS }) ||
      validateBoundedString(record.result, `${itemLabel}.result`, { optional: true, allowEmpty: true, max: MAX_CONVERSATION_CONTENT_CHARS })
    )
    if (issue) return issue
  }
  return null
}

function validateConversationAttachments(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_CONVERSATION_ATTACHMENTS) return `${label} must contain at most ${MAX_CONVERSATION_ATTACHMENTS} items`
  for (const [index, attachment] of value.entries()) {
    const itemLabel = `${label}[${index}]`
    const recordIssue = validateRecord(attachment, itemLabel)
    if (recordIssue) return recordIssue
    const record = attachment as Record<string, unknown>
    const issue = (
      validateBoundedString(record.name, `${itemLabel}.name`, { max: 512 }) ||
      validateBoundedString(record.kind, `${itemLabel}.kind`, { max: 128 })
    )
    if (issue) return issue
  }
  return null
}

function validateConversationMessage(value: unknown, label: string, options: { attachments?: boolean } = {}): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.role, `${label}.role`, ['user', 'assistant', 'system', 'tool']) ||
    validateBoundedString(record.content, `${label}.content`, { allowEmpty: true, max: MAX_CONVERSATION_CONTENT_CHARS }) ||
    validateBoundedString(record.agentId, `${label}.agentId`, { optional: true, allowEmpty: true, max: 256 }) ||
    validateBoundedString(record.timestamp, `${label}.timestamp`, { optional: true, allowEmpty: true, max: 128 }) ||
    validateConversationToolCalls(record.toolCalls, `${label}.toolCalls`) ||
    validateBoundedString(record.thinking, `${label}.thinking`, { optional: true, allowEmpty: true, max: MAX_CONVERSATION_CONTENT_CHARS }) ||
    (options.attachments ? validateConversationAttachments(record.attachments, `${label}.attachments`) : null)
  )
}

function validateConversationMessages(value: unknown, label: string, options: { attachments?: boolean } = {}): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_CONVERSATION_MESSAGES) return `${label} must contain at most ${MAX_CONVERSATION_MESSAGES} items`
  for (const [index, message] of value.entries()) {
    const issue = validateConversationMessage(message, `${label}[${index}]`, options)
    if (issue) return issue
  }
  return null
}

function validateConversationMetadata(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return validateJsonLikeValue(value, label, {
    maxDepth: 2,
    maxRecordEntries: 64,
    maxArrayItems: 128,
    maxStringLength: 4096
  })
}

function validateConversationExportData(args: readonly unknown[]): string | null {
  const data = args[0]
  const recordIssue = validateRecord(data, 'data')
  if (recordIssue) return recordIssue
  const record = data as Record<string, unknown>
  return (
    validateBoundedString(record.title, 'data.title', { optional: true, allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.exportedAt, 'data.exportedAt', { optional: true, allowEmpty: true, max: 128 }) ||
    validateConversationMessages(record.messages, 'data.messages', { attachments: true }) ||
    validateConversationMetadata(record.metadata, 'data.metadata')
  )
}

function validateImportedConversation(args: readonly unknown[]): string | null {
  const conversation = args[0]
  const recordIssue = validateRecord(conversation, 'conversation')
  if (recordIssue) return recordIssue
  const record = conversation as Record<string, unknown>
  return (
    validateNumber(record.version, 'conversation.version', { integer: true, min: 0, max: 100 }) ||
    validateBoundedString(record.title, 'conversation.title', { allowEmpty: true, max: 512 }) ||
    validateBoundedString(record.exportedAt, 'conversation.exportedAt', { optional: true, allowEmpty: true, max: 128 }) ||
    validateConversationMessages(record.messages, 'conversation.messages') ||
    validateConversationMetadata(record.metadata, 'conversation.metadata')
  )
}

function validateModelListProviders(args: readonly unknown[]): string | null {
  const providers = args[0]
  if (providers === undefined || providers === null) return null
  if (!Array.isArray(providers)) return 'providers must be an array'
  if (providers.length > MAX_MODEL_LIST_PROVIDERS) return `providers must contain at most ${MAX_MODEL_LIST_PROVIDERS} items`
  for (const [index, provider] of providers.entries()) {
    const issue = validateModelListProvider(provider, `providers[${index}]`)
    if (issue) return issue
  }
  return null
}

function validateModelListProvider(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.models)) return `${label}.models must be an array`
  if (record.models.length > MAX_PROVIDER_MODELS) return `${label}.models must contain at most ${MAX_PROVIDER_MODELS} items`
  for (const [index, model] of record.models.entries()) {
    const modelIssue = validateModelListProviderModel(model, `${label}.models[${index}]`)
    if (modelIssue) return modelIssue
  }
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 256 }) ||
    validateBoundedString(record.name, `${label}.name`, { allowEmpty: true, max: 256 }) ||
    validatePresentBoundedString(record, 'kind', `${label}.kind`, { max: 256 }) ||
    validatePresentBoolean(record, 'enabled', `${label}.enabled`) ||
    validatePresentBoundedString(record, 'apiKey', `${label}.apiKey`, { allowEmpty: true }) ||
    validatePresentBoolean(record, 'apiKeyLocked', `${label}.apiKeyLocked`) ||
    validatePresentBoundedString(record, 'protocolOverride', `${label}.protocolOverride`, { allowEmpty: true, max: 128 }) ||
    (hasOwn(record, 'capabilities') ? validateModelListProviderCapabilities(record.capabilities, `${label}.capabilities`) : null)
  )
}

function validateModelListProviderModel(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  if (record.supportedReasoningLevels !== undefined && record.supportedReasoningLevels !== null) {
    if (!Array.isArray(record.supportedReasoningLevels)) return `${label}.supportedReasoningLevels must be an array`
    for (const [index, level] of record.supportedReasoningLevels.entries()) {
      const issue = validateBoundedString(level, `${label}.supportedReasoningLevels[${index}]`, { max: 64 })
      if (issue) return issue
    }
  }
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 512 }) ||
    validatePresentBoundedString(record, 'label', `${label}.label`, { allowEmpty: true, max: 512 }) ||
    validatePresentNumber(record, 'contextWindow', `${label}.contextWindow`, { integer: true, min: 1, max: 10_000_000 }) ||
    validatePresentBoolean(record, 'enabled', `${label}.enabled`) ||
    validatePresentBoolean(record, 'supportsTools', `${label}.supportsTools`) ||
    validatePresentBoolean(record, 'supportsVision', `${label}.supportsVision`) ||
    validatePresentBoolean(record, 'supportsThinking', `${label}.supportsThinking`) ||
    validatePresentBoundedString(record, 'upstreamModel', `${label}.upstreamModel`, { allowEmpty: true, max: 512 }) ||
    validatePresentNumber(record, 'timeoutMs', `${label}.timeoutMs`, { integer: true, min: 250, max: 300_000 }) ||
    validatePresentNumber(record, 'retryCount', `${label}.retryCount`, { integer: true, min: 0, max: 10 }) ||
    validatePresentBoolean(record, 'reasoningEnabled', `${label}.reasoningEnabled`) ||
    validatePresentBoundedString(record, 'defaultReasoningLevel', `${label}.defaultReasoningLevel`, { allowEmpty: true, max: 64 }) ||
    validatePresentBoundedString(record, 'codexAlias', `${label}.codexAlias`, { allowEmpty: true, max: 256 }) ||
    validatePresentBoundedString(record, 'description', `${label}.description`, { allowEmpty: true })
  )
}

function validateModelListProviderCapabilities(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return validatePresentBoundedString(record, 'protocol', `${label}.protocol`, { allowEmpty: true, max: 128 })
}

function validateThinkingConfig(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.mode, `${label}.mode`, ['off', 'auto', 'enabled']) ||
    validateEnum(record.level, `${label}.level`, ['minimal', 'low', 'medium', 'high', 'xhigh']) ||
    validatePresentNumber(record, 'budgetTokens', `${label}.budgetTokens`, { integer: true, min: 0, max: 1_000_000 }) ||
    validatePresentBoolean(record, 'collapseInUI', `${label}.collapseInUI`)
  )
}

function validateProviderModel(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  if (record.supportedReasoningLevels !== undefined && record.supportedReasoningLevels !== null) {
    if (!Array.isArray(record.supportedReasoningLevels)) return `${label}.supportedReasoningLevels must be an array`
    for (const [index, level] of record.supportedReasoningLevels.entries()) {
      const issue = validateEnum(level, `${label}.supportedReasoningLevels[${index}]`, ['minimal', 'low', 'medium', 'high', 'xhigh'])
      if (issue) return issue
    }
  }
  return (
    validateBoundedString(record.id, `${label}.id`, { max: 512 }) ||
    validatePresentBoundedString(record, 'label', `${label}.label`, { allowEmpty: true, max: 512 }) ||
    validatePresentNumber(record, 'contextWindow', `${label}.contextWindow`, { integer: true, min: 1, max: 10_000_000 }) ||
    validatePresentBoolean(record, 'enabled', `${label}.enabled`) ||
    validatePresentBoolean(record, 'supportsTools', `${label}.supportsTools`) ||
    validatePresentBoolean(record, 'supportsVision', `${label}.supportsVision`) ||
    validatePresentBoolean(record, 'supportsThinking', `${label}.supportsThinking`) ||
    validatePresentBoundedString(record, 'upstreamModel', `${label}.upstreamModel`, { allowEmpty: true, max: 512 }) ||
    validatePresentNumber(record, 'timeoutMs', `${label}.timeoutMs`, { integer: true, min: 250, max: 300_000 }) ||
    validatePresentNumber(record, 'retryCount', `${label}.retryCount`, { integer: true, min: 0, max: 10 }) ||
    validatePresentBoolean(record, 'reasoningEnabled', `${label}.reasoningEnabled`) ||
    validatePresentEnum(record, 'defaultReasoningLevel', `${label}.defaultReasoningLevel`, ['minimal', 'low', 'medium', 'high', 'xhigh']) ||
    validatePresentBoundedString(record, 'codexAlias', `${label}.codexAlias`, { allowEmpty: true, max: 256 }) ||
    validatePresentBoundedString(record, 'description', `${label}.description`, { allowEmpty: true })
  )
}

function validateProviderCapabilities(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateEnum(record.protocol, `${label}.protocol`, ['chat_completions', 'messages', 'generate_content']) ||
    validateBoolean(record.stream, `${label}.stream`) ||
    validateBoolean(record.nativeThinking, `${label}.nativeThinking`) ||
    validateBoolean(record.budgetTokens, `${label}.budgetTokens`) ||
    validateBoolean(record.toolCalls, `${label}.toolCalls`) ||
    validateBoolean(record.systemPrompt, `${label}.systemPrompt`)
  )
}

function validateProviderUpsert(args: readonly unknown[]): string | null {
  const provider = args[0]
  const recordIssue = validateRecord(provider, 'provider')
  if (recordIssue) return recordIssue
  const record = provider as Record<string, unknown>
  if (record.models !== undefined && record.models !== null) {
    if (!Array.isArray(record.models)) return 'provider.models must be an array'
    if (record.models.length > MAX_PROVIDER_MODELS) return `provider.models must contain at most ${MAX_PROVIDER_MODELS} items`
    for (const [index, model] of record.models.entries()) {
      const modelIssue = validateProviderModel(model, `provider.models[${index}]`)
      if (modelIssue) return modelIssue
    }
  }
  return (
    validateBoundedString(record.id, 'provider.id', { max: 256 }) ||
    validatePresentBoundedString(record, 'name', 'provider.name', { allowEmpty: true, max: 256 }) ||
    validatePresentEnum(record, 'kind', 'provider.kind', ['openai', 'anthropic', 'gemini', 'openai-compatible', 'custom']) ||
    (hasOwn(record, 'baseUrl') ? validateHttpUrl(record.baseUrl, 'provider.baseUrl', { allowEmpty: true }) : null) ||
    validatePresentBoundedString(record, 'apiKey', 'provider.apiKey', { allowEmpty: true }) ||
    validatePresentBoolean(record, 'enabled', 'provider.enabled') ||
    validatePresentBoolean(record, 'builtIn', 'provider.builtIn') ||
    (hasOwn(record, 'capabilities') ? validateProviderCapabilities(record.capabilities, 'provider.capabilities') : null) ||
    (hasOwn(record, 'defaultThinking') ? validateThinkingConfig(record.defaultThinking, 'provider.defaultThinking') : null)
  )
}

function validateProviderFetchModels(args: readonly unknown[]): string | null {
  const override = args[1]
  if (override === undefined || override === null) return validateString(args[0], 'id')
  const recordIssue = validateRecord(override, 'override')
  if (recordIssue) return validateString(args[0], 'id') || recordIssue
  const record = override as Record<string, unknown>
  return (
    validateString(args[0], 'id') ||
    (hasOwn(record, 'baseUrl') ? validateHttpUrl(record.baseUrl, 'override.baseUrl', { allowEmpty: true }) : null) ||
    validatePresentBoundedString(record, 'apiKey', 'override.apiKey', { allowEmpty: true }) ||
    validatePresentEnum(record, 'kind', 'override.kind', ['openai', 'anthropic', 'gemini', 'openai-compatible', 'custom'])
  )
}

function validateProviderRouteBinding(args: readonly unknown[]): string | null {
  const binding = args[0]
  const recordIssue = validateRecord(binding, 'binding')
  if (recordIssue) return recordIssue
  const record = binding as Record<string, unknown>
  if (hasOwn(record, 'thinkingAllow')) {
    if (!Array.isArray(record.thinkingAllow)) return 'binding.thinkingAllow must be an array'
    for (const [index, mode] of record.thinkingAllow.entries()) {
      const issue = validateEnum(mode, `binding.thinkingAllow[${index}]`, ['off', 'auto', 'enabled'])
      if (issue) return issue
    }
  }
  return (
    validateString(record.agentId, 'binding.agentId') ||
    validateString(record.providerId, 'binding.providerId') ||
    validateString(record.modelId, 'binding.modelId') ||
    validateThinkingConfig(record.thinking, 'binding.thinking') ||
    validatePresentEnum(record, 'protocol', 'binding.protocol', ['http', 'stdio-plain', 'acp']) ||
    validatePresentBoundedString(record, 'binary', 'binding.binary', { allowEmpty: true }) ||
    validatePresentBoundedString(record, 'args', 'binding.args', { allowEmpty: true })
  )
}

function validateModelRouteSettingsPatch(args: readonly unknown[]): string | null {
  const patch = args[0]
  const recordIssue = validateRecord(patch, 'patch')
  if (recordIssue) return recordIssue
  const record = patch as Record<string, unknown>
  if (record.codexSlots !== undefined && record.codexSlots !== null) {
    if (!Array.isArray(record.codexSlots)) return 'patch.codexSlots must be an array'
    if (record.codexSlots.length > MAX_CODEX_SLOTS) return `patch.codexSlots must contain at most ${MAX_CODEX_SLOTS} items`
    for (const [index, slot] of record.codexSlots.entries()) {
      const slotIssue = validateRecord(slot, `patch.codexSlots[${index}]`)
      if (slotIssue) return slotIssue
      const slotRecord = slot as Record<string, unknown>
      const fieldIssue = (
        validateString(slotRecord.slot, `patch.codexSlots[${index}].slot`) ||
        validateString(slotRecord.targetModelId, `patch.codexSlots[${index}].targetModelId`) ||
        validateEnum(slotRecord.mode, `patch.codexSlots[${index}].mode`, ['official_account', 'third_party_api', 'lan_share']) ||
        validateString(slotRecord.source, `patch.codexSlots[${index}].source`, { allowEmpty: true })
      )
      if (fieldIssue) return fieldIssue
    }
  }
  return (
    validatePresentBoundedString(record, 'fallbackModelId', 'patch.fallbackModelId', { allowEmpty: true, max: 512 }) ||
    validatePresentBoundedString(record, 'codexDefaultModel', 'patch.codexDefaultModel', { allowEmpty: true, max: 512 }) ||
    validatePresentEnum(record, 'codexInjectionMode', 'patch.codexInjectionMode', ['official_account', 'third_party_api', 'lan_share']) ||
    validatePresentBoolean(record, 'codexInternalModelLock', 'patch.codexInternalModelLock')
  )
}

function validateModelRoutePatch(args: readonly unknown[]): string | null {
  const patch = args[2]
  const recordIssue = validateRecord(patch, 'patch')
  if (recordIssue) return validateString(args[0], 'providerId') || validateString(args[1], 'modelId') || recordIssue
  const patchIssue = validateProviderModel({ id: 'patch', ...(patch as Record<string, unknown>) }, 'patch')
  return validateString(args[0], 'providerId') || validateString(args[1], 'modelId') || patchIssue
}

function validateModelTestInput(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  return (
    validateString(record.providerId, 'input.providerId') ||
    validateString(record.modelId, 'input.modelId') ||
    validatePresentBoundedString(record, 'upstreamModel', 'input.upstreamModel', { allowEmpty: true, max: 512 })
  )
}

function validateLocalAgentConfigure(args: readonly unknown[]): string | null {
  const patch = args[1]
  const patchIssue = validateRecord(patch, 'patch')
  if (patchIssue) return validateString(args[0], 'agentId') || patchIssue
  const record = patch as Record<string, unknown>
  return (
    validateString(args[0], 'agentId') ||
    validatePresentBoundedString(record, 'binary', 'patch.binary', { allowEmpty: true }) ||
    validatePresentBoundedString(record, 'args', 'patch.args', { allowEmpty: true }) ||
    validatePresentEnum(record, 'protocol', 'patch.protocol', ['stdio-plain', 'acp'])
  )
}

function validatePluginPath(value: unknown, label: string): string | null {
  const issue = validateBoundedString(value, label)
  if (issue) return issue
  const text = value as string
  if (text.includes('\0')) return `${label} must not contain NUL bytes`
  if (text.includes('..') || /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('/') || text.startsWith('\\')) {
    return `${label} must be a relative path without traversal`
  }
  return null
}

function validatePluginContributions(value: unknown, label: string, options: { optional?: boolean; allowContent?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an object`
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  if (hasOwn(record, 'commands')) {
    if (!Array.isArray(record.commands)) return `${label}.commands must be an array`
    if (record.commands.length > MAX_PLUGIN_CONTRIBUTIONS) return `${label}.commands must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
    for (const [index, command] of record.commands.entries()) {
      const commandIssue = validateRecord(command, `${label}.commands[${index}]`)
      if (commandIssue) return commandIssue
      const commandRecord = command as Record<string, unknown>
      const fieldIssue = validateString(commandRecord.id, `${label}.commands[${index}].id`) || validateBoundedString(commandRecord.label, `${label}.commands[${index}].label`, { max: 512 })
      if (fieldIssue) return fieldIssue
    }
  }
  if (hasOwn(record, 'slashCommands')) {
    if (!Array.isArray(record.slashCommands)) return `${label}.slashCommands must be an array`
    if (record.slashCommands.length > MAX_PLUGIN_CONTRIBUTIONS) return `${label}.slashCommands must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
    for (const [index, command] of record.slashCommands.entries()) {
      const commandIssue = validateRecord(command, `${label}.slashCommands[${index}]`)
      if (commandIssue) return commandIssue
      const commandRecord = command as Record<string, unknown>
      const fieldIssue = (
        validateString(commandRecord.id, `${label}.slashCommands[${index}].id`) ||
        validateBoundedString(commandRecord.label, `${label}.slashCommands[${index}].label`, { max: 128 }) ||
        validatePresentBoundedString(commandRecord, 'description', `${label}.slashCommands[${index}].description`, { allowEmpty: true, max: 2048 }) ||
        validatePresentBoundedString(commandRecord, 'insertText', `${label}.slashCommands[${index}].insertText`, { allowEmpty: true, max: 4096 }) ||
        validatePresentBoundedString(commandRecord, 'promptTemplate', `${label}.slashCommands[${index}].promptTemplate`, { allowEmpty: true, max: 256 * 1024 })
      )
      if (fieldIssue) return fieldIssue
      const slashLabel = String(commandRecord.label || '')
      if (!slashLabel.startsWith('/')) return `${label}.slashCommands[${index}].label must start with /`
      if (/\s/.test(slashLabel)) return `${label}.slashCommands[${index}].label must not contain whitespace`
    }
  }
  if (hasOwn(record, 'skills')) {
    if (!Array.isArray(record.skills)) return `${label}.skills must be an array`
    if (record.skills.length > MAX_PLUGIN_CONTRIBUTIONS) return `${label}.skills must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
    for (const [index, skill] of record.skills.entries()) {
      const skillIssue = validateRecord(skill, `${label}.skills[${index}]`)
      if (skillIssue) return skillIssue
      const skillRecord = skill as Record<string, unknown>
      const fieldIssue = (
        validateString(skillRecord.id, `${label}.skills[${index}].id`) ||
        validatePluginPath(skillRecord.path, `${label}.skills[${index}].path`) ||
        (options.allowContent && hasOwn(skillRecord, 'content') ? validateBoundedString(skillRecord.content, `${label}.skills[${index}].content`, { allowEmpty: true, max: 256 * 1024 }) : null)
      )
      if (fieldIssue) return fieldIssue
    }
  }
  if (hasOwn(record, 'prompts')) {
    if (!Array.isArray(record.prompts)) return `${label}.prompts must be an array`
    if (record.prompts.length > MAX_PLUGIN_CONTRIBUTIONS) return `${label}.prompts must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
    for (const [index, prompt] of record.prompts.entries()) {
      const promptIssue = validateRecord(prompt, `${label}.prompts[${index}]`)
      if (promptIssue) return promptIssue
      const promptRecord = prompt as Record<string, unknown>
      const fieldIssue = (
        validateString(promptRecord.id, `${label}.prompts[${index}].id`) ||
        validateBoundedString(promptRecord.name, `${label}.prompts[${index}].name`, { max: 512 }) ||
        validateBoundedString(promptRecord.body, `${label}.prompts[${index}].body`, { allowEmpty: true, max: 256 * 1024 })
      )
      if (fieldIssue) return fieldIssue
    }
  }
  if (hasOwn(record, 'activityParsers')) {
    if (!Array.isArray(record.activityParsers)) return `${label}.activityParsers must be an array`
    if (record.activityParsers.length > MAX_PLUGIN_CONTRIBUTIONS) return `${label}.activityParsers must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
    for (const [index, parser] of record.activityParsers.entries()) {
      const parserIssue = validateRecord(parser, `${label}.activityParsers[${index}]`)
      if (parserIssue) return parserIssue
      const parserRecord = parser as Record<string, unknown>
      const fieldIssue = (
        validateString(parserRecord.id, `${label}.activityParsers[${index}].id`) ||
        validateBoundedString(parserRecord.pattern, `${label}.activityParsers[${index}].pattern`, { max: 4096 }) ||
        validatePresentBoundedString(parserRecord, 'flags', `${label}.activityParsers[${index}].flags`, { allowEmpty: true, max: 8 }) ||
        validatePresentBoundedString(parserRecord, 'kind', `${label}.activityParsers[${index}].kind`, { allowEmpty: true, max: 128 })
      )
      if (fieldIssue) return fieldIssue
      const flags = String(parserRecord.flags || '')
      if (/[^dgimsuvy]/.test(flags)) return `${label}.activityParsers[${index}].flags contains unsupported RegExp flags`
      try { new RegExp(String(parserRecord.pattern), flags) } catch { return `${label}.activityParsers[${index}].pattern must be a valid RegExp` }
      if (parserRecord.fields !== undefined && parserRecord.fields !== null) {
        const fieldsIssue = validateRecord(parserRecord.fields, `${label}.activityParsers[${index}].fields`)
        if (fieldsIssue) return fieldsIssue
        for (const [key, value] of Object.entries(parserRecord.fields as Record<string, unknown>)) {
          const fieldIssue = (
            validateBoundedString(key, `${label}.activityParsers[${index}].fields key`, { max: 128 }) ||
            validateBoundedString(value, `${label}.activityParsers[${index}].fields.${key}`, { max: 128 })
          )
          if (fieldIssue) return fieldIssue
        }
      }
    }
  }
  if (hasOwn(record, 'preDispatchHooks')) {
    if (!Array.isArray(record.preDispatchHooks)) return `${label}.preDispatchHooks must be an array`
    if (record.preDispatchHooks.length > MAX_PLUGIN_CONTRIBUTIONS) return `${label}.preDispatchHooks must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
    for (const [index, hook] of record.preDispatchHooks.entries()) {
      const hookIssue = validateRecord(hook, `${label}.preDispatchHooks[${index}]`)
      if (hookIssue) return hookIssue
      const hookRecord = hook as Record<string, unknown>
      const fieldIssue = (
        validateString(hookRecord.id, `${label}.preDispatchHooks[${index}].id`) ||
        validatePresentBoundedString(hookRecord, 'pattern', `${label}.preDispatchHooks[${index}].pattern`, { allowEmpty: true, max: 4096 }) ||
        validatePresentBoundedString(hookRecord, 'appendContext', `${label}.preDispatchHooks[${index}].appendContext`, { allowEmpty: true, max: 256 * 1024 }) ||
        validatePresentBoundedString(hookRecord, 'denyMessage', `${label}.preDispatchHooks[${index}].denyMessage`, { allowEmpty: true, max: 2048 }) ||
        validatePresentBoundedString(hookRecord, 'message', `${label}.preDispatchHooks[${index}].message`, { allowEmpty: true, max: 2048 }) ||
        validateBoolean(hookRecord.requireApproval, `${label}.preDispatchHooks[${index}].requireApproval`, { optional: true })
      )
      if (fieldIssue) return fieldIssue
      if (typeof hookRecord.pattern === 'string' && hookRecord.pattern.trim()) {
        try { new RegExp(hookRecord.pattern, 'i') } catch { return `${label}.preDispatchHooks[${index}].pattern must be a valid RegExp` }
      }
    }
  }
  return null
}

function validatePluginDependencies(value: unknown, label: string, options: { optional?: boolean } = {}): string | null {
  if (value === undefined || value === null) return options.optional ? null : `${label} must be an array`
  if (!Array.isArray(value)) return `${label} must be an array`
  if (value.length > MAX_PLUGIN_DEPENDENCIES) return `${label} must contain at most ${MAX_PLUGIN_DEPENDENCIES} items`
  for (const [index, dependency] of value.entries()) {
    const dependencyIssue = validateRecord(dependency, `${label}[${index}]`)
    if (dependencyIssue) return dependencyIssue
    const dependencyRecord = dependency as Record<string, unknown>
    const fieldIssue = (
      validateString(dependencyRecord.name, `${label}[${index}].name`) ||
      validateString(dependencyRecord.version, `${label}[${index}].version`) ||
      validateBoolean(dependencyRecord.optional, `${label}[${index}].optional`)
    )
    if (fieldIssue) return fieldIssue
  }
  return null
}

function validatePluginManifest(value: unknown, label: string, options: { requireId?: boolean } = {}): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    (options.requireId ? validateString(record.id, `${label}.id`) : validatePresentBoundedString(record, 'id', `${label}.id`, { max: 256 })) ||
    validateBoundedString(record.name, `${label}.name`, { max: 512 }) ||
    validateString(record.version, `${label}.version`) ||
    validatePresentBoundedString(record, 'description', `${label}.description`, { allowEmpty: true }) ||
    validatePresentBoundedString(record, 'author', `${label}.author`, { allowEmpty: true, max: 512 }) ||
    (hasOwn(record, 'dependencies') ? validatePluginDependencies(record.dependencies, `${label}.dependencies`) : null) ||
    (hasOwn(record, 'contributes') ? validatePluginContributions(record.contributes, `${label}.contributes`) : null)
  )
}

function validatePluginEntry(value: unknown, label: string): string | null {
  const recordIssue = validateRecord(value, label)
  if (recordIssue) return recordIssue
  const record = value as Record<string, unknown>
  return (
    validateString(record.id, `${label}.id`) ||
    validatePluginManifest(record.manifest, `${label}.manifest`) ||
    validateString(record.path, `${label}.path`) ||
    validateBoolean(record.enabled, `${label}.enabled`) ||
    validateEnum(record.source, `${label}.source`, ['local', 'global'])
  )
}

function validatePluginEntryArray(args: readonly unknown[]): string | null {
  const plugins = args[0]
  if (!Array.isArray(plugins)) return 'plugins must be an array'
  if (plugins.length > MAX_PLUGIN_CONTRIBUTIONS) return `plugins must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} items`
  for (const [index, plugin] of plugins.entries()) {
    const issue = validatePluginEntry(plugin, `plugins[${index}]`)
    if (issue) return issue
  }
  return null
}

function validatePluginRepositoryImport(args: readonly unknown[]): string | null {
  const input = args[0]
  const recordIssue = validateRecord(input, 'input')
  if (recordIssue) return recordIssue
  const record = input as Record<string, unknown>
  const urlIssue = validatePluginRepositoryUrl(record.url, 'input.url')
  if (urlIssue) return urlIssue
  return (
    validatePresentBoundedString(record, 'id', 'input.id', { max: 256 }) ||
    validatePresentBoundedString(record, 'name', 'input.name', { allowEmpty: true, max: 512 }) ||
    validatePresentBoundedString(record, 'branch', 'input.branch', { allowEmpty: true, max: 256 })
  )
}

function validatePluginRepositoryUrl(value: unknown, label: string): string | null {
  const issue = validateBoundedString(value, label)
  if (issue) return issue
  let parsed: URL
  try {
    parsed = new URL(value as string)
  } catch {
    return `${label} must be a valid HTTPS URL`
  }
  if (parsed.protocol !== 'https:') return `${label} must use https`
  if (!['github.com', 'gitcode.com'].includes(parsed.hostname.toLowerCase())) {
    return `${label} host must be github.com or gitcode.com`
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  return parts.length >= 2 ? null : `${label} must include owner and repository name`
}

function appPathFallback(args: readonly unknown[], error: string): AppOpenPathResultLike {
  const input = isRecord(args[0]) ? args[0] : {}
  return {
    ok: false,
    path: typeof input.path === 'string' ? input.path : '',
    target: typeof input.target === 'string' ? input.target : 'system',
    error
  }
}

function appResolveFallback(args: readonly unknown[], error: string): AppResolvePathResultLike {
  const input = isRecord(args[0]) ? args[0] : {}
  return { ok: false, path: typeof input.path === 'string' ? input.path : '', error }
}

function appReadTextFallback(args: readonly unknown[], error: string): AppReadTextFileResultLike {
  const input = isRecord(args[0]) ? args[0] : {}
  return { ok: false, path: typeof input.path === 'string' ? input.path : '', error }
}

function conversationExportFallback(args: readonly unknown[], error: string): ConversationExportFileResultLike {
  return { ok: false, path: typeof args[2] === 'string' ? args[2] : '', error }
}

const workspaceReadFallback: IpcInvalidResponseFactory = (_args, error): WorkspaceFileReadResult => ({
  ok: false,
  content: '',
  path: '',
  error
})

const workspaceWriteFallback: IpcInvalidResponseFactory = (_args, error): WorkspaceFileWriteResult => ({ ok: false, error })

const workspaceImageFallback: IpcInvalidResponseFactory = (_args, error): WorkspaceImageReadResult => ({
  ok: false,
  dataUrl: '',
  mimeType: '',
  size: 0,
  error
})

const workspaceDirectoryFallback: IpcInvalidResponseFactory = (_args, error): WorkspaceDirectoryListResult => ({
  ok: false,
  entries: [],
  error
})

const ipcRuntimeValidationSpecs: Partial<Record<IpcChannel, IpcRuntimeValidationSpec>> = {
  'win:minimize': {
    validate: validateNoArgs
  },
  'win:maximizeToggle': {
    validate: validateNoArgs
  },
  'win:isMaximized': {
    validate: validateNoArgs
  },
  'win:close': {
    validate: validateNoArgs
  },
  'windows:openWorkbench': {
    validate: validateNoArgs
  },
  'app:openExternal': {
    validate: args => validateString(args[0], 'url'),
    response: (_args, error): AppOpenExternalResultLike => ({ ok: false, error })
  },
  'app:openPath': {
    validate: args => validateAppPathInput(args, 'input', { openTarget: true }),
    response: appPathFallback
  },
  'app:resolvePath': {
    validate: args => validateAppPathInput(args, 'input'),
    response: appResolveFallback
  },
  'app:readTextFile': {
    validate: args => validateAppPathInput(args, 'input'),
    response: appReadTextFallback
  },
  'app:pickFolder': {
    validate: args => validatePickOptions(args, 'options')
  },
  'app:pickFiles': {
    validate: args => validatePickOptions(args, 'options')
  },
  'dialog:selectDirectory': {
    validate: validateNoArgs
  },
  'takeover:status': {
    validate: validateNoArgs
  },
  'takeover:apply': {
    validate: args => validateTakeoverApp(args[0]) || validateBoundedString(args[1], 'modelRef', { max: 512 })
  },
  'takeover:restore': {
    validate: args => validateTakeoverApp(args[0])
  },
  'store:get': {
    validate: validateStoreGet
  },
  'store:set': {
    validate: validateStoreSet
  },
  'proxy:info': {
    validate: validateNoArgs
  },
  'agents:locate': {
    validate: validateNoArgs
  },
  'providers:get': {
    validate: validateNoArgs
  },
  'providers:healthAll': {
    validate: validateNoArgs
  },
  'workspaces:list': {
    validate: validateNoArgs
  },
  'workspaces:getActive': {
    validate: validateNoArgs
  },
  'agentLoop:getConfig': {
    validate: validateNoArgs
  },
  'agentLoop:getStatus': {
    validate: validateNoArgs
  },
  'agentLoop:getAgents': {
    validate: validateNoArgs
  },
  'agentLoop:refreshAgents': {
    validate: validateNoArgs
  },
  'agentLoop:getRouteInfo': {
    validate: args => validateBoundedString(args[0], 'prompt', { allowEmpty: true, max: MAX_TURN_PROMPT_CHARS })
  },
  'models:routeSettings:get': {
    validate: validateNoArgs
  },
  'models:list': {
    validate: validateModelListProviders
  },
  'models:exportCodexCatalog': {
    validate: validateNoArgs
  },
  'models:favorites': {
    validate: validateNoArgs
  },
  'models:hidden': {
    validate: validateNoArgs
  },
  'mcp:getSystemConfig': {
    validate: validateNoArgs
  },
  'workflows:seed': {
    validate: validateNoArgs
  },
  'plugins:repositories': {
    validate: validateNoArgs
  },
  'plugins:listInstalled': {
    validate: validateNoArgs
  },
  'plugins:enabledContributions': {
    validate: validateNoArgs
  },
  'localAgents:detect': {
    validate: validateNoArgs
  },
  'localAgents:status': {
    validate: validateNoArgs
  },
  'localAgents:options': {
    validate: validateNoArgs
  },
  'localModels:scan': {
    validate: args => validateOptionalAgentId(args[0])
  },
  'localModels:readConfig': {
    validate: args => validateBoundedString(args[0], 'agentId', { max: 256 })
  },
  'settings:getRunTimeout': {
    validate: validateNoArgs
  },
  'commands:list': {
    validate: validateNoArgs
  },
  'schedules:list': {
    validate: validateNoArgs
  },
  'ecc:status': {
    validate: validateNoArgs
  },
  'ecc:update': {
    validate: validateNoArgs
  },
  'updates:status': {
    validate: validateNoArgs
  },
  'updates:openDownload': {
    validate: validateNoArgs
  },
  'updates:download': {
    validate: validateNoArgs
  },
  'updates:install': {
    validate: validateNoArgs
  },
  'routes:explain': {
    validate: args => validateBoundedString(args[0], 'turnId', { max: 256 })
  },
  'logs:path': {
    validate: validateNoArgs
  },
  'logs:recent': {
    validate: args => validateNumber(args[0], 'limit', { optional: true, integer: true, min: 1, max: 1000 })
  },
  'diagnostics:runSuite': {
    validate: validateNoArgs
  },
  'diagnostics:run': {
    validate: validateNoArgs
  },
  'github:checkCli': {
    validate: validateNoArgs
  },
  'github:listPrs': {
    validate: validateGithubListArgs
  },
  'github:listIssues': {
    validate: validateGithubListArgs
  },
  'github:currentBranchPr': {
    validate: validateNoArgs
  },
  'release:checks': {
    validate: validateNoArgs
  },
  'terminal:history': {
    validate: validateNoArgs
  },
  'tasks:clearCompleted': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'shortcuts:resetAll': {
    validate: validateNoArgs
  },
  'shortcuts:conflicts': {
    validate: validateNoArgs
  },
  'slashCommands:list': {
    validate: validateNoArgs
  },
  'notifications:unreadCount': {
    validate: validateNoArgs
  },
  'notifications:markAllRead': {
    validate: validateNoArgs
  },
  'notifications:clearAll': {
    validate: validateNoArgs
  },
  'onboarding:getState': {
    validate: validateNoArgs
  },
  'onboarding:shouldShow': {
    validate: validateNoArgs
  },
  'onboarding:skipAll': {
    validate: validateNoArgs
  },
  'onboarding:reset': {
    validate: validateNoArgs
  },
  'onboarding:nextStep': {
    validate: validateNoArgs
  },
  'backup:create': {
    validate: validateNoArgs
  },
  'backup:list': {
    validate: validateNoArgs
  },
  'usage:pricing:list': {
    validate: validateNoArgs
  },
  'prompts:slashCommands': {
    validate: validateNoArgs
  },
  'prompts:seedDefaults': {
    validate: validateNoArgs
  },
  'budget:get': {
    validate: validateNoArgs
  },
  'workflow:runHistory': {
    validate: validateNoArgs
  },
  'teams:list': {
    validate: validateNoArgs
  },
  'sdd:parseBlocks': {
    validate: args => validateBoundedString(args[0], 'content', { allowEmpty: true, max: MAX_TODO_MARKDOWN_CHARS })
  },
  'sdd:parsePlanCovers': {
    validate: args => validateBoundedString(args[0], 'planMarkdown', { allowEmpty: true, max: MAX_TODO_MARKDOWN_CHARS })
  },
  'projectMap:build': {
    validate: validateProjectMapBuild
  },
  'projectMap:search': {
    validate: validateProjectMapSearch
  },
  'backup:restore': {
    validate: args => validateBackupFilename(args[0])
  },
  'backup:delete': {
    validate: args => validateBackupFilename(args[0])
  },
  'knowledge:detectTechStack': {
    validate: args => validateProjectRootPath(args[0])
  },
  'knowledge:generateSummary': {
    validate: args => validateProjectRootPath(args[0]) || validateKnowledgeEntries(args[1])
  },
  'todos:list': {
    validate: args => validateString(args[0], 'threadId')
  },
  'todos:set': {
    validate: validateThreadTodoSet
  },
  'todos:upsert': {
    validate: validateThreadTodoUpsert
  },
  'todos:delete': {
    validate: args => validateString(args[0], 'threadId') || validateString(args[1], 'todoId')
  },
  'todos:clear': {
    validate: args => validateString(args[0], 'threadId')
  },
  'todos:syncFromMarkdown': {
    validate: validateThreadTodoSync
  },
  'workflows:list': {
    validate: args => validateEnum(args[0], 'category', ['development', 'review', 'research', 'deployment', 'custom'], { optional: true })
  },
  'workflows:get': {
    validate: args => validateString(args[0], 'id')
  },
  'workflows:upsert': {
    validate: validateWorkflowUpsert
  },
  'workflows:delete': {
    validate: args => validateString(args[0], 'id')
  },
  'workflows:search': {
    validate: args => validateBoundedString(args[0], 'query', { allowEmpty: true, max: 512 })
  },
  'teams:save': {
    validate: validateTeamPresetSave
  },
  'teams:delete': {
    validate: args => validateString(args[0], 'id')
  },
  'teams:defaultFirefly': {
    validate: args => validateBoundedStringArray(args[0], 'agentIds', { maxItems: MAX_TEAM_MEMBERS, maxStringLength: 256 })
  },
  'prompts:list': {
    validate: args => validateEnum(args[0], 'category', ['general', 'coding', 'review', 'research', 'writing', 'custom'], { optional: true })
  },
  'prompts:get': {
    validate: args => validateString(args[0], 'id')
  },
  'prompts:upsert': {
    validate: validatePromptUpsert
  },
  'prompts:delete': {
    validate: args => validateString(args[0], 'id')
  },
  'prompts:search': {
    validate: args => validateBoundedString(args[0], 'query', { allowEmpty: true, max: 512 })
  },
  'prompts:incrementUse': {
    validate: args => validateString(args[0], 'id')
  },
  'usage:stats': {
    validate: args => (
      validateEnum(args[0], 'range', ['all', '90d', '30d', '7d'], { optional: true }) ||
      validateEnum(args[1], 'view', ['overview', 'models', 'requests', 'providers', 'pricing'], { optional: true })
    )
  },
  'usage:records': {
    validate: args => (
      validateUsageFilter(args[0]) ||
      validateNumber(args[1], 'page', { optional: true, integer: true, min: 1, max: 100000 }) ||
      validateNumber(args[2], 'pageSize', { optional: true, integer: true, min: 1, max: 200 })
    )
  },
  'usage:recordDetail': {
    validate: args => validateBoundedString(args[0], 'id', { max: MAX_USAGE_ID_CHARS })
  },
  'usage:pricing:upsert': {
    validate: validateUsagePricingRule
  },
  'usage:pricing:delete': {
    validate: args => (
      validateBoundedString(args[0], 'idOrModelId', { max: MAX_USAGE_ID_CHARS }) ||
      validateBoundedString(args[1], 'providerId', { optional: true, max: MAX_USAGE_ID_CHARS })
    )
  },
  'budget:update': {
    validate: validateBudgetPatch
  },
  'budget:check': {
    validate: validateBudgetCheck
  },
  'budget:estimateDispatch': {
    validate: validateTurnCreateInput
  },
  'goals:get': {
    validate: args => validateOptionalGoalThreadId(args[0])
  },
  'goals:set': {
    validate: validateGoalSet
  },
  'goals:clear': {
    validate: args => validateString(args[0], 'threadId')
  },
  'commands:run': {
    validate: validateCommandRunInput
  },
  'schedules:runPreview': {
    validate: args => validateEnum(args[0], 'preset', ['auto', 'broadcast', 'chain', 'orchestrate', 'lead-workers', 'parallel-review', 'firefly-custom', 'custom'])
  },
  'settings:setRunTimeout': {
    validate: args => validateNumber(args[0], 'value', { min: MIN_RUN_TIMEOUT_MS, max: MAX_RUN_TIMEOUT_MS })
  },
  'updates:check': {
    validate: args => validateEnum(args[0], 'channel', ['stable', 'preview'], { optional: true })
  },
  'updates:setChannel': {
    validate: args => validateEnum(args[0], 'channel', ['stable', 'preview'])
  },
  'tasks:delete': {
    validate: args => validateBoundedString(args[0], 'taskId', { max: 256 })
  },
  'workflow:substituteVars': {
    validate: args => validateBoundedString(args[0], 'template', { allowEmpty: true, max: MAX_WORKFLOW_TEMPLATE_CHARS }) || validateWorkflowVariables(args[1])
  },
  'workflow:evaluateCondition': {
    validate: args => validateBoundedString(args[0], 'condition', { allowEmpty: true, max: 4096 }) || validateWorkflowVariables(args[1])
  },
  'workflow:saveRun': {
    validate: validateWorkflowRunRecord
  },
  'workflow:runHistoryFor': {
    validate: args => validateBoundedString(args[0], 'workflowId', { max: 256 })
  },
  'terminalAi:buildPrompt': {
    validate: args => validateBoundedString(args[0], 'userPrompt', { max: MAX_QUICK_COMPLETE_PROMPT_CHARS }) || validateTerminalContext(args[1])
  },
  'terminalAi:suggestCommand': {
    validate: args => validateBoundedString(args[0], 'intent', { max: 8192 }) || validateTerminalContext(args[1])
  },
  'terminalAi:explainOutput': {
    validate: args => validateTerminalContext(args[0])
  },
  'ai:quickComplete': {
    validate: validateQuickCompleteInput,
    response: (_args, error): QuickCompleteResultLike => ({ ok: false, error })
  },
  'browser:open': {
    validate: validateBrowserOpenInput
  },
  'browser:capture': {
    validate: validateBrowserCapture
  },
  'browser:summarize': {
    validate: args => validateBrowserSnapshot(args[0])
  },
  'browser:extractText': {
    validate: args => validateBoundedString(args[0], 'html', { allowEmpty: true, max: MAX_BROWSER_TEXT_CHARS })
  },
  'browser:analyzePrompt': {
    validate: args => validateBrowserSnapshot(args[0]) || validateBoundedString(args[1], 'request', { optional: true, allowEmpty: true, max: 8192 })
  },
  'turns:create': {
    validate: validateTurnCreateInput
  },
  'turns:retry': {
    validate: args => validateBoundedString(args[0], 'turnId', { max: 256 })
  },
  'turns:cancel': {
    validate: args => validateBoundedString(args[0], 'turnId', { max: 256 })
  },
  'turns:cancelAgent': {
    validate: args => validateBoundedString(args[0], 'turnId', { max: 256 }) || validateBoundedString(args[1], 'agentId', { max: 256 })
  },
  'turns:resolveGuard': {
    validate: args => validateBoundedString(args[0], 'requestId', { max: 256 }) || validateBoolean(args[1], 'approved')
  },
  'hub:status': {
    validate: validateNoArgs
  },
  'threads:list': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'threads:create': {
    validate: validateThreadCreate
  },
  'threads:rename': {
    validate: args => validateBoundedString(args[0], 'threadId', { max: 256 }) || validateBoundedString(args[1], 'title', { allowEmpty: true, max: 512 })
  },
  'threads:delete': {
    validate: args => validateBoundedString(args[0], 'threadId', { max: 256 })
  },
  'threads:select': {
    validate: args => validateNullableThreadId(args[0])
  },
  'threads:fork': {
    validate: validateThreadFork
  },
  'runtime:snapshot': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'runtime:eventsSince': {
    validate: args => validateBoundedString(args[0], 'threadId', { max: 256 }) || validateNumber(args[1], 'seq', { optional: true, integer: true, min: 0 })
  },
  'context:projection': {
    validate: validateContextProjectionInput
  },
  'agentic:capabilities': {
    validate: validateNoArgs
  },
  'agentic:getEnabled': {
    validate: validateNoArgs
  },
  'agentic:setEnabled': {
    validate: args => validateBoundedString(args[0], 'agentId', { max: 256 }) || validateBoolean(args[1], 'on')
  },
  'agentic:getMode': {
    validate: validateNoArgs
  },
  'agentic:setMode': {
    validate: args => validateEnum(args[0], 'mode', AGENTIC_MODES)
  },
  'agentic:getApprovalConfig': {
    validate: validateNoArgs
  },
  'agentic:setApprovalPreset': {
    validate: args => validateEnum(args[0], 'preset', AGENTIC_APPROVAL_PRESETS)
  },
  'agentic:setApprovalDefault': {
    validate: args => validateEnum(args[0], 'tool', AGENTIC_GUARDED_TOOLS) || validateEnum(args[1], 'policy', AGENTIC_APPROVAL_POLICIES)
  },
  'agentic:setApprovalOverride': {
    validate: args => (
      validateBoundedString(args[0], 'agentId', { max: 256 }) ||
      validateEnum(args[1], 'tool', AGENTIC_GUARDED_TOOLS) ||
      (args[2] === null ? null : validateEnum(args[2], 'policy', AGENTIC_APPROVAL_POLICIES))
    )
  },
  'agentic:resolveApproval': {
    validate: args => validateBoundedString(args[0], 'requestId', { max: 256 }) || validateBoolean(args[1], 'approved')
  },
  'skills:list': {
    validate: validateNoArgs
  },
  'skills:builtins': {
    validate: validateNoArgs
  },
  'skills:scanLocal': {
    validate: validateNoArgs
  },
  'skills:refreshLocal': {
    validate: validateNoArgs
  },
  'skills:add': {
    validate: validateSkillInput
  },
  'skills:update': {
    validate: validateSkillPatch
  },
  'skills:remove': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'skills:getInstalls': {
    validate: validateNoArgs
  },
  'skills:install': {
    validate: args => validateBoundedString(args[0], 'agentId', { max: 256 }) || validateBoundedString(args[1], 'skillId', { max: 256 })
  },
  'skills:uninstall': {
    validate: args => validateBoundedString(args[0], 'agentId', { max: 256 }) || validateBoundedString(args[1], 'skillId', { max: 256 })
  },
  'memory:catalog': {
    validate: validateNoArgs
  },
  'memory:getSettings': {
    validate: validateNoArgs
  },
  'memory:updateSettings': {
    validate: args => validateRecord(args[0], 'patch') || validatePresentBoolean(args[0] as Record<string, unknown>, 'enabled', 'patch.enabled')
  },
  'memory:list': {
    validate: args => validateMemoryCategory(args[0], 'category', { optional: true })
  },
  'memory:search': {
    validate: args => validateBoundedString(args[0], 'query', { allowEmpty: true, max: 512 }) || validateMemoryCategory(args[1], 'category', { optional: true })
  },
  'memory:addEntry': {
    validate: validateMemoryEntryInput
  },
  'memory:importConversation': {
    validate: args => validateBoundedString(args[0], 'source', { allowEmpty: true, max: 512 }) || validateBoundedString(args[1], 'content', { max: MAX_MEMORY_TEXT_CHARS })
  },
  'memory:listCandidates': {
    validate: validateNoArgs
  },
  'memory:approveCandidate': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'memory:updateEntry': {
    validate: validateMemoryEntryPatch
  },
  'memory:disableEntry': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'memory:delete': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'memory:restore': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'memory:graph': {
    validate: args => validateMemoryEntryArray(args[0])
  },
  'memory:cleanupSuggestions': {
    validate: args => validateMemoryGraph(args[0])
  },
  'memory:scoreQuality': {
    validate: args => {
      const issue = validateRecord(args[0], 'entry')
      return issue || validateMemoryEntryRecord(args[0] as Record<string, unknown>, 'entry', { quality: true })
    }
  },
  'memory:detectConflicts': {
    validate: validateMemoryConflictEntries
  },
  'firefly:createState': {
    validate: validateNoArgs
  },
  'firefly:completeRole': {
    validate: validateFireflyCompleteRole
  },
  'firefly:getRoleContext': {
    validate: validateFireflyRoleContext
  },
  'firefly:isComplete': {
    validate: args => validateFireflyState(args[0])
  },
  'firefly:getOutput': {
    validate: args => validateFireflyState(args[0])
  },
  'notifications:list': {
    validate: args => validateBoolean(args[0], 'unreadOnly', { optional: true })
  },
  'notifications:push': {
    validate: validateNotificationPush
  },
  'notifications:markRead': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'notifications:delete': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'onboarding:completeStep': {
    validate: args => validateOnboardingStep(args[0]) || validateBoolean(args[1], 'skipped', { optional: true })
  },
  'inlineEdit:buildPrompt': {
    validate: validateInlineEditBuildPrompt
  },
  'inlineEdit:validate': {
    validate: args => (
      validateBoundedString(args[0], 'original', { allowEmpty: true, max: MAX_INLINE_EDIT_TEXT_CHARS }) ||
      validateBoundedString(args[1], 'replacement', { allowEmpty: true, max: MAX_INLINE_EDIT_TEXT_CHARS })
    )
  },
  'inlineEdit:apply': {
    validate: validateInlineEditApply
  },
  'shortcuts:list': {
    validate: args => validateEnum(args[0], 'category', ['navigation', 'action', 'editor', 'agent'], { optional: true })
  },
  'shortcuts:get': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'shortcuts:update': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 }) || validateShortcutKey(args[1])
  },
  'shortcuts:reset': {
    validate: args => validateBoundedString(args[0], 'id', { max: 256 })
  },
  'slashCommands:get': {
    validate: args => validateSlashShortcut(args[0])
  },
  'slashCommands:save': {
    validate: validateSlashCommandSave
  },
  'slashCommands:delete': {
    validate: args => validateSlashShortcut(args[0])
  },
  'slashCommands:resolve': {
    validate: args => validateSlashShortcut(args[0]) || validateSlashCommandParams(args[1])
  },
  'slashCommands:validate': {
    validate: args => validateBoundedString(args[0], 'shortcut', { max: 128 })
  },
  'slashCommands:conflict': {
    validate: args => validateBoundedString(args[0], 'shortcut', { max: 128 })
  },
  'providers:upsert': {
    validate: validateProviderUpsert
  },
  'providers:delete': {
    validate: args => validateString(args[0], 'id')
  },
  'providers:setEnabled': {
    validate: args => validateString(args[0], 'id') || validateBoolean(args[1], 'enabled')
  },
  'providers:setKey': {
    validate: args => validateString(args[0], 'id') || validateBoundedString(args[1], 'key', { allowEmpty: true })
  },
  'providers:health': {
    validate: args => validateString(args[0], 'id')
  },
  'providers:fetchModels': {
    validate: validateProviderFetchModels
  },
  'providers:reorderForClaude': {
    validate: args => validateBoundedStringArray(args[0], 'orderedIds', { maxItems: MAX_ROUTE_CHAIN, maxStringLength: 256 })
  },
  'routing:setBinding': {
    validate: validateProviderRouteBinding
  },
  'routing:removeBinding': {
    validate: args => validateString(args[0], 'agentId')
  },
  'routing:setFallback': {
    validate: args => validateBoundedStringArray(args[0], 'chain', { maxItems: MAX_ROUTE_CHAIN, maxStringLength: 256 })
  },
  'routing:setStrategy': {
    validate: args => validateEnum(args[0], 'strategy', ['single', 'load-balance', 'cost-aware'])
  },
  'routing:setBindingThinking': {
    validate: args => validateString(args[0], 'agentId') || validateThinkingConfig(args[1], 'thinking')
  },
  'routing:setProviderThinking': {
    validate: args => validateString(args[0], 'id') || validateThinkingConfig(args[1], 'thinking')
  },
  'routing:activeBinding': {
    validate: args => validateString(args[0], 'agentId')
  },
  'models:routeSettings:set': {
    validate: validateModelRouteSettingsPatch
  },
  'models:updateRoute': {
    validate: validateModelRoutePatch
  },
  'models:test': {
    validate: validateModelTestInput
  },
  'models:toggleFavorite': {
    validate: args => validateString(args[0], 'providerId') || validateString(args[1], 'modelId')
  },
  'models:toggleHidden': {
    validate: args => validateString(args[0], 'providerId') || validateString(args[1], 'modelId')
  },
  'plugins:scan': {
    validate: args => validateString(args[0], 'workspaceRoot', { optional: true, allowEmpty: true })
  },
  'plugins:validate': {
    validate: args => validatePluginManifest(args[0], 'manifest')
  },
  'plugins:contributions': {
    validate: validatePluginEntryArray
  },
  'plugins:importRepository': {
    validate: validatePluginRepositoryImport
  },
  'plugins:install': {
    validate: args => validatePluginManifest(args[0], 'manifest', { requireId: true })
  },
  'plugins:uninstall': {
    validate: args => validateString(args[0], 'id')
  },
  'plugins:toggle': {
    validate: args => validateString(args[0], 'id')
  },
  'localAgents:configure': {
    validate: validateLocalAgentConfigure
  },
  'conversation:exportFile': {
    validate: args => (
      validateRecord(args[0], 'data') ||
      (['markdown', 'json', 'html'].includes(String(args[1])) ? null : 'format must be markdown, json, or html') ||
      validateString(args[2], 'path')
    ),
    response: conversationExportFallback
  },
  'conversation:exportMarkdown': {
    validate: validateConversationExportData
  },
  'conversation:exportHtml': {
    validate: validateConversationExportData
  },
  'conversation:importFile': {
    validate: args => validateString(args[0], 'filePath'),
    response: (_args, error): ConversationImportResultLike => ({ ok: false, error })
  },
  'conversation:importJson': {
    validate: args => validateBoundedString(args[0], 'json', { allowEmpty: true, max: 10 * 1024 * 1024 }),
    response: (_args, error): ConversationImportResultLike => ({ ok: false, error })
  },
  'conversation:branch': {
    validate: args => validateImportedConversation(args) || validateNumber(args[1], 'index', { integer: true, min: 0, max: MAX_CONVERSATION_MESSAGES })
  },
  'conversation:summarize': {
    validate: validateImportedConversation
  },
  'skills:importLocal': {
    validate: args => validateString(args[0], 'sourcePath')
  },
  'mcp:list': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'mcp:scanLocal': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'mcp:upsert': {
    validate: validateMcpServerInput
  },
  'mcp:remove': {
    validate: args => validateString(args[0], 'id')
  },
  'mcp:setEnabled': {
    validate: args => validateString(args[0], 'id') || validateBoolean(args[1], 'enabled') || validateWorkspaceId(args[2], 'workspaceId', { optional: true })
  },
  'mcp:test': {
    validate: validateMcpServerId
  },
  'mcp:listTools': {
    validate: validateMcpServerId
  },
  'mcp:setSystemConfig': {
    validate: validateMcpSystemConfig
  },
  'mcp:setSystemEnabled': {
    validate: args => validateBoolean(args[0], 'enabled')
  },
  'terminal:run': {
    validate: validateTerminalRun
  },
  'terminal:cancel': {
    validate: args => validateString(args[0], 'runId')
  },
  'terminal:create': {
    validate: validateTerminalCreate,
    response: (_args, error): TerminalPtyCreateResultLike => ({ ok: false, message: error })
  },
  'terminal:write': {
    validate: validateTerminalWrite
  },
  'terminal:resize': {
    validate: validateTerminalResize
  },
  'terminal:dispose': {
    validate: args => validateString(args[0], 'sessionId')
  },
  'git:checkoutBranch': {
    validate: args => validateGitBranchMutation(args, ['branch'])
  },
  'git:status': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'git:branches': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'git:diffs': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true })
  },
  'git:createBranch': {
    validate: args => validateGitBranchMutation(args, ['branch']) || validateBoolean(args[2], 'checkout', { optional: true })
  },
  'git:renameBranch': {
    validate: args => validateGitBranchMutation(args, ['oldName', 'newName'])
  },
  'git:deleteBranch': {
    validate: args => validateGitBranchMutation(args, ['branch']) || validateBoolean(args[2], 'force', { optional: true })
  },
  'git:log': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true }) || validateNumber(args[1], 'limit', { optional: true, integer: true, min: 1, max: 200 })
  },
  'git:diff': {
    validate: args => validateWorkspaceId(args[0], 'workspaceId', { optional: true }) || validateString(args[1], 'filePath', { optional: true, allowEmpty: true })
  },
  'git:commitDetails': {
    validate: args => validateWorkspaceId(args[0]) || validateString(args[1], 'sha')
  },
  'git:commitDiff': {
    validate: args => validateWorkspaceId(args[0]) || validateString(args[1], 'sha') || validateString(args[2], 'filePath', { optional: true, allowEmpty: true })
  },
  'git:stageFile': {
    validate: validateGitPathMutation
  },
  'git:unstageFile': {
    validate: validateGitPathMutation
  },
  'git:revertFile': {
    validate: validateGitPathMutation
  },
  'git:stageAll': {
    validate: args => validateWorkspaceId(args[0])
  },
  'git:revertAll': {
    validate: args => validateWorkspaceId(args[0])
  },
  'git:commit': {
    validate: validateGitCommit
  },
  'git:fetch': {
    validate: args => validateWorkspaceId(args[0]) || validateString(args[1], 'remote', { optional: true, allowEmpty: true })
  },
  'git:pull': {
    validate: validateGitRemoteArgs
  },
  'git:push': {
    validate: validateGitRemoteArgs
  },
  'git:sync': {
    validate: args => validateWorkspaceId(args[0])
  },
  'git:updateBranch': {
    validate: args => validateWorkspaceId(args[0]) || validateString(args[1], 'branch')
  },
  'git:query': {
    validate: args => {
      const input = args[0]
      const recordIssue = validateRecord(input, 'input')
      if (recordIssue) return recordIssue
      const record = input as Record<string, unknown>
      return (
        validateWorkspaceId(record.workspaceId, 'input.workspaceId', { optional: true }) ||
        validateString(record.threadId, 'input.threadId', { optional: true }) ||
        validateString(record.query, 'input.query', { optional: true, allowEmpty: true })
      )
    }
  },
  'worktrees:list': {
    validate: args => validateString(args[0], 'parentWorkspaceId', { optional: true, allowEmpty: true })
  },
  'worktrees:create': {
    validate: validateWorktreeCreateInput
  },
  'worktrees:remove': {
    validate: args => validateString(args[0], 'id') || validateBoolean(args[1], 'force', { optional: true })
  },
  'worktrees:sync': {
    validate: args => validateString(args[0], 'id')
  },
  'worktrees:open': {
    validate: args => validateString(args[0], 'id')
  },
  'workspaces:create': {
    validate: validateWorkspaceCreateInput
  },
  'workspaces:update': {
    validate: validateWorkspaceUpdateInput
  },
  'workspaces:remove': {
    validate: args => validateString(args[0], 'id')
  },
  'workspaces:setActive': {
    validate: args => args[0] === null || isString(args[0]) ? null : 'id must be a string or null'
  },
  'workspaceFiles:list': {
    validate: args => validateWorkspaceListArgs(args),
    response: (): WorkspaceFileEntry[] => []
  },
  'workspaceFiles:search': {
    validate: args => validateWorkspaceListArgs(args, true),
    response: (): WorkspaceFileEntry[] => []
  },
  'workspaceFiles:preview': {
    validate: args => validateString(args[0], 'filePath') || validateNumber(args[1], 'maxLines', { optional: true, integer: true, min: 1, max: 10000 }),
    response: (_args, error): { ok: boolean; content?: string; error?: string } => ({ ok: false, error })
  },
  'workspaceFiles:read': {
    validate: args => validateWorkspaceFileArgs(args),
    response: workspaceReadFallback
  },
  'workspaceFiles:write': {
    validate: args => validateWorkspaceFileArgs(args, { includeContent: true }),
    response: workspaceWriteFallback
  },
  'workspaceFiles:readImage': {
    validate: args => validateWorkspaceFileArgs(args),
    response: workspaceImageFallback
  },
  'workspaceFiles:listDirectory': {
    validate: args => validateWorkspaceFileArgs(args, { allowEmptyRelPath: true }),
    response: workspaceDirectoryFallback
  },
  'sdd:createDraft': {
    validate: args => validateString(args[0], 'workspaceRoot') || validateString(args[1], 'title', { allowEmpty: true }) || validateString(args[2], 'template', { optional: true, allowEmpty: true })
  },
  'sdd:getDraft': {
    validate: args => validateSddDraftArgs(args, { draftId: true })
  },
  'sdd:updateDraft': {
    validate: args => validateSddDraftArgs(args, { draftId: true, content: true })
  },
  'sdd:updateDesignContext': {
    validate: args => validateSddDraftArgs(args, { draftId: true, designContext: true })
  },
  'sdd:deleteDraft': {
    validate: args => validateSddDraftArgs(args, { draftId: true })
  },
  'sdd:listDrafts': {
    validate: args => validateString(args[0], 'workspaceRoot')
  },
  'sdd:computeTrace': {
    validate: args => validateSddDraftArgs(args, { draftId: true, planMarkdown: true })
  },
  'sdd:saveTrace': {
    validate: args => validateSddDraftArgs(args, { draftId: true, trace: true })
  },
  'sdd:getTrace': {
    validate: args => validateSddDraftArgs(args, { draftId: true })
  },
  'sdd:getHistory': {
    validate: args => validateSddDraftArgs(args, { draftId: true })
  },
  'sdd:saveHistory': {
    validate: args => validateSddDraftArgs(args, { draftId: true, history: true })
  },
  'sdd:clearHistory': {
    validate: args => validateSddDraftArgs(args, { draftId: true })
  },
  'sdd:exists': {
    validate: args => validateSddDraftArgs(args, { draftId: true })
  }
}

export function validateIpcArgs(channel: IpcChannel, args: readonly unknown[]): IpcRuntimeValidationFailure | null {
  const spec = ipcRuntimeValidationSpecs[channel]
  if (!spec) return null
  const reason = spec.validate(args)
  if (!reason) return null
  const error = ipcError(reason)
  if (!spec.response) return { error, respond: false }
  return { error, respond: true, response: spec.response(args, error) }
}
