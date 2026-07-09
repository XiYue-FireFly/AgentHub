# AgentHub-v123 项目架构文档

> 本文档描述 AgentHub-v123 项目的整体架构、模块职责、数据流、IPC 通信模式和测试基础设施。
> 创建时间：2026-07-06

## 1. 项目概述

AgentHub 是一个基于 Electron + React + TypeScript 的多 Agent 协同桌面工作台。它提供了一个统一的界面来管理和协调多个 AI Agent（如 Claude、Codex、Hermes 等），支持多种调度模式（auto、broadcast、chain、orchestrate 等）。

### 技术栈
- **主框架**: Electron 33.x + Vite
- **前端**: React 18 + Zustand 5 + Tailwind CSS 4
- **语言**: TypeScript 5.x
- **终端**: xterm.js + node-pty
- **测试**: Vitest + Playwright
- **构建**: electron-vite + electron-builder

## 2. 项目结构

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 主入口，窗口管理、IPC 注册
│   ├── store.ts             # 持久化存储（config.json）
│   ├── menu.ts              # 应用菜单
│   ├── logger.ts            # 日志系统
│   ├── startup-paths.ts     # 启动路径配置
│   ├── hub/                 # Hub 核心 - Agent 编排
│   │   ├── dispatcher.ts    # 消息分发器
│   │   ├── orchestrator.ts  # 多 Agent 编排器
│   │   ├── router.ts        # 路由决策
│   │   ├── aggregator.ts    # 结果聚合
│   │   ├── registry.ts      # Agent 注册表
│   │   ├── server.ts        # WebSocket 服务器
│   │   ├── workspace.ts     # 工作区管理
│   │   ├── adapters/        # Agent 适配器
│   │   │   ├── claude.ts    # Claude 适配器
│   │   │   ├── codex.ts     # Codex 适配器
│   │   │   ├── gemini.ts    # Gemini 适配器
│   │   │   ├── acp-client.ts # ACP 协议客户端
│   │   │   ├── stdio-adapter.ts # Stdio 适配器
│   │   │   └── ...
│   │   └── __tests__/
│   ├── ipc/                 # IPC 处理器
│   │   ├── typed-ipc.ts     # 类型安全的 IPC
│   │   ├── path-guards.ts   # 路径安全校验
│   │   ├── workspace-root-guard.ts # 工作区根目录校验
│   │   ├── sensitive-files.ts # 敏感文件检测
│   │   ├── workspace-ipc.ts # 工作区相关 IPC
│   │   ├── conversation-ipc.ts # 对话导入导出 IPC
│   │   ├── terminal-pty-ipc.ts # 终端 PTY IPC
│   │   ├── git-ipc.ts       # Git 操作 IPC
│   │   ├── memory-ipc.ts    # 内存管理 IPC
│   │   ├── mcp-ipc.ts       # MCP 服务器 IPC
│   │   ├── plugins-ipc.ts   # 插件管理 IPC
│   │   ├── passthrough-ipc.ts # 透传 IPC
│   │   ├── workflow-ipc.ts  # 工作流 IPC
│   │   ├── agent-loop-ipc.ts # Agent 循环 IPC
│   │   └── missing-ipc.ts   # 杂项 IPC
│   ├── runtime/             # 运行时功能
│   │   ├── context-compactor.ts # 上下文压缩
│   │   ├── context-manager.ts # 上下文管理
│   │   ├── terminal.ts      # 终端管理
│   │   ├── terminal-ai.ts   # 终端 AI 辅助
│   │   ├── git.ts           # Git 操作
│   │   ├── github-integration.ts # GitHub 集成
│   │   ├── backup.ts        # 备份功能
│   │   ├── health-monitor.ts # 健康监控
│   │   ├── budget-center.ts # 预算中心
│   │   ├── inline-edit.ts   # 内联编辑
│   │   ├── conversation-export.ts # 对话导出
│   │   ├── conversation-import.ts # 对话导入
│   │   ├── worktrees.ts     # Git worktree 管理
│   │   └── ...
│   ├── loop/                # Agent 循环
│   │   ├── agent-loop.ts    # 核心循环逻辑
│   │   ├── model-router.ts  # 模型路由
│   │   └── multi-model-aggregator.ts # 多模型聚合
│   ├── memory/              # 内存管理
│   │   ├── memory-library.ts # 内存库
│   │   ├── memory-store.ts  # 内存存储
│   │   └── memory-scoring.ts # 内存评分
│   ├── cache/               # 缓存
│   │   ├── lru-cache.ts     # LRU 缓存
│   │   └── ttl-lru-cache.ts # TTL + LRU 缓存
│   ├── routing/             # 路由
│   │   ├── proxy.ts         # 代理路由
│   │   └── takeover.ts      # 接管模式
│   ├── agentic/             # Agentic 功能
│   │   ├── executor.ts      # 执行器
│   │   ├── tools.ts         # 工具管理
│   │   ├── approval.ts      # 审批管理
│   │   ├── capabilities.ts  # 能力检测
│   │   └── config.ts        # Agentic 配置
│   ├── mcp/                 # MCP 服务器
│   │   ├── server.ts        # MCP 服务器实现
│   │   ├── system-tools.ts  # 系统工具
│   │   └── config.ts        # MCP 配置
│   ├── sdd/                 # SDD (Spec Driven Development)
│   │   ├── sdd-store.ts     # SDD 存储
│   │   ├── sdd-trace.ts     # SDD 追踪
│   │   └── sdd-types.ts     # SDD 类型
│   ├── security/            # 安全
│   │   └── webview-guards.ts # Webview 安全守卫
│   ├── skills/              # 技能管理
│   │   ├── manager.ts       # 技能管理器
│   │   ├── inject.ts        # 技能注入
│   │   └── types.ts         # 技能类型
│   └── providers/           # 提供商管理
│       ├── client.ts        # 提供商客户端
│       ├── manager.ts       # 提供商管理器
│       ├── presets.ts       # 预设配置
│       └── types.ts         # 提供商类型
├── preload/                 # 预加载脚本
│   ├── index.ts             # API 暴露
│   └── typed-ipc.ts         # 类型安全 IPC 辅助
├── renderer/                # 渲染进程
│   ├── App.tsx              # 主应用组件
│   ├── main.tsx             # 入口
│   ├── ErrorBoundary.tsx    # 错误边界
│   ├── appearance.ts        # 外观管理
│   ├── keyboard-shortcuts.ts # 键盘快捷键
│   ├── lib/                 # 工具库
│   │   ├── sanitize.ts      # HTML 清理
│   │   └── confirm.ts       # 确认对话框
│   ├── glass/               # 玻璃 UI 组件
│   │   ├── Titlebar.tsx     # 标题栏
│   │   ├── ui.tsx           # UI 组件
│   │   ├── chat-transcript.ts # 聊天记录
│   │   ├── connection-status.ts # 连接状态
│   │   ├── orchestrate-reducer.ts # 编排 reducer
│   │   └── ...
│   ├── screens/             # 页面
│   │   ├── Settings.tsx     # 设置页
│   │   ├── ProvidersTab.tsx # 提供商配置
│   │   ├── RoutingTab.tsx   # 路由配置
│   │   ├── AgentLoopSettingsTab.tsx # Agent 循环设置
│   │   ├── McpSettingsTab.tsx # MCP 设置
│   │   ├── WorkspacesTab.tsx # 工作区管理
│   │   ├── ApprovalsTab.tsx # 审批管理
│   │   └── ...
│   ├── sdd/                 # SDD 组件
│   │   ├── components/      # SDD UI 组件
│   │   ├── sdd-draft-store.ts # SDD 草稿存储
│   │   └── ...
│   ├── workbench/           # 工作台核心 UI
│   │   ├── WorkbenchLayout.tsx # 工作台布局
│   │   ├── ComposerBar.tsx  # 消息输入栏
│   │   ├── TerminalPanel.tsx # 终端面板
│   │   ├── FileTreePanel.tsx # 文件树
│   │   ├── GitWorkbenchPanel.tsx # Git 面板
│   │   ├── SessionSidebar.tsx # 会话侧边栏
│   │   ├── RunTimeline.tsx  # 运行时间线
│   │   ├── ContextLedger.tsx # 上下文账本
│   │   ├── SubagentDetailPanel.tsx # 子 Agent 详情
│   │   ├── BrowserPanel.tsx # 浏览器面板
│   │   ├── components/      # 子组件
│   │   ├── hooks/           # 自定义 hooks
│   │   ├── utils/           # 工具函数
│   │   ├── state/           # 本地状态
│   │   └── ...
│   ├── src/store/           # Zustand Store
│   │   ├── workbench-store.ts # 主 store
│   │   └── slices/          # Store 切片
│   │       ├── agent-slice.ts # Agent 状态
│   │       ├── runtime-slice.ts # 运行时状态
│   │       ├── thread-slice.ts # 线程状态
│   │       ├── ui-slice.ts  # UI 状态
│   │       └── view-slice.ts # 视图状态
│   └── hooks/               # 全局 hooks
│       ├── useResponsiveLayout.ts # 响应式布局
│       └── useTransitions.ts # 过渡动画
└── shared/                  # 共享类型
    ├── ipc-contract.ts      # IPC 契约定义
    ├── ipc-types.ts         # IPC 类型
    ├── sdd-trace.ts         # SDD 追踪类型
    ├── sdd.ts               # SDD 类型
    ├── errors.ts            # 错误类型
    └── utils.ts             # 共享工具
