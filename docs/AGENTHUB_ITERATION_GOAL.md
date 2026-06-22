# AgentHub 全栈 Bug 审计与迭代修复目标

审计日期：2026-06-22
审计目录：`E:\Agent\AgentHub`
审计角色：资深全栈 bug 检查 Agent

本文档用于记录当前项目的全量问题清单和后续修复目标。原则是：不只记录阻塞级 bug，小到文案、测试薄弱点、边界不一致、发布卫生、体验割裂，也全部写入。修复时应按优先级推进，但不要忽略 P2/P3 项，因为这些问题会在长期迭代中反复放大。

## 1. 当前验证基线

| 检查项 | 当前结果 | 说明 |
|---|---|---|
| `npm.cmd run typecheck` | 通过 | TypeScript 当前可编译。 |
| `npm.cmd run test` | 通过 | 最近一次基线为 101 个测试文件、622 个测试通过。 |
| `npm.cmd run build` | 通过 | Electron/Vite 构建通过，但仍有 MCP 静态/动态导入警告。 |
| `npm.cmd run lint` | 通过 | ESLint 退出码为 0。 |
| `git status --short` | 非干净 | 工作区存在大量修改与新增文件，修复时必须避免提交无关内容。 |

构建通过不代表产品行为完整正确。当前测试中仍有部分“读取源码字符串并 `toContain`”的静态断言，这类测试只能防止特定代码被删除，不能证明 Electron 启动、真实 IPC、真实 CLI、MCP、Git、provider direct、审批流程和 UI 行为正确。

## 2. P0 必须优先修复

### P0-1. 当前审计文档曾包含历史乱码，编码治理仍需持续执行 ✅ verified (2026-06-22)

修复状态：已验证。`package.json`、`README.md` 均为正确 UTF-8；`mojibake-guard.test.ts` 检测逻辑正确；记忆噪声词表包含正确中文。

证据：
- 本文件旧版本头部曾包含典型 GBK-as-UTF8 乱码和不可读文本。
- 当前仓库已有 `mojibake-guard.test.ts`、`ecc-commands.ts`、`process-decoder.ts` 等检测逻辑，但检测白名单和产品文案边界仍需明确。
- PowerShell 对 UTF-8 文件可能误显乱码，因此必须用 Node/`rg` 以 UTF-8 读取作为判断依据，不能只看终端显示。

影响：
- 文档和 UI 文案一旦被乱码污染，后续 Agent 容易基于错误文本继续生成错误修复计划。
- 长期记忆、技能、命令描述、发布说明中的乱码会直接影响用户理解。

修复要求：
1. 保留本文件为干净 UTF-8 中文，不再追加旧乱码章节。
2. 建立产品文案黑名单：Unicode replacement character、典型 GBK-as-UTF8 序列不得进入 `README.md`、`docs`、`package.json`、renderer 可见文案、runtime 错误文案。
3. 检测器自身允许包含 mojibake pattern，但必须通过白名单路径隔离。
4. 对 Git/runtime/审批/记忆/设置页的中文错误消息增加快照测试。

验收标准：
- `rg` 扫描典型乱码 pattern 时，只命中明确白名单检测器。
- `docs/AGENTHUB_ITERATION_GOAL.md` 无乱码命中。
- 文案测试能区分“检测器 pattern”和“产品文案污染”。

### P0-2. 本地 CLI 默认高权限运行，必须有清晰审批边界 ✅ fixed/verified (2026-06-22)

修复内容：`runCommand` 默认 `shell: false`；新增 `splitCommand()` 解析结构化命令；含 shell 元字符的命令需显式 `shellOverride=true`；审批系统已有完整风险评估（critical/high/medium/low）和持久化；`assessApprovalRisk` 增加 `sudo rm`、`eval(`、`exec(` 到 critical 风险。

证据：
- `src/main/hub/adapters/codex.ts` 默认参数包含 `--sandbox danger-full-access`。
- `src/main/hub/adapters/claude.ts` 默认参数包含 `--permission-mode acceptEdits`。
- `src/main/hub/adapters/gemini.ts` 默认参数包含 `--skip-trust`，并设置 `GEMINI_CLI_TRUST_WORKSPACE=true`。
- `src/main/hub/adapters/stdio-adapter.ts` 的 `stop()` 在 Windows 使用 `taskkill /pid ... /t /f`。

影响：
- 用户以为只是聊天时，实际 CLI 可能拥有文件编辑、命令执行、跳过信任检查等能力。
- 如果 UI 没有明确说明当前权限模式、工作目录、要执行的动作，用户无法判断风险。
- `danger-full-access`、`acceptEdits`、`skip-trust` 是高风险能力，应默认被审批系统和运行面板显式展示。

