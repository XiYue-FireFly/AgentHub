/* ============================================================
   AgentHub — 模拟数据层
   镜像 src/main/providers + hub/dispatcher 的真实数据结构
   ============================================================ */

const AGENT_META = {
  codex:    { name: "Codex CLI",   nameZh: "代码工程", icon: "app/icons/codex.png",    iconCover: false, color: "var(--ag-codex)",    colorRaw: "#7b87fa", caps: ["coding", "debug", "refactor", "api"],          desc: "精确编码 · 调试 · 重构" },
  claude:   { name: "Claude Code", nameZh: "分析写作", icon: "app/icons/claude.png",   iconCover: false, color: "var(--ag-claude)",   colorRaw: "#d97757", caps: ["analysis", "writing", "translation", "research"], desc: "分析 · 写作 · 研究" },
  hermes:   { name: "Hermes",      nameZh: "系统自动化", icon: "app/icons/hermes.png",   tileLight: true, color: "var(--ag-hermes)",   colorRaw: "#aab4c4", caps: ["tools", "system", "automation"],               desc: "工具链 · 系统配置 · 命令执行" },
  openclaw: { name: "OpenClaw",    nameZh: "部署流水线", icon: "app/icons/openclaw.png", iconCover: false, color: "var(--ag-openclaw)", colorRaw: "#e04540", caps: ["automation", "deploy", "pipeline", "script"],  desc: "流水线 · 部署 · 脚本任务" },
};

const PROVIDERS_INIT = [
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant-····kV3a", enabled: true, builtIn: true,
    models: [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }, { id: "claude-opus-4-1", label: "Claude Opus 4.1" }],
    health: { reachable: true, latencyMs: 312 } },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-····9XmQ", enabled: true, builtIn: true,
    models: [{ id: "gpt-4o", label: "GPT-4o" }, { id: "o3-mini", label: "o3-mini" }],
    health: { reachable: true, latencyMs: 489 } },
  { id: "deepseek", name: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-····77Be", enabled: true, builtIn: true,
    models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }, { id: "deepseek-reasoner", label: "DeepSeek R1" }],
    health: { reachable: true, latencyMs: 203 } },
  { id: "gemini", name: "Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "", enabled: false, builtIn: true,
    models: [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }],
    health: null },
];

const BINDINGS_INIT = [
  { agentId: "codex",    providerId: "anthropic", modelId: "claude-sonnet-4-5", protocol: "stdio-plain", binary: "C:\\Users\\Admin\\.cargo\\bin\\codex.exe", thinking: { mode: "auto", level: "medium" }, temperature: 0.2, maxOutputTokens: 8192 },
  { agentId: "claude",   providerId: "openai",    modelId: "gpt-4o",            protocol: "http", binary: "", thinking: { mode: "auto", level: "medium" }, temperature: 0.4, maxOutputTokens: 8192 },
  { agentId: "openclaw", providerId: "deepseek",  modelId: "deepseek-chat",     protocol: "http", binary: "", thinking: { mode: "off",  level: "low" },    temperature: 0.1, maxOutputTokens: 4096 },
  { agentId: "hermes",   providerId: "gemini",    modelId: "gemini-2.5-flash",  protocol: "http", binary: "", thinking: { mode: "auto", level: "low" },    temperature: 0.3, maxOutputTokens: 8192 },
];

const TASKS_INIT = [
  { id: "task-31", text: "重构 dispatcher.ts 的 stdio 轮询逻辑，改为事件驱动", mode: "auto", status: "completed", agents: ["codex"], durationMs: 42100, createdAt: "10:42",
    results: { codex: "已将 sendToAgentStdio 的 200ms 轮询替换为 proc.on('exit') + 输出静默计时器，新增 3 个测试用例，9/9 通过。" } },
  { id: "task-30", text: "对比四个模型对同一段错误日志的归因", mode: "broadcast", status: "completed", agents: ["codex", "claude", "hermes", "openclaw"], durationMs: 18300, createdAt: "10:18",
    results: { codex: "栈顶 EFTYPE 指向直接 spawn .js 文件——Windows 下需经 .cmd shim。", claude: "归因：spawn 调用未走 shell，建议 shell:true 或包一层 cmd。", hermes: "PATH 中 codex 解析到了 .js 而非 .cmd，属环境配置问题。", openclaw: "CI 镜像里没有 node shim，建议在流水线预装。" } },
  { id: "task-29", text: "把 DESIGN.md 翻译成英文并润色", mode: "auto", status: "failed", agents: ["claude"], durationMs: 2100, createdAt: "09:51",
    errors: { claude: "HTTP 429 — provider rate limited，已按 fallbackChain 重试 0 次" } },
];

const MOCK_REPLIES = {
  codex: "收到。我先读取相关源码——`dispatcher.ts` 中 `sendToAgentStdio` 的轮询逻辑在 200ms 间隔下确实存在尾延迟。\n\n建议改动：\n```ts\nproc.on('exit', () => settle())\n```\n配合 1.5s 输出静默判定，可以把平均完成延迟从 ~1.7s 降到 ~0.3s。需要我直接生成 patch 吗？",
  claude: "我来分析一下。这个问题的核心在于「完成信号」的语义：轮询是在猜测进程状态，而事件驱动是在响应它。\n\n三个可选方案：\n1. **exit 事件优先** — 最可靠，但交互式 CLI 不会退出\n2. **静默计时** — 适合流式输出，需要调参\n3. **协议级结束标记** — 最干净，但要求 CLI 配合\n\n建议组合 1+2 作为过渡，长期推动 3。",
  hermes: "系统层面检查完毕：codex 二进制在 PATH 中解析正常，CODEX_PATH 环境变量未设置。当前 spawn 使用 shell:true，Windows 下兼容性 OK。无需额外配置。",
  openclaw: "流水线视角：建议把该改动加入 e2e 测试矩阵。我可以生成一个 GitHub Actions job，在 windows-latest 和 ubuntu-latest 上各跑一遍 vitest，预计耗时 3 分钟。",
};

const THINKING_PREVIEW = "用户在问 stdio 派发的完成检测。当前实现轮询三个条件：进程退出、输出静默 1.5s、5 分钟超时。轮询的问题是延迟和 CPU 唤醒……事件驱动方案需要考虑交互式 CLI 不退出的情况，应该保留静默计时作为兜底……";

Object.assign(window, { AGENT_META, PROVIDERS_INIT, BINDINGS_INIT, TASKS_INIT, MOCK_REPLIES, THINKING_PREVIEW });
