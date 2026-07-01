import { describe, it, expect, beforeEach } from 'vitest'
import { createAgentLoop } from '../agent-loop'
import type { LoopContext, AgentConfig } from '../agent-loop'
import type { ModelConfig } from '../model-router'

describe('AgentLoop', () => {
  const mockModels: ModelConfig[] = [
    { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
    { providerId: 'anthropic', modelId: 'claude-3-opus', label: 'Claude 3 Opus' }
  ]

  const mockAgents: AgentConfig[] = [
    {
      id: 'orchestrator',
      name: 'Orchestrator',
      role: 'orchestrator',
      model: mockModels[0],
      tools: ['read', 'write', 'exec', 'search'],
      capabilities: ['planning', 'delegation', 'coordination']
    },
    {
      id: 'explorer',
      name: 'Explorer',
      role: 'explorer',
      model: mockModels[1],
      tools: ['read', 'search', 'grep'],
      capabilities: ['code-search', 'analysis']
    }
  ]

  const mockTools = [
    { name: 'read', description: 'Read a file' },
    { name: 'write', description: 'Write a file' },
    { name: 'search', description: 'Search code' }
  ]

  describe('createAgentLoop', () => {
    it('should create an instance with default config', () => {
      const loop = createAgentLoop()
      expect(loop).toBeDefined()
    })

    it('should create an instance with custom config', () => {
      const loop = createAgentLoop({
        maxSteps: 5,
        enableDelegation: false
      })
      expect(loop).toBeDefined()
    })
  })

  describe('run', () => {
    it('should complete a simple task', async () => {
      const loop = createAgentLoop({ maxSteps: 3 })
      const abortController = new AbortController()

      const context: LoopContext = {
        threadId: 'test-thread',
        turnId: 'test-turn',
        prompt: 'Hello, world!',
        availableAgents: mockAgents,
        availableModels: mockModels,
        tools: mockTools,
        signal: abortController.signal
      }

      const result = await loop.run(context)
      expect(result.status).toBe('completed')
      expect(result.output).toBeDefined()
      expect(result.steps).toBeGreaterThan(0)
    })

    it('should handle abort', async () => {
      const loop = createAgentLoop({ maxSteps: 10 })
      const abortController = new AbortController()

      // 立即中止
      abortController.abort()

      const context: LoopContext = {
        threadId: 'test-thread',
        turnId: 'test-turn',
        prompt: 'Hello',
        availableAgents: mockAgents,
        availableModels: mockModels,
        tools: mockTools,
        signal: abortController.signal
      }

      const result = await loop.run(context)
      expect(result.status).toBe('aborted')
    })

    it('should emit events', async () => {
      const loop = createAgentLoop({ maxSteps: 2 })
      const abortController = new AbortController()
      const events: string[] = []

      loop.on('turn:start', () => events.push('turn:start'))
      loop.on('step:routing', () => events.push('step:routing'))
      loop.on('agent:selected', () => events.push('agent:selected'))
      loop.on('agent:step:start', () => events.push('agent:step:start'))
      loop.on('turn:complete', () => events.push('turn:complete'))

      const context: LoopContext = {
        threadId: 'test-thread',
        turnId: 'test-turn',
        prompt: 'Hello',
        availableAgents: mockAgents,
        availableModels: mockModels,
        tools: mockTools,
        signal: abortController.signal
      }

      await loop.run(context)
      expect(events).toContain('turn:start')
      expect(events).toContain('step:routing')
      expect(events).toContain('agent:selected')
      expect(events).toContain('turn:complete')
    })

    it('should select appropriate agent based on task', async () => {
      const loop = createAgentLoop({ maxSteps: 2 })
      const abortController = new AbortController()
      let selectedAgentId = ''

      loop.on('agent:selected', (data) => {
        selectedAgentId = data.agentId
      })

      const context: LoopContext = {
        threadId: 'test-thread',
        turnId: 'test-turn',
        prompt: 'Find all TypeScript files in the project',
        availableAgents: mockAgents,
        availableModels: mockModels,
        tools: mockTools,
        signal: abortController.signal
      }

      await loop.run(context)
      // 应该选择一个 agent（可以是 explorer 或 orchestrator）
      expect(selectedAgentId).toBeTruthy()
      expect(mockAgents.some(a => a.id === selectedAgentId)).toBe(true)
    })
  })
})
