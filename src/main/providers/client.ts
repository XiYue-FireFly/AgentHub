/**
 * 协议转换 & HTTP 客户端
 *
 * 支持：
 *   - chat_completions（OpenAI / DeepSeek / OpenRouter / 自定义）
 *   - messages（Anthropic 原生）
 *   - generate_content（Gemini）
 *
 * 思考字段处理：
 *   - OpenAI 兼容 → reasoning_effort
 *   - Anthropic → thinking: { type: 'enabled', budget_tokens }
 *   - Gemini → generationConfig.thinkingConfig（v1beta）
 */

import { AgentRouteBinding, ChatCompletionChunk, ChatCompletionMessage, ChatCompletionRequest, ModelDefinition, ProviderDefinition, ThinkingConfig, ThinkingSummary } from './types'
import { THINKING_BUDGET_TOKENS } from './presets'
import type { DispatchEnvelope } from '../../shared/prompt-contract'
import { canonicalProviderPayload, verifyDispatchEnvelope } from '../runtime/dispatch-envelope'

function sanitizeHeaderValue(value: string): string {
  return Array.from(value).filter((char) => char.charCodeAt(0) <= 0xff).join('')
}

export interface StreamCallbacks {
  onContent?: (delta: string) => void
  onThinking?: (delta: string) => void
  /** 上游 OpenAI 兼容流的 tool_calls 增量（原样 OpenAI 格式，供 wire 1:1 重编码） */
  onToolCallDelta?: (toolCalls: any[]) => void
  onDone?: (final: { content: string; thinking?: ThinkingSummary; usage?: any; finishReason?: string; toolCalls?: any[] }) => void
  onError?: (err: Error) => void
}

export interface CallOptions {
  messages: ChatCompletionMessage[]
  dispatchEnvelope: DispatchEnvelope
  systemPrompt?: string
  /** 临时覆盖 thinking（来自 UI 切换） */
  thinkingOverride?: ThinkingConfig
  /** 临时覆盖 model（来自 UI 切换） */
  modelOverride?: string
  /** 临时覆盖 provider（来自 UI 切换） */
  providerOverride?: ProviderDefinition
  signal?: AbortSignal
  /** 工具定义（OpenAI 格式）；仅 OpenAI 兼容上游会转发，anthropic/gemini 忽略 */
  tools?: any[]
  toolChoice?: any
  attachments?: readonly unknown[]
  contextLayers?: readonly string[]
}

export interface ResolvedCall {
  provider: ProviderDefinition
  model: ModelDefinition
  binding: AgentRouteBinding
  thinking: ThinkingConfig
  }

export class ProviderClient {
  constructor(private provider: ProviderDefinition, private model: ModelDefinition, private binding: AgentRouteBinding, private thinking: ThinkingConfig) {}

  /** 组装 Chat Completions 风格请求（统一抽象） */
  buildRequest(messages: ChatCompletionMessage[], systemPrompt?: string, thinking: ThinkingConfig = this.thinking): ChatCompletionRequest {
    const sys = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []
    const req: ChatCompletionRequest = {
      model: this.model.id,
      messages: [...sys, ...messages],
      temperature: this.binding.temperature,
      max_tokens: this.binding.maxOutputTokens,
      stream: true,
      metadata: { agentId: this.binding.agentId, providerId: this.provider.id }
    }
    if (thinking.mode !== 'off' && this.model.supportsThinking) {
      req.reasoning_effort = thinking.level
    }
    return req
  }

  async stream(opts: CallOptions, cb: StreamCallbacks): Promise<void> {
    try {
      const provider = opts.providerOverride || this.provider
      const thinking = opts.thinkingOverride || this.thinking
      const model = this.model
      const messages = opts.messages
      const tools = opts.tools?.length ? opts.tools : []
      const canonicalPayload = canonicalProviderPayload({
        providerId: provider.id,
        modelId: model.id,
        protocol: provider.capabilities.protocol,
        systemPrompt: opts.systemPrompt || '',
        messages,
        tools,
        toolChoice: tools.length && opts.toolChoice !== undefined ? opts.toolChoice : null,
        attachments: opts.attachments || [],
        contextLayers: opts.contextLayers || [],
        thinking
      })
      if (!opts.dispatchEnvelope) {
        throw new Error('DispatchEnvelope is required before provider fetch')
      }
      verifyDispatchEnvelope(opts.dispatchEnvelope, canonicalPayload)

      if (provider.kind === 'anthropic') {
        await this.streamAnthropic(provider, model, messages, opts, thinking, cb, opts.signal)
      } else if (provider.kind === 'gemini') {
        await this.streamGemini(provider, model, messages, opts, thinking, cb, opts.signal)
      } else {
        await this.streamOpenAICompat(provider, model, messages, opts, thinking, cb, opts.signal)
      }
    } catch (e: any) {
      // LOW-30: Sanitize API keys from error messages (Gemini URL contains key as query param)
      const rawMsg = typeof e?.message === 'string' ? e.message : String(e)
      const sanitized = rawMsg.replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
      cb.onError?.(sanitized === rawMsg ? e : new Error(sanitized))
    }
  }

