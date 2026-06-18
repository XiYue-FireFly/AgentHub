/**
 * Agent 元数据单一事实源（主进程）
 *
 * 此前 agent 的名称/能力/路由关键词/系统提示/接管支持分散在 index.ts、aggregator.ts、
 * dispatcher.ts、agent-detector.ts、router.ts 多处，彼此漂移且常漏掉新加的 marvis /
 * minimax-code。这里统一为一张表，各处派生使用。
 *
 * 注意：渲染层（src/renderer/glass/meta.ts）是独立打包单元，仍维护自己的展示用表，
 * 不从此处 import（避免跨 bundle 的 dev fs 限制）。
 */
export interface AgentManifestEntry {
  id: string
  /** 显示名（英文） */
  name: string
  /** 中文名（渲染层 zh 模式可用） */
  nameZh: string
  /** 能力标签 */
  caps: string[]
  /** KeywordRouter 自动路由关键词 */
  routeKeywords: string[]
  /** 派发时注入的系统提示词 */
  systemPrompt: string
  /** 默认传输协议 */
  defaultProtocol: 'http' | 'stdio-plain'
  /** 是否支持桌面配置接管（takeover.ts 覆盖：codex/claude/hermes/openclaw） */
  takeoverSupported: boolean
  /** agent-detector 用于 PATH 探测的二进制名；无可用 CLI（如 marvis）则留空 */
  probeBinary?: string
}

export const AGENTS: AgentManifestEntry[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    nameZh: 'Codex',
    caps: ['coding', 'debug', 'refactor', 'api'],
    routeKeywords: ['写代码', 'debug', '修复', '重构', '实现', '函数', 'api', 'bug', 'coding', 'implement', 'fix'],
    systemPrompt: 'You are Codex, an expert software engineer focused on coding, debugging and refactoring. Be precise and produce working code.',
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'codex'
  },
  {
    id: 'claude',
    name: 'Claude Code',
    nameZh: 'Claude Code',
    caps: ['analysis', 'writing', 'translation', 'research'],
    routeKeywords: ['分析', '总结', '解释', '文档', '写作', '翻译', '报告', 'analyze', 'summary', 'explain', 'document'],
    systemPrompt: 'You are Claude Code, an analytical assistant focused on writing, research and clear explanations.',
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'claude'
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    nameZh: 'OpenClaw',
    caps: ['automation', 'deploy', 'pipeline', 'script'],
    routeKeywords: ['自动化', '部署', '运行', '脚本', '任务', '流程', 'pipeline', 'deploy', 'automation', 'script'],
    systemPrompt: 'You are OpenClaw, an automation and deployment agent specialised in pipelines, scripts and runtime tasks.',
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'openclaw'
  },
  {
    id: 'hermes',
    name: 'Hermes',
    nameZh: 'Hermes',
    caps: ['tools', 'system', 'automation'],
    routeKeywords: ['工具', '调用', '系统', '操作', '命令', '配置', '检测', 'tool', 'system', 'command', 'config'],
    systemPrompt: 'You are Hermes, a system automation agent specialised in tooling, configuration and command execution.',
    defaultProtocol: 'http',
    takeoverSupported: true,
    probeBinary: 'hermes'
  },
  {
    id: 'marvis',
    name: 'Marvis',
    nameZh: '腾讯 Marvis',
    caps: ['knowledge', 'browser', 'android', 'office'],
    routeKeywords: ['知识', '浏览器', '安卓', '办公', 'knowledge', 'browser', 'android', 'office'],
    systemPrompt: "You are Marvis, Tencent's intelligent assistant specialised in knowledge management, browser automation, office workflows and Android device control.",
    defaultProtocol: 'http',
    takeoverSupported: false
  },
  {
    id: 'minimax-code',
    name: 'MiniMax Code',
    nameZh: 'MiniMax Code',
    caps: ['coding', 'agentic', 'tools', 'review'],
    routeKeywords: ['minimax', 'opencode', 'agentic', '代码审查', 'review'],
    systemPrompt: 'You are MiniMax Code, an agentic coding assistant built on OpenCode. Be precise, write working code and explain briefly.',
    defaultProtocol: 'stdio-plain',
    takeoverSupported: false,
    probeBinary: 'opencode'
  }
]

export const AGENTS_BY_ID: Record<string, AgentManifestEntry> =
  Object.fromEntries(AGENTS.map(a => [a.id, a]))

export function agentName(id: string): string {
  return AGENTS_BY_ID[id]?.name ?? id
}

export function agentCaps(id: string): string[] {
  return AGENTS_BY_ID[id]?.caps ?? []
}

export function agentSystemPrompt(id: string): string {
  return AGENTS_BY_ID[id]?.systemPrompt ?? ('You are AgentHub agent ' + id + '. Be concise and helpful.')
}
