# AgentHub 未来迭代建议与功能继实现路线图

> 分支：`groknew` | 日期：2026-07-09  
> 基线：`grok` 轮安全修复 + Grok R2 Critical/High 已闭合  
> 本文档描述**长期路线**与**本分支 Wave 1 立即实现项**。

---

## 1. 产品定位回顾

AgentHub 是本地多 Agent 协同桌面工作台（Electron + React）。核心价值：统一本地 CLI Agent、API 厂商、Git、终端、SDD、MCP 与工作流。

## 2. 三层迭代路线

### 近端 Wave 1（本分支 `groknew`，本轮实现）

以 **G2 Medium 未修项** 为主的「功能继实现 / 安全加固波次」——不是大 UI 重做，而是把已验证的产品能力补到可发布质量：

| ID | 能力 | 价值 |
|----|------|------|
| F-N1 | Terminal IPC sender 归属 | 多窗口隔离，防会话劫持 |
| F-N2 | Bootstrap 上下文敏感文件过滤 | 防止 .env 注入模型 |
| F-N3 | Plugin skill 路径 `isPathInsideBase` | 插件目录前缀逃逸防护 |
| F-N4 | Fork 后导航到新线程 | 补齐分叉对话 UX |
| F-N5 | Proxy token constant-time 比较 | 本地鉴权 hardening |
| F-N6 | FileTree 工作区切换竞态 | 文件树正确性 |
| F-N7 | WriteWorkspace unmount flush | 写作台草稿不丢 |

### 中端 Wave 2–3（本分支已实现）

| ID | 方向 | 状态 |
|----|------|------|
| F-W1 | 侧对话真线程 | ✅ |
| F-W2 | GitHub PR 工作台条 | ✅ |
| F-W3 | 终端切换不杀 PTY | ✅ |
| F-W4 | SDD rehydrate disk reload | ✅ |
| F-W5 | sensitive-files 扩展 | ✅ |
| F-W6 | 预算 warning 通知（去重） | ✅ |
| F-W7 | i18n 运行时切换（Appearance） | ✅ 已有 + 文案强化 |
| F-W8 | 配置备份创建/恢复 UI | ✅ |

### 远端 Wave 4+（已立项，规格阶段）

> 立项分支：`init/wave4-platform`  
> 立项书：`docs/proposals/2026-07-09-wave4-platform-project-charter.md`  
> 子规格索引：`docs/proposals/wave4/README.md`

| 代号 | 方向 | 状态 |
|------|------|------|
| W4-PLUGIN | 插件市场 / 签名与沙箱 | 立项规格 |
| W4-SYNC | 多机配置同步 | 立项规格 |
| W4-FIREFLY | 团队模板与可视化 | 立项规格 |
| W4-CLI | Headless CLI 调度 | 立项规格 |
| W4-A11Y | 无障碍与 i18n 基线 | 立项规格 |

## 3. 非目标（本分支不做）

- 大文件拆分式重构  
- 主依赖大版本升级  
- 重写 Hub 编排引擎  

## 4. 成功标准（Wave 1）

- 7 项 F-N* 均有最小实现 + 测试或可验证路径  
- 每项经子代理审查 APPROVE  
- `typecheck` + 全量 `npm test` 绿  
- 全局符合审查后修复发现的回归  

## 5. 相关文档

- 实施计划：`docs/superpowers/plans/2026-07-09-groknew-wave1-plan.md`  
- 进度：`docs/fix-results/groknew-progress.md`  
- R2 遗留：`BUG_REPORT_GROK_R2.md` Medium 段  
