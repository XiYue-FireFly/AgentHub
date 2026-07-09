# AgentHub-v123 Grok 分支全量 Bug 排查与修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本计划阶段约束（Phase 0–2）：** 只写文档与分支/基线验证，**禁止修改产品源码**。Phase 3 起才允许按 `BUG_REPORT_GROK.md` 逐条改代码。

**Goal:** 在 `grok` 分支上完成「全量 bug 排查 → 写出残差/新 bug 清单 → 按严重度迭代修复 → 子代理复核 → 测试记录 → 五代理终审共识」，在既有 glm 105 条修复之上发现并闭合**回归、不完整修复、以及全新缺陷**。

**Architecture:** 两段式流水线。**(A) 只读排查段**：对照 `BUG_REPORT.md` 再核验 + 新鲜扫描，产出 `BUG_REPORT_GROK.md`。**(B) 修复段**：按 Critical→High→Medium→Low 排序，每条 bug 执行「实现 → 子代理审查 → 测试 → 写入 fix-results → 再下一条」。终局由 5 个独立审查代理按领域共识放行。

**Tech Stack:** Electron 33 + electron-vite、React 18、Zustand 5、TypeScript 5、Vitest 4、Playwright、node-pty/xterm、IPC 契约

---

## 1. 需求重述

1. 全量 bug hunt（不盲信 105 已全部闭合）。
2. 先写 bug 清单文档（`BUG_REPORT_GROK.md`），不先改产品代码。
3. 在 `grok` 分支按清单修复；每条：implement → subagent review → test → record → next。
4. 终局 5-agent consensus review。
5. 主 agent 必须等待子 agent 返回后再继续（若配额耗尽则主 agent 亲自等价审查并记录）。

## 2. 阶段总览

| Phase | 名称 | 产物 |
|-------|------|------|
| 0 | 分支与基线 | `grok` 分支、`docs/fix-results/grok-baseline.md` |
| 1 | 历史 105 再核验 | `docs/fix-results/grok-verification-log.md` |
| 2 | 新鲜扫描 + 清单冻结 | `BUG_REPORT_GROK.md` |
| 3 | Critical 修复 | 代码+测试+记录 |
| 4 | High 修复 | 同上 |
| 5 | Medium 修复 | 同上 |
| 6 | Low 修复 | 同上 |
| 7 | 全量回归 + 5-agent 共识 | `docs/fix-results/grok-final-report.md` |

## 3. 单条 Bug 工作流

1. **Implement**：TDD 优先，最小 diff，复用 `path-guards` / `workspace-root-guard` / `sensitive-files`。
2. **Subagent Review**：APPROVE / REWORK。
3. **Test**：
   - `npx vitest run <file>`
   - `npm run typecheck`
   - 阶段末 `npm test`
4. **Document**：写入 `docs/fix-results/grok-progress.md`。
5. **Next**：仅当审查通过且测试绿。

## 4. 文档路径

| 产物 | 路径 |
|------|------|
| 本计划 | `docs/superpowers/plans/2026-07-09-grok-bugfix-plan.md` |
| 本轮 bug 清单 | `BUG_REPORT_GROK.md` |
| 基线 | `docs/fix-results/grok-baseline.md` |
| 进度 | `docs/fix-results/grok-progress.md` |
| 再核验 | `docs/fix-results/grok-verification-log.md` |
| 终审 | `docs/fix-results/grok-final-report.md` |
| 架构 | `agenthub.md`（已存在，本轮补充 Grok 轮说明） |

## 5. 执行约束

- 工作分支：`grok`
- 不覆盖 glm 历史文档（`BUG_REPORT.md`、`progress-report.md`、`verification-log.md`）
- 不做文件拆分式重构
- 安全测试只写防御断言
- 子 agent 配额耗尽时：主 agent 执行等价审查，并在进度文档标注 `REVIEW_MODE=main-agent-fallback`

## 6. Master Checklist

- [x] Phase 0：`grok` 分支 + baseline
- [x] Phase 1：105 再核验摘要
- [x] Phase 2：`BUG_REPORT_GROK.md` 冻结
- [x] Phase 3：Critical MUST_FIX
- [x] Phase 4：High MUST_FIX
- [x] Phase 5：Medium MUST_FIX
- [x] Phase 6：Low / OPTIONAL
- [x] Phase 7：全量回归 + 5-agent 共识
