# AgentHub 全量 Bug 清单（ChatGPT 审计轮）

> 冻结日期：2026-07-10
> 审计分支：`chatgpt`
> 基线 HEAD：`40a7c1222d631c58bb1f4b51ebafed2a0f3a550d`
> 状态说明：本文行号均指修复前基线；修复后以文件与测试名为稳定索引。

## 1. 审计结论

本轮从当前源码、真实 Windows 命令复现、Electron E2E、构建/打包、依赖审计、历史回归线索及两个独立审计子代理中去重出 **64 个确认 Bug**：P0 2 个、P1 17 个、P2 30 个、P3 15 个。

以下内容不计入现行 Bug：仅要求拆分大文件的建议、无行为证据的 TODO/未使用代码、纯审美配色、尚未接入产物的 system MCP 休眠路径，以及 `VERSION.md` 已明确记录的无签名 GitHub 更新设计风险。它们在文末作为观察项保留。

## 2. 冻结清单

### AH-001 [P0] 顶层窗口可导航到远程页面并继承完整 preload API

- **位置：** `src/main/index.ts:388-414`；`src/main/security/webview-guards.ts:27-39`。
- **问题：** BrowserWindow 永久加载高权限 preload，但 guard 只拦 webview attach 与新窗口，没有拦主 frame 的 `will-navigate`/`will-redirect`。renderer 中同窗导航或 XSS 可把远程站点装进主窗口，远程页面随后获得 `window.electronAPI`。
- **影响：** 可串联 terminal、workspace、Provider、插件等 IPC，形成任意文件/命令能力暴露。
- **最小建议：** 安装精确 renderer URL/origin 导航白名单，其他主 frame 导航 `preventDefault()`；HTTP(S) 可交系统浏览器。避免泛化重构 IPC。
- **回归测试：** 当前生产 file URL/开发精确 origin 允许；HTTPS、其他 file、不同 dev origin、redirect 均阻止。
- **修复批次：** B01。
- **状态：** 已复核。新增主 frame `will-navigate`/`will-redirect` 白名单；开发环境同时锁定协议与 origin，生产环境锁定精确 `file:` 入口，阻止远程、其他文件及 `blob:`/`data:`/`javascript:` 派生文档。

### AH-002 [P0] Windows stdio Agent 的 `{prompt}` 参数可注入 `cmd.exe`

- **位置：** `src/main/hub/adapters/stdio-adapter.ts:11-14,122-143`；默认受影响适配器 `hermes.ts`、`openclaw.ts`、`minimax-code.ts`。
- **问题：** `.cmd`/裸命令路径把 prompt 拼进 `cmd /c`，并以 `\"` 逃逸引号；cmd.exe 不把反斜杠当引号转义。实测 prompt `hello" & echo AGENTHUB_INJECTION_PROOF & echo "x` 会执行第二条命令。
- **影响：** 聊天输入可在 Agent 进程启动前直接执行任意本机命令。
- **最小建议：** 对 Windows wrapper 使用可证明安全的参数传递，优先避免 shell 拼接；必须走 cmd 时对所有元字符和引号使用经真实 `.cmd` fixture 验证的编码。
- **回归测试：** 真 `.cmd` fixture 覆盖引号及 `&|<>^()%!`，marker 不得执行，目标程序应收到原始 prompt。
- **修复批次：** B02。
- **状态：** 已复核。Windows 裸命令先解析为受支持 launcher，跳过无扩展 shim 并优先 `.exe/.com`，其次 `.cmd/.bat`；`.cmd/.bat` 通过固定 `cmd.exe` 启动模板和内部环境键传递 argv，`envOverrides` 不能覆盖这些内部键；真实 `.cmd` 防御 fixture 与 PATH shim 负例均通过。

### AH-003 [P1] ACP 权限请求缺少有效 session 时默认放行

- **位置：** `src/main/hub/adapters/acp-client.ts:499-520`。
- **问题：** `approved` 初值为 `true`；缺失、未知或过期 sessionId 找不到审批 handler 时仍返回 allow/allow_once。
- **影响：** 异常或恶意 ACP server 可绕过 deny/ask 策略执行写入/命令。
- **最小建议：** guarded 请求默认拒绝；只有已知活动 session 且存在 handler 时才可能批准。
- **回归测试：** 缺失/未知/过期 session 的 exec/write 全部 cancelled/deny；有效 session 仍按 handler 决策。
- **修复批次：** B03。

### AH-004 [P1] ACP 分类器漏识别 snake_case 等破坏性工具名

- **位置：** `src/main/hub/adapters/acp-client.ts:221-263`；`src/main/hub/dispatcher.ts:1412-1414`。
- **问题：** `\bdelete\b` 等正则无法匹配 `_` 属于 word character 的 `delete_file`、`move_file`、`rename_file`，结果 `tool=null`，dispatcher 对 null 直接 allow。
- **影响：** 删除、移动、重命名等变更可不经审批。
- **最小建议：** 先按 `_-/.:` 归一化 token，再明确分类；未知潜在变更工具 fail-closed。
- **回归测试：** snake/kebab/slash 命名及 delete/move/rename/chmod/mkdir。
- **修复批次：** B03。

### AH-005 [P1] ACP 路径绕过 auto 预设的高风险升级

- **位置：** `src/main/hub/dispatcher.ts:1420-1459`；`src/main/agentic/approval.ts:193-205,306-326`。
- **问题：** ACP 先调用不含风险的 `policyFor`，随后又以原始 toolName/嵌套 raw 评估，读取不到 `rawInput.command`。`rm -rf`、`taskkill` 等在 auto 下仍默认 allow。
- **影响：** UI 承诺“auto 高危必问”在 ACP 路径失效。
- **最小建议：** 标准化 `{tool,args}`，先评估风险，再调用 `policyForWithRisk`。
- **回归测试：** auto 下破坏性命令/系统路径写入必须 ask；full-access allow；read-only deny。
- **修复批次：** B03。

### AH-006 [P1] Provider/agentic 超时与部分取消不终止底层操作

- **位置：** `src/main/hub/dispatcher.ts:429-450,781-809,936-981,1031-1061`；`src/main/agentic/executor.ts:94-110,175-177`。
- **问题：** provider-direct 没有 AbortController；普通 HTTP 的 timeout 不调用内部 abort；agentic fetch/tool 仅结束包装 Promise或轮询状态，底层仍可继续。
- **影响：** 已取消/失败 turn 之后仍计费、输出 delta、写文件或执行命令。
- **最小建议：** 各分支持有统一 abort/stop，cancel 与 timeout 调同一终止器；late callback 在 settled 后不得发事件。
- **回归测试：** hanging stream/tool 在 cancel/timeout 后 signal aborted、无 late delta/done、无副作用。
- **修复批次：** B04。

### AH-007 [P2] ACP server 忽略 cancel 时适配器永久 busy

- **位置：** `src/main/hub/adapters/acp-client.ts:330-383`；`acp-adapter.ts:72-104`；`dispatcher.ts:1377-1408`。
- **问题：** cancel 只发 notification，pending request 无 timeout；server 不响应时 `runPrompt` 永不 finally，status/currentSession 保持 busy。
- **影响：** 后续该 Agent 全部 `LOCAL_AGENT_BUSY`，进程持续存活。
- **最小建议：** cancel grace 超时后 stop client 并拒绝 pending；initialize/new/prompt 各有超时。
- **回归测试：** fake server 忽略 cancel 后进程/待决请求清理，下一次可重启。
- **修复批次：** B04。

### AH-008 [P1] Orchestrator 并行复用单实例本地 Agent 导致子任务互报 busy

- **位置：** `src/main/hub/dispatcher.ts:508-557,623-684`。
- **问题：** `Promise.all` 把多个 subtask/verifier 同时交给同一 stdio/ACP adapter；第一个置 busy，其余立即失败。
- **影响：** 仅一个本地 Agent 或多个子任务同路由时，orchestrate 稳定部分失败。
- **最小建议：** 按 agentId 串行单实例本地调用，不同 Agent 保持并行；verifier 共用队列。
- **回归测试：** 同一 Agent 两子任务均完成；两个 Agent 仍并行；verifier 不 busy。
- **修复批次：** B05。
- **状态：** 已复核。同一 local agent 的 worker 与 verifier 现在按 `agentId` 共用 FIFO 队列，不同 agent 仍可并行；任务取消会在获锁、预处理完成及 stdio 启动完成后重新检查，排队请求不会晚启动。

### AH-009 [P1] 模型计划可返回任意数量子任务造成无界并发/费用放大

