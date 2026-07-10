# AgentHub-v123 Bug 清单

> 本文档由全栈 bug 排查生成，覆盖主进程运行时/IPC/安全、Agent 适配器/Hub 编排/缓存/内存/SDD、渲染进程（screens/glass/sdd/workbench/store）、配置层与构建脚本。
> 所有 bug 均已人工复核验证，按严重程度分级（Critical / High / Medium / Low），每条给出精确位置、问题说明与最小范围修改建议。
> 说明：本清单只列 bug，不涉及代码文件拆分建议。

---

## 目录

- [一、主进程运行时 / IPC / 安全层](#一主进程运行时--ipc--安全层)
- [二、Agent 适配器 / Hub 编排 / 缓存 / 内存 / SDD](#二agent-适配器--hub-编排--缓存--内存--sdd)
- [三、渲染进程（screens / glass / sdd / preload）](#三渲染进程screens--glass--sdd--preload)
- [四、Workbench 核心 UI 与 Zustand Store](#四workbench-核心-ui-与-zustand-store)
- [五、配置层 / 构建脚本 / 菜单](#五配置层--构建脚本--菜单)
- [汇总统计](#汇总统计)

---

## 一、主进程运行时 / IPC / 安全层

### Critical

#### M-C1 `workspaceFiles:preview` 与 `workspaceFiles:read` 缺少敏感文件校验
- **位置**: `src/main/ipc/workspace-ipc.ts:42-54`（preview）、`src/main/ipc/workspace-ipc.ts:57-66`（read）
- **类别**: 安全校验缺陷
- **问题**: `workspaceFiles:preview` 仅校验路径在 workspace/home 内，未调用 `isSensitiveTextFilePath`；`workspaceFiles:read` 用 `validateWorkspacePath` 限制在 workspace 内，但 workspace 内的 `.env`、`.pem`、`id_rsa` 等敏感文件可被完整读取。对比 `app:readTextFile`（`src/main/ipc/missing-ipc.ts:151`）明确做了敏感文件校验，这两个处理器遗漏了。
- **后果**: 渲染进程（或被入侵的渲染进程）可读取 workspace 内任意敏感凭据文件内容。
- **修改建议**: 在两个处理器的路径校验之后、读取之前加入敏感文件拦截：
  ```ts
  import { isSensitiveTextFilePath } from './sensitive-files'
  // preview: 第 52 行前
  if (isSensitiveTextFilePath(resolved)) return { ok: false, error: 'Access denied: sensitive file' }
  // read: 第 59 行后
  if (isSensitiveTextFilePath(absPath)) return { ok: false, content: '', path: '', error: 'Access denied: sensitive file' }
  ```

#### M-C2 `conversation:importFile` 无路径范围校验，可读取任意文件
- **位置**: `src/main/ipc/conversation-ipc.ts:16`
- **类别**: 路径穿越 / 安全校验缺陷
- **问题**: `typedHandle("conversation:importFile", (_e, filePath) => importConversationFromFile(filePath))` 直接将渲染进程传入的 `filePath` 透传，无任何路径范围校验。对比同文件 `conversation:exportFile`（第 10-14 行）使用了 `resolvePathWithinAllowedBases`，存在安全校验不对称。`importConversationFromFile` 内部（`conversation-import.ts`）仅 `existsSync` 后 `readFile`。
- **后果**: 渲染进程可传入 `C:/Users/xxx/.ssh/id_rsa` 等任意绝对路径读取文件内容（若文件恰为 JSON 格式则完整泄露，否则部分内容可能出现在错误信息中）。
- **修改建议**:
  ```ts
  typedHandle("conversation:importFile", (_e, filePath) => {
    const home = app.getPath('home')
    const normalized = resolvePathWithinAllowedBases(filePath, home, [home])
    return importConversationFromFile(normalized)
  })
  ```

#### M-C3 `plugins:scan` 未校验 workspaceRoot 是否已注册
- **位置**: `src/main/ipc/plugins-ipc.ts:6`
- **类别**: 路径穿越 / 安全校验缺陷
- **问题**: `typedHandle("plugins:scan", (_e, workspaceRoot) => scanPlugins(workspaceRoot))` 直接透传 `workspaceRoot`，未用 `resolveRegisteredWorkspaceRoot` 或 `assertRegisteredWorkspaceRoot` 校验。
- **后果**: 渲染进程可传入任意路径让主进程扫描该目录下插件，导致信息泄露或触发非预期文件系统操作。
- **修改建议**:
  ```ts
  typedHandle("plugins:scan", (_e, workspaceRoot) => {
    const root = resolveRegisteredWorkspaceRoot(workspaceRoot)
    if (!root) return []
    return scanPlugins(root)
  })
  ```

#### M-C4 `knowledge:detectTechStack` 与 `knowledge:generateSummary` 无路径校验
- **位置**: `src/main/ipc/passthrough-ipc.ts:141-142`
- **类别**: 路径穿越 / 安全校验缺陷
- **问题**: 两个处理器直接把渲染进程传入的 `rootPath` 透传给 `detectTechStack` / `generateWorkspaceSummary`，未校验是否为已注册 workspace。
- **后果**: 渲染进程可让主进程扫描/读取任意目录的技术栈信息。
- **修改建议**: 用 `resolveRegisteredWorkspaceRoot(rootPath)` 校验后再调用，校验失败返回空结果。

#### M-C5 `projectMap:build` 无路径校验
- **位置**: `src/main/ipc/workflow-ipc.ts:114`
- **类别**: 路径穿越 / 安全校验缺陷 / 拒绝服务
- **问题**: `typedHandle("projectMap:build", (_e, rootPath, maxDepth) => buildProjectMap(rootPath, maxDepth))` 直接透传 `rootPath`。`buildProjectMap` 会递归遍历目录。
- **后果**: 渲染进程可传入 `C:/Windows` 等系统目录，导致主进程大量 I/O 甚至卡死。
- **修改建议**: 用 `resolveRegisteredWorkspaceRoot(rootPath)` 或 `resolvePathInRegisteredWorkspace(rootPath)` 校验后再调用。

#### M-C6 备份文件包含明文 API Key
- **位置**: `src/main/runtime/backup.ts:66-72`
- **类别**: 安全问题 / 信息泄露
- **问题**: `createBackup` 备份 `providers.config.v1` 时调用 `decryptSecret(p.apiKey)` 将加密的 API key 解密为明文写入备份 JSON 文件（注释称"cross-machine portability"）。
- **后果**: 备份文件含明文 API key，若被误提交 git 或被其他程序读取即泄露凭据。
- **修改建议**: 保留加密状态写入备份，或用用户提供的密码重新加密；至少在备份元数据中标记含敏感信息并在 UI 警告用户。最小修改：删除解密逻辑，直接 `backupStore[key] = value`（保留 store 中的加密形态）。

### High

#### M-H1 `app:readTextFile` 与 `workspaceFiles:preview/list` 使用同步 fs 阻塞主线程
- **位置**: `src/main/ipc/missing-ipc.ts:160`（`readFileSync`）、`src/main/runtime/workspace-files.ts:91`（`readFileSync`）、`workspace-files.ts` 中 `readdirSync`/`statSync`
- **类别**: 性能问题 / 主线程阻塞
- **问题**: IPC 处理器中同步读取文件（最多 1MB）或同步遍历目录，会阻塞 Electron 主进程事件循环，大文件/大目录时造成 UI 冻结。
- **修改建议**: 改为 `await fs.promises.readFile` / `await fs.promises.readdir` / `await fs.promises.stat`。

#### M-H2 `store.set` 触发同步 `writeFileSync` + `renameSync` 阻塞主线程
- **位置**: `src/main/store.ts:87-102`
- **类别**: 性能问题 / 主线程阻塞
- **问题**: `AppStore.save()` 用 `setTimeout` 延迟 200ms 后调用 `fs.writeFileSync` 和 `fs.renameSync`，均为同步操作。config.json 较大时每次 `store.set` 后的写入会造成 UI 卡顿；`before-quit` 的 `flush()` 同样同步写入。
- **修改建议**: 改用 `fs.promises.writeFile` / `fs.promises.rename`，并在 `will-quit` 中 await flush 完成。需保证写入不被进程退出中断。

#### M-H3 Terminal PTY 会话 `onData` 注册早于 sender 绑定，存在数据丢失/竞态
- **位置**: `src/main/ipc/terminal-pty-ipc.ts:122`（`pty.onData` 注册）与 `:141`（`attachSenderToSession`）
- **类别**: 竞态条件
- **问题**: `pty.onData` 回调在 `attachSenderToSession` 之前注册。若 spawn 后立即有输出（onData 触发），此时 `session.sender` 可能尚未设置或仍是旧 sender，早期输出可能丢失或发往错误窗口。
- **修改建议**: 将 `attachSenderToSession` 调用移到 `pty.onData` 注册之前，确保 sender 正确设置后再开始接收数据。

#### M-H4 `will-quit` 超时后子进程可能成为孤儿
- **位置**: `src/main/index.ts:1146-1149`
- **类别**: 资源泄漏
- **问题**: `await Promise.race([registry.stopAll().catch(() => {}), setTimeout(resolve, STOP_TIMEOUT_MS)])`，若 `stopAll` 超过 5 秒未完成，`app.exit(0)` 强制退出，但 `stopAll` 内部未完成的子进程 kill 操作可能遗留孤儿进程。
- **修改建议**: 超时后强制 kill 所有已知子进程（参考 `disposeAllTerminalSessions` 模式），而非仅等待超时。

#### M-H5 `HealthMonitor.start()` 的 `performHealthCheck()` 是 fire-and-forget async，未处理 rejection
- **位置**: `src/main/runtime/health-monitor.ts:96-101`
- **类别**: 未处理 Promise rejection
- **问题**: `start()` 和 `setInterval` 回调中调用 `this.performHealthCheck()` 未 await 也未 catch。若 `performHealthCheck` 内部 `handleFailure` → `attemptRestart` → `restart()` 抛错，产生 unhandled rejection。
- **修改建议**: `void this.performHealthCheck().catch(() => {})`，`setInterval` 回调同样加 `.catch`。

#### M-H6 `attemptRestart` 的 backoff `setTimeout` 不支持取消，`stop()` 后仍会重启
- **位置**: `src/main/runtime/health-monitor.ts:183`
- **类别**: 资源泄漏 / 逻辑错误
- **问题**: `await new Promise(resolve => setTimeout(resolve, verdict.delayMs))` 的 timer 未存储，`stop()` 只清 `checkTimer`，不处理进行中的 `attemptRestart`。stop 后仍会触发 `restart()`。
- **修改建议**: 存储 backoff timer，在 `stop()` 中清除；或在 restart 前检查 `this.status === 'stopped'`。

### Medium

#### M-M1 `worktrees.ts` 的 `isInside` 用字符串前缀匹配，Windows 大小写不敏感问题
- **位置**: `src/main/runtime/worktrees.ts:109-114`
- **类别**: 跨平台 / 安全校验缺陷
- **问题**: `target.startsWith(root + sep)` 在 Windows 上大小写敏感，但 Windows 路径大小写不敏感。`root="C:\Users\foo\Project"` 与 `target="c:\users\foo\project\sub"` 比较返回 false，可能导致 worktree 校验失败或绕过。对比 `path-guards.ts` 的 `isPathInsideBase` 用 `relative()` 判断无此问题。
- **修改建议**: 改用 `isPathInsideBase`（已在 workspace-ipc.ts import），或 Windows 上 `toLowerCase()` 比较。

#### M-M2 `budget-center.ts` 超预算但 `blockWhenExceeded=false` 时返回 `allowed:true` 无 warning
- **位置**: `src/main/runtime/budget-center.ts:62-67`
- **类别**: 逻辑错误
- **问题**: `perRequestMaxTokens` 超限且 `blockWhenExceeded=false` 时返回 `{ allowed: true, reason: "..." }`，但调用方只检查 `check.allowed`，用户收不到任何警告。
- **修改建议**: `!config.blockWhenExceeded` 时将 `reason` 改为 `warning`：`return { allowed: true, warning: 'Request exceeds ... (not blocked)' }`。

#### M-M3 `inline-edit.ts` 空替换时 `newEndLine` 可能为 0（无效行号）
- **位置**: `src/main/runtime/inline-edit.ts:125-127`
- **类别**: 逻辑错误 / off-by-one
- **问题**: `replacement` 为空时 `replacementLineCount=0`，`newEndLine = startLine - 1`。若 `startLine=1`，`newEndLine=0`（行号从 1 开始），调用方用 0 更新选区可能异常。
- **修改建议**: `newEndLine` 下限保护：`newEndLine = Math.max(startLine, startLine + replacementLineCount - 1)`，或在 `newEndLine < startLine` 时返回 `newEndLine = startLine`。

#### M-M4 `github-integration.ts` 用 `gh git` 子命令获取分支名（gh 不代理 git）
- **位置**: `src/main/runtime/github-integration.ts:92`
- **类别**: 逻辑错误
- **问题**: `execGh(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])` 执行 `gh git rev-parse ...`，但 `gh` CLI **没有** `git` 子命令（gh 不代理 git）。该命令必抛错被 catch 吞掉，返回 `{ branch: '' }`。
- **后果**: `getCurrentBranchPr` 的 `branch` 永远为空字符串，"当前分支关联 PR"功能失效。
- **修改建议**: 改用 `execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { ... })` 直接调用 git。

#### M-M5 `context-compactor.ts` `keepRecent=0` 时压缩全部消息，丢失全部上下文
- **位置**: `src/main/runtime/context-compactor.ts:119`
- **类别**: 逻辑错误
- **问题**: `effectiveKeepRecent = Math.min(keepRecent, messages.length - 1)`，若传入 `keepRecent=0`，`effectiveKeepRecent=0`，`toKeep=[]`，所有消息被压缩，模型完全丢失上下文。
- **修改建议**: `const effectiveKeepRecent = Math.max(1, Math.min(keepRecent, messages.length - 1))`，至少保留 1 条最近消息。

#### M-M6 `git.ts` `normalizeBranchName` 不拒绝控制字符
- **位置**: `src/main/runtime/git.ts:424-431`
- **类别**: 命令注入 / 输入校验
- **问题**: `normalizeBranchName` 检查了空白、`~^:?*[]`、`..`、结尾 `.`、开头 `-`、`@{`，但未检查控制字符（`\n`、`\r` 等）。虽用 `execFile` 数组参数不会 shell 注入，但含换行的分支名会导致 git 输出解析错误。
- **修改建议**: 增加 `/[\x00-\x1f]/.test(name)` 检查，拒绝含控制字符的分支名。

#### M-M7 `worktrees.ts` `removeWorktree` 在 `!force` 且 git remove 失败时仍从 state 删除，导致目录泄漏
- **位置**: `src/main/runtime/worktrees.ts:59-60`
- **类别**: 逻辑错误 / 资源泄漏
- **问题**: `if (existsSync(item.path) && force) rmSync(...)`，`!force` 时不删除目录，但 state 中已 filter 掉（第 60 行）。worktree 目录磁盘存在但程序不知道，造成泄漏。
- **修改建议**: `git worktree remove` 失败且 `!force` 时，不从 state 删除，或抛错让用户感知。

#### M-M8 `memory:addEntry` / `memory:updateEntry` 未校验 entry/patch 结构
- **位置**: `src/main/ipc/memory-ipc.ts:20-26`
- **类别**: 参数校验缺失
- **问题**: 直接将渲染进程传入的 `entry`/`patch` 透传给 memory library，无结构校验。意外字段/类型可能导致 library 内部状态异常。
- **修改建议**: IPC 层做基本结构校验（`category`/`title` 等必填字段类型检查），或在 memory library 内做防御性校验。

### Low

#### M-L1 `terminal.ts` 非 Windows 选择 "powershell" 时用 `pwsh`，未安装时报错不友好
- **位置**: `src/main/runtime/terminal.ts:100`
- **类别**: 跨平台 / 用户体验
- **问题**: 非 Windows 上选择 powershell 返回 `{ command: "pwsh" }`，未安装时 spawn 触发 ENOENT，错误信息未提示安装。
- **修改建议**: spawn 前检查 `pwsh` 是否存在，或在 error 事件中给出"PowerShell (pwsh) not found, please install or switch to system shell"提示。

#### M-L2 `index.ts` `dispatcherReadyPromise` 超时 `setTimeout` 未清理
- **位置**: `src/main/index.ts:602-605`
- **类别**: 资源泄漏
- **问题**: `Promise.race` 中 reject 用 `setTimeout(15000)`，若 dispatcher 先 ready，timer 仍占资源 15 秒。
- **修改建议**: 用变量保存 timer，race 后 `clearTimeout(timer)`。

#### M-L3 `agent-loop-ipc.ts` `cachedAgents` 60 秒 TTL，agent 安装/卸载后不主动失效
- **位置**: `src/main/ipc/agent-loop-ipc.ts:23-25`
- **类别**: 缓存失效
- **问题**: 模块级 `cachedAgents` 60 秒 TTL，用户 60 秒内安装/卸载 agent 缓存不更新（需手动 `refreshAgents`）。
- **修改建议**: agent 安装/卸载事件时清除缓存，或缩短 TTL。

#### M-L4 `mcp.ts` `probeStdioServer` stdin write 失败只 console.error，probe 等到 timeout
- **位置**: `src/main/runtime/mcp.ts:267`
- **类别**: 错误处理缺陷
- **问题**: `child.stdin?.write(initRequest)` 失败只打印日志不 reject，probe 会等到 timeout（5-10 秒）。
- **修改建议**: catch 中 `finish(new Error('Failed to write initialize request to MCP server stdin'))`。

#### M-L5 `index.ts` `turns:create` catch 中错误信息可能泄露敏感路径
- **位置**: `src/main/index.ts:775-793`
- **类别**: 信息泄露
- **问题**: `e?.message || String(e)` 通过 runtimeStore 事件广播到所有窗口，可能含文件系统路径等敏感信息。
- **修改建议**: catch 中对错误信息 sanitize（参考 `git-ipc.ts` 的 `sanitizeGitError`）。

#### M-L6 `passthrough-ipc.ts` `release:checks` 中 `require` 在函数内部调用
- **位置**: `src/main/ipc/passthrough-ipc.ts:190-192`
- **类别**: 代码质量
- **问题**: 每次调用 `release:checks` 都 `require("child_process")` 等，虽有缓存无性能问题，但不符 ES module 风格。
- **修改建议**: 移到文件顶部用 `import`。

---

## 二、Agent 适配器 / Hub 编排 / 缓存 / 内存 / SDD

### Critical

#### H-C1 `getSystemInfo` 中 `hostname` 是 Promise，JSON.stringify 后变为 `{}`
- **位置**: `src/main/mcp/system-tools.ts:395`
- **类别**: 空值/类型错误
- **问题**: `hostname: import('node:os').then(os => os.hostname())` 将 Promise 赋给 `info.hostname`，第 412 行 `JSON.stringify(info)` 把 Promise 序列化为 `{}`。MCP 客户端拿到的 hostname 字段无意义。
- **修改建议**: 顶部 import 加入 `hostname`：`import { homedir, platform, arch, release, totalmem, freemem, cpus, hostname } from 'node:os'`，第 395 行改为 `hostname: hostname()`。

#### H-C2 `safeDelete` 目录删除是异步 fire-and-forget，函数提前返回"成功"
- **位置**: `src/main/mcp/system-tools.ts:266`
- **类别**: 错误处理缺陷 / 逻辑错误
- **问题**: `import('node:fs').then(fs => fs.rmdirSync(targetPath))` 是异步操作，函数第 271 行立即返回 `{ ok: true, output: 'Deleted successfully' }`，此时目录尚未删除。若 `rmdirSync` 失败错误被完全吞掉，调用方收到"成功"但目录仍存在。
- **修改建议**: 顶部 import 加入 `rmdirSync`，第 266 行改为 `rmdirSync(targetPath)`，同步删除后再返回成功。

#### H-C3 `TtlLruCache.cleanup()` 遍历时 `get()` 提升条目位置，部分过期条目被跳过
- **位置**: `src/main/cache/ttl-lru-cache.ts:70-81`，配合 `src/main/cache/lru-cache.ts:32-33`
- **类别**: 缓存 bug / Map 迭代时修改
- **问题**: `cleanup()` 遍历 `this.cache.keys()`，循环内调用 `this.cache.get(key)`。`LruCache.get` 会 `delete(key)` 再 `set(key, value)` 提升位置，在 Map 迭代中"删除+重新插入"会把条目追加到迭代器末尾，导致某些未遍历到的过期条目被跳过，cleanup 不彻底。
- **修改建议**: 在 `LruCache` 增加 `peek(key): V | undefined { return this.entries.get(key) }`，`cleanup()` 中用 `this.cache.peek(key)` 代替 `this.cache.get(key)`，不提升位置：
  ```ts
  for (const key of this.cache.keys()) {
    const entry = this.cache.peek(key)
    if (entry && now > entry.expiresAt) { this.cache.delete(key); removed++ }
  }
  ```

#### H-C4 `AgentLoopIntegration.dispatch` 永久替换 `agentLoop` 实例，后续 auto 模式用错 loop
- **位置**: `src/main/hub/agent-loop-integration.ts:83-92`
- **类别**: 竞态条件 / 状态管理
- **问题**: `dispatch` 仅在 `mode === 'single'` 时重建 `this.agentLoop` 为 single 实例，且不恢复。若第一次 single、第二次 auto，第 83 行条件不满足，`this.agentLoop` 仍是 single 实例，auto 请求错误使用 single loop 执行。
- **修改建议**: 每次调用都根据当前 mode 重建实例，或在非 single 时也重建：
  ```ts
  this.agentLoop = createAgentLoop({
    maxSteps: options.maxSteps || 10,
    timeoutMs: options.timeoutMs || 120000,
    enableDelegation: mode !== 'single',
    mode: mode === 'single' ? 'single' : 'auto',
    singleAgentId
  }, this.providerManager)
  ```

### High

#### H-H1 `AcpClient.onStdout` 缓冲区截断丢弃跨边界 JSON 行头部
- **位置**: `src/main/hub/adapters/acp-client.ts:411-413`
- **类别**: 流式解析 bug
- **问题**: `this.buf = this.buf.slice(-MAX_BUF)` 简单保留最后 1MB，若缓冲区有跨截断边界的未完成 JSON 行，截断丢弃该行头部，后续 `handleMessage` 收到不完整 JSON，`JSON.parse` 失败被静默跳过（第 425 行 catch），丢失重要 ACP 响应/通知。
- **修改建议**: 截断时保留最后一个换行符之后的内容：
  ```ts
  if (this.buf.length > MAX_BUF) {
    const lastNl = this.buf.lastIndexOf('\n', this.buf.length - MAX_BUF)
    this.buf = this.buf.slice(lastNl >= 0 ? lastNl + 1 : this.buf.length - MAX_BUF)
  }
  ```

#### H-H2 `StdioAgentAdapter.send` stdin 写入失败不 kill 进程，进程挂起
- **位置**: `src/main/hub/adapters/stdio-adapter.ts:220-225`
- **类别**: 子进程管理
- **问题**: `proc.stdin?.write` / `end` 失败时 catch 只 `handleError(e)`，不 kill 进程。子进程仍在运行但 stdin 未正确关闭，可能挂起等待输入直到超时。
- **修改建议**: catch 中加进程清理：
  ```ts
  } catch (e: any) {
    try { this.proc?.kill() } catch { /* noop */ }
    this.handleError(e)
  }
  ```

#### H-H3 `ClaudeAdapter` `--permission-mode acceptEdits` 不会自动接受 Bash 命令
- **位置**: `src/main/hub/adapters/claude.ts:20`
- **类别**: 适配器协议错误 / 逻辑错误
- **问题**: 注释称 `acceptEdits` 自动接受文件编辑和运行命令（Bash），但 Claude Code 的 `acceptEdits` **只**自动接受文件编辑，**不**自动接受 Bash。需 `bypassPermissions` 才自动接受所有操作。agent 需运行命令时会挂起等待确认（非交互管道无法确认），最终超时。
- **修改建议**: 若需自动执行命令改 `--permission-mode bypassPermissions`；若安全考虑保持 `acceptEdits` 则修正注释，说明 Bash 不会被自动接受。

#### H-H4 `aggregator.ts` `calculateConfidence` 硬编码英文关键词，对中文输出误判
- **位置**: `src/main/hub/aggregator.ts:32-37`
- **类别**: 聚合器逻辑错误
- **问题**: `content.includes('error'/'Error')` 降置信度到 0.3，但中文"错误"不匹配；含 `Error` 的正常技术内容（错误码、类名）被误判低置信度。纯中文高质量回答无 ``` 或 --- 标记得 0.6，导致多 agent 聚合排序偏差。
- **修改建议**: 第 34 行增加中文关键词：`if (content.includes('error') || content.includes('Error') || content.includes('错误') || content.includes('失败')) return 0.3`。

#### H-H5 `proxy.ts` `onToolCallDelta` 未检查 `settled`，可能在 `onDone` 后写入已关闭 response
- **位置**: `src/main/routing/proxy.ts:478-484`
- **类别**: 流式解析 / 错误处理
- **问题**: `onToolCallDelta` 开头检查 `if (noStream) return` 但未检查 `settled`。若工具增量在 `onDone` 之后到达，可能尝试 `emitter.begin()` 写入已结束的 HTTP response。其他回调（onDone/onError）都检查了 `settled`。
- **修改建议**: `onToolCallDelta` 开头加 `if (settled) return`，与其他回调一致。

### Medium

#### H-M1 `sdd-store.ts` `getDraft` 中 `meta` 变量遮蔽，逻辑混乱且可能 ReferenceError
- **位置**: `src/main/sdd/sdd-store.ts:244-276`
- **类别**: 空值/类型错误 / 逻辑错误
- **问题**: 第 250 行 `const meta = await readDraftMetaFile(...)`，第 254-258 行 try 块内又 `const meta = JSON.parse(metaContent)` 遮蔽外层。第 269 行 `designContext: meta.designContext ?? designContext` 的 `meta` 作用域引用混乱，`designContext` 在 try 块内声明，块外引用可能未定义。
- **修改建议**: 删除第 254-261 行重复读取解析（第 250 行 `readDraftMetaFile` 已做），第 269 行直接用外层 `meta`：`designContext: meta.designContext`。

#### H-M2 `memory-store.ts` `update` 展开运算符可能用 `undefined` 覆盖已有值
- **位置**: `src/main/memory/memory-store.ts:185-198`
- **类别**: 增量更新漏字段
- **问题**: `{ ...entry, ...patch }`，若 `patch = { title: undefined }`（显式 undefined），展开运算符会用 undefined 覆盖原 title（JS 中 `{...{a:undefined}}` 产生 `{a:undefined}`），意图"不修改"的调用意外清空字段。
- **修改建议**: 合并前过滤 undefined 字段：
  ```ts
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const updated = { ...entry, ...cleanPatch, id: entry.id, updatedAt: new Date().toISOString() }
  ```

#### H-M3 `takeover.ts` `claudeApply` 保留旧 `ANTHROPIC_SMALL_FAST_MODEL` 导致小模型请求失败
- **位置**: `src/main/routing/takeover.ts:199-206`
- **类别**: 路由/takeover 逻辑
- **问题**: 第 204 行 `ANTHROPIC_SMALL_FAST_MODEL: env.ANTHROPIC_SMALL_FAST_MODEL || modelRef`，接管时 `ANTHROPIC_BASE_URL` 已改代理地址，但小模型名保留旧值，代理侧无法识别该模型名，小模型请求失败。
- **修改建议**: 接管时同时覆盖：`ANTHROPIC_SMALL_FAST_MODEL: modelRef`（stash 已保存原值，restore 时还原）。

#### H-M4 `memory-library.ts` `selectContextEntries` user scope 条目可能挤掉 workspace 相关条目
- **位置**: `src/main/memory/memory-library.ts:135-152`
- **类别**: 内存/存储逻辑
- **问题**: user scope 条目无条件注入后按 token budget 筛选，非 pinned 的 user 条目会先占满 budget，挤掉与当前任务更相关的 workspace 条目。
- **修改建议**: 按 score 全局排序合并，或对 user/workspace 分别设子预算。

#### H-M5 `agent-loop.ts` `selectAgent` 中 `'search'` 关键词重复检测
- **位置**: `src/main/loop/agent-loop.ts:290`
- **类别**: 逻辑错误 / 复制粘贴
- **问题**: `lowerReasoning.includes('search') || lowerReasoning.includes('explore') || lowerReasoning.includes('search')`，`'search'` 检测两次。
- **修改建议**: 去掉重复的 `includes('search')`，或替换为 `'find'` 等其他关键词。

#### H-M6 `codex-stream-json.ts` `exit_code` 默认值 0 可能掩盖失败
- **位置**: `src/main/hub/adapters/codex-stream-json.ts:109`
- **类别**: 流式解析 / 错误处理
- **问题**: `const exitCode = typeof item.exit_code === 'number' ? item.exit_code : 0`，若 Codex `completed` 事件无 `exit_code` 字段，默认 0（成功），步骤标记 done 而非 error，命令实际失败仍显示绿色完成。
- **修改建议**: 默认值改 `undefined`/`null`，状态判断中区分无 exit_code 的情况。

#### H-M7 `sdd-trace.ts` `parseRequirementBlocks` 验收标准后的补充说明被丢弃
- **位置**: `src/main/sdd/sdd-trace.ts:83-91`
- **类别**: 流式解析 / 逻辑错误
- **问题**: 验收标准出现后（`acceptanceCriteria.length > 0`），后续非验收标准行被忽略，验收标准后的补充说明丢失。
- **修改建议**: 明确规范"描述必须在验收标准前"并在文档标注，或修改逻辑保留后续说明行。

### Low

#### H-L1 `dispatcher.ts` `pruneTasks` 只清理终端状态任务，running 任务永不清理
- **位置**: `src/main/hub/dispatcher.ts:1151-1162`
- **类别**: 内存/存储
- **问题**: 超过 100 任务时只删 `completed/cancelled/failed`，大量 running 任务（cancel 失败或状态未更新）永不被清理，tasks Map 持续增长。
- **修改建议**: 对极老（>1 小时）的 running 任务强制标记 failed 后清理。

#### H-L2 `HubServer` `clientId` 用 `Date.now()+随机后缀` 可能碰撞
- **位置**: `src/main/hub/server.ts:69`
- **类别**: ID 冲突
- **问题**: 同毫秒连接 + 4 字符随机后缀碰撞（约 1/1.3M）时 clientId 相同，第二个连接覆盖 Map 中第一个 entry。
- **修改建议**: 用 `crypto.randomUUID()`。

#### H-L3 `multi-model-aggregator.ts` `isSimilar` 用空格分词，中文相似度计算失效
- **位置**: `src/main/loop/multi-model-aggregator.ts:302-313`
- **类别**: 聚合器逻辑
- **问题**: Jaccard 相似度用空格分词，中文无空格整段当一个"词"，相似中文回答相似度为 0，`consensus` 永远低，`needsConsensus` 总是 true。
- **修改建议**: 中文用字符级或 bigram 分词。

#### H-L4 `agent-loop.ts` `parseRouteResponse` 定义但从未调用（死代码）
- **位置**: `src/main/loop/model-router.ts:290-306`
- **类别**: 死代码
- **问题**: `llmRouter` 当前返回 null（not implemented），`parseRouteResponse` 从未被调用。
- **修改建议**: 保留备用或删除避免混淆。

#### H-L5 `tools.ts` `runCommand` 超时后 SIGKILL 的 `setTimeout` 未清理
- **位置**: `src/main/agentic/tools.ts:183-186`
- **类别**: 资源泄漏
- **问题**: 进程正常退出后 500ms 的 SIGKILL timer 仍运行（虽功能正确）。
- **修改建议**: `close` 事件处理中清除 SIGKILL timer。

#### H-L6 `dispatcher.ts` `runAgenticHttpBranch` 与 `sendToAgent` 的 finally 双重递减 busyCount
- **位置**: `src/main/hub/dispatcher.ts:982-991` 与 `:835-843`
- **类别**: 竞态条件 / 状态管理
- **问题**: `sendToAgent` 调用 `runAgenticHttpBranch` 后两个 finally 都执行 busyCount 递减 + setStatus idle，setStatus 被调用两次，中间新 dispatch 可能看到不一致状态。
- **修改建议**: `runAgenticHttpBranch` 中不处理 busyCount/registry，让 `sendToAgent` finally 统一处理。

---

## 三、渲染进程（screens / glass / sdd / preload）

### Critical

#### R-C1 `sanitize.ts` XSS 过滤不完整，多个攻击向量未覆盖
- **位置**: `src/renderer/lib/sanitize.ts:1-12`
- **类别**: XSS / 转义问题
- **问题**: `sanitizeHtml` 用于 `MarkdownBlock.tsx:91` 和 `WriteWorkspace.tsx:166` 的 `dangerouslySetInnerHTML`。该自写 sanitizer 存在缺陷：
  1. `EVENT_HANDLERS` 正则 `\s+on[a-z]+=` 要求空白前缀，`<img/onerror=...>` 用斜杠分隔不被匹配；
  2. `JS_PROTOCOL` 只检查 `href|src|action`，`xlink:href`、`formaction` 未覆盖；
  3. 未处理 CSS `expression()`、`@import`；
  4. `<svg>` 内嵌 script 命名空间混淆。
  当前 `renderMarkdown` 不产出 img/svg 标签所以多数向量不可达，但作为纵深防御不完整，未来直接对用户 HTML 调用 `sanitizeHtml` 即可触发。
- **修改建议**: 替换为 DOMPurify：`import DOMPurify from 'dompurify'; export function sanitizeHtml(html: string): string { return DOMPurify.sanitize(html, { ALLOWED_TAGS: [...], ALLOWED_ATTR: [...] }) }`。若不能用外部库，至少补 `<img onerror>`、`xlink:href`、`formaction`、CSS `expression` 过滤，并将 `EVENT_HANDLERS` 改为 `[\s/]+on[a-z]+=`。

#### R-C2 `App.tsx` 乐观更新回滚引用 `providersRef`，并发 `onConfigChanged` 时回滚到错误状态
- **位置**: `src/renderer/App.tsx:216-247`（`onSetEnabled`/`onSetKey`/`onSetBinding`/`onSetFallback`）
- **类别**: 状态管理 / 竞态条件
- **问题**: `const prev = providersRef.current` 捕获快照，catch 用 `setProviders(prev)` 回滚。`providersRef.current` 由 `useEffect([providers])` 同步，乐观更新应用后 ref 已更新为乐观值；若期间 `onConfigChanged` 事件到达更新了 providers，ref 被覆盖，catch 回滚到错误状态（丢失 onConfigChanged 的更新）。
- **修改建议**: catch 中用函数式回滚并基于调用前捕获的 `prev`：`catch { setProviders(() => prev) }`，确保回滚到调用前快照而非 ref 当前值。

#### R-C3 `App.tsx` `loadConfig` 重试计数器在 catch 与正常路径重复递增，提前达到上限
- **位置**: `src/renderer/App.tsx:106-146`
- **类别**: 竞态条件 / 逻辑错误
- **问题**: catch 路径 `retryLoadConfig` 内 `configEmptyRetryCount.current += 1`，正常路径（123-144 行）空配置时也 `+= 1`。先走 catch 设 timer，timer 触发再走正常路径又递增，计数器双倍递增，提前达到上限 5 次，正常加载失败。
- **修改建议**: 统一重试逻辑只在一处递增计数器，catch 中只设 error 状态不在 `retryLoadConfig` 递增。

### High

#### R-H1 `App.tsx` `applyProviderConfig` 空数组不更新，删除最后一个 provider 后 UI 不刷新
- **位置**: `src/renderer/App.tsx:60-66`
- **类别**: 状态管理
- **问题**: `setProviders(current => nextProviders.length > 0 ? nextProviders : current)`，主进程返回空数组时不更新 state，UI 永远显示旧 provider 列表。
- **修改建议**: 改为 `setProviders(nextProviders)` 直接赋值，空数组是合法状态。

#### R-H2 `ConfirmDialog` `useEffect` 依赖 `onConfirm`/`onCancel`，每次渲染重绑键盘监听
- **位置**: `src/renderer/glass/ConfirmDialog.tsx:22-40`
- **类别**: React hooks 错误 / 性能
- **问题**: `useEffect` 依赖 `[open, onConfirm, onCancel]`，`useConfirmDialog` 中回调 `useCallback` 依赖 `[state]`，state 变化时回调重建，`ConfirmDialog` 的 effect 重运行，反复 remove/addEventListener 且 `el.focus()` 反复调用，焦点跳动；两次渲染间按键可能因监听器被移除而漏掉。
- **修改建议**: 用 ref 存最新回调，`useEffect` 只依赖 `[open]`：
  ```ts
  const onConfirmRef = useRef(onConfirm)
  useEffect(() => { onConfirmRef.current = onConfirm })
  // effect 中用 onConfirmRef.current()
  ```

#### R-H3 `SddDraftEditor` 自动保存 `useEffect` 依赖 `activeDraft` 对象引用，store 更新时丢失待保存编辑
- **位置**: `src/renderer/sdd/components/SddDraftEditor.tsx:330-346`
- **类别**: React hooks 错误
- **问题**: 依赖 `[activeDraft, content, saveStatus]`，`activeDraft` 是对象引用，store 每次更新（即使内容没变）可能返回新引用，effect 重运行。保存过程中 `saveStatus` dirty→saving，effect 再运行，`saveStatus !== 'dirty'` 提前 return，已有 timer 被清除，丢失一次待保存编辑。
- **修改建议**: 依赖改为 `[activeDraft?.id, content, saveStatus]`，用 id 代替对象引用。

#### R-H4 `SddDraftEditor` `parseRequirementBlocks` 无请求 ID 竞态保护，快速输入时旧结果覆盖新结果
- **位置**: `src/renderer/sdd/components/SddDraftEditor.tsx:349-354`
- **类别**: 竞态条件
- **问题**: 300ms debounce 的 `parseRequirementBlocks` 是异步 IPC，快速连续输入时前一个 IPC Promise 可能后于后一个完成，旧解析结果覆盖新内容结果（后发先至）。内部未检查 content 是否仍匹配。
- **修改建议**: 加请求 ID 竞态保护（参考 `App.tsx` 的 `configRequestId`），IPC 返回后验证 store content 是否仍一致。

#### R-H5 多个 screen 的 `useEffect` 异步 `refresh()` 无 `alive` 守卫，卸载后 setState
- **位置**: `src/renderer/screens/RoutingTab.tsx:31`、`WorkspacesTab.tsx:40`、`McpSettingsTab.tsx:76`、`ApprovalsTab.tsx:37`、`AgentLoopSettingsTab.tsx:86`
- **类别**: 竞态条件 / 内存泄漏
- **问题**: `useEffect` 中调用异步 `refresh()`/`agents.locate()` 无 `alive` 守卫，组件卸载后 setState 在已卸载组件上调用。
- **修改建议**: 每个加 `let alive = true` 守卫，回调中 `if (alive)` 再 setState，cleanup `() => { alive = false }`。

#### R-H6 `McpSettingsTab` `listTools` 竞态，快速切换 server 时旧结果覆盖新结果
- **位置**: `src/renderer/screens/McpSettingsTab.tsx:131-146`
- **类别**: 竞态条件
- **问题**: `listTools` 异步无请求 ID 保护，快速点击 server A 再 server B 的工具列表，A 结果后于 B 返回，`setToolsList` 被设为 A 的工具但 `toolsForServer` 显示 B，UI 不一致。
- **修改建议**: 用 `useRef` 存当前请求 serverId，IPC 返回后验证是否仍匹配 `toolsForServer`。

#### R-H7 `AgentLoopSettingsTab` 引用 `LocalAgentStatus` 不存在的字段
- **位置**: `src/renderer/screens/AgentLoopSettingsTab.tsx:90,117,155-159,372-386`
- **类别**: 空值/类型错误
- **问题**: `agent-slice.ts:18-23` 的 `LocalAgentStatus` 只有 `agentId/configured/path/version`，但组件用 `agent.installed`（90 行）、`agent.label`（155 行）、`agent.protocol`（384 行）、`agent.loginState`（385 行），类型上不存在。运行时这些值必定 undefined：`availableAgents` 过滤 `agent.installed` 永远为空、`loginState` 永远 'unknown'、`protocol` 不显示。注：`shared/ipc-contract.ts` 的 `LocalAgentStatusLike`（1347 行）字段更全，store slice 用了精简类型导致类型与运行时数据不符。
- **修改建议**: 将 `agent-slice.ts` 的 `LocalAgentStatus` 对齐 `LocalAgentStatusLike`（补 `installed/label/protocol/loginState/candidates` 等字段），或确认主进程实际返回后更新类型；组件中 `agent.installed` 若主进程未返回则改为 `agent.configured`。

#### R-H8 `App.tsx` `useEffect [appearance, motion]` 每次 re-subscribe `matchMedia`，事件可能丢失
- **位置**: `src/renderer/App.tsx:92-97`
- **类别**: 内存泄漏 / stale closure
- **问题**: appearance/motion 变化时先移除旧 listener 再加新 listener，移除与添加之间系统主题变化事件丢失；频繁订阅/退订非最佳。
- **修改建议**: 用 ref 存 preferences，`useEffect` 依赖 `[]` 只注册一次 listener，handler 中读 ref 当前值。

#### R-H9 `SddRequirementsList` `autoVerifySeenEventKeysRef` 的 Set 无限增长
- **位置**: `src/renderer/sdd/components/SddRequirementsList.tsx:160`
- **类别**: 内存泄漏
- **问题**: `useRef<Set<string>>(new Set())` 记录已处理 event key，无清理机制，长会话中 Set 持续增长耗内存。
- **修改建议**: draft 切换时清空 `autoVerifySeenEventKeysRef.current`，或限制 Set 大小。

### Medium

#### R-M1 `App.tsx` `onReorderProvidersForClaude` `filter(Boolean) as ProviderDef[]` 绕过类型检查
- **位置**: `src/renderer/App.tsx:259-264`
- **类别**: 空值/类型错误
- **问题**: `orderedIds.map(id => byId.get(id)).filter(Boolean) as ProviderDef[]`，若 `orderedIds` 含不存在的 id，filter 移除后长度不匹配，IPC 失败走 `loadConfig()` 用户看到空白列表。
- **修改建议**: filter 后检查长度：`if (reordered.length !== orderedIds.length) { loadConfig(); return }`。

#### R-M2 `App.tsx` `onDeepLink` handler 未做 `link` 空值守卫
- **位置**: `src/renderer/App.tsx:208-211`
- **类别**: 空值/类型错误
- **问题**: `if (link.action || link.params?.agent)`，若 IPC 传输出错 `link` 为 null/undefined，`link.action` 抛 TypeError。
- **修改建议**: handler 开头加 `if (!link) return`。

#### R-M3 `RequirementsTab` workspaceId 切换时先设 null 再异步设真值，闪烁且竞态
- **位置**: `src/renderer/screens/RequirementsTab.tsx:17-30`
- **类别**: 状态管理 / 竞态条件
- **问题**: workspaceId 变化时先 `setWorkspaceRoot(null)` 再异步设真实值，中间 `SddRequirementsList` 收到 null 显示空列表闪烁；快速切换 workspace 时前一个 IPC 结果可能后于后一个返回，显示错误 workspace 的 rootPath。
- **修改建议**: 加 `alive` 守卫和请求 ID 竞态保护，then 回调验证 workspaceId 是否仍匹配当前 props。

#### R-M4 `ApprovalDialog` `remember` 状态在 items 变化时不重置
- **位置**: `src/renderer/glass/approval-dialog.tsx:36`
- **类别**: 状态管理
- **问题**: 用户勾选 remember 后按 Esc（未 decide），remember 保持 true，下一个 approval item 继承该状态，非用户意图。
- **修改建议**: 加 `useEffect(() => { setRemember(false) }, [items[0]?.id])`。

#### R-M5 `orchestrate-reducer` `subtask` 在 `subtaskId` 为空时每次 push 新 subtask，重复堆积
- **位置**: `src/renderer/glass/orchestrate-reducer.ts:36-40`
- **类别**: reducer 纯函数 / 状态管理
- **问题**: `ev.subtaskId` 为空字符串或 null 时 `String(ev.subtaskId)` 为 `""`/`"null"`，`findIndex` 永不匹配，每次 push 新 subtask，重复堆积。
- **修改建议**: `case 'orchestrate:subtask'` 开头加 `if (!ev.subtaskId) return state`。

#### R-M6 `ShortcutsSettingsTab` `persist` 并发执行可能覆盖
- **位置**: `src/renderer/screens/ShortcutsSettingsTab.tsx:90-112`
- **类别**: 竞态条件
- **问题**: 快速录制多个快捷键时多个 `persist` 并发，`store.set` 异步写入，最终结果取决于 IPC 处理顺序，可能覆盖。
- **修改建议**: 用队列或 ref 锁防止并发 persist。

#### R-M7 `sdd-draft-store` `partialize` 不含 `saveStatus`，重启后未保存更改显示为已保存
- **位置**: `src/renderer/sdd/sdd-draft-store.ts:189-198`
- **类别**: 状态管理
- **问题**: persist 持久化 `activeDraft/content/lastSavedContent` 但不含 `saveStatus`，重启后 `saveStatus` 初始化 'saved'，若 `content !== lastSavedContent`（上次未保存就关闭），应显示 'dirty' 但显示 'saved'，用户不知有未保存更改。
- **修改建议**: `partialize` 加入 `saveStatus`，或 `onRehydrateStorage` 中检查 `content !== lastSavedContent` 设 `saveStatus='dirty'`。

#### R-M8 `SddDraftEditor` `SddHistoryPanel` `useEffect` 依赖 content，每次按键 refresh
- **位置**: `src/renderer/sdd/components/SddDraftEditor.tsx:190-193`
- **类别**: React hooks 错误 / 性能
- **问题**: 依赖 `[draftId, workspaceRoot, content]`，content 每次按键变化，`refresh()`（读 localStorage + 可能触发 IPC）每次按键执行，浪费性能且 `setEntries` 频繁更新引发额外重渲染。
- **修改建议**: 移除 `content` 依赖，只在 draftId/workspaceRoot 变化时 refresh（history 在 saveDraftToDisk 时添加，不是每次按键）。

#### R-M9 `chat-transcript` `visibleSequentialReplies` 遇未完成 reply 即 break，丢弃后续已完成 reply
- **位置**: `src/renderer/glass/chat-transcript.ts:43-50`
- **类别**: 状态管理
- **问题**: 遍历 push 每个 reply，`!reply.done` 即 break，若 replies 顺序非按完成度排列，后续已完成 reply 不显示。
- **修改建议**: 先显示所有 done reply，最后附加第一个未 done reply，或确认 replies 顺序保证。

### Low

#### R-L1 `ExecutionReport` `filesModified` 用 index 作为 key
- **位置**: `src/renderer/glass/ExecutionReport.tsx:125`
- **类别**: 列表 key
- **问题**: `stats.filesModified.map((file, index) => <li key={index}>)`，列表动态变化时 React 可能复用错误 DOM 节点显示错位。
- **修改建议**: 改为 `key={file}` 或 `key={file + index}`。

#### R-L2 `Titlebar` `window.electronAPI?.win` 可能为 undefined，dots 点击静默失败
- **位置**: `src/renderer/glass/Titlebar.tsx:14-18`
- **类别**: 空值/类型错误
- **问题**: 若 win 子对象未暴露，`win?.close()` 静默失败，用户点关闭无反应。
- **修改建议**: dots 定义前加 `if (!win) return null`，或 onClick 加 fallback。

#### R-L3 `SddDraftEditor` textarea 受控无防抖，大文档每次按键触发 store 持久化卡顿
- **位置**: `src/renderer/sdd/components/SddDraftEditor.tsx:472-479`
- **类别**: 表单/输入处理 / 性能
- **问题**: 每次按键更新 zustand store，触发 persist（partialize 含 content）的 localStorage 序列化，大文档输入卡顿。
- **修改建议**: content 持久化做 debounce，或 partialize 排除 content（已有独立 saveDraftToDisk 机制）。

#### R-L4 `App.tsx` `setMotion` 初始值读取 localStorage 未验证合法性
- **位置**: `src/renderer/App.tsx:45-47`
- **类别**: 空值/类型错误
- **问题**: `localStorage.getItem('ah-motion') as MotionLevel`，若值为 `"invalid"`，类型断言不检查，`motion="invalid"`，`applyAppearance` 设 `data-motion="invalid"`，CSS 不匹配导致动画异常。
- **修改建议**: 用 `pick(value.motion, ['off','subtle','rich'], 'rich')` 验证。

#### R-L5 `useResponsiveLayout` 返回对象每次渲染新引用，可能引发不必要 effect
- **位置**: `src/renderer/hooks/useResponsiveLayout.ts:59-71`
- **类别**: 性能
- **问题**: 返回对象每次新建，消费者 `useEffect` 依赖其属性可能不必要重运行。
- **修改建议**: `useMemo` 包裹返回对象，依赖 `[width, height]`。

#### R-L6 `SddTracePanel` `findPlanItemsForBlock` 每次 render O(blocks×planItems) 调用无 memo
- **位置**: `src/renderer/sdd/components/SddTracePanel.tsx:62-73,81-83,106-107`
- **类别**: 性能
- **问题**: 每个 block 遍历 planItems，块/项多时卡顿。
- **修改建议**: `useMemo` 预计算 `Map<string, PlanItem[]>`，trace/blocks 变化时重建。

#### R-L7 `SddAssistantHistory` `persistState` 重新 normalize 可能改变 session id 关联
- **位置**: `src/renderer/sdd/sdd-assistant-history.ts:162-171`
- **类别**: 状态管理
- **问题**: `normalizeState(state)` 重新规范化，若 sessions 有重复 id，去重丢弃后面项，传入 messages 可能关联到错误 session。
- **修改建议**: `persistState` 不重新规范化已规范化 state，直接保存。

#### R-L8 `keyboard-shortcuts` `normalizeKeyboardShortcut` `+` 键 edge case 多
- **位置**: `src/renderer/keyboard-shortcuts.ts:200-214`
- **类别**: 表单/输入处理
- **问题**: `Ctrl++` 等 `+` 键组合 split 产生空串，处理逻辑 edge case 多可能有遗漏。
- **修改建议**: 增加单测覆盖 `+` 键各种组合。

#### R-L9 `budget.ts` `useSyncExternalStore` 缺 `getServerSnapshot`（Electron 无 SSR 影响小）
- **位置**: `src/renderer/glass/budget.ts:43-48`
- **类别**: React hooks
- **问题**: React 18 `useSyncExternalStore` 第三参数 `getServerSnapshot` 缺失，SSR 下 hydration 不匹配。Electron 桌面无 SSR，影响小。
- **修改建议**: 可选补 `getServerSnapshot` 返回默认值。

---

## 四、Workbench 核心 UI 与 Zustand Store

### Critical

#### W-C1 `ComposerBar` 队列消息永久丢失（竞态）
- **位置**: `src/renderer/workbench/ComposerBar.tsx:321-334`
- **类别**: 竞态条件 / React hooks 依赖
- **问题**: 队列处理 effect 依赖 `[sending, queue, onSend]`。effect 运行时第 324 行 `setQueue(prev => prev.slice(1))` 取出第一条，但 `setQueue` 改变了 `queue`（在依赖数组中），触发 effect 重新运行：先执行 cleanup `clearTimeout(timer)`，此时 50ms 定时器（第 328 行）尚未触发，`onSend` 永不执行。effect 重运行时队列已少一条，第一条消息既被移出队列又没发送——永久丢失。
- **后果**: 用户在 sending 期间连续发送多条消息时，队列中的消息会被静默丢弃。
- **修改建议**: 不要在 effect 内直接修改 `queue` 依赖。将 `setQueue` 移到 `setTimeout` 回调内（onSend 之后才出列），并用 ref 跟踪队列避免把 `queue` 放入依赖：
  ```ts
  useEffect(() => {
    if (sending || queue.length === 0) return
    const next = queue[0]
    setText(next.text)
    setAttachments(next.attachments)
    const timer = setTimeout(() => {
      if (next.text.trim()) onSend(next.text.trim(), next.attachments, next.overrides)
      setQueue(prev => prev.slice(1))
    }, 50)
    return () => clearTimeout(timer)
  }, [sending, onSend])  // 移除 queue，用 queueRef 读取
  ```

#### W-C2 `TerminalPanel` 切换标签页时 PTY 进程泄漏
- **位置**: `src/renderer/workbench/TerminalPanel.tsx:258-266`
- **类别**: 内存泄漏 / 子进程泄漏
- **问题**: `activeTabId` 变化时 effect cleanup 调用 `disposeRenderer()`（dispose xterm 实例 + 移除监听器），但**不调用 `terminalPty.dispose(sessionId)`**。PTY 进程在后台继续运行。切回该 tab 时 `attachTerminal` 用相同 sessionId 创建新 PTY 会话，旧进程仍存在。只有 `handleCloseTab`（第 290-292 行）才 dispose PTY。频繁切换 tab 累积僵尸 PTY 进程。
- **修改建议**: 在 effect cleanup 中 dispose 当前 tab 的 PTY。用 ref 保存当前 sessionId（避免用已变更的 activeTabId 计算）：
  ```ts
  const sessionIdRef = useRef<string>('')
  // effect 中：sessionIdRef.current = terminalSessionId(workspaceRoot, activeTabId)
  // cleanup 中：
  //   disposeRenderer()
  //   window.electronAPI?.terminalPty?.dispose?.(sessionIdRef.current)
  ```

### High

#### W-H1 `WorkbenchLayout` 运行时事件订阅在依赖变更时断开重连，丢失事件
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:439-505`
- **类别**: 竞态条件 / React hooks 依赖
- **问题**: 订阅 `runtime.onEvent` 的 effect 依赖 `activeThreadId`、`pendingActiveThreadId`、`workspaceId`、`syncSddPlanTodoForRuntimeEvent` 等频繁变化的值。每次 `activeThreadId` 变化（切换会话）effect 先 `unsubscribe()` 再重订阅，断开与重订阅间隙到达的运行时事件永久丢失。
- **修改建议**: 用 ref 存最新值（`activeThreadIdRef` 等），effect 依赖改为 `[]`，只在 mount/unmount 时订阅/取消订阅，回调内读 ref。

#### W-H2 `SubagentDetailPanel` 用 `event.ts` 而非 `event.createdAt`，历史事件时间戳错误
- **位置**: `src/renderer/workbench/SubagentDetailPanel.tsx:57,61,67,83`
- **类别**: 空值未校验 / 逻辑错误
- **问题**: 全局 `RuntimeEvent` 类型 `createdAt: number` 必选，`ts?: number` 可选别名。组件用 `event.ts || Date.now()`，但 `ts` 多数为 undefined，回退 `Date.now()`。历史事件产生错误的"当前时间"，`summary.durationMs` 持续时间计算完全错误，工具调用时间戳错误。
- **修改建议**: 所有 `event.ts` 改为 `event.createdAt`。

#### W-H3 `FileTreePanel` 在 `setExpanded` updater 内调用副作用
- **位置**: `src/renderer/workbench/FileTreePanel.tsx:129-145`
- **类别**: React hooks 错误 / 副作用
- **问题**: `toggleExpand` 在 `setExpanded(prev => { ... loadDirectory(path) ... })` 的 updater 内调用异步副作用 `loadDirectory`。updater 应为纯函数，Strict Mode 下 React 调用 updater 两次，`loadDirectory` 被重复调用，触发重复 IPC 请求和多余状态更新。
- **修改建议**: 将 `loadDirectory` 移到 updater 外部：先 `setExpanded` 更新集合，再在条件满足时 `loadDirectory(path)`。

#### W-H4 `BrowserPanel` webview 事件监听器可能永远不附加
- **位置**: `src/renderer/workbench/components/panels/BrowserPanel.tsx:46-90`
- **类别**: 竞态条件 / React hooks 依赖
- **问题**: webview 事件监听器 effect 依赖 `session?.id`。`open()` 设置 session 后 React 渲染 `<webview>`，effect 在渲染后运行，但 Electron `<webview>` 有自己的加载生命周期，effect 运行时 `webviewRef.current` 可能为 null（webview 未完全挂载），effect 提前返回不注册监听器。webview 完成挂载时 effect 不重运行（`session?.id` 未变），`did-start-loading` 等事件永远不被监听。
- **修改建议**: 加 state 追踪 webview 挂载状态（ref 回调中设置），依赖包含挂载状态；或用 `requestAnimationFrame` 延迟确保 webview 就绪。

### Medium

#### W-M1 `WorkbenchLayout` `props.providerActions` 内联对象每次渲染变化，触发无谓 effect
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:564-568`
- **类别**: React hooks 依赖 / 性能
- **问题**: effect 依赖 `[props.providers.length, props.providerActions]`，`providerActions` 是内联对象每次新建，effect 每次父组件渲染都重执行。
- **修改建议**: 依赖改为 `[props.providers.length, props.providerActions.onReload]`，或父组件用 `useMemo`/`useRef` 稳定引用。

#### W-M2 `GitWorkbenchPanel` `workingDiffCache` 无大小限制
- **位置**: `src/renderer/workbench/GitWorkbenchPanel.tsx:23,132-145`
- **类别**: 内存泄漏
- **问题**: `workingDiffCache` 无最大条目限制或 LRU 淘汰，大仓库逐个点击大量文件后缓存无限增长（`refresh()` 会清空但用户可能不刷新）。
- **修改建议**: 加最大条目限制（如 50），超限淘汰最早条目；或切换文件时清理未选中文件缓存。

#### W-M3 `WorkbenchLayout` `selectThread` 未捕获异常，unhandled rejection
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:671-728`
- **类别**: 错误处理
- **问题**: `selectThread` 是 async 函数，内部多个 `electronAPI.*` 异步操作无 try/catch（只有 finally）。若 `threads.select` 等调用 reject，异常传播到调用方（`sendPrompt` 第 931 行也无 catch），产生 unhandled rejection，UI 卡在"切换中"状态且无错误提示。
- **修改建议**: 主体外层加 try/catch，catch 中 `setSendError` 或 console.error。

#### W-M4 `useScrollBehavior` 滚动 effect 无依赖数组，每次渲染执行
- **位置**: `src/renderer/workbench/hooks/useScrollBehavior.ts:18-24`
- **类别**: React hooks 依赖 / 性能
- **问题**: `useEffect` 无依赖数组每次渲染执行。`shouldStickToBottom.current` 为 true 时每次渲染都 `scrollTop = scrollHeight`，阻止用户向上滚动查看历史。
- **修改建议**: 加依赖数组 `[selectedThreadId]`，或改为依赖 turns.length/events.length 只在内容变化时触发。

#### W-M4b `ComposerBar` `ContextCapacityIndicator` 每次输入字符都同步重算并 setState
- **位置**: `src/renderer/workbench/ComposerBar.tsx:1107-1121`
- **类别**: 性能 / React hooks
- **问题**: effect 依赖 `[text, attachments, modelSelection, providers]`，每次输入字符触发 `setCapacity`，子组件重渲染，大文本输入时频繁 setState。
- **修改建议**: 用 `useMemo` 替代 effect 计算，或对 text 做 debounce。

#### W-M5 `TerminalPanel` `handleNewTab` 的 `tab.index` 可能重复
- **位置**: `src/renderer/workbench/TerminalPanel.tsx:279-288`
- **类别**: 逻辑错误
- **问题**: `nextIndex = tabs.length + 1`，关闭中间 tab 后 `tabs.length` 减小，新建 tab index 可能与已有 tab 重复，标题显示混乱（两个 "Terminal 3"）。
- **修改建议**: `const nextIndex = Math.max(...tabs.map(t => t.index), 0) + 1`。

#### W-M6 `GitBranchControl` `status.files.length` 在 files 为 undefined 时崩溃
- **位置**: `src/renderer/workbench/GitBranchControl.tsx:95`
- **类别**: 空值未校验
- **问题**: 若 `status` 已加载但 `files` 为 undefined（API 返回不完整），第 95 行 `status.files.length` 抛 TypeError。
- **修改建议**: `const dirty = (status?.files?.length ?? 0) > 0`。

#### W-M6b `BrowserPanel` `capture` 函数缺少错误处理
- **位置**: `src/renderer/workbench/components/panels/BrowserPanel.tsx:92-106`
- **类别**: 错误处理
- **问题**: `capture` 调用 `webview.executeJavaScript(...)` 和 `browser.capture(result)` 均无 try/catch。webview 未就绪、CSP 限制或 executeJavaScript 异常时产生 unhandled rejection。
- **修改建议**: 用 try/catch 包裹函数体，catch 中 `setLoadError`。

#### W-M7 `RunTimeline` `DagScheduleEditor` 拖拽节点每次 pointermove 都 patchGraph
- **位置**: `src/renderer/workbench/RunTimeline.tsx:337-346`
- **类别**: 性能
- **问题**: 每次 `pointermove` 调用 `patchGraph` 触发 `updateGraph` → `validateScheduleGraph`（含环检测）→ `setSchedule` 完整链路，大图拖拽卡顿。
- **修改建议**: 拖拽中只更新本地 layout state，`onNodePointerUp` 时一次性提交 `setSchedule`。

#### W-M8 `WorkbenchLayout` `dispatchThreadTodo` 依赖未 memoized 的 `sendPrompt`
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:899-941,943-982`
- **类别**: 性能 / React hooks 依赖
- **问题**: `sendPrompt` 是普通 async 函数每次渲染新建引用，`dispatchThreadTodo`（useCallback 依赖 `sendPrompt`）也每次新引用，接收该 prop 的子组件不必要重渲染。
- **修改建议**: `sendPrompt` 用 `useCallback` 包裹，或 `dispatchThreadTodo` 对 `sendPrompt` 改用 ref。

#### W-M9 `workbench-store` 双重持久化 `selectedThreadId`（zustand persist + localStorage）
- **位置**: `src/renderer/src/store/workbench-store.ts:69-80` 与 `src/renderer/workbench/WorkbenchLayout.tsx:62,164-167`
- **类别**: 状态耦合 / 逻辑错误
- **问题**: zustand persist `partialize` 持久化 `selectedThreadId`，同时 WorkbenchLayout 独立 `localStorage.setItem(LAST_THREAD_STORE_KEY, threadId)`。两个持久化源可能不一致，重启后恢复到错误会话。
- **修改建议**: 统一一个持久化源，从 `partialize` 移除 `selectedThreadId` 只用 localStorage，或反过来。

#### W-M10 `useScheduleManager` hook 已定义未使用，与 WorkbenchLayout 重复逻辑可能不一致
- **位置**: `src/renderer/workbench/hooks/useScheduleManager.ts`
- **类别**: 死代码 / 逻辑重复
- **问题**: hook 封装 customSchedule/smartSchedule/scheduleOverrides 加载持久化，但无组件导入。`WorkbenchLayout.tsx:124-206` 有独立相同逻辑。若未来有组件用该 hook，与 WorkbenchLayout 状态互不同步。
- **修改建议**: 移除未使用 hook，或让 WorkbenchLayout 改用该 hook 消除重复。

### Low

#### W-L1 `markdown-renderer` 表格分隔线要求至少 3 个短横线，不符标准 Markdown
- **位置**: `src/renderer/workbench/markdown-renderer.ts:123`
- **类别**: 逻辑错误
- **问题**: `:?-{3,}:?` 要求每列至少 3 个 `-`，标准 Markdown 只要求 1 个。`| - | - |` 不被识别为表格，渲染为段落。
- **修改建议**: `-{3,}` 改为 `-{1,}`。

#### W-L2 `ContextLedger`/`ForkButton`/`InlineEditAffordance`/`PromptEnhancer` 定义本地 tr，未复用全局 i18n
- **位置**: `src/renderer/workbench/ContextLedger.tsx:28-31`、`ForkButton.tsx:19-22`、`InlineEditAffordance.tsx:24-27`、`PromptEnhancer.tsx:13-16`
- **类别**: i18n 一致性
- **问题**: 本地 `tr` 基于 `navigator.language`，不支持运行时语言切换（只在首次调用读取），与全局 i18n 脱节。
- **修改建议**: 改为 `import { tr } from '../glass/i18n'`。

#### W-L3 `WorkbenchLayout` 用 `JSON.stringify` 做深度比较
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:587`
- **类别**: 性能 / 逻辑错误
- **问题**: `JSON.stringify(next) === JSON.stringify(smartSchedule)` 对大 schedule 较慢，且 `JSON.stringify` 忽略 undefined 可能导致不同对象判相等。
- **修改建议**: 用 deepEqual 工具函数，或比较关键字段签名。

#### W-L4 `SessionSidebar` `relativeTime` 不随时间更新
- **位置**: `src/renderer/workbench/SessionSidebar.tsx:480-486`
- **类别**: 逻辑错误 / UI
- **问题**: `relativeTime` 每次渲染用 `Date.now() - ts` 计算，但无定时器触发重渲染，"5分钟前"不会随时间自动更新，仅其他状态变化引起重渲染时刷新。
- **修改建议**: 加低频定时器（60 秒）触发重渲染。

#### W-L5 `ComposerBar` budget estimate effect 无 alive 守卫
- **位置**: `src/renderer/workbench/ComposerBar.tsx:192-216`
- **类别**: 竞态条件 / 内存泄漏
- **问题**: 450ms debounce effect 无 `alive` flag，组件卸载后 `setBudgetEstimate`/`setBudgetEstimateLoading` 在卸载后 setState。
- **修改建议**: effect 加 `let alive = true`，cleanup 设 false，所有 `.then/.catch/.finally` 回调检查 `alive`。

#### W-L6 `GitWorkbenchPanel` 从 commit diff 切回 working diff 可能显示空白
- **位置**: `src/renderer/workbench/GitWorkbenchPanel.tsx:50-52`
- **类别**: 逻辑错误
- **问题**: `setDiffMode('working')` 时 `selectedPath` 可能仍指向只在 commit 中存在的文件，该文件无 working diff 缓存，显示空白。
- **修改建议**: 切到 working 时检查 `selectedPath` 是否在当前工作区文件列表，不在则重置为第一个工作区文件。

#### W-L7 `terminalRunWatcher` history 为空时提前 break，终端状态不更新
- **位置**: `src/renderer/workbench/utils/terminalRunWatcher.ts:11-15`
- **类别**: 错误处理
- **问题**: IPC 临时抖动返回空数组时 `current` 为 undefined，第 15 行 `if (!current) break` 提前退出，终端状态永远不更新。
- **修改建议**: 区分"history 为空"和"runId 不在 history"，空 history 时重试而非立即 break。

---

## 五、配置层 / 构建脚本 / 菜单

### Medium

#### C-M1 `menu.ts` releases URL 拼写错误（死链）
- **位置**: `src/main/menu.ts:41`
- **类别**: 逻辑错误 / 拼写
- **问题**: `"https://github.com/XiYue-FireFly/AgengHub/releases"` 中 `AgengHub` 应为 `AgentHub`，点击"Open releases"打开 404 死链。
- **修改建议**: 改为 `"https://github.com/XiYue-FireFly/AgentHub/releases"`。

### Low

#### C-L1 `tsconfig.web.json` include 重复列举 locales JSON
- **位置**: `tsconfig.web.json:22`
- **类别**: 配置冗余
- **问题**: include 已有 `src/renderer/**/*`（覆盖 locales 目录），又单独列举 `src/renderer/locales/zh-CN.json` 和 `en-US.json`，冗余无实际影响。
- **修改建议**: 删除重复的两条 JSON 路径（非必须，仅清理）。

---

## 汇总统计

| 严重程度 | 主进程/IPC/安全 | 适配器/Hub/缓存/内存/SDD | 渲染进程(screens/glass/sdd) | Workbench/Store | 配置/构建/菜单 | 合计 |
|---------|---|---|---|---|---|---|
| Critical | 6 | 4 | 3 | 2 | 0 | 15 |
| High | 6 | 5 | 9 | 4 | 0 | 24 |
| Medium | 8 | 7 | 9 | 12 | 1 | 37 |
| Low | 6 | 6 | 9 | 7 | 1 | 29 |
| **合计** | **26** | **22** | **30** | **25** | **2** | **105** |

> **最紧急修复项（安全类）**：M-C1 ～ M-C6（IPC 路径校验缺失 + 明文 API key 备份）、R-C1（sanitize XSS 过滤不完整）。
> **最紧急修复项（功能类）**：
> - W-C1（ComposerBar 队列消息永久丢失）
> - W-C2（TerminalPanel 切 tab 泄漏 PTY 进程）
> - H-C1（system-tools hostname 是 Promise 显示为 `{}`）
> - H-C2（safeDelete 异步删除返回假成功）
> - H-C4（agentLoop 永久污染，auto 模式用 single 实例）
> - M-M4（github 用 `gh git` 死命令，分支名永远空）
> - R-H7（LocalAgentStatus 类型不匹配，Agent 列表永远空）
> - H-C3（TtlLruCache.cleanup 过期条目残留）
> - W-H2（SubagentDetailPanel 用 `event.ts` 致耗时计算全错）

> 说明：本清单已去重（如 workbench 报告的 sanitize/markdown-renderer XSS 项与 R-C1 重叠，已合并；Agent 误报的 `workspaceFiles:write` mkdir 边界问题已剔除）。所有 bug 均经人工读源码复核行号与逻辑。部分"设计权衡"类问题（如 dispatcher quietDone 45 秒超时、aggregator 置信度算法）已降级为 Medium/Low 观察项。


