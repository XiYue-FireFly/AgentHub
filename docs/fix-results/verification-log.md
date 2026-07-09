# AgentHub-v123 Bug 修复重新核验日志

> 创建时间：2026-07-09
> 分支：glm
> 任务：按 BUG_REPORT.md 全量重新核验 105 个 bug 的修复正确性，发现未正确修复的进行最小范围修复，每完成一个任务用本文档记录，并由子代理复核。

## 核验方法论

1. 直接阅读当前源码（不信报告），逐条比对 BUG_REPORT.md 的位置、问题、修改建议。
2. 判定结果：
   - ✅ **已正确修复** — 当前代码与修改建议一致且逻辑正确
   - ⚠️ **部分修复/有问题** — 修复存在缺陷需补充
   - ❌ **未修复** — 代码仍为原始 bug 状态
   - 🔧 **已重新修复** — 核验发现问题后已最小范围修复
3. 每个分类由独立子代理核验，核验结果汇总到本文件。
4. 子代理复核：修复后由 code-reviewer 子代理对修改进行符合性审查。

---

## 核验进度总览

| 分类 | 总数 | 已正确修复 | 已重新修复 | 待修复 |
|------|------|-----------|-----------|--------|
| 一、主进程/IPC/安全 | 26 | 24 | 2 | 0 |
| 二、适配器/Hub/缓存/内存/SDD | 22 | 20 | 2 | 0 |
| 三、渲染进程 screens/glass/sdd | 30 | 27 | 3 | 0 |
| 四、Workbench/Store | 25 | 14 | 11 | 0 |
| 五、配置/构建/菜单 | 2 | 2 | 0 | 0 |
| **合计** | **105** | **87** | **18** | **0** |

**核验状态**: 全部 105 个 bug 已核验完成。87 个核验时即正确修复；18 个核验发现问题后已最小范围重新修复。最终 tsc 通过，1460 个测试全通过（含本次新增 3 个边界测试）。

**符合性审查**: 由 code-reviewer 子代理（ad1b8cb79d8beba16）对 18 处重新修复逐条审查，结果 17 处 ✅符合、1 处 ⚠️有问题（R-L6 引入 React Hooks 规则违反）。R-L6 已即时修正（hooks 调用顺序问题），并补充 3 个边界测试（H-M6 缺失 exit_code、M-H1 文件不存在、R-C1 嵌套括号）。最终复审通过。

**核验纠正说明**（子代理误报，经亲自复核源码纠正）:
- M-M8: 子代理判部分修复（handler 无校验），实际校验在 typed-ipc 层（validateMemoryEntryPatch），已正确修复。
- C-L1: 子代理判未修复（建议删冗余路径），实际删除会破坏 composite+declaration 构建的 TS6307，路径必需，维持原状即正确。

---

## 一、主进程/IPC/安全层（26 个 bug）— 核验完成

**核验子代理**: code-reviewer agent a29a53e76c7be6f8a
**核验方式**: 直接读取当前源码逐条比对 BUG_REPORT.md

### 核验汇总

| 等级 | 总数 | ✅已正确修复 | ⚠️部分修复 | ❌未修复 |
|------|------|------------|-----------|---------|
| Critical | 6 | 6 | 0 | 0 |
| High | 6 | 5 | 1 | 0 |
| Medium | 8 | 7 | 1 | 0 |
| Low | 6 | 5 | 1 | 0 |
| **合计** | **26** | **23** | **3** | **0** |

### ✅ 已正确修复（23 个）
M-C1, M-C2, M-C3, M-C4, M-C5, M-C6（安全类 Critical 全部正确）, M-H2, M-H3, M-H4, M-H5, M-H6, M-M1, M-M2, M-M3, M-M4, M-M5, M-M6, M-M7, M-L1, M-L3, M-L4, M-L5, M-L6

### ⚠️ 部分修复 — 处理结果（3 项，已亲自复核源码确认）

