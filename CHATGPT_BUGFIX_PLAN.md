# AgentHub 全量 Bug 排查与逐项修复计划

> 日期：2026-07-10
> 分支：`chatgpt`
> 基线 HEAD：`40a7c1222d631c58bb1f4b51ebafed2a0f3a550d`
> 方法：本地不存在精确名称 `ecc-plan` 的技能，采用最接近的 ECC 迁移计划技能 `source-command-aimax-plan`，并由独立规划子代理产出、主代理审阅。

## 1. 目标与边界

目标是先全面理解当前 AgentHub 2.0，形成有证据、可复现、去重后的 Bug 清单，再按严重度和依赖关系逐项做最小修复。每个 Bug 都必须经历“失败证据 → 最小实现 → 独立复核 → 主代理裁决 → 目标/邻接测试 → 记录”闭环，最后执行完整回归与第二轮独立审计。

本轮不把以下内容单独当作 Bug：

- 仅因文件过大而拆分 `src/shared/ipc-contract.ts` 或大型 UI 文件；
- 没有可达性、行为违约或安全影响证据的 TODO、`any`、未使用代码；
- 纯视觉偏好、无验收标准支撑的重设计；
- 与确认 Bug 无关的顺手重构。

## 2. 交付物

| 文件 | 内容 |
|---|---|
| `agenthub.md` | 当前架构、入口、数据流、约定和命令 |
| `CHATGPT_BUGFIX_PLAN.md` | 本实施计划 |
| `BUG_REPORT_CHATGPT.md` | 冻结 Bug 清单、位置、复现、根因、最小建议和状态 |
| `TEST_RESULTS_CHATGPT.md` | 基线、逐 Bug 测试、阶段回归和最终验收证据 |

## 3. 修复前基线

| 检查 | 结果 |
|---|---|
| Node / npm | `v24.15.0` / `11.12.1`，符合 engines |
| `npm ci` | 通过，649 packages |
| `npm run typecheck` | 通过 |
| `npm run lint` | 失败：3 errors、40 warnings |
| `npm test -- --reporter=dot` | 通过：242 files / 1536 tests |
| `npm run build` | 通过；存在 bundle budget warning |
| `npm run test:e2e` | 通过：1 Electron smoke |
| `npm audit --omit=dev` | 0 个生产依赖漏洞 |
| `npm audit` | 15 个漏洞节点：1 critical、12 high、2 moderate |
| 质量脚本 | large-file 超限（本轮不拆文件）；CSS 30 处 warning；bundle 超预算 |

基线测试生成了未跟踪的 `test-tmp-backup-security/`；这是审计现场，不得误提交，定位和回归后再安全清理。

## 4. Bug 证据标准

候选项至少满足以下一条才能进入冻结清单：

1. 未修代码上存在稳定失败测试或可重复脚本；
2. 真实 Electron、CLI、构建或打包流程能够复现；
3. 明确违反 README、IPC 合同、持久化不变量或 UI 可见承诺；
4. 安全边界可达，能够导致越权、泄漏、篡改或拒绝服务；
5. CI 必跑命令稳定非零退出。

每条固定记录：ID、严重度、状态、位置与行号、触发条件、实际/预期、调用链、根因、影响、最小修改建议、应补测试、依赖、复核结论和最终测试。

严重度：

- **P0**：RCE、密钥泄漏、不可恢复数据损坏、应用稳定无法启动。
- **P1**：核心路径不可用、越权文件/命令访问、稳定崩溃或高危供应链问题。
- **P2**：错误结果、竞态、跨工作区污染、明显资源泄漏。
- **P3**：局部 UX/兼容问题、质量门禁失败、测试可靠性问题。

状态只使用：`候选`、`已确认`、`修复中`、`待复核`、`BLOCK`、`已复核`、`已关闭`、`接受风险`。

## 5. 阶段计划

### 阶段 A：项目 init 与架构地图