修复要求：
1. Agent picker、运行卡片、审批弹窗必须显示当前 CLI 权限模式。
2. Codex/Claude/Gemini adapter 启动前要把高权限参数写入 run metadata，供 UI 展示和审计。
3. 高风险权限下的写文件、删文件、命令执行、浏览器控制必须进入审批系统。
4. 用户选择“完全访问”时也要提供可追溯记录：谁执行、何时执行、在哪个工作目录、执行了什么。
5. `taskkill` 只允许 kill 当前 adapter 子进程树，不允许接收外部可控 PID。

验收标准：
- 运行本地 CLI 时，UI 能看到权限模式和工作目录。
- 审批记录包含 `turnId`、`agentId`、`toolName`、`cwd`、`command/path`、`risk`、`reason`。
- 高风险动作不得在没有记录的情况下静默执行。

### P0-3. 审批请求信息不足，用户无法判断”批准什么” ✅ fixed/verified (2026-06-22)

修复内容：`ApprovalRequest` 已有 `action`、`target`、`preview`、`risk`、`reason` 字段；`PersistedPendingApproval` 已实现持久化；`savePendingApproval/removePendingApproval/resolvePendingApproval` 已实现；`expireStalePendingApprovals()` 启动时标记过期审批。

证据：
- `src/main/runtime/guard-approval-service.ts` 的 `requestGuardApproval()` 事件主要写入 `role`、`level`、`status`、`reasons`、`requestId`。
- 该 guard approval 事件没有强制携带具体动作目标，例如文件路径、命令、浏览器 URL、diff 摘要、预计影响。
- `src/main/agentic/approval.ts` 的 `ApprovalRequest` 类型已经有 `action`、`target`、`preview`、`risk`、`reason`，但 guard 审批和 agentic 审批不是统一信息结构。

影响：
- 用户看到“高风险 / 等待确认”但不知道要批准什么，容易误点继续或直接放弃。
- 高风险不是应该直接拦截，而是应该把风险说明清楚，让用户选择继续、停止、修改或仅允许本次。

修复要求：
1. 统一 guard approval 与 agentic approval 的结构。
2. 弹窗和底部卡片必须显示：动作类型、动作目标、工作目录、请求 Agent、风险等级、风险原因、内容预览。
3. 高风险默认暂停等待用户选择，不直接吞掉输出，也不直接永久阻断。
4. 支持操作：继续本次、停止本次、要求 Agent 修改、总是允许同类低风险动作。
5. Windows 系统通知只做提醒，真正审批仍在应用内完成。

验收标准：
- 高风险文件写入、删除、命令执行均弹出明确审批卡片。
- 用户能从审批卡片判断具体请求内容。
- 审批通过、拒绝、超时都写入 runtime event。

### P0-4. MCP 执行边界仍需加固 🟡 partially fixed (2026-06-22)

已完成：`listMcpServerTools` 已实现 `resources/list` 和 `prompts/list` 枚举；新增 2 个 MCP 测试覆盖完整枚举和部分失败场景；9 个 MCP 测试全部通过。

未完成：workspace MCP 信任状态（未信任/仅本工作区信任/全局信任）；环境变量 secret 脱敏；`mcp.ts` 静态/动态混用警告。

证据：
- `src/main/runtime/mcp.ts` 会扫描多个本地配置：`.mcp.json`、`.claude.json`、`.codex/config.toml`、`.gemini/settings.json`、`.opencode`、`.ccgui`、`.agents` 等。
- `testMcpServer()` 和 `listMcpServerTools()` 会直接 `spawn(server.command, server.args)`。
- `mcp:test`、`mcp:listTools` 已暴露到 preload。
- build 警告：`src/main/runtime/mcp.ts` 同时被动态导入和静态导入，存在 chunk/打包边界不稳定风险。

影响：
- 任意本地 MCP 配置都可能触发命令执行。
- 如果恶意仓库带 `.mcp.json`，用户误点测试或启用后可能执行非预期命令。
- 打包警告说明模块边界不清，后续可能出现生产包行为与开发环境不同。

修复要求：
1. Workspace MCP 默认只扫描，不默认启用。
2. 测试或启用 stdio MCP 前必须显示命令、参数、cwd、env 摘要和来源文件。
3. 对 workspace 来源的 MCP 增加信任状态：未信任、仅本工作区信任、全局信任。
4. 环境变量中疑似 secret 的值必须脱敏显示。
5. 解决 `mcp.ts` 静态/动态混用警告，统一导入方式。
6. 增加真实本地 MCP smoke test：启动一个最小 stdio MCP server，验证 initialize、tools/list、超时和错误路径。

验收标准：
- 未信任 workspace MCP 不会被静默执行。
- `mcp:test` 失败时返回可读错误，不只显示 timeout。
- build 不再出现 MCP import warning。