#### M-H1 — listWorkspaceFiles/searchWorkspaceFiles 仍用同步 fs → 🔧已重新修复
- **位置**: `src/main/runtime/workspace-files.ts:40-78`
- **缺陷**: `app:readTextFile` 与 `readFilePreview` 已改异步，但 `listWorkspaceFiles` 仍用同步 `existsSync/statSync/readdirSync`，经 `workspaceFiles:list`/`workspaceFiles:search` IPC 调用，大目录阻塞主进程。
- **修复**: 将 `listWorkspaceFiles`/`searchWorkspaceFiles` 改为 async，用 `fs.promises`；`readFilePreview` 移除残留 `existsSync`（catch 统一返回 'File not found'）；删除同步 import；`workspace-ipc.ts` 的 `workspaceFiles:list`/`workspaceFiles:search` handler 改 async+await；测试同步更新（workspace-files.test.ts、workspace-ipc.test.ts）。
- **验证**: tsc 通过；4 个测试文件 22 个用例全通过。

#### M-M8 — memory:updateEntry 校验 → ✅已正确修复（核验纠正）
- **位置**: `src/main/ipc/memory-ipc.ts:32`
- **核验纠正**: 子代理标记为部分修复（handler 内无校验），但深入核查发现校验由 `typed-ipc.ts` 层统一完成：`memory:updateEntry` 在 `src/shared/ipc-contract.ts:6577-6579` 注册了 `validateMemoryEntryPatch`（`validateRecord` 确保 patch 是对象 + `validateMemoryEntryRecord` 校验字段类型），`memory-ipc-validation.test.ts:119-121` 已验证 patch.confidence 越界会被拒。因此 IPC 层确已做基本结构校验，符合 BUG_REPORT"IPC 层做基本结构校验"建议。无需额外修复。
- **状态**: ✅已正确修复（校验在 typed-ipc 层，非 handler 内）

#### M-L2 — turns:retry 的 setTimeout 未清理 → 🔧已重新修复
- **位置**: `src/main/index.ts:838-848`
- **缺陷**: `turns:create`（:602-609）已用 `timeoutId`+`.finally(clearTimeout)` 修复，但 `turns:retry` 同一模式未同步修复，timer 仍泄漏 15 秒。
- **修复**: 照搬 turns:create 的 clearTimeout 模式：`retryTimeoutId` 变量 + `.finally(() => { if (retryTimeoutId) clearTimeout(retryTimeoutId) })`。
- **验证**: tsc 通过。

### 类别一结论
- ✅已正确修复: 24（含纠正后的 M-M8）
- 🔧已重新修复: 2（M-H1、M-L2）
- 剩余未修复: 0

---

## 五、配置层 / 构建脚本 / 菜单（2 个 bug）— 核验完成

**核验子代理**: code-reviewer agent a6dd3efeed63621a4
**核验方式**: 直接读取当前源码 + tsc 验证

### 核验结果

#### C-M1 — menu.ts releases URL 拼写错误 → ✅已正确修复
- **位置**: `src/main/menu.ts:41`
- **证据**: `click: () => void shell.openExternal("https://github.com/XiYue-FireFly/AgentHub/releases")` — URL 拼写为 `AgentHub`（正确），不再是 `AgengHub` 死链。

#### C-L1 — tsconfig.web.json include 重复列举 locales JSON → ✅已正确修复（核验纠正）
- **位置**: `tsconfig.web.json:22`
- **核验纠正**: 子代理标记为未修复（建议删除重复的 zh-CN.json/en-US.json 路径）。但实际尝试删除后 `tsc -b --noEmit` 报错：
  ```
  src/renderer/locales/index.ts(8,18): error TS6307: File '.../zh-CN.json' is not listed within the file list of project 'tsconfig.web.json'.
  src/renderer/locales/index.ts(9,18): error TS6307: File '.../en-US.json' is not listed within the file list of project 'tsconfig.web.json'.
  ```
  原因：`tsconfig.web.json` 设 `composite: true` + `declaration: true` + `resolveJsonModule: true`，复合项目下 `src/renderer/**/*` glob 不会把 `.json` 文件纳入 declaration 生成的 file list，`src/renderer/locales/index.ts` import 这些 JSON 时必须显式列举，否则 TS6307 报错。因此这两条路径**并非冗余，而是必需**，删除会破坏构建。BUG_REPORT 也标注"非必须，仅清理"，但经实测删除不可行。
