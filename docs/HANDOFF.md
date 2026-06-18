# AgentHub 项目交接说明（给接手的 Claude）

> 你将接手继续开发 AgentHub。本文件是冷启动交接：读完即可上手。最后更新 2026-06-15。
> 配套文档：架构见 [DESIGN.md](./DESIGN.md)，源码逐文件索引见 [SOURCE.md](./SOURCE.md)。
> **换电脑/换人接手**：先跳到 [§8 迁移到另一台电脑](#8-迁移到另一台电脑完整交接清单)，那里是不随 git clone 走的本机配置（密钥/登录/环境）。

---

## 0. 一句话
AgentHub 是 **Electron 33 + React 18 + TS** 的桌面工作台：把多个本地 AI Agent CLI
（Codex / Claude Code / Hermes / OpenClaw / Marvis / MiniMax Code）和 HTTP 大模型供应商
统一到一个玻璃拟态界面，支持 **智能路由 / 广播 / 链式 / 编排** 四种派发模式 + 本地路由代理 + Desktop Agent 接管。

## 1. 位置 / 命令（重要）
- **源码（实际工作目录）**：`C:\Users\Admin\Documents\安装与卸载\agenthub`（git 仓库，分支 `master`）。
  ⚠️ 会话默认 cwd `C:\Users\Admin\AgentHub项目文件1` 是空的——**不是源码**。git 操作一律用 `git -C "<源码路径>"`。
- **GitHub**：`origin` = https://github.com/hycailxy/agenthub（**私有**，默认分支 master）。git 身份 `hycailxy / 2674648836@qq.com`。
- **gh CLI**：`C:\Program Files\GitHub CLI\gh.exe`，已登录 `hycailxy`，token scopes 含 `repo, workflow`。
  推含 `.github/workflows/*` 的提交需 workflow scope；若推送报缺 scope：`gh auth refresh -h github.com -s workflow` 后 `gh auth setup-git`。
- **开发**：`npm run dev`（须在源码目录）。⚠️ 见 §6 端口/单实例坑。
- **校验**：`npm run typecheck`、`npm run lint`、`npm test`（vitest）、`npm run build`。
- **打包**：`npm run build:win` → `dist\AgentHub-Setup-<ver>.exe`。
- **CI**：`.github/workflows/ci.yml`（windows-latest 跑 typecheck+lint+test+build）。

## 2. 当前版本与进度
**版本 0.2.0**（`package.json` version + build.buildVersion 均 0.2.0）。tag `v0.1.0` 为完整功能基线；
**`v0.2.0` 尚未打 tag**（等公测前定稿/联机验证后再发版）。

0.2.0 已完成并提交（master 上，见 `git log`）：
- **修复/加固**：#1 Marvis 卡死候选禁用、#2 stdio-plain 绑定+健康检查鉴权感知、#5 代理 CORS+WS 绑环回鉴权、
  #7 API Key safeStorage 加密、#8 stdio oneshot 完成判定加固、#9 per-agent 元数据统一 manifest（`src/main/hub/agents.ts`）。
- **删死代码/质量门**：#3 删除旧 pre-glass UI 树、#4 test/lint/CI + 文档刷新。
- **计量/成本**：#6 从流解析真实内容+token 用量、A1 token 计量 UI、B1 费用估算 + 预算可按费用、A2 预算上限/告警。
- **路由**：A3 按任务类型加权打分路由（`router.routeScores`）、B2 Chat 路由预览（`hub:routePreview` IPC）。
- **编排模式（旗舰，端到端完成）**：O1 引擎（`src/main/hub/orchestrator.ts` + dispatcher `mode:'orchestrate'`：
  lead 分解→`routeScores` 指派→并行执行→lead 汇总）、O2 UI（`glass/orchestrate-view.tsx` + `orchestrate-reducer.ts`
  + Chat「编排」模式入口 + App onStream 处理 `orchestrate:*` 事件）、O3 校验+有界修复回环（verify agent 判 PASS/FAIL，
  失败自动重试 1 次，UI 显示 ✓/✗ 校验徽标）。
- 工具透传 #10 part1（stop-reason 映射 + 中止/超时/断开故障转移）已完成。
- 首次连接引导（connection-status，Codex 作品）：精确状态摘要 + 首跑引导 + 错误修复 CTA。
- **agentic 活动呈现链（2026-06-15，Phase 0–1）**：让 stdio 直连的 CLI 真"动手并把过程显出来"。详见 [AGENTIC.md](./AGENTIC.md)。
  - 渲染层：`glass/activity-view.tsx` 共享 `ActivityTrail` 折叠步骤卡；Chat 实时显示、Tasks 历史留存（memory-library 持久化）；
    Settings 路由页顶部「一键开启 agentic」（检测本机 CLI → 翻 stdio 直连）；`meta.ts` 的 `ActivityStep` 类型 + `App.tsx` onStream `activity` 分支。
  - 后端：`adapters/claude-stream-json.ts`（Claude `--output-format stream-json` 解析，Claude 作品）+ `adapters/codex-stream-json.ts`（Codex `exec --json` 解析，Codex 作品）；
    `stdio-adapter.ts` 按行缓冲 + `activityParser`/`onActivity`（parser=null 零回归）；`dispatcher.ts` emit `{kind:'activity'}` 流事件。
  - **联机冒烟已做（2026-06-15 / 2026-06-16 复核）**：两解析器格式对真实 CLI 输出验证通过；发现的 Codex `--sandbox workspace-write` 只读问题已在 0.5.3 通过 `danger-full-access + -C .` 修复；仍需注意 ② codex 多条 agent_message 会拼接（待 Codex 修）③ 测的 Claude-3p claude.exe 未登录。

**待办（下一步候选，按社区反馈优先级见 §5）**：
- **#10 part2**：Anthropic 入站（Claude Code）工具块转码 + AnthropicWire tool_use/input_json_delta 重编码 +
  Gemini functionCall。**需真实 tool-calling 客户端联机验证**，未在无网环境做。
- **经济模式 / 派发前费用预估**：回应评论区最高频的“token 爆炸”恐慌（A1/A2/B1 已铺好基础）。
- 共享上下文/记忆 + skill；平台（Linux 构建、mac intel）；编排模式的更复杂依赖/串行执行。

## 3. 架构速览（细节见 DESIGN.md / SOURCE.md）
- `src/main/`（主进程）：`index.ts` 入口+IPC、`store.ts`（electron-store + safeStorage 加解密 + `getLocalToken`）、
  `hub/`（registry / dispatcher / router / orchestrator / agents 清单 / agent-connections / adapters/*）、
  `routing/`（proxy 9528 双协议 / takeover 配置接管）、`providers/`（presets / manager / client / types）。
- `src/preload/index.ts`：`window.electronAPI` 安全桥。
- `src/renderer/`（React）：`App.tsx`（根+IPC 监听+派发簿记）、`glass/`（设计系统 i18n/meta/ui/budget/
  connection-status/orchestrate-*）、`screens/`（Home/Chat/Tasks/Settings）。
- **关键不变量**：`adapter.protocol` 决定派发路径；stdio adapter 的 `proc` 字段名与 `mode='oneshot'` 被 dispatcher 轮询依赖勿改名；
  接管必留 `.agenthub-bak` 可还原；渲染层只走 IPC（旧 WebSocket 客户端已删）；API Key 落盘加密，内存明文，
  `unlockSecrets()` 在 app ready 后解密（勿在 ready 前解密）。

## 4. 协作模式（务必遵守）⭐
本项目由**两个 AI 会话并行开发**：**Claude（你）+ 一个 Codex 会话**，**共用同一磁盘上的同一个 git 仓库**（非两份克隆）。
- **职责**：Claude = UI/UX + 搜集评论建议 + 定方向 + 审查；Codex = 后端/主进程编码 + 测试，完成/遇阻向 Claude 汇报请审。
- **看板握手**：仓库根 `COLLAB.md`（已 gitignore，本地实时白板）。**每次操作前**先读它（看占用锁+留言），
  再留言登记你要做的事；改文件/提交/推送前都握手。看板被高频并发写时 Edit 会撞“读后被改”，可用 Bash `>> COLLAB.md` 原子追加。
- **git 卫生**：**只 `git add` 自己改的具体文件，绝不 `git add -A`**（否则会把对方未提交在制品卷进你的提交——已犯过一次）。
  提交信息标注作者区。不碰对方占用中的文件。
- 我（本 Claude）**无法**用会话工具直接联系 Codex（`list_sessions` 看不到它）；唯一异步通道就是 `COLLAB.md` + 用户转达。

## 5. 社区反馈 → 路线图（来自用户抖音 AgentHub 视频评论）
用户抖音号 `2026.11.28（AgentHub）`，主推视频 7.6万播放/130+评论。筛出的开发信号（按价值）：
1. **编排/总-agent 模式**（最高赞：雨若9赞、往家走4赞、大R…）→ **已做（O1/O2/O3）**。
2. **成本控制 / “token 爆炸”恐慌**（多条高频）→ A1/A2/B1 已做；**下一步建议**：派发前费用预估 + 经济模式（简单任务走便宜模型）。
3. 智能模型路由 + 可配置模型梯队（往家走）→ A3 已做，可加用户自定义规则。
4. 共享上下文/记忆 + skill（作者已回“可加 skill”）；防幻觉/校验 harness（O3 已部分回应）。
5. 平台：Linux 版、mac intel、手机版（三端在用户长期路线图）。
6. 最高频非开发诉求：**赶紧发公测 + 给下载入口**。

## 6. 已知坑 / 注意事项
- **CI 与 Node/npm 版本（重要）**：CI 用 **Node 24**（`.github/workflows/ci.yml`），因本仓 `package-lock.json` 由 Node 24/npm 11 生成；
  npm 10（Node 20）会对 lock 里的 `@esbuild/<其它平台>` optional 依赖报 EBADPLATFORM。**改 deps 后务必用 Node 24/npm 11 跑 `npm install` 更新 lock 并提交**，否则 CI 的 `npm ci` 会红。
  本地验证 CI 安装：`npm ci`（须先关掉占用 node_modules 的 electron，否则 EBUSY）。**不要只 `npm install`**——它可能不重算依赖图、lock 仍残缺。
- **electron 二进制下载（国内）**：`rm -rf node_modules` 后重装，electron postinstall 从 GitHub 下 ~190MB 二进制常被墙、静默失败（dist 只剩 ~8MB、无 electron.exe，`npm run dev` 报 `Error: Electron uninstall`）。
  解法：缓存里通常已有 `%LOCALAPPDATA%\electron\Cache\electron-v<ver>-win32-x64.zip`，手动 `Expand-Archive` 到 `node_modules\electron\dist\` 并写 `node_modules\electron\path.txt`=`electron.exe`；或设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 再 `npm rebuild electron`。
- **仓库外文件的测试**：`devLauncherScript.test.ts` 读仓库父目录的 `start_agenthub_dev.ps1`，已加 `existsSync` 守卫（CI 无该文件时跳过）。新增依赖仓库外资源的测试要照此守卫。
- **开发版 vs 安装版冲突**：安装版（`...\Programs\AgentHub\agenthub.exe`）占 9527/9528 且有 Electron 单实例锁 + 共用 userData。
  **要跑 `npm run dev` 看新代码，必须先关掉安装版**（`Stop-Process -Name AgentHub -Force`），否则开发版启动后立即退出。
  开发版进程是 `electron.exe`（computer-use 截图需对 `electron.exe` 授权，不是 `agenthub.exe`）。
- **agent 探测噪音**：dev 启动时一堆 `'opencode'/'claude'/'gemini' 不是内部命令` + GBK 乱码 stderr，是 CLI 探测正常输出，非错误。
- **#10 part2 / 费用单价**：工具透传 Anthropic 侧未完（需联机验证）；`glass/meta.ts` 的 `MODEL_PRICES` 是近似单价、会过期，集中可改。
- **codex agentic 写权限（0.5.3 已修）**：`adapters/codex.ts` 默认参数已从 `codex exec --json --sandbox workspace-write …` 改为 `codex exec --json --sandbox danger-full-access --skip-git-repo-check -C . -`。
  2026-06-16 复测 Codex CLI 0.134：`workspace-write` 在非交互 exec 下会自述只读/不能执行 shell；`danger-full-access + -C .` 可在 AgentHub 选择的工作区内执行命令，并能定位本机外部项目。
  待 Codex 定夺：是否不传 `--sandbox`（尊重用户 config）/ 用 `--full-auto` / `-c sandbox_mode=…`。这关系 codex 是否真能动手。Claude 侧 `--permission-mode acceptEdits` 路径 OK（前提是 CLI 已登录）。
- **行尾**：仓库混 CRLF/LF，提交时 git 提示 `LF will be replaced by CRLF` 是正常的，无害。
- **lint**：`npm run lint` 应 0 error（允许少量 unused-var warning）。提交前过四道门（typecheck/lint/test/build）。

## 7. 立刻可接手的事
1. 想验证编排：关安装版 → `npm run dev` → 会话页选「编排」→ 配好 Provider Key → 发个复杂任务，看分解/子任务/校验/合成。
2. 想推进路线图：做「派发前费用预估 + 经济模式」（命中最高频痛点，基础已具备）。
3. 想发版：补 #10 part2 联机验证 → 打 `v0.2.0` tag → `npm run build:win` 出安装包 → 推 GitHub。
4. **动手前先读 `COLLAB.md` 并留言**（§4）。

## 8. 迁移到另一台电脑（完整交接清单）
新电脑是从 GitHub **clone**，只会拿到**已 push 的提交**。本节列出代码之外、不随 clone 走、必须在新机重建的东西。

### 8.1 交接前（旧电脑，务必先做）⭐
否则新机 clone 到的是旧代码：
1. **所有在制品先提交**：`git -C "<源码>" status` 应干净。两个 AI 会话各自 `git add` 自己的文件后提交（**绝不 `git add -A`**，见 §4）。
2. **推送 master**：`git -C "<源码>" push origin master`（含 `.github/workflows/*` 的提交需 workflow scope，见 §1）。`git log origin/master..master` 应为空。
3. （可选）打交接快照 tag：`git tag v0.2.0 && git push origin --tags`。
4. （可选）把本机 `node_modules\electron\dist` 或 `%LOCALAPPDATA%\electron\Cache` 的 electron 二进制拷给新机，省去新机被墙重下（见 §6）。

### 8.2 新电脑冷启动
1. **拿到私有仓库访问**：仓库私有（`hycailxy/agenthub`）。新机要么用有协作者权限的 GitHub 账号 `gh auth login` 后 clone，要么用 owner 的 token。`git clone https://github.com/hycailxy/agenthub.git`（路径自定，本文 §1 的 `C:\Users\Admin\...` 是旧机路径，新机用自己的）。
2. **环境**：装 **Node 24 + npm 11**（与 CI/lock 对齐，见 §6，用 nvm-windows 切）。`git config user.name/user.email`、`gh auth login`（推送需 `repo`+`workflow` scope）。
3. **依赖**：`npm install`。⚠️ electron postinstall 下 ~190MB 二进制国内常被墙静默失败 → 见 §6 解法（`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后 `npm rebuild electron`，或手动塞缓存 zip）。
4. **跑起来**：`npm run dev`（新机若也装了 AgentHub 安装版，先 `Stop-Process -Name AgentHub -Force`，见 §6）。四道门 `npm run typecheck && npm run lint && npm test && npm run build` 应全过。

### 8.3 不随 git 走、新机必须重建的本机状态（最易漏）⭐
- **Provider API Key**：用 Electron `safeStorage` 加密落盘、**与本机 OS 钥匙串绑定**，拷文件也解不开。→ 新机必须在 **设置→提供商** 重新输入所有 Key。
- **各 CLI 安装 + 登录**（agentic/stdio 的前提，登录态在用户目录非仓库）：
  - **Codex**：装 `codex` CLI；登录态/默认模型在 `~/.codex/config.toml`（可拷贝迁移，或新机 `codex login`）。
  - **Claude Code**：装桌面版/CLI 并登录（`~/.claude/`）；未登录时 agentic 派发会返回「Not logged in · Please run /login」。
  - 其它（Hermes/OpenClaw/Marvis/MiniMax）按需装+配，HTTP 绑定则只需 Provider Key。
- **AgentHub 自身 userData**（路由绑定 / 工作区 / memory-library 对话与任务历史）：在 Electron userData（Windows 约 `%APPDATA%\AgentHub`），**不随仓库走**。新机是空的 → 需重配路由/工作区；若要迁历史，手动拷整个 userData 目录到新机对应位置（但其中加密的 Key 解不开，仍需重输）。
- **`COLLAB.md`**：已 gitignore（§4 并行开发白板），不随 clone 走。新机若仍双 AI 并行需重建；单人接手可忽略。
- **本机记忆/笔记**：接手的 Claude 的跨会话记忆（`.claude` 项目记忆）不随仓库走；本 HANDOFF.md + DESIGN.md + SOURCE.md + AGENTIC.md 是随仓库走的权威交接来源。

### 8.4 验收（新机就绪标准）
四道门全过 + `npm run dev` 能起界面 + 配一个 Provider Key 发条任务跑通；想验 agentic：绑 codex/claude=stdio + 选工作区 + 登录对应 CLI + 发"建个文件并 ls"，看活动步骤卡（注意 §6 codex 写权限待修）。
