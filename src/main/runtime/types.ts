export type WorkbenchTurnStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type DispatchPreset =
  | "auto"
  | "broadcast"
  | "chain"
  | "orchestrate"
  | "lead-workers"
  | "parallel-review"
  | "firefly-custom"
  | "custom"

export interface WorkbenchAttachment {
  id: string
  kind: "file" | "image" | "text"
  name: string
  path?: string
  mime?: string
  size?: number
  dataUrl?: string
  text?: string
  createdAt?: number
}

export type ContextBlockKind =
  | "recent_turns"
  | "compaction_summary"
  | "attachment"
  | "memory"
  | "browser"
  | "skill"
  | "write_draft"
  | "workspace_file"
  | "workspace_state"

export type ContextBlockParticipation = "selected" | "pinned_next_send" | "carried_over" | "excluded"

export interface ContextBlock {
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

export interface ContextProjection {
  threadId: string | null
  workspaceId: string | null
  blocks: ContextBlock[]
  totalEstimateTokens: number
  compacted: boolean
  createdAt: number
}

export interface ModelSelection {
  providerId: string
  modelId: string
  agentId?: string
  source?: "provider" | "local-cli"
}

export type LocalAgentAdapterProtocol = "stdio-ndjson" | "stdio-plain" | "http" | "acp"
export type LocalAgentAdapterMode = "interactive" | "oneshot"
export type LocalAgentAdapterStatus = "idle" | "busy" | "error"

export interface LocalAgentAdapterLifecycle {
  protocol: LocalAgentAdapterProtocol
  mode: LocalAgentAdapterMode
  status: LocalAgentAdapterStatus
  running: boolean
  exitCode: number | null
  lastStderr?: string
  runId?: number
}

export type LocalAgentAvailabilityCode =
  | "LOCAL_AGENT_ADAPTER_MISSING"
  | "LOCAL_AGENT_PROTOCOL_MISMATCH"
  | "LOCAL_AGENT_BUSY"
  | "LOCAL_AGENT_ERROR"
  | "LOCAL_AGENT_BINARY_MISSING"

export type LocalAgentAvailabilityResult =
  | { usable: true; agentId: string; lifecycle?: LocalAgentAdapterLifecycle }
  | { usable: false; agentId: string; code: LocalAgentAvailabilityCode; message: string; lifecycle?: LocalAgentAdapterLifecycle }

export interface WorkbenchThread {
  id: string
  workspaceId: string | null
  title: string
  createdAt: number
  updatedAt: number
  lastTurnStatus?: WorkbenchTurnStatus
}

export interface WorkbenchTurn {
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

export interface AgentRunNode {
  id: string
  turnId: string
  agentId: string
  role: "lead" | "worker" | "reviewer" | "synthesizer" | "target" | "router" | "executor" | "gatekeeper"
  status: WorkbenchTurnStatus
  parentRunId?: string
  startedAt: number
  endedAt?: number
}

export interface RuntimeEvent {
  id: string
  threadId: string
  turnId: string
  seq: number
  kind:
    | "turn:created"
    | "turn:status"
    | "run:created"
    | "run:status"
    | "agent:start"
    | "agent:delta"
    | "agent:activity"
    | "agent:approval"
    | "agent:done"
    | "agent:error"
    | "orchestrate"
    | "route:decision"
    | "guard:verdict"
    | "memory:candidate"
    | "schedule:preview"
    | "turn:summary"
  agentId?: string
  payload: any
  createdAt: number
}

export interface WorkbenchSnapshot {
  threads: WorkbenchThread[]
  turns: WorkbenchTurn[]
  runs: AgentRunNode[]
  activeThreadId: string | null
}

export interface ScheduleStep {
  id: string
  label: string
  labelZh?: string
  labelEn?: string
  agentId: string
  role: AgentRunNode["role"]
  mode: "auto" | "broadcast" | "chain" | "orchestrate"
  dependsOn?: string[]
}

export type ScheduleArtifactMode = "summary" | "full" | "files" | "custom"
export type ScheduleApprovalPolicy = "inherit" | "auto" | "ask" | "require" | "skip"

export interface ScheduleGraphNode {
  id: string
  label: string
  agentId: string
  role: AgentRunNode["role"]
  mode: "auto" | "broadcast" | "chain" | "orchestrate"
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

export interface WorkbenchCommand {
  id: string
  label: string
  description: string
  descriptionZh?: string
  descriptionEn?: string
  category: "session" | "agent" | "schedule" | "tool" | "skill" | "workspace" | "ecc" | "plugin"
  insertText?: string
  action:
    | "insert"
    | "new-thread"
    | "clear-thread"
    | "show-context"
    | "open-panel"
    | "run-terminal"
    | "run-git"
    | "use-schedule"
    | "use-skill"
    | "use-agent"
    | "set-goal"
    | "run-loop"
  source: "builtin" | "schedule" | "skill" | "local-agent" | "ecc" | "plugin"
  payload?: Record<string, any>
}

export interface WorkbenchGoal {
  threadId: string
  goal: string
  createdAt: number
  updatedAt: number
  loopLimit: number
  status: "active" | "cleared"
}

export interface EccCommand extends WorkbenchCommand {
  category: "ecc"
  source: "ecc"
  upstreamPath?: string
  updatedAt?: number
}

export interface EccCommandStatus {
  version: number
  count: number
  source: "bundled" | "updated"
  updatedAt: number | null
  lastError?: string
}

export interface LocalSkillCandidate {
  id: string
  name: string
  description: string
  instructions: string
  tags: string[]
  category?: { id: string; label: string }
  sourcePath: string
  agentSource: string
}

export interface GitQueryResult {
  threadId: string
  turnId: string
  result: string | null
  error?: string
}

export interface McpServerConfig {
  id: string
  name: string
  source: "user" | "workspace" | "local" | "ecc" | "kun" | "claude" | "codex" | "gemini" | "opencode" | "ccgui"
  enabled: boolean
  transport: "stdio" | "sse" | "http"
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
  status?: "unknown" | "ok" | "error"
  error?: string
}

export interface McpConfigState {
  version: 1
  servers: McpServerConfig[]
  overrides: Record<string, { enabled?: boolean; status?: "unknown" | "ok" | "error"; error?: string }>
}

export type UsageRange = "all" | "90d" | "30d" | "7d"
export type UsageView = "overview" | "models" | "requests" | "providers" | "pricing"
export type UsageSource = "actual" | "estimated" | "none"

export interface UsageTokenBreakdown {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  billableInputTokens: number
  totalTokens: number
  inputSurfaceTokens?: number
  cacheReadInputIncluded?: boolean
  reasoningTokens?: number
  modelId?: string
  /** Kun-aligned: explicit cache hit/miss counts (optional — not all providers report these) */
  cacheHitTokens?: number
  cacheMissTokens?: number
  /** Kun-aligned: cache hit rate as 0-1 ratio (null when unknown) */
  cacheHitRate?: number | null
  /** Kun-aligned: tokens saved by context compression / token economy */
  tokenEconomySavingsTokens?: number
}

export interface UsageHeatmapDay {
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

export interface UsageModelRow {
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

export interface UsageProviderRow {
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

export interface UsageRequestRecord {
  id: string
  eventId: string
  threadId: string
  turnId: string
  agentId?: string
  providerId: string
  modelId: string
  requestModelId?: string
  source: UsageSource
  status: "completed" | "failed" | "cancelled"
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
  /** Cache hit rate as 0-1 ratio (null when unknown) */
  cacheHitRate?: number | null
  costUsd: number | null
  hasUnpriced: boolean
  cacheSavingsUsd: number | null
  promptPreview?: string
  responsePreview?: string
  errorMessage?: string
  rawUsage?: any
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  warning?: string
}

export interface BudgetEstimate {
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

export interface UsagePricingRule {
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

export interface UsageRecordFilter {
  range?: UsageRange
  from?: number
  to?: number
  threadId?: string
  providerId?: string
  modelId?: string
  agentId?: string
  source?: UsageSource | "all"
  status?: "completed" | "failed" | "cancelled" | "all"
  query?: string
  sortBy?: "createdAt" | "tokens" | "cost" | "latencyMs"
  sortDir?: "asc" | "desc"
}

export interface PaginatedUsageRecords {
  records: UsageRequestRecord[]
  total: number
  page: number
  pageSize: number
}

export interface UsageStats {
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

export interface TerminalRun {
  id: string
  workspaceId: string | null
  command: string
  cwd: string
  status: "running" | "completed" | "failed" | "cancelled"
  stdout: string
  stderr: string
  exitCode: number | null
  createdAt: number
  completedAt?: number
}

export interface GitFileStatus {
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

export interface GitStatus {
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

export interface GitBranch {
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

export interface GitBranchListResponse {
  branches: Array<Pick<GitBranch, "name" | "current">>
  localBranches: GitBranch[]
  remoteBranches: GitBranch[]
  currentBranch: string | null
  repositoryState: "git_repository" | "not_git_repository" | "unknown"
  diagnostic?: {
    kind: string
    reason?: string | null
    message?: string | null
    workspaceId?: string | null
    pathKind?: string | null
  } | null
}

export interface GitLogEntry {
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

export interface GitLogResponse {
  total: number
  entries: GitLogEntry[]
  ahead: number
  behind: number
  aheadEntries: GitLogEntry[]
  behindEntries: GitLogEntry[]
  upstream: string | null
}

export interface GitFileDiff {
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

export interface GitCommitDiff {
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

export interface GitCommitFileChange {
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

export interface GitCommitDetails {
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
  files: GitCommitFileChange[]
  totalAdditions: number
  totalDeletions: number
}

export interface WorktreeItem {
  id: string
  parentWorkspaceId: string
  path: string
  branch: string
  status: "clean" | "dirty" | "missing"
  createdAt: number
}

export interface BrowserSession {
  id: string
  workspaceId: string | null
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserContextAttachment {
  url: string
  title: string
  text: string
  headings: string[]
  links: Array<{ text: string; href: string }>
  forms: string[]
  capturedAt: number
}

export type ThreadTodoStatus = "pending" | "in_progress" | "completed"

export interface ThreadTodo {
  id: string
  threadId: string
  content: string
  status: ThreadTodoStatus
  source?: {
    kind: "manual" | "plan" | "agent"
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
  updatedAt: number
}

export interface UpdateStatus {
  version: string
  channel: "stable" | "preview"
  state?: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error"
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
