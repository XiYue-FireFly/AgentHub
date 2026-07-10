# AgentHub-v123 Grok 轮 Bug 清单

> 分支：grok | 日期：2026-07-09 | 基于 HEAD：`84a7b39`
> 说明：本清单只列 **本轮需处理** 的回归/不完整修复/新发现 bug；不重复抄录已 PASS 的 105 条。
> 相关历史清单：`BUG_REPORT.md`（只读）
> 说明：不涉及代码文件拆分建议。

## 再核验摘要

| 历史105 | PASS | INCOMPLETE | REGRESSION | 本轮新发现 MUST_FIX |
|---------|------|------------|------------|---------------------|
| 105     | ~103 | 0          | 0          | 见下表 |

---

## 一、主进程 / IPC / 安全

### Critical

#### G-MC1 `mcp/system-tools` 路径解析允许绝对路径与 `..` 逃逸工作区
- **位置**: `src/main/mcp/system-tools.ts:159-162`（`resolvePath`），调用点 `:432-480`（fs_read/write/list/delete/move/copy/shell_exec）
- **类别**: 路径穿越 / 安全
- **Related**: NEW（历史 M-C* 未覆盖 MCP system tools）
- **问题**: `resolvePath` 对绝对路径直接 `resolve(pathStr)`，相对路径也不做 `isPathInsideBase` 校验。`executeSystemTool('fs_read', { path: 'C:/Users/.../.ssh/id_rsa' }, ctx)` 或 `../` 可读写工作区外文件。对比 `agentic/tools.ts` 与 `acp-client.ts` 均有 workspace 约束。
- **后果**: 通过 MCP 系统工具的 Agent/调用方可读取或写入任意本机路径（含敏感文件），严重信息泄露与篡改。
- **修改建议（最小）**:
  ```ts
  import { isPathInsideBase } from '../ipc/path-guards'
  function resolvePath(pathStr: string, cwd: string): string | null {
    if (!pathStr || typeof pathStr !== 'string') return null
    const resolved = isAbsolute(pathStr) ? resolve(pathStr) : resolve(cwd, pathStr)
    if (!isPathInsideBase(resolved, cwd)) return null
    return resolved
  }
  // 各 case 在 null 时返回 { ok:false, error:'path escapes workspace' }
  ```
- **测试建议**: `src/main/mcp/__tests__/system-tools.test.ts` 增加拒绝绝对路径、`..` 逃逸、允许 cwd 内相对路径。
- **本轮**: MUST_FIX

#### G-MC2 `terminal:create` 未校验 `cwd`，可在任意目录 spawn shell
- **位置**: `src/main/ipc/terminal-pty-ipc.ts:88-112`
- **类别**: 路径穿越 / 安全
- **Related**: NEW
- **问题**: `cwd` 直接来自渲染进程 payload，仅 `cwd || process.cwd()`，无 `resolveRegisteredWorkspaceRoot` / `isPathInsideBase`。
- **后果**: 被入侵的渲染进程可在用户主目录、系统目录等处启动持久 PTY，扩大攻击面。
- **修改建议（最小）**:
  ```ts
  import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
  import { isPathInsideBase } from './path-guards'
  // create 时：
  const requested = cwd || process.cwd()
  const registered = resolveRegisteredWorkspaceRoot(requested)
    || (/* fallback: allow if inside any registered root via isPathInsideBase */)
  if (!safeCwd) return { ok: false, message: 'cwd must be within a registered workspace' }
  // spawn 使用 safeCwd
  ```
  若当前无活跃注册根，可限制为 `app.getPath('home')` 子路径或拒绝。
- **测试建议**: 新增 `terminal-pty-ipc` 路径校验单测（mock node-pty）。
- **本轮**: MUST_FIX

### High

#### G-MH1 GitHub 集成 `git`/`gh` 未绑定工作区 cwd
- **位置**: `src/main/runtime/github-integration.ts:90-126`；IPC `src/main/ipc/workflow-ipc.ts:123-126`
- **类别**: 逻辑错误 / 多工作区
- **Related**: M-M4（部分；已修 gh git 子命令，但 cwd 仍缺）
- **问题**: `execFile('git', ...)` 与 `execGh` 均未传 `cwd`，使用 Electron 主进程 `process.cwd()`（通常是安装/应用目录），不是用户当前项目根。
- **后果**: `github:currentBranchPr` / listPrs / listIssues 在非「主进程 cwd 恰好是仓库」时返回空/错误，功能失效。
- **修改建议（最小）**:
  - 给 `listPullRequests`/`listIssues`/`getCurrentBranchPr`/`execGh` 增加可选 `cwd?: string`
  - IPC 增加可选 `workspaceRoot`，经 `resolveRegisteredWorkspaceRoot` 后传入
  - 保持无参调用兼容（cwd 默认 undefined → 现行为）
- **测试建议**: 扩展 `github-integration.test.ts` 断言 `execFile` options 含 cwd。
- **本轮**: MUST_FIX

