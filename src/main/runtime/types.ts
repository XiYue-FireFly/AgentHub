export type WorkbenchTurnStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type DispatchPreset =
  | "auto"
  | "broadcast"
  | "chain"
  | "orchestrate"
  | "lead-workers"
  | "parallel-review"
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
  role: "lead" | "worker" | "reviewer" | "synthesizer" | "target"
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
  agentId: string
  role: AgentRunNode["role"]
  mode: "auto" | "broadcast" | "chain" | "orchestrate"
  dependsOn?: string[]
}

export interface SchedulePreview {
  preset: DispatchPreset
  label: string
  description: string
  steps: ScheduleStep[]
}

export interface WorkbenchCommand {
  id: string
  label: string
  description: string
  category: "session" | "agent" | "schedule" | "tool" | "skill" | "workspace" | "ecc"
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
  source: "builtin" | "schedule" | "skill" | "local-agent" | "ecc"
  payload?: Record<string, any>
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
  command: string
  content: string
}

export interface McpServerConfig {
  id: string
  name: string
  source: "user" | "workspace" | "local" | "ecc" | "kun"
  enabled: boolean
  transport: "stdio" | "sse" | "http"
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  status?: "unknown" | "ok" | "error"
  error?: string
}

export interface McpConfigState {
  version: 1
  servers: McpServerConfig[]
  overrides: Record<string, { enabled?: boolean; status?: "unknown" | "ok" | "error"; error?: string }>
}

export type UsageRange = "all" | "90d" | "30d" | "7d"
export type UsageView = "overview" | "models"

export interface UsageHeatmapDay {
  date: string
  turns: number
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  level: 0 | 1 | 2 | 3 | 4
  selected?: boolean
}

export interface UsageModelRow {
  modelId: string
  agentId?: string
  turns: number
  tokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
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
  activeDays: number
  currentStreak: number
  longestStreak: number
  cost: number | null
  cacheSavings: number | null
  contextSavings: number | null
  cacheRate: number | null
  heatmap: UsageHeatmapDay[]
  models: UsageModelRow[]
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
    turnId?: string
    relativePath?: string
    contentHash?: string
  }
  updatedAt: number
}

export interface UpdateStatus {
  version: string
  channel: "stable" | "preview"
  checking: boolean
  latestVersion?: string
  downloadUrl?: string
  error?: string
  checkedAt?: number
}