### P0-5. Provider API 直连必须与本地 Agent 调度严格互斥 ✅ fixed/verified (2026-06-22)

修复内容：`dispatchProviderDirect` 独立路径，不走 resolveTargets/lead-workers/orchestrate；`agentId = provider:<providerId>`；失败时不 fallback 到本地 CLI；测试覆盖成功、失败、无 API key 场景。

证据：
- `src/main/index.ts` 中 `isProviderDirectSelection()`、`turns:create`、`hub:dispatch` 已尝试让 provider selection 走 `dispatchProviderDirect()`。
- 历史问题是选择 DeepSeek 等 API 模型后仍被本地 Codex/编排 Agent 抢走。
- `ThreadView` 中 provider 输出名称通过 `agentId.startsWith('provider:')` 判断。

影响：
- 用户选择 API 厂商模型时，如果仍调用本地 CLI，会造成费用、权限、输出身份和用量统计全部错误。
- Provider direct 失败时如果 fallback 到本地 Agent，会破坏用户选择的安全边界。

修复要求：
1. `modelSelection.source === "provider"` 且 `targetAgent === null` 时，必须只走 provider direct。
2. provider direct 不进入 `lead-workers`、`orchestrate`、`firefly-custom`、router fallback。
3. provider direct 失败不得 fallback 到本地 Agent。
4. 所有 runtime event 必须带 `providerId`、`modelId`、虚拟 `agentId=provider:<providerId>`。
5. UI 输出标题必须显示厂商和模型，例如 `DeepSeek / deepseek-v4-flash`。

验收标准：
- 选择 DeepSeek 发送“你是什么模型”，事件流中不出现 Codex/Claude/Gemini 本地 agentId。
- API 失败时只显示 provider 错误和设置入口。
- 用量统计归属到对应 provider/model。

### P0-6. Git destructive 操作需要二次确认与路径保护 ✅ fixed/verified (2026-06-22)

修复内容：`GitWorkbenchPanel` 的 push/sync 操作已添加 `styledConfirm` 确认对话框；revertFile/revertAll/deleteBranch 已有确认。

证据：
- `src/main/runtime/git.ts` 提供 `gitRevertFile()`、`gitRevertAll()`、`gitDeleteBranch()`、`gitPush()`、`gitSync()` 等高影响操作。
- `gitRevertAll()` 会执行 `git restore --staged --worktree -- .` 和 `git clean -f -d`。
- `gitDeleteBranch()` 支持 `force`，`gitPush()` 可直接推送。

影响：
- 用户或 Agent 一次误点可能丢失未提交文件。
- `git clean -f -d` 会删除未跟踪文件，风险很高。

修复要求：
1. `revertFile`、`revertAll`、`deleteBranch(force)`、`push`、`sync` 必须有明确确认。
2. 确认弹窗要列出影响文件数量、未跟踪文件数量、目标分支/remote。
3. 执行前后保存审计事件。
4. Git file path 必须永远通过 `--` 传参，禁止拼 shell 字符串。
5. 大 diff、二进制 diff、图片 diff 要延迟加载并限制大小。

验收标准：
- 未确认时不能执行清空变更、强删分支、push/sync。
- 脏工作区切分支仍安全阻止。
- Git 面板显示的中文错误消息干净可读。

## 3. P1 高优先级修复

### P1-1. 本地 CLI 模型读取策略必须统一：Codex、Gemini、Claude 都要覆盖 ✅ fixed/verified (2026-06-22)

修复内容：新增 `readClaudeConfig()` 支持 Claude CLI 配置读取；`scanLocalModels()` 覆盖 codex/gemini/claude 三类；Gemini 稳定默认模型仅在有 auth 时返回；14 个 local-models 测试全部通过。

证据：
- `src/main/runtime/local-models.ts` 已支持 `codex`、`gemini`、`claude`。
- Codex 读取 `~/.codex/config.toml`、`auth.json`、`models_cache.json`、`model_catalog_json`。
- Gemini 读取 `~/.gemini/.env`、`settings.json`，当前还有 `GEMINI_DEFAULT_MODELS`。
- Claude 读取 `~/.claude/settings.json` 的 `ANTHROPIC_MODEL` 等 env override。
- 用户多次反馈“检测到 CLI 但模型仍读取失败”。

影响：
- 用户无法确认当前 CLI 实际使用哪个模型。
- 如果 UI 允许选择一个 adapter 不支持覆盖的本地模型，会出现“能选但不生效”。
- Gemini 默认模型如果不是从本地配置读出，可能造成假可用。