- **位置：** `src/main/hub/orchestrator.ts:38-61`；`src/main/hub/dispatcher.ts:623-641`。
- **问题：** `parsePlan` 不限制数量、字段长度、重复 ID；执行层对全部项 `Promise.all`。
- **影响：** 恶意/异常模型可放大为数十至数百 worker + verifier 请求。
- **最小建议：** 解析层硬限制最多 5 项并限制字段/去重；执行层设置并发上限作为第二道门禁。
- **回归测试：** 100 项输入被拒绝/裁剪至上限，最大同时运行数受限。
- **修复批次：** B05。
- **状态：** 已复核。计划解析最多保留 5 项，限制字段长度并按完整 ID 去重；截断碰撞使用确定性后缀保留不同任务，执行层另设并发上限 3。

### AH-010 [P2] verifier 故障被伪装成 ambiguous 并触发无意义重跑

- **位置：** `src/main/hub/dispatcher.ts:663-680`。
- **问题：** 丢弃 verifier 返回的 `.error`，只解析空 content，随后把 provider 超时/busy 当“ambiguous verify output”并重跑 worker。
- **影响：** 成本增加且真实故障被掩盖。
- **最小建议：** 保留 verify result；error 明确终止/报告，不触发 worker 重跑。
- **回归测试：** verifier error 保留原错误、worker 调用次数不增加。
- **修复批次：** B05。
- **状态：** 已复核。verifier error 在 verdict 解析前被明确处理并保留，当前子任务直接结束，不再触发 worker 重跑。

### AH-011 [P2] MCP upsert 静默丢弃连接/信任字段

- **位置：** `src/main/runtime/mcp.ts:74-95`；合同 `src/shared/ipc-contract.ts:1160-1180`。
- **问题：** `headers`、`timeoutMs`、`trustScope`、`trustedWorkspaceRoots` 已通过 IPC 校验，却未复制到持久化对象。
- **影响：** HTTP 鉴权、超时和信任配置保存后消失。
- **最小建议：** 完整复制所有持久化字段后 normalize。
- **回归测试：** upsert → list/reload 保留全部字段。
- **修复批次：** B06。
- **状态：** 已复核。upsert 通过显式用户字段白名单保存连接、超时与信任配置，并强制运行时来源/状态字段，list 与模块 reload 后保持一致。

### AH-012 [P2] MCP initialize JSON 扫描把字符串内大括号当结构

- **位置：** `src/main/runtime/mcp.ts:183-204`。
- **问题：** 手写 depth 扫描不跟踪字符串与 escape，`serverInfo`/instructions 含 `}` 时提前截断。
- **影响：** 合法 server 被误报初始化失败。
- **最小建议：** 优先逐行解析 NDJSON；必要时使用处理字符串/转义的状态机。
- **回归测试：** 字符串含 `{`、`}`、`\"`、`\\` 的合法响应。
- **修复批次：** B06。
- **状态：** 已复核。stdio 输出改为有序、字符串/escape 感知的对象扫描，区分 pending、success 与 terminal error；支持前置日志/notification、跨行 JSON、输出边界与准确退出诊断。

### AH-013 [P3] HTTP MCP 健康检查以字符串包含判断成功

- **位置：** `src/main/runtime/mcp.ts:118-143`。
- **问题：** HTTP 200 body 只要含 `result` 或 `protocolVersion` 就被视为健康，不验证 JSON-RPC、id、result/error。
- **影响：** HTML、错误响应或恶意端点可显示“正常”。
- **最小建议：** 解析 JSON/支持的 SSE frame并复用严格 initialize 校验。
- **回归测试：** 200 HTML、error、错 id 拒绝；正确结果接受。
- **修复批次：** B06。
- **状态：** 已复核。HTTP JSON 与 SSE 均严格验证 JSON-RPC、目标 id、结果、支持的协议版本及错误响应；SSE 覆盖多帧、多行 data、默认 event、keepalive 与 notification。

### AH-014 [P1] Workspace 只读入口/Bootstrap 可经 symlink 或 junction 越界

- **位置：** `src/main/ipc/workspace-root-guard.ts:24-31`；`workspace-ipc.ts:55-80,129-143`；`src/main/hub/workspace.ts:143-160`。
- **问题：** list/search/preview/listDirectory/bootstrap 仅 lexical resolve/relative，随后 fs 跟随链接；相邻 read/write 已有 realpath ancestor 守卫。
- **影响：** renderer 可枚举/读取工作区外内容，bootstrap 还可能把外部文件发给模型并绕过敏感文件别名检查。
- **最小建议：** 统一复用 realpath/现存祖先校验；递归结果拒绝 escape symlink/junction。
- **回归测试：** 文件 symlink、目录 symlink、Windows junction覆盖所有入口。
- **修复批次：** B07。

### AH-015 [P2] 无效 workspaceId 的终端命令静默落到 userData

- **位置：** `src/main/runtime/terminal.ts:26-31`。
- **问题：** 显式传入已删除/拼错 ID 时与未传 ID 共用 fallback。
- **影响：** 命令可能在 AgentHub 配置目录执行并破坏用户数据。
- **最小建议：** 显式 ID 不存在即抛错；仅 null/undefined 使用明确默认。
- **回归测试：** unknown ID 不 spawn；无 ID 的既定默认单独验证。
- **修复批次：** B07。

### AH-016 [P2] POSIX 取消/退出只杀直接进程，孙进程可成为孤儿

- **位置：** `src/main/runtime/terminal.ts:46-51,143-153`；`src/main/hub/adapters/stdio-adapter.ts:276-303`；`src/main/agentic/tools.ts:152-187`；`src/main/runtime/headless-run.ts:330-355`。
- **问题：** spawn 未建独立 process group，却尝试 kill(-pid) 或只 child.kill。
- **影响：** macOS/Linux 上编译器、server、Agent 子进程在取消后继续运行。
- **最小建议：** POSIX `detached:true` 建组并统一杀负 PGID；Windows 保留 taskkill。
- **回归测试：** POSIX fixture 派生孙进程，取消后父子均退出；Windows 分支单测不退化。
- **修复批次：** B07。

### AH-017 [P3] `taskToTurn` 映射不释放

- **位置：** `src/main/index.ts:81,565-579,793-794,996-997`。
- **问题：** 完成/失败/取消/删除/prune 后没有 delete，且 runner 完成后再次 set。
- **影响：** 长时间运行内存持续增长，late event 可能错误关联历史 turn。
- **最小建议：** terminal/finally 清理，并移除完成后的冗余 set；确保最后事件写入后再删除。
- **回归测试：** 各终态和删除路径均释放，多 Agent 同 task 不提前释放。
- **修复批次：** B08。
- **状态：** 已复核。新增稳定 task ID 与 created/finished 快照，final stream 写入后才依次 finished/removed；完成、失败、取消、delete、clear、prune 均释放链接，多 Agent 单个终态不会提前清理，观察者异常也不会破坏生命周期。

### AH-018 [P3] Provider-direct 前置失败绕过 task 数量上限

- **位置：** `src/main/hub/dispatcher.ts:357-392,487-489,1143-1161`。
- **问题：** disabled/unavailable/not found 三个早退分支不调用 `pruneTasks()`。
- **影响：** 反复无效派发可令 tasks Map 无界增长。
- **最小建议：** 统一终结清理或在每个早退前 prune。
- **回归测试：** 150 次各类前置失败后不超过 cap。
- **修复批次：** B08。
- **状态：** 已复核。provider-direct 所有前置失败统一进入幂等 finish/prune；disabled、unavailable、not-found 各 150 次后任务表不超过 100，错误仍完整外显。

### AH-019 [P3] MCP 工具枚举早期失败残留 timeout

- **位置：** `src/main/runtime/mcp.ts:609-619,654-680`。
- **问题：** `finish()` 不统一 clear timer；立即 error/exit 或 early protocol error 会保留 5–30 秒闭包。
- **影响：** 快速重试积累 timer、child 与 pending 引用。
- **最小建议：** finish 首行清 timer，保证幂等。
- **回归测试：** fake timers 覆盖所有早退分支，pending timer 为 0。
- **修复批次：** B06。
- **状态：** 已复核。工具枚举的幂等 `finish` 统一先清 timeout，立即 error、exit、协议错误与成功路径均无残留 timer。

### AH-020 [P1] 危险确认框聚焦取消按钮时 Enter 仍执行确认