  // ---- OpenAI 兼容（含 OpenAI / DeepSeek / OpenRouter / 自定义） ----
  private async streamOpenAICompat(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
    const body: any = this.buildRequest(messages, opts.systemPrompt, thinking)
    body.stream_options = { include_usage: true }   // 让上游在末尾 chunk 返回 usage
    if (opts.tools && opts.tools.length) {           // 工具透传（仅 OpenAI 兼容上游，1:1 转发）
      body.tools = opts.tools
      if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice
    }
    const headers = this.headersFor(provider)
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} from ${provider.name}: ${txt.slice(0, 200)}`)
    }
    let content = ''
    let usage: any = undefined
    let finishReason: string | undefined
    const toolAcc: any[] = []   // 按 index 累积流式 tool_calls（id/name 仅首帧，arguments 拼接）
    await this.readSse(res.body, (evt) => {
      if (!evt || evt === '[DONE]') return
      try {
        const chunk: ChatCompletionChunk = JSON.parse(evt)
        const u = (chunk as any).usage
        if (u) usage = normalizeUsage({ ...u, modelId: (chunk as any).model || model.id, providerId: provider.id })
        const fr = chunk.choices?.[0]?.finish_reason
        if (fr) finishReason = normFinish(fr)
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) { content += delta.content; cb.onContent?.(delta.content) }
        if (delta?.reasoning_content) cb.onThinking?.(delta.reasoning_content)
        if (delta?.tool_calls && delta.tool_calls.length) {
          accumulateToolCalls(toolAcc, delta.tool_calls)
          cb.onToolCallDelta?.(delta.tool_calls)
        }
      } catch (err) { console.warn('[provider-client] OpenAI stream chunk parse error:', err) }
    })
    cb.onDone?.({ content, usage, finishReason, toolCalls: toolAcc.length ? toolAcc : undefined })
  }

  // ---- Anthropic Messages ----
  private async streamAnthropic(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/messages`
    const headers = this.headersFor(provider)
    const sysText = opts.systemPrompt || ''
    const supportsThinking = model.supportsThinking && provider.capabilities.nativeThinking
    const wantThink = thinking.mode !== 'off' && supportsThinking
    const maxTokens = this.binding.maxOutputTokens ?? 8192
    const requestedBudget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium
    const budget = Math.max(1024, Math.min(requestedBudget, Math.max(1024, maxTokens - 1024)))

