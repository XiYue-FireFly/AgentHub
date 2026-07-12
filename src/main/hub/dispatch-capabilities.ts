export type DispatchTransportProtocol = 'http' | 'acp' | 'stdio-plain' | string | undefined

export type DispatchCapabilityMode = 'normal' | 'read-only'

export function assertCapabilityTransport(
  protocol: DispatchTransportProtocol,
  mode: DispatchCapabilityMode = 'normal',
  providerId?: string
): void {
  const normalizedProtocol = typeof protocol === 'string' ? protocol.trim().toLowerCase() : ''
  const isLocalProvider = providerId?.trim().toLowerCase() === 'local-cli'
  if (mode === 'read-only' && (normalizedProtocol.startsWith('stdio') || isLocalProvider)) {
    const transport = normalizedProtocol || providerId || 'local transport'
    const error = new Error(
      `READ_ONLY_TRANSPORT_UNSUPPORTED: ${transport} cannot enforce read-only execution`
    ) as Error & { code: string }
    error.code = 'READ_ONLY_TRANSPORT_UNSUPPORTED'
    throw error
  }
}

export function shouldRequestAcpPermission(mode: DispatchCapabilityMode = 'normal'): boolean {
  return mode !== 'read-only'
}
