# Wave 4 Implementation Plan (feat/w4-impl)

**Goal:** 在 `feat/w4-impl` 交付 Wave4 五子项目 **MVP 可运行切片**。

| ID | MVP 交付 |
|----|----------|
| W4-P1 | 插件 SHA256SUMS 完整性校验 + scan 结果 integrity 字段 |
| W4-P2 | 口令加密配置导出/导入（独立模块 + IPC） |
| W4-P3 | Firefly 内置 ≥3 模板 list/get |
| W4-P4 | `scripts/agenthub-cli.mjs` 无头 run/version |
| W4-P5 | Composer/关键控件 aria-label 基线 |

流程：实现 → 测试 → 子代理审查 → 记录 → 全量回归