- 读取 manifest、README、构建/测试配置、入口与两层目录树。
- 追踪 renderer → preload → IPC → runtime → Provider/Agent → event store 的请求生命周期。
- 识别 AppStore、runtime store、Zustand、SDD 与同步模块的数据所有权。
- 生成/更新 `agenthub.md`。

**门禁：** 关键生产目录及所有进程边界均有职责说明；不以旧文档代替当前代码验证。

### 阶段 B：全量发现（只读）

并行覆盖以下领域，主代理统一反证与去重：

1. Main/IPC/security：合同四方一致、运行时校验、路径/敏感文件、窗口、CSP、deep link、退出清理。
2. Hub/Provider/Agent：direct/local 两条执行路径、流解析、Abort/timeout/late event、fallback、审批与子进程。
3. Persistence/Wave4：store 并发、safeStorage、backup、config/WebDAV sync、plugin marketplace/signature、CLI。
4. Renderer/Workbench/SDD：effect 清理、乱序、workspace/thread 切换、Composer 队列、PTY、autosave/rehydrate、可访问性。
5. Build/release/test：依赖漏洞、原生 ABI、打包、updater、版本一致、CI、测试隔离和 E2E 覆盖。

**门禁：** 冻结 `BUG_REPORT_CHATGPT.md` 前不修改业务代码；同一根因合并，独立修复边界才拆分。

### 阶段 C：历史回归核验

只读查看历史 `BUG_REPORT.md`、Grok、Grok R2 与验证日志，将高风险旧项标记为当前 `PASS`、`REGRESSION`、`OBSOLETE` 或 `UNVERIFIABLE`。只允许使用 `git show <commit>:<path>` 与 `git log -- <path>` 读取，禁止用 `git restore`、`git checkout -- <path>` 或其他方式把历史文件恢复到工作树。重点回查路径 realpath、terminal sender、敏感过滤、plugin path、side conversation、fork 导航、FileTree/SDD 竞态和 proxy token 比较。

历史结论不能直接进入当前清单，必须在当前 HEAD 重新取证。

### 阶段 D：逐 Bug 修复循环

同一文件域同一时间仅允许一个 Bug 处于修改状态。按用户 2026-07-11 的最新要求，彼此独立且文件范围不重叠的 Bug 可由多个子代理并行修复；主代理必须预先冻结每个代理的文件范围，并统一负责文档登记、交叉冲突检查、集成回归和双门禁复核。存在共享文件、共享运行时状态或先后依赖的项目仍串行执行。

1. 记录 Bug ID、起始 diff 与允许修改范围。
2. 编写最小回归测试/复现，并在旧代码上确认失败。
3. 实施最小修复。
4. 运行目标测试与邻接测试。
5. 派未参与实现的子代理只读审查 diff、根因和测试。
6. 主代理等待返回并裁决：`PASS` 才继续；`BLOCK` 立即返工。
7. 修正后重新测试，必要时再次送审，直至意见最小且无阻断项。
8. 更新 `BUG_REPORT_CHATGPT.md` 与 `TEST_RESULTS_CHATGPT.md`，再进入下一项。

Reviewer 必查：

- 回归测试是否确实能在旧实现失败；
- 是否覆盖 create/retry、read/write、attach/dispose 等成对路径；
- 是否扩大权限、吞错或静默降级；
- Electron stub 是否掩盖真实行为；
- 是否修改无关格式或用户改动；
- 持久化/API schema 是否需要兼容迁移。

### 阶段 E：阶段回归

每完成一个 P0/P1，或累计完成最多五个 P2/P3，执行：

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

在首个“修复 lint 基线”问题关闭前，阶段门禁采用“目标/邻接测试通过、typecheck/build 通过，且 lint error/warning 不高于已记录基线”；lint 基线关闭后，所有阶段都要求 `npm run lint` 零 error，且 warning 不增加。安全类追加路径、IPC、sanitize、plugin、sync 负例；Electron/renderer 类追加 E2E。适用门禁未过时不得继续下一项，最终验收要求 lint 全量通过。