- **位置：** `src/renderer/glass/ConfirmDialog.tsx:30-47`；`src/renderer/lib/confirm.ts:56-68`。
- **问题：** 容器/document 对任何 Enter 直接 confirm；DOM 版本还主动 focus Cancel。
- **影响：** 键盘用户可能误删 Provider/workspace/分支/会话或丢弃 Git 改动。
- **最小建议：** 让聚焦按钮保留原生 Enter 语义；只在非交互区域处理显式快捷键，危险框默认聚焦取消。
- **回归测试：** Cancel focus + Enter 返回 false；Confirm focus + Enter true；Escape false。
- **修复批次：** B09。
- **状态：** 已复核。确认框不再拦截隐式 Enter，原生按钮保留自身语义；危险操作默认聚焦取消，Escape/遮罩返回取消。React 与 DOM 确认框共用模态栈，支持 Tab 环绕、逐层关闭与焦点恢复。

### AH-021 [P1] 审批 IPC 返回 false/拒绝后 UI 仍删除审批项

- **位置：** `src/renderer/workbench/WorkbenchLayout.tsx:526-532`。
- **问题：** 不 await/检查 `resolveApproval`，失败后立即移除；remember override 也可能先行保存。
- **影响：** 主进程继续等待而用户无弹窗可处理。
- **最小建议：** await；仅 true 后移除并保存 remember；false/reject 保留并显示错误/允许重试。
- **回归测试：** true、false、reject 三路径。
- **修复批次：** B10。
- **状态：** 已复核。Renderer 等待并检查主进程返回；仅成功 resolve 后移除弹窗并在其后保存 remember override，false/reject/busy 均保留并显示可重试错误。remember 保存失败不反转已提交的审批，并在 Workbench 根层显示跨视图 notice。任务取消、超时或结束会幂等拒绝并清理匹配审批；结束后的晚到审批直接 fail-closed，不创建 pending、事件、持久化记录或 timer。

### AH-022 [P1] Renderer 重载后不重建未决审批

- **位置：** `WorkbenchLayout.tsx:381-398,458-468,706-733`；`workbench/utils/approvalEvents.ts`。
- **问题：** 历史 events 被加载，但只对实时 event 调用审批还原。
- **影响：** 主进程仍等待，重载后弹窗永久消失。
- **最小建议：** 合并 loaded events 时重建未决集合，并排除已 resolved/terminal 请求。
- **回归测试：** reload 历史 pending 恢复；resolved 不恢复。
- **修复批次：** B10。
- **状态：** 已复核。历史 pending 会按 request ID、step ID、run/turn 终态和 ISO 时间顺序重建，并与主进程当前 active ID 集合求交；重启后的 stale 审批不再复活。request ID 含进程会话 nonce，实时 resolution、terminal、run epoch、单/多 legacy pending 与 task/agent cancel scope 均有回归覆盖。

### AH-023 [P2] deny/read-only/custom 审批策略显示为“完全访问”

- **位置：** `src/renderer/workbench/ComposerBar.tsx:169-172,1267-1276`；`src/renderer/screens/ApprovalsTab.tsx:73-90`。
- **问题：** 除两种 ask 组合外全部落入 full。
- **影响：** UI 对实际安全策略作相反陈述。
- **最小建议：** 精确映射 3×3 write/exec 或增加 read-only/custom 标签。
- **回归测试：** 所有策略组合。
- **修复批次：** B10。
- **状态：** 已复核。Composer 与 Approvals 页统一精确显示 ask、auto、full、read-only、custom；旧配置按 write/exec 组合兼容迁移且保留 overrides。模式保存使用 `setApprovalPreset` 返回的权威配置更新 UI，保存期间锁定选择，失败时保持原标签并显示错误。

### AH-024 [P1] 发送失败永久丢失草稿与附件

- **位置：** `src/renderer/workbench/ComposerBar.tsx:369-400`；`WorkbenchLayout.tsx:921-962`。
- **问题：** `onSend` 前清空，prop 返回 void；schedule unavailable 或 IPC reject 无恢复。
- **影响：** 用户输入和附件不可恢复丢失。
- **最小建议：** onSend 返回 Promise/结果，成功后清空；失败保留快照与错误。
- **回归测试：** unavailable/reject 保留，成功清空。
- **修复批次：** B11。
- **状态：** 已复核。Composer 使用不可变 submission 和显式发送结果；create reject、busy、路由/调度不可用与 cancel 均保留原草稿和附件，只有成功才清除未变化的提交内容，等待期间的新草稿不会被晚到成功/失败覆盖。`turns.create` 已成功而线程刷新失败时仍判定发送成功，仅显示刷新警告，避免重复提交。

### AH-025 [P1] SDD 并发 autosave 可由旧请求覆盖新内容

- **位置：** `SddDraftEditor.tsx:327-364`；`sdd-draft-actions.ts:88-135`；`src/main/sdd/sdd-store.ts:262-285`。
- **问题：** 重叠写入无串行/revision；B 先完成、A 后完成会把磁盘回退到 A，而 UI 可能显示 saved。
- **影响：** 需求文档数据损坏。
- **最小建议：** 每 draft 串行保存或 revision/CAS，旧请求不得成为最终落盘值。
- **回归测试：** 延迟反转时磁盘/lastSaved/UI 都为最新内容。
- **修复批次：** B12。
- **状态：** 已复核。Renderer 以 workspace root、draft ID、session 与 revision 捕获同一份正文/设计上下文快照，旧保存不得更新 saved/error；Main 端按规范化物理 draft 目录串行读写/历史/删除，反序完成时最终磁盘、`lastSaved` 与 UI 均保持最新版本，删除后的晚到写入不会重建目录。

### AH-026 [P2] Assistant 普通 JSON 行被静默删除

- **位置：** `src/renderer/workbench/ThreadView.tsx:867-899`。
- **问题：** 任意可 parse 的 `{...}` 行都会进入分支；无内部字段时仍 `continue`，代码块内 `{"foo":"bar"}` 也消失。
- **影响：** Agent 有效输出被隐藏。
- **最小建议：** 只消费带明确内部 discriminator/envelope 的行；未知 JSON 原样保留。
- **回归测试：** 普通/围栏 JSON保留，内部事件仍转换/隐藏。
- **修复批次：** B13。
- **状态：** 已复核。仅带已知内部 discriminator/envelope 的 JSON 行进入内部事件消费；未知普通 JSON 与围栏 JSON 原样保留，既有内部事件转换/隐藏行为保持。

### AH-027 [P2] Provider 配置 IPC 连续拒绝会无限 500ms 重试

- **位置：** `src/renderer/App.tsx:116-147`；`provider-config-load-policy.ts:8-10`。
- **问题：** error 分支未递增 retry count，永不到上限且无最终错误。
- **影响：** 持续 IPC/日志负载，配置页永久加载。
- **最小建议：** 每次失败递增，达到上限停止并显示可重试错误。
- **回归测试：** 连续 reject 次数有限，成功前重试仍工作。
- **修复批次：** B13。
- **状态：** 已复核。reject 与空配置统一占用有限重试预算；request generation、timer owner 和 unmount 清理阻止旧请求偷预算或重挂定时器，到达上限后暴露可手动重试错误。

### AH-028 [P2] 外观/系统主题/语言异步恢复锁在首帧值

- **位置：** `src/renderer/App.tsx:72-107`；`appearance.ts:127-148,234-241`；`glass/i18n.ts:9-20`。
- **问题：** effect `[]` 与闭包持有初始偏好；异步 store 恢复只 set state，未重新 apply/setLang。
- **影响：** 无 localStorage 或后切 system 时主题/语言显示与保存值不一致。
- **最小建议：** apply/subscription effect 依赖完整偏好；恢复语言显式 setLang；清理旧 media listener。
- **回归测试：** Electron store 恢复、切 system、语言恢复。
- **修复批次：** B13。
- **状态：** 已复核。异步恢复后重新应用完整外观并同步语言；system 监听随当前偏好重订阅，partial change detail 先 normalize，非法 detail 不再污染当前状态。

### AH-029 [P2] Provider/路由乐观更新可被乱序响应或旧 rollback 覆盖

- **位置：** `src/renderer/App.tsx:218-276`。
- **问题：** 多 mutation 无 generation/串行；旧全量响应或旧快照 rollback 覆盖较新操作。
- **影响：** UI/持久化配置回退或显示错误。
- **最小建议：** 按资源 revision/队列；失败重新拉取权威配置，避免套旧快照。
- **回归测试：** deferred Promise 反序完成与一个失败一个成功。
- **修复批次：** B13。
- **状态：** 已复核。全局 mutation revision、按资源 revision、pending 集合与权威 reload 协同阻止同资源/跨资源反序覆盖；失败不再套旧快照，迟到 `configChanged` 仅触发受代次保护的权威读取，卸载后不得新建读取或重试。

### AH-030 [P2] 无 workspace/thread 时工作台永久轮询