- **结论**: 维持原状，✅已正确修复（无需改动）。

### 类别五结论
- ✅已正确修复: 2
- 待修复: 0

---

## 二、Agent 适配器 / Hub 编排 / 缓存 / 内存 / SDD（22 个 bug）— 核验完成

**核验子代理**: code-reviewer agent ad156a43015531be9（已亲自复核所有 ⚠️ 项源码）

### 核验汇总

| 等级 | 总数 | ✅已正确修复 | ⚠️部分修复 | ❌未修复 |
|------|------|------------|-----------|---------|
| Critical | 4 | 4 | 0 | 0 |
| High | 5 | 4 | 1 | 0 |
| Medium | 7 | 6 | 1 | 0 |
| Low | 6 | 6 | 0 | 0 |
| **合计** | **22** | **20** | **2** | **0** |

### ✅ 已正确修复（20 个）
H-C1, H-C2, H-C3, H-C4, H-H1, H-H2, H-H4, H-H5, H-M1, H-M2, H-M3, H-M4, H-M5, H-M7, H-L1, H-L2, H-L3, H-L4, H-L5, H-L6

### 🔧 已重新修复（2 项）

#### H-H3 — ClaudeAdapter 注释误导 → 🔧已重新修复
- **位置**: `src/main/hub/adapters/claude.ts:12-13`
- **缺陷**: 代码保留 `acceptEdits`（合理安全选择），但注释仍声称 acceptEdits"自动接受文件编辑、运行命令（Bash）"，与实际行为不符（acceptEdits 不自动接受 Bash，非交互管道下会挂起）。
- **修复**: 修正注释为"自动接受文件编辑；Bash 等其它操作仍需确认（非交互管道下可能挂起，需全开可改用 bypassPermissions）"。
- **验证**: tsc 通过。

#### H-M6 — codex exit_code 缺省仍映射为 done → 🔧已重新修复
- **位置**: `src/main/hub/adapters/codex-stream-json.ts:109-113`
- **缺陷**: 默认值已改 undefined（好），但状态判断 `exitCode === undefined ? 'done'` 仍把"无 exit_code"映射为成功，命令失败仍显示绿色完成。
- **修复**: 状态判断改为 `exitCode === 0 ? 'done' : 'error'`——只有 exit_code===0 才标 done，缺失/非零均标 error，避免掩盖失败。
- **验证**: codex-stream-json.test.ts 12 个用例全通过（已有测试仅覆盖 exit_code 0/1，无缺失 exit_code 测试）。

### 类别二结论
- ✅已正确修复: 20
- 🔧已重新修复: 2（H-H3、H-M6）
- 待修复: 0

---

## 三、渲染进程 screens / glass / sdd（30 个 bug）— 核验完成

**核验子代理**: code-reviewer agent a6c184c29891c73cb（已亲自复核所有 ⚠️ 项源码）

### 核验汇总

| 等级 | 总数 | ✅已正确修复 | ⚠️部分修复 | ❌未修复 |
|------|------|------------|-----------|---------|
| Critical | 3 | 2 | 1 | 0 |
| High | 9 | 8 | 1 | 0 |
| Medium | 9 | 9 | 0 | 0 |
| Low | 9 | 8 | 1 | 0 |
| **合计** | **30** | **27** | **3** | **0** |

### ✅ 已正确修复（27 个）
R-C2, R-C3, R-H1, R-H2, R-H3, R-H4, R-H6, R-H7, R-H8, R-H9, R-M1, R-M2, R-M3, R-M4, R-M5, R-M6, R-M7, R-M8, R-M9, R-L1, R-L2, R-L3, R-L4, R-L5, R-L7, R-L8, R-L9

### 🔧 已重新修复（3 项）

