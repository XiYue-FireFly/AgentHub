# AgentHub 全面 Bug 修复计划

## Context

AgentHub 项目经过全面代码审计，发现 98 个 Bug（Critical 1 / High 14 / Medium 36 / Low 47）。本计划系统性修复所有 Bug，按优先级分阶段实施。审计报告已通过实际代码核对验证——所有 Critical 和 High 级别 Bug 均已确认真实存在。关键决策：CRIT-01 使用现有 `getLocalToken()` 机制；HIGH-13/14 更新 `ipc-types.ts` 定义但保留 `vite-env.d.ts` 现有 ambient 声明方式。

---

## Phase 1: Critical + High 安全漏洞（6 个 Bug）

### CRIT-01: 代理服务器添加 Token 认证
- **文件**: `src/main/routing/proxy.ts`、`src/main/routing/takeover.ts`
- **改动**:
  1. `proxy.ts` `handle()` 方法中，在 CORS 检查后、路由分发前添加 token 校验：从 `Authorization: Bearer <token>` 或 `x-api-key: <token>` 头提取 token，与 `getLocalToken()` 比对；`/health` 端点免认证；不匹配返回 401
  2. `takeover.ts` 中 `claudeApply`、`openclawApply`、`hermesApply` 将硬编码 `'agenthub'` 替换为 `getLocalToken()`（需 `import { getLocalToken } from '../store'`）
- **验证**: 启动应用后用无 token 的 curl 请求 `http://127.0.0.1:9528/v1/models` 应返回 401

### HIGH-01: `conversation:exportFile` 限制写入路径
- **文件**: `src/main/ipc/conversation-ipc.ts`、`src/main/runtime/conversation-export.ts`
- **改动**: 在 IPC handler 中，除了检查 `..`，还使用 `resolve` + `startsWith` 确保路径在 `app.getPath('userData')` 或通过 `dialog.showSaveDialog` 由用户选择
- **验证**: typecheck + 测试传入绝对系统路径应被拒绝

### HIGH-02: `app:readTextFile` 限制读取路径
- **文件**: `src/main/ipc/missing-ipc.ts`
- **改动**: 对绝对路径也做目录范围限制——解析后检查是否在工作区根目录或 `app.getPath('userData')` 下；增加敏感扩展名黑名单（`.ssh`、`.pem`、`.key` 等）
- **验证**: typecheck + 传入 `C:\Users\xxx\.ssh\id_rsa` 应被拒绝

### HIGH-03: `workspaceFiles:preview` 移除敏感扩展名 + 限制路径
- **文件**: `src/main/runtime/workspace-files.ts`、`src/main/ipc/workspace-ipc.ts`
- **改动**: 1) 从 `TEXT_EXTENSIONS` 移除 `.env`、`.cfg`、`.ini`、`.conf`、`.log`；2) IPC handler 中对绝对路径做工作区范围检查
- **验证**: typecheck + 传入 `.env` 文件应返回 "Binary file" 错误

### HIGH-04: `resolveAppPath` 添加路径遍历检查
- **文件**: `src/main/ipc/missing-ipc.ts`
- **改动**: 在 `resolveAppPath` 函数开头添加 `if (p.includes('..')) throw new Error('Invalid path: traversal not allowed')`
- **验证**: typecheck

### HIGH-05: Git `untrackedPreview` / `diffStatsForPath` 路径遍历检查
- **文件**: `src/main/runtime/git.ts`
- **改动**: 在 `untrackedPreview` 和 `diffStatsForPath` 中，将 `join(rootPath, filePath)` 改为 `resolve(rootPath, filePath)`，然后检查 `fullPath.startsWith(resolve(rootPath))`；不通过则返回空/错误
- **验证**: typecheck + `npm run test`

---

## Phase 2: High 功能性 Bug（7 个 Bug）

### HIGH-06: `app.whenReady()` 添加错误处理
- **文件**: `src/main/index.ts`
- **改动**: 1) 在 `app.whenReady().then(async () => {...})` 链末尾添加 `.catch(e => { log.error('Fatal startup error:', e) })`；2) 将 `await initHub()` 包裹在 try-catch 中，确保即使 initHub 失败，`registerAllIpcHandlers` 仍能执行
- **验证**: typecheck

