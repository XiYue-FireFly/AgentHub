# Handoff: AgentHub 玻璃拟态 UI 重设计

## 概述
将 AgentHub（Electron + React 桌面应用，仓库位置 `C:\Users\Admin\Documents\安装与卸载\agenthub`）的渲染层 UI 重做为**深色玻璃拟态（frosted glass）**风格：冷灰蓝基调、薄荷绿强调色、半透明模糊面板、无边框沉浸式窗口。覆盖四个页面：总览、会话（派发）、任务历史、设置（提供商/路由）。

## 关于设计文件
本包中的 HTML/JSX 文件是**用 HTML 制作的设计参考**——展示目标外观和交互的原型，**不是可直接拷贝的生产代码**。任务是在目标代码库（`src/renderer`，React + TypeScript + Electron）的现有环境中**重新实现**这些设计，复用其既有模式（`window.electronAPI` IPC 桥、`useAgentStore`、现有路由）。原型中的模拟数据层（`app/store.jsx`）对应真实 IPC：`hub:status`、`hub:dispatch`、`dispatch:stream`、`providers:*`、`routing:*`。

## 保真度
**高保真（hifi）**。颜色、字号、间距、圆角、交互均为最终意图，应按像素还原，但要用代码库现有的组件习惯实现。

## 全局设计令牌（app/styles.css 为权威来源）

### 颜色
| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg-0` | `#101319` | 窗口底色 |
| `--bg-1` | `#151922` | 背景渐变亮端 |
| 背景光斑 | `rgba(64,116,168,.32)` / `rgba(72,168,150,.22)` / `rgba(96,88,170,.20)` | 三个 blur(110px) 圆形，固定定位 |
| `--glass-bg` | `rgba(255,255,255,0.055)` | 玻璃面板底 |
| `--glass-bg-strong` | `rgba(255,255,255,0.09)` | 强调面板/输入区 |
| `--glass-border` | `rgba(255,255,255,0.09)` | 面板描边 1px |
| `--glass-blur` | `24px` | backdrop-filter 模糊 |
| `--tx-1/2/3` | `rgba(244,247,250,.96)` / `rgba(220,228,238,.62)` / `rgba(210,220,232,.38)` | 三级文字 |
| `--mint` | `#5fd49a` | 强调色（按钮、选中、空闲状态） |
| `--st-busy` | `#e8b34d` | 运行中（带 1.1s 脉冲动画） |
| `--st-error` | `#e8706a` | 异常/失败 |
| Agent 专属色 | codex `#7b87fa` · claude `#d97757` · hermes `#aab4c4` · openclaw `#e04540` | 与图标主色一致，用于光晕/高亮 |

### 形状与字体
- 圆角：大面板 20px / 卡片内块 14px / 输入框 10px / 按钮与胶囊 999px
- 字体：系统栈 `-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei"`；等宽 `ui-monospace, Consolas`（路径、模型名、proxy 地址）
- 基础字号 14px；页标题 19-26px/700；提示文字 11.5px

### 玻璃面板配方
```css
background: var(--glass-bg);
border: 1px solid var(--glass-border);
backdrop-filter: blur(24px);
border-radius: 20px;
```

## 窗口外壳（需改 src/main/index.ts）
- `BrowserWindow`: `frame: false`（或 `titleBarStyle: 'hidden'`），`backgroundColor: '#101319'`
- 自绘标题栏高 46px：左侧 mac 风三色圆点（12px，#ec6a5e/#f4bf4f/#61c554，Windows 下可改为右侧自绘最小化/关闭按钮）→ AH 徽标 + "AgentHub 多智能体工作台" → 居中偏右 280px 玻璃搜索框 → 右侧 "● Hub 运行中"（mint 色，取自 hub:status）
- 标题栏 `-webkit-app-region: drag`，交互控件 `no-drag`

## 屏幕

### 1. 侧边栏（常驻，所有页面）
- 宽 218px，玻璃面板，左/下边距 14px
- "工作台" 标题 17px/700 + 副标 "4 个 Agent · 4 个提供商"
- 导航：总览/会话/任务/设置，36px 行高，选中态 `rgba(255,255,255,0.1)` 圆角 11px + 600 字重
- 分隔线后 "Agents" 列表：28px 图标贴片 + 名称 + 右侧状态点（8px，idle=mint 发光 / busy=amber 脉冲 / error=红 / off=灰）
- 点击 Agent → 跳会话页并指定该 Agent
- 底部等宽小字 `proxy · 127.0.0.1:8787`（取自 proxy:info）

