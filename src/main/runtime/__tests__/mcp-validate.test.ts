import { describe, expect, it } from 'vitest'
import { validateInitializeResult } from '../mcp'

describe('validateInitializeResult', () => {
  const validResult = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'test-mcp', version: '1.0.0' }
    }
  })

  it('accepts valid JSON-RPC initialize result', () => {
    const r = validateInitializeResult(validResult)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.protocolVersion).toBe('2024-11-05')
      expect(r.result.serverInfo.name).toBe('test-mcp')
    }
  })

  it('accepts result with surrounding text/logs', () => {
    const noisy = `server starting on port 3000\n${validResult}\nready`
    const r = validateInitializeResult(noisy)
    expect(r.ok).toBe(true)
  })

  it('rejects JSON-RPC error response', () => {
    const err = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid request' }
    })
    const r = validateInitializeResult(err)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('JSON-RPC error')
  })

  it('rejects mismatched id', () => {
    const wrongId = JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'x', version: '0' } }
    })
    const r = validateInitializeResult(wrongId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('id=1')
  })

  it('rejects missing jsonrpc field', () => {
    const noRpc = JSON.stringify({ id: 1, result: { protocolVersion: '2024-11-05' } })
    const r = validateInitializeResult(noRpc)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('jsonrpc')
  })

  it('rejects response with result=null', () => {
    const nullResult = JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })
    const r = validateInitializeResult(nullResult)
    expect(r.ok).toBe(false)
  })

  it('rejects non-JSON stdout', () => {
    const r = validateInitializeResult('this is not json at all')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('No JSON object')
  })

  it('rejects empty stdout', () => {
    const r = validateInitializeResult('')
    expect(r.ok).toBe(false)
  })

  it('does not false-positive on stderr-like text', () => {
    // Old code would succeed on "mcp server listening" in stderr
    // The pure parser should only succeed on actual JSON-RPC result
    const r = validateInitializeResult('mcp json-rpc server listening on stdio')
    expect(r.ok).toBe(false)
  })

  it('rejects response with result but no result object', () => {
    const partial = JSON.stringify({ jsonrpc: '2.0', id: 1 })
    const r = validateInitializeResult(partial)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Missing result')
  })
})