```

## 3. 核心模块职责

### 3.1 主进程 (main/)

**入口 (`index.ts`)**:
- 创建 Electron 窗口
- 注册所有 IPC 处理器
- 管理应用生命周期（启动、退出、更新）
- 协调各子系统初始化

**Hub 核心 (`hub/`)**:
- **dispatcher.ts**: 接收用户请求，路由到正确的 Agent，管理并发
- **orchestrator.ts**: 协调多个 Agent 完成复杂任务（chain、parallel、review 模式）
- **router.ts**: 根据请求特征选择最佳 Agent
- **aggregator.ts**: 合并多个 Agent 的输出，生成最终结果
- **registry.ts**: 管理已注册的 Agent 及其状态
- **adapters/**: 每种 Agent 的协议适配器（HTTP、Stdio、ACP）

**IPC 层 (`ipc/`)**:
- 所有主进程-渲染进程通信通过 IPC
- 类型安全的 IPC 封装（`typed-ipc.ts`）
- 路径安全校验（`path-guards.ts`、`workspace-root-guard.ts`）
- 敏感文件检测（`sensitive-files.ts`）

**运行时 (`runtime/`)**:
- 上下文管理（压缩、裁剪、预算）
- 终端管理（PTY、xterm 集成）
- Git 操作（状态、分支、提交、推送）
- 工作区管理（文件、目录、worktree）

**Agent 循环 (`loop/`)**:
- 核心 Agent 执行循环
- 模型路由和选择
- 多模型结果聚合

### 3.2 预加载脚本 (preload/)

- 通过 `contextBridge.exposeInMainWorld` 暴露类型安全的 API
- 所有 API 调用通过 `typedInvoke` 转换为 IPC 调用
- 支持事件监听（`ipcRenderer.on`）

### 3.3 渲染进程 (renderer/)

**主应用 (`App.tsx`)**:
- 初始化全局状态（providers、routing、appearance）
- 注册 IPC 事件监听
- 管理全局配置加载和重试逻辑

**工作台 (`workbench/`)**:
- **WorkbenchLayout.tsx**: 主布局，管理线程、面板、事件订阅
- **ComposerBar.tsx**: 消息输入、队列管理、预算估算
- **TerminalPanel.tsx**: 多标签终端，PTY 管理
- **FileTreePanel.tsx**: 文件树展示
- **GitWorkbenchPanel.tsx**: Git 操作面板

**状态管理 (`src/store/`)**:
- Zustand store，分为多个 slice
- 支持持久化（`persist` 中间件）
- 状态切片：agent、runtime、thread、ui、view

**SDD 组件 (`sdd/`)**:
- 需求文档编辑器
- 计划追踪
- 自动验证

## 4. IPC 通信模式

### 4.1 类型安全 IPC

```typescript
// shared/ipc-contract.ts - 定义所有 IPC 通道的类型
export interface IpcContract {
  'hub:status': { args: []; result: HubStatusLike }
  'workspaces:list': { args: []; result: WorkbenchWorkspaceLike[] }
  // ... 100+ 通道定义
}

