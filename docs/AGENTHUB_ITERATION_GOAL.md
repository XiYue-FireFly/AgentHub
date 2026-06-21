# AgentHub 全面问题排查与迭代 Goal

更新时间：2026-06-21
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
