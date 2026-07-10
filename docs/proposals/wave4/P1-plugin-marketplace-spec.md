# P1 插件市场与安全沙箱 — 规格草案

**代号：** `W4-PLUGIN`  
**状态：** 草案（立项阶段）  
**依赖：** 现有 `plugin-manager` manifest 模型  

## 1. 目标

提供可发现、可校验、默认可信边界清晰的插件安装体验，**默认禁止任意 JS 执行**。

## 2. 用户故事

1. 作为开发者，我希望从官方/白名单源浏览插件并一键安装。  
2. 作为安全敏感用户，我希望未通过校验的插件无法启用。  
3. 作为作者，我希望有稳定的 manifest 贡献点文档。  

## 3. 包格式 v1（建议）

```text
my-plugin-1.0.0/
  plugin.json          # name, version, contributes, publisher, minAgentHub
  SHA256SUMS
  SIGNATURE            # 可选二期
  skills/ ...
  prompts/ ...
```

`plugin.json` 必填：`name`, `version`, `contributes`。  
安装时计算目录内容哈希并与 `SHA256SUMS` 比对。

## 4. 威胁模型（摘要）

| 威胁 | 对策 |
|------|------|
| 恶意 manifest 路径逃逸 | 已有 `isPathInsideBase`；继续强制 |
| 篡改插件内容 | 哈希校验失败拒绝启用 |
| 供应链钓鱼 | 仅允许配置的 registry URL；HTTPS |
| 任意代码执行 | 不加载插件 JS；仅数据贡献 |

## 5. MVP 范围

- [ ] 本地安装 zip/目录 + 哈希校验  
- [ ] 设置页「插件」：状态、错误原因、禁用  
- [ ] 文档：贡献点列表（与现有 contributes 对齐）  

## 6. 非目标（MVP）

- 完整应用商店评分/支付  
- 插件内任意 Node 模块执行  
- 自动更新（可二期）  

## 7. 验收

- 篡改任一文件 → 无法启用且错误可读  
- 合法插件安装后 slash/skill 贡献可见  
- 主工作台在插件损坏时仍可启动  
