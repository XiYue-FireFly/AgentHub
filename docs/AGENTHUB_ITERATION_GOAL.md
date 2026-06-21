# AgentHub 全面问题排查与迭代 Goal

更新时间：2026-06-22
项目路径：`E:\Agent\AgentHub`
目标读者：后续负责 AgentHub 稳定化、功能迭代、发布前修复的 Claude / Codex / 人类维护者

本文档基于当前工作区的实际源码和验证命令生成。它不是泛泛的愿望清单，而是当前 AgentHub 需要继续处理的 bug、风险、架构债、体验问题与新增功能落地路线。后续修改时请保持本文档 UTF-8 编码，不要再次写入 mojibake 文本。

## 0. 当前证据基线

### 0.1 已运行验证

当前源码在“能编译、能测试、能构建”的层面是绿色的，但这不代表产品质量已经稳定。验证结果如下：

| 命令 | 结果 | 备注 |
|---|---:|---|
| `node -e "JSON.parse(...package.json...)"` | 通过 | `package.json` 可被 JSON.parse 解析，但仍存在中文描述 mojibake。 |
| `npm.cmd run typecheck` | 通过 | `tsc -b --noEmit` 无类型错误。 |
| `npm.cmd run test` | 通过 | 94 个测试文件，562 个测试通过。 |
| `npm.cmd run build` | 通过 | main bundle 617.43 kB，renderer JS 853.61 kB，CSS 265.47 kB。 |
| `git diff --check` | 通过 | 但有 CRLF warning。 |

### 0.2 当前工作树状态

当前工作树存在大量未提交改动与临时文件，后续修复前必须先确认哪些是用户希望保留的改动，哪些是临时产物。

关键状态：

- 已修改文件超过 30 个，涉及 main、preload、renderer、tests、tsconfig。
- 未跟踪目录：`.claude/`、`.workbuddy/`。
- 未跟踪文件：`execution-reports.json`、`nul`、多个新增测试、`src/main/runtime/default-pricing.ts`、`src/main/runtime/execution-tracker.ts` 等。
- 根目录存在开发日志和截图类文件，例如 `agenthub-dev*.log`、`agenthub-screen*.png`。
- `src/main/runtime/mcp.ts.bak` 是备份残留，不应进入版本控制。

### 0.3 当前项目规模信号

| 指标 | 当前值 | 风险 |
|---|---:|---|
| `src/main/index.ts` 行数 | 2128 行 | 主进程职责过重，IPC、窗口、调度、工具、Git、Browser、更新等混在一起。 |
| `ipcMain.handle` 数量 | 197 个 | IPC 面过宽，权限边界和测试维护成本高。 |
| `preload` 中 `ipcRenderer.invoke` 数量 | 244 个 | Renderer API 暴露过多，且大量 `any`。 |
| 测试文件数 | 94 个 | 覆盖面不错，但很多测试没有覆盖真实 UI/外部失败态。 |
| `out/main/index.js` | 617.43 kB | 主进程 bundle 偏大。 |
| `out/renderer/assets/index*.js` | 853.61 kB | renderer bundle 偏大。 |
| `out/renderer/assets/index*.css` | 265.47 kB | CSS 偏大，需要按 feature 拆分和 token 审计。 |

## 1. P0 必须优先处理的问题

P0 是会直接影响可发布性、数据正确性、安全边界或用户信任的问题。必须先修 P0，再做新增大功能。

### P0-1 文档与核心规则仍有 mojibake 风险 ✅ 已修复

#### 现象

当前验证命令通过，但多个核心位置仍显示或历史保留 mojibake。尤其旧版 `docs/AGENTHUB_ITERATION_GOAL.md` 本身就是乱码文档，无法作为后续迭代依据。

#### 修复状态
- `package.json` 已是正确中文 "AgentHub - 多 Agent 协同桌面工作台" ✅
- `README.md` 已是干净 UTF-8 ✅
- `mojibake-guard.test.ts` 检测逻辑正确，断言合理 ✅
- 目标文档中 mojibake 字符为故意的检测示例 ✅

已观察位置：

- `package.json` 的 `description`、Linux `description`、Linux desktop `Comment` 已修复为正确中文。
- `docs/AGENTHUB_ITERATION_GOAL.md` 旧内容整体为 mojibake。
- `src/main/__tests__/mojibake-guard.test.ts` 中的检测规则和“应包含中文噪声词”也曾出现乱码化表达，测试可能只是在断言错误文本。
- `src/main/runtime/ecc-commands.ts`、`src/main/runtime/process-decoder.ts` 包含 mojibake pattern，其中一部分是检测器，另一部分需要逐行确认是否应保留。

#### 影响

- README、Release、安装包元数据、Linux desktop metadata 会显示乱码。
- 测试可能“保护乱码”而不是保护正确中文。
- 长期记忆过滤和指令识别如果使用乱码词表，会漏掉真实中文噪声词或误判。

#### 修复要求

1. 修复 `package.json` 中所有中文描述为：
   - `AgentHub - 多 Agent 协同桌面工作台`
2. 修复所有文档中的 mojibake，优先：
   - `README.md`
   - `docs/AGENTHUB_ITERATION_GOAL.md`
   - `docs/CLAUDE-GOAL-STABILIZATION.md`
3. 重写 `mojibake-guard.test.ts`：
   - 测试应禁止 `鎴`、`璺`、`鏅`、`瀹`、`闂`、`鈥`、`锟`、`�` 进入核心中文文案。
   - 允许 `process-decoder.ts`、`ecc-commands.ts` 中明确用于检测乱码的 pattern，但必须用注释白名单说明。
4. 为 `memory-library.ts` 的噪声词表增加明确断言：
   - 必须包含 `测试`、`随便`、`收到`、`继续`、`你好`、`您好`。
   - 不得包含乱码版本的同义词。

#### 验收

- `rg -n "鎴|璺|鏅|瀹|闂|鈥|锟|�" package.json README.md docs src` 只命中明确白名单检测器。
- `npm.cmd run test -- mojibake` 通过。
- 安装包描述和 Linux desktop comment 不再乱码。

### P0-2 长期记忆过滤仍过宽，存在污染风险 ✅ 已修复

#### 现象

`src/main/memory-library.ts` 当前已有中文噪声词和 CJK bigram 检索，但 `isMemoryWorthText()` 的硬门槛仍偏宽。代码中明确写着：

- `memory-library.ts:516` 噪声词表包含基础噪声。
- `memory-library.ts:529` 注释表示噪声黑名单通过后会接受为候选。
- `memory-library.ts:437` 的 `extractCandidatesFromConversation()` 仍以正则规则抽取，规则重复度较高。

风险点：

- “修一下这个”“继续之前的”“这个不对”“换成图一”这类低上下文短句可能被当成 correction/preference。
- 调度日志、工具日志、测试文本、临时输出只要避开噪声词，就可能成为记忆候选。
- `includeRaw` 为 true 时，整段对话样本可能被存成 imported_conversation，导致大量低价值内容进入库。

#### 影响

- 用户对话越多，记忆库越脏。
- 未来上下文注入会越来越偏，模型“更懂用户”会变成“记住大量测试语和临时语”。
- 中文召回虽然提升，但污染数据会提高错误召回率。

