# Wave 4 平台立项文档索引

> 分支：`init/wave4-platform`  
> 总纲：[立项书](../2026-07-09-wave4-platform-project-charter.md)

| 文档 | 说明 | 状态 |
|------|------|------|
| [P1 插件市场](./P1-plugin-marketplace-spec.md) | 包格式、校验、威胁模型 | 规格草案 |
| [P2 配置同步](./P2-config-sync-spec.md) | 导出/导入、密钥、冲突 | 规格草案 |
| [P3 Firefly 模板](./P3-firefly-templates-spec.md) | 模板 schema、可视化 | 规格草案 |
| [P4 Headless CLI](./P4-headless-cli-spec.md) | 命令、退出码、CI | 规格草案 |
| [P5 无障碍基线](./P5-accessibility-baseline.md) | 检查项与门槛 | 规格草案 |
| [风险登记](./RISKS.md) | 持续更新 | 活文档 |
| [ADR 索引](./adr/README.md) | 架构决策 | 占位 |

## 分支约定

| 分支 | 用途 |
|------|------|
| `init/wave4-platform` | 立项与规格文档（本分支） |
| `feat/w4-plugin-*` | P1 实现 |
| `feat/w4-sync-*` | P2 实现 |
| `feat/w4-firefly-*` | P3 实现 |
| `feat/w4-cli-*` | P4 实现 |
| `feat/w4-a11y-*` | P5 实现 |

## 与 groknew 的关系

`groknew` 已交付 Wave1/Wave2。Wave4 **不**在 `groknew` 上继续堆功能，而从本立项分支拆分实现分支，避免范围失控。
