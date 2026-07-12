# AgentHub 项目初始化与架构指南

> 初始化日期：2026-07-10
> 审计分支：`chatgpt`
> 当前版本：`2.0.0`
> 本文以当前源码为准；历史文档仅作为回归线索。

## 1. 项目定位

AgentHub 是一个面向本地 AI 工作流的 Electron 桌面工作台。它在同一界面中连接本地 Agent、API Provider、工作区文件、Git、终端、MCP、Skills、SDD、插件与多 Agent 编排，并把执行事件持久化后广播给 React 工作台。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 24+、Electron 33（当前依赖） |
| 主进程 | TypeScript、Electron IPC、Node.js 标准库 |
| 渲染端 | React 18、Zustand 5、Tailwind CSS 4 |
| Agent 通信 | HTTP/SSE、stdio、ACP、WebSocket |
| 终端 | xterm.js、node-pty |
| 构建 | electron-vite、Vite、electron-builder、NSIS |
| 测试 | Vitest 4、Testing Library、happy-dom、Playwright Electron |
| CI | GitHub Actions，Windows 与 Linux 双平台 |

当前约有 558 个 TS/TSX 文件，其中 242 个单元测试文件；另有 1 个 Electron E2E 文件。

## 3. 总体架构

```text
React Renderer
  -> window.electronAPI (preload contextBridge)
  -> typedInvoke + shared IPC contract validation
  -> typedHandle (Electron main IPC)
  -> runtime/domain service
  -> Provider HTTP/SSE 或本地 Agent stdio/ACP
  -> runtime store / event pipeline
  -> BrowserWindow broadcast
  -> Zustand / Workbench UI
```

进程边界采用 `contextIsolation + sandbox preload`。共享 IPC 合同同时承担 TypeScript 类型与运行时参数校验；新增或修改通道时必须同步检查 contract、preload、main handler、renderer 使用方和负例测试。

## 4. 关键入口

- `src/main/index.ts`：应用启动、窗口/托盘、Hub 初始化、消息 dispatch、生命周期与顶层 IPC 装配。
- `src/preload/index.ts`：通过 `contextBridge` 暴露 renderer 可用 API。
- `src/shared/ipc-contract.ts`：IPC 通道、参数、返回值与运行时校验的事实来源。
- `src/renderer/main.tsx`：React 根节点、全局错误边界和样式健康检查。
- `src/renderer/App.tsx`：应用级配置加载、Provider/外观状态和页面入口。
- `src/renderer/workbench/WorkbenchLayout.tsx`：工作台布局、运行时事件和核心交互编排。
- `src/renderer/src/store/workbench-store.ts`：Zustand 根 Store 与持久化迁移。

## 5. 目录职责

| 路径 | 职责 |
|---|---|
| `src/main/hub/` | Agent 注册、路由、分发、聚合、编排与适配器 |
| `src/main/ipc/` | 按领域拆分的 Electron IPC handler 与路径/敏感文件守卫 |
| `src/main/providers/` | Provider 配置、密钥、模型目录、HTTP/SSE 客户端 |
| `src/main/runtime/` | Git、终端、工作区、持久化、同步、插件、诊断等业务服务 |
| `src/main/agentic/` | 原生工具执行、审批、能力与执行器 |
| `src/main/loop/` | Agent Loop、模型路由和多模型聚合（部分仍为可达性审计重点） |
| `src/main/mcp/` | 内置 MCP Server 与系统工具 |
| `src/main/security/` | webview、导航和窗口安全守卫 |
| `src/main/cache/` | LRU/TTL 缓存 |
| `src/main/capabilities/` | `ThinkingConfig` 归一化、支持判断与等级约束 |
| `src/main/hooks/` | dispatch 前置 Hook 执行 |
| `src/main/memory/` | 文件化 Memory Store、评分与检索 |
| `src/main/prompts/` | Prompt 构建及内置/自定义模板加载 |
| `src/main/routing/` | 本地代理路由、接管与代理服务 |
| `src/main/sdd/` | SDD 主进程存储和 Trace 服务 |
| `src/main/skills/` | Skill 扫描、注入与类型 |
| `src/preload/` | sandbox preload、`contextBridge` 与类型化调用 |
| `src/shared/` | IPC 合同、共享类型、错误与 SDD 数据结构 |
| `src/renderer/screens/` | Settings、Providers、MCP、Workspace 等页面 |
| `src/renderer/workbench/` | 会话、Composer、Git、Terminal、Browser、Inspector 等核心 UI |
| `src/renderer/sdd/` | 需求草稿、计划、历史、Trace、Todo 与 AI 辅助 |
| `src/renderer/src/store/` | Zustand slices、持久化与迁移 |
| `src/renderer/glass/` | 通用 UI、对话框与遗留玻璃组件 |
| `src/renderer/hooks/` | 响应式布局和过渡 Hook |
| `src/renderer/lib/` | HTML 清理、确认等渲染端工具 |
| `src/renderer/locales/` | 中英文资源与全局翻译函数 |
| `src/renderer/styles/` | 分域 CSS 样式 |
| `test/e2e/` | 真实 Electron 进程烟测 |
| `scripts/` | CLI、构建包装和质量检查脚本 |

