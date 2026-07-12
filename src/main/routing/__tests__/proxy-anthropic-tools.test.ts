import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ streamOptions: [] as any[], auditEvents: [] as any[] }))

vi.mock('../../providers/client', () => ({
  buildProviderClient: () => ({
    stream: async (options: any, callbacks: any) => {
      h.streamOptions.push(options)
      callbacks.onDone?.({ content: 'ok' })
    }
  })
}))

vi.mock('../../runtime/app-event-log', () => ({
  appendAppEventLog: (...args: any[]) => h.auditEvents.push(args)
}))
import {
  anthropicToolsToOpenai, anthropicToolChoiceToOpenai, anthropicToolResultContent,
  anthropicMessagesToOpenai, AnthropicWire
} from '../proxy'

/**
 * proxy Anthropic 入站工具透传单测（K3）：
 *   - 入站编解码：tools / tool_choice / messages（tool_use↔tool_calls, tool_result↔tool role）
 *   - 出站回写：AnthropicWire 把 OpenAI 工具流增量 / onDone.toolCalls 编为 tool_use SSE 块；非流式 json 含 tool_use
 * 纯协议层断言；端到端正确性需联机 Claude Code + 支持工具的上游验证。
 */

/* 收集 SSE/JSON 写入的假 ServerResponse */
function fakeRes() {
  const chunks: string[] = []
  const res: any = {
    writeHead() {}, setHeader() {}, on() {}, off() {}, headersSent: false,
    write(s: string) { chunks.push(s); return true },
    end(s?: string) { if (s) chunks.push(s) }
  }
  return { res, chunks }
}

/** 解析 chunks 里所有 `data: {...}` SSE 事件为对象数组 */
function parseEvents(chunks: string[]): any[] {
  const out: any[] = []
  for (const block of chunks.join('').split('\n\n')) {
    const line = block.split('\n').find(l => l.startsWith('data: '))
    if (line) { try { out.push(JSON.parse(line.slice(6))) } catch { /* skip */ } }
  }
  return out
}

describe('anthropic 入站编解码', () => {
  it('anthropicToolsToOpenai：转 function tools；空/无效 → undefined', () => {
    const out = anthropicToolsToOpenai([{ name: 'get_weather', description: 'w', input_schema: { type: 'object', properties: { loc: { type: 'string' } } } }])
    expect(out).toEqual([{ type: 'function', function: { name: 'get_weather', description: 'w', parameters: { type: 'object', properties: { loc: { type: 'string' } } } } }])
    expect(anthropicToolsToOpenai(undefined)).toBeUndefined()
    expect(anthropicToolsToOpenai([])).toBeUndefined()
    expect(anthropicToolsToOpenai([{ description: 'no name' }])).toBeUndefined()
  })

  it('anthropicToolChoiceToOpenai：auto/any/tool', () => {
    expect(anthropicToolChoiceToOpenai({ type: 'auto' })).toBe('auto')
    expect(anthropicToolChoiceToOpenai({ type: 'any' })).toBe('required')
    expect(anthropicToolChoiceToOpenai({ type: 'tool', name: 'f' })).toEqual({ type: 'function', function: { name: 'f' } })
    expect(anthropicToolChoiceToOpenai(undefined)).toBeUndefined()
  })

  it('anthropicToolResultContent：string / 块数组 / 其它', () => {
    expect(anthropicToolResultContent('hi')).toBe('hi')
    expect(anthropicToolResultContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb')
    expect(anthropicToolResultContent(null)).toBe('')
  })

  it('anthropicMessagesToOpenai：tool_use→tool_calls，tool_result→tool role，文本保留', () => {
    const out = anthropicMessagesToOpenai([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'let me check' }, { type: 'tool_use', id: 'tu1', name: 'get', input: { x: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '42' }, { type: 'text', text: 'thanks' }] }
    ])
    expect(out[0]).toEqual({ role: 'user', content: 'hi' })
    expect(out[1].role).toBe('assistant')
    expect(out[1].content).toBe('let me check')
    expect(out[1].tool_calls?.[0]).toMatchObject({ id: 'tu1', type: 'function', function: { name: 'get' } })
    expect(JSON.parse(out[1].tool_calls![0].function.arguments)).toEqual({ x: 1 })
    const toolMsg = out.find(m => m.role === 'tool')
    expect(toolMsg).toMatchObject({ tool_call_id: 'tu1', content: '42' })
    expect(out.filter(m => m.role === 'user').pop()?.content).toBe('thanks')
  })
})

