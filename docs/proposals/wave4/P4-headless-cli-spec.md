# P4 Headless CLI 调度 — 规格草案

**代号：** `W4-CLI`  
**状态：** 草案  

## 1. 目标

在无图形界面环境下发起 AgentHub 任务（CI、脚本、SSH 服务器）。

## 2. 建议命令

```bash
agenthub version
agenthub run --workspace <path> --mode auto|orchestrate --prompt "..." [--agent codex]
agenthub status --run-id <id>
agenthub logs --run-id <id> [--follow]
```

## 3. 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 2 | 参数/配置校验失败 |
| 3 | 运行失败 |
| 4 | 权限/密钥不可用 |
| 5 | 超时 |

## 4. 架构选项

| 方案 | 说明 |
|------|------|
| A | CLI 启动无头 Electron main（重） |
| B | 抽出 `core` 包，CLI 与 Electron 共用（推荐中期） |
| C | CLI 仅调用已运行桌面的本地 HTTP（依赖桌面常开） |

**MVP 建议：** C 快速验证 → B 产品化。

## 5. 安全

- 不在 argv 打印 API Key  
- workspace 必须存在且用户可访问  
- 默认拒绝 `shell_exec` 类高危能力，除非显式 flag  

## 6. 验收

- GitHub Actions 示例 workflow 绿  
- 无 `DISPLAY` 可完成一次 mock/provider 运行  
