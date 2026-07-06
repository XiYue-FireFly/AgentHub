import { getSkillManager } from "../skills/manager"
import { getCachedLocalAgentStatuses, isUsableLocalAgentStatus } from "./local-agents"
import { listSchedules } from "./schedules"
import { listEccCommands } from "./ecc-commands"
import { getEnabledContributions } from "./plugin-manager-enhanced"
import type { WorkbenchCommand } from "./types"

const BUILTIN_COMMANDS: WorkbenchCommand[] = [
  builtin("new", "/new", "新建一个对话线程。", "Create a new chat thread.", "session", "/new", "new-thread"),
  builtin("clear", "/clear", "清空当前线程并重新开始。", "Clear the current thread and start fresh.", "session", "/clear", "clear-thread"),
  builtin("context", "/context", "复用当前线程上下文继续讨论。", "Reuse the current thread context to continue the discussion.", "session", "/context ", "insert", { template: "context" }),
  builtin("goal", "/goal", "设置或查看当前线程目标；/loop 会以它作为长期方向。", "Set or inspect the current thread goal; /loop uses it as long-running direction.", "session", "/goal ", "set-goal", { requiresThread: true }),
  builtin("loop", "/loop", "使用智能五角色调度启动有边界的目标循环。", "Start a bounded goal run with smart five-role scheduling.", "schedule", "/loop ", "run-loop", { requiresThread: true, defaultLimit: 5 }),
  builtin("model", "/model", "切换本次聊天使用的 API 模型。", "Switch the API model used by this chat.", "agent", "/model ", "insert", { template: "model" }),
  builtin("reasoning", "/reasoning", "调整本次聊天的推理强度。", "Adjust the reasoning strength for this chat.", "agent", "/reasoning ", "insert", { template: "reasoning" }),
  builtin("terminal", "/terminal", "在当前工作目录运行本地终端命令。", "Run a local terminal command in the current workspace.", "tool", "/terminal ", "run-terminal", { requiresArgument: true }),
  builtin("git", "/git", "打开 Git 面板或运行 Git 查询。", "Open the Git panel or run a Git query.", "tool", "/git ", "run-git"),
  builtin("browser", "/browser", "打开浏览器面板并捕获页面上下文。", "Open the browser panel and capture page context.", "tool", "/browser ", "open-panel", { panel: "browser" }),
  builtin("todo", "/todo", "打开当前线程 Todo 面板。", "Open the thread Todo panel for planning work.", "tool", "/todo ", "open-panel", { panel: "todo" }),
  builtin("skill", "/skill", "打开技能面板并扫描或导入本地 Agent 技能。", "Open the skill panel and scan or import local agent skills.", "skill", "/skill ", "use-skill"),
  builtin("review", "/review", "让 Agent 审查当前回答或代码变更。", "Ask an agent to review the current response or code changes.", "agent", "/review ", "insert", { template: "review" })
]

export function listWorkbenchCommands(): WorkbenchCommand[] {
  const schedules = listSchedules().map(schedule => ({
    id: `schedule:${schedule.preset}`,
    label: scheduleCommandLabel(schedule.preset),
    description: schedule.descriptionZh || schedule.description,
    descriptionZh: schedule.descriptionZh,
    descriptionEn: schedule.descriptionEn || schedule.description,
    category: "schedule" as const,
    insertText: `${scheduleCommandLabel(schedule.preset)} `,
    action: "use-schedule" as const,
    source: "schedule" as const,
    payload: { preset: schedule.preset, descriptionZh: schedule.descriptionZh, descriptionEn: schedule.descriptionEn }
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
    .filter(isUsableLocalAgentStatus)
    .map(agent => ({
      id: `agent:${agent.agentId}`,
      label: `/agent:${agentAlias(agent.agentId)}`,
      description: `${agent.label} can be used for direct local runs.`,
      descriptionZh: `${agent.label} 可用于本地直连运行。`,
      descriptionEn: `${agent.label} can be used for direct local runs.`,
      category: "agent" as const,
      insertText: `/agent:${agentAlias(agent.agentId)} `,
      action: "use-agent" as const,
      source: "local-agent" as const,
      payload: { agentId: agent.agentId, alias: agentAlias(agent.agentId) }
    }))

  const pluginCommands = pluginSlashCommands()

  return [...BUILTIN_COMMANDS, ...listEccCommands(), ...schedules, ...skills, ...localAgents, ...pluginCommands]
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

function builtin(
  id: string,
  label: string,
  zh: string,
  en: string,
  category: WorkbenchCommand["category"],
  insertText: string,
  action: WorkbenchCommand["action"],
  payload?: Record<string, any>
): WorkbenchCommand {
  return {
    id: `builtin:${id}`,
    label,
    description: zh,
    descriptionZh: zh,
    descriptionEn: en,
    category,
    insertText,
    action,
    source: "builtin",
    payload
  }
}

function agentAlias(agentId: string): string {
  return agentId === "minimax-code" ? "opencode" : agentId
}

function scheduleCommandLabel(preset: string): string {
  return `/schedule:${preset === "firefly-custom" ? "smart-five-role" : preset}`
}

function pluginSlashCommands(): WorkbenchCommand[] {
  const contributions = getEnabledContributions()
  const slashCommands = contributions.slashCommands || []
  const legacyCommands = contributions.commands || []
  const modern = slashCommands.map(command => ({
    id: `plugin:${command.id}`,
    label: normalizePluginCommandLabel(command.label),
    description: command.description || command.promptTemplate || command.insertText || command.label,
    category: "plugin" as const,
    insertText: command.insertText || command.label + " ",
    action: "insert" as const,
    source: "plugin" as const,
    payload: {
      pluginCommandId: command.id,
      template: command.promptTemplate ? "plugin-prompt" : "plugin-insert",
      promptTemplate: command.promptTemplate
    }
  }))
  const legacy = legacyCommands.map(command => ({
    id: `plugin:${command.id}`,
    label: normalizePluginCommandLabel(command.label),
    description: command.label,
    category: "plugin" as const,
    insertText: command.label + " ",
    action: "insert" as const,
    source: "plugin" as const,
    payload: { pluginCommandId: command.id, template: "plugin-insert" }
  }))
  return [...modern, ...legacy]
}

function normalizePluginCommandLabel(label: string): string {
  const trimmed = label.trim()
  return trimmed.startsWith("/") ? trimmed : `/${trimmed.replace(/^@+/, "")}`
}

function normalizeCommandLabel(label: string): string {
  const lower = label.toLowerCase()
  if (lower.startsWith("/agent:minimax-code")) return "/agent:opencode"
  if (lower === "/schedule:firefly-custom") return "/schedule:smart-five-role"
  if (!lower.startsWith("@")) return lower
  const alias = lower.slice(1)
  return `/agent:${alias === "minimax-code" ? "opencode" : alias}`
}
