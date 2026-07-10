# groknew Wave 2+ Implementation Plan

> 分支：`groknew` | 在 Wave 1 完成后启动全量中端功能

**Goal:** 实现路线图 Wave 2–3 全部条目，并落地可交付的 Wave 4 子集。

## Wave 2 Tasks

| ID | 功能 | 关键文件 |
|----|------|----------|
| F-W1 | Side thread 真线程 | SideConversationPanel.tsx |
| F-W2 | GitHub PR 工作台入口 | GitWorkbenchPanel.tsx |
| F-W3 | 终端切换不杀 PTY | TerminalPanel.tsx |
| F-W4 | SDD rehydrate 后 disk reload | sdd-draft-store / sdd-draft-actions |
| F-W5 | sensitive-files 扩展 | sensitive-files.ts + tests |
| F-W6 | 预算 warning toast | ComposerBar / App |
| F-W7 | i18n 运行时切换 | glass/i18n + Settings 入口 |
| F-W8 | 备份创建/恢复 UX 入口 | Settings appearance/backup 区 |

## 流程
实现 → 子代理审查 → 记录 → 下一项 → 全量测试 + 全局审查