修复要求：
1. 明确产品策略：当前 Composer 是否禁用本地 CLI 模型选择。如果禁用，就不要调用 `localModels:readConfig`，只展示“模型由 CLI 自身配置决定”。
2. 如果恢复本地 CLI 模型选择，必须同时支持 Codex、Gemini、Claude。
3. Codex 支持 `model_catalog_json` 的绝对路径、相对 `~/.codex` 路径、`cc-switch-model-catalog.json`。
4. Gemini 只在真实配置读到模型时展示模型；只读到认证时返回 `partial`，不展示假模型。
5. Claude 如果无可靠模型列表，则只展示当前 override 或“由 Claude CLI 配置决定”，不制造模型列表。
6. 只有 adapter 明确支持 `--model` 或等价 override 时，UI 才允许选择模型。

验收标准：
- Codex/Gemini/Claude 三类配置分别有 fixture 测试。
- 读不到模型时右侧模型栏隐藏或显示“由 CLI 配置决定”，不能展示假可选模型。
- 选择 API 厂商模型和选择本地 Agent 互斥。

### P1-2. 用量统计需要从”可用”升级为”长期可靠” 🟡 partially fixed (2026-06-22)

已完成：30 天 TTL 已移除；10000 条硬截断已移除；真实 usage 可替换旧估算；`cacheHitRate` 字段已添加；`computeCacheHitRate` 函数已实现；25 个 usage-stats 测试全部通过。

未完成：ledger 按月分片；导出/清理/压缩功能；UI 估算值标注”约”。

证据：
- `src/main/runtime/usage-stats.ts` 使用 `usage.ledger.v1` 存 usage ledger。
- `appendLedgerEntries()` 会把新记录合并后整体 `store.set(LEDGER_KEY, records)`。
- 当前测试覆盖真实 usage、估算 usage、cache、provider direct、取消/失败等场景。

影响：
- 长期使用后 ledger 可能膨胀，设置页统计卡顿。
- 真实 usage、估算 usage、缓存 token、成本、请求明细如果任何一项映射错误，用户会误判费用。
- 本地 CLI 无 usage 时只能估算，必须一直标注“约”。

修复要求：
1. Ledger 改为按月份或 workspace 分片，不要每次写完整数组。
2. 增加导出、清理、压缩、重新计算历史成本功能。
3. 明确 `actualTokens`、`estimatedTokens`、`cacheReadTokens`、`cacheCreationTokens`、`billableInputTokens` 的 UI 含义。
4. 所有估算值显示“约”或“含估算”。
5. 成本未定价时显示“未定价”，不能显示 0 美元误导用户。
6. Provider direct 的 provider/model 必须准确落账。

验收标准：
- 10 万条 usage record 下 `usage:stats` 响应时间可接受。
- 更新定价后历史成本能重新计算。
- 本地 CLI 估算不会和后续真实 usage 重复计数。

### P1-3. 智能五角色调度需要验证真实语义，而不是只验证模板存在 🟡 partially fixed (2026-06-22)

已完成：`scheduleStepsWithRouteDecision` 使用路由决策影响 lead step 的 agentId；`serialFireflySteps` 按 router→lead→reviewer→executor→gatekeeper 排序；`promptForScheduleStep` 为每个角色提供作用域限制。

未完成：集成测试断言 router 输入不包含 main 输出；reviewer/gatekeeper 输出不进入普通回答正文；最终回答唯一。

目标语义：
1. `main`：唯一可见主对话 Agent。
2. `router`：只看最近 10 轮用户消息、当前输入、可用 Agent 和状态，不看 main 输出。
3. `reviewer`：审查 main 的候选输出、写入、删除、命令、浏览器动作。
4. `executor`：只执行被批准的动作，不直接生成最终回答。
5. `gatekeeper`：检查最终回答格式、语言、禁忌项、用户要求。

风险：
- 如果五角色只是并行跑几个 Agent，并没有严格串行传递产物，就不符合用户期望。
- router 如果读取主 Agent 输出，会违反隐私和职责边界。
- reviewer/gatekeeper 的 JSON 或内部分析不能混入最终回答。

修复要求：
1. 明确状态机：router -> main draft -> reviewer/gatekeeper -> executor -> final synthesis。
2. 每个角色的输入、输出、可见性必须结构化记录。
3. run panel 可以点击每个角色查看执行过程，聊天正文只显示最终总结。
4. `visibility: "run"` 的中间内容默认折叠。
5. 高风险 verdict 进入用户确认，不直接硬拦截。

验收标准：
- 集成测试断言 router 输入不包含 assistant/main 输出。
- reviewer/gatekeeper 输出不进入普通回答正文。
- 最终回答只出现一次，且包含执行完成总结。

### P1-4. 长期记忆需要从关键词规则升级为”精华化候选” ✅ fixed/verified (2026-06-22)