- **位置：** `WorkbenchLayout.tsx:134,335-411`。
- **问题：** `emptyWorkspaceRetryRef` 从未递增，500ms timeout 无限递归并重复多个 IPC/snapshot。
- **影响：** 空安装持续 CPU/IPC/磁盘活动。
- **最小建议：** 有限指数退避或改为 workspace change 事件触发。
- **回归测试：** 空状态静置调用次数有上限；新增 workspace 后恢复。
- **修复批次：** B14。
- **状态：** 已复核。空 workspace 自动加载使用有限重试并在达到上限、恢复、显式选择和卸载时正确清理 owner/timer；personal sentinel 与迟到 metadata load 不再误选或重启轮询。

### AH-031 [P2] 后台 SDD 完成事件使用当前可见 workspace 取 Git 证据

- **位置：** `WorkbenchLayout.tsx:245-268,458-468`；`sdd-trace-dispatch.ts:182-226`。
- **问题：** runtime event 全部使用闭包中的当前 workspaceId；其他 workspace 的完成事件路径校验失败且静默漏证据。
- **影响：** Trace/Todo 完成记录不完整或归属错误。
- **最小建议：** 从 event thread/todo source 解析所属 workspace。
- **回归测试：** A 可见、B 后台完成时证据写入 B。
- **修复批次：** B12。
- **状态：** 已复核。完成事件优先按 `event.threadId -> thread.workspaceId` 解析所属 workspace；线程尚未进入快照时才按 Todo source root 回退，无法解析则 Git evidence fail closed 且不影响 Todo/Trace 完成。Windows root 统一斜杠与大小写，POSIX 保留大小写和反斜杠语义；A 可见/B 后台完成只读取并写入 B 的证据。

### AH-032 [P2] 旧 Todo 请求可污染新 thread/workspace

- **位置：** `WorkbenchLayout.tsx:381-400`。
- **问题：** `setThreadTodos(await ...)` 在 generation 校验之前。
- **影响：** 快速切换后显示/操作旧线程 Todo。
- **最小建议：** await 到局部值，校验 gen/thread 后再 set。
- **回归测试：** A 慢、B 快时最终只显示 B。
- **修复批次：** B14。
- **状态：** 已复核。Todo 先 await 到局部值，再同时校验 load generation 与目标 thread identity 后提交；A 的迟到 resolve/reject 均不得覆盖或清空 B。

### AH-033 [P2] 最后一条排队消息发送后仍残留输入框

- **位置：** `ComposerBar.tsx:351-367`。
- **问题：** dequeue 先回填 text/attachments，成功后只 slice queue，不清编辑器。
- **影响：** 已发送内容看似未发送，易重复发送。
- **最小建议：** 成功移除队首时同步清空，或直接用队列快照发送不回填编辑器。
- **回归测试：** 单条/多条队列排空。
- **修复批次：** B11。
- **状态：** 已复核。队列由单队首 async worker 按 FIFO、exactly-once 处理，仅 `ok:true` 删除；失败停止后续并支持重试，真实 Stop 暂停且压过晚到成功，显式 Resume 后从原队首继续。Composer 跨 Workbench 视图保持挂载，StrictMode/effect 抖动、owner 切换、跨 head 标记泄漏与 slash command 入队均有行为回归测试。

### AH-034 [P2] 排队消息未快照当时的 model/mode 路由

- **位置：** `ComposerBar.tsx:351-374,1226-1233`；`WorkbenchLayout.tsx:924-948`。
- **问题：** queued overrides 为 undefined，实际发送读取父层最新选择。
- **影响：** 用户排队时选择的 Agent/模型/编排模式被静默替换。
- **最小建议：** 入队保存完整 dispatch snapshot，并在发送时使用。
- **回归测试：** 入队后切模型/模式，消息仍按原选择。
- **修复批次：** B11。
- **状态：** 已复核。入队时深快照 mode、target、model、附件及 canonical graph/steps schedule，并保留显式 null；concrete Agent 失效会明确失败而不静默改派，`auto`/`all` 占位符和内置 Auto/Broadcast 仍走正常路由。thread/workspace owner 改变时暂停，只有用户点击“移至当前会话并重试”才转移；route rebuild 意图按 submission ID 隔离，不污染后续队首。

### AH-035 [P2] `route:decision` 被可见事件过滤器丢弃

- **位置：** `ThreadView.tsx:559-560,617-623,758-765`。
- **问题：** 汇总/渲染已有 route 支持，但 visible filter 不返回 true。
- **影响：** 用户看不到模型/Agent 路由决策。
- **最小建议：** 加入明确白名单并避免重复。
- **回归测试：** route event 出现在对应 turn。
- **修复批次：** B14。
- **状态：** 已复核。`route:decision` 纳入明确可见事件白名单并出现在对应 turn，run-only 内部事件仍保持隐藏，未引入重复渲染。

### AH-036 [P3] Sidebar resize 后 Git bottom dock 仍按固定宽度定位

- **位置：** `SessionSidebar.tsx:53,97-141,178`；`globals.css:3024-3033`；`appearance.ts:202`。
- **问题：** aside 只改 inline width/flexBasis，dock 使用未同步的 `--wb-sidebar-width`；初始值也不一致。
- **影响：** dock 重叠或留空。
- **最小建议：** resize/restore 同步 CSS variable，或由共享 layout 读取同一值。
- **回归测试：** 最小/最大/恢复宽度的变量和几何一致。
- **修复批次：** B15。
- **状态：** 已复核。默认、restore 与 pointer drag 的 248～420px clamp 统一在 `.wb-shell` owner 发布 `--wb-sidebar-width`，Sidebar inline geometry 与 Git bottom dock 始终消费同一宽度 token，默认值统一为 312px。

### AH-037 [P2] 只修改 SDD 设计上下文不会触发保存

- **位置：** `SddDraftEditor.tsx:26-105,327-343`；`sdd-draft-store.ts:174-180`；`sdd-draft-actions.ts:88-120`。
- **问题：** updateDesignContext 不置 dirty；正文未变时保存函数提前返回。
- **影响：** 品牌色/设计元数据重载后丢失。
- **最小建议：** 独立 design revision/dirty，保存条件覆盖 metadata。
- **回归测试：** 只改 designContext 后自动保存并可重载。
- **修复批次：** B12。
- **状态：** 已复核。`designContext` 变更与正文共享 edit revision/dirty/save 快照，正文未变时也会自动持久化；保存完成只确认发起时的精确 session/revision，重载可恢复设计元数据。

### AH-038 [P2] SDD Assistant 切模型后继续请求旧模型

- **位置：** `SddRequirementsList.tsx:398-505`。
- **问题：** callback 读取 modelSelection，但依赖数组遗漏。
- **影响：** UI 选择与实际调用不一致。
- **最小建议：** 加依赖或读取最新 ref/store。
- **回归测试：** rerender 切模型后 quickComplete 参数更新。
- **修复批次：** B12。
- **状态：** 已复核。Assistant callback 依赖包含 `modelSelection`；使用稳定 events/Todo/provider 引用和真实启用的 M1/M2 目录复现后，父组件 rerender 切到 M2 的下一次 `quickComplete` 精确使用 M2，已开始的请求仍保持其触发时快照。

### AH-039 [P2] 快速打开两个 SDD 草稿时慢响应反选旧草稿

- **位置：** `SddRequirementsList.tsx:386-391`；`sdd-draft-actions.ts:53-80`。
- **问题：** loadDraft 无 generation/abort，A 慢 B 快时 A 最后 setActiveDraft。
- **影响：** 用户编辑错误草稿，trace 也可能错配。
- **最小建议：** selection token 校验 draft 与 trace。
- **回归测试：** A 慢 B 快最终 B；stale A 不写 error/trace。
- **修复批次：** B12。
- **状态：** 已复核。全局 load generation 在任何 await 前分配，draft/trace 原子提交，workspace/unmount/delete 会失效旧 load；history hydration/mutation、parse、restore、assistant/verify 写回均校验 root/ID/session/revision/content。A 慢/B 快、same-key ABA、delete/load 反序与跨 workspace 同 ID trace 均 fail closed，旧请求不得写 active/error/trace 或复活已删除草稿。

### AH-040 [P2] Settings 修改 workspace 后主工作台状态不刷新

- **位置：** `WorkspacesTab.tsx:31-57,106-124`；`WorkbenchMainContent.tsx:329-353`；`WorkbenchLayout.tsx:413-415`。
- **问题：** CRUD/setActive 只刷新 Settings tab，工作台仅初始加载且无 change event。
- **影响：** 返回聊天后仍使用被删除/旧的 workspace。
- **最小建议：** 共享 store/event 或显式 reload callback。
- **回归测试：** set active、edit、delete active 后工作台立即同步。
- **修复批次：** B14。
- **状态：** 已复核。Settings 成功 mutation 通过 `known | invalidate` 事件同步主工作台；刷新失败仍触发 authoritative manager reload，非法事件被忽略。workspace load 与旧 `selectThread` generation 互相失效，set active、edit、delete successor/null 及反序完成均保持最新状态。

