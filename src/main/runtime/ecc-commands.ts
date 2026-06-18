import { store } from "../store"
import type { EccCommand, EccCommandStatus } from "./types"

const STORAGE_KEY = "runtime.eccCommands.v1"
const ECC_RAW_BASE_URL = "https://raw.githubusercontent.com/affaan-m/ECC/main"
const ECC_QUICK_REF_URL = `${ECC_RAW_BASE_URL}/COMMANDS-QUICK-REF.md`

interface PersistedEccCommands {
  version: 1
  commands: EccCommand[]
  updatedAt: number | null
  lastError?: string
}

const BUNDLED_ECC_COMMANDS: EccCommand[] = [
  ecc("/plan", "制定执行计划", "重述需求、评估风险并生成分步计划，等待确认后再动代码。", planPrompt()),
  ecc("/tdd", "测试驱动开发", "先写失败测试，再做最小实现并验证。", "按测试驱动开发处理：先明确接口和验收点，再写失败测试，随后实现最小改动并运行验证。"),
  ecc("/code-review", "代码审查", "以缺陷、回归风险、安全和测试缺口为优先级审查改动。", "以代码审查方式处理当前内容：优先列出 bug、行为回归、安全风险和缺失测试，并给出文件位置。"),
  ecc("/verify", "验证结果", "运行必要检查，确认实现符合目标并报告残余风险。", "执行验证闭环：说明需要运行的构建、类型检查、测试和人工检查，报告通过项、失败项与残余风险。"),
  ecc("/docs", "文档查询", "先查官方文档或本地文档，再基于证据回答。", "先基于官方文档或项目内文档核对，再回答；不确定的内容请明确标注。"),
  ecc("/save-session", "保存会话", "整理当前线程的目标、决策、文件和未完成事项。", "整理当前会话：目标、关键决策、已改文件、验证结果、未完成事项和下一步建议。"),
  ecc("/reflect", "复盘改进", "复盘本轮过程，提炼可复用的改进点。", "复盘当前任务过程：指出有效做法、失误、可复用经验和下一轮改进动作。"),
  ecc("/research", "研究模式", "多来源收集证据，区分事实、推断与不确定性。", "进入研究模式：多来源收集证据，区分事实、推断和不确定性，给出引用或本地证据来源。"),
  ecc("/security-review", "安全审查", "检查输入验证、权限、路径、命令执行和密钥泄露风险。", "进行安全审查：重点检查输入验证、权限边界、路径处理、命令执行、依赖和密钥泄露风险。"),
  ecc("/prompt-optimize", "优化提示词", "把松散需求改写成清晰、可执行的高质量提示。", "优化用户提示词：补齐目标、上下文、约束、输出格式、验证方式和风险边界。"),
  ecc("/bug-hunt", "缺陷定位", "复现、缩小范围、定位根因并给出修复建议。", "按缺陷定位流程处理：复现症状、缩小范围、追踪数据流、定位根因，给出最小修复和验证路径。"),
  ecc("/ui-polish", "界面打磨", "从布局、响应式、文案和状态反馈优化 UI。", "从布局、响应式、文案、状态反馈和视觉一致性检查 UI，并提出或执行最小改进。")
]

function ecc(label: string, title: string, description: string, prompt: string): EccCommand {
  return {
    id: `ecc:${label.slice(1)}`,
    label,
    description: `${title}: ${description}`,
    category: "ecc",
    insertText: `${label} `,
    action: "insert",
    source: "ecc",
    payload: { prompt, title, description },
    upstreamPath: `commands/${label.slice(1)}.md`
  }
}

function readState(): PersistedEccCommands {
  const raw = store.get(STORAGE_KEY)
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).commands)) {
    return { version: 1, commands: BUNDLED_ECC_COMMANDS, updatedAt: null }
  }
  const commands = normalizeCommands((raw as any).commands)
  if (hasMojibake(commands)) {
    return {
      version: 1,
      commands: BUNDLED_ECC_COMMANDS,
      updatedAt: null,
      lastError: typeof (raw as any).lastError === "string" ? (raw as any).lastError : undefined
    }
  }
  return {
    version: 1,
    commands,
    updatedAt: typeof (raw as any).updatedAt === "number" ? (raw as any).updatedAt : null,
    lastError: typeof (raw as any).lastError === "string" ? (raw as any).lastError : undefined
  }
}

function writeState(state: PersistedEccCommands): void {
  store.set(STORAGE_KEY, state)
}

export function listEccCommands(): EccCommand[] {
  const state = readState()
  return withEccAliases(state.commands.length ? state.commands : BUNDLED_ECC_COMMANDS)
}

export function eccCommandStatus(): EccCommandStatus {
  const state = readState()
  return {
    version: 1,
    count: listEccCommands().length,
    source: state.updatedAt ? "updated" : "bundled",
    updatedAt: state.updatedAt,
    lastError: state.lastError
  }
}

export async function updateEccCommands(fetchImpl: typeof fetch = fetch): Promise<EccCommandStatus> {
  try {
    const res = await fetchImpl(ECC_QUICK_REF_URL)
    if (!res.ok) throw new Error(`ECC update failed: HTTP ${res.status}`)
    const parsed = parseEccQuickRef(await res.text())
    if (parsed.length === 0) throw new Error("ECC update did not contain slash commands")
    const hydrated = await Promise.all(parsed.map(command => hydrateEccCommand(command, fetchImpl)))
    const now = Date.now()
    writeState({ version: 1, commands: hydrated.map(command => ({ ...command, updatedAt: now })), updatedAt: now })
    return eccCommandStatus()
  } catch (e: any) {
    const current = readState()
    writeState({ ...current, lastError: e?.message || String(e) })
    return eccCommandStatus()
  }
}