    const body: any = {
      model: model.id,
      max_tokens: maxTokens,
      stream: true,
      messages: openaiMessagesToAnthropic(messages)
    }
    if (sysText) body.system = sysText
    if (wantThink) body.thinking = { type: 'enabled', budget_tokens: budget }
    if (this.binding.temperature !== undefined && !wantThink) body.temperature = this.binding.temperature
    if (opts.tools && opts.tools.length) body.tools = openaiToolsToAnthropic(opts.tools)  // 工具支持（Claude-B 新增）

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    let content = ''
    let thinkingTxt = ''
    let thinkingStartedAt: number | null = null
    let inputTokens = 0
    let outputTokens = 0
    let usage: any = undefined
    let accumulatedUsage: any = {}
    let stopReason: string | undefined
    const toolAcc: any[] = []   // 按 content block index 累积 tool_use（id/name 在 start，input 拼 partial_json）
    await this.readSse(res.body, (evt) => {
      if (!evt) return
      // readSse 已剥离 "data: " 前缀；兼容两种形态再解析（Claude-B 加固）
      const payload = evt.startsWith('data: ') ? evt.slice(6).trim() : evt.trim()
      if (!payload) return
      try {
        const obj = JSON.parse(payload)
        if (obj.type === 'content_block_start') {
          if (obj.content_block?.type === 'thinking') thinkingStartedAt = Date.now()
          if (obj.content_block?.type === 'tool_use') {
            toolAcc[obj.index] = { index: obj.index, id: obj.content_block.id, type: 'function', function: { name: obj.content_block.name, arguments: '' } }
          }
        }
        if (obj.type === 'content_block_delta') {
          if (obj.delta?.text) {
            content += obj.delta.text
            cb.onContent?.(obj.delta.text)
          }
          if (obj.delta?.thinking) {
            thinkingTxt += obj.delta.thinking
            cb.onThinking?.(obj.delta.thinking)
          }
          if (obj.delta?.partial_json && obj.index !== undefined && toolAcc[obj.index]) {
            toolAcc[obj.index].function.arguments += obj.delta.partial_json
          }
        }
        if (obj.type === 'message_start' && obj.message?.usage) {
          inputTokens = obj.message.usage.input_tokens ?? inputTokens
          accumulatedUsage = { ...accumulatedUsage, ...obj.message.usage, input_tokens: inputTokens, output_tokens: outputTokens }
          usage = normalizeUsage({ ...accumulatedUsage, modelId: model.id, providerId: provider.id })
        }
        if (obj.type === 'message_delta') {
          if (obj.usage) {
            outputTokens = obj.usage.output_tokens ?? outputTokens
            accumulatedUsage = { ...accumulatedUsage, ...obj.usage, input_tokens: inputTokens, output_tokens: outputTokens }
            usage = normalizeUsage({ ...accumulatedUsage, modelId: model.id, providerId: provider.id })
          }
          if (obj.delta?.stop_reason) stopReason = obj.delta.stop_reason
        }
      } catch (err) { console.warn('[provider-client] Anthropic stream chunk parse error:', err) }
    })
    cb.onDone?.({
      content,
      usage: usage || normalizeUsage({ ...accumulatedUsage, input_tokens: inputTokens, output_tokens: outputTokens, modelId: model.id, providerId: provider.id }),
      finishReason: normFinish(stopReason),
      toolCalls: toolAcc.length ? toolAcc : undefined,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        budget,
        preview: thinkingTxt.slice(0, 280),
        durationMs: thinkingStartedAt ? Date.now() - thinkingStartedAt : undefined
      } : undefined
    })
  }

  // ---- Gemini generateContent (stream via SSE) ----
  private async streamGemini(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`
    const headers = this.headersFor(provider)
    const sysText = opts.systemPrompt
    const contents = openaiMessagesToGemini(messages)
    const body: any = { contents }
    if (sysText) body.systemInstruction = { role: 'system', parts: [{ text: sysText }] }
    if (opts.tools && opts.tools.length) body.tools = [{ functionDeclarations: openaiToolsToGemini(opts.tools) }]  // 工具支持（Claude-B 新增）
    const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium
    if (model.supportsThinking && thinking.mode !== 'off') {
      body.generationConfig = { thinkingConfig: { thinkingBudget: budget }, maxOutputTokens: this.binding.maxOutputTokens ?? 8192 }
    } else if (this.binding.maxOutputTokens) {
      body.generationConfig = { maxOutputTokens: this.binding.maxOutputTokens }
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    let content = ''
    let thinkingTxt = ''
    let usageMeta: any = undefined
    let geminiFinish: string | undefined
    const toolAcc: any[] = []   // functionCall part 累积（Gemini 无 id，按序号生成稳定 id）
    await this.readSse(res.body, (evt) => {
      if (!evt) return
      const payload = evt.startsWith('data: ') ? evt.slice(6).trim() : evt.trim()  // readSse 已剥前缀，加固兼容
      if (!payload) return
      try {
        const obj = JSON.parse(payload)
        if (obj.usageMetadata) usageMeta = { ...obj.usageMetadata, modelId: model.id, providerId: provider.id }
        const fr = obj.candidates?.[0]?.finishReason
        if (fr) geminiFinish = normFinish(fr)
        const parts = obj.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
          if (part.functionCall) {
            toolAcc.push({ index: toolAcc.length, id: 'gcall-' + toolAcc.length, type: 'function', function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) } })
          } else if (part.text && part.thought) {
            thinkingTxt += part.text
            cb.onThinking?.(part.text)
          } else if (part.text) {
            content += part.text
            cb.onContent?.(part.text)
          }
        }
      } catch (err) { console.warn('[provider-client] Gemini stream chunk parse error:', err) }
    })
    cb.onDone?.({
      content,
      usage: normalizeUsage(usageMeta),
      finishReason: toolAcc.length ? 'tool_calls' : geminiFinish,
      toolCalls: toolAcc.length ? toolAcc : undefined,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        budget,
        preview: thinkingTxt.slice(0, 280)
      } : undefined
    })
  }

  private headersFor(p: ProviderDefinition): Record<string, string> {
    const sanitizedCustom: Record<string, string> = {}
    for (const [k, v] of Object.entries(p.customHeaders || {})) {
      sanitizedCustom[k] = sanitizeHeaderValue(v)
    }
    const h: Record<string, string> = { 'content-type': 'application/json', ...sanitizedCustom }
    const safeKey = sanitizeHeaderValue(p.apiKey || '')
    if (p.kind === 'openai' || p.kind === 'openai-compatible' || p.kind === 'custom') { if (safeKey) { h['authorization'] = 'Bearer ' + safeKey } else { delete h['authorization'] } } else if (p.kind === 'anthropic') { if (safeKey) { h['x-api-key'] = safeKey } else { delete h['x-api-key'] } h['anthropic-version'] = '2023-06-01' }
    return h
  }

  private async readSse(body: ReadableStream<Uint8Array>, onEvent: (data: string) => void): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const evt = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const dataLine = evt.split('\n').filter(l => l.startsWith('data: ')).join('\n')
          const cleaned = dataLine.replace(/^data: /gm, '').trim()
          if (cleaned) onEvent(cleaned)
        }
      }
      // Flush remaining buffer (some SSE servers omit trailing \n\n)
      const remaining = buffer.replace(/\r\n/g, '\n').trim()
      if (remaining) {
        const dataLine = remaining.split('\n').filter(l => l.startsWith('data: ')).join('\n')
        const cleaned = dataLine.replace(/^data: /gm, '').trim()
        if (cleaned) onEvent(cleaned)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

/**
 * 把各家 usage 归一为 OpenAI 形状 { prompt_tokens, completion_tokens, total_tokens }。
 * 兼容 OpenAI(prompt/completion/total)、Anthropic(input/output)、Gemini(promptTokenCount…)。
 * 全为空时返回 undefined（表示上游未提供用量）。
 */
/** 按 index 合并 OpenAI 流式 tool_calls 增量：id/type/name 取首个非空，arguments 逐帧拼接。 */
function accumulateToolCalls(acc: any[], deltas: any[]): void {
  for (const d of deltas) {
    const i = typeof d.index === 'number' ? d.index : acc.length
    if (!acc[i]) acc[i] = { index: i, id: d.id, type: d.type || 'function', function: { name: '', arguments: '' } }
    if (d.id) acc[i].id = d.id
    if (d.type) acc[i].type = d.type
    if (d.function?.name) acc[i].function.name = d.function.name
    if (typeof d.function?.arguments === 'string') acc[i].function.arguments += d.function.arguments
  }
}

/* ---------- 工具/消息跨协议转换（Claude-B 新增，纯函数，便于单测） ---------- */

/** OpenAI 工具定义 → Anthropic tools 形状。 */
export function openaiToolsToAnthropic(tools: any[]): any[] {
  return (tools || []).filter(t => t?.function).map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} }
  }))
}

/** OpenAI 工具定义 → Gemini functionDeclarations 形状。 */
export function openaiToolsToGemini(tools: any[]): any[] {
  return (tools || []).filter(t => t?.function).map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    parameters: t.function.parameters || { type: 'object', properties: {} }
  }))
}

/** 从 assistant.tool_calls 收集 id→工具名（供 tool 结果按名回灌，Gemini 用）。 */
function toolNameById(messages: ChatCompletionMessage[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc.id && tc.function?.name) map[tc.id] = tc.function.name
    }
  }
  return map
}

/** OpenAI 形状 messages → Anthropic messages（连续 tool_result 合并到同一 user 消息）。 */
export function openaiMessagesToAnthropic(messages: ChatCompletionMessage[]): any[] {
  const out: any[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last._toolGroup) last.content.push(block)
      else out.push({ role: 'user', content: [block], _toolGroup: true })
      continue
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks: any[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) {
        let input: any = {}
        try { input = JSON.parse(tc.function?.arguments || '{}') } catch { input = {} }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    // MED-22: Merge consecutive same-role messages (Anthropic requires alternating user/assistant roles)
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      if (typeof last.content === 'string') {
        last.content = last.content + '\n' + (m.content || '')
      } else if (Array.isArray(last.content)) {
        last.content.push({ type: 'text', text: m.content || '' })
      } else {
        out.push({ role: m.role, content: m.content })
      }
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out.map(({ _toolGroup, ...rest }) => rest)
}

/** OpenAI 形状 messages → Gemini contents（tool 结果转 functionResponse，按 id→name 匹配）。 */
export function openaiMessagesToGemini(messages: ChatCompletionMessage[]): any[] {
  const nameById = toolNameById(messages)
  const out: any[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      const name = (m.tool_call_id && nameById[m.tool_call_id]) || 'tool'
      const part = { functionResponse: { name, response: { result: m.content || '' } } }
      const last = out[out.length - 1]
      if (last && last._fnGroup) last.parts.push(part)
      else out.push({ role: 'user', parts: [part], _fnGroup: true })
      continue
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const parts: any[] = []
      if (m.content) parts.push({ text: m.content })
      for (const tc of m.tool_calls) {
        let args: any = {}
        try { args = JSON.parse(tc.function?.arguments || '{}') } catch { args = {} }
        parts.push({ functionCall: { name: tc.function?.name, args } })
      }
      out.push({ role: 'model', parts })
      continue
    }
    out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })
  }
  return out.map(({ _fnGroup, ...rest }) => rest)
}

/** 把各家结束原因归一为 OpenAI 取向的中性值：stop | length | tool_calls | content_filter。 */
function normFinish(raw: any): string | undefined {
  if (!raw) return undefined
  const s = String(raw).toLowerCase()
  if (s === 'max_tokens' || s === 'length') return 'length'
  if (s === 'tool_use' || s === 'tool_calls' || s === 'function_call') return 'tool_calls'
  if (s === 'content_filter' || s === 'safety' || s === 'recitation') return 'content_filter'
  // end_turn / stop / stop_sequence / STOP / 其它 → stop
  return 'stop'
}

export function normalizeUsage(u: any): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  reasoning_tokens: number
  modelId?: string
  providerId?: string
  raw?: any
} | undefined {
  if (!u) return undefined
  const prompt = num(
    u.prompt_tokens,
    u.promptTokens,
    u.input_tokens,
    u.inputTokens,
    u.promptTokenCount
  )
  const cacheRead = num(
    u.cache_read_tokens,
    u.cacheReadTokens,
    u.cache_read_input_tokens,
    u.cacheReadInputTokens,
    u.cachedContentTokenCount,
    u.prompt_tokens_details?.cached_tokens,
    u.input_tokens_details?.cached_tokens
  ) ?? 0
  const cacheCreation = num(
    u.cache_creation_tokens,
    u.cacheCreationTokens,
    u.cache_creation_input_tokens,
    u.cacheCreationInputTokens
  ) ?? 0
  const reasoning = num(
    u.reasoning_tokens,
    u.reasoningTokens,
    u.thoughtsTokenCount,
    u.output_tokens_details?.reasoning_tokens,
    u.completion_tokens_details?.reasoning_tokens
  ) ?? 0
  const reportedTotal = num(u.total_tokens, u.totalTokens, u.totalTokenCount)
  const explicitCompletion = num(u.completion_tokens, u.completionTokens, u.output_tokens, u.outputTokens, u.candidatesTokenCount)
  const completion = reportedTotal !== undefined && u.totalTokenCount !== undefined
    ? Math.max(reportedTotal - (prompt ?? 0), 0)
    : explicitCompletion
  const fallbackTotal = (prompt ?? 0) + (completion ?? 0) + cacheCreation + (cacheReadAlreadyInInput(u) ? 0 : cacheRead)
  const total = reportedTotal ?? ((prompt !== undefined || completion !== undefined || cacheCreation > 0 || cacheRead > 0) ? fallbackTotal : undefined)
  if (prompt === undefined && completion === undefined && total === undefined && cacheRead <= 0 && cacheCreation <= 0) return undefined
  return {
    prompt_tokens: prompt ?? 0,
    completion_tokens: completion ?? 0,
    // LOW-32: Use reported total when available; fall back to cache tokens when total is 0/undefined
    total_tokens: (total ?? 0) || (cacheRead + cacheCreation),
    input_tokens: prompt ?? 0,
    output_tokens: completion ?? 0,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    reasoning_tokens: reasoning,
    modelId: typeof u.modelId === 'string' ? u.modelId : undefined,
    providerId: typeof u.providerId === 'string' ? u.providerId : undefined,
    raw: u
  }
}

function num(...values: any[]): number | undefined {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n))
  }
  return undefined
}

function cacheReadAlreadyInInput(u: any): boolean {
  return Boolean(
    u?.prompt_tokens_details?.cached_tokens != null ||
    u?.input_tokens_details?.cached_tokens != null ||
    u?.inputTokensDetails?.cachedTokens != null ||
    u?.cachedContentTokenCount != null ||
    u?.cached_content_token_count != null
  )
}

export function buildProviderClient(resolved: ResolvedCall): ProviderClient {
  return new ProviderClient(resolved.provider, resolved.model, resolved.binding, resolved.thinking)
}
