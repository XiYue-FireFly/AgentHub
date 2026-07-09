# groknew Wave 1 进度

| ID | 状态 | 审查 | 测试 |
|----|------|------|------|
| F-N1 Terminal sender 归属 | FIXED | APPROVE | terminal-pty-ipc 9 PASS |
| F-N2 Bootstrap 敏感过滤 | FIXED | APPROVE | workspaceBootstrap PASS |
| F-N3 Plugin path guard | FIXED | APPROVE | plugin-contributions PASS |
| F-N4 Fork 导航 | FIXED | APPROVE | threadview-status PASS |
| F-N5 Proxy timing-safe token | FIXED | APPROVE | typecheck + suite |
| F-N6 FileTree 竞态 | FIXED | APPROVE | suite PASS |
| F-N7 WriteWorkspace flush | FIXED | APPROVE (rework) | suite PASS |

## 详细记录

### F-N1
- `terminal-pty-ipc.ts` write/resize 校验 `session.sender === event.sender`
- dispose 仅 owner 或 owner 已销毁
- 测试：非 owner 写入被拒

### F-N2
- `workspace.bootstrapContext` 跳过 `isSensitiveTextFilePath`，路径用 `isPathInsideBase`

### F-N3
- `plugin-manager` skill/realpath 使用 `isPathInsideBase`

### F-N4
- `ThreadView` → `AgentOutputs` → `ForkButton.onFork`
- `WorkbenchMainContent` 传入 `selectThread`

### F-N5
- `proxy.ts` `tokensEqual` + `timingSafeEqual`

### F-N6
- `FileTreePanel` `loadGenRef` + root 快照

### F-N7
- 首轮 BLOCK（StrictMode 空写）；dirty/hydrate 守卫后 APPROVE

## Final gate
- typecheck: PASS
- full suite: **1475 PASS** / 230 files
- Wave1 审查: F-N1–N6 APPROVE；F-N7 rework 后 APPROVE
- 全局符合: 见 `docs/fix-results/groknew-final-report.md`
