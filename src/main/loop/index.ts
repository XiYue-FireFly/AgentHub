/**
 * Loop Module Index
 *
 * 导出所有循环相关的功能
 *
 * 架构：用户输入 → prompt优化器 → router → 各agent → 输出
 */

export { AgentLoop, createAgentLoop } from './agent-loop'
export type { LoopConfig, LoopContext, LoopResult, AgentStepResult, AgentConfig, ToolCallResult, LoopMode, ApiConfig } from './agent-loop'

export { resolveModelRoute, selectAgentsForParallel } from './model-router'
export type { ModelConfig, RouteDecision, RouteContext } from './model-router'