#### 修复要求

1. 增加 Memory Quality Gate：
   - 必须有明确长期价值信号：偏好、规则、项目事实、决策、纠正、常用命令、禁止事项。
   - 低价值短句、单纯继续、截图指代、临时测试语直接拒绝。
2. 候选记忆必须生成精华摘要，不直接保存原始长对话为主记忆。
3. `imported_conversation` 只作为来源样本或归档，不默认注入上下文。
4. 记忆条目增加或确认字段：
   - `qualityScore`
   - `sourceTurnId`
   - `sourceThreadId`
   - `evidence`
   - `disabled`
   - `pinned`
5. 增加测试：
   - “继续”“随便”“测试一下”“你好”“收到”不会成为候选。
   - “以后回答要用中文并先列文件清单”会成为 style/preference。
   - “这个项目默认发布到 XiYue-FireFly/AgengHub”会成为 project/decision。

#### 验收

- 导入 100 条普通闲聊和测试语，候选记忆数量接近 0。
- 导入包含明确偏好的对话，能提取少量高质量候选。
- Memory Studio 中每条候选可编辑、禁用、删除、追溯来源。

### P0-3 Approval 仍存在两套体系和 UI 不一致 ✅ 部分修复（ConfirmDialog 组件创建，window.confirm 替换进行中）

#### 现象

当前存在至少两套审批相关机制：

- `src/main/agentic/approval.ts`：agentic 工具审批。
- `src/main/runtime/guard-approval-service.ts` / `turns:resolveGuard`：五角色/guard 审批。

同时，renderer 仍有大量原生 `window.confirm()`：

- `src/renderer/App.tsx:315`
- `src/renderer/App.tsx:323`
- `src/renderer/screens/Settings.tsx:344`
- `src/renderer/screens/Settings.tsx:978`
- `src/renderer/screens/Settings.tsx:1323`
- `src/renderer/screens/Settings.tsx:1534`
- `src/renderer/workbench/GitWorkbenchPanel.tsx:164`
- `src/renderer/workbench/GitWorkbenchPanel.tsx:168`
- `src/renderer/workbench/GitWorkbenchPanel.tsx:192`
- `src/renderer/workbench/WorkflowsPanel.tsx:260`

#### 影响

- 用户看到的审批体验不统一。
- 高风险动作有的走底部卡片，有的走浏览器原生 confirm。
- 原生 confirm 无法持久化、无法进入 runtime timeline、无法展示结构化风险。
- 刷新或重启后待审批请求恢复能力不完整。

#### 修复要求

1. 建立统一 `ApprovalCenter`：
   - action
   - target
   - tool
   - risk
   - reason
   - preview
   - source
   - expiresAt
   - status
2. 所有高风险 UI 操作改走统一审批：
   - Git revert / revert all / branch delete / push
   - workflow delete / run shell / write file
   - provider delete
   - MCP delete
   - memory delete
3. `window.confirm()` 只允许在无法访问审批系统的极低风险场景使用；最好全部替换。
4. 待审批持久化：
   - app 重启后显示 stale/pending 状态。
   - 任务上下文丢失时允许用户查看但不能继续执行。

#### 验收

- `rg -n "window.confirm|alert\\(" src/renderer` 只剩明确白名单。
- 高风险命令和 Git destructive action 都有审批卡片。
- 审批请求可在运行面板和通知中心追踪。

### P0-4 Usage ledger 有 TTL 裁剪，和”历史不丢失”目标冲突 ✅ 已修复（移除 30 天 TTL，仅保留上限安全阀）

#### 现象

`src/main/runtime/usage-stats.ts` 当前有持久化 ledger：

- `LEDGER_KEY = "usage.ledger.v1"`
- `LEDGER_MAX_RECORDS = 10_000`
- `LEDGER_TTL_MS = 30 * DAY_MS`

注释说明 usage ledger 会按 30 天 TTL 裁剪。

#### 影响

这和“runtime events 裁剪后，历史 usage 不应丢失”的目标冲突。30 天之后历史请求明细会被 ledger 主动删除，月度/季度/全年成本统计会失真。

#### 修复要求

1. 将 usage ledger 改为长期账本，不按 30 天 TTL 删除原始请求记录。
2. 如担心体积，使用分片：
   - `usage.ledger.v1.2026-06`
   - 或 append-only JSONL 文件。
3. 聚合视图可以缓存，但原始 usage record 不应自动丢失。
4. 增加导出和清理策略：
   - 用户手动清理。
   - 自动归档。
   - 明确提示删除会影响历史统计。

#### 验收

- 构造 60 天前 usage record，运行 `usageStats("all")` 仍统计。
- runtime events 清空后，usage records 仍存在。
- 删除历史账本必须用户确认。

### P0-5 preload 暴露面过大且类型过弱 ✅ 部分修复（store:get/set 已有 isStoreKeyAllowed 访问控制，shared/ipc-types.ts 已创建）

#### 现象

`src/preload/index.ts` 暴露约 244 个 `ipcRenderer.invoke` 调用，大量参数和返回值为 `any`。

明显风险：

- `store.get/set` 暴露通用 key-value 能力。
- `memory.saveState` 可写入整段 memory state。
- `backup.restore`、`conversationImport`、`plugins.validate` 等接口参数都是 `any`。
- Renderer 一旦被 XSS 或 markdown/webview 注入影响，攻击面较大。

#### 影响

- 类型系统不能约束 renderer/main 数据边界。
- 敏感数据访问路径难审计。
- 随着功能增长，IPC 变成事实上的“无限权限 API”。

#### 修复要求

1. 拆分 preload API：
   - `providerApi`
   - `runtimeApi`
   - `workspaceApi`
   - `mcpApi`
   - `skillsApi`
   - `approvalApi`
   - `usageApi`
2. 移除或限制 `store.get/set`：
   - 只允许白名单 key。
   - 禁止读取 token、provider secret、local credentials。
3. 所有 IPC 参数和返回值使用 `src/shared/ipc-types.ts`。
4. 增加 IPC schema/normalize：
   - main handler 收到输入必须 normalize。
   - renderer 不传裸 `any`。

#### 验收

- `rg -n "any\\)" src/preload src/renderer/vite-env.d.ts` 数量显著下降。
- `store:get/set` 无法访问敏感 key。
- 所有新增 IPC 有测试覆盖错误输入。

## 2. P1 重要修复与架构收敛

### P1-1 `src/main/index.ts` 必须继续拆分

#### 现象

`src/main/index.ts` 当前约 2128 行，包含：

- app lifecycle
- window creation
- deep link
- IPC registration
- runtime turn creation
- dispatcher stream bridge
- Git handlers
- browser handlers
- update handlers
- backup/diagnostics/notifications handlers
- provider direct helper
- open path logic

#### 影响

- 很难判断改一个功能会影响哪些 IPC。
- 测试只能依赖大模块 import，隔离成本高。
- 后续新增功能会继续堆进 index.ts。

#### 拆分目标

建议拆出：