### HIGH-07: Chain 模式状态判定修正
- **文件**: `src/main/hub/dispatcher.ts`
- **改动**: 第 265 行，将 `task.errors.size === targets.length && targets.length > 0 ? "failed" : "completed"` 改为 `task.errors.size > 0 ? "failed" : "completed"`
- **验证**: `npm run test`

### HIGH-08: `runAgenticHttpBranch` busyCount 递减
- **文件**: `src/main/hub/dispatcher.ts`
- **改动**: 在 `runAgenticHttpBranch` 的 `finally` 块（第 828-831 行）中，复用 `sendToAgent` 的 busyCount 递减逻辑：
  ```typescript
  finally {
    const remaining = (this.busyCount.get(agentId) || 1) - 1
    if (remaining <= 0) {
      this.busyCount.delete(agentId)
      this.registry.setStatus(agentId, "idle")
    } else {
      this.busyCount.set(agentId, remaining)
    }
  }
  ```
- **验证**: `npm run test`

### HIGH-09: `useTransitionState` rAF 句柄清理
- **文件**: `src/renderer/hooks/useTransitions.ts`
- **改动**: 在 `useTransitionState` 的 `open` 分支中捕获 rAF 句柄并返回清理函数：
  ```typescript
  if (open) {
    setMounted(true)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true))
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }
  ```
- **验证**: typecheck

### HIGH-10: ComposerBar 消息队列 setTimeout 清理 + onSend 依赖
- **文件**: `src/renderer/workbench/ComposerBar.tsx`
- **改动**: 在队列处理 effect 中：1) 返回清理函数 `return () => clearTimeout(timer)` 取消 setTimeout；2) 将 `onSend` 加入依赖数组 `[sending, queue, onSend]`
- **验证**: typecheck

### HIGH-11: `watchTerminalRun` 添加取消机制
- **文件**: `src/renderer/workbench/WorkbenchLayout.tsx`
- **改动**: 1) 修改 `watchTerminalRun` 接受 `AbortSignal` 参数，在循环中检查 `signal.aborted`；2) 调用处用 `AbortController` 跟踪，在组件卸载或切换时 abort
- **验证**: typecheck

### HIGH-12: SessionSidebar 拖拽监听器泄漏
- **文件**: `src/renderer/workbench/SessionSidebar.tsx`
- **改动**: 用 `useRef` 跟踪当前拖拽的 move/up 回调，添加 `useEffect` 清理函数在组件卸载时移除 window 监听器并移除 `document.body` 上的 `wb-sidebar-resizing` class
- **验证**: typecheck

---

## Phase 3: High 类型统一（2 个 Bug）

### HIGH-13: ipc-types.ts 从未被导入
- **文件**: `src/shared/ipc-types.ts`、`src/renderer/vite-env.d.ts`
- **改动**: 保留 vite-env.d.ts 现有 ambient 声明方式（避免破坏渲染器全局类型），但在 vite-env.d.ts 头部添加 `/// <reference path="../../shared/ipc-types.ts" />` 确保类型一致性可被工具发现；在 ipc-types.ts 头部注释中明确标注"vite-env.d.ts 镜像此文件"
- **验证**: `npm run typecheck`

### HIGH-14: 统一 4 个不匹配类型
- **文件**: `src/shared/ipc-types.ts`
- **改动**: 以 `vite-env.d.ts` 中更完整的定义为准回填：
  1. `GitStatus`: 补充 `workspaceId`、`rootPath`、`upstream`、`stagedFiles`、`unstagedFiles`、`totalAdditions`、`totalDeletions` 字段
  2. `GitFileStatus`: 改为 `index` + `workingTree` 字符串字段结构，补充 `additions`、`deletions`、`oldPath`
  3. `GitBranchListResponse`: 补充 `branches`、`currentBranch`、`repositoryState`、`diagnostic`
  4. `McpServerConfig`: `source` 改为联合类型，补充 `headers`、`cwd`、`timeoutMs`、`trustScope`、`trustedWorkspaceRoots`、`sourcePath`
  5. `UsageStats`: 补充 16 个缺失字段（token 分解、成本跟踪、会话计数等）
  6. `TurnCreateInput.modelSelection`: 从 `any` 改为完整 `ModelSelection` 接口