#### G-MH2 `AppStore.save` 异步写入无串行锁，可能并发写坏 config
- **位置**: `src/main/store.ts:87-115`
- **类别**: 竞态 / 数据完整性
- **Related**: M-H2（INCOMPLETE 深度）
- **问题**: `setTimeout` 回调为 async；若写入进行中又触发 `set`→新 timer，或 `flush` 与进行中的 save 重叠，两个 `writeFile(tmp)+rename` 交错，可能丢失后写数据或 rename 竞态。
- **后果**: 配置偶发丢失或损坏。
- **修改建议（最小）**: 增加 `saveChain: Promise<void>`，每次 save/flush 串到链上；flush 时 clearTimer 并 await 链尾。
- **测试建议**: 扩展 `store-local-token.test.ts` 或新测：连续 set + flush 最终文件含最后写入。
- **本轮**: MUST_FIX

### Medium

#### G-MM1 `app:openExternal` 仅用 `startsWith` 校验 scheme，弱于 `safeBrowserUrl`
- **位置**: `src/main/ipc/missing-ipc.ts:127-132`
- **类别**: 安全加固
- **Related**: NEW
- **问题**: 接受任意 `http:`/`https:`/`mailto:` 前缀字符串，不解析 URL。`webview-guards.safeBrowserUrl` 已用 `URL` 解析。
- **后果**: 畸形 URL 可能被 shell 打开（取决于 OS/Electron 行为）。
- **修改建议**: 复用 `safeBrowserUrl`，mailto 单独 `URL` 解析 protocol。
- **测试建议**: 已有 `missing-ipc-app-path.test.ts` 扩展畸形 URL 拒绝。
- **本轮**: MUST_FIX

#### G-MM2 `sanitizeHtml` CSS 嵌套括号层数有限
- **位置**: `src/renderer/lib/sanitize.ts:10`
- **类别**: XSS 边界
- **Related**: R-C1 残差观察
- **问题**: `CSS_PAYLOAD_DANGER` 仅匹配一层嵌套括号，更深 `url(a(b(c)))` 可能残留危险 payload。
- **修改建议**: 对 style 属性内容循环剥离直到稳定，或匹配后整段 style 置空（更严）。
- **测试建议**: sanitize.test.ts 增加 2+ 层嵌套用例。
- **本轮**: MUST_FIX

### Low

#### G-ML1 `package.json` bugs/repository URL 仓库名拼写错误 `AgengHub`
- **位置**: `package.json:243-248`
- **类别**: 配置错误
- **Related**: 与 C-M1 同类拼写问题残留在 package 元数据
- **问题**: `"bugs": ".../AgengHub/issues"`、repository url 同拼写错误（正确应为 AgentHub）。
- **修改建议**: 改为 `AgentHub`。
- **本轮**: MUST_FIX

#### G-ML2 README 系统要求 Node 18+ 与 engines `>=24` 不一致
- **位置**: `README.md:20` vs `package.json:11-13`
- **类别**: 文档漂移
- **修改建议**: README 改为 Node.js 24+ / npm 11+。
- **本轮**: MUST_FIX

---

## 二、Hub / 适配器 / 缓存 / 内存 / SDD / Loop

本轮扫描未发现必须修复的新 Critical；历史项 PASS。观察项见附录。

---

## 三、渲染进程

见 G-MM2（sanitize）。其余历史 R-* 再核验 PASS。

---

## 四、Workbench / Store

观察项：ComposerBar 队列 effect 去掉 `queue` 依赖依赖 `sending` 翻转推进，当前与 onSend 联动可工作；若未来 onSend 不切换 sending，可能卡住——记录为观察，不本轮改。

---

## 五、配置 / 构建 / 测试

#### G-XM1 `passthrough-ipc-knowledge.test.ts` 全量套件 flaky 超时
- **位置**: `src/main/ipc/__tests__/passthrough-ipc-knowledge.test.ts:68`
- **类别**: 测试基建
- **问题**: 全量运行时 `vi.resetModules` + 动态 import `passthrough-ipc`（重依赖树）偶发超 15s。
- **修改建议**: 将该 it 超时提至 30000，或 beforeAll 一次 setup 复用 handlers，减少重复 import。
- **本轮**: MUST_FIX

---

## 汇总统计

| 严重度 | 数量 | MUST_FIX |
|--------|------|----------|
| Critical | 2 | 2 |
| High | 2 | 2 |
| Medium | 2 | 2 |
| Low | 2 | 2 |
| 测试 | 1 | 1 |
| **合计** | **9** | **9** |

### 修复顺序

1. G-MC1 system-tools 路径逃逸  
2. G-MC2 terminal cwd  
3. G-MH1 github cwd  
4. G-MH2 store 串行写  
5. G-MM1 openExternal  
6. G-MM2 sanitize 深层 CSS  
7. G-XM1 flaky test  
8. G-ML1 package.json typo  
9. G-ML2 README engines  

---

## 观察项（本轮不修）

- ComposerBar queue 与 sending 耦合假设
- agentic/tools 同步 fs（工具执行路径，可接受）
- 历史 105 条 PASS 项不再重开