#### R-C1 — sanitize.ts CSS expression 过滤缺失 → 🔧已重新修复
- **位置**: `src/renderer/lib/sanitize.ts`
- **缺陷**: EVENT_HANDLERS 斜杠分隔、JS_PROTOCOL 的 formaction/xlink:href、SVG_EVENTS 均已补，但 CSS `expression()`/`@import`/`url(javascript:)` 过滤未实现，内联 `style="width:expression(alert(1))"` 可残留。
- **修复**: 新增 `CSS_DANGER`（匹配 style 属性）+ `CSS_PAYLOAD_DANGER`（匹配 `expression(...)`/`url(...)` 含嵌套括号 + `@import`），neutralizeStyleAttr 保留 style 属性但剥离危险 CSS 载荷（保留良性样式）。
- **验证**: sanitize.test.ts 12 个用例全通过（含新增 4 个 CSS 测试：expression、@import、url(javascript:)、safe style 保留）。

#### R-H5 — WorkspacesTab 缺 alive 守卫 → 🔧已重新修复
- **位置**: `src/renderer/screens/WorkspacesTab.tsx:40`
- **缺陷**: 其余 4 个 screen（RoutingTab/McpSettingsTab/ApprovalsTab/AgentLoopSettingsTab）均加 alive 守卫，唯独 WorkspacesTab 的 `useEffect(() => { refresh().catch(...) }, [refresh])` 无守卫。
- **修复**: 照搬同级的 alive 模式：`let alive = true` + `.catch` 内 `if (alive)` + cleanup `alive = false`，与已修复 screen 保持一致。
- **验证**: tsc 通过。

#### R-L6 — SddTracePanel 主循环未复用 planItemsMap → 🔧已重新修复（含符合性审查修正）
- **位置**: `src/renderer/sdd/components/SddTracePanel.tsx:75-92,116`
- **缺陷**: `planItemsMap`（useMemo 预计算）已用于 coveredCount，但主渲染循环 116 行仍直接调用 `findPlanItemsForBlock(trace, block.id)` 而非复用 `planItemsMap.get(block.id)`，O(blocks×planItems) 未消除。
- **修复**: 116 行改为 `const planItems = planItemsMap.get(block.id) ?? []`，复用预计算结果。
- **符合性审查修正**: code-reviewer 子代理发现原 useMemo（第 82 行）位于第 76/79 行条件 return 之后，违反 React Hooks 规则（trace 变 null 再恢复会抛 "Rendered fewer hooks than expected"）。已即时修正：将 `displayBlocks` 计算与 useMemo 移到条件 return 之前，useMemo 内用 `if (!trace) return map` 守卫，条件 return 移到 useMemo 之后。hooks 调用顺序现在无条件稳定。
- **验证**: tsc 通过；sdd 测试 80 个用例全通过。

### 类别三结论
- ✅已正确修复: 27
- 🔧已重新修复: 3（R-C1、R-H5、R-L6）
- 待修复: 0

---

## 四、Workbench 核心 UI 与 Zustand Store（25 个 bug）— 核验完成

**核验子代理**: code-reviewer agent ab269c3adc1278eb9（已亲自复核所有 ⚠️/❌ 项源码）

### 核验汇总

| 等级 | 总数 | ✅已正确修复 | 🔧已重新修复 | ❌未修复 |
|------|------|------------|-----------|---------|
| Critical | 2 | 2 | 0 | 0 |
| High | 4 | 3 | 1 | 0 |
| Medium | 12 | 2 | 10 | 0 |
| Low | 7 | 7 | 0 | 0 |
| **合计** | **25** | **14** | **11** | **0** |

### ✅ 已正确修复（14 个，核验时即正确）
W-C1, W-C2, W-H1, W-H2, W-H3, W-M5, W-M6, W-L1, W-L2, W-L3, W-L4, W-L5, W-L6, W-L7

### 🔧 已重新修复（11 项）
W-H4, W-M1, W-M2, W-M3, W-M4, W-M4b, W-M6b, W-M7, W-M8, W-M9, W-M10
（注：W-H4/W-M3/W-M4b/W-M6b/W-M9 由子代理判 ⚠️ 升为 🔧；W-M1/W-M2/W-M4/W-M7/W-M8/W-M10 由子代理判 ❌ 升为 🔧）