### 2. 总览
- 标题 "下午好"（26px/700）+ 副标 "{n} 个 Agent 在线 · {n} 个任务运行中 · 今日完成 {n} 个"；右侧薄荷绿 "新建派发" 胶囊按钮
- Agent 卡片网格 `repeat(auto-fill, minmax(250px, 1fr))` gap 16：
  - 头部行**固定 48px**：48px 图标贴片(圆角13) + 名称 15px/700 + 描述（超长省略号）+ 状态点和文字
  - 模型栏**固定 37px**：黑色半透明块 `rgba(0,0,0,0.2)` 圆角 10，等宽字：stdio 时 "本地 CLI · stdio"（终端图标），http 时 "{Provider} · {Model}"（链接图标），图标用 Agent 专属色
  - 能力标签：胶囊 chips（11.5px），`flex:1; align-content:flex-start` 保证各卡起始线一致
  - "派发任务" 按钮 `margin-top:auto` 贴底，四卡对齐
  - hover：上浮 2px + 描边变亮
- 最近任务列表（前 4 条）：状态徽章 + 文本省略 + 模式 chip + Agent 小图标 + 时间

### 3. 会话（派发）
- 顶部控制条（玻璃）：分段控件「智能路由 / 广播全部 / 链式接力」+ 分隔线 + "指定：" 四个 Agent 胶囊（选中 = 该 Agent 专属色描边和文字 + 14% 着色底）；右侧提示文案（链式时 "Codex → Claude，前者输出作为后者输入"）
- 消息流：
  - 用户气泡靠右，`glass-strong`，圆角 `18px 18px 5px 18px`，下方小字标注派发模式
  - 回复卡片：广播时 `grid minmax(300px,1fr)` 并列；卡片头 = Agent 图标 24px + 名称 + 状态（连接中… / busy 点 / 完成对勾 / 已停止）；链式时加序号 chip
  - **思考过程折叠块**：黑色半透明块，"🧠 思考过程" 折叠头，点击展开斜体浅色文字（对应 StreamEvent channel:"thinking"）
  - 正文支持代码块（黑底等宽块）和行内代码、加粗；流式时末尾 7×14px mint 闪烁光标
- 输入区：`glass-strong` 圆角 18，textarea 自适应 + 右侧 "发送"（mint）；流式中变红色 "停止"（调 hub:cancel）
- Enter 发送 / Shift+Enter 换行
- 空状态：居中广播图标 + "输入任务开始派发…" 引导文案

### 4. 任务历史
- 标题右侧筛选分段：全部/运行中/已完成/失败；顶栏搜索联动过滤
- 任务行（玻璃卡，gap 10）：状态徽章（已完成=mint描边、失败=红、运行中=amber、已取消=灰）+ 文本省略 + 模式 chip + Agent 小图标组 + 耗时（等宽，如 42.1s）+ 时间 + 展开箭头
- 展开：task id 等宽小字 + 每个 Agent 的结果块（黑底圆角）/ 错误块（红描边红字等宽）
- 运行中的行显示红色 "取消" 按钮

### 5. 设置
右上分段切换「提供商 / 路由」。

**提供商**（grid minmax(330px,1fr)）每卡：
- 名称 + "内置" 标记 + baseUrl（等宽 10.5px）+ 右侧启用开关（40×23 胶囊，开=mint）
- API Key 输入框（等宽，黑底）
- 模型 chips
- "健康检查" 按钮 → 检测中… → 结果："● 可达 · 312ms"（mint）或 "● 未配置 API Key"（红）
- 未启用的卡整体 65% 透明度