### 阶段 F：最终审计与验收

- 至少两个独立子代理对同一最终 diff 从 main/security 与 renderer/runtime 两个视角复审。
- 主代理逐条核对冻结清单、BLOCK、测试日志和工作树。
- 对新发现追加 Bug，不静默改号；按同一闭环修复。
- 清理仅由本轮测试生成且已确认路径的临时目录。

## 6. 按改动范围的测试矩阵

| 范围 | 必跑门禁 |
|---|---|
| shared contract / preload / IPC | 目标测试、contract/validation/architecture guards、typecheck、build、E2E |
| Dispatcher / Provider / Adapter | 目标及 hub/providers/agentic 邻接套件、Abort/timeout/fallback |
| 文件 / Git / Terminal / MCP | 安全负例、工作区隔离、Windows 真实进程、资源回收 |
| Store / Sync / WebDAV / Backup | 并发、重启、损坏文件、错误口令、无部分写、秘密扫描 |
| Renderer / Workbench / SDD | 目标 happy-dom、状态/竞态测试、typecheck、lint、Electron 路径 |
| 依赖 / Build / Native | audit、typecheck、unit、build、E2E、`build:win`/unpack 启动 |
| 测试本身 | 目标测试连续运行、全量测试、工作树无副产物 |

## 7. 最终命令

```powershell
npm ci
npm run typecheck
npm run lint
npm test -- --reporter=dot
npm test -- --coverage
npm run build
node scripts/check-bundle-size.js
npm run test:e2e
npm run build:win
npm run cli -- version
$finalCliRuns = Join-Path ([IO.Path]::GetTempPath()) ('agenthub-chatgpt-final-cli-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $finalCliRuns) { throw "Refusing to reuse existing CLI runs directory: $finalCliRuns" }
npm run cli -- run --workspace . --prompt "final smoke" --dry-run --runs-dir $finalCliRuns
npm run cli -- run --workspace . --prompt "final smoke" --mock --runs-dir $finalCliRuns
npm audit
git status --short --branch
```

运行前记录该 GUID 目录原本不存在并由本轮创建。最终记录完成后，只有在 `Resolve-Path`/`[IO.Path]::GetFullPath` 确认目标位于系统临时目录之下、叶名以 `agenthub-chatgpt-final-cli-` 开头且与本轮记录完全一致时，才清理该目录；不得触碰用户默认的 `~/.agenthub/cli-runs/` 或任何复用目录。

## 8. 项目特定风险

- 类型化 IPC 数量大，运行时 validator 缺省行为和手工通道清单可能造成“类型正确、运行时放行”。
- 单测使用 Electron stub，不能证明 sandbox、safeStorage、webview、node-pty、single-instance 和退出路径。
- Windows 路径需覆盖大小写、UNC、junction/symlink、设备名与 `.cmd/.bat`。
- Provider direct 与本地 Agent 是两条执行路径，修一条不能证明另一条。
- 多窗口广播与单窗口 UI 状态并存，监听清理和 active window 选择容易串窗。
- SDD 同时维护磁盘草稿、Zustand、历史、Todo、Trace 和 AI response version，容易发生 stale writeback。
- Electron、sync/WebDAV、plugin marketplace/signature 和 headless CLI 均是高风险/近期变化面。
- Runtime-event snapshot 与 SDD trace 必须携带 source owner/generation，异步完成不能仅凭资源 ID 判断归属。
- Durable DecisionService 必须以单 actor 串行原子提交；所有 terminal 失败路径统一采用有界重试，并在 shutdown 排空 remember effects 后再进入最终持久化。
- `npmRebuild:false` 与 `node-pty` 需用打包产物证明 ABI 正确。
- E2E 当前仅一条 smoke，不能用 1536 个单测替代真实高风险路径。
- PowerShell 读取 UTF-8 必须显式编码，避免把终端解码误判为源码乱码。