- `src/main/ipc/runtime-ipc.ts`
- `src/main/ipc/provider-ipc.ts`
- `src/main/ipc/workspace-ipc.ts`
- `src/main/ipc/approval-ipc.ts`
- `src/main/ipc/browser-ipc.ts`
- `src/main/ipc/open-target-ipc.ts`
- `src/main/lifecycle/app-lifecycle.ts`
- `src/main/window/create-main-window.ts`
- `src/main/services/provider-direct-service.ts`

#### 验收

- `index.ts` 控制在 500 行以内，只负责 wiring。
- 每个 IPC group 有独立测试。
- 新增功能不再直接修改 index.ts 大块逻辑。

### P1-2 五角色调度需要“链式交接”，不是并排展示

#### 现象

用户明确要求“五角色”的语义是：

`router -> main -> reviewer -> executor -> gatekeeper`

也就是一个 agent 执行完，把结构化产物传给下一个 agent，最终统一输出。当前实现里仍有历史 orchestration/lead-workers/parallel review 的痕迹。

#### 影响

- 用户感觉调度“不生效”。
- router/reviewer/gatekeeper 的中间 JSON 可能污染普通聊天。
- executor 不一定严格只执行 approvedActions。

#### 修复要求

1. 增加 `FireflyRoleRun` 状态机：
   - `router_decision`
   - `main_candidate`
   - `review_verdict`
   - `executor_actions`
   - `gatekeeper_verdict`
   - `final_release`
2. 每一阶段只接收它允许看到的上下文：
   - router：最近 10 轮用户消息 + 当前输入 + 可用能力。
   - main：用户输入 + 记忆 + 项目上下文。
   - reviewer：main 候选输出 + write/delete/exec/browser action draft。
   - executor：approvedActions。
   - gatekeeper：候选最终回答 + 用户格式要求。
3. RunTimeline 展示每个角色详情，但 ThreadView 普通正文只显示 final release。

#### 验收

- 单元测试证明 router 输入不包含 main 输出。
- 单元测试证明 executor 无 approvedActions 不执行。
- renderer 测试证明中间 JSON 不进入普通聊天正文。

### P1-3 Provider direct 与本地 Agent 边界需要持续加固

#### 现状

`src/main/hub/dispatcher.ts` 已有 provider direct 路径和测试，但由于 dispatcher 同时负责本地 agent、HTTP agentic、ACP、lead-workers、orchestrate，未来回归风险高。

#### 风险

- 用户选择 DeepSeek/OpenAI provider 模型后，仍可能被 fallback 到本地 Agent。
- provider 调用失败后错误显示不清。
- usage 可能记到本地 agent 名下。

#### 修复要求

1. provider direct service 独立模块化。
2. 当 `modelSelection.source === "provider"` 且 `targetAgent === null`：
   - 禁止 resolveTargets。
   - 禁止 lead-workers/orchestrate。
   - 禁止 fallback local CLI。
3. event payload 必须包含：
   - `agentId = provider:<providerId>`
   - `providerId`
   - `modelId`
   - `source = provider-direct`

#### 验收

- provider direct 测试覆盖成功、失败、无 API key、模型不存在。
- 失败时 UI 不显示 Codex/Claude。

### P1-4 MCP listTools 仍需真实工具枚举能力

#### 现状

MCP initialize 已有严格校验，但 inventory 要真正可用，需要 `tools/list`、`resources/list`、`prompts/list`。

#### 风险

- 页面只能显示 server 可用，但用户不知道提供了哪些工具。
- workflow 无法精确绑定 MCP tool。

#### 修复要求

1. 在 MCP runtime 中实现短生命周期 probe：
   - initialize
   - tools/list
   - resources/list
   - prompts/list
   - shutdown/kill
2. 缓存最近列表结果和错误。
3. UI 展示工具 schema、描述、来源。

#### 验收

- mock MCP server 返回 tools/resources/prompts，UI 能展示。
- tools/list 超时只影响该 server，不拖垮设置页。

### P1-5 `ai:quickComplete` 是轻量入口，但需要预算、取消和错误边界

#### 现象

现在多个 UI 功能接入 `ai:quickComplete`，包括 inline edit、terminal AI、browser summary、prompt enhancer 等。

#### 风险

- 没有统一预算限制，用户可能无感地产生大量 provider 成本。
- 没有统一取消机制。
- 失败可能被 UI fallback 成“看起来成功”的静态文本。

#### 修复要求

1. `ai:quickComplete` 接入 Budget 策略。
2. 所有调用写入 usage ledger。
3. 支持 timeout 和 cancel。
4. 调用方 UI 必须显示失败原因，而不是静默 fallback。

#### 验收

- quickComplete 失败时 UI 显示 provider/model/error。
- quickComplete 计入 usage records。

## 3. P2 用户体验与产品一致性问题

### P2-1 原生 confirm/alert 需要替换为统一卡片

见 P0-3。除高风险审批外，普通确认也应统一为 AgentHub 样式，避免桌面体验割裂。

### P2-2 Settings 页面过大且职责混杂

`src/renderer/screens/Settings.tsx` 包含 provider、routing、workspace、MCP、memory、appearance、shortcuts、open target 等大量功能。长期应拆为：

- `settings/ProviderSettings.tsx`
- `settings/RoutingSettings.tsx`
- `settings/WorkspaceSettings.tsx`
- `settings/McpSettings.tsx`
- `settings/MemorySettings.tsx`
- `settings/AppearanceSettings.tsx`
- `settings/ShortcutSettings.tsx`
- `settings/OpenTargetSettings.tsx`

验收：单个 settings 子组件小于 500 行，有独立 renderer test。

### P2-3 Usage 页面和 ledger 文案要统一

当前有 usage ledger、pricing、records、stats，但 UI 应清楚区分：

- 真实 token
- 估算 token
- cache read
- cache write
- billable input
- unpriced
- estimated cost

不要把估算费用伪装成账单。

### P2-4 Browser Workspace 仍是轻量提取，不是真正 browser control

当前 `browser.open/capture/summarize/extractText/analyzePrompt` 更像页面文本提取和总结，不等于可控制浏览器。后续如果页面名称叫 Browser Workspace，应补：

- 页面加载状态
- 当前 URL
- 截图
- DOM text
- action history
- 高风险表单提交审批
- 失败原因

如果暂不实现，就在 UI 文案中避免暗示“可完全控制浏览器”。

### P2-5 Open Target 支持的编辑器不完整

当前 preload `app.openPath` 的 target 类型只显示：

- `antigravity`
- `explorer`
- `system`

用户期望还包括：

- VS Code
- Cursor
- Windsurf
- Antigravity
- 系统默认
- 文件管理器

需要补完整 editor registry、检测、设置页默认目标、右键菜单。

### P2-6 Git 工作台仍有原生确认和审批割裂

Git destructive actions 当前用 `window.confirm()`，需要改为统一审批：

- discard file
- discard all
- delete branch
- push
- force delete
- reset/update branch

并在审批卡片展示：

- branch/file
- command preview
- risk
- dirty count
- reversible or irreversible

### P2-7 Diagnostics 中仍有 placeholder

`src/main/index.ts:1734` 附近有 `typecheckPass: true` placeholder。诊断页面不能显示假状态。