#### W-H4 — BrowserPanel webview 事件监听器可能永远不附加 → 🔧已重新修复
- **位置**: `src/renderer/workbench/components/panels/BrowserPanel.tsx`
- **缺陷**: effect 依赖 `[session?.id]`，webviewRef 为普通 useRef，webview 未完全挂载时 effect 提前 return 不注册监听器，session.id 不变时 effect 不重运行。
- **修复**: 新增 `webviewMounted` state + `webviewRefCallback`（ref 回调，挂载时 `setWebviewMounted(n=>n+1)`），`<webview ref={webviewRefCallback}>`，effect 依赖加 `webviewMounted`——webview 真正挂载到 DOM 后 effect 重运行注册监听器。
- **验证**: tsc 通过。

#### W-M1 — providerActions 内联对象每次变化触发 effect → 🔧已重新修复
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:587`
- **修复**: effect 依赖从 `[props.providers.length, props.providerActions]` 改为 `[props.providers.length, props.providerActions.onReload]`（onReload 是 App.tsx 中 useCallback 稳定引用），避免内联对象每次新建导致 effect 重执行。
- **验证**: tsc 通过。

#### W-M2 — workingDiffCache 无大小限制 → 🔧已重新修复
- **位置**: `src/renderer/workbench/GitWorkbenchPanel.tsx`
- **修复**: 新增 `MAX_WORKING_DIFF_CACHE=50` 常量 + `appendWorkingDiffCache` 工具函数（insertion-order LRU，超限删最早条目），effect 中 `setWorkingDiffCache` 改用该函数。
- **验证**: tsc 通过。

#### W-M3 — selectThread 未捕获异常 → 🔧已重新修复
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:740-742`
- **修复**: try/finally 之间加 catch 块，`setSendError(e?.message || '切换对话失败')`，UI 显示错误而非卡在"切换中"。finally 仍保证 pending 清理。
- **验证**: tsc 通过。

#### W-M4 — useScrollBehavior 滚动 effect 无依赖数组 → 🔧已重新修复
- **位置**: `src/renderer/workbench/hooks/useScrollBehavior.ts`
- **缺陷**: useEffect 无依赖数组每次渲染执行，shouldStickToBottom 为 true 时阻止用户向上滚动。注：该 hook 当前为死代码（无组件 import），但仍按 BUG_REPORT 修复 effect 行为。
- **修复**: effect 依赖改 `[selectedThreadId]`，用 `ResizeObserver` 观察内容增长触发 stick，合并原第二个 effect 的 thread 切换重置逻辑。不再每次渲染执行，用户可向上滚动查看历史。
- **验证**: tsc 通过。

#### W-M4b — ContextCapacityIndicator 每次输入 setState → 🔧已重新修复
- **位置**: `src/renderer/workbench/ComposerBar.tsx:1110-1126`
- **修复**: useEffect+setCapacity 改为 `useMemo` 直接派生 capacity（纯计算无副作用），消除每次按键的 setState 重渲染。保留 alive 无关（useMemo 无需）。
- **验证**: tsc 通过。

#### W-M6b — BrowserPanel capture 缺错误处理 → 🔧已重新修复
- **位置**: `src/renderer/workbench/components/panels/BrowserPanel.tsx:95-109`
- **修复**: capture 函数体用 try/catch 包裹，catch 中 `setLoadError`，覆盖 executeJavaScript CSP 异常和 browser.capture 异常。
- **验证**: tsc 通过。

#### W-M7 — RunTimeline 拖拽每次 pointermove patchGraph → 🔧已重新修复
- **位置**: `src/renderer/workbench/RunTimeline.tsx:245-351,380-391`
- **修复**: 新增 `dragLayout` 本地 state，pointermove 只 `setDragLayout`（无 validateScheduleGraph/setSchedule）；pointerup 时一次性 `patchGraph` 提交最终 layout 并清空 dragLayout；渲染用 `dragLayout ?? graph.layout`。大图拖拽不再每次重算环检测。
- **验证**: tsc 通过。

#### W-M8 — dispatchThreadTodo 依赖未 memoized sendPrompt → 🔧已重新修复
- **位置**: `src/renderer/workbench/WorkbenchLayout.tsx:965-1004`
- **修复**: 新增 `sendPromptRef = useRef(sendPrompt)`，每 render 更新 ref；dispatchThreadTodo 内 `sendPrompt(...)` 改为 `sendPromptRef.current(...)`，依赖数组移除 sendPrompt。dispatchThreadTodo 引用稳定，子组件不再不必要重渲染。
- **验证**: tsc 通过；git-dock-layout.test.ts 源码断言已同步更新（sendPromptRef.current），14 个用例全通过。

