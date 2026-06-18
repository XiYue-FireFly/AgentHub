import type { DispatchPreset, SchedulePreview } from "./types"

export const LOCAL_CORE_AGENTS = ["codex", "claude", "minimax-code"] as const

export function listSchedules(): SchedulePreview[] {
  return [
    {
      preset: "auto",
      label: "自动路由",
      description: "让 AgentHub 为本轮选择最合适的可用 Agent。",
      steps: [
        { id: "auto", label: "按任务路由", agentId: "auto", role: "target", mode: "auto" }
      ]
    },
    {
      preset: "broadcast",
      label: "广播",
      description: "并行询问每个已配置的 Agent。",
      steps: [
        { id: "broadcast", label: "并行派发", agentId: "all", role: "worker", mode: "broadcast" }
      ]
    },
    {
      preset: "chain",
      label: "链式交接",
      description: "把上游输出交给下一个本地编码 Agent。",
      steps: [
        { id: "codex", label: "第一轮处理", agentId: "codex", role: "worker", mode: "auto" },
        { id: "claude", label: "第二轮审阅", agentId: "claude", role: "reviewer", mode: "auto", dependsOn: ["codex"] }
      ]
    },
    {
      preset: "orchestrate",
      label: "编排",
      description: "使用 AgentHub 的规划、校验和汇总链路。",
      steps: [
        { id: "orchestrate", label: "规划、执行、校验、汇总", agentId: "lead", role: "lead", mode: "orchestrate" }
      ]
    },
    {
      preset: "lead-workers",
      label: "主控 + 工作者",
      description: "Claude/Codex 规划，Codex/OpenCode 执行，Claude 汇总。",
      steps: [
        { id: "lead", label: "规划任务", agentId: "claude", role: "lead", mode: "auto" },
        { id: "codex-worker", label: "实现 / 检查", agentId: "codex", role: "worker", mode: "auto", dependsOn: ["lead"] },
        { id: "opencode-worker", label: "第二本地视角", agentId: "minimax-code", role: "worker", mode: "auto", dependsOn: ["lead"] },
        { id: "synth", label: "汇总结果", agentId: "claude", role: "synthesizer", mode: "auto", dependsOn: ["codex-worker", "opencode-worker"] }
      ]
    },
    {
      preset: "parallel-review",
      label: "并行评审",
      description: "Codex、Claude、OpenCode 并行回答，再比较差异。",
      steps: [
        { id: "codex-review", label: "Codex 评审", agentId: "codex", role: "reviewer", mode: "auto" },
        { id: "claude-review", label: "Claude 评审", agentId: "claude", role: "reviewer", mode: "auto" },
        { id: "opencode-review", label: "OpenCode 评审", agentId: "minimax-code", role: "reviewer", mode: "auto" },
        { id: "review-synth", label: "比较差异", agentId: "claude", role: "synthesizer", mode: "auto", dependsOn: ["codex-review", "claude-review", "opencode-review"] }
      ]
    },
    {
      preset: "custom",
      label: "自定义调度",
      description: "按右侧工作台中编辑的 Agent 节点和依赖关系执行。",
      steps: [
        { id: "custom-1", label: "自定义步骤", agentId: "codex", role: "worker", mode: "auto" }
      ]
    }
  ]
}

export function previewSchedule(preset: DispatchPreset): SchedulePreview {
  return listSchedules().find(s => s.preset === preset) ?? listSchedules()[0]
}

export function toDispatcherMode(preset: DispatchPreset): "auto" | "broadcast" | "chain" | "orchestrate" {
  if (preset === "parallel-review") return "broadcast"
  if (preset === "lead-workers") return "orchestrate"
  if (preset === "custom") return "chain"
  return preset
}