### AH-041 [P2] MCP workspace 切换可被旧响应覆盖

- **位置：** `McpSettingsTab.tsx:63-79,136-159`。
- **问题：** refresh 无 request generation，effect 的 alive 未传入 refresh；切 workspace 也不 invalidate tools 请求。
- **影响：** B workspace 页面显示 A 的 MCP server/tools。
- **最小建议：** 统一 generation/AbortController，切换时清 tools；同类 Settings async refresh 不在卸载后 setState。
- **回归测试：** A 慢 B 快、切换中 listTools。
- **修复批次：** B14。
- **状态：** 已复核。稳定 workspace owner 与 list/tools 独立 request generation 覆盖 refresh、scan、CRUD 与工具列表；切换/卸载同步失效旧 resolve/reject/finally 并清除旧 UI，迟到 A 不得污染 B。

### AH-042 [P2] Usage tab/range/filter/page 请求乱序覆盖

- **位置：** `UsageStatsDashboard.tsx:53-121`。
- **问题：** stats、records、facets 无请求代次。
- **影响：** 页码/筛选控件与内容不一致。
- **最小建议：** refresh generation 或 endpoint AbortController。
- **回归测试：** deferred requests 反序，最终仅最新筛选生效。
- **修复批次：** B14。
- **状态：** 已复核。统一 generation 守卫 stats、records、facets、pricing、selection、loading/error/finally 与卸载；旧 range/filter/page/pricing 请求均不得回写最新 UI。

### AH-043 [P3] 审批弹窗缺少 modal 语义与键盘约束

- **位置：** `src/renderer/glass/approval-dialog.tsx:25-107`。
- **问题：** 无 role/aria-modal、初始安全焦点、focus trap、Escape、焦点恢复。
- **影响：** 键盘/读屏用户可能无法理解或安全处理高风险审批。
- **最小建议：** 使用小型统一 modal/focus primitive，默认聚焦 Deny。
- **回归测试：** role、初焦点、Tab 环绕、Escape、焦点恢复。
- **修复批次：** B09。
- **状态：** 已复核。审批弹窗具备命名/描述完整的 modal dialog，默认聚焦 Deny，焦点受限于栈顶弹窗，Escape 拒绝并恢复焦点；连续审批切换会重新聚焦 Deny。

### AH-044 [P3] 多个弹层允许焦点逃到遮罩后方

- **位置：** `WorkbenchAnnouncementModal.tsx:15-55`；`CreateWorkspaceDialog.tsx:48-75`；`CommandPalette.tsx:119-158`；`SessionSidebar.tsx:382-408`。
- **问题：** dialog 语义、trap、Escape、restore 不完整或缺失。
- **影响：** 键盘焦点落到不可见背景控件。
- **最小建议：** 复用同一 modal/focus manager，保持现有视觉。
- **回归测试：** 每个弹层 Tab 环绕、Escape、restore。
- **修复批次：** B09。
- **状态：** 已复核。Announcement、CreateWorkspace、CommandPalette、Session rename 统一使用共享模态焦点栈，补齐 dialog 语义、Tab/Shift+Tab、栈顶 Escape 与焦点恢复；CommandPalette 使用一致的 combobox/listbox active-descendant 模型。

### AH-045 [P3] 高文字缩放下 sidebar 消失且无替代导航

- **位置：** `globals.css:5156-5169`；`src/main/index.ts:392-396`。
- **问题：** CSS viewport ≤820 隐藏 sidebar；窗口最小宽 960 在 125%+ zoom 即触发，UI 无 drawer/hamburger。
- **影响：** 线程/workspace 导航不可达，违反重排/缩放可访问性。
- **最小建议：** 提供可键盘访问的 drawer/导航按钮或不隐藏核心导航。
- **回归测试：** 200% zoom/窄 CSS viewport 下可打开会话导航。
- **修复批次：** B15。
- **状态：** 已复核。窄至 320 CSS px 时改为纵向 reflow 并保留真实 workspace/thread 导航 DOM；resize handle 隐藏，核心按钮具名、目标尺寸不少于 24px 且有 `:focus-visible`，桌面 Sidebar 行为保持。

### AH-046 [P3] 英语命令面板仍优先显示中文 label

- **位置：** `CommandPalette.tsx:141-151`；`workbench/utils/paletteCommands.ts:20-48`。
- **问题：** 始终取 `labelZh || label`。
- **影响：** 英文 UI 混入中文。
- **最小建议：** 按当前语言选择 labelEn/labelZh。
- **回归测试：** zh/en 两种渲染。
- **修复批次：** B15。
- **状态：** 已复核。命令标签按当前语言解析，fallback 为目标语言→通用 `label`→另一语言→`id`；渲染与搜索共用同一 resolved label，语言切换即时更新且保留既有焦点、Escape 与方向键行为。

### AH-047 [P3] Usage/Composer/Markdown 局部文案不跟随语言

- **位置：** `UsageStatsDashboard.tsx:6-19,66-395`；`ComposerBar.tsx:805,1060-1074`；`MarkdownBlock.tsx:103-116`。
- **问题：** 多处用户可见英文硬编码，中文模式不切换。
- **影响：** 本地化不完整。
- **最小建议：** 仅替换确认的用户可见字符串为现有 `tr`，不做组件重写。
- **回归测试：** 中文/英文关键文案断言。
- **修复批次：** B15。
- **状态：** 已复核。Usage 的页签、范围、卡片、筛选、详情、分页、定价、错误与 token/cost 动态文案，Composer 的 Agent 选择器与预算状态，以及 Markdown 文件菜单/打开失败文案均按当前语言解析；三份测试渲染真实组件并覆盖中英文，AH-042 generation 与 B11 队列状态机保持不变。

### AH-048 [P2] Agent Loop 设置控件可编辑但不保存且不影响执行

- **位置：** `AgentLoopSettingsTab.tsx:48-90,196-239`；`src/main/ipc/agent-loop-ipc.ts:136-164`；`src/main/hub/agent-loop-integration.ts`。
- **问题：** IPC 只有 get/status/route，无 set；UI 仅改本地 state。`AgentLoopIntegration.dispatch` 也无生产调用，页面却把参数描述为执行配置。
- **影响：** 用户改 mode/maxSteps/timeout/delegation 后离页即丢，且误以为生效。
- **最小建议：** 在未完成完整执行接线前，将该区明确标成只读预览/禁用并显示不可用状态；若实现持久化，则必须有实际 consumer。禁止伪保存。
- **回归测试：** 页面不再提供无效可编辑控件，状态文案准确；route preview 仍可用。
- **修复批次：** B16。
- **状态：** 已复核。mode/maxSteps/timeout/delegation 改为具名的只读 `output`，明确提示执行设置尚未接线且不可修改；值复用既有只读统计样式，配置区不再含可编辑元素，Route Test 仍按原 IPC 入参与结果工作。

### AH-049 [P1] Electron 33 运行时包含多项已知安全公告

- **位置：** `package.json`/`package-lock.json` 的 `electron@33.4.11`。
- **问题：** `npm audit` 报 ASAR integrity bypass、多个 UAF、导航/权限/IPC 等公告；Electron 虽列 devDependency，但其二进制就是打包后的应用运行时。
- **影响：** 桌面应用继承已公开漏洞。
- **最小建议：** 升级到当前受支持且 audit 可接受的 Electron 版本，逐项跑 typecheck/unit/build/E2E/build:win/打包启动。
- **回归测试：** audit、Electron E2E、Windows unpacked app 启动与核心 smoke。
- **修复批次：** B17。
- **状态：** 已复核。运行时已升级并锁定到 `electron@43.1.0`，配套 `electron-builder@26.15.3`、`electron-vite@5.0.0` 与 `vite@7.3.6`；`npm audit --omit=dev --json` 和完整 `npm audit --json` 均返回 0 vulnerabilities，Electron E2E 4/4 与 Windows NSIS installer 生成通过。

### AH-050 [P1] 构建/测试链存在 critical/high 已知漏洞