- **验证**: `npm run typecheck`

---

## Phase 4: Medium 级别（36 个 Bug）

### 安全相关（MED-05, MED-06, MED-16, MED-24, MED-25, MED-26, MED-32）

- **MED-05** `src/main/store.ts`: `encryptSecret` 在 safeStorage 不可用时拒绝存储密钥并抛错（而非回退明文）
- **MED-06** `src/main/index.ts`: `parseDeepLink` 添加 action 白名单校验（`['open', 'thread', 'settings']` 等）
- **MED-16** `src/main/hub/adapters/stdio-adapter.ts`: `execSync` 改为 `execFileSync`（数组参数，不经 shell）
- **MED-24** `src/main/runtime/worktrees.ts`: `removeWorktree` 在 parent 不存在时拒绝删除
- **MED-25** `src/main/runtime/mcp.ts`: 自动发现的 MCP server 命令需用户确认后执行
- **MED-26** `src/renderer/lib/sanitize.ts`: SVG_EVENTS 替换添加 `g` 标志；考虑引入 DOMPurify（如可用）
- **MED-32** `src/preload/index.ts`: 为 `terminal:run`、`app:openPath`、`app:resolvePath` 添加输入验证

### 功能性 Bug（MED-01 ~ MED-04, MED-07 ~ MED-15, MED-17 ~ MED-23, MED-27 ~ MED-31）

- **MED-01** `src/main/ipc/passthrough-ipc.ts`: `hasProviders` 改用 `providerMgr?.getConfig?.()?.providers?.length`
- **MED-02** `src/main/ipc/hub-threads-ipc.ts`: `runGitQuery` 用 try-catch 包裹，异常时 `setTurnStatus(turn.id, "failed")`
- **MED-03** `src/main/ipc/passthrough-ipc.ts`: `release:checks` 中 `cwd` 使用 `app.getAppPath()` 或检测 `app.isPackaged`
- **MED-04** `src/main/index.ts`: `routeStatsFromHistory` 添加缓存/增量更新
- **MED-07** `src/main/ipc/hub-threads-ipc.ts`: `threads:fork` 对 `input.message` 做空值校验
- **MED-08** `src/main/hub/adapters/acp-client.ts`: `handleExit` 添加防重入保护
- **MED-09** `src/main/hub/adapters/acp-client.ts`: `handlePermissionRequest` 中 `sid` 用 `String()` 转换
- **MED-10** `src/main/hub/adapters/acp-client.ts`: 权限请求无 options 时，approved=true 应返回默认 "allow" outcome
- **MED-11** `src/main/hub/adapters/acp-client.ts`: `onStdout` 缓冲区设置 1MB 上限
- **MED-12** `src/main/hub/server.ts`: WebSocket 连接添加 `ws.on('error', ...)` 处理器
- **MED-13** `src/main/hub/agent-detector.ts`: `execFileSync` 改为异步 `execFile` + `Promise.all`
- **MED-14** `src/main/hub/agent-detector.ts`: `where.exe` 按平台选择 `where.exe`/`which`
- **MED-15** `src/main/hub/registry.ts`: `incrementError` 中添加 `info.status = "error"`
- **MED-17** `src/main/runtime/terminal.ts`: `close` 事件处理器跳过 `"failed"` 状态
- **MED-18** `src/main/runtime/models-center.ts`: `testModelRoute` 添加 `AbortController`，超时时 abort
- **MED-19** `src/main/providers/manager.ts`: `fetchModels` 先组装完整 provider 对象再赋值
- **MED-20** `src/main/providers/manager.ts`: `checkProviderHealth` 防抖保存
- **MED-21** `src/main/runtime/store.ts`: `dispose` 中 flush 待保存数据
- **MED-22** `src/main/providers/client.ts`: `openaiMessagesToAnthropic` 合并连续同角色消息
- **MED-23** `src/main/runtime/backup.ts`: 备份时解密 API Key 或提示用户恢复后重输
- **MED-27** `src/renderer/workbench/markdown-renderer.ts`: 修复文件路径双重转义
- **MED-28** `src/renderer/workbench/WorkbenchLayout.tsx`: 智能调度 effect 添加更严格终止条件
- **MED-29** `src/renderer/glass/ConfirmDialog.tsx`: 并发调用时先 resolve 旧 Promise
- **MED-30** 多文件: 统一使用 `glass/i18n.ts` 的 `tr()` 替换本地定义
- **MED-31** `src/shared/ipc-types.ts`: `UsageStats` 补全 16 个字段（与 HIGH-14 合并）