// preload/typed-ipc.ts - 类型安全的调用封装
export function typedInvoke<K extends keyof IpcContract>(
  channel: K,
  ...args: IpcContract[K]['args']
): Promise<IpcContract[K]['result']>

// main/ipc/typed-ipc.ts - 类型安全的处理器注册
export function typedHandle<K extends keyof IpcContract>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: IpcContract[K]['args']) => Promise<IpcContract[K]['result']>
): void
```

### 4.2 安全校验流程

```
渲染进程调用 → preload 转换 → IPC → 主进程处理器
                                        ↓
                               路径校验 (path-guards.ts)
                                        ↓
                               工作区校验 (workspace-root-guard.ts)
                                        ↓
                               敏感文件检测 (sensitive-files.ts)
                                        ↓
                               实际操作
```

### 4.3 事件推送

```typescript
// 主进程 → 渲染进程的事件推送
webContents.send('runtime:event', eventData)
webContents.send('providers:configChanged', config)
webContents.send('terminal:data', { sessionId, data })

// 渲染进程订阅
window.electronAPI.runtime.onEvent(callback)
window.electronAPI.providers.onConfigChanged(callback)
window.electronAPI.terminalPty.onData(callback)
```

## 5. 数据流

### 5.1 用户消息发送流程

```
用户输入 → ComposerBar → sendPrompt()
  → electronAPI.turns.create() [IPC]
  → main: turns:create handler
  → Dispatcher.dispatch()
  → Router.selectAgent()
  → AgentAdapter.send()
  → 等待响应 (流式)
  → runtimeStore 事件广播
  → 渲染进程 ThreadView 更新
