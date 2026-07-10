# P3 Firefly 团队模板与可视化 — 规格草案

**代号：** `W4-FIREFLY`  
**状态：** 草案  
**依赖：** 现有 Firefly 状态机、schedule graph、RunTimeline  

## 1. 目标

降低多 Agent 编排的使用门槛：内置模板 + 运行态 DAG 可读。

## 2. 模板 schema（建议）

```json
{
  "id": "firefly-five-role",
  "name": "Firefly 五角色",
  "version": 1,
  "roles": ["planner", "implementer", "reviewer", "tester", "integrator"],
  "schedule": { "nodes": [], "edges": [] },
  "defaultMode": "orchestrate"
}
```

## 3. MVP

- [ ] 内置 ≥3 模板（五角色 / 双人 review / 单人 TDD）  
- [ ] 设置或 Composer 入口「应用模板」  
- [ ] RunTimeline / 面板只读展示节点状态  

## 4. 非目标

- 完整可视化 DAG 编辑器（二期）  
- 云端模板市场（可挂 P1）  

## 5. 验收

- 应用模板后可成功发起一次编排运行  
- UI 状态与 runtime 事件一致（无长期「假运行中」）  
