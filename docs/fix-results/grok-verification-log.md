# Grok 轮：历史 105 Bug 再核验摘要

> 日期：2026-07-09 | 分支：grok | 方法：直接读当前源码，对照 BUG_REPORT.md + verification-log.md

## 总体结论

| 历史105 | PASS | INCOMPLETE | REGRESSION | 新发现(另册) |
|---------|------|------------|------------|--------------|
| 105     | ~103 | 0          | 0          | 见 BUG_REPORT_GROK |

glm 轮 Critical 安全项（M-C1..C6、R-C1）源码复核均为 **PASS**：

| ID | 证据 | 判定 |
|----|------|------|
| M-C1 | `workspace-ipc.ts` 使用 `isSensitiveTextFilePath` | PASS |
| M-C2 | `conversation-ipc.ts` importFile 使用 `resolvePathWithinAllowedBases` | PASS |
| M-C3 | `plugins-ipc.ts` `resolveRegisteredWorkspaceRoot` | PASS |
| M-C4 | `passthrough-ipc.ts` knowledge 双 handler 注册根校验 | PASS |
| M-C5 | `workflow-ipc.ts` projectMap:build 注册根校验 | PASS |
| M-C6 | `backup.ts` 不再 decryptSecret，保留加密形态 | PASS |
| R-C1 | `sanitize.ts` 覆盖 script/事件/js协议/CSS expression | PASS（深层嵌套见 Grok 清单） |
| M-H1 | `workspace-files.ts` 已改 `fs.promises` | PASS |
| M-H2 | `store.ts` save/flush 用 async write/rename | PASS（并发竞态见 Grok） |
| M-H3 | `terminal-pty-ipc.ts` attachSender 在 onData 之前 | PASS |
| M-H5/H6 | health-monitor catch + backoff 可取消 + stop 检查 | PASS |
| M-M1 | worktrees `isInside` Win 大小写 | PASS |
| M-M2 | budget-center warning 字段 | PASS |
| M-M3 | inline-edit newEndLine 空替换保护 | PASS |
| M-M4 | github 用 `git` 非 `gh git` | PASS（cwd 缺失见 Grok） |
| W-C1 | ComposerBar setQueue 在 onSend 之后 | PASS（依赖数组权衡见观察项） |
| W-C2 | TerminalPanel cleanup dispose PTY | PASS |
| C-M1 | menu releases URL AgentHub 正确 | PASS |

## 再核验注意点（非回归，升格为本轮新项）

1. `system-tools.ts` **未**在历史 M-C* 覆盖范围，存在路径逃逸 → **G-MC1**
2. `terminal:create` cwd 无注册校验 → **G-MC2**
3. GitHub 集成无 workspace cwd → **G-MH1**
4. store 异步 save 无串行锁 → **G-MH2**
5. knowledge 测试全量 flaky → **G-XM1**

## 测试抽检

```
npm run typecheck → PASS
npx vitest run src/main/ipc/__tests__/passthrough-ipc-knowledge.test.ts → 4/4 PASS
npm test → 1459 pass / 1 flaky fail
```
