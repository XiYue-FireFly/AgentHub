# 玻璃拟态 UI 重做 — 实现与 screenshots/ 逐屏比对

> 实现依据：`AgentHub UI设计/design_handoff_glass_ui/README.md`；数值以 `app/styles.css` 与 jsx 源码为准。
> 本报告逐屏列出对照结果与（少量）有意差异。

## 新增 / 改动文件

| 文件 | 说明 |
|---|---|
| `src/main/index.ts` | `frame:false`、`backgroundColor:#101319`、win:minimize/maximizeToggle/close IPC、修复 `registerAgentsFromBindings`（补 `createAdapter` 导入、去掉非法 await） |
| `src/preload/index.ts` | `onStream` 改监听 `dispatch:stream`（修复原 `hub:stream` 通道不匹配）、新增 `proxy.info` 与 `win.*` |
| `electron.vite.config.ts` | 启动时把设计包 `app/icons/*.png` 同步到 `src/renderer/public/icons/`（设计包不存在则跳过） |
| `src/renderer/globals.css` | 设计令牌全量照搬 styles.css + 外壳工具类（drag 区、winbtn） |
| `src/renderer/index.html` | 移除旧 Tailwind 类与 Google Fonts（设计为系统字体栈） |
| `src/renderer/glass/meta.ts` | AGENT_META（colorRaw：codex #7b87fa / claude #d97757 / hermes #aab4c4 / openclaw #e04540）、MODE_ZH/STATUS_ZH/TASK_ST、数据类型 |
| `src/renderer/glass/ui.tsx` | Icon/IC、AgentMark（hermes 浅底特例）、StatusDot、Switch、Seg、SectionTitle、Enter、Collapse、TaskStatusBadge |
| `src/renderer/glass/Titlebar.tsx` | 46px 标题栏：三色圆点（红=关闭/黄=最小化/绿=最大化，可点击）、AH 徽标、280px 玻璃搜索框、Hub 状态 |
| `src/renderer/glass/Sidebar.tsx` | 218px 玻璃侧边栏：导航、Agents 列表（点击跳会话并指定）、proxy 地址（proxy:info 实时获取） |
| `src/renderer/screens/Home.tsx` | 总览页 |
| `src/renderer/screens/Chat.tsx` | 会话页（流式、思考折叠、极简 markdown） |
| `src/renderer/screens/Tasks.tsx` | 任务历史页 |
| `src/renderer/screens/Settings.tsx` | 设置页（提供商/路由/外观三个 Tab） |
| `src/renderer/App.tsx` | 壳层组装 + 全部真实 IPC 接线（hub:status / hub:dispatch / dispatch:stream / providers:* / routing:setBinding / proxy:info） |

旧 UI 文件（`components/`、`pages/`、`store/`、`hooks/`）已不再被引用，构建会自动摇树剔除；如需我可以再做一次清理删除。

## 逐屏比对

### 01-总览.png ✅
- 标题 26px/700 + 副标 `{n} 个 Agent 在线 · {n} 个任务运行中 · 今日完成 {n} 个`（实时统计）；右侧薄荷绿「新建派发」胶囊 → 跳会话。
- 卡片网格 `repeat(auto-fill, minmax(250px,1fr))` gap16；三条对齐线已按原型实现：头部行固定 48px（48px 贴片圆角 13）、模型栏固定 37px（黑 20% 圆角 10 等宽字）、能力 chips `flex:1; align-content:flex-start`、按钮 `margin-top:auto` 贴底。
- 模型栏内容真实取自路由绑定：stdio → `本地 CLI · stdio`（终端图标，Agent 专属色）；http → `{Provider} · {Model}`（链接图标）。截图里 Codex 显示 stdio 是原型模拟数据；实际显示跟随你的真实绑定。
- 最近任务前 4 条：状态徽章/省略文本/模式 chip/Agent 小图标(20px r6)/时间(42px 右对齐)。
- 「下午好」按时段动态（上午好/下午好/晚上好/夜深了），下午截图状态一致。

### 02-会话空状态.png ✅
- 控制条：分段「智能路由/广播全部/链式接力」+ 1px 分隔线 + 「指定：」四个 Agent 胶囊（选中=专属色描边/文字 + 14% 着色底）。
- 空状态：居中广播图标 36px + 「输入任务开始派发 — 试试「重构 dispatcher 的轮询逻辑」」+ 副提示。
- 输入区 glass-strong 圆角 18，「发送」空文本时禁用（35% 透明度），Enter 发送 / Shift+Enter 换行。