- **位置：** `happy-dom@18`、`electron-builder@25`、`electron-vite@2`、`vite@5` 及其 tar/esbuild/node-gyp 传递链。
- **问题：** 完整 `npm audit` 共 15 个漏洞节点（1 critical、12 high、2 moderate），包括 happy-dom VM escape、tar path traversal、Vite dev server path/UNC 问题。
- **影响：** 测试处理不可信 HTML、开发服务器和发布构建链受影响。
- **最小建议：** 选择互相兼容的受支持版本（锁文件固定），不用 `audit fix --force` 盲升；升级后 audit 归零或对剩余项逐条证明不可达。
- **回归测试：** npm ci/audit、全单测、build、E2E、build:win。
- **修复批次：** B17。
- **状态：** 已复核。构建/测试链已升级并锁定到兼容组合：`electron-builder@26.15.3`、`electron-vite@5.0.0`、`vite@7.3.6`、`happy-dom@20.10.6`、`@vitejs/plugin-react@4.7.0`；`npm ls` 目标树一致，prod/full audit 均为 0 vulnerabilities。

### AH-051 [P2] CI lint 门禁在当前 HEAD 稳定失败

- **位置：** `src/main/runtime/git.ts:428`；`plugin-marketplace.ts:194-195`；另有 40 warnings。
- **问题：** `no-control-regex` 1 error、`prefer-const` 2 errors，GitHub Actions 的 lint 步骤必失败。
- **影响：** 任何 PR 均无法通过现有 CI。
- **最小建议：** 保持行为不变：对确有必要的控制字符检测改为 charCode/helper 或最窄规则说明；两个变量改 const。warning 中只修与本轮行为 Bug重叠项，不做无关大重构。
- **回归测试：** `npm run lint` 0 error；typecheck/相关测试。
- **修复批次：** B18（首个质量修复，解除后续 lint 门禁例外）。
- **状态：** 已复核。分支名控制字符检查改为等价 charCode 判定，两个只读变量改为 `const`；全量 lint 已恢复 0 errors / 37 warnings，相关测试与 typecheck 通过，未顺带清理无关 warning。

### AH-052 [P3] backup security 测试在仓库根目录遗留文件

- **位置：** `src/main/runtime/__tests__/backup-security.test.ts:5-48`。
- **问题：** 只有 beforeEach，无 afterEach；每次全量测试留下 `test-tmp-backup-security/backups/*.json`。
- **影响：** 工作树污染、后续审计/提交误收临时数据。
- **最小建议：** 使用系统临时唯一目录并 afterEach/finally 清理，或至少在 repo 内明确清理。
- **回归测试：** 单测结束后目标目录不存在；连续运行无残留。
- **修复批次：** B18。
- **状态：** 已复核。每个测试改用系统临时唯一目录并在 `afterEach` 强制清理；连续两轮运行均无临时残留，仓库根既有 artifact 的文件与哈希保持不变。

### AH-053 [P3] Headless CLI 正常运行向 stderr 输出 MODULE_TYPELESS 警告

- **位置：** `scripts/agenthub-cli.mjs` 动态加载 `src/main/runtime/headless-run.ts`；根 `package.json` 无 module type。
- **问题：** Node 24 每次 run 都重新判定 TS 为 ESM并警告有性能开销。
- **影响：** CLI JSON 输出的 stderr 不干净，自动化消费者容易误判。
- **最小建议：** 在不改变打包 main 模块语义的前提下给该源码明确模块边界，或让 CLI 加载明确 ESM 的可执行模块；不得简单给根 package 加 `type:module` 破坏 bundle。
- **回归测试：** CLI version/dry-run/mock stderr 不含 MODULE_TYPELESS，JSON 可解析。
- **修复批次：** B18。
- **状态：** 已复核。在 runtime 源码目录增加局部 ESM 边界，根 `package.json` 与打包 main 的 CommonJS 语义不变；CLI 测试改为真实捕获成功态 stderr，version/dry-run/mock/status 均无 MODULE_TYPELESS 警告。所有写记录路径显式使用测试临时 runsDir，复审前后默认 CLI 目录完整快照不变且无新增临时残留。

### AH-054 [P3] VERSION 记录仍宣称基线分支为 `new`

- **位置：** `VERSION.md:4`。
- **问题：** 当前发布基线已在 main，文档仍写 `Current branch baseline: new`。
- **影响：** 发布/审计人员可能从错误分支制作版本。
- **最小建议：** 改为稳定分支 `main`，本轮工作分支仍在审计文档记录。
- **回归测试：** version-sync 增加/更新分支记录断言或文档校验。
- **修复批次：** B18。
- **状态：** 已复核。当前发布基线改为唯一的 `main` 行；version-sync 按行收集全部当前基线并严格断言唯一精确值，缺行、重复、错值或跨行内容均不能假绿，历史版本记录保持不变。

### AH-055 [P3] Electron E2E 单一大 smoke 无法拦截关键交互回归

- **位置：** `test/e2e/app.spec.ts`。
- **问题：** 仅 1 条流程，部分通过 `page.evaluate(...click())` 绕过真实交互；composer “focusable”只断言 visible；不监听 pageerror/console error，也不覆盖 modal、i18n、zoom、失败态与导航守卫。
- **影响：** 真实 Electron 安全/键盘/语言/失败回归可在 1536 单测全绿时漏过。
- **最小建议：** 不追求大而全，补本轮最高风险的真实 Electron 导航、键盘取消、语言/zoom 与 console error 断言；保持串行和独立 userData。
- **回归测试：** 新 E2E 本身即验收，并连续运行至少两次排除污染。
- **修复批次：** B18。
- **状态：** 已复核。单一 smoke 已拆出真实 Settings/Providers/Composer 焦点、公告 Escape、语言切换与 200% zoom 导航，以及本地临时 `file:` top-level navigation block 四条独立 Electron 测试；renderer 早期/实时 pageerror 与 console error 零容忍，进程退出、硬超时兜底和独立 userData 清理均保持。导航守卫子项不使用 HTTP(S)、localhost 或外部网络兜底，当前 `npm run test:e2e -- --reporter=line` 为 4 passed。

### AH-056 [P3] AppStore 原子提交返回值迁移破坏共享持久化链类型

- **位置：** `src/main/store.ts:180-210`。
- **问题：** `commit<T>()` 改为返回持久化后的 `T` 后，内部 `operation` 变为 `Promise<T>`，但仍直接赋给声明为 `Promise<void>` 的 `saveChain`，使全仓 typecheck 出现类型错误。
- **影响：** CI/typecheck 门禁失败，且调用方是否拿到原始提交 Promise 的错误语义不再明确。
- **最小建议：** 调用方继续返回原始 `operation`；共享链仅用 `then<void>` 投影为 void，并在链内吸收错误以保持后续写入可用。
- **回归测试：** 成功提交返回 JSON-canonical 值；失败向当前调用方传播；下一次写入仍可执行；全仓 typecheck 通过。
- **修复批次：** B19。
- **状态：** 已复核。调用方保留原始 `Promise<T>` 的值/拒绝语义，共享链独立投影为 `Promise<void>` 并在失败后继续可用；首次 token flush 拒绝也被显式观察且不重复日志。`store-local-token` 23/23、typecheck 与规格/质量复审 PASS。

### AH-057 [P1] 重复 `will-quit` 可在异步清理完成前放行退出

- **位置：** `src/main/index.ts:1141-1144`。
- **问题：** 第一次 `will-quit` 启动清理后把 `willQuitCleanupStarted` 设为 true；第二次事件直接 return，没有再次调用 `event.preventDefault()`。
- **影响：** 重复 quit 可在 runtime store drain 与最终 config flush 完成前结束进程，留下未持久化状态。
- **最小建议：** 每次事件都先同步 `preventDefault()`，只让清理 Promise 启动一次；最终仍由单一完成路径调用 `app.exit(0)`。
- **回归测试：** 连续触发两次 `will-quit`，两次事件均被阻止，清理和 exit 各只执行一次，且 exit 晚于 flush。
- **修复批次：** B19。
- **状态：** 已复核。纯 helper 对每个 quit 事件同步 `preventDefault()`，cleanup 单飞且正常 exit 只执行一次；exit 抛错时仅重置 exit attempt，后续事件复用已完成 cleanup 并重试。目标 2/2，规格与质量复审 PASS。

### AH-058 [P1] Shutdown 关闭 Store 前未等待 Dispatcher 真正静止

- **位置：** `src/main/index.ts:1155-1168`；`src/main/hub/dispatcher.ts` 的 stdio 完成轮询与终态写入路径。
- **问题：** `registry.stopAll()` 只保证 adapter stop 返回；部分 stdio 完成仍依赖 Dispatcher 的后续轮询。当前只等待一次 `setImmediate` 就调用 `runtimeStore.dispose()`，晚到终态会在 store 进入 closing 后被拒绝。
- **影响：** 应用退出后持久化 turn 可能永久停留在 running，重启时展示错误任务状态。
- **最小建议：** 在关闭 runtime store 前加入明确的 Dispatcher quiescence barrier；若超时，原子地把仍未完成的 turn 标为 interrupted，再进入 dispose。
- **回归测试：** 模拟终态晚于一个事件循环到达；shutdown 必须等待或持久化 interrupted，且 dispose 后无迟到写入。
- **修复批次：** B19。
- **状态：** 已复核。关闭新 producer admission 后等待 Dispatcher 原始 transport/stdio stop、create/retry producer 与 task-turn pending writer；双 deadline 隔离外部不响应来源，最终通过 RuntimeStore dispose barrier 关闭 writer admission、排空已接纳写入并原子持久化 interrupted。失败 disposal 保留 interrupt reason 且可重试。精确 B19 9 files / 134 tests，规格与质量复审 PASS。