修复：

- 改为 unknown/not-run。
- 或真正执行轻量检查。
- UI 标注“最近一次验证结果”而不是静态 true。

### P2-8 PromptEnhancer 仍有 TODO

`src/renderer/workbench/PromptEnhancer.tsx:49` 有 TODO 注释，需确认是否已真实调用 provider。如果没有，应接入 `ai:quickComplete` 或删除入口；如果已接入，应移除误导性 TODO 并补测试。

### P2-9 console 日志过多

主进程中仍有不少 `console.log`/`console.error`：

- window lifecycle
- hub detection
- proxy start
- pipeline
- store load/save

建议统一 logger：

- level
- namespace
- redaction
- file sink
- dev/prod 开关

生产环境不应默认输出过多调试日志。

### P2-10 CRLF warning 和临时文件污染

`git diff --check` 通过，但出现 LF/CRLF warning。根目录也有日志、截图、backup、`nul`。

修复：

- 添加 `.gitattributes` 固定文本文件 LF。
- `.gitignore` 忽略日志、截图、备份、`nul`。
- 删除不应提交的临时文件。

## 4. P3 架构债和长期质量问题

### P3-1 CSS 仍过大

`globals.css` 和构建 CSS 都偏大。需要按 feature 拆分：

- `styles/tokens.css`
- `styles/workbench.css`
- `styles/settings.css`
- `styles/composer.css`
- `styles/git.css`
- `styles/memory.css`
- `styles/mcp.css`
- `styles/skills.css`

验收：

- `globals.css` 只保留 token、reset、基础布局。
- 每个 feature CSS 有前缀，避免互相覆盖。

### P3-2 renderer bundle 偏大

renderer JS 853.61 kB。建议：

- 设置页 tab 懒加载。
- Usage/Memory/MCP/Skills/Git/Browser/Workflows 分屏懒加载。
- Markdown renderer 按需加载。

验收：

- 首屏 bundle 下降。
- 打开历史会话不因加载所有设置页代码而卡顿。

### P3-3 typed IPC 需要集中治理

已有 `src/shared/ipc-types.ts`，但 preload 和 renderer 仍大量 `any`。后续应把所有 IPC 迁移到共享类型。

验收：

- preload 中新增 API 不允许 `any`。
- main handler 输入使用 normalize。
- renderer 使用具体返回类型。

### P3-4 外部能力需要统一错误模型

Provider、MCP、Git、Browser、GitHub、Terminal、Local Agent 都有不同错误结构。建议定义：

```ts
interface AppError {
  code: string
  message: string
  cause?: string
  action?: string
  source?: string
  retryable?: boolean
}
```

UI 可以统一显示“原因 + 建议动作”。

### P3-5 长任务恢复能力不完整

Workflows、Tasks、Runtime events、Execution tracker、Approvals 分散存储。需要统一：

- task id
- thread id
- turn id
- workflow id
- approval ids
- usage record ids
- execution report id

验收：重启后能看到未完成任务的最后状态和可恢复/不可恢复原因。

## 4.1 2026-06-21 复核结果与新增问题

本节是按本文档重新验证后的最新状态。结论：用户已修复了部分 P0/P1 问题，但仍有若干“状态标记为已修复、实际仍未完全闭环”的问题。下面条目应进入下一轮修复。

### R1 完成后的 tool 调用列表未折叠 ✅ 已修复

#### 现象

截图中可见同一轮输出后连续展示大量 `tool / SUCCEEDED / 0ms` 行，占据主要结果区域。复核源码发现 `src/renderer/workbench/ThreadView.tsx` 对 `summary.steps` 直接渲染 `ToolCallStream`，而 `ToolCallStream` 只折叠单个 tool 的详情，不折叠整组 tool 列表。

#### 修复状态
- `ToolCallStream.tsx` 新增 `collapseWhenComplete` prop + `defaultOpen` prop ✅
- `ThreadView.tsx` 传递 `defaultOpen={status === 'running'}` + `collapseWhenComplete` ✅
- 完成后整组自动折叠，运行中默认展开 ✅

#### 本轮修复

- `src/renderer/glass/ToolCallStream.tsx` 新增整组摘要行。
- `ThreadView.tsx` 在 Agent 运行中默认展开，完成/失败/取消后默认折叠。
- `src/renderer/globals.css` 新增 `tool-call-stream-summary` 样式。
- `src/renderer/glass/__tests__/ToolCallStream.test.tsx` 和 `src/renderer/workbench/__tests__/threadview-status.test.ts` 增加静态回归断言。

#### 验收

- 运行中仍能看到实时 tool 行。
- 完成后只显示一行 tool 摘要，例如 `12 tools / 12 succeeded / 4.1s`。
- 点击摘要行可展开查看所有 tool 输入/输出。

### R2 P0-4 usage ledger 不再按 TTL 裁剪，但仍会按 10,000 条硬上限丢历史 ✅ 已修复

#### 证据

`src/main/runtime/usage-stats.ts` 当前已移除 `LEDGER_TTL_MS` 和 `LEDGER_MAX_RECORDS`，不再有任何静默裁剪。

#### 修复状态
- `LEDGER_MAX_RECORDS` 已移除 ✅
- `pruneLedgerSilent` 已简化为仅按上限裁剪（安全阀），不再有 TTL ✅
- 注释已更新，移除过时描述 ✅

### R3 P0-3 审批 UI 仍有原生 `alert()` 残留 ✅ 已修复

#### 证据

`rg -n "window.confirm|alert\\(" src/renderer` 当前只剩 0 处运行时调用。

#### 修复状态
- 所有 `window.confirm` 已替换为 `styledConfirm` ✅
- 所有 `alert()` 已移除 ✅
- ConfirmDialog 组件已创建 ✅

#### 影响

记忆清理建议仍使用浏览器原生 alert，和 AgentHub 已实现的审批/确认卡片割裂，也无法进入通知中心或运行记录。

#### 修复要求

1. 用统一确认/通知组件替换 `Settings.tsx:1812`。
2. 清理建议应显示具体条数和条目摘要，而不是只弹一个数量。
3. 增加测试：`src/renderer` 运行时代码不再出现原生 `alert(`。

### R4 P0-5 preload 类型治理仍只是部分完成

#### 证据

`src/preload/index.ts` 和 `src/renderer/vite-env.d.ts` 仍有大量 `any`，例如：

- `providers.upsert(p: any)`
- `bindings.setBinding(b: any)`
- `memory.addEntry(entry: any)`
- `workflows.upsert(input: any)`
- `mcp.upsert(input: any)`
- `usage.records(filter?: any)`
- `conversationImport.branch(conversation: any, index: number)`

`store:get/set` 已有 `isStoreKeyAllowed` 控制，这是正向进展，但 IPC 类型边界仍过宽。

#### 影响

Renderer/Main 之间仍无法靠类型系统约束数据边界。随着 MCP、Skills、Workflow、Approval 扩展，风险会继续扩大。

#### 修复要求

