import { getSkillManager } from "../skills/manager"
import { getCachedLocalAgentStatuses } from "./local-agents"
import { listSchedules } from "./schedules"
import { listEccCommands } from "./ecc-commands"
import type { WorkbenchCommand } from "./types"

const BUILTIN_COMMANDS: WorkbenchCommand[] = [
  { id: "builtin:new", label: "/new", description: "新建一个空会话", category: "session", insertText: "/new", action: "new-thread", source: "builtin" },
  { id: "builtin:clear", label: "/clear", description: "清空当前显示并新建会话", category: "session", insertText: "/clear", action: "clear-thread", source: "builtin" },
  { id: "builtin:context", label: "/context", description: "沿用当前线程的模型原生上下文继续提问", category: "session", insertText: "/context ", action: "insert", source: "builtin", payload: { template: "context" } },
  { id: "builtin:model", label: "/model", description: "切换当前聊天使用的 API 模型", category: "agent", insertText: "/model ", action: "insert", source: "builtin", payload: { template: "model" } },
  { id: "builtin:reasoning", label: "/reasoning", description: "切换当前聊天的推理强度", category: "agent", insertText: "/reasoning ", action: "insert", source: "builtin", payload: { template: "reasoning" } },
  { id: "builtin:terminal", label: "/terminal", description: "在当前工作目录执行本地终端命令", category: "tool", insertText: "/terminal ", action: "run-terminal", source: "builtin", payload: { requiresArgument: true } },
  { id: "builtin:git", label: "/git", description: "打开 Git 面板或执行 Git 查询", category: "tool", insertText: "/git ", action: "run-git", source: "builtin" },
  { id: "builtin:browser", label: "/browser", description: "打开浏览器面板并可捕获页面内容", category: "tool", insertText: "/browser ", action: "open-panel", source: "builtin", payload: { panel: "browser" } },
  { id: "builtin:memory", label: "/memory", description: "打开长期记忆面板并引用到当前输入", category: "tool", insertText: "/memory ", action: "open-panel", source: "builtin", payload: { panel: "memory" } },
  { id: "builtin:todo", label: "/todo", description: "打开线程 Todo，管理计划任务", category: "tool", insertText: "/todo ", action: "open-panel", source: "builtin", payload: { panel: "todo" } },
  { id: "builtin:skill", label: "/skill", description: "打开技能页，扫描或导入本地 Agent 技能", category: "skill", insertText: "/skill ", action: "use-skill", source: "builtin" },
  { id: "builtin:review", label: "/review", description: "让 Agent 以代码审查方式回答", category: "agent", insertText: "/review ", action: "insert", source: "builtin", payload: { template: "review" } }
]

export function listWorkbenchCommands(): WorkbenchCommand[] {
  const schedules = listSchedules().map(schedule => ({
    id: `schedule:${schedule.preset}`,
    label: `/schedule:${schedule.preset}`,
    description: schedule.description,
    category: "schedule" as const,
    insertText: `/schedule:${schedule.preset} `,
    action: "use-schedule" as const,
    source: "schedule" as const,
    payload: { preset: schedule.preset }
  }))

  const skills = getSkillManager().list().map(skill => ({
    id: `skill:${skill.id}`,
    label: `/skill:${slug(skill.name)}`,
    description: skill.description || skill.instructions.slice(0, 100),
    category: "skill" as const,
    insertText: `/skill:${slug(skill.name)} `,
    action: "use-skill" as const,
    source: "skill" as const,
    payload: { skillId: skill.id, name: skill.name, category: skill.category, instructions: skill.instructions, tags: skill.tags }
  }))

  const localAgents = getCachedLocalAgentStatuses()
    .filter(agent => agent.configured && agent.loginState !== "needs-login")
    .map(agent => ({
      id: `agent:${agent.agentId}`,
      label: `/agent:${agentAlias(agent.agentId)}`,
      description: `${agent.label} 可用于直连调度`,
      category: "agent" as const,
      insertText: `/agent:${agentAlias(agent.agentId)} `,
      action: "use-agent" as const,
      source: "local-agent" as const,
      payload: { agentId: agent.agentId, alias: agentAlias(agent.agentId) }
    }))

  return [...BUILTIN_COMMANDS, ...listEccCommands(), ...schedules, ...skills, ...localAgents]
}

export function runWorkbenchCommand(input: { id?: string; text?: string }): WorkbenchCommand | null {
  const parsed = parseCommandText(input.text || "")
  if (parsed) {
    const fastCommands = [...BUILTIN_COMMANDS, ...listEccCommands()]
    const fastMatches = fastCommands.filter(cmd => cmd.label.toLowerCase() === parsed.label.toLowerCase())
    const fast = fastMatches.find(cmd => cmd.source === "ecc") ?? fastMatches[0]
    if (fast) return fast
  }
  const commands = listWorkbenchCommands()
  if (input.id) return commands.find(cmd => cmd.id === input.id) ?? null
  if (!parsed) return null
  const matches = commands.filter(cmd => cmd.label.toLowerCase() === parsed.label.toLowerCase())
  return matches.find(cmd => cmd.source === "ecc") ?? matches[0] ?? null
}

export function parseCommandText(text: string): { label: string; args: string } | null {
  const normalized = text.trim()
  if (!normalized.startsWith("/") && !normalized.startsWith("@")) return null
  const match = normalized.match(/^((?:\/|@)[\w\u4e00-\u9fff][\w\u4e00-\u9fff_-]*(?::[\w\u4e00-\u9fff][\w\u4e00-\u9fff_-]*)?)(?:\s+([\s\S]*))?$/i)
  if (!match) return null
  const label = normalizeCommandLabel(match[1])
  return { label, args: (match[2] || "").trim() }
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-").replace(/^-+|-+$/g, "") || "skill"
}

function agentAlias(agentId: string): string {
  return agentId === "minimax-code" ? "opencode" : agentId
}

function normalizeCommandLabel(label: string): string {
  const lower = label.toLowerCase()
  if (lower.startsWith("/agent:minimax-code")) return "/agent:opencode"
  if (!lower.startsWith("@")) return lower
  const alias = lower.slice(1)
  return `/agent:${alias === "minimax-code" ? "opencode" : alias}`
}
