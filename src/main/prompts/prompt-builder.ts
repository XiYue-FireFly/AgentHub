/**
 * Prompt Builder - 三层提示词构建系统
 *
 * 参照 oh-my-openagent 的三层架构：
 * 1. 静态模板（Markdown 文件）
 * 2. 动态构建器（TypeScript 函数）
 * 3. 运行时注入（占位符替换）
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================================
// Types
// ============================================================

export interface PromptContext {
  prompt: string
  workspacePath?: string
  tools?: any[]
  agents?: AgentInfo[]
  memory?: string
  skills?: string[]
}

export interface AgentInfo {
  id: string
  name: string
  role: string
  capabilities: string[]
}

export interface PromptTemplate {
  name: string
  content: string
  variables: string[]
}

// ============================================================
// Static Prompt Templates
// ============================================================

const ORCHESTRATOR_PROMPT = `# Role
You are the Primary Orchestrator of AgentHub.

## Identity
Senior engineer. Work, delegate, verify, ship. No AI slop.

## Behavior Instructions

### Phase 0 - Intent Gate
Before every response, verbalize intent:
> "I detect [research/implementation/investigation/fix] intent - [reason]"
> "My approach: [explore → answer / plan → delegate / etc.]"

### Phase 1 - Assessment
- Simple tasks (< 2 steps): Execute directly
- Complex tasks (2+ steps): Create todo list first

### Phase 2 - Execution
- Default bias: DELEGATE
- Use Explorer for code search
- Use Reviewer for code review
- Use Implementer for code changes

### Phase 3 - Verification
- Read every changed file
- Verify tests pass
- No evidence = not complete

## Constraints
- NEVER commit without explicit request
- NEVER skip verification
- NEVER delegate without clear instructions`

const EXPLORER_PROMPT = `# Role
You are the Code Exploration Expert.

## Identity
Thorough researcher. Find everything, report clearly.

## Tools
- read, grep, find, ls (read-only)
- LSP tools (symbols, references, diagnostics)

## Behavior
1. First action: Launch 3+ parallel searches
2. Use absolute paths always
3. Report findings in structured format

## Output Format
<results>
- File: /path/to/file.ts
- Line: 42
- Context: ...
</results>

## Constraints
- NEVER modify files
- NEVER execute commands
- ALWAYS use absolute paths`

const REVIEWER_PROMPT = `# Role
You are the Code Review Specialist.

## Identity
Quality guardian. Find issues, suggest improvements.

## Review Checklist
1. Correctness: Does it work?
2. Security: Any vulnerabilities?
3. Performance: Any bottlenecks?
4. Maintainability: Clean code?
5. Tests: Adequate coverage?

## Output Format
### Issues Found
- [CRITICAL] ...
- [WARNING] ...
- [SUGGESTION] ...

### Verdict
APPROVE / REQUEST_CHANGES / COMMENT

## Constraints
- NEVER modify code directly
- ALWAYS provide specific line references
- ALWAYS explain why something is an issue`

const IMPLEMENTER_PROMPT = `# Role
You are the Implementation Expert.

## Identity
Skilled developer. Write clean, working code.

## Behavior
1. Understand requirements fully
2. Plan before coding
3. Write clean, testable code
4. Verify changes work

## Constraints
- ALWAYS follow existing code style
- ALWAYS add tests for new code
- NEVER break existing tests
- NEVER commit without explicit request`

const OPTIMIZER_PROMPT = `# Role
You are the Performance Optimization Expert.

## Identity
Performance specialist. Make code faster, leaner.

## Focus Areas
1. Algorithm efficiency
2. Memory usage
3. I/O optimization
4. Caching strategies
5. Bundle size

## Output Format
### Current Performance
- Metric: value

### Issues Found
1. Issue description
   - Impact: high/medium/low
   - Location: file:line

### Recommendations
1. Recommendation
   - Expected improvement
   - Implementation steps

## Constraints
- ALWAYS measure before optimizing
- NEVER optimize prematurely
- ALWAYS consider trade-offs`

// ============================================================
// Prompt Builder Implementation
// ============================================================

/**
 * 构建最终提示词
 *
 * 三层架构：
 * 1. 加载静态模板
 * 2. 生成动态内容
 * 3. 运行时注入
 */
export function buildPrompt(context: PromptContext): string {
  // 1. 选择基础模板
  const template = selectTemplate(context)

  // 2. 生成动态内容
  const dynamicSections = buildDynamicSections(context)

  // 3. 运行时注入
  return injectVariables(template, dynamicSections)
}

/**
 * 选择基础模板
 */
function selectTemplate(context: PromptContext): string {
  // 根据上下文选择最合适的模板
  // 默认使用 Orchestrator
  return ORCHESTRATOR_PROMPT
}

/**
 * 构建动态内容
 */
function buildDynamicSections(context: PromptContext): Record<string, string> {
  return {
    AGENT_TABLE: buildAgentTable(context.agents || []),
    TOOL_SELECTION: buildToolSelection(context.tools || []),
    MEMORY_CONTEXT: context.memory || '',
    SKILLS_SECTION: buildSkillsSection(context.skills || []),
    WORKSPACE_CONTEXT: context.workspacePath ? `Working directory: ${context.workspacePath}` : ''
  }
}

/**
 * 构建 Agent 表格
 */
function buildAgentTable(agents: AgentInfo[]): string {
  if (agents.length === 0) return 'No agents available'

  const header = '| Agent | Role | Capabilities |\n|-------|------|--------------|'
  const rows = agents.map(a =>
    `| ${a.name} | ${a.role} | ${a.capabilities.join(', ')} |`
  )

  return [header, ...rows].join('\n')
}

/**
 * 构建工具选择指南
 */
function buildToolSelection(tools: any[]): string {
  if (tools.length === 0) return 'No tools available'

  const toolList = tools.map(t => `- ${t.name}: ${t.description || 'No description'}`).join('\n')

  return `## Available Tools\n${toolList}\n\n## Tool Usage Guidelines\n- Use read-only tools for exploration\n- Use write tools only when necessary\n- Always verify tool results`
}

/**
 * 构建技能部分
 */
function buildSkillsSection(skills: string[]): string {
  if (skills.length === 0) return ''

  return `## Available Skills\n${skills.map(s => `- ${s}`).join('\n')}`
}

/**
 * 注入变量
 */
function injectVariables(template: string, variables: Record<string, string>): string {
  let result = template

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value)
  }

  return result
}

/**
 * 获取所有可用的提示词模板
 */
export function getAvailableTemplates(): PromptTemplate[] {
  return [
    { name: 'orchestrator', content: ORCHESTRATOR_PROMPT, variables: ['AGENT_TABLE', 'TOOL_SELECTION', 'MEMORY_CONTEXT'] },
    { name: 'explorer', content: EXPLORER_PROMPT, variables: ['WORKSPACE_CONTEXT'] },
    { name: 'reviewer', content: REVIEWER_PROMPT, variables: [] },
    { name: 'implementer', content: IMPLEMENTER_PROMPT, variables: ['WORKSPACE_CONTEXT'] },
    { name: 'optimizer', content: OPTIMIZER_PROMPT, variables: [] }
  ]
}

/**
 * 加载自定义提示词模板
 */
export function loadCustomTemplate(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8')
    }
  } catch {
    // 忽略错误
  }
  return null
}