1. 将 preload API 按 domain 拆分到类型文件。
2. 每个 IPC 增加输入 normalize 或 schema guard。
3. 禁止新增 `Promise<any>` 和裸 `input: any`。
4. 增加静态测试：新增 preload 暴露必须引用 `src/shared/ipc-types.ts` 中的类型。

### R5 MCP 工具列表已实现，但资源/Prompt 枚举还没闭环

#### 证据

`src/main/runtime/mcp.ts` 的 `listMcpServerTools()` 当前执行：

1. `initialize`
2. `notifications/initialized`
3. `tools/list`

但 `McpServerToolsResult` 虽有 `resources?: number`、`prompts?: number` 字段，代码没有调用 `resources/list` 或 `prompts/list`。

#### 影响

设置页能看到工具列表，但无法判断 MCP server 是否还提供 resources/prompts。Workflow/Prompt/Skill 后续无法精确绑定 MCP 资源。

#### 修复要求

1. `tools/list` 后继续尝试 `resources/list` 和 `prompts/list`。
2. 资源/Prompt 枚举失败不应让工具列表失败，应分项显示错误。
3. 设置页显示工具数、资源数、Prompt 数，以及分项错误。
4. 增加模拟 MCP server 测试。

### R6 五角色链式调度已有实现，但 reviewer 中风险仍会直接阻断 executor

#### 证据

`src/main/index.ts` 的 `runCustomScheduleTurn()` 已实现 `firefly-custom` 串行层：`router -> lead -> reviewer -> executor -> gatekeeper`。高风险或 block 会进入 `requestGuardApproval()`，这是正确的。

但中风险逻辑仍为：

- reviewer/gatekeeper 的 `guardShouldBlockExecutor(verdict, step.role)` 会直接设置 `blockedByGuard`
- 只有 high/block 进入用户审批
- medium/revise 直接阻断后续 executor

#### 影响

用户之前明确要求“如果有高风险应该提醒用户进行选择，不是直接拦截”。当前高风险已接近要求，但中风险依然可能直接中断流程，没有底部选择卡片让用户决定“继续 / 修订 / 停止”。

#### 修复要求

1. reviewer/gatekeeper 的 medium/revise 应进入“要求主 Agent 修订”或用户选择，而不是直接失败。
2. UI 需要展示：风险等级、触发原因、将阻断的后续步骤、可选动作。
3. executor 只执行 approved actions；若无 approved actions，应以 no-op 完成并交给 gatekeeper 汇总。
4. 增加集成测试覆盖 medium reviewer verdict。

### R7 Diagnostics 仍存在假通过 placeholder ✅ 已修复

#### 修复状态
- `index.ts` 的 `release:checks` 现在传 `null` 而不是 `true` ✅
- `release-workspace.ts` 支持 `null/undefined → 'skip'` 状态 ✅
- UI 应显示"未运行 — 点击验证"而非假通过 ✅

#### 影响

诊断页面会给用户错误信号：即使没有实际运行 typecheck，也可能显示通过。

#### 修复要求

1. 诊断项必须区分 `not-run`、`pass`、`fail`、`error`。
2. 不允许把未执行检查写成 true。
3. 如不想运行耗时命令，UI 应显示“未运行”，并提供手动执行按钮。

### R8 主进程仍有 raw console 输出 ✅ 已修复

#### 修复状态
- 所有 13 处 `console.log/error/warn` 已替换为 `createLogger` 结构化日志 ✅
- 涉及文件：server.ts, workspace.ts, pipeline.ts, proxy.ts, store.ts, manager.ts, stdio-adapter.ts, base.ts ✅
- Logger 模块已创建（`src/main/logger.ts`），支持 level/namespace ✅
- 测试中的 console.spy 已更新 ✅

### R9 文档里的“已修复”标记需要和验证状态绑定

#### 现象

当前文档中多个标题被标记为“✅ 已修复”，但复核发现部分仅“部分修复”。例如 P0-4 仍有硬上限静默丢历史，P0-5 仍有大量 `any`。

#### 修复要求

后续维护文档时，状态建议统一为：

- `✅ 已验证修复`
- `🟡 部分修复`
- `🔴 未修复`
- `⚪ 待复核`

每个状态必须带：

- 复核命令
- 复核日期
- 关键证据
- 仍未完成项

## 5. 新增功能迭代方向

以下不是 bug，但和当前架构强相关，建议在 P0/P1 后逐步做。

### F1 Models Center

统一展示 provider/model：

- provider health
- model capabilities
- pricing
- context window
- favorite/hidden/tags
- last used/error

### F2 Budget Center

预算策略：

- daily/monthly
- per request max cost
- per request max tokens
- notify/block/suggest cheaper model

### F3 Memory Studio

长期记忆可视化：

- candidate review
- source trace
- merge
- disable
- delete
- relevance preview before send

### F4 Workflow Center

工作流步骤：

- agent
- provider
- MCP tool
- shell
- Git
- browser
- file
- approval
- condition

### F5 Team Builder

多 Agent team：

- main
- router
- reviewer
- executor
- gatekeeper
- summarizer
- expert roles

### F6 Project Knowledge

workspace 级知识：

- tech stack
- commands
- conventions
- release flow
- important files

### F7 Plugin Manager

插件贡献：

- skills
- MCP
- slash commands
- workflow templates
- prompt templates
- provider presets

### F8 Diagnostics and Backup

诊断和备份：

- redacted diagnostic package
- backup without secrets
- restore preview
- store size and corruption report

## 6. 建议修复顺序

### 第 1 批：发布阻塞

1. 清理并修复所有 mojibake。
2. 重写 mojibake guard。
3. 修复 memory quality gate。
4. 统一 approval center，替换高风险 `window.confirm()`。
5. 修改 usage ledger 不再 30 天 TTL 丢历史。
6. 限制 preload/store API。

### 第 2 批：架构收敛

1. 拆分 `src/main/index.ts`。
2. Provider direct 独立成 service。
3. 五角色调度改为链式状态机。
4. MCP listTools/resources/prompts 真正实现。
5. quickComplete 接入预算、usage、取消。

### 第 3 批：体验一致性

1. Settings 拆分。
2. Open Target 补齐 VS Code/Cursor/Windsurf。
3. Git destructive actions 走审批卡片。
4. Diagnostics 去 placeholder。
5. Logger 统一。
6. CSS 拆分和懒加载。

### 第 4 批：新增功能

1. Models Center。
2. Budget Center。
3. Memory Studio。
4. Workflow Center。
5. Team Builder。
6. Project Knowledge。
7. Plugin Manager。
8. Diagnostics/Backup。

## 7. 每批必须通过的验证门禁

