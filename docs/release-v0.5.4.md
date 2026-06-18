# v0.5.4

## New Features

- 重构 AgentHub 工作台为更简洁的桌面布局，优化顶部栏、聊天区、Composer 和设置页体验。
- 新增首次打开应用公告，引导用户完成 Agent CLI、路由、API 厂商和工作目录配置。
- 新增可用本地 Agent 切换器，仅展示已检测并配置可用的 Agent。
- 新增 API 厂商模型直连运行路径，选择厂商模型后直接通过 API 发送，不再误走本地 CLI。
- 新增 ECC slash 指令入口和 ECC Workflow Skill，用于计划、TDD、审查、验证、安全检查等工作流。
- 新增 Git 工作台，支持分支、diff、暂存、提交、提交历史和分支创建/切换。
- 新增 MCP 配置管理页，支持查看、启用、测试和管理 MCP server 配置。
- 新增使用统计页，支持 Token 真实统计与估算标注。
- 新增外观设置，支持浅色/深色、字体、字号、强调色和动效偏好。
- 新增写作台与上下文容量展示。
- 新增 Windows NSIS 安装包产物。

## Fixes

- 修复选择 DeepSeek 等 API 厂商模型后误调用本地 Agent 的问题。
- 修复 provider 模型发送时进入编排流程的问题。
- 修复普通回答中混入编排 JSON 或中间任务内容的问题。
- 修复 Composer 中本地 CLI 模型读取造成的选择混乱，暂时禁用本地 Agent 模型读取入口。
- 修复 `/` 指令面板中 ECC 指令优先级不足的问题。
- 修复已识别 CLI 路径但无法配置为可用 Agent 的问题。
- 修复深色主题下部分文本和模型列表颜色不协调的问题。
- 修复历史对话打开后滚动位置不正确的问题。
- 修复运行等待时间刷新不及时的问题。
- 修复 Git 弹层被底部聊天框遮挡的问题。
- 修复设置页部分表格、卡片和内容区溢出问题。
- 修复 API provider 模型获取失败时清空可用模型的问题。
- 更新应用内下载页、更新检查和仓库元数据地址到 XiYue-FireFly/AgengHub。

## Performance Improvements

- 优化流式输出渲染，降低运行中的界面卡顿。
- 优化 runtime 事件保存频率，减少高频写盘。
- 优化本地 Agent 状态缓存，减少重复检测。
- 优化 Git 面板加载策略，按需读取 diff。
- 优化外观设置保存节流，提升设置页交互流畅度。

## Windows Installer

- `AgentHub-Setup-0.5.4.exe`
- `AgentHub-Setup-0.5.4.exe.blockmap`