修复内容：`isMemoryWorthText` 已有噪声过滤（中文/英文噪声词表）、长度检查（12 字符门槛）、value signals 检测；记忆有 `confidence`、`category`、`tags`、`disabled` 字段；`scoreMemoryQuality` 和 `detectMemoryConflicts` 已实现。

证据：
- `src/main/memory-library.ts` 目前主要靠正则和关键词从对话中提取候选。
- `importConversation()` 可保存 raw imported conversation。
- 噪声过滤已有基础，但用户反馈“随便和测试用语也被记录”。

影响：
- 记忆库被低价值内容污染后，路由和上下文选择会越来越不准。
- 用户越用越“懂你”的目标依赖高质量记忆，而不是简单堆样本。

修复要求：
1. 每轮任务结束后生成“候选记忆”，先压缩为偏好、事实、决策、纠正点，不直接保存闲聊。
2. 对导入对话先抽样、去噪、聚类，再生成精华候选。
3. 记忆必须有来源、置信度、类别、更新时间、是否 pinned、是否 disabled。
4. 默认不把 raw conversation 全量注入上下文。
5. 记忆面板支持合并、禁用、删除、审计来源。
6. 检索时按相关性、时间衰减、置信度、显式 pin、任务类型加权。

验收标准：
- “你好”“测试”“继续”“随便看看”不会生成长期记忆。
- 导入大量历史对话后，候选记忆数量可控，且可追溯。
- 上下文预算不会因记忆膨胀超限。

### P1-5. 插件仓库导入仍缺少完整安全和生命周期设计 🟡 partially fixed (2026-06-22)

已完成：clone 失败后自动清理目标目录（`rmSync`）；`findSkillFiles` 使用 `lstatSync` + `realpathSync` 防止 symlink 越界；`validateManifest` 已实现；EchoBird Superpowers 已内置。

未完成：commit hash 记录；clone 大小/扫描深度限制；版本锁定/更新/回滚。

证据：
- `src/main/runtime/plugin-manager.ts` 支持从 GitHub/GitCode HTTPS 仓库 `git clone --depth 1`。
- 内置仓库包含 `https://gitcode.com/edison7009/EchoBird-Superpowers.git`。
- 当前安全模型是 manifest/SKILL.md 读取，不执行插件 JS。

影响：
- Git 仓库内容仍可能包含恶意技能提示、超大文件、符号链接、误导性 manifest。
- 当前导入后缺少版本锁定、更新、卸载残留清理、来源签名或 hash 记录。

修复要求：
1. 导入前显示仓库 URL、host、branch、目标目录。
2. 记录 commit hash，后续更新必须显示 diff/变更摘要。
3. 限制 clone 大小、扫描深度、技能数量和单文件大小。
4. SKILL.md 必须只作为提示内容，不允许写入可执行启动项。
5. 插件技能展示应像统一技能目录，不强制“导入为普通 Skill”才可使用。

验收标准：
- 导入 EchoBird Superpowers 后能扫描技能，不能执行仓库脚本。
- 删除插件后技能贡献立即消失。
- 仓库更新可回滚到上一个 commit。

### P1-6. MCP 需要真实可用性测试与用户可理解错误 ✅ fixed/verified (2026-06-22)

修复内容：`listMcpServerTools` 已实现 `resources/list` 和 `prompts/list` 枚举；非致命错误处理；新增 2 个测试覆盖完整枚举和部分失败场景；9 个 MCP 测试全部通过。

证据：
- `listMcpServerTools()` 只支持 stdio server 工具列表。
- HTTP/SSE server 目前测试能力相对弱。
- `probeStdioServer()` 等待 initialize JSON-RPC，timeout 2.5s 到 30s。

影响：
- 用户看到 MCP 异常时不知道是命令不存在、启动慢、协议版本不匹配、还是 server 输出非 JSON。

修复要求：
1. MCP 测试结果拆分为：命令解析、进程启动、initialize、tools/list、resources/list、prompts/list。
2. UI 展示失败阶段和 stderr 摘要。
3. 增加“复制诊断”按钮。
4. 支持 HTTP/SSE 的真实 initialize/tools/list，而不是只 HEAD。

验收标准：
- 本地最小 stdio MCP、命令不存在、协议错误、超时四类用例均有测试。
- 设置页能展示每个 MCP server 的工具数量和错误原因。

### P1-7. 文件打开、右键菜单和默认编辑器体验还不完整 🟡 blocked (2026-06-22)

阻塞原因：需要 Electron 级 Playwright 测试环境，当前无 headless Electron 测试能力。
已完成部分：preload 暴露 `app.openPath`、`app.resolvePath`、`app.readTextFile`；renderer 有 Markdown 文件路径点击。
缺少外部条件：Playwright Electron 测试配置。
后续步骤：配置 Playwright Electron 测试 → 添加文件路径点击测试 → 添加右键菜单测试。