```

### 5.2 多 Agent 编排流程

```
用户选择编排模式 → Orchestrator.execute()
  → 根据模式分发:
    - auto: Router 自动选择
    - broadcast: 并行发送所有 Agent
    - chain: 串行传递上下文
    - orchestrate: DAG 调度
  → Aggregator.mergeResults()
  → 返回合并结果
```

## 6. 状态管理架构

### 6.1 Zustand Store 结构

```typescript
// workbench-store.ts
interface WorkbenchState {
  // Agent 状态 (agent-slice)
  localAgents: LocalAgentStatus[]
  
  // 运行时状态 (runtime-slice)
  runtimeEvents: RuntimeEvent[]
  
  // 线程状态 (thread-slice)
  threads: WorkbenchThread[]
  turns: WorkbenchTurn[]
  selectedThreadId: string | null
  
  // UI 状态 (ui-slice)
  activePanel: string | null
  sidebarCollapsed: boolean
  
  // 视图状态 (view-slice)
  currentView: 'chat' | 'write' | 'tasks' | 'requirements' | 'settings'
}
```

### 6.2 持久化机制

```typescript
// Zustand persist 中间件
const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({ ... }),
    {
      name: 'workbench-store',
      partialize: (state) => ({
        selectedThreadId: state.selectedThreadId,
        // ... 其他需要持久化的字段
      })
    }
  )
)
```

## 7. 测试基础设施

### 7.1 测试框架

- **单元测试**: Vitest
- **E2E 测试**: Playwright
- **覆盖率**: @vitest/coverage-v8

### 7.2 测试运行

```bash
# 运行所有单元测试
npm test

# 运行特定测试
npx vitest run src/main/cache/__tests__/lru-cache.test.ts

# 运行 E2E 测试
npm run test:e2e

# 查看覆盖率
npx vitest run --coverage
```

### 7.3 测试模式

- 主进程测试使用 `vi.hoisted()` + `vi.mock()` 模拟 Electron
- 渲染组件测试使用 `@testing-library/react` + `happy-dom`
- IPC 测试模拟 `electron.ipcRenderer` / `electron.ipcMain`

## 8. 构建和部署

### 8.1 开发环境

```bash
npm run dev        # 启动开发服务器
npm run build      # 构建生产版本
npm run preview    # 预览生产版本
```

### 8.2 生产构建

```bash
npm run build:win      # Windows 构建
npm run build:mac      # macOS 构建
npm run build:linux    # Linux 构建
npm run build:all      # 全平台构建
```

### 8.3 配置文件

- `electron.vite.config.ts`: Vite + Electron 构建配置
- `tsconfig.json`: TypeScript 配置（引用 node + web）
- `tsconfig.node.json`: 主进程/预加载 TypeScript 配置
- `tsconfig.web.json`: 渲染进程 TypeScript 配置
- `vitest.config.ts`: 测试配置
- `playwright.config.ts`: E2E 测试配置

---

*本文档将随项目架构演进持续更新。*