### 构建配置（MED-33 ~ MED-36）

- **MED-33** `electron.vite.config.ts`: 重新加回 `@tailwindcss/vite` 插件或移除 `@import "tailwindcss"` 并更新 AGENTS.md
- **MED-34** `package.json`: 添加 `"engines": { "node": ">=24", "npm": ">=11" }`
- **MED-35** `.github/workflows/ci.yml` + `playwright.config.ts`: CI 增加 E2E job 或删除未使用的 webServer 配置
- **MED-36** `package.json` + `vitest.config.ts`: 安装 `@vitest/coverage-v8`、`happy-dom`、`@testing-library/react`

---

## Phase 5: Low 级别（47 个 Bug）

### 功能性 Bug
- **LOW-01** `src/main/ipc/missing-ipc.ts`: `ai:quickComplete` catch 块中也 `clearTimeout`
- **LOW-02** `src/main/index.ts`: Windows 托盘使用 `icon.ico`
- **LOW-03** `src/main/index.ts`: `turns:cancelAgent` 取消后重新获取快照
- **LOW-04** `src/main/ipc/passthrough-ipc.ts`: `release:checks` 实际执行 typecheck/test/build
- **LOW-05** `src/main/ipc/browser-ipc.ts`: ID 生成追加随机后缀
- **LOW-06** `src/main/store.ts`: `getAll()` 返回深拷贝
- **LOW-07** `src/main/ipc/workflow-ipc.ts`: `backup:create` 排除 `local.token`
- **LOW-08** 提取 `isProviderDirectSelection` 为 shared 工具函数
- **LOW-09** `src/main/index.ts`: `Math.random()` 改为 `crypto.randomBytes`
- **LOW-10** `src/main/agentic/approval.ts`: `read()` 返回深拷贝
- **LOW-11** `src/main/hub/router.ts`: 正则改为 `/@([\w-]+)/`
- **LOW-12** `src/main/agentic/tools.ts`: stdout/stderr 输出缓冲设上限
- **LOW-13** `src/main/hub/workspace.ts`: 首文件也做大小截断
- **LOW-14** `src/renderer/workbench/ThreadView.tsx`: 添加低频定时器触发重渲染
- **LOW-15** `src/renderer/App.tsx`: 流式期间暂停 memory save effect
- **LOW-16** `src/renderer/hooks/useResponsiveLayout.ts` + `WorkbenchLayout.tsx`: resize 事件添加 rAF 节流
- **LOW-17** `src/renderer/main.tsx`: 主样式表加载后移除回退样式
- **LOW-18** `src/renderer/screens/ProvidersTab.tsx`: `autoFetchSignaturesRef` 添加清理/LRU
- **LOW-19** `src/renderer/workbench/GitBranchControl.tsx`: 分离 status 和 branches 获取为独立 effect
- **LOW-20** `src/renderer/ErrorBoundary.tsx`: "Try again" 提供导航到安全状态选项
- **LOW-21** `src/shared/ipc-types.ts`: `TurnCreateInput.modelSelection` 改为 `ModelSelection`（与 HIGH-14 合并）
- **LOW-22** `src/shared/errors.ts`: `wrapError` 检查 `err.message` 属性
- **LOW-23** `src/preload/index.ts` + `missing-ipc.ts`: `app:openExternal` 返回结果对象
- **LOW-24** `src/preload/index.ts`: `onChatResponse` 移入 `chat` 或 `hub` 命名空间
- **LOW-25** `src/shared/errors.ts`: 错误工厂添加 `action` 默认值
- **LOW-26** `src/shared/errors.ts`: `cause` 扩展到前 5 行，非 Error 值派生 cause

