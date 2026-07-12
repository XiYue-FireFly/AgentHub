import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 此文件原位于 usage-stats.test.ts:284-372，因 vi.doMock + 动态 import + 共享
 * memory 跨 describe 竞争导致全量跑偶发 5s 超时，拆到独立文件根治（P1-1）。
 *
 * 关键差异：
 * 1. 用 vi.mock 替代 vi.doMock —— vi.mock 自动 hoisted，保证在所有 import 之前
 *    生效，无需 vi.resetModules + 动态 import 配合
 * 2. 独立 memory 对象，不与其他 describe 共享，无跨测试污染
 * 3. 独立 runtimes 数组，独立 dispose
 */

const memory: Record<string, any> = {}
const runtimes: Array<{ dispose?: () => void | Promise<void> }> = []
const jsonCanonical = <T>(value: T): T => JSON.parse(JSON.stringify(value))

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value },
    commit: async (key: string, value: any) => {
      const canonical = jsonCanonical(value)
      memory[key] = structuredClone(canonical)
      return structuredClone(canonical)
    }
  }
}))

vi.mock("../../providers/manager", () => ({
  isProviderRuntimeUsable: (provider: any) => !!provider && provider.enabled && !!provider.apiKey && !provider.apiKeyLocked,
  getProviderManager: () => ({
    getProvider: (id: string) => id === "deepseek"
      ? {
          id: "deepseek",
          name: "DeepSeek",
          kind: "openai-compatible",
          baseUrl: "https://api.deepseek.example/v1",
          apiKey: "deepseek-key",
          enabled: true,
          builtIn: true,
          models: [{
            id: "deepseek-v4-flash",
            label: "DeepSeek V4 Flash",
            contextWindow: 258000,
            supportsTools: true,
            supportsVision: false,
            supportsThinking: false
          }],
          capabilities: {
            protocol: "chat_completions",
            stream: true,
            nativeThinking: false,
            budgetTokens: false,
            toolCalls: true,
            systemPrompt: true
          },
          defaultThinking: { mode: "off", level: "low" }
        }
      : undefined,
    getBindings: () => [{ agentId: "codex", providerId: "local-cli", modelId: "gpt-5.5", protocol: "stdio-plain", binary: "mock" }],
    getBinding: (agentId: string) => ({ agentId, providerId: "local-cli", modelId: "gpt-5.5", protocol: "stdio-plain", binary: "mock" }),
    resolveBinding: () => null
  })
}))

vi.mock("../local-models", () => ({
  readLocalModelConfig: (agentId: string) => agentId === "codex"
    ? {
        agentId: "codex",
        source: "codex",
        status: "ok",
        modelId: "gpt-5.5",
        configPath: "C:/Users/test/.codex/config.toml",
        models: [{ id: "gpt-5.5" }]
      }
    : null
}))

vi.mock("../../providers/client", () => ({
  buildProviderClient: () => ({
    stream: (_opts: any, cb: any) => {
      cb.onContent?.("provider answer")
      cb.onDone?.({
        content: "provider answer",
        usage: { input_tokens: 13, output_tokens: 17 }
      })
    }
  }),
  // 保留 normalizeUsage 的真实实现，让 usage-stats.ts 能正常归一
  normalizeUsage: (u: any) => {
    if (!u) return undefined
    const prompt = u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? u.inputTokens
    const completion = u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? u.outputTokens
    const cacheRead = u.cache_read_tokens ?? u.cacheReadTokens ?? u.cache_read_input_tokens ?? 0
    const cacheCreation = u.cache_creation_tokens ?? u.cacheCreationTokens ?? u.cache_creation_input_tokens ?? 0
    const reasoning = u.reasoning_tokens ?? u.reasoningTokens ?? 0
    const total = u.total_tokens ?? u.totalTokens ?? ((prompt ?? 0) + (completion ?? 0) + cacheCreation + cacheRead)
    if (prompt === undefined && completion === undefined && total === undefined && cacheRead <= 0 && cacheCreation <= 0) return undefined
    return {
      prompt_tokens: prompt ?? 0,
      completion_tokens: completion ?? 0,
      total_tokens: Math.max(total ?? 0, cacheRead, cacheCreation),
      input_tokens: prompt ?? 0,
      output_tokens: completion ?? 0,
      cache_read_tokens: cacheRead,
      cache_creation_tokens: cacheCreation,
      reasoning_tokens: reasoning,
      modelId: typeof u.modelId === "string" ? u.modelId : undefined,
      providerId: typeof u.providerId === "string" ? u.providerId : undefined,
      raw: u
    }
  }
}))

