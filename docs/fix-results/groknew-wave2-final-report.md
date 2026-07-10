# groknew Wave 2+ 终审报告

> 分支：`groknew` | 日期：2026-07-09

## 已实现（路线图 Wave 2–3 全量 + Wave4 可落地子集）

| ID | 功能 | 说明 |
|----|------|------|
| F-W1 | 旁支真线程 | `threads.create` 独立会话，不再写入 parent |
| F-W2 | GitHub PR 工作台条 | Git 面板：当前分支 PR + 打开 PR 列表 |
| F-W3 | 终端切 tab 不杀 PTY | 仅 dispose xterm；关 tab 才 dispose PTY |
| F-W4 | SDD 磁盘重载 | rehydrate 后 `reloadActiveDraftFromDisk` |
| F-W5 | 敏感路径扩展 | `.aws`/`.ssh`/`.kube`/secrets 等 |
| F-W6 | 预算 warning 通知 | 去重后 push，避免刷屏 |
| F-W7 | 界面语言 | Appearance 已有 zh/en 即时切换 |
| F-W8 | 配置备份 UI | 创建 / 列表 / 恢复 + 重启提示 |

## 测试
- `npm run typecheck` PASS  
- `npm test` **1477** / 230 PASS  

## 审查
- 首轮 Wave2：**BLOCK**（F-W6 通知轰炸）  
- 返工后：**CONSENSUS_PASS**  

## 仍属远期（未实现）
插件市场签名沙箱、多机同步、Firefly 可视化大改、headless CLI 调度。

## 结论
**Wave 2 功能开发完成，测试全绿，可进入提交/发布流程。**
