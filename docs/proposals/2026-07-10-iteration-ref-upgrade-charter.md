# AgentHub 参考驱动迭代章程（2026-07-10）

| 字段 | 内容 |
|------|------|
| **代号** | `ITER-REF-20260710` |
| **分支** | `feat/w4-impl`（续） |
| **状态** | **完成** |
| **参考根** | `E:\Agent\.refs`（cc-switch、codex）、`E:\Agent\desktop-cc-gui`、`E:\Agent\Kun` |

## 1. 多项目对比（优势 → AgentHub 缺口）

| 参考 | 突出优势 | AgentHub 现状 | 本轮可吸收 |
|------|----------|---------------|------------|
| **Kun** | 单运行时 HTTP/SSE 边界；会话 resume；auto-title 门控；goal/steering；cache 友好 | 有线程/turn/goal/headless，但新建会话标题偏静态 | **IT-1 会话自动标题** |
| **desktop-cc-gui** | 上下文账本、用量预算、runtime evidence 门禁、任务中心、项目地图 | 有 usage/budget/diagnostics，缺一键 **support bundle** | **IT-3 支持包导出** |
| **cc-switch (.refs)** | Provider 多配置切换、连接管理、中转站场景 | 有 providers/bindings，缺 **配置层 doctor 摘要** | **IT-2 Provider Doctor** |
| **Codex (.refs)** | 强 CLI、exec 策略、会话历史统一 | 已有 headless CLI skeleton + mock/real binary | 本轮不重做 CLI；可后续 WS 编排 |
| **AgentHub 自身** | 多 Agent 调度、插件完整性/签名/市场、WebDAV 同步、Firefly 模板 | Wave4+ 已落地 | 本轮做 **净新增 UX/运维切片** |

## 2. 本轮有限任务清单（合同）

> 「全部完成」= 下表全部 `[x]` 或明确记入 Non-goals/Deferred。禁止无限扩 backlog。

| ID | 任务 | 类型 | 验收要点 |
|----|------|------|----------|
| **IT-1** | 会话自动标题（首条 prompt） | 产品代码 | 纯函数 + 单测；默认标题可被首条用户消息替换 |
| **IT-2** | Provider Doctor 配置诊断 | 产品代码 | 纯函数扫描 enabled/key/baseUrl；输出结构化报告；单测 |
| **IT-3** | Support Bundle / runtime 证据导出 | 产品代码 | 组装 JSON 支持包（版本/诊断/插件计数等）；单测；可选 IPC |
| **IT-4** | Composer 提示词历史环缓冲 | 产品代码 | 最近 N 条 prompt 入环；↑ 方向检索 API；单测 |
| **IT-5** | 全量回归战役 | 文档+测试 | typecheck + full vitest 绿；scratch 日志；bug 记录 |

**非目标（本轮）：** Tauri 迁移、Kun 整体并入、重写 Hub 编排、依赖大版本升级、远程 push/commit。

## 3. 强制流程（每任务）

```
文档/计划 → 子代理 plan → 实现 → 子代理 review
  → 不通过则修改 → 再 review 直到通过 → 记录 → 下一任务
```

证据落点：
- 计划：`docs/superpowers/plans/2026-07-10-it-N-*.md`
- 记录：`docs/fix-results/2026-07-10-it-N-record.md`
- 终局：`docs/fix-results/2026-07-10-iteration-regression.md`
- Scratch：`{SCRATCH}/`

## 4. 任务进度

- [x] IT-1 会话自动标题
- [x] IT-2 Provider Doctor
- [x] IT-3 Support Bundle
- [x] IT-4 Composer prompt 历史
- [x] IT-5 回归战役

## 5. Deferred（明确不在本轮）

- Headless CLI 接入桌面 Hub WS 全量 turns:create
- 无头 Electron 进程
- 插件评分商店 / 支付
- WebDAV 冲突字段级合并 UI
