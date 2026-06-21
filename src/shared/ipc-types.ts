/**
 * Shared IPC Type Definitions.
 *
 * Defines the type contracts between main process and renderer.
 * This is the single source of truth for IPC argument/return types.
 *
 * Phase 2: IPC Type Safety — eliminate Promise<any> in ElectronAPI.
 */

// ============================================================
// Thread / Turn
// ============================================================

export interface ThreadCreateInput {
  workspaceId?: string | null
  title?: string
}

export interface ThreadForkInput {
  sourceThreadId: string
  sourceTurnId: string
  message: string
}

export interface TurnCreateInput {
  threadId?: string | null
  workspaceId?: string | null
  prompt: string
  mode?: string
  targetAgent?: string | null
  thinking?: any
  modelSelection?: any
  attachments?: any[]
  customSchedule?: any
}

// ============================================================
// Git
// ============================================================

export interface GitStatus {
  branch: string
  isRepo: boolean
  ahead: number
  behind: number
  files: GitFileStatus[]
  error?: string
}

export interface GitFileStatus {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitBranchListResponse {
  localBranches: GitBranch[]
  remoteBranches: GitBranch[]
}

// ============================================================
// Memory
// ============================================================

export type MemoryCategory = 'conversation' | 'task' | 'skill' | 'file' | 'system' | 'preference' | 'project' | 'style' | 'decision' | 'correction' | 'imported_conversation'

export type MemoryEntryStatus = 'candidate' | 'approved' | 'disabled'

export interface MemoryEntry {
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

export interface MemoryCatalog {
  entries: MemoryEntry[]
  settings: { enabled: boolean }
}

// ============================================================
// MCP
// ============================================================

export interface McpServerConfig {
  id: string
  name: string
  source: string
  enabled: boolean
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  status?: 'unknown' | 'ok' | 'error'
  error?: string
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: any
}

export interface McpListToolsResult {
  ok: boolean
  tools: McpToolInfo[]
  error?: string
}

// ============================================================
// Workflows
// ============================================================

export interface WorkflowStep {
  id: string
  type: 'prompt' | 'agent' | 'skill' | 'review' | 'gate'
  label: string
  agentId?: string
  prompt?: string
  skillId?: string
  dependsOn?: string[]
  requiresApproval?: boolean
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  category: string
  steps: WorkflowStep[]
  tags: string[]
  createdAt: string
  updatedAt: string
  useCount: number
  pinned?: boolean
}

// ============================================================
// Prompts
// ============================================================

export interface PromptEntry {
  id: string
  name: string
  body: string
  category: string
  tags: string[]
  isSlashCommand: boolean
  shortcut?: string
  createdAt: string
  updatedAt: string
  useCount: number
}

// ============================================================
// Shortcuts
// ============================================================

export interface ShortcutBinding {
  id: string
  label: string
  labelZh: string
  defaultKey: string
  key: string
  category: string
  system: boolean
}

// ============================================================
// Diagnostics
// ============================================================

export interface DiagnosticResult {
  id: string
  name: string
  nameZh: string
  category: string
  status: 'pass' | 'warn' | 'fail' | 'skip'
  message: string
  details?: string
  durationMs?: number
}

export interface DiagnosticSuite {
  timestamp: string
  results: DiagnosticResult[]
  summary: { pass: number; warn: number; fail: number; skip: number; total: number }
}

// ============================================================
// Backup
// ============================================================

export interface BackupMeta {
  id: string
  filename: string
  createdAt: string
  sizeBytes: number
  keys: string[]
  version: string
}

export interface RestoreResult {
  restored: string[]
  error?: string
}

// ============================================================
// Notifications
// ============================================================

export type NotificationCategory = 'task' | 'approval' | 'mcp' | 'system' | 'workflow' | 'memory' | 'error'

export interface Notification {
  id: string
  title: string
  body: string
  category: NotificationCategory
  read: boolean
  action?: { type: 'navigate'; target: string } | { type: 'open-url'; url: string }
  createdAt: string
}

// ============================================================
// Project Map
// ============================================================

export interface ProjectNode {
  name: string
  path: string
  type: 'file' | 'directory'
  extension?: string
  sizeBytes?: number
  children?: ProjectNode[]
  language?: string
}

export interface ProjectMap {
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
// Inline Edit
// ============================================================

export interface EditRange {
  filePath: string
  startLine: number
  endLine: number
  selectedText: string
  fullContent?: string
}

export interface EditRequest {
  range: EditRange
  instruction: string
}

export interface EditValidation {
  valid: boolean
  warnings: string[]
}

export interface EditApplyResult {
  ok: boolean
  content?: string
  newStartLine?: number
  newEndLine?: number
  error?: string
}

// ============================================================
// Usage Stats
// ============================================================

export interface UsageStats {
  range: string
  view: string
  totalTokens: number
  actualTokens: number
  estimatedTokens: number
  hasEstimated: boolean
  requests: number
  cost: number | null
  models: any[]
  providers: any[]
  heatmap: any[]
}

// ============================================================
// Providers
// ============================================================

export interface ProviderDef {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  builtIn: boolean
  models: ModelDef[]
  capabilities: any
  defaultThinking: any
  health?: any
}

export interface ModelDef {
  id: string
  label: string
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
  supportsThinking: boolean
}

export interface ProvidersConfig {
  providers: ProviderDef[]
  routing: any
  activeBindingId: string | null
}

// ============================================================
// Approval
// ============================================================

export type ApprovalPolicy = 'allow' | 'ask' | 'deny'
export type ApprovalPreset = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'
export type GuardedTool = 'write' | 'exec'

export interface ApprovalRequest {
  stepId: string
  agentId: string
  tool: GuardedTool
  toolName: string
  label: string
  detail: string
  action: 'write_file' | 'run_command'
  target: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  preview: string
}

// ============================================================
// GitHub
// ============================================================

export interface GitHubPr {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  author: string
  url: string
  branch: string
  createdAt: string
  labels: string[]
}

export interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  url: string
  labels: string[]
  createdAt: string
}

// ============================================================
// Slash Commands
// ============================================================

export interface SlashCommand {
  shortcut: string
  name: string
  body: string
  category: string
  params: string[]
  system: boolean
}

// ============================================================
// Plugins
// ============================================================

export interface PluginManifest {
  name: string
  version: string
  description?: string
  author?: string
  contributes?: {
    commands?: Array<{ id: string; label: string }>
    skills?: Array<{ id: string; path: string }>
    prompts?: Array<{ id: string; name: string; body: string }>
  }
}

export interface PluginEntry {
  id: string
  manifest: PluginManifest
  path: string
  enabled: boolean
  source: 'local' | 'global'
}

// ============================================================
// Agent Capability Profile
// ============================================================

export type AgentProtocol = 'stdio' | 'http' | 'acp'
export type AgentStatus = 'available' | 'detected' | 'unavailable' | 'needs-login' | 'desktop-only'

export interface AgentCapabilityProfile {
  id: string
  name: string
  capabilities: string[]
  protocol: AgentProtocol
  status: AgentStatus
  binaryPath?: string
  version?: string
  supportsTools: boolean
  supportsFileOps: boolean
  supportsExec: boolean
  source: string
  defaultApprovalRisk: 'low' | 'medium' | 'high'
}