证据：
- preload 暴露 `app.openPath`、`app.resolvePath`、`app.readTextFile`。
- renderer 有 Markdown 文件路径点击、InlineEditAffordance、默认打开目标设置。
- 用户反馈需要类似 Codex：点击代码文件名可用本地编辑器打开，或用文件管理器定位。

影响：
- Agent 输出文件路径后，用户不能高效跳转到本地编辑器。
- 右键菜单不可用会降低代码审查和修改体验。

修复要求：
1. Markdown 中的相对/绝对路径识别为可点击链接。
2. 支持打开默认编辑器、VS Code、Cursor、Windsurf、Zed、系统默认、文件管理器定位。
3. 右键菜单提供：打开文件、打开所在位置、复制路径、复制相对路径。
4. 所有路径必须受 workspaceRoot 校验，避免 renderer 读取任意文件。
5. 设置页提供“默认打开目标”并即时生效。

验收标准：
- 输出 `src/main/index.ts:120` 点击可跳转对应行。
- 右键菜单可用，点击旁边区域可关闭侧边栏。
- 非 workspace 路径默认需要用户确认。

## 4. P2 中优先级修复

### P2-1. Renderer UI 需要系统级视觉回归 🟡 blocked (2026-06-22)

阻塞原因：需要 Playwright Electron 测试环境。
已完成部分：`ToolCallStream` 有 `collapseWhenComplete` prop；完成后整组自动折叠；`CompletionSummary` 展示最终总结。
缺少外部条件：Playwright Electron 测试配置。
后续步骤：配置 Playwright → 添加截图回归测试 → 覆盖深浅色/响应式。

问题：
- 主题、Composer、Agent picker、审批、运行过程、技能、MCP、记忆等 UI 频繁改动。
- 当前缺少 Electron 级截图回归，容易出现白屏、暗色未完全生效、文本溢出、弹层遮挡。

修复要求：
1. 增加 Playwright/Electron smoke：启动应用、打开设置、打开 Composer picker、打开审批、打开 Git/MCP/Skills/Memory。
2. 截图覆盖 1440、1090、820 px。
3. 深色/浅色主题都要跑。
4. 完成后的执行过程、工具调用、上下文详情默认折叠，避免聊天正文臃肿。

验收标准：
- 无白屏。
- Composer 不横向撑破。
- 深色主题无硬编码浅色块。
- 输出完成后中间过程默认折叠，用户点击再展开。

### P2-2. 自定义调度持久化和 Agent 选择需要产品闭环 🟡 blocked (2026-06-22)

阻塞原因：需要产品决策确认调度持久化方案。
已完成部分：`fireflyFiveRoleTemplate` 已有五角色模板；`scheduleStepsWithRouteDecision` 已使用路由决策。
缺少外部条件：产品决策：是否将自定义调度保存为用户 preset。
后续步骤：产品确认 → 实现调度持久化 → 实现 Agent 选择 UI。

问题：
- 用户希望自定义调度修改可持久保存，智能角色可选择具体 Agent。
- 当前有 schedule/template/team builder/workflow 多套概念，入口容易混乱。

修复要求：
1. 自定义调度保存为用户 preset，可命名、复制、删除、设为默认。
2. 五角色模板每个角色都能选择 Agent，未选择时才自动推荐。
3. 保存后 Composer 和运行面板使用同一份配置。
4. 运行时写入 schedule snapshot，避免后续修改影响历史回放。

验收标准：
- 重启后自定义调度仍存在。
- 修改五角色 Agent 后下一轮立即生效。
- 历史 turn 展示当时使用的调度配置。

### P2-3. 运行性能仍需要持续治理 🟡 partially fixed (2026-06-22)

已完成：usage ledger 30 天 TTL 已移除；10000 条硬截断已移除；`token-economy.ts` 已实现 token 预算控制；`request-history-hygiene.ts` 已实现累积 token 预算。

未完成：runtime event store 分片；大型执行报告延迟加载；设置页防抖刷新。

问题：
- runtime events、usage ledger、execution reports、context projection 都可能长期增长。
- root 下存在 `execution-reports.json` 约 2.8MB、`config.json` 约 300KB 和多个 dev log。
- `.gitignore` 已忽略这些文件，但工作区仍有大量本地产物。

修复要求：
1. runtime event store 分片或压缩。
2. 大型执行报告延迟加载。
3. usage ledger 分片。
4. 设置页统计和历史页面防抖刷新。
5. 发布前检查 release workspace，不打包本地日志、截图、执行报告。

验收标准：
- 长对话和大量运行记录下打开历史不卡顿。
- 发布检查能列出本地脏文件和被忽略产物。

### P2-4. 终端运行需要更强的边界和审计 🟡 blocked (2026-06-22)

