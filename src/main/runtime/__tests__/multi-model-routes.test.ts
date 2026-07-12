import { describe, expect, it } from 'vitest'
import { resolveDistinctFusionRoutes, selectFusionTopology } from '../multi-model-routes'

function source() {
  const bindings = [
    { agentId: 'codex-a', providerId: 'p1', modelId: 'alias-a', protocol: 'http' },
    { agentId: 'codex-b', providerId: 'p1', modelId: 'alias-b', protocol: 'http' },
    { agentId: 'claude', providerId: 'p2', modelId: 'claude-4', protocol: 'http' },
    { agentId: 'gemini', providerId: 'p3', modelId: 'gemini-3', protocol: 'acp' },
    { agentId: 'plain', providerId: 'local-cli', modelId: 'plain', protocol: 'stdio-plain' },
    { agentId: 'fourth', providerId: 'p4', modelId: 'four', protocol: 'http' }
  ] as const

  return {
    getBindings: () => bindings,
    resolveBinding: (agentId: string) => {
      if (agentId === 'plain') return null
      if (agentId.startsWith('codex')) {
        return { provider: { id: 'p1' }, model: { id: 'alias', upstreamModel: 'gpt-5' } }
      }
      if (agentId === 'claude') return { provider: { id: 'p2' }, model: { id: 'claude-4' } }
      if (agentId === 'gemini') return { provider: { id: 'p3' }, model: { id: 'gemini-3' } }
      return { provider: { id: 'p4' }, model: { id: 'four' } }
    }
  }
}

describe('multi-model fusion routes', () => {
  it('deduplicates upstream models while preserving the Dispatcher model id for branch envelopes', () => {
    const routes = resolveDistinctFusionRoutes(source())

    expect(routes.map(route => route.agentId)).toEqual(['codex-a', 'claude', 'gemini', 'fourth'])
    expect(routes.map(route => route.key)).toEqual([
      'p1\u0000gpt-5',
      'p2\u0000claude-4',
      'p3\u0000gemini-3',
      'p4\u0000four'
    ])
    expect(routes.map(route => route.modelId)).toEqual([
      'alias',
      'claude-4',
      'gemini-3',
      'four'
    ])
    expect(routes.map(route => route.protocol)).toEqual(['http', 'http', 'acp', 'http'])
  })

  it('excludes every stdio and local-cli route from read-only fusion topology candidates', () => {
    const bindings = [
      { agentId: 'http', providerId: 'remote', modelId: 'remote-model', protocol: 'http' },
      { agentId: 'structured-cli', providerId: 'local-cli', modelId: 'structured', protocol: 'stdio-ndjson' },
      { agentId: 'implicit-cli', providerId: 'local-cli', modelId: 'implicit' },
      { agentId: 'spaced-cli', providerId: ' LOCAL-CLI ', modelId: 'spaced-local', protocol: 'http' },
      { agentId: 'spaced-stdio', providerId: 'remote-two', modelId: 'spaced-stdio', protocol: ' stdio-ndjson ' }
    ] as const
    const routes = resolveDistinctFusionRoutes({
      getBindings: () => bindings,
      resolveBinding: agentId => {
        const binding = bindings.find(candidate => candidate.agentId === agentId)
        return binding
          ? { provider: { id: binding.providerId }, model: { id: binding.modelId } }
          : null
      }
    })

    expect(routes.map(route => route.agentId)).toEqual(['http'])
  })

  it('preserves source order and applies the route cap after resolved de-duplication', () => {
    const routes = resolveDistinctFusionRoutes(source(), 2)

    expect(routes.map(route => route.agentId)).toEqual(['codex-a', 'claude'])
  })

  it('fails closed by normalizing caps to non-negative finite integers', () => {
    expect(resolveDistinctFusionRoutes(source(), 0)).toEqual([])
    expect(resolveDistinctFusionRoutes(source(), -1)).toEqual([])
    expect(resolveDistinctFusionRoutes(source(), 2.7).map(route => route.agentId))
      .toEqual(['codex-a', 'claude'])
    expect(resolveDistinctFusionRoutes(source(), Number.POSITIVE_INFINITY)).toEqual([])
  })

  it('assigns deterministic candidate, synthesizer, and judge roles', () => {
    const routes = [
      { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
      { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' },
      { key: 'p3\u0000m3', agentId: 'c', providerId: 'p3', modelId: 'm3', protocol: 'http' },
      { key: 'p4\u0000m4', agentId: 'd', providerId: 'p4', modelId: 'm4', protocol: 'http' },
      { key: 'p5\u0000m5', agentId: 'e', providerId: 'p5', modelId: 'm5', protocol: 'http' }
    ] as const

    const topology = selectFusionTopology(routes, 3)

    expect(topology.candidates.map(route => route.agentId)).toEqual(['a', 'b', 'c'])
    expect(topology.synthesizer.agentId).toBe('d')
    expect(topology.judge.agentId).toBe('e')
    expect(selectFusionTopology(routes.slice(0, 2), 1)).toMatchObject({
      candidates: [{ agentId: 'a' }, { agentId: 'b' }],
      synthesizer: { agentId: 'a' },
      judge: { agentId: 'b' }
    })
  })

  it('normalizes fractional and non-finite candidate limits before assigning roles', () => {
    const routes = [
      { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
      { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' },
      { key: 'p3\u0000m3', agentId: 'c', providerId: 'p3', modelId: 'm3', protocol: 'http' },
      { key: 'p4\u0000m4', agentId: 'd', providerId: 'p4', modelId: 'm4', protocol: 'http' },
      { key: 'p5\u0000m5', agentId: 'e', providerId: 'p5', modelId: 'm5', protocol: 'http' }
    ] as const

    expect(selectFusionTopology(routes, 2.7)).toMatchObject({
      candidates: [{ agentId: 'a' }, { agentId: 'b' }],
      synthesizer: { agentId: 'c' },
      judge: { agentId: 'd' }
    })
    expect(selectFusionTopology(routes, Number.NaN)).toMatchObject({
      candidates: [{ agentId: 'a' }, { agentId: 'b' }, { agentId: 'c' }],
      synthesizer: { agentId: 'd' },
      judge: { agentId: 'e' }
    })
  })

  it('uses a stable topology of distinct route keys', () => {
    const repeated = [
      { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
      { key: 'p1\u0000m1', agentId: 'a-alias', providerId: 'p1', modelId: 'm1', protocol: 'http' }
    ] as const
    expect(() => selectFusionTopology(repeated)).toThrow(
      'MULTI_MODEL_UNAVAILABLE: at least two distinct resolved models are required'
    )

    const mixed = [
      { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
      { key: 'p1\u0000m1', agentId: 'a-alias', providerId: 'p1', modelId: 'm1', protocol: 'http' },
      { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' },
      { key: 'p3\u0000m3', agentId: 'c', providerId: 'p3', modelId: 'm3', protocol: 'http' },
      { key: 'p4\u0000m4', agentId: 'd', providerId: 'p4', modelId: 'm4', protocol: 'http' }
    ] as const
    expect(selectFusionTopology(mixed, 2)).toMatchObject({
      candidates: [{ agentId: 'a' }, { agentId: 'b' }],
      synthesizer: { agentId: 'c' },
      judge: { agentId: 'd' }
    })
  })

  it('requires at least two distinct resolved routes', () => {
    expect(() => selectFusionTopology([
      { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' }
    ])).toThrow('MULTI_MODEL_UNAVAILABLE: at least two distinct resolved models are required')
  })
})