describe('AnthropicWire 工具块回写', () => {
  it('流式：OpenAI 工具增量 → tool_use content block + input_json_delta', () => {
    const { res, chunks } = fakeRes()
    const w = new AnthropicWire(res, 'claude-x')
    w.begin()
    w.toolCallDelta([{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }])
    w.toolCallDelta([{ index: 0, function: { arguments: '{"loc' } }])
    w.toolCallDelta([{ index: 0, function: { arguments: '":"SF"}' } }])
    w.done({ output_tokens: 5 }, 'tool_calls')
    const evs = parseEvents(chunks)
    const start = evs.find(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use')
    expect(start?.content_block).toMatchObject({ id: 'call_1', name: 'get_weather' })
    const args = evs.filter(e => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta').map(e => e.delta.partial_json).join('')
    expect(args).toBe('{"loc":"SF"}')
    expect(evs.find(e => e.type === 'message_delta')?.delta?.stop_reason).toBe('tool_use')
  })

  it('done 兜底：上游无流式增量时，onDone.toolCalls 补发完整 tool_use 块', () => {
    const { res, chunks } = fakeRes()
    const w = new AnthropicWire(res, 'm')
    w.begin()
    w.done({ output_tokens: 1 }, 'tool_calls', [{ id: 't1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }])
    const evs = parseEvents(chunks)
    const start = evs.find(e => e.content_block?.type === 'tool_use')
    expect(start?.content_block?.name).toBe('search')
    const args = evs.filter(e => e.delta?.type === 'input_json_delta').map(e => e.delta.partial_json).join('')
    expect(args).toBe('{"q":"x"}')
  })

  it('非流式 json：toolCalls → tool_use 块 + stop_reason tool_use', () => {
    const { res, chunks } = fakeRes()
    const w = new AnthropicWire(res, 'm')
    w.json('', '', { output_tokens: 2 }, 'tool_calls', [{ id: 't1', type: 'function', function: { name: 'calc', arguments: '{"a":1}' } }])
    const body = JSON.parse(chunks.join(''))
    expect(body.content.some((b: any) => b.type === 'tool_use' && b.name === 'calc' && b.input.a === 1)).toBe(true)
    expect(body.stop_reason).toBe('tool_use')
  })
})

describe('proxy provider dispatch envelopes', () => {
  it.each([
    ['openai', 'external-proxy:openai'],
    ['anthropic', 'external-proxy:anthropic']
  ] as const)('uses a passthrough envelope for %s ingress', async (wire, origin) => {
    h.streamOptions = []
    h.auditEvents = []
    const { res } = fakeRes()
    const proxy = new (await import('../proxy')).LocalProxy()
    const candidate = {
      agentId: 'proxy-test',
      provider: {
        id: 'provider-1',
        name: 'Provider',
        kind: 'openai-compatible',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-key',
        enabled: true,
        models: [],
        capabilities: { protocol: 'chat_completions', stream: true, nativeThinking: false, budgetTokens: false, toolCalls: true, systemPrompt: true },
        defaultThinking: { mode: 'off', level: 'low' }
      },
      model: { id: 'model-1', label: 'Model', contextWindow: 128000, supportsTools: true, supportsVision: false, supportsThinking: false },
      thinking: { mode: 'off', level: 'low' }
    }
    const messages = [{ role: 'user' as const, content: 'forward this' }]

    await (proxy as any).tryOne(res, wire, true, 'inbound-model', candidate, messages, 'system', {}, origin)

    expect(h.streamOptions).toHaveLength(1)
    expect(h.streamOptions[0].dispatchEnvelope).toMatchObject({
      origin,
      policy: 'passthrough',
      providerId: 'provider-1',
      modelId: 'model-1'
    })
    expect(h.auditEvents).toHaveLength(1)
    expect(h.auditEvents[0]).toEqual(['dispatch:prepared', expect.objectContaining({
      dispatchId: h.streamOptions[0].dispatchEnvelope.dispatchId,
      providerId: 'provider-1',
      modelId: 'model-1',
      canonicalPayloadHash: expect.any(String),
      origin,
      policy: 'passthrough',
      rootInputId: undefined,
      rootEnvelopeId: undefined,
      rootPreparedTextHash: undefined,
      parentDispatchId: undefined
    })])
    expect(h.auditEvents[0][1]).not.toHaveProperty('messages')
    expect(h.auditEvents[0][1]).not.toHaveProperty('apiKey')
  })

  it('preserves the agent ingress origin when agent-routed traffic uses the OpenAI wire format', async () => {
    h.streamOptions = []
    h.auditEvents = []
    const { res } = fakeRes()
    const proxy = new (await import('../proxy')).LocalProxy()
    const candidate = {
      agentId: 'proxy-agent',
      provider: {
        id: 'provider-1',
        name: 'Provider',
        kind: 'openai-compatible',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-key',
        enabled: true,
        models: [],
        capabilities: { protocol: 'chat_completions', stream: true, nativeThinking: false, budgetTokens: false, toolCalls: true, systemPrompt: true },
        defaultThinking: { mode: 'off', level: 'low' }
      },
      model: { id: 'model-1', label: 'Model', contextWindow: 128000, supportsTools: true, supportsVision: false, supportsThinking: false },
      thinking: { mode: 'off', level: 'low' }
    }

    await (proxy as any).streamWithFailover(
      res,
      'openai',
      true,
      'inbound-agent-model',
      [candidate],
      [{ role: 'user', content: 'route this to the selected agent' }],
      undefined,
      {},
      'external-proxy:agent'
    )

    expect(h.streamOptions[0].dispatchEnvelope).toMatchObject({
      origin: 'external-proxy:agent',
      policy: 'passthrough'
    })
    expect(h.auditEvents[0]).toEqual(['dispatch:prepared', expect.objectContaining({
      origin: 'external-proxy:agent',
      policy: 'passthrough'
    })])
    expect(h.auditEvents[0][1]).not.toHaveProperty('messages')
    expect(h.auditEvents[0][1]).not.toHaveProperty('apiKey')
  })
})