#### W-M9 — store partialize 冗余 selectedThreadId → 🔧已重新修复
- **位置**: `src/renderer/src/store/workbench-store.ts:72`
- **修复**: partialize 移除 `selectedThreadId`（WorkbenchLayout 用本地 useState+localStorage 持久化，store 的 setSelectedThreadId 从不被调用，该字段是始终 null 的死字段）。统一为 localStorage 单一持久化源。
- **验证**: tsc 通过。

#### W-M10 — useScheduleManager 死代码 → 🔧已重新修复
- **位置**: `src/renderer/workbench/hooks/useScheduleManager.ts`
- **修复**: 确认无任何组件 import（全代码库 grep 无引用），删除该文件。与 WorkbenchLayout 的独立 schedule 逻辑重复消除。
- **验证**: tsc 通过。

### 类别四结论
- ✅已正确修复: 14
- 🔧已重新修复: 11（W-H4、W-M1、W-M2、W-M3、W-M4、W-M4b、W-M6b、W-M7、W-M8、W-M9、W-M10）
- 待修复: 0

---

## 符合性审查（子代理复核）

**审查子代理**: code-reviewer agent ad1b8cb79d8beba16
**审查范围**: 18 处重新修复逐条对照 BUG_REPORT.md 修改建议 + 逻辑正确性 + 最小范围 + tsc/test 验证

### 审查结果

| 判定 | 数量 | 说明 |
|------|------|------|
| ✅符合 | 17 | 正确解决原始问题、逻辑无误、最小改动 |
| ⚠️有问题 | 1 | R-L6 引入 React Hooks 规则违反（已即时修正） |
| ❌不符合 | 0 | — |

### 审查发现的 1 个问题及处置

**R-L6 — React Hooks 规则违反（已修正）**
- `SddTracePanel.tsx` 原 useMemo 位于两个条件 return 之后，违反 hooks 必须无条件调用规则。
- **处置**: 即时修正——useMemo 移到条件 return 之前，内部用 `if (!trace) return map` 守卫。
- **复审**: tsc 通过，sdd 80 个测试通过，hooks 调用顺序稳定。

### 审查建议（非阻断，已采纳部分）

1. **R-C1 正则多层嵌套** — `CSS_PAYLOAD_DANGER` 仅支持 1 层嵌套括号，`url(a(b(c)))`（2 层）无法剥离。已补充 1 层嵌套测试用例确认覆盖；实际 XSS 载荷通常 1 层 + renderMarkdown 不产出 style 属性（纵深防御），影响低，注释已说明局限。
2. **测试覆盖缺口** — 已补充 3 个边界测试：
   - H-M6: 缺失 exit_code 标 error（codex-stream-json.test.ts）
   - M-H1: 文件不存在返回 'File not found' 无路径泄露（workspace-files.test.ts）
   - R-C1: CSS expression 1 层嵌套括号（sanitize.test.ts）

### 最终验证

- **tsc -b --noEmit**: exit 0，无错误
- **vitest run**: 230 文件 1460 测试全通过（基线 1457 + 新增 3）
- **回归**: 无

---

## 总结

本次按 BUG_REPORT.md 全量重新核验 105 个 bug：

1. **核验**: 5 个 code-reviewer 子代理分 5 类并行核验，直接读源码不信报告。
2. **修复**: 18 个核验发现问题的 bug 已最小范围重新修复（含子代理误报 2 项纠正——M-M8 校验在 typed-ipc 层已正确、C-L1 路径必需不可删）。
3. **符合性审查**: code-reviewer 子代理对 18 处修复逐条复核，发现 1 个 hooks 规则问题（R-L6）已即时修正，并采纳测试覆盖建议补充 3 个边界测试。
4. **最终状态**: tsc 通过，1460 测试全通过，105 个 bug 全部闭合，无回归。

修复涉及 20 个文件（19 改 1 删），共 +166/-161 行，均为最小范围改动。