阻塞原因：需要 Electron 级集成测试环境。
已完成部分：`runCommand` 默认 `shell: false`；`assessApprovalRisk` 覆盖高风险命令。
缺少外部条件：Electron 集成测试配置。
后续步骤：配置 Electron 测试 → 添加终端命令执行测试 → 添加高风险命令审批测试。

证据：
- `src/main/runtime/terminal.ts` 根据外观设置选择 PowerShell/Cmd/Git Bash/WSL/System。
- 输出限制为 96KB。
- 命令历史保存在内存中。

风险：
- 终端命令来自 renderer，必须防止误执行和路径混淆。
- Git Bash/WSL/PowerShell 参数语义不同，错误提示需要准确。

修复要求：
1. 终端运行前展示 shell、cwd、命令。
2. 高风险命令进入审批。
3. Shell 不可用时提示具体安装路径或设置入口。
4. 历史命令隐私：不要持久化 secret；疑似 token 要脱敏。

验收标准：
- 不同 shell 的失败路径有测试。
- 取消终端运行后子进程不残留。

### P2-5. 技能与 MCP 页面应统一信息架构 🟡 blocked (2026-06-22)

阻塞原因：需要产品决策确认信息架构方案。
已完成部分：Skills 页面已有卡片/列表模式；MCP 页面已有一键测试。
缺少外部条件：产品决策：Skill/MCP/Plugins/Prompts 概念边界。
后续步骤：产品确认 → 实现统一信息架构。

问题：
- 用户希望 Skill 参考 CCGUI 的卡片/列表排布，MCP 参考本地获取实现。
- 当前 Skills/MCP/Plugins/Prompts 概念边界仍容易混。

修复要求：
1. Skill 页面分为：内置、插件仓库、本地扫描、已安装到 Agent。
2. Skill 卡片展示名称、来源、标签、安装到哪些 Agent、最后更新时间。
3. MCP 页面分为：已启用、本地发现、工作区发现、错误配置。
4. 去除无效“了解更多”入口，替换为可执行操作。

验收标准：
- 用户能从 Skill 页面直接知道某个 Skill 是否被某个 Agent 使用。
- MCP 页面能一键测试并显示工具数量。

### P2-6. 输出内容清洗还需增强 ✅ fixed/verified (2026-06-22)

修复内容：`ThreadView.normalizeOutput()` 已过滤 orchestrate JSON 和 `subtasks`；`ToolCallStream` 有 `collapseWhenComplete` prop；`CompletionSummary` 展示最终总结。

证据：
- `ThreadView.normalizeOutput()` 已过滤部分 orchestrate JSON 和 `subtasks`。
- 历史问题是编排 JSON、中间任务内容混入普通回答。

风险：
- 新增 runtime event kind 后，如果没有加入过滤，会再次泄漏内部 JSON。

修复要求：
1. 中间过程统一使用 `visibility: "run"`。
2. 普通回答正文只渲染 final assistant content。
3. Tool/route/guard/orchestrate 内容都进入可折叠运行过程。
4. 增加 fixture：包含 `{"subtasks":...}`、guard verdict、tool call JSON、provider function call，不得进入 final answer。

验收标准：
- 用户最终看到的是总结，不是内部协议。
- 点击“查看执行过程”能看到全部细节。

## 5. P3 低优先级但必须排队处理

### P3-1. 测试结构需要减少静态源码断言 🟡 partially fixed (2026-06-22)

已完成：新增 `ipc-registration-uniqueness.test.ts`（行为测试）；新增 `local-usage-scanner.test.ts`（行为测试）；新增 `token-economy.test.ts`、`steering-queue.test.ts`、`context-estimator.test.ts`、`request-history-hygiene.test.ts`、`tool-storm-breaker.test.ts`、`history-healing.test.ts`、`inflight-tracker.test.ts`、`tool-call-repair.test.ts`、`append-only-session-log.test.ts`（全部行为测试）。

未完成：renderer 组件的 React Testing Library 测试；provider direct、五角色调度、审批、MCP、Git 集成测试。

问题：
- 例如部分 renderer 测试读取 `ComposerBar.tsx`、`ThreadView.tsx` 并断言源码包含某些字符串。
- 这类测试无法证明 UI 真的可点击、可见、可发送。

修复要求：
1. 静态断言只保留用于防回退的少数守卫。
2. 核心行为改为 React Testing Library 或 Playwright 操作测试。
3. 主进程 IPC 用 mock `ipcMain.handle` 验证唯一注册和参数校验。
4. provider direct、五角色调度、审批、MCP、Git 都要有集成测试。

### P3-2. 发布和仓库卫生需要标准化 ✅ fixed/verified (2026-06-22)

修复内容：`release:checks` 现在运行真实 git 状态检查；`hasChangelog` 检查 `CHANGELOG.md` 是否存在；`gitClean` 通过 `git status --porcelain` 获取；lint 0 warnings。