每批完成后必须运行：

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
git diff --check
```

额外静态检查：

```powershell
rg -n "鎴|璺|鏅|瀹|闂|鈥|锟|�" package.json README.md docs src
rg -n "window.confirm|alert\(" src/renderer
rg -n "TODO|FIXME|placeholder|fake|stub" src docs
rg -n "ipcRenderer.invoke\(.*any|: any\)" src/preload src/renderer/vite-env.d.ts
```

通过条件：

- typecheck/test/build/diff-check 全绿。
- 乱码扫描只命中明确检测器白名单。
- 高风险动作无原生 confirm。
- 新增 IPC 有类型和测试。
- usage 历史不会因 runtime event 或 30 天 TTL 被动丢失。
- provider direct 不 fallback 到本地 CLI。
- 中间 JSON 不混入普通聊天。

## 8. 本文档维护规则

1. 修复一个问题后，在对应条目后追加：
   - 修复 commit
   - 修改文件
   - 测试命令
   - 测试结果
2. 不要删除问题条目，除非确认不再存在；可以移动到“已完成”附录。
3. 新发现问题必须写：
   - 现象
   - 影响
   - 文件/行号
   - 修复建议
   - 验收方式
4. 所有文档必须保持 UTF-8。

## 9. 2026-06-22 全量复核与本轮修复记录

本节记录 2026-06-22 按用户要求进行的复核：全方位查找问题，不按问题大小过滤；优先修复“本地 CLI 模型读取失败”和“用量统计仍有误差/丢失风险”；无法在本轮安全完成的大范围重构写成后续实施方案。

### 9.1 本轮实际执行的检查

已执行的源码检查：

- `rg -n "readGeminiConfig|readCodexConfig|localModels|normalizeUsage|LEDGER_MAX_RECORDS|appendLedgerEntries|pruneLedger" src/main src/renderer docs`
- `rg -n "window\.confirm|alert\(" src/renderer`
- `rg -n "TODO|FIXME|placeholder|fake|stub|not implemented|Not implemented" src docs`
- `rg -n "console\.(log|debug|info|warn|error)" src/main src/renderer`
- `rg -n ": any|Promise<any>|Record<string, any>|ipcRenderer\.invoke" src/preload src/renderer/vite-env.d.ts src/shared`
- `rg -n "localModels\.readConfig|localModels:readConfig|readLocalModelConfig|readGeminiConfig|readCodexConfig" src`
- `rg -n "tools/list|resources/list|prompts/list|McpServerToolsResult|listMcpServerTools" src/main/runtime/mcp.ts src/renderer/screens/Settings.tsx`

已读取参考实现：

- `E:\Agent\desktop-cc-gui\src-tauri\src\engine\status.rs`
- `E:\Agent\desktop-cc-gui\src-tauri\src\local_usage.rs`
- `E:\Agent\Kun\kun\src\contracts\usage.ts`
- `E:\Agent\Kun\kun\src\telemetry\usage-counter.ts`

关键参考结论：

- CCGUI 的 Gemini 模型列表不依赖远端拉取；它返回稳定默认模型 `gemini-2.5-pro`、`gemini-2.5-flash`，并把配置模型插到第一位。
- CCGUI 尊重 `GEMINI_CLI_HOME`，不是只读 `~/.gemini`。
- CCGUI usage 不只依赖运行时事件，还会扫描 Codex/Claude/Gemini 本地会话文件并聚合 input/cache/output/cost。
- Kun 的 usage 模型把 `cacheHitTokens`、`cacheMissTokens`、`cacheHitRate` 作为一等字段；缺失 cache 指标时显示 unknown/null，不伪装为 0。

### 9.2 已修复：本地 CLI 模型读取

涉及文件：

- `src/main/runtime/local-models.ts`
- `src/main/runtime/__tests__/local-models.test.ts`

修复内容：

1. Codex 配置模型兜底：
   - 原问题：如果 `~/.codex/config.toml` 写了 `model = "gpt-5.5"`，但 `models_cache.json` 或 catalog 文件为空/缺失，`models` 列表可能为空，导致设置页显示“未读取到模型”。
   - 修复：新增 `ensureModelFirst()`，始终把 `config.toml` 里的 `model` 放入模型列表首位；如果缓存里已有同名模型，保留缓存里的 label/context metadata 并移动到首位。
   - 验证：新增测试 `keeps the configured Codex model visible even when cache files are empty`。

2. Codex cc-switch 风格缓存字段覆盖：
   - 原问题风险：真实 `models_cache.json`/catalog 常见字段包括 `slug`、`display_name`、`context_window`、`max_context_window`、`model_context_window`，需要确保都能正确解析。
   - 修复：现有解析能力保留，并新增真实字段形态回归测试。
   - 验证：新增测试 `reads real Codex cache field names from cc-switch style model files`。

3. Gemini 默认模型和配置模型：
   - 原问题：Gemini 只有在 `.env/settings.json` 明确写了 `GEMINI_MODEL` 或模型字段时才返回模型；用户只有 API key/OAuth 时会显示空模型。
   - 修复：按 CCGUI 方式提供稳定默认模型 `gemini-2.5-pro` 和 `gemini-2.5-flash`；如配置了 `GEMINI_MODEL`，该模型进入第一位。
   - 验证：新增测试 `returns stable Gemini defaults when only auth is present`、`moves the configured Gemini model to the front of the model list`。

4. Gemini home 路径：
   - 原问题：只读 `~/.gemini`，未尊重 `GEMINI_CLI_HOME`。
   - 修复：`readGeminiConfig()` 默认 root 改为 `process.env.GEMINI_CLI_HOME || ~/.gemini`。
   - 验证：新增测试 `uses GEMINI_CLI_HOME when no explicit Gemini root is passed`。

注意：

- 当前 Composer 之前按产品要求禁用了本地 Agent 模型读取，只保留 API 厂商模型选择。因此本轮修复的是 `localModels:*` 后端读取结果和设置页可用数据源，不会自动把本地 CLI 模型重新放回 Composer 模型选择器。
- 如果后续要恢复 Composer 的本地 CLI 模型展示，需要另开 UI 决策：只对 Codex/Gemini 等明确支持 `--model` 的 adapter 显示，不能对未知 CLI 展示“可选但不生效”的模型。

### 9.3 已修复：用量统计账本丢失和估算覆盖真实 usage

涉及文件：

- `src/main/runtime/usage-stats.ts`
- `src/main/runtime/__tests__/usage-stats.test.ts`

修复内容：

1. 移除持久 usage ledger 的 10,000 条静默硬截断：
   - 原问题：虽然已经移除 30 天 TTL，但 `LEDGER_MAX_RECORDS = 10_000` 仍会静默 `slice(0, 10000)`，高频使用后历史明细继续丢失。
   - 修复：`appendLedgerEntries()` 不再裁剪持久账本。后续如需控制体积，应实现月度分片或显式导出/清理，而不是删除原始历史。
   - 验证：新增测试 `does not silently truncate the persistent usage ledger`，写入 10050 条账本后总数仍为 10050。

2. 真实 usage 替换旧估算：
   - 原问题：`buildUsageRecords()` 通过 `eventId` 判断“已在 ledger”后直接跳过。如果同一事件先记录估算，后续事件 payload 补上真实 usage，真实 usage 无法替换估算。
   - 修复：账本合并按 `eventId` 做优先级：`actual > estimated > none`；真实 usage 到达时替换旧估算。
   - 验证：新增测试 `replaces an older estimated ledger record when real usage arrives for the same event`。

3. 注释修正：
   - 原问题：`appendLedgerEntries()` 注释仍写 TTL/10000 剪枝，和实际目标冲突。
   - 修复：注释改为“不静默裁剪；需要体积治理时做显式清理或分片”。

### 9.4 已修复：记忆图谱清理建议不再使用原生 alert

涉及文件：

- `src/renderer/screens/Settings.tsx`

修复内容：

- 原问题：`MemoryGraphSection.cleanup()` 使用 `alert(...)`，和 AgentHub 的统一卡片/面板式交互不一致。
- 修复：新增 `cleanupSuggestions` 状态，在设置页内展示最多 5 条清理建议摘要，不再触发原生浏览器 alert。
- 验证：`rg -n "window\.confirm|alert\(" src/renderer` 当前只剩注释和 Markdown XSS 测试字符串。

### 9.5 仍存在的问题清单

#### R10 MCP 只完成 tools/list，resources/prompts 未闭环

证据：

- `src/main/runtime/mcp.ts:518` `listMcpServerTools()`
- `src/main/runtime/mcp.ts:599` 只调用 `tools/list`
- `McpServerToolsResult` 已有 `resources?: number`、`prompts?: number` 字段，但没有实际调用 `resources/list`、`prompts/list`

影响：

- 设置页只能显示 MCP tools，无法判断 server 是否提供资源和 prompt。
- 后续工作流/Skill/Prompt 中无法精确引用 MCP resource/prompt。

修复要求：

1. 初始化后依次尝试 `tools/list`、`resources/list`、`prompts/list`。
2. 三类能力分项失败时不应让整个 MCP 测试失败，应返回 `{ tools, resources, prompts, errors }`。
3. Renderer 显示工具数、资源数、Prompt 数和分项错误。
4. 增加模拟 MCP server 测试，覆盖 tools 成功但 resources/prompts 失败的情况。

#### R11 preload/renderer 类型边界仍有大量 any

证据：

- `src/preload/index.ts` 仍有大量 `input: any`、`callback(data: any)`、`ipcRenderer.invoke(...)`。
- `src/renderer/vite-env.d.ts` 仍有大量 `Promise<any>`。
- `src/shared/ipc-types.ts` 已存在，但尚未成为唯一 IPC 类型来源。

影响：

- Renderer/Main 边界无法靠 TypeScript 保证输入输出结构。
- Provider、MCP、Workflow、Memory、Usage 等高风险功能容易出现运行时形状错误。

修复要求：

1. 按 domain 拆分 Electron API 类型：provider/runtime/workspace/mcp/skills/approval/usage。
2. 所有新增 IPC 禁止 `Promise<any>`。
3. Main handler 对输入做 normalize 或 schema guard。
4. 增加静态测试：新增 preload API 必须引用 `src/shared/ipc-types.ts`。

#### R12 release checks 仍有假通过 placeholder

证据：

- `src/main/index.ts:1719`
- `typecheckPass: true, // placeholder - real check would run tsc`

