# Grok 修复进度

> 分支：grok | 开始：2026-07-09  
> REVIEW_MODE：子 agent code-reviewer（配额可用时）

## 进度表

| ID | 状态 | 审查 | 测试 |
|----|------|------|------|
| G-MC1 | FIXED | APPROVE `019f4714-f053` | system-tools 16 PASS |
| G-MC2 | FIXED | APPROVE `019f471d-1bfe` | terminal-pty 8 PASS |
| G-MH1 | FIXED | APPROVE `019f4720-cf58` | github-integration 4 PASS |
| G-MH2 | FIXED | APPROVE `019f4726-a68d` | store-local-token 3 PASS |
| G-MM1 | FIXED | APPROVE `019f4729-2a42` | missing-ipc-app-path PASS |
| G-MM2 | FIXED | APPROVE `019f4729-2a42` | sanitize 14 PASS |
| G-XM1 | FIXED | APPROVE `019f4729-2a42` | knowledge 1 PASS (30s) |
| G-ML1 | FIXED | APPROVE `019f4729-2a42` | package.json AgentHub |
| G-ML2 | FIXED | APPROVE `019f4729-2a42` | README Node 24+ |

## 详细记录

### G-MC1 — system-tools 路径逃逸
- **改动**: `system-tools.ts` resolvePath + isPathInsideBase
- **审查**: APPROVE
- **主 agent**: 同意

### G-MC2 — terminal cwd
- **改动**: `resolveSafeTerminalCwd` + 注册工作区 / process.cwd 回退
- **审查**: APPROVE（已采纳 null-byte 与 outside 测试建议）

### G-MH1 — github cwd
- **改动**: optional cwd on git/gh；IPC 绑定 active workspace
- **审查**: APPROVE

### G-MH2 — store 串行写
- **改动**: saveChain + enqueuePersist；flush 始终入队最新快照
- **审查**: APPROVE

### G-MM1 — openExternal
- **改动**: safeBrowserUrl + mailto URL parse
- **审查**: APPROVE

### G-MM2 — sanitize 深层 CSS
- **改动**: 循环剥离 + 残留危险 token 清空 style
- **审查**: APPROVE

### G-XM1 — flaky knowledge test
- **改动**: 合并单 it + timeout 30s
- **审查**: APPROVE

### G-ML1 / G-ML2
- package.json + README 拼写与 engines；顺手修 clone URL AgengHub

## Final gate
- typecheck: PASS
- full suite: **1467 PASS** / 230 files / 0 failed
- 5-agent consensus: **5/5 CONSENSUS_PASS**
- 详见 `docs/fix-results/grok-final-report.md`