### 安全 + 性能
- **LOW-27** `src/main/runtime/terminal.ts`: `killProcessTree` 改用 `execFileSync`
- **LOW-28** `src/main/routing/takeover.ts`: 保留用户原有 `ANTHROPIC_SMALL_FAST_MODEL`
- **LOW-29** `src/main/routing/proxy.ts`: `listModels` 过滤禁用 provider（与 CRIT-01 合并，认证后自然限制）
- **LOW-30** `src/main/providers/client.ts`: 错误日志中脱敏 URL 中的 key
- **LOW-31** `src/main/routing/proxy.ts`: `onClose` 中设置 `settled = true`
- **LOW-32** `src/main/providers/client.ts`: `normalizeUsage` 的 `total_tokens` 不取最大值
- **LOW-33** `src/main/runtime/plugin-manager.ts`: `realpathSync` 失败时拒绝符号链接遍历
- **LOW-34** `src/main/routing/proxy.ts`: `readBody` reject 前 `req.removeAllListeners()`
- **LOW-35** `src/main/providers/manager.ts`: fallback 时按模型能力匹配最接近的模型

### 构建 + 配置
- **LOW-36** 创建 `build/entitlements.mac.plist` 或删除引用
- **LOW-37** `package.json`: 文档说明 SmartScreen 警告为预期行为（待后续配置代码签名）
- **LOW-38** `test/electron-stub.ts`: 补充 `Tray`/`Notification`/`WebContents` 占位导出
- **LOW-39** `git rm --cached nul` + `.gitignore` 添加 `nul`
- **LOW-40** `tsconfig.node.json` + `eslint.config.mjs`: 加入配置文件覆盖
- **LOW-41** `package.json`: `@types/node` 升级到 `^24`
- **LOW-42** `electron.vite.config.ts`: CSP replace 改用正则 + 断言
- **LOW-43** `electron.vite.config.ts`: 厂商图标改为项目内置资源或环境变量控制
- **LOW-44** `eslint.config.mjs`: 按路径分设 node/browser 全局变量
- **LOW-45** (已合并到 LOW-29)
- **LOW-46** `src/shared/ipc-types.ts`: 补全 `TurnCreateInput` 等接口字段（与 HIGH-14 合并）
- **LOW-47** `tsconfig.web.json`: 移除冗余 locale JSON 显式列出

---

## 实施策略

### 按文件分组修改（避免冲突）
同一文件被多个 Bug 涉及时，一次性完成所有修改：
1. `src/main/routing/proxy.ts` → CRIT-01, LOW-29, LOW-31, LOW-34
2. `src/main/routing/takeover.ts` → CRIT-01, LOW-28
3. `src/main/ipc/missing-ipc.ts` → HIGH-02, HIGH-04, LOW-01, LOW-23
4. `src/main/index.ts` → HIGH-06, MED-04, MED-06, LOW-02, LOW-03, LOW-08, LOW-09
5. `src/main/hub/dispatcher.ts` → HIGH-07, HIGH-08
6. `src/shared/ipc-types.ts` → HIGH-13, HIGH-14, LOW-21, LOW-46, MED-31
7. `src/main/store.ts` → MED-05, LOW-06, LOW-07
8. `src/renderer/workbench/WorkbenchLayout.tsx` → HIGH-11, MED-28, LOW-16
9. `src/shared/errors.ts` → LOW-22, LOW-25, LOW-26
10. `src/preload/index.ts` → MED-32, LOW-23, LOW-24

### 验证方法
- 每个 Phase 完成后运行 `npm run typecheck` 和 `npm run test`
- 安全修复完成后手动测试路径遍历和认证场景
- 构建配置修改后运行 `npm run build` 验证
- 最终运行 `npm run lint` 确保无新增 lint 错误

### 遗留风险（待后续处理）
- **LOW-37**: Windows 代码签名需要购买证书，标注为待后续处理
- **MED-35**: E2E 测试在 CI 中运行需要 Playwright 浏览器安装，可能需要 CI 环境调整
- **MED-36**: 安装新 devDependencies 需要 `npm install`，可能影响 lockfile
- **MED-23**: 备份加密密钥跨机器恢复需用户重新输入 API Key，属预期行为
