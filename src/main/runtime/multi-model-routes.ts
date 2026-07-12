export interface FusionBinding {
  agentId: string
  providerId: string
  modelId: string
  protocol?: string
}

export interface FusionRouteSource {
  getBindings(): readonly FusionBinding[]
  resolveBinding(agentId: string): {
    provider: { id: string }
    model: { id: string; upstreamModel?: string }
  } | null
}

export interface ResolvedFusionRoute {
  key: string
  agentId: string
  providerId: string
  modelId: string
  protocol: 'http' | 'acp'
}

export interface FusionTopology {
  candidates: ResolvedFusionRoute[]
  synthesizer: ResolvedFusionRoute
  judge: ResolvedFusionRoute
}

export function resolveDistinctFusionRoutes(
  source: FusionRouteSource,
  maxRoutes = 8
): ResolvedFusionRoute[] {
  const routes: ResolvedFusionRoute[] = []
  const seen = new Set<string>()
  const routeCap = Number.isFinite(maxRoutes) ? Math.max(0, Math.floor(maxRoutes)) : 0

  if (routeCap === 0) return routes

  for (const binding of source.getBindings()) {
    const configuredProviderId = binding.providerId.trim().toLowerCase()
    const protocol = binding.protocol?.trim().toLowerCase()
    if (configuredProviderId === 'local-cli' || protocol?.startsWith('stdio')) continue
    const resolved = source.resolveBinding(binding.agentId)
    if (!resolved) continue

    const providerId = resolved.provider.id
    const modelId = resolved.model.id
    const upstreamModelId = resolved.model.upstreamModel?.trim() || modelId
    const key = providerId + '\u0000' + upstreamModelId
    if (seen.has(key)) continue

    seen.add(key)
    routes.push({
      key,
      agentId: binding.agentId,
      providerId,
      modelId,
      protocol: binding.protocol === 'acp' ? 'acp' : 'http'
    })
    if (routes.length >= routeCap) break
  }

  return routes
}

export function selectFusionTopology(
  routes: readonly ResolvedFusionRoute[],
  candidateLimit = 3
): FusionTopology {
  const distinctRoutes: ResolvedFusionRoute[] = []
  const seen = new Set<string>()
  for (const route of routes) {
    if (seen.has(route.key)) continue
    seen.add(route.key)
    distinctRoutes.push(route)
  }
  const normalizedCandidateLimit = Number.isFinite(candidateLimit)
    ? Math.floor(candidateLimit)
    : 3
  const candidateCount = Math.min(Math.max(normalizedCandidateLimit, 2), 3, distinctRoutes.length)
  if (candidateCount < 2) {
    throw new Error('MULTI_MODEL_UNAVAILABLE: at least two distinct resolved models are required')
  }

  const candidates = distinctRoutes.slice(0, candidateCount)
  const synthesizer = distinctRoutes[candidateCount] || candidates[0]
  const judge = distinctRoutes.find(route =>
    route.key !== synthesizer.key && !candidates.some(candidate => candidate.key === route.key)
  ) || candidates.find(route => route.key !== synthesizer.key) || candidates[0]

  return { candidates, synthesizer, judge }
}