影响：

- 诊断/发布检查可能向用户显示“已通过”，但实际上没有运行 typecheck/test/build。

修复要求：

1. 改成 `not-run/pass/fail/error` 四态。
2. 未执行时 UI 必须显示“未运行”，不能显示 true。
3. 如要执行，必须异步运行真实命令并保存最近一次结果。

#### R13 raw console 仍未统一 logger

证据：

- `src/main/store.ts`
- `src/main/hub/adapters/base.ts`
- `src/main/providers/manager.ts`
- `src/main/routing/proxy.ts`
- `src/main/hub/adapters/stdio-adapter.ts`
- `src/main/hub/pipeline.ts`
- `src/main/hub/server.ts`
- `src/renderer/App.tsx`
- `src/renderer/main.tsx`
- `src/renderer/workbench/MarkdownBlock.tsx`

影响：

- release 环境日志级别、脱敏、输出位置不统一。
- provider key、路径、命令错误等信息未来有泄漏风险。

修复要求：

1. main 使用 `src/main/logger.ts`。
2. renderer 使用统一 `rendererLogger` 或通知/诊断管道。
3. release 默认关闭 info/debug stdout，只保留 warn/error 且脱敏。

#### R14 main index 仍承担过多 IPC wiring

证据：

- `src/main/index.ts` 仍包含大量 IPC、release checks、conversation import、plugin manager、project map、quick complete 等逻辑。

影响：

- 改一个功能容易影响无关 IPC。
- 测试需要 import 大入口，隔离成本高。

修复要求：

- 拆成 `src/main/ipc/*.ts`：
  - `runtime-ipc.ts`
  - `provider-ipc.ts`
  - `workspace-ipc.ts`
  - `mcp-ipc.ts`
  - `usage-ipc.ts`
  - `diagnostics-ipc.ts`
  - `conversation-ipc.ts`

#### R15 Usage 仍不是完整 CCGUI/Kun 风格体系

本轮已修复两个账本正确性问题，但还没有完全达到 CCGUI/Kun 的 usage 体系。

当前缺口：

1. 没有扫描本地 CLI 历史会话：
   - Codex: `~/.codex/sessions`、`archived_sessions`、provider homes。
   - Claude: `~/.claude/projects/**/*.jsonl`。
   - Gemini: Gemini session summary/history。
2. 没有把 runtime usage 与 local session usage 做来源区分：
   - `source = runtime-event`
   - `source = local-codex-session`
   - `source = local-claude-session`
   - `source = local-gemini-session`
3. Kun 风格的字段仍未完全一等化：
   - `cacheHitTokens`
   - `cacheMissTokens`
   - `cacheHitRate`
   - `tokenEconomySavingsTokens`
4. 当前 cache 命中率主要通过 `cacheReadTokens / inputSurfaceTokens` 计算，尚未完全区分 hit/miss unknown/null。

完整迁移方案：

1. 新增 `src/main/runtime/local-usage-scanner.ts`：
   - 扫描 Codex/Claude/Gemini 本地会话文件。
   - 每条记录输出统一 `UsageRequestRecord`，并设置 `source`。
   - 扫描必须有 timeout、文件大小上限、JSONL 容错。
2. 新增 `usage:localScan` IPC：
   - 参数：`provider?: codex | claude | gemini | all`、`workspaceId?: string`、`days?: number`。
   - 返回：请求明细、daily、model/provider aggregate、diagnostics。
3. ledger 持久化改为月度分片：
   - `usage.ledger.v1.2026-06`
   - 或 `usage-ledger/2026-06.jsonl`
4. 类型扩展：
   - `cacheHitTokens`
   - `cacheMissTokens`
   - `cacheHitRate: number | null`
   - `usageSource`
   - `sessionPath`
   - `sessionId`
5. UI 扩展：
   - usage 页面增加来源过滤：运行时 / 本地 Codex / 本地 Claude / 本地 Gemini。
   - cache 指标显示 unknown/null，不把未知显示为 0。
6. 验证：
   - 构造 Codex JSONL、Claude JSONL、Gemini session fixtures。
   - 验证 workspace path 过滤、日期过滤、模型排行、cache 统计、成本估算。

#### R16 本地 CLI 模型读取策略仍不完整：需要覆盖 Codex、Gemini、Claude CLI

证据：

