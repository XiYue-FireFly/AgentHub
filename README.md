# AgentHub

AgentHub 是一个面向本地 AI 工作流的桌面工作台。它把本地 Agent、API 厂商模型、Git、工作目录、Skills、MCP、终端与浏览器工具集中到同一个界面里，让日常编码、审查、写作、验证和项目管理可以在一个稳定的桌面环境中完成。

## 核心能力

- **简洁工作台 UI**：顶部轻量工具栏、中心对话区、底部 Composer 和可拉伸 Inspector，适合长时间桌面使用。
- **本地 Agent 切换**：检测并配置 Codex、Claude、Gemini、OpenCode、CodeBuddy、Antigravity、Mimocode、ZCode、Reasonix 等本地 Agent；只展示真实可用的 Agent。
- **API 厂商直连**：支持 OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter、MiniMax、Hunyuan 以及自定义 OpenAI 兼容端点。选择厂商模型后直接走 API，不再误入本地 Agent 编排。
- **ECC 指令与 Skills**：内置 `/plan`、`/tdd`、`/code-review`、`/verify`、`/research`、`/security-review` 等 ECC 指令，并提供可安装到 Agent 的 ECC Workflow Skill。
- **Git 工作台**：提供分支、变更文件、diff、暂存、提交、历史、fetch、pull、push、sync 等本地 Git 工作流。
- **MCP 管理**：读取工作区和用户级 MCP 配置，支持启用、测试、编辑和删除 MCP Server。
- **使用统计**：基于真实运行事件统计会话、消息、Token、模型分布、活跃天数和热力图；本地 CLI 缺失 usage 时会标注估算。
- **外观设置**：支持浅色、深色、系统主题、强调色、字体、字号、动效、对比度和 diff 标记样式。
- **写作台与上下文容量**：提供写作工作区、快速动作、Agent 辅助输入和上下文容量估算。
- **Windows 安装包**：提供 NSIS 安装器，支持桌面快捷方式、开始菜单快捷方式和 `agenthub://` 协议。

## 系统要求

- Windows 10 / 11 x64
- Node.js 18+（本地开发需要）
- 至少 4 GB RAM，推荐 8 GB+
- 如需使用本地 Agent，请提前安装对应 CLI 或桌面端并完成登录

## 快速开始

1. 从 Releases 下载 `AgentHub-Setup-版本号.exe`。
2. 运行安装器并启动 AgentHub。
3. 进入 **设置 -> Providers**，启用至少一个 API 厂商并填写 API Key。
4. 进入 **设置 -> Local Agents**，检测或配置需要使用的本地 Agent。
5. 在工作台底部 Composer 中选择 Agent 或 API 厂商模型，然后发送任务。
6. 如需项目上下文，点击工作目录入口添加本地项目目录。

## 常用入口

| 功能 | 入口 |
|---|---|
| 新建对话 | 左侧会话栏 |
| 切换 Agent / API 厂商 | Composer 右侧选择器 |
| 运行 ECC 指令 | 输入 `/` 打开指令面板 |
| Git 工作台 | 顶部 Git 图标或 Composer Git 胶囊 |
| MCP 管理 | 设置 -> MCP |
| 使用统计 | 设置 -> 使用统计 |
| 外观设置 | 设置 -> 外观 |
| Skills 管理 | Skills 页面 |

## 本地开发

```bash
git clone https://github.com/XiYue-FireFly/AgengHub.git
cd AgengHub
npm install
npm run dev
```

## 验证与打包

```bash
npm run typecheck
npm run test
npm run build
npm run build:win
```

Windows 安装包会输出到：

```text
dist/AgentHub-Setup-版本号.exe
```

解包版会输出到：

```text
dist/win-unpacked
```

## 配置说明

- API 厂商配置保存在本地应用数据目录中，API Key 会通过 Electron 安全存储能力加密。
- 本地 Agent 配置只用于启动本机 CLI / ACP，不会自动写入对应工具的全局配置。
- MCP 配置支持工作区 `.mcp.json`、AgentHub 用户级配置和本地插件风格配置。
- 使用统计只基于 AgentHub 本地运行记录，不代表供应商账单。

## 发布说明

每个版本的变更会在 GitHub Releases 中按以下结构整理：

- New Features
- Fixes
- Performance Improvements
- Assets

## 许可

本项目基于 MIT License 开源，详见 [LICENSE](LICENSE)。