### AH-059 [P2] 直接切换 Workspace 未失效慢速 Thread 选择

- **位置：** `src/renderer/workbench/WorkbenchLayout.tsx:776-831`。
- **问题：** `selectThread()` 使用 `selectThreadGenRef` 防旧请求回写，但 `selectWorkspace()`/普通 `loadWorkbench()` 不递增该 generation，也不清理 pending selection。慢速旧 thread 请求可在新 workspace 加载后继续提交旧 snapshot、thread、Todo 与 goal。
- **影响：** UI 出现跨 workspace 状态污染，选择器与实际数据不一致。
- **最小建议：** workspace 切换开始时统一失效 thread selection，并清空 pending refs/state；与 workspace-change handler 复用同一 helper。
- **回归测试：** 挂起 workspace A 的 `threads.select`，完成切换 B 后释放 A；最终仍保持 B 的 workspace/thread/Todos，pending thread 为空。
- **修复批次：** B20。
- **状态：** 已复核。直接 workspace 切换与 workspace-change 统一同步失效旧 thread generation 并清空 pending；旧选择的 resolve/reject、通过首个检查后的 snapshot/Todo/goal 迟到，以及普通 rename refresh 的反序均不能覆盖新选择或显示旧错误。目标 17/17，规格与质量复审 PASS。

### AH-060 [P2] Approval 终态判断漏掉 `interrupted`

- **位置：** `src/renderer/workbench/utils/approvalEvents.ts:281-283`；`src/shared/turn-status.ts`。
- **问题：** approval 恢复逻辑维护了独立终态字符串表，未包含共享状态模型已定义的 `interrupted`。当 active-ID 查询失败退化为 `null` 时，中断 turn 的历史 pending approval 可被重新恢复。
- **影响：** 用户重载后会看到已经无效的审批并可能继续操作过期请求。
- **最小建议：** 复用共享 `isTerminalTurnStatus`，仅保留 `canceled`/`error` 等兼容别名。
- **回归测试：** approval 后收到 `turn:status interrupted`，再出现迟到/重复 approval 且 active IDs 不可用，恢复结果必须为空。
- **修复批次：** B20。
- **状态：** 已复核。终态集合改为派生自共享 `TERMINAL_TURN_STATUSES`，仅补 `canceled/error` 兼容别名；`activeIds=null` 时 interrupted 历史会 tombstone pending，目标 33/33，规格与质量复审 PASS。

### AH-061 [P1] 实时语言切换重挂整个 Workbench 并丢失临时状态

- **位置：** `src/renderer/App.tsx:437-442`。
- **问题：** `WorkbenchLayout` 使用 `key={lang}`；语言变化会卸载并重建整个工作台，而非仅触发翻译重渲染。
- **影响：** Composer 未发送草稿、附件与发送队列，以及 Usage 当前 tab/filter/page 等组件本地状态会丢失。
- **最小建议：** 移除语言 key remount，让现有 `useLang()` 订阅驱动正常重渲染；只在确有必要的叶组件修正 memo 依赖。
- **回归测试：** 在真实挂载后填写 draft/附件/队列并改变 Usage 状态，实时切换 zh/en；文案更新且这些状态保持。
- **修复批次：** B20。
- **状态：** 已复核。移除 `key={lang}`，保留 `useLang()` 订阅驱动同一 Workbench 实例重渲染；App 根级测试确认文案更新且 Composer draft/附件/队列及 Usage tab/filter/page 保持，规格与质量复审 PASS。

### AH-062 [P2] SDD AI 响应可在 A→B→A 切换后误归属当前草稿

- **位置：** `src/renderer/sdd/components/SddRequirementsList.tsx:526-560`。
- **问题：** AI 请求捕获了发起时草稿，但返回后 chat/plan 路径读取当前 store，只验证当前 key/后续 apply hash，没有重新验证请求 source snapshot。切到 B 再回 A 时，旧 A 响应可被当作新 A 会话结果写入 trace/applyContext。
- **影响：** 过期模型输出污染需求草稿的 trace 或可应用内容，形成 ABA stale writeback。
- **最小建议：** 请求发出时捕获 draft session/revision/content hash；任何 trace/applyContext 产生前确认当前 source snapshot 完全一致，否则丢弃并提示重试。
- **回归测试：** A 请求挂起→切 B→回 A 并修改/重载→释放旧响应；不得写 trace，不得返回可应用上下文。
- **修复批次：** B20。
- **状态：** 已复核。AI 成功返回后、任何 plan trace/chat/verify applyContext 副作用前统一复核 draft id/root/session/revision/content；plan/chat ABA 目标 26/26，规格与质量复审 PASS。

### AH-063 [P2] Run 缺少 task/step 身份导致迟到事件与新运行混淆

- **位置：** `src/main/runtime/types.ts:123-134`；`src/main/runtime/store.ts:200-300,933-954,1009-1135`。
- **问题：** Run 原先主要按 `(turnId, agentId, role)` 匹配，`start` 又没有持久化 Dispatcher 已携带的 `taskId/scheduleStepId`。同一 agent/role 的旧任务迟到事件可命中新任务 Run；取消墓碑也无法可靠区分新旧 task。
- **影响：** 已取消 Run 可被迟到 start/done 复活或重复创建，新 Run 可能被旧 settlement 错误完成/失败，legacy role 迁移也会写错对象。
- **最小建议：** 在 Run 持久化 task/step 身份；查找时 exact task 优先，仅对无身份 legacy Run 做受限 fallback并回填身份；无法证明新身份时 fail-closed。
- **回归测试：** scoped cancel 后 late start 不新增 Run；同 role 新旧 task settlement 隔离；legacy role 回填 task/step；无法证明新 task 时保持取消墓碑。
- **修复批次：** B21。
- **状态：** 已复核。Run 现持久化 `taskId/scheduleStepId`，匹配按 task exact-first、step/role 唯一命中；exact step 存在时不降级到缺 step Run，partial/legacy fallback 仅限唯一可证明候选，歧义或身份冲突均 fail-closed。新增 3 个 RED 覆盖 exact-step 与较新 partial 共存、已知 step/role 冲突及多 partial 歧义；Store 55/55、B19+B21 组合 187/187、typecheck、限定 ESLint 及最终规格/质量复审均 PASS。

### AH-064 [P2] Scoped Agent 取消未跨排队角色保留墓碑

- **位置：** `src/main/hub/dispatcher.ts:274,400-413,948-969,1268-1285`；`src/main/hub/__tests__/orchestrator-e2e.test.ts:651-701`。
- **问题：** `cancelAgent()` 原先只停止当前 transport，没有在当前 DispatchTask 上保留 agent 取消墓碑。同一 agent 的另一个角色已在 local FIFO 排队时，会在前一个角色释放队列后继续启动。
- **影响：** 用户只取消一次却仍执行该 Agent 的后续 worker/verifier 角色；其他 Agent 的并行任务语义也难以验证。
- **最小建议：** 以 `(DispatchTask, agentId)` 保存 scoped tombstone；队列出队和真正启动 transport 前再次检查。墓碑不得污染未来新 DispatchTask，也不得停止其他 agent。
- **回归测试：** 首个 Codex 与 Claude 已运行、第二个 Codex 已排队后取消 Codex；Codex 调用保持 1，Claude 完成，未来独立任务 Codex 仍可运行。
- **修复批次：** B21。
- **状态：** 已复核。Dispatcher 同时保留 task-local、turn-scoped Agent 与整 Turn 墓碑，在 intake、local FIFO 出队、transport 启动和 stream 发射前重复检查；同 Agent 已排队/后续同 Turn 角色不会晚启动，其他 Agent 与未来独立 Turn 不受影响。IPC 先启动 runtime 原子取消，再同步写 Dispatcher 墓碑，最后 await runtime 结果；B19+B21 组合 187/187、typecheck、限定 ESLint及最终规格/质量复审均 PASS。

### AH-065 [P2] Runtime-event snapshot 可在切换 Workspace 后迟到覆盖新状态

