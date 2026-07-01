import { describe, it, expect } from 'vitest'
import { resolveModelRoute, selectAgentsForParallel } from '../model-router'
import type { AgentConfig, RouteContext } from '../model-router'

describe('AgentRouter', () => {
  const mockAgents: AgentConfig[] = [
    {
      id: 'orchestrator',
      name: 'Orchestrator',
      role: 'orchestrator',
      model: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
      tools: ['read', 'write', 'exec', 'search'],
      capabilities: ['planning', 'delegation']
    },
    {
      id: 'explorer',
      name: 'Explorer',
      role: 'explorer',
      model: { providerId: 'anthropic', modelId: 'claude-3-opus', label: 'Claude 3 Opus' },
      tools: ['read', 'search', 'grep'],
      capabilities: ['code-search', 'analysis']
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      role: 'reviewer',
      model: { providerId: 'openai', modelId: 'gpt-4', label: 'GPT-4' },
      tools: ['read', 'search'],
      capabilities: ['code-review', 'quality-check']
    },
    {
      id: 'implementer',
      name: 'Implementer',
      role: 'implementer',
      model: { providerId: 'anthropic', modelId: 'claude-3-opus', label: 'Claude 3 Opus' },
      tools: ['read', 'write', 'exec'],
      capabilities: ['coding', 'implementation']
    }
  ]

  describe('resolveModelRoute', () => {
    it('should return null if no agents available', async () => {
      const context: RouteContext = {
        prompt: 'Hello',
        availableAgents: [],
        availableModels: []
      }

      const route = await resolveModelRoute(context)
      expect(route.selectedAgent).toBeNull()
    })

    it('should return single agent if only one available', async () => {
      const context: RouteContext = {
        prompt: 'Hello',
        availableAgents: [mockAgents[0]],
        availableModels: [mockAgents[0].model]
      }

      const route = await resolveModelRoute(context)
      expect(route.selectedAgent).toEqual(mockAgents[0])
      expect(route.confidence).toBe(1.0)
    })

    it('should select explorer for search tasks', async () => {
      const context: RouteContext = {
        prompt: 'Find all TypeScript files in the project',
        availableAgents: mockAgents,
        availableModels: mockAgents.map(a => a.model)
      }

      const route = await resolveModelRoute(context)
      expect(route.selectedAgent?.id).toBe('explorer')
    })

    it('should select reviewer for review tasks', async () => {
      const context: RouteContext = {
        prompt: 'Review this code for security issues',
        availableAgents: mockAgents,
        availableModels: mockAgents.map(a => a.model)
      }

      const route = await resolveModelRoute(context)
      expect(route.selectedAgent?.id).toBe('reviewer')
    })

    it('should select implementer for implementation tasks', async () => {
      const context: RouteContext = {
        prompt: 'Implement a new authentication system',
        availableAgents: mockAgents,
        availableModels: mockAgents.map(a => a.model)
      }

      const route = await resolveModelRoute(context)
      expect(route.selectedAgent?.id).toBe('implementer')
    })

    it('should return alternative agents', async () => {
      const context: RouteContext = {
        prompt: 'Find all TypeScript files',
        availableAgents: mockAgents,
        availableModels: mockAgents.map(a => a.model)
      }

      const route = await resolveModelRoute(context)
      expect(route.alternativeAgents).toBeDefined()
      expect(route.alternativeAgents?.length).toBeLessThanOrEqual(2)
    })
  })

  describe('selectAgentsForParallel', () => {
    it('should return all agents if less than max', () => {
      const context: RouteContext = {
        prompt: 'Hello',
        availableAgents: mockAgents.slice(0, 2),
        availableModels: []
      }

      const agents = selectAgentsForParallel(context, 3)
      expect(agents.length).toBe(2)
    })

    it('should limit to maxAgents', () => {
      const context: RouteContext = {
        prompt: 'Hello',
        availableAgents: mockAgents,
        availableModels: []
      }

      const agents = selectAgentsForParallel(context, 2)
      expect(agents.length).toBe(2)
    })

    it('should select diverse agents', () => {
      const context: RouteContext = {
        prompt: 'Hello',
        availableAgents: mockAgents,
        availableModels: []
      }

      const agents = selectAgentsForParallel(context, 3)
      expect(agents.length).toBe(3)
    })
  })
})