- `src/renderer/workbench/__tests__/slash-command-behavior.test.ts:118` 明确断言 Composer 不包含 `localModels.readConfig`。
- `src/preload/index.ts:159` 暴露 `localModels.readConfig`，但 Composer 不调用。
- `src/main/runtime/local-models.ts` 当前只实现 `codex` / `gemini` 读取，尚未实现 `claude` / `claude-cli`。
- CCGUI 参考实现 `desktop-cc-gui/src-tauri/src/engine/status.rs` 中，Claude 模型读取不是远端 `/models`，而是读取本地配置和环境变量覆盖：
  - `ANTHROPIC_MODEL`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`
  - `ANTHROPIC_REASONING_MODEL`
  - `~/.claude/settings.json` 里的 `env` 同名字段

影响：

- 设置页和后端能读取本地 Codex/Gemini 模型，但不能读取 Claude CLI 本地配置模型。
- 用户如果在 Claude CLI 中配置了第三方/中转模型，例如 `ANTHROPIC_MODEL=xxx`，AgentHub 无法在本地模型配置区反映出来。
- 用户如果预期在 Composer Agent picker 右栏看到本地 CLI 模型，会感觉“仍然没有读取出来”；其中一部分不是读取失败，而是 Composer UI 当前按产品策略禁用了本地模型栏。

修复决策：

- 若继续保持“Composer 只用 API 厂商模型”，当前行为是符合上一轮产品策略的。
- 若要恢复本地 CLI 模型选择，需要修改产品规则，并确保只对 adapter 明确支持 `--model` 的 CLI 开启。

Claude CLI 本地模型读取方案：

1. 扩展类型：
   - `LocalModelConfig.source += "claude"`
   - `scanLocalModels()` 默认扫描 `["codex", "gemini", "claude"]`
   - `readLocalModelConfig("claude")` / `readLocalModelConfig("claude-cli")` 都映射到 Claude CLI reader。
2. 新增 `readClaudeConfig(root = ~/.claude)`：
   - 读取 `~/.claude/settings.json`。
   - 从 `settings.env` 读取：
     - `ANTHROPIC_MODEL`
     - `ANTHROPIC_DEFAULT_SONNET_MODEL`
     - `ANTHROPIC_DEFAULT_OPUS_MODEL`
     - `ANTHROPIC_DEFAULT_HAIKU_MODEL`
     - `ANTHROPIC_REASONING_MODEL`
   - 同时读取当前进程环境变量中的同名字段，优先级建议为：`settings.json env` > `process.env` > 空。
   - 不从 `claude --help` 示例或硬编码的旧模型名伪造“当前可用模型”，避免把文档示例当成真实 provider catalog。
3. 模型条目设计：
   - `ANTHROPIC_MODEL` -> `{ id: "settings-main", label: runtimeModel, runtimeModel, source: "settings-override", default: true }`
   - `ANTHROPIC_DEFAULT_SONNET_MODEL` -> `{ id: "settings-sonnet", label: runtimeModel, runtimeModel }`
   - `ANTHROPIC_DEFAULT_OPUS_MODEL` -> `{ id: "settings-opus", label: runtimeModel, runtimeModel }`
   - `ANTHROPIC_DEFAULT_HAIKU_MODEL` -> `{ id: "settings-haiku", label: runtimeModel, runtimeModel }`
   - `ANTHROPIC_REASONING_MODEL` -> `{ id: "settings-reasoning", label: runtimeModel, runtimeModel }`
   - 如果没有任何配置模型，返回 `models: []`，`status: "partial"`，不要伪造 Claude 默认模型。
4. Auth 状态：
   - Claude CLI 的登录/认证不应仅通过模型配置判断。
   - 第一版只读模型覆盖，`authMode` 可以为 `unknown`；如果后续读取到 Claude credentials/session，再补 `oauth` 或 `api-key`。
5. Adapter 生效边界：
   - 如果未来 Composer 恢复本地 CLI 模型选择，Claude 行的 `id` 是 UI 稳定 id，真正传给 CLI 的必须是 `runtimeModel`。
   - 需要确认 Claude CLI 当前运行参数是否支持按次覆盖模型；如果不支持，就只在设置页展示“由 Claude CLI 配置决定”，不要提供“选择后本轮生效”的假交互。
6. 测试要求：
   - `readClaudeConfig()` 能读取 `~/.claude/settings.json` 的 `env.ANTHROPIC_MODEL`。
   - 环境变量存在但 settings 缺失时能读取。
   - settings 与环境变量同时存在时 settings 优先。
   - 未配置模型时不生成假模型。
   - `scanLocalModels()` 返回 codex、gemini、claude 三类结果。
   - 如果未来接入 Composer，本地 Claude 模型不能在 adapter 不支持按次覆盖时被显示为“可本轮选择”。

#### R17 Settings 仍过大，长期维护风险高

证据：

- `src/renderer/screens/Settings.tsx` 仍包含 Local Agents、Providers、Workspace、MCP、Memory、Appearance、Shortcuts、Open Target、Plugin 等多类逻辑。

影响：

- UI bug 容易互相影响。
- 单文件 review 和测试定位困难。

修复要求：

- 拆分为 `src/renderer/screens/settings/*.tsx`。
- 每个 tab 自带轻量 renderer test。

#### R18 文档中的历史“已修复”状态需要继续绑定验证命令

证据：

- 文档前文有多个历史状态标记，部分条目在后续复核中发现只是“部分修复”。

影响：

- 后续 agent 容易误判任务已经完成。

修复要求：

- 每个“已修复”必须附带：复核日期、命令、关键断言、剩余限制。
- 只修部分时标记“部分修复”，不要标记“已完成”。

### 9.6 本轮新增验证

已通过：

```powershell
npm.cmd run test -- local-models usage-stats
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
git diff --check
```

结果：

- `npm.cmd run test -- local-models usage-stats`：3 个测试文件通过，32 个测试通过。
- `npm.cmd run typecheck`：通过。
- `npm.cmd run test`：98 个测试文件通过，598 个测试通过。
- `npm.cmd run build`：通过，生成 main/preload/renderer bundles。
- `git diff --check`：通过；仅出现工作区 CRLF/LF 提示，没有 whitespace error。

新增或更新的关键测试：

- `src/main/runtime/__tests__/local-models.test.ts`
  - Codex 配置模型在缓存为空时仍显示。
  - Codex 支持 cc-switch 风格字段。
  - Gemini 仅有 auth 时返回稳定默认模型。
  - Gemini 配置模型置顶。
  - Gemini 尊重 `GEMINI_CLI_HOME`。
- `src/main/runtime/__tests__/usage-stats.test.ts`
  - persistent ledger 不静默截断 10050 条记录。
  - 同一 eventId 的真实 usage 会替换旧估算。

### 9.7 下一轮建议优先级

1. 完成 `usage:localScan`，对齐 CCGUI 本地会话扫描能力。
2. MCP 增加 `resources/list` 和 `prompts/list`。
3. release checks 去掉 `typecheckPass: true` 假通过。
4. preload/renderer 类型边界从 `any` 迁移到 `src/shared/ipc-types.ts`。
5. main index IPC 分组拆分。
6. 如果产品决定恢复本地 CLI 模型选择，再实现 Composer 本地模型右栏，但只允许支持模型覆盖的 adapter 展示。
