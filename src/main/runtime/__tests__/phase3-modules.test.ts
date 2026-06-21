import { describe, expect, it } from 'vitest'
import { resolveStepOrder, executeWorkflow } from '../workflow-runner'
import { estimateTokens, resolveContextWindow, buildContextComposition, suggestEvictions } from '../context-manager'
import { analyzePage, buildPageContext } from '../browser-agent'

describe('workflow-runner', () => {
  it('resolves simple linear chain', () => {
    const order = resolveStepOrder([
      { id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] }
    ])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('resolves diamond dependency', () => {
    const order = resolveStepOrder([
      { id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['a'] }, { id: 'd', dependsOn: ['b', 'c'] }
    ])
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'))
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'))
  })

  it('throws on cycle', () => {
    expect(() => resolveStepOrder([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toThrow()
  })

  it('executes workflow successfully', async () => {
    const result = await executeWorkflow('test', [
      { id: 's1', type: 'prompt', label: 'A' },
      { id: 's2', type: 'prompt', label: 'B', dependsOn: ['s1'] }
    ], async () => ({ output: 'ok' }))
    expect(result.status).toBe('succeeded')
    expect(result.steps).toHaveLength(2)
  })

  it('stops on step failure', async () => {
    let callCount = 0
    const result = await executeWorkflow('test', [
      { id: 's1', type: 'prompt', label: 'A' },
      { id: 's2', type: 'prompt', label: 'B', dependsOn: ['s1'] },
      { id: 's3', type: 'prompt', label: 'C', dependsOn: ['s2'] }
    ], async (step) => {
      callCount++
      if (step.id === 's2') return { output: '', error: 'fail' }
      return { output: 'ok' }
    })
    expect(result.status).toBe('failed')
    expect(callCount).toBe(2) // s3 was skipped
  })
})

describe('context-manager', () => {
  it('estimates CJK tokens at ~1.5 per char', () => {
    expect(estimateTokens('你好世界')).toBe(6) // 4 chars * 1.5 = 6
  })

  it('estimates ASCII tokens at ~4 chars per token', () => {
    expect(estimateTokens('hello')).toBe(2) // 5 / 4 = 1.25 → ceil = 2
  })

  it('resolves known model context windows', () => {
    expect(resolveContextWindow('gpt-4o', [])).toBe(128_000)
    expect(resolveContextWindow('claude-sonnet-4', [])).toBe(200_000)
    expect(resolveContextWindow('gemini-2.5-pro', [])).toBe(1_048_576)
    expect(resolveContextWindow('unknown-model', [])).toBe(128_000) // default
  })

  it('uses provider-reported context window over defaults', () => {
    const providers = [{ id: 'test', models: [{ id: 'gpt-4o', contextWindow: 256_000 }] }]
    expect(resolveContextWindow('gpt-4o', providers)).toBe(256_000)
  })

  it('reports danger tone when over 90%', () => {
    const sources = [
      { kind: 'system' as const, label: 'System', tokens: 100_000, pinned: true, removable: false, priority: 0 },
      { kind: 'messages' as const, label: 'Messages', tokens: 50_000, pinned: false, removable: true, priority: 1 }
    ]
    const comp = buildContextComposition(sources, 128_000)
    expect(comp.tone).toBe('danger')
    expect(comp.usedRatio).toBeGreaterThan(0.9)
  })

  it('suggests evictions when over budget', () => {
    const sources = [
      { kind: 'system' as const, label: 'System', tokens: 50_000, pinned: true, removable: false, priority: 0 },
      { kind: 'memory' as const, label: 'Memory', tokens: 60_000, pinned: false, removable: true, priority: 2 },
      { kind: 'browser' as const, label: 'Browser', tokens: 40_000, pinned: false, removable: true, priority: 3 }
    ]
    const evict = suggestEvictions(sources, 128_000)
    expect(evict.length).toBeGreaterThan(0)
    // Should evict highest priority (lowest number) first — wait, should evict lowest priority first
    // memory has priority 2, browser has priority 3 — evict browser first (lower priority)
    expect(evict[0].kind).toBe('browser')
  })
})

describe('browser-agent', () => {
  const snapshot = {
    url: 'https://docs.example.com/api',
    title: 'API Reference - Example',
    text: 'This is the API reference documentation for Example service. It covers authentication, endpoints, and rate limits.',
    headings: ['Authentication', 'Endpoints', 'Rate Limits', 'Examples'],
    links: [{ text: 'Home', href: '/' }, { text: 'Guide', href: '/guide' }],
    forms: [],
    capturedAt: Date.now()
  }

  it('detects documentation pages', () => {
    const analysis = analyzePage(snapshot)
    expect(analysis.isDocumentation).toBe(true)
    expect(analysis.isCodeRepo).toBe(false)
  })

  it('extracts key topics from headings', () => {
    const analysis = analyzePage(snapshot)
    expect(analysis.keyTopics).toContain('Authentication')
    expect(analysis.keyTopics).toContain('Endpoints')
  })

  it('counts words and links', () => {
    const analysis = analyzePage(snapshot)
    expect(analysis.wordCount).toBeGreaterThan(0)
    expect(analysis.linkCount).toBe(2)
  })

  it('detects code repos', () => {
    const ghSnapshot = { ...snapshot, url: 'https://github.com/user/repo', title: 'GitHub repo' }
    const analysis = analyzePage(ghSnapshot)
    expect(analysis.isCodeRepo).toBe(true)
  })

  it('builds structured context text', () => {
    const analysis = analyzePage(snapshot)
    const ctx = buildPageContext(analysis)
    expect(ctx).toContain('[Web Page]')
    expect(ctx).toContain('API Reference')
    expect(ctx).toContain('docs')
    expect(ctx).toContain('Authentication')
  })

  it('detects interactive content', () => {
    const interactive = { ...snapshot, forms: ['login', 'search'] }
    const analysis = analyzePage(interactive)
    expect(analysis.hasInteractiveContent).toBe(true)
  })
})