### 03-会话广播回复.png ✅
- 用户气泡右对齐 glass-strong 圆角 `18 18 5 18`，下方「广播 · 4 个 Agent」。
- 回复网格 `repeat(auto-fit, minmax(300px,1fr))`；卡片头 = 24px 贴片 + 名称 + 状态（连接中… → busy 点 → mint 对勾）；流式光标 7×14 mint 闪烁。
- 代码块黑底等宽（rgba(0,0,0,0.32) r9）、行内代码、加粗，与原型 renderRichText 一致。
- 数据来自真实 `dispatch:stream`（content channel 累加）。

### 04-会话思考展开.png ✅
- 思考折叠块：黑 20% 圆角 10，「🧠(线性脑图标) 思考过程」折叠头 + 旋转箭头；展开斜体 `--tx-2` 12px（thinking channel 累加），Collapse 用 grid-rows 0fr→1fr 过渡。
- 链式模式回复卡带序号 chip（mint）。

### 05-任务展开详情.png ✅
- 筛选分段 全部/运行中/已完成/失败；顶栏搜索输入即跳任务页并联动过滤。
- 任务行：徽章（color-mix 12% 底 + 40% 描边）/省略文本/模式 chip/Agent 图标组/耗时（等宽 50px，如 42.1s）/时间/展开箭头；运行中行换成红色「取消」按钮（调 hub:cancel）。
- 展开：`task-id · 模式 · n 个 Agent` 等宽小字；结果块黑 18% 圆角 10；错误块红描边红字等宽。
- 任务来源：本会话派发实时插入顶部 + hub:status 最近任务回填历史。

### 06-设置提供商.png ✅
- 网格 `minmax(330px,1fr)`；卡：首字母贴片 38px、名称+「内置」、baseUrl 等宽 10.5px、右侧 42×24 开关（开=mint）。
- API Key 黑底等宽输入（失焦/Enter 提交 `providers:setKey`）。
- 模型 chips；「健康检查」→「检测中…」→ `● 可达 · {n}ms`（mint）或 `● {错误}`（红），走真实 `providers:health`。
- 未启用卡整体 65% 透明度。
- 与截图差异：截图 4 个提供商是原型数据，实际渲染仓库 presets 全部内置提供商（含 DeepSeek/OpenRouter/自定义），布局规格相同。

### 07-设置路由.png ✅
- 每 Agent 一卡：36px 贴片 + 名称/描述 + 「后端」分段 HTTP/StdIO（仅 codex 可选 StdIO，其余禁用置灰 30%——与 createAdapter 工厂约束一致）。
- StdIO：终端图标（codex 专属色）+ 等宽路径输入（placeholder `C:\Users\…\codex.exe`）+ 说明「派发将 spawn 本地子进程，stdout 实时回流…」→ 写入 `AgentRouteBinding.protocol/binary`。
- HTTP：提供商/模型双列下拉。
- 底部：思考分段（关闭/自动/开启）+ 档位下拉（minimal~xhigh，mode≠off 显示）+ 滑杆 0–2 step0.1 宽 110。
- 按 README 规范用「随机性」文案（截图中"温度 0.2"为旧版渲染，README 明确以文字规格为准）。
- 所有修改即时 `routing:setBinding` 并刷新 hub:status。
- 设置页右上分段含第三项「外观」（动效 关闭/简洁/丰富 三档，jsx 源码包含此 Tab；截图 06/07 摄于仅两项的版本）。

## 与原型的有意差异（功能性，非视觉）

1. 标题栏三色圆点可点击：红=关闭（默认最小化到托盘）、黄=最小化、绿=最大化/还原 —— README 允许 Windows 自绘窗口控制，做成与截图完全同观感的方案。
2. 智能路由模式下，回复卡在后端路由结果（stream start 事件）到达后出现 —— 原型本地模拟可即时预知 Agent，真实环境由 KeywordRouter 决定。
3. 链式接力为渲染层编排：Codex 完整输出 → 作为输入派发给 Claude（dispatcher 的 chain 模式不带 targetAgent 时只会路由单个 Agent）。
4. hermes 的「未启用」状态按 README 规则推导：绑定的提供商未启用或无 Key（对所有 http 绑定 Agent 生效）。

## 构建与验证步骤（本机）

```bash
cd "C:\Users\Admin\Documents\安装与卸载\agenthub"
npm run typecheck   # tsc --noEmit
npm run dev         # 启动后图标会自动从设计包复制到 src/renderer/public/icons/
```

注意：首次 `npm run dev`/`build` 会执行 electron.vite.config.ts 里的图标同步（codex/claude/hermes/openclaw.png）。