**路由**（每 Agent 一张卡）：
- 头部：图标 + 名称/描述 + 右侧 "后端" 分段 **HTTP / StdIO**（仅 codex 可选 StdIO，其余禁用置灰——对应 createAdapter 工厂的约束）
- HTTP 模式：提供商下拉 + 模型下拉（双列）
- StdIO 模式：CLI 二进制路径输入框（等宽，placeholder `C:\Users\…\codex.exe`）+ 说明文字 "派发将 spawn 本地子进程，stdout 实时回流…"；对应 `AgentRouteBinding.protocol/binary`
- 底部：思考模式分段（关闭/自动/开启）+ 档位下拉（minimal~xhigh，mode≠off 时显示）+ 随机性滑杆（temperature 0-2 step 0.1，文案用"随机性"不用"温度"）
- 所有修改即时调 `routing:setBinding` 并刷新 hub:status

## 交互与动效
- 按钮 hover 提亮、active scale(0.97)，过渡 0.12-0.18s
- 开关圆点位移 0.2s cubic-bezier(0.4,0,0.2,1)
- busy 状态点 `@keyframes` 1.1s opacity 脉冲
- **不要使用从 opacity:0 进场的整页动画**（截图/降动效环境会冻结在首帧）
- 滚动条：8px，`rgba(255,255,255,0.12)` 圆角拇指

## 状态管理
- agents：id → status（idle/busy/error/off）；hermes 在 gemini provider 未启用/无 key 时显示 off
- 流式：监听 `dispatch:stream`（start/delta/done/error，channel 区分 content/thinking）累加渲染
- 派发产生的任务实时插入任务页顶部；done 时回填耗时与结果

## 截图（screenshots/，像素还原的对照基准）
逐屏比对实现结果与这些截图：
- `01-总览.png` — Agent 卡片网格 + 最近任务（注意卡片内三条对齐线）
- `02-会话空状态.png` — 控制条 + 空状态引导
- `03-会话广播回复.png` — 广播模式四卡并列、流式光标、思考折叠头
- `04-会话思考展开.png` — 思考过程展开态（斜体浅色）
- `05-任务展开详情.png` — 任务行展开、结果块、状态徽章
- `06-设置提供商.png` — 提供商卡、健康检查结果、开关
- `07-设置路由.png` — Codex 的 StdIO 模式 + 二进制路径、思考/温度行
截图中的下拉框选中值可能渲染不准（截图工具限制），以 README 文字规格为准。

## 资产
`app/icons/`（由用户提供的官方图标处理而来，320×320 PNG）：
- `codex.png` — 蓝紫渐变云朵终端（已抠白底，保留内部白色笔画）
- `claude.png` — 珊瑚色星芒（原生透明底）
- `openclaw.png` — 红色小虫（原生透明底）
- `hermes.png` — 黑白人像线稿（原色、透明底）
图标贴片规则（见 components.jsx `AgentMark`）：统一圆角方块，普通图标 = Agent 专属色 24% 着色玻璃渐变底 + 76% contain；**hermes 特例** = 半透明浅色磨砂底 `rgba(235,239,245,0.88)→rgba(210,218,229,0.62)` + 92% contain（黑线稿需要浅底才可见）。

## 文件清单（本包内）
- `AgentHub 原型.html` — 主原型入口（浏览器直接打开需本地服务器或允许本地文件）
- `变体画布.html` — 总览 3 布局 + 会话回复 2 样式的备选方案画布
- `app/styles.css` — **设计令牌权威来源**
- `app/components.jsx` — 标题栏/侧边栏/图标贴片/开关/分段控件
- `app/screen-home.jsx` / `screen-chat.jsx` / `screen-tasks.jsx` / `screen-settings.jsx` — 四个页面
- `app/store.jsx` — 模拟数据（结构镜像 src/main/providers/types.ts）
- `app/main.jsx` — 壳层组装
- `app/icons/*.png` — Agent 图标
- `app/tweaks-panel.jsx`、`app/design-canvas.jsx` — 原型工具组件，**无需移植**

## 实施建议顺序
1. `src/main/index.ts`：frame:false + backgroundColor
2. 渲染层引入设计令牌（CSS 变量全局样式）+ 背景光斑层
3. 壳层：标题栏 + 侧边栏（替换现有导航）
4. 逐页迁移：总览 → 设置（含 BindingRow 的 HTTP/StdIO UI）→ 会话 → 任务
5. 图标文件放入 renderer 静态资源目录，按 AgentMark 规则封装组件