describe("usageStats dispatcher integration (isolated)", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose?.()))
    vi.useRealTimers()
  })

  it("records provider direct usage after dispatcher stream events enter the runtime store", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const { usageRecords, usageStats } = await import("../usage-stats")
    const { AgentRegistry } = await import("../../hub/registry")
    const { EventPipeline } = await import("../../hub/pipeline")
    const { Dispatcher } = await import("../../hub/dispatcher")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "who are you?",
      mode: "auto",
      workspaceId: null,
      modelSelection: { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    })
    const dispatcher = new Dispatcher(new AgentRegistry(), new EventPipeline())
    const pendingRuntimeWrites: Promise<unknown>[] = []
    dispatcher.on("stream", event => {
      pendingRuntimeWrites.push(runtime.appendStreamEvent(turn.id, event))
    })

    await dispatcher.dispatchProviderDirect(
      "who are you?",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { turnId: turn.id, messages: [{ role: "user", content: "who are you?" }] }
    )
    await Promise.all(pendingRuntimeWrites)
    await runtime.whenIdle()
    const stats = usageStats("all", "providers")
    const page = usageRecords({ range: "all", providerId: "deepseek" }, 1, 10)
    const deepseek = stats.providers.find(row => row.providerId === "deepseek")

    expect(deepseek).toMatchObject({ providerId: "deepseek", actualTokens: 30, tokens: 30 })
    expect(page.total).toBe(1)
    expect(page.records[0]).toMatchObject({
      threadId: thread.id,
      turnId: turn.id,
      providerId: "deepseek",
      agentId: "provider:deepseek",
      modelId: "deepseek-v4-flash",
      source: "actual",
      inputTokens: 13,
      outputTokens: 17
    })
  }, 30_000)

  it("records local CLI usage details with the locally configured CLI model", async () => {
    const { getWorkbenchRuntimeStore } = await import("../store")
    const { usageRecords } = await import("../usage-stats")
    const { AgentRegistry } = await import("../../hub/registry")
    const { EventPipeline } = await import("../../hub/pipeline")
    const { Dispatcher } = await import("../../hub/dispatcher")
    const runtime = getWorkbenchRuntimeStore()
    ;(runtime as any).state = null
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "hello local model",
      mode: "auto",
      workspaceId: null,
      targetAgent: "codex"
    })
    let running = false
    const send = vi.fn(() => { running = false })
    const registry = new AgentRegistry()
    registry.register({
      id: "codex",
      name: "codex",
      binary: "mock",
      protocol: "stdio-plain",
      mode: "oneshot",
      status: "idle",
      onOutput: null,
      onError: null,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      send,
      getLifecycle: () => ({
        protocol: "stdio-plain",
        mode: "oneshot",
        status: "idle",
        running,
        exitCode: 0,
        lastStderr: ""
      })
    } as any, ["code"], "openai", "gpt-4o")
    const dispatcher = new Dispatcher(registry, new EventPipeline())
    const pendingRuntimeWrites: Promise<unknown>[] = []
    dispatcher.on("stream", event => {
      pendingRuntimeWrites.push(runtime.appendStreamEvent(turn.id, event))
    })

    await dispatcher.dispatch("hello local model", "auto", "codex", { turnId: turn.id })
    await Promise.all(pendingRuntimeWrites)
    await runtime.whenIdle()

    const page = usageRecords({ range: "all", providerId: "local-cli" }, 1, 10)
    expect(send).toHaveBeenCalled()
    expect(page.total).toBe(1)
    expect(page.records[0]).toMatchObject({
      threadId: thread.id,
      turnId: turn.id,
      providerId: "local-cli",
      agentId: "codex",
      modelId: "gpt-5.5",
      requestModelId: "gpt-5.5",
      source: "estimated"
    })
  }, 30_000)
})
