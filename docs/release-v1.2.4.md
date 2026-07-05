# AgentHub v1.2.4

## 更新内容

- 完善 SDD 需求闭环：需求草稿、AI 写回、计划生成、Todo 同步、Trace 可视化和验证证据链路。
- 加强 Workbench 架构拆分：抽离面板容器、UI 状态、Composer 工具函数、调度请求解析和命令路由。
- 增强 IPC 安全：为主进程暴露通道补齐运行时参数校验和契约测试。
- 改进本地 Agent 运行稳定性：补充 stdio 生命周期状态、Windows 进程树关闭处理和运行事件同步。
- 增加 Electron E2E smoke 测试，并修复 GitHub Actions Linux 环境下缺少显示服务的问题。

## 修复说明

- 修复 SDD 助手结果可能覆盖已切换或已修改草稿的风险。
- 修复 SDD 计划同步可能覆盖非当前需求范围 Todo 的问题。
- 修复验证证据可能混入其他草稿或其他线程信息的问题。
- 修复测试环境 Electron 单实例锁导致 E2E 启动不稳定的问题。
- 清理源码和测试中的可见中文乱码，保留运行时乱码检测能力。

## 验证

- `npm run typecheck`
- `npm run lint`：0 errors，33 warnings
- `npm test`：216 files，1372 tests
- `npm run build`
- `npm run test:e2e`：1 Electron smoke test
- `npm run build:win`

## Windows 安装包

- `AgentHub-Setup-1.2.4.exe`
- `AgentHub-Setup-1.2.4.exe.blockmap`