## 6. 主要数据流

### 用户消息

```text
ComposerBar
  -> turns:create IPC
  -> pre-dispatch hooks / prompt 优化 / budget / planDispatch
  -> runtimeStore 创建 turn
  -> 应用 route decision
  -> Provider direct 或 Dispatcher/local Agent
  -> 流式事件写入 runtimeStore
  -> runtime:event 广播
  -> Workbench Store/ThreadView 更新
```

### 工作区文件与 Git

Renderer 仅提交 workspace ID、工作区根路径或相对路径；主进程通过已注册工作区、realpath/边界和敏感文件规则校验后再访问文件系统或调用 Git。路径相关修改必须覆盖 Windows 大小写、UNC、junction/symlink、控制字符与跨工作区负例。

### 持久化

- 应用配置：`src/main/store.ts` 与 runtime store，写入 Electron `userData`。
- Provider 密钥：优先通过 Electron `safeStorage` 加密；renderer 只接收遮罩值。
- 工作台状态：主进程 runtime store + renderer Zustand 持久化并存。
- SDD：磁盘草稿、历史、Todo、Trace 与 renderer store 多源协作。
- Wave4：config sync、WebDAV、plugin marketplace/signature、headless CLI 是近期新增高风险面。

## 7. 代码约定

- TypeScript 开启 `strict`，模块使用 ESM import/export。
- React 组件使用 PascalCase；普通模块多用 kebab-case；测试使用 `*.test.ts(x)`。
- IPC 优先使用 `typedInvoke` / `typedHandle`，不得绕过共享合同。
- 异步 UI effect 必须处理卸载、请求乱序和 workspace/thread 切换。
- 文件、命令、URL 和插件输入在主进程再次校验，不能信任 renderer。
- 修 Bug 优先最小行为改动与回归测试；本轮不以拆分大型文件作为修复手段。
- 现有 Git 提交使用 Conventional Commit 风格为主，如 `fix(scope): ...`、`feat: ...`。

## 8. 开发与验证命令

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run build:win
npm run cli -- version
```

补充质量检查：

```powershell
node scripts/check-large-files.js
node scripts/check-css-variables.js
node scripts/check-bundle-size.js
npm audit
```

E2E 依赖已生成的 `out/`，因此先执行 `npm run build`。Windows/Linux CI 均运行 typecheck、lint、unit、build 与 Electron E2E。

## 9. 当前基线（修复前）

- `npm run typecheck`：通过。
- `npm test -- --reporter=dot`：242 文件、1536 测试全部通过。
- `npm run build`：通过，但主 renderer bundle 与总包体超过项目脚本预算。
- `npm run test:e2e`：1 条核心 Electron smoke 通过。
- `npm run lint`：失败，3 errors、40 warnings。
- `npm audit --omit=dev`：生产依赖树 0；完整审计含 Electron/构建/测试链共 15 个漏洞节点。
- 单测会遗留 `test-tmp-backup-security/`，已作为候选 Bug 保留证据。

详细问题、修复状态和测试证据分别见 `BUG_REPORT_CHATGPT.md`、`CHATGPT_BUGFIX_PLAN.md` 与 `TEST_RESULTS_CHATGPT.md`。

## 10. 修改前必查

1. 确认当前分支为 `chatgpt`，保留用户已有改动。
2. 先为单个 Bug 建立可失败的回归测试或稳定复现。
3. 一次只修改一个 Bug 的最小边界。
4. 等待独立子代理复核并由主代理裁决；BLOCK 必须返工。
5. 目标测试、邻接测试和风险对应门禁通过后，才更新测试记录并进入下一项。