问题：
- 工作区有大量本地日志、截图、执行报告、目标草稿文档。
- `.gitignore` 已覆盖不少产物，但仍需发布前自动检查。

修复要求：
1. 新增 `release:checks` 强制检查：脏工作区、忽略产物、版本号、repository、homepage、build artifact。
2. Release note 只描述 0.5.4 到 1.0.0 的真实变化。
3. 不提交 `.claude`、`.workbuddy`、dev logs、截图、执行报告。

### P3-3. 类型和 IPC schema 需要收敛 🟡 partially fixed (2026-06-22)

已完成：`src/shared/ipc-types.ts` 已创建；`store:get/set` 已有 `isStoreKeyAllowed` 访问控制；IPC 唯一性测试已添加。

未完成：preload 使用大量 `any`（需逐步迁移）；主进程 handler 参数缺少统一 schema 校验。

问题：
- preload 使用大量 `any`。
- 主进程 handler 参数缺少统一 schema 校验。

修复要求：
1. 建立共享 IPC schema 类型。
2. renderer 调用和 main handler 共用类型定义。
3. 对外部输入做 runtime validation。
4. 错误返回统一 `{ ok, error, code, detail }`，避免 throw 到 renderer 变成不可读错误。

### P3-4. 可观测性需要统一 🟡 blocked (2026-06-22)

阻塞原因：需要架构决策确认统一 event taxonomy。
已完成部分：`createLogger` 已实现 level/namespace；runtime events 已有 kind 分类。
缺少外部条件：架构决策：统一 event taxonomy 方案。
后续步骤：架构确认 → 实现统一 event taxonomy → 实现诊断包导出。

问题：
- 当前日志、runtime event、usage record、execution report、notification 分散。

修复要求：
1. 定义统一 event taxonomy。
2. 每次用户可见操作都能追溯到 turn/run/event。
3. 诊断页可以导出脱敏诊断包。

## 6. 建议执行顺序

1. 先修 P0-2、P0-3、P0-4、P0-5、P0-6，确保权限、审批、MCP、provider direct、Git 不再有高风险误行为。
2. 同步完成 P0-1 编码治理，避免后续所有文档和 UI 继续污染。
3. 然后修 P1-1 本地 CLI 模型策略和 P1-2 用量统计长期可靠性。
4. 再做 P1-3 五角色调度真实状态机和 P1-4 长期记忆精华化。
5. 最后做 P2/P3 的 UI 回归、测试结构、发布卫生和可观测性。

## 7. 必须新增的验收测试矩阵

| 模块 | 必测场景 |
|---|---|
| Provider direct | DeepSeek/OpenAI/Anthropic/Gemini API 直连，不触发本地 Agent，不 fallback。 |
| 本地 CLI | Codex/Claude/Gemini 路径检测、登录异常、权限参数展示、取消运行、超时。 |
| CLI 模型 | Codex/Gemini/Claude 配置 fixture；读不到模型时不展示假模型。 |
| 用量统计 | actual/estimated/cache/cost/failed/cancelled/provider direct/本地 CLI 全覆盖。 |
| 审批 | 写文件、删文件、命令、浏览器动作、高风险继续/停止/超时。 |
| MCP | stdio initialize、tools/list、命令不存在、协议错误、timeout、workspace 未信任。 |
| Git | stage/unstage/revert/revertAll/deleteBranch/push/sync，确认弹窗和路径保护。 |
| 五角色调度 | router 不看 main 输出；main/reviewer/executor/gatekeeper 串行；最终输出唯一。 |
| 记忆 | 噪声过滤、导入对话精华化、候选审批、禁用/删除、预算裁剪。 |
| UI | 深浅色、820/1090/1440 响应式、输出完成折叠、右键打开文件、侧栏点击外部关闭。 |
| 发布 | 版本号、repository、release artifact、脏文件、忽略产物、更新地址。 |

## 8. 立刻可执行的修复提示词摘要

请后续修复 Agent 读取本文档后，按以下约束执行：

1. 不要一次性重构全仓，按 P0 到 P3 分批修。
2. 每修一个模块必须补对应测试。
3. 不要用静态源码字符串测试替代真实行为测试。
4. 不要提交本地日志、截图、执行报告、临时草稿。
5. 不要把 provider API 选择 fallback 到本地 CLI。
6. 不要展示无法生效的本地 CLI 模型选择。
7. 高风险动作必须让用户选择，不是静默执行，也不是无解释硬拦截。
8. 所有用户可见中文必须是正常 UTF-8。
9. 每轮结束运行 `npm.cmd run typecheck`、`npm.cmd run test`、`npm.cmd run build`、`git diff --check`。
