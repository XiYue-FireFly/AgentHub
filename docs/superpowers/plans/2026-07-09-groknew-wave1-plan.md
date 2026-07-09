# AgentHub groknew Wave 1 Implementation Plan

> **For agentic workers:** Subagent-driven development. Checkbox tracking.

**Goal:** 在 `groknew` 分支完成安全/UX 继实现 7 项（F-N1…F-N7），记录审查与测试，最后全局符合审查并修回归。

**Architecture:** 最小 diff，复用 `path-guards` / `sensitive-files` / 既有 IPC 模式；不做架构重写。

**Tech Stack:** Electron main IPC, React workbench, Vitest

---

## 需求重述

用户要求：未来迭代建议文档 + 功能继实现；新建 `groknew`；plan 后实现；每功能子代理审核；记录后再下一项；最后全局审查与 bug 修复。

## 风险

| 风险 | 缓解 |
|------|------|
| Terminal sender 校验破坏 reattach | reattach 时更新 sender 后允许新 owner |
| Bootstrap 过滤过严 | 仅 isSensitiveTextFilePath |
| Fork 导航依赖 selectThread | 复用 WorkbenchLayout 已有 API |
| 测试不稳定 | 优先单测 + 聚焦 vitest |

## 任务清单

### Task F-N1: Terminal sender ownership
- Files: `src/main/ipc/terminal-pty-ipc.ts`, tests
- [ ] write/resize/dispose 要求 `session.sender === event.sender`（destroy 则拒绝）
- [ ] create reattach 仍 attach 新 sender
- [ ] 测试

### Task F-N2: Bootstrap sensitive skip
- Files: `src/main/hub/workspace.ts`, tests if any
- [ ] bootstrapContext 读文件前 `isSensitiveTextFilePath` → omitted++

### Task F-N3: Plugin path guard
- Files: `src/main/runtime/plugin-manager.ts`
- [ ] `isPathInsideBase(realSkillPath, realRoot)` 替换 startsWith

### Task F-N4: Fork navigate
- Files: `ThreadView.tsx`, parent wiring
- [ ] 传入 onFork → selectThread

### Task F-N5: Proxy timing-safe token
- Files: `src/main/routing/proxy.ts`, hub/server.ts 对齐
- [ ] timingSafeEqual length-checked

### Task F-N6: FileTree race
- Files: `FileTreePanel.tsx`
- [ ] root gen token ignore stale list

### Task F-N7: WriteWorkspace flush
- Files: `WriteWorkspace.tsx`
- [ ] unmount/cleanup flush localStorage via refs

### Task Final
- [ ] 全量 test + 全局审查 + 修 bug

## 预估复杂度：中低