export function parseEccQuickRef(markdown: string): EccCommand[] {
  const commands = new Map<string, EccCommand>()
  const tableRow = /\|\s*`(\/[a-z0-9][a-z0-9_-]*)`\s*\|\s*([^|]+?)\s*(?=\|)/gi
  for (const match of markdown.matchAll(tableRow)) {
    addParsedCommand(commands, match[1], match[2])
  }
  if (commands.size === 0) {
    const inline = /`(\/[a-z0-9][a-z0-9_-]*)`\s*(?:[-:|]\s*)?([^`|#\n\r]{0,180})/gi
    for (const match of markdown.matchAll(inline)) {
      addParsedCommand(commands, match[1], match[2])
    }
  }
  return normalizeCommands([...commands.values()])
}

export function parseEccCommandMarkdown(markdown: string): { description?: string; prompt?: string } {
  const frontmatter = markdown.match(/^---\s*([\s\S]*?)\s*---/)
  const body = frontmatter ? markdown.slice(frontmatter[0].length).trim() : markdown.trim()
  const description = frontmatter?.[1]
    .split(/\r?\n/)
    .map(line => line.match(/^\s*description:\s*(.+?)\s*$/)?.[1]?.trim())
    .find(Boolean)
  return {
    description,
    prompt: body || description
  }
}

export function planPrompt(): string {
  return [
    "进入 ECC /plan 规划模式。",
    "",
    "要求：",
    "1. 先重述需求、目标、约束和不确定点。",
    "2. 检查可用上下文，必要时说明还需要用户补充什么。",
    "3. 评估风险、影响范围、依赖和验证方式。",
    "4. 给出分阶段、可执行、可验收的实施计划。",
    "5. 在用户明确确认前，不要修改文件、执行写操作或运行会改变状态的命令。",
    "",
    "输出结尾必须包含：等待确认：请回复“确认执行 / 修改计划 / 暂停”。"
  ].join("\n")
}

async function hydrateEccCommand(command: EccCommand, fetchImpl: typeof fetch): Promise<EccCommand> {
  const path = command.upstreamPath || `commands/${command.label.slice(1)}.md`
  try {
    const res = await fetchImpl(`${ECC_RAW_BASE_URL}/${path}`)
    if (!res.ok) return command
    const parsed = parseEccCommandMarkdown(await res.text())
    return {
      ...command,
      description: parsed.description || command.description,
      payload: {
        ...(command.payload || {}),
        ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
        ...(parsed.description ? { upstreamDescription: parsed.description } : {})
      }
    }
  } catch {
    return command
  }
}

function addParsedCommand(commands: Map<string, EccCommand>, label: string, description: string): void {
  if (!label || commands.has(label)) return
  const cleaned = (description || "").replace(/\*\*/g, "").trim()
  commands.set(label, {
    id: `ecc:${label.slice(1)}`,
    label,
    description: cleaned || `ECC 指令 ${label}`,
    category: "ecc",
    insertText: `${label} `,
    action: "insert",
    source: "ecc",
    payload: { prompt: cleaned || `执行 ECC 指令 ${label}。` },
    upstreamPath: `commands/${label.slice(1)}.md`
  })
}

function normalizeCommands(commands: any[]): EccCommand[] {
  const out: EccCommand[] = []
  const seen = new Set<string>()
  for (const command of commands) {
    const label = typeof command?.label === "string" && command.label.startsWith("/") ? command.label.trim() : ""
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push({
      id: typeof command.id === "string" ? command.id : `ecc:${label.slice(1)}`,
      label,
      description: typeof command.description === "string" ? command.description : `ECC 指令 ${label}`,
      category: "ecc",
      insertText: typeof command.insertText === "string" ? command.insertText : `${label} `,
      action: "insert",
      source: "ecc",
      payload: command.payload && typeof command.payload === "object" ? command.payload : undefined,
      upstreamPath: typeof command.upstreamPath === "string" ? command.upstreamPath : `commands/${label.slice(1)}.md`,
      updatedAt: typeof command.updatedAt === "number" ? command.updatedAt : undefined
    })
  }
  return out.length ? out : BUNDLED_ECC_COMMANDS
}

function hasMojibake(commands: EccCommand[]): boolean {
  return commands.some(command => /鍒跺|娴嬭瘯|浠ｇ爜|鎸囦护|鏂囨|鐣岄潰|锟|�/.test([
    command.description,
    command.payload?.title,
    command.payload?.description,
    command.payload?.prompt
  ].filter(Boolean).join("\n")))
}

function withEccAliases(commands: EccCommand[]): EccCommand[] {
  if (commands.some(command => command.label === "/review")) return commands
  const review = commands.find(command => command.label === "/code-review")
  if (!review) return commands
  return [
    ...commands,
    {
      ...review,
      id: "ecc:review",
      label: "/review",
      insertText: "/review ",
      upstreamPath: "commands/code-review.md",
      description: "代码审查: 按 ECC 代码审查流程检查当前改动。"
    }
  ]
}