- **位置：** `src/renderer/workbench/WorkbenchLayout.tsx:588-605`。
- **问题：** runtime event 触发的 scoped snapshot 与 all snapshot Promise 没有绑定发起时 workspace/generation。Workspace A 请求挂起后切换 B，A 的迟到结果仍可覆盖 B 的 `snapshot`、`allSnapshot` 与 `allThreads`。
- **影响：** 当前 workspace、活动 thread 与全局 thread 列表相互不一致，用户可能看到或操作旧 workspace 状态。
- **最小建议：** 每次 refresh 捕获 generation 与 workspace owner；load、workspace/thread 切换、新 refresh 和 effect cleanup 统一失效旧请求。
- **回归测试：** scoped/all/both 迟到 resolve、迟到 reject、unmount cleanup 与同 owner 新旧 refresh 竞争。
- **修复批次：** B22。
- **状态：** 已复核。生产路径用 generation + workspace owner 双门禁保护 scoped/all snapshot 提交；真实挂载测试直接观察 active thread、allThreads、错误与 render 副作用。受控移除门禁时 4 个关键用例 RED，最终目标 28/28，规格与质量复审均 PASS。

### AH-066 [P2] `persistPlanTrace` 可把旧计算结果写入新草稿会话

- **位置：** `src/renderer/sdd/sdd-draft-actions.ts:404-445`。
- **问题：** `computeTrace` 返回后原先只比较 draft id/workspace；A→B→A、同 A editRevision 变化，或 A 编辑后再切 B 时，旧 trace 仍可能写回 store/磁盘。
- **影响：** 过期计划追踪污染新会话或覆盖用户刚编辑的需求状态。
- **最小建议：** 捕获 active source 的 session/revision/content，并在计算期用单向失效墓碑记录任何 source 变化；保留 clean A→B 的后台持久化与最初 inactive target 语义。
- **回归测试：** session ABA、editRevision、edit→switch、initially inactive→active 与 clean A→B。
- **修复批次：** B22。
- **状态：** 已复核。计算期间订阅 store 并永久记录 captured source invalidation，`finally` 无条件退订；过期请求返回 `null` 且不 set/save，合法后台目标仍保存。两轮规格缺口均先 RED，最终 action 68/68，规格与质量复审均 PASS。

### AH-067 [P1] 缺少统一的 durable DecisionService 与启动/关停接线

- **位置：** `src/main/runtime/decision-service.ts`（原缺失）；`src/main/index.ts:92,539-546,1111-1118,1181-1190`。
- **问题：** 新的 durable decision 合同已有 store schema/factory/test，但服务模块原先不存在，typecheck 直接报模块缺失；Turn/Hub owner、FIFO、idempotency、deadline、limits、脱敏审计与 orphan recovery 没有统一生产 owner。
- **影响：** 审批请求无法以原子、可恢复且 exactly-once 的方式进入生产生命周期，启动恢复和退出收敛也无可靠顺序。
- **最小建议：** 实现单 actor `DecisionService`，只通过 `commitRuntimeMutation` 改 durable 状态；Hub session 由服务端 ID 鉴权；startup sweep 早于 Turn admission，shutdown 早于 producer drain/final flush。
- **回归测试：** Turn/Hub sender、owner FIFO、provisional limits、pending clone/filter、deadline promotion、selection validation、idempotency、redacted audit、orphan sweep 与 wiring 顺序。
- **修复批次：** B23。
- **状态：** 已复核。服务 API、固定上限、原子可见性、Turn/Hub 生命周期、exactly-once terminal path、startup sweep 与 bounded shutdown 已接线；最终 DecisionService 36/36、Store 59/59、typecheck/lint 通过，规格与质量复审均 PASS。

### AH-068 [P1] DecisionService shutdown 失败可跳过资源与 remember effect 排空

- **位置：** `src/main/runtime/decision-service.ts:390-430`。
- **问题：** terminal batch commit 拒绝时旧 shutdown 会跳过 listener/timer/abort/retry cleanup；后续版本虽放入 `finally`，仍会在拒绝时跳过 `pendingEffects` drain 并清空追踪，使 `onRemember` 在最终 flush 后迟到执行。
- **影响：** 退出过程中可能继续产生写入或副作用，且原始 terminal 错误与 effect 错误的优先级不稳定。
- **最小建议：** 捕获原 terminal 错误，无论成功/失败都循环 `allSettled` 排空动态 effects，随后在 `finally` 清理全部资源，最后重抛原错误。
- **回归测试：** terminal commit reject + pending remember effect；effect settle 前 shutdown 保持 pending，settle 后以原错误拒绝并完成清理。
- **修复批次：** B23。
- **状态：** 已复核。组合 RED 证明旧实现提前 settle；修复后先 drain effects、再 cleanup、最后保真重抛，新增组合 1/1 与全服务 36/36 通过，最终质量复审 PASS。

### AH-069 [P1] Terminal 提交失败的重试策略可热循环或永久丢失

- **位置：** `src/main/runtime/decision-service.ts` 的 timeout、AbortSignal 与 terminal runtime-event 路径。
- **问题：** timeout 提交失败后原先立即 `setTimeout(0)`，持续故障形成热循环；AbortSignal 与 terminal event 又会吞掉首次失败且不重试，waiter 可永久 pending。
- **影响：** 持久化故障时可能造成 CPU/磁盘压力，或留下永不结算的审批与 Turn。
- **最小建议：** 三条路径共用按 request/turn key 隔离、可取消且有界的指数退避；settle/shutdown 取消所有 retry。
- **回归测试：** timeout 持续失败无 0ms 热循环；abort/terminal 首次失败后恢复；settle/shutdown 无遗留 timer/map。
- **修复批次：** B23。
- **状态：** 已复核。统一 100/200/400 ms、最多 4 次重试，Promise rejection 双分支观察；4 个新增 RED 全部转 GREEN，DecisionService 35/35 后再补 AH-068 组合为 36/36，Store 59/59 与最终质量复审 PASS。

## 3. 修复批次与依赖顺序

| 批次 | Bug | 主题 |
|---|---|---|
| B01 | AH-001 | Electron 顶层导航边界 |
| B02 | AH-002 | Windows stdio shell 注入 |
| B03 | AH-003～005 | ACP 审批 fail-closed 与风险语义 |
| B04 | AH-006～007 | 取消/超时/ACP 生命周期 |
| B05 | AH-008～010 | Orchestrator 并发、计划上限、verifier 错误 |
| B06 | AH-011～013、019 | MCP 持久化/协议/资源清理 |
| B07 | AH-014～016 | Workspace、Terminal 与进程树边界 |
| B08 | AH-017～018 | 任务映射与数量上限 |
| B09 | AH-020、043～044 | 安全确认与 modal 可访问性 |
| B10 | AH-021～023 | 审批 UI 状态恢复/决策/显示 |
| B11 | AH-024、033～034 | Composer 失败恢复与队列快照 |
| B12 | AH-025、031、037～039 | SDD 保存、归属与选择一致性 |
| B13 | AH-026～029 | 输出、配置恢复与 Provider 竞态 |
| B14 | AH-030、032、035、040～042 | Workbench/Settings 异步一致性 |
| B15 | AH-036、045～047 | 布局缩放与国际化 |
| B16 | AH-048 | Agent Loop 死控件准确性 |
| B17 | AH-049～050 | 运行时/构建/测试依赖安全 |
| B18 | AH-051～055 | CI、测试隔离、CLI、版本、E2E |
| B19 | AH-056～058 | Store Promise 链与 shutdown 持久化收敛 |
| B20 | AH-059～062 | Renderer generation、终态、语言与 SDD ABA |
| B21 | AH-063～064 | Run 身份与 scoped cancellation 墓碑 |
| B22 | AH-065～066 | Workbench snapshot 与 SDD trace 迟到写入 |
| B23 | AH-067～069 | Durable DecisionService、shutdown 与 terminal retry |

每个批次都必须先新增失败测试并观察 RED；实现后目标/邻接测试 GREEN；再由未参与实现的子代理逐 ID 审查。Reviewer 任一 ID 为 BLOCK，则整个批次不得关闭或进入下一批。

## 4. 未列入修复的观察项

- `src/shared/ipc-contract.ts` 超过 3000 行：用户明确排除仅为拆文件的任务。
- bundle/CSS 检查报告超预算和硬编码颜色：记录为后续性能/设计系统优化，当前缺少独立用户可见故障证据。
- system MCP server-entry/config 当前未接入生产调用：启用前必须另做 notification、policy、symlink 专项审计。
- Hub client 广播隔离、PTY session owner 转移语义需要产品信任域确认，当前不冒充确认 Bug。
- Windows 发布未签名且关闭代码签名验证已在 `VERSION.md` 明确为既定发布策略；真正修复需要签名证书与发布授权，超出本次代码修改权限。
