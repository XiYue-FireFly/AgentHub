# AgentHub Grok Round-2 Bug 清单

> 分支：grok | 日期：2026-07-09  
> 说明：在 R1（BUG_REPORT_GROK 9 项）已修基础上的**新一轮**全量排查。不重复已闭合的 G-MC1…G-XM1。  
> 不涉及代码文件拆分。

## 再核验 R1

R1 九项源码仍在，不重开。

---

## Critical

### G2-MC1 SDD rehydrate 强制 dirty + content 未持久化 → 空内容覆盖磁盘
- **位置**: `src/renderer/sdd/sdd-draft-store.ts:192-204`；`SddDraftEditor.tsx:330-345`；`sdd-draft-actions.ts:63-80`
- **问题**: `partialize` 不存 `content`（默认 `''`），却存 `activeDraft`；`onRehydrateStorage` 强制 `saveStatus='dirty'`。重启后 autosave 用空 `content` 调用 `updateDraft`。
- **后果**: 需求文档被清空。
- **修改建议**: rehydrate 时从 `activeDraft.content` 恢复 `content`/`lastSavedContent` 并 `saved`；拒绝「空 content 覆盖非空 lastSaved」的隐式保存（或 rehydrate 后立即 loadDraft）。
- **本轮**: MUST_FIX

### G2-MC2 路径守卫无 realpath（symlink 逃逸）
- **位置**: `system-tools.ts:resolvePath`；`workspace-ipc.ts:validateWorkspacePath`；对比 `agentic/tools.ts:isRealPathWithin`
- **问题**: 仅逻辑路径 `isPathInsideBase`，符号链接可指向工作区外。
- **修改建议**: 复用 ACP/agentic realpath 祖先校验；敏感检查用 real path。
- **本轮**: MUST_FIX（system-tools + workspace-ipc 最小）

## High

### G2-MH1 git untracked 预览 `startsWith` 前缀逃逸
- **位置**: `src/main/runtime/git.ts:760-764`、`567-571`
- **修改建议**: `isPathInsideBase(fullPath, rootResolved)`
- **本轮**: MUST_FIX

### G2-MH2 `workspaceFiles:write` 无敏感文件拦截
- **位置**: `src/main/ipc/workspace-ipc.ts:75-85`
- **修改建议**: 与 read 对称加 `isSensitiveTextFilePath`
- **本轮**: MUST_FIX

### G2-MH3 MCP shell_exec 合并任意 env
- **位置**: `src/main/mcp/system-tools.ts:350-354`
- **修改建议**: 忽略调用方 env 或仅允许白名单键，禁止覆盖 PATH/LD_PRELOAD/NODE_OPTIONS
- **本轮**: MUST_FIX

### G2-MH4 Terminal attach 早退泄漏监听
- **位置**: `src/renderer/workbench/TerminalPanel.tsx:160-256`
- **修改建议**: 注册监听后立即设置 `__dispose`，早退路径调用
- **本轮**: MUST_FIX

### G2-MH5 Composer 队列 effect 依赖不稳定 onSend
- **位置**: `ComposerBar.tsx:324-339`
- **修改建议**: onSend/queue 用 ref；依赖 `sending` + `queue.length`
- **本轮**: MUST_FIX

### G2-MH6 Git 面板工作区切换竞态
- **位置**: `GitWorkbenchPanel.tsx` refresh
- **修改建议**: request generation token
- **本轮**: MUST_FIX

### G2-MH7 SDD 切换/卸载丢 dirty（无 flush）
- **位置**: `sdd-draft-actions.ts:loadDraft`；`SddDraftEditor` unmount
- **修改建议**: dirty 时先 await saveDraftToDisk
- **本轮**: MUST_FIX

### G2-MH8 退出路径 store.flush 未 await
- **位置**: `src/main/index.ts:1142-1172`
- **修改建议**: will-quit cleanup 中 `await store.flush()`
- **本轮**: MUST_FIX

## Medium（本轮优先做完 Critical/High 后时间允许再修）

### G2-MM1 terminal write 无 sender 归属校验
### G2-MM2 bootstrapContext 无敏感过滤
### G2-MM3 plugin path startsWith
### G2-MM4 SideConversation 写入父 thread
### G2-MM5 Fork 不导航
### G2-MM6 FileTree 工作区竞态
### G2-MM7 WriteWorkspace unmount 不 flush
### G2-MM8 proxy token 非 constant-time

## 修复顺序

1. G2-MC1 + G2-MH7（数据丢失）
2. G2-MH1, G2-MH2, G2-MH3, G2-MC2（安全）
3. G2-MH4, G2-MH5, G2-MH6（竞态/泄漏）
4. G2-MH8
5. Medium 能修则修
