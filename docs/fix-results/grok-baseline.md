# Grok Baseline

- **Date**: 2026-07-09
- **Branch**: grok
- **HEAD**: `84a7b39d421251d3506354c33ef3ce1a13f8730f`
- **typecheck**: PASS (`tsc -b --noEmit`)
- **vitest (full suite)**: 1 failed | 229 passed (230 files); Tests 1 failed | 1459 passed (1460)
- **Known flaky**:
  - `src/main/ipc/__tests__/passthrough-ipc-knowledge.test.ts` — 全量套件中 `rejects detecting tech stack for unregistered workspace paths` 偶发 15s 超时；单独运行 4/4 通过（~1.0s）
- **Notes**:
  - glm 轮 105 bugs 已宣称修复；本轮在 `BUG_REPORT_GROK.md` 记录残差与新发现
  - 子 agent explore 因 API 配额 429 失败，主 agent 亲自完成源码级扫描
  - 计划文档：`docs/superpowers/plans/2026-07-09-grok-bugfix-plan.md`
