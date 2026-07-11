import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentRegistry } from "../registry"
import { EventPipeline } from "../pipeline"
import type { AgentAdapter } from "../adapters/agent-adapter"
import type { StreamEvent } from "../dispatcher"

const h = vi.hoisted(() => {
  const state = {
    providerEnabled: true,
    providerApiKey: "deepseek-key",
    modelEnabled: true,
    clientErrorCode: null as string | null,
    clientDeferred: false,
    clientSourceDeferred: false,
    clientSourceRelease: null as null | (() => void),
    clientCallbacks: [] as any[],
    clientBuildError: false,
    providerLookupError: false,
    httpAgenticEnabled: false,
    agenticCalls: [] as any[],
    agenticRunner: null as null | ((params: any) => Promise<any>),
    clientWithThinking: false,
    modelTimeoutMs: undefined as number | undefined,
    runTimeoutMs: 10 * 60 * 1000,
    clientCalls: [] as any[],
    resolveBindingCalls: [] as string[],
    getBindingsCalls: 0,
    bindingProtocol: "stdio-plain" as "stdio-plain" | "http",
    localModels: {} as Record<string, any>
  }
  return { state }
})

vi.mock("../../providers/manager", () => ({
  isProviderRuntimeUsable: (provider: any) => !!provider && provider.enabled && !!provider.apiKey && !provider.apiKeyLocked,
  getProviderManager: () => ({
    getProvider: (id: string) => {
      if (h.state.providerLookupError) throw new Error("provider lookup failed")
      return id === "deepseek"
      ? {
          id: "deepseek",
          name: "DeepSeek",
          kind: "openai-compatible",
          baseUrl: "https://api.deepseek.example/v1",
          apiKey: h.state.providerApiKey,
          enabled: h.state.providerEnabled,
          builtIn: true,
          models: [{
            id: "deepseek-v4-flash",
            label: "DeepSeek V4 Flash",
            enabled: h.state.modelEnabled,
            contextWindow: 258000,
            supportsTools: true,
            supportsVision: false,
            supportsThinking: false,
            timeoutMs: h.state.modelTimeoutMs
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
      : undefined
    },
    getBindings: () => {
      h.state.getBindingsCalls += 1
      return [{ agentId: "codex", providerId: "deepseek", modelId: "deepseek-v4-flash", protocol: h.state.bindingProtocol }]
    },
    getBinding: (agentId: string) => ({ agentId, providerId: "deepseek", modelId: "deepseek-v4-flash", protocol: h.state.bindingProtocol }),
    resolveBinding: (id: string) => {
      h.state.resolveBindingCalls.push(id)
      if (h.state.bindingProtocol !== "http") return null
      const provider = {
        id: "deepseek",
        name: "DeepSeek",
        kind: "openai-compatible",
        baseUrl: "https://api.deepseek.example/v1",
        apiKey: h.state.providerApiKey,
        enabled: h.state.providerEnabled,
        builtIn: true,
        models: [{
          id: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          contextWindow: 258000,
          supportsTools: true,
          supportsVision: false,
          supportsThinking: false,
          timeoutMs: h.state.modelTimeoutMs
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
      return {
        provider,
        model: provider.models[0],
        binding: { agentId: id, providerId: "deepseek", modelId: "deepseek-v4-flash", protocol: "http" },
        thinking: { mode: "off", level: "low" }
      }
    }
  })
}))

vi.mock("../../providers/client", () => ({
  buildProviderClient: (resolved: any) => {
    if (h.state.clientBuildError) throw new Error("client build failed")
    return ({
    stream: (opts: any, cb: any) => {
      h.state.clientCalls.push({ resolved, opts, cb })
      h.state.clientCallbacks.push(cb)
      if (h.state.clientErrorCode) {
        cb.onError?.(Object.assign(new Error("provider cancelled"), { code: h.state.clientErrorCode }))
        return
      }
      if (h.state.clientSourceDeferred) {
        return new Promise<void>(resolve => {
          h.state.clientSourceRelease = resolve
          opts.signal?.addEventListener("abort", () => {
            cb.onError?.(Object.assign(new Error("provider cancelled"), { code: "AGENT_CANCELLED" }))
          }, { once: true })
        })
      }
      if (h.state.clientDeferred) return
      cb.onContent?.("provider answer")
      if (h.state.clientWithThinking) cb.onThinking?.("provider thought")
      cb.onDone?.({
        content: "provider answer",
        thinking: h.state.clientWithThinking ? { preview: "summary" } : undefined,
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      })
    }
  })
  }
}))

vi.mock("../../runtime/local-models", () => ({
  readLocalModelConfig: (agentId: string) => h.state.localModels[agentId] ?? null
}))

vi.mock("../../agentic/capabilities", () => ({
  isHttpAgenticEnabled: () => h.state.httpAgenticEnabled
}))

vi.mock("../../runtime/run-preferences", () => ({
  getRunTimeoutMs: () => h.state.runTimeoutMs
}))

vi.mock("../../agentic/executor", async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    runAgenticHttp: (params: any) => {
      h.state.agenticCalls.push(params)
      return h.state.agenticRunner ? h.state.agenticRunner(params) : actual.runAgenticHttp(params)
    }
  }
})

import { Dispatcher, providerDirectAgentId } from "../dispatcher"
import { installTaskTurnTracking } from "../task-turn-tracking"
import { RuntimeProducerTracker } from "../../runtime/producer-tracker"
import { drainRuntimeProducersForShutdown } from "../../runtime/shutdown-quiescence"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mockAdapter(id: string): AgentAdapter & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn((_prompt: string) => {})
  return {
    id,
    name: id,
    binary: "mock",
    protocol: "stdio-plain",
    mode: "oneshot",
    status: "idle",
    onOutput: null,
    onError: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send
  } as AgentAdapter & { send: typeof send }
}

function makeDispatcher(pipeline: EventPipeline = new EventPipeline()) {
  const registry = new AgentRegistry()
  const localCodex = mockAdapter("codex")
  registry.register(localCodex, ["code"], "openai", "gpt-4o")
  const dispatcher = new Dispatcher(registry, pipeline)
  const events: StreamEvent[] = []
  dispatcher.on("stream", (event: StreamEvent) => events.push(event))
  return { dispatcher, events, localCodex, registry }
}

describe("provider direct dispatch", () => {
  beforeEach(() => {
    h.state.providerEnabled = true
    h.state.providerApiKey = "deepseek-key"
    h.state.modelEnabled = true
    h.state.clientErrorCode = null
    h.state.clientDeferred = false
    h.state.clientSourceDeferred = false
    h.state.clientSourceRelease = null
    h.state.clientCallbacks = []
    h.state.clientBuildError = false
    h.state.providerLookupError = false
    h.state.httpAgenticEnabled = false
    h.state.agenticCalls = []
    h.state.agenticRunner = null
    h.state.clientWithThinking = false
    h.state.modelTimeoutMs = undefined
    h.state.runTimeoutMs = 10 * 60 * 1000
    h.state.clientCalls = []
    h.state.resolveBindingCalls = []
    h.state.getBindingsCalls = 0
    h.state.bindingProtocol = "stdio-plain"
    h.state.localModels = {}
  })

  it("runs the selected API provider directly without touching local agent routing", async () => {
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatchProviderDirect(
      "who are you?",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { messages: [{ role: "user", content: "who are you?" }] }
    )

    expect(task.status).toBe("completed")
    expect(task.targetAgent).toBe(providerDirectAgentId("deepseek"))
    expect(task.results.get(providerDirectAgentId("deepseek"))).toBe("provider answer")
    expect(task.usage.get(providerDirectAgentId("deepseek"))).toMatchObject({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7
    })
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.getBindingsCalls).toBe(0)
    expect(h.state.resolveBindingCalls).toEqual([])
    expect(h.state.clientCalls).toHaveLength(1)
    expect(h.state.clientCalls[0].resolved.binding.agentId).toBe("provider:deepseek")
    expect(events.map(event => (event as any).agentId)).toEqual([
      "provider:deepseek",
      "provider:deepseek",
      "provider:deepseek"
    ])
    expect(events.some(event => event.kind.startsWith("orchestrate:"))).toBe(false)
  })

  it.each([
    { status: "completed", configure: () => {} },
    { status: "failed", configure: () => { h.state.providerApiKey = "" } },
    { status: "cancelled", configure: () => { h.state.clientErrorCode = "AGENT_CANCELLED" } }
  ])("emits task:finished after the final stream event and releases $status task tracking", async ({ status, configure }) => {
    configure()
    const { dispatcher } = makeDispatcher()
    const runtimeStore = { attachTask: vi.fn(async (_turnId: string, _taskId: string) => undefined), appendStreamEvent: vi.fn(async (_turnId: string, _event: any) => undefined) }
    installTaskTurnTracking(dispatcher, runtimeStore)
    const lifecycle: string[] = []
    dispatcher.on("stream", (event: StreamEvent) => {
      if (event.kind === "done" || event.kind === "error") lifecycle.push("final-stream")
    })
    dispatcher.on("task:finished", () => lifecycle.push("task:finished"))

    const task = await dispatcher.dispatchProviderDirect(
      "tracked direct dispatch",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { turnId: "turn-1" }
    )

    expect(task.status).toBe(status)
    expect(lifecycle).toEqual(["final-stream", "task:finished"])
    const finalEvent = runtimeStore.appendStreamEvent.mock.calls.at(-1)?.[1]
    expect(finalEvent).toMatchObject({ taskId: task.id, __runtimeTurnId: "turn-1" })

    const appendCount = runtimeStore.appendStreamEvent.mock.calls.length
    dispatcher.emit("stream", { kind: "delta", taskId: task.id, agentId: "provider:deepseek", providerId: "deepseek", modelId: "deepseek-v4-flash", channel: "content", text: "late" })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(appendCount)
  })

  it("fails API direct runs without falling back to a local CLI when the provider is unavailable", async () => {
    h.state.providerApiKey = ""
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatchProviderDirect(
      "hello",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )

    expect(task.status).toBe("failed")
    expect(task.error).toContain("deepseek")
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.clientCalls).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "error",
      agentId: "provider:deepseek",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash"
    })
  })

  it.each([
    {
      name: "disabled models",
      configure: () => { h.state.modelEnabled = false },
      modelId: "deepseek-v4-flash",
      error: /disabled/i
    },
    {
      name: "unavailable providers",
      configure: () => { h.state.providerApiKey = "" },
      modelId: "deepseek-v4-flash",
      error: /unavailable/i
    },
    {
      name: "models that are not found",
      configure: () => {},
      modelId: "missing-model",
      error: /not found/i
    }
  ])("prunes repeated provider-direct failures for $name while preserving each error", async ({ configure, modelId, error }) => {
    configure()
    const { dispatcher, events } = makeDispatcher()
    const finished: any[] = []
    const removed: any[] = []
    dispatcher.on("task:finished", task => finished.push(task))
    dispatcher.on("task:removed", event => removed.push(event))

    const tasks = await Promise.all(Array.from({ length: 150 }, () => dispatcher.dispatchProviderDirect(
      "invalid direct dispatch",
      { providerId: "deepseek", modelId, source: "provider" }
    )))

    expect(tasks).toHaveLength(150)
    expect(tasks.every(task => task.status === "failed" && error.test(task.error || ""))).toBe(true)
    expect(events).toHaveLength(150)
    expect(events.every(event => event.kind === "error" && error.test(event.error))).toBe(true)
    expect((dispatcher as any).tasks.size).toBeLessThanOrEqual(100)
    expect(finished).toHaveLength(150)
    expect(removed).toHaveLength(50)
    expect(removed.every(event => event.reason === "prune")).toBe(true)
  })

  it("emits task:removed when a task is explicitly deleted", async () => {
    const { dispatcher } = makeDispatcher()
    const removed = vi.fn()
    dispatcher.on("task:removed", removed)
    const task = await dispatcher.dispatchProviderDirect(
      "delete me",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )

    dispatcher.deleteTask(task.id)

    expect(removed).toHaveBeenCalledWith({ taskId: task.id, reason: "delete" })
  })

  it.each(["delete", "clear", "prune"])("writes the final cancellation event before %s removes a running task", async (removal) => {
    h.state.clientDeferred = true
    const { dispatcher } = makeDispatcher()
    const runtimeStore = { attachTask: vi.fn(async (_turnId: string, _taskId: string) => undefined), appendStreamEvent: vi.fn(async (_turnId: string, _event: any) => undefined) }
    installTaskTurnTracking(dispatcher, runtimeStore)
    const lifecycle: string[] = []
    let removedReason = ""
    let taskId = ""
    dispatcher.on("task:created", task => { if (!taskId) taskId = task.id })
    dispatcher.on("stream", event => {
      if (event.taskId === taskId && event.kind === "error") lifecycle.push("final-stream")
    })
    dispatcher.on("task:finished", task => {
      if (task.id === taskId) lifecycle.push("task:finished")
    })
    dispatcher.on("task:removed", event => {
      if (event.taskId !== taskId) return
      removedReason = event.reason
      lifecycle.push("task:removed")
    })

    const running = dispatcher.dispatchProviderDirect(
      `${removal} while running`,
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { turnId: `turn-${removal}` }
    )
    dispatcher.cancel(taskId)
    if (removal === "delete") dispatcher.deleteTask(taskId)
    if (removal === "clear") dispatcher.clearCompleted()
    if (removal === "delete" || removal === "prune") {
      await Promise.all(Array.from({ length: 100 }, () => dispatcher.dispatchProviderDirect(
        "prune pressure",
        { providerId: "deepseek", modelId: "missing-model", source: "provider" }
      )))
    }
    const task = await running

    expect(task.status).toBe("cancelled")
    expect(lifecycle).toEqual(["final-stream", "task:finished", "task:removed"])
    expect((dispatcher as any).tasks.has(taskId)).toBe(false)
    expect(runtimeStore.appendStreamEvent.mock.calls.at(-1)?.[1]).toMatchObject({
      kind: "error",
      taskId,
      code: "AGENT_CANCELLED",
      __runtimeTurnId: `turn-${removal}`
    })
    expect((dispatcher as any).pendingTaskRemovals.has(taskId)).toBe(false)
    expect(removedReason).toBe(removal)
  })

  it("honors provider-direct deletion requested synchronously by task:created", async () => {
    const { dispatcher, events, localCodex } = makeDispatcher()
    const lifecycle: string[] = []
    let taskId = ""
    dispatcher.on("task:created", task => {
      taskId = task.id
      dispatcher.deleteTask(task.id)
    })
    dispatcher.on("stream", event => {
      if (event.taskId === taskId && event.kind === "error") lifecycle.push("final-stream")
    })
    dispatcher.on("task:finished", task => {
      if (task.id === taskId) lifecycle.push("task:finished")
    })
    dispatcher.on("task:removed", event => {
      if (event.taskId === taskId) lifecycle.push("task:removed")
    })

    const task = await dispatcher.dispatchProviderDirect(
      "cancel before provider startup",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )

    expect(task.status).toBe("cancelled")
    expect(lifecycle).toEqual(["final-stream", "task:finished", "task:removed"])
    expect(events).toEqual([expect.objectContaining({ kind: "error", taskId, code: "AGENT_CANCELLED" })])
    expect(h.state.clientCalls).toHaveLength(0)
    expect(localCodex.send).not.toHaveBeenCalled()
    expect((dispatcher as any).tasks.has(taskId)).toBe(false)
  })

  it("honors local adapter deletion requested synchronously by task:created", async () => {
    const { dispatcher, events, localCodex } = makeDispatcher()
    const lifecycle: string[] = []
    let taskId = ""
    dispatcher.on("task:created", task => {
      taskId = task.id
      dispatcher.deleteTask(task.id)
    })
    dispatcher.on("stream", event => {
      if (event.taskId === taskId && event.kind === "error") lifecycle.push("final-stream")
    })
    dispatcher.on("task:finished", task => {
      if (task.id === taskId) lifecycle.push("task:finished")
    })
    dispatcher.on("task:removed", event => {
      if (event.taskId === taskId) lifecycle.push("task:removed")
    })

    const task = await dispatcher.dispatch("cancel before adapter startup", "auto", "codex")

    expect(task.status).toBe("cancelled")
    expect(lifecycle).toEqual(["final-stream", "task:finished", "task:removed"])
    expect(events).toEqual([expect.objectContaining({ kind: "error", taskId, code: "AGENT_CANCELLED" })])
    expect(h.state.getBindingsCalls).toBe(0)
    expect(localCodex.send).not.toHaveBeenCalled()
    expect((dispatcher as any).tasks.has(taskId)).toBe(false)
  })

  it.each(["attach", "append"])("contains runtime store %s observer failures without leaking the task", async (failure) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { dispatcher } = makeDispatcher()
    const runtimeStore = {
      attachTask: vi.fn(async () => {
        if (failure === "attach") throw new Error("attach failed")
      }),
      appendStreamEvent: vi.fn(async () => {
        if (failure === "append") throw new Error("append failed")
      })
    }
    installTaskTurnTracking(dispatcher, runtimeStore)
    const finished = vi.fn()
    const removed = vi.fn()
    dispatcher.on("task:finished", finished)
    dispatcher.on("task:removed", removed)

    const task = await dispatcher.dispatchProviderDirect(
      `observer ${failure} failure`,
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { turnId: `turn-${failure}` }
    )

    expect(task.status).toBe("completed")
    expect(finished).toHaveBeenCalledOnce()
    dispatcher.deleteTask(task.id)
    expect(removed).toHaveBeenCalledWith({ taskId: task.id, reason: "delete" })
    expect((dispatcher as any).tasks.has(task.id)).toBe(false)
    const appendCount = runtimeStore.appendStreamEvent.mock.calls.length
    expect(() => dispatcher.emit("stream", {
      kind: "delta", taskId: task.id, agentId: "provider:deepseek", providerId: "deepseek",
      modelId: "deepseek-v4-flash", channel: "content", text: "late"
    })).not.toThrow()
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(appendCount)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("finishes pending removal even when a task:finished observer throws", async () => {
    h.state.clientDeferred = true
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { dispatcher } = makeDispatcher()
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })
    dispatcher.on("task:finished", () => { throw new Error("observer failed") })

    const running = dispatcher.dispatchProviderDirect(
      "throwing finish observer",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )
    dispatcher.deleteTask(taskId)

    await expect(running).resolves.toMatchObject({ status: "cancelled" })
    expect((dispatcher as any).tasks.has(taskId)).toBe(false)
    expect((dispatcher as any).pendingTaskRemovals.has(taskId)).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("continues notifying tracking when an earlier task:finished observer throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { dispatcher } = makeDispatcher()
    dispatcher.on("task:finished", () => { throw new Error("first observer failed") })
    const runtimeStore = { attachTask: vi.fn(async (_turnId: string, _taskId: string) => undefined), appendStreamEvent: vi.fn(async (_turnId: string, _event: any) => undefined) }
    installTaskTurnTracking(dispatcher, runtimeStore)

    const task = await dispatcher.dispatchProviderDirect(
      "observer isolation",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { turnId: "turn-observer-isolation" }
    )
    const appendCount = runtimeStore.appendStreamEvent.mock.calls.length
    dispatcher.emit("stream", {
      kind: "delta", taskId: task.id, agentId: "provider:deepseek", providerId: "deepseek",
      modelId: "deepseek-v4-flash", channel: "content", text: "late"
    })

    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(appendCount)
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it("turns provider client setup exceptions into a finished failed task", async () => {
    h.state.clientBuildError = true
    const { dispatcher, events } = makeDispatcher()
    const runtimeStore = { attachTask: vi.fn(async (_turnId: string, _taskId: string) => undefined), appendStreamEvent: vi.fn(async (_turnId: string, _event: any) => undefined) }
    installTaskTurnTracking(dispatcher, runtimeStore)
    const finished = vi.fn()
    dispatcher.on("task:finished", finished)

    const task = await dispatcher.dispatchProviderDirect(
      "client setup error",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { turnId: "turn-client-build" }
    )

    expect(task.status).toBe("failed")
    expect(task.error).toContain("client build failed")
    expect(events.at(-1)).toMatchObject({ kind: "error", taskId: task.id, error: "client build failed" })
    expect(finished).toHaveBeenCalledOnce()
    expect((dispatcher as any).inFlightTaskIds.has(task.id)).toBe(false)
    const appendCount = runtimeStore.appendStreamEvent.mock.calls.length
    dispatcher.emit("stream", {
      kind: "delta", taskId: task.id, agentId: "provider:deepseek", providerId: "deepseek",
      modelId: "deepseek-v4-flash", channel: "content", text: "late"
    })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(appendCount)
  })

  it.each(["task:created", "start stream", "provider lookup"])("contains synchronous %s failures and still finishes the task", async (failure) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    if (failure === "provider lookup") h.state.providerLookupError = true
    const { dispatcher, events } = makeDispatcher()
    if (failure === "task:created") {
      dispatcher.on("task:created", () => { throw new Error("created observer failed") })
    }
    if (failure === "start stream") {
      dispatcher.on("stream", event => {
        if (event.kind === "start") throw new Error("start observer failed")
      })
    }
    const finished = vi.fn()
    dispatcher.on("task:finished", finished)

    const task = await dispatcher.dispatchProviderDirect(
      `sync ${failure} failure`,
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )

    expect(task.status).toBe("failed")
    expect(events.filter(event => event.kind === "error" && event.taskId === task.id)).toHaveLength(1)
    expect(finished).toHaveBeenCalledOnce()
    expect((dispatcher as any).inFlightTaskIds.has(task.id)).toBe(false)
    if (failure !== "provider lookup") expect(errorSpy).toHaveBeenCalled()
    if (failure !== "provider lookup") expect(h.state.clientCalls).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it("does not call the HTTP provider after cancellation during pipeline processing", async () => {
    let releasePipeline!: () => void
    let markPipelineEntered!: () => void
    const pipelineEntered = new Promise<void>(resolve => { markPipelineEntered = resolve })
    const pipelineGate = new Promise<void>(resolve => { releasePipeline = resolve })
    const pipeline = { process: vi.fn(async () => {
      markPipelineEntered()
      await pipelineGate
    }) } as unknown as EventPipeline
    h.state.bindingProtocol = "http"
    const { dispatcher, events, localCodex } = makeDispatcher(pipeline)
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })

    const running = dispatcher.dispatch("cancel in HTTP pipeline", "auto", "codex")
    await Promise.race([
      pipelineEntered,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pipeline was not entered")), 250))
    ])
    expect(dispatcher.cancel(taskId)).toBe(true)
    releasePipeline()
    const task = await Promise.race([
      running,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("dispatch did not finish after pipeline release")), 250))
    ])

    expect(task.status).toBe("cancelled")
    expect(h.state.clientCalls).toHaveLength(0)
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(events.filter(event => event.kind === "error" && event.taskId === taskId && event.code === "AGENT_CANCELLED")).toHaveLength(1)
  })

  it("does not call the HTTP provider after scoped agent cancellation during pipeline processing", async () => {
    let releasePipeline!: () => void
    let markPipelineEntered!: () => void
    const pipelineEntered = new Promise<void>(resolve => { markPipelineEntered = resolve })
    const pipelineGate = new Promise<void>(resolve => { releasePipeline = resolve })
    const pipeline = { process: vi.fn(async () => {
      markPipelineEntered()
      await pipelineGate
    }) } as unknown as EventPipeline
    h.state.bindingProtocol = "http"
    const { dispatcher, events } = makeDispatcher(pipeline)
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })

    const running = dispatcher.dispatch("scoped cancel in HTTP pipeline", "auto", "codex")
    await pipelineEntered
    expect(dispatcher.cancelAgent(taskId, "codex")).toBe(true)
    releasePipeline()
    await running

    expect(h.state.clientCalls).toHaveLength(0)
    expect(events.filter(event => event.kind === "error" && event.taskId === taskId && event.code === "AGENT_CANCELLED")).toHaveLength(1)

    const future = await dispatcher.dispatch("future HTTP task", "auto", "codex")
    expect(future.status).toBe("completed")
    expect(h.state.clientCalls).toHaveLength(1)
  })

  it("drops late HTTP callbacks after scoped agent cancellation", async () => {
    h.state.bindingProtocol = "http"
    h.state.clientDeferred = true
    const { dispatcher, events } = makeDispatcher()
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })

    const running = dispatcher.dispatch("scoped cancel active HTTP", "auto", "codex")
    await vi.waitFor(() => expect(h.state.clientCalls).toHaveLength(1))
    const callbacks = h.state.clientCallbacks[0]
    expect(dispatcher.cancelAgent(taskId, "codex")).toBe(true)
    await running
    const eventCountAtSettlement = events.length

    callbacks.onContent?.("late scoped secret")
    callbacks.onThinking?.("late scoped thought")
    callbacks.onDone?.({ content: "late scoped secret" })
    callbacks.onError?.(new Error("late scoped error"))

    expect(events.slice(eventCountAtSettlement)).toEqual([])
    expect(events.some(event => event.kind === "delta" && event.text.includes("late scoped"))).toBe(false)
    expect(events.some(event => event.kind === "done" && event.agentId === "codex")).toBe(false)
    expect(events.filter(event => event.kind === "error" && event.taskId === taskId && event.code === "AGENT_CANCELLED")).toHaveLength(1)
  })

  it("fences late normal HTTP callbacks after a successful operation", async () => {
    h.state.bindingProtocol = "http"
    const { dispatcher, events } = makeDispatcher()

    const task = await dispatcher.dispatch("normal HTTP completes", "auto", "codex")
    expect(task.status).toBe("completed")
    const callbacks = h.state.clientCallbacks[0]
    const eventCountAtSettlement = events.length
    const resultAtSettlement = task.results.get("codex")
    const usageAtSettlement = task.usage.get("codex")

    callbacks.onContent?.("late normal secret")
    callbacks.onThinking?.("late normal thought")
    callbacks.onDone?.({
      content: "late normal secret",
      thinking: { preview: "late summary" },
      usage: { prompt_tokens: 99, completion_tokens: 99, total_tokens: 198 }
    })
    callbacks.onError?.(new Error("late normal error"))
    await Promise.resolve()

    expect(events.slice(eventCountAtSettlement)).toEqual([])
    expect(task.results.get("codex")).toBe(resultAtSettlement)
    expect(task.usage.get("codex")).toEqual(usageAtSettlement)
  })

  it("fences late normal HTTP callbacks after timeout even when the provider ignores AbortSignal", async () => {
    h.state.bindingProtocol = "http"
    h.state.clientDeferred = true
    h.state.modelTimeoutMs = 5
    const { dispatcher, events } = makeDispatcher()

    const task = await dispatcher.dispatch("normal HTTP times out", "auto", "codex")
    expect(task.status).toBe("failed")
    const callbacks = h.state.clientCallbacks[0]
    const eventCountAtSettlement = events.length

    callbacks.onContent?.("late timeout secret")
    callbacks.onThinking?.("late timeout thought")
    callbacks.onDone?.({ content: "late timeout secret" })
    callbacks.onError?.(new Error("late timeout error"))
    await Promise.resolve()

    expect(events.slice(eventCountAtSettlement)).toEqual([])
    expect(task.results.has("codex")).toBe(false)
  })

  it.each([
    { label: "success", result: { content: "agentic answer" }, status: "completed" },
    { label: "failure", result: { content: "", error: "agentic failed" }, status: "failed" }
  ])("releases agentic HTTP busy state after $label", async ({ result, status }) => {
    h.state.bindingProtocol = "http"
    h.state.httpAgenticEnabled = true
    h.state.agenticRunner = async () => result
    const { dispatcher, registry } = makeDispatcher()

    const task = await dispatcher.dispatch(`agentic ${status}`, "auto", "codex")

    expect(task.status).toBe(status)
    expect(registry.get("codex")?.status).toBe("idle")
    expect((dispatcher as any).busyCount.get("codex")).toBeUndefined()
  })

  it("releases agentic HTTP busy state after cancellation while the source ignores AbortSignal", async () => {
    h.state.bindingProtocol = "http"
    h.state.httpAgenticEnabled = true
    const source = deferred<{ content: string }>()
    h.state.agenticRunner = async () => source.promise
    const { dispatcher, registry } = makeDispatcher()
    const turnId = "turn-agentic-busy-cancel"
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })

    const running = dispatcher.dispatch("cancel agentic HTTP", "auto", "codex", { turnId })
    await vi.waitFor(() => expect(h.state.agenticCalls).toHaveLength(1))
    expect(dispatcher.cancelAgentForTurn(turnId, "codex")).toBe(true)
    const task = await running

    expect(task.status).toBe("cancelled")
    expect(registry.get("codex")?.status).toBe("idle")
    expect((dispatcher as any).busyCount.get("codex")).toBeUndefined()
    expect(task.id).toBe(taskId)

    source.resolve({ content: "ignored late agentic result" })
    await Promise.resolve()
  })

  it("releases agentic HTTP busy state and fences late emitters after timeout while the source ignores AbortSignal", async () => {
    h.state.bindingProtocol = "http"
    h.state.httpAgenticEnabled = true
    h.state.runTimeoutMs = 5
    const source = deferred<{ content: string }>()
    h.state.agenticRunner = async () => source.promise
    const { dispatcher, events, registry } = makeDispatcher()

    const task = await dispatcher.dispatch("timeout agentic HTTP", "auto", "codex")

    expect(task.status).toBe("failed")
    expect(registry.get("codex")?.status).toBe("idle")
    expect((dispatcher as any).busyCount.get("codex")).toBeUndefined()
    const call = h.state.agenticCalls[0]
    expect(call.signal).toBeInstanceOf(AbortSignal)
    expect(call.signal.aborted).toBe(true)
    const eventCountAtSettlement = events.length

    call.emit.delta("content", "late timed-out agentic secret")
    call.emit.delta("thinking", "late timed-out agentic thought")
    call.emit.activity({ id: "late-timeout-tool", kind: "tool", status: "done", output: "late timed-out agentic secret" })
    source.resolve({ content: "ignored late timed-out agentic result" })
    await Promise.resolve()

    expect(events.slice(eventCountAtSettlement)).toEqual([])
    expect(task.results.has("codex")).toBe(false)
  })

  it("fences late agentic delta and activity emitters after a successful operation", async () => {
    h.state.bindingProtocol = "http"
    h.state.httpAgenticEnabled = true
    h.state.agenticRunner = async () => ({ content: "agentic answer" })
    const { dispatcher, events } = makeDispatcher()

    const task = await dispatcher.dispatch("agentic emit fence", "auto", "codex")
    expect(task.status).toBe("completed")
    const call = h.state.agenticCalls[0]
    const eventCountAtSettlement = events.length
    const resultAtSettlement = task.results.get("codex")

    call.emit.delta("content", "late agentic secret")
    call.emit.delta("thinking", "late agentic thought")
    call.emit.activity({ id: "late-tool", kind: "tool", status: "done", output: "late agentic secret" })
    await Promise.resolve()

    expect(events.slice(eventCountAtSettlement)).toEqual([])
    expect(task.results.get("codex")).toBe(resultAtSettlement)
  })

  it("cleans stable task state when a task:finished listener tries to rewrite its id", async () => {
    h.state.clientDeferred = true
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { dispatcher } = makeDispatcher()
    let taskId = ""
    const removed = vi.fn()
    dispatcher.on("task:created", task => { taskId = task.id })
    dispatcher.on("task:finished", task => { (task as any).id = "mutated-task-id" })
    dispatcher.on("task:removed", removed)

    const running = dispatcher.dispatchProviderDirect(
      "stable task id",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )
    dispatcher.deleteTask(taskId)
    const task = await running

    expect(task.id).toBe(taskId)
    expect((dispatcher as any).inFlightTaskIds.has(taskId)).toBe(false)
    expect((dispatcher as any).pendingTaskRemovals.has(taskId)).toBe(false)
    expect((dispatcher as any).tasks.has(taskId)).toBe(false)
    expect(removed).toHaveBeenCalledWith({ taskId, reason: "delete" })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("keeps the original task id when task:created receives a mutation attempt", async () => {
    const { dispatcher, events } = makeDispatcher()
    let originalTaskId = ""
    let mutationSucceeded = true
    const finishedIds: string[] = []
    dispatcher.on("task:created", task => {
      originalTaskId = task.id
      mutationSucceeded = Reflect.set(task as any, "id", "mutated-task-id")
    })
    dispatcher.on("task:finished", task => finishedIds.push(task.id))

    const task = await dispatcher.dispatchProviderDirect(
      "missing model with created observer",
      { providerId: "deepseek", modelId: "missing-model", source: "provider" }
    )

    expect(mutationSucceeded).toBe(false)
    expect(task.id).toBe(originalTaskId)
    expect(events).toEqual([expect.objectContaining({ kind: "error", taskId: originalTaskId })])
    expect(finishedIds).toEqual([originalTaskId])
    expect((dispatcher as any).inFlightTaskIds.has(originalTaskId)).toBe(false)
    expect((dispatcher as any).pendingTaskRemovals.has(originalTaskId)).toBe(false)
    expect((dispatcher as any).tasks.get(originalTaskId)).toBe(task)
    expect((dispatcher as any).tasks.has("mutated-task-id")).toBe(false)

    dispatcher.deleteTask(originalTaskId)
    expect((dispatcher as any).tasks.has(originalTaskId)).toBe(false)
  })

  it("isolates all mutable task collections and createdAt in the finished snapshot", async () => {
    h.state.clientWithThinking = true
    const { dispatcher } = makeDispatcher()
    let finishedSnapshot: any
    dispatcher.on("task:finished", snapshot => {
      finishedSnapshot = snapshot
      snapshot.results.clear()
      snapshot.errors.clear()
      snapshot.thinking.clear()
      snapshot.usage.clear()
      snapshot.thinkingSummary.clear()
      snapshot.createdAt.setTime(0)
    })

    const task = await dispatcher.dispatchProviderDirect(
      "snapshot isolation",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )

    expect(task.results.get("provider:deepseek")).toBe("provider answer")
    expect(task.thinking.get("provider:deepseek")).toBe("provider thought")
    expect(task.usage.get("provider:deepseek")).toMatchObject({ total_tokens: 7 })
    expect(task.thinkingSummary.get("provider:deepseek")).toMatchObject({ preview: "summary" })
    expect(task.createdAt.getTime()).toBeGreaterThan(0)
    expect(finishedSnapshot.results).not.toBe(task.results)
    expect(finishedSnapshot.errors).not.toBe(task.errors)
    expect(finishedSnapshot.thinking).not.toBe(task.thinking)
    expect(finishedSnapshot.usage).not.toBe(task.usage)
    expect(finishedSnapshot.thinkingSummary).not.toBe(task.thinkingSummary)
    expect(finishedSnapshot.createdAt).not.toBe(task.createdAt)
  })

  it("cancels a stale in-flight task before deferred prune removal", async () => {
    h.state.clientDeferred = true
    const { dispatcher, events } = makeDispatcher()
    const lifecycle: string[] = []
    let taskId = ""
    let removedReason = ""
    dispatcher.on("task:created", task => {
      if (taskId) return
      taskId = task.id
    })
    dispatcher.on("stream", event => {
      if (event.taskId === taskId && event.kind === "error") lifecycle.push("final-stream")
    })
    dispatcher.on("task:finished", task => {
      if (task.id === taskId) lifecycle.push("task:finished")
    })
    dispatcher.on("task:removed", event => {
      if (event.taskId !== taskId) return
      removedReason = event.reason
      lifecycle.push("task:removed")
    })

    const running = dispatcher.dispatchProviderDirect(
      "stale deferred task",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )
    const taskRef = (dispatcher as any).tasks.get(taskId)
    taskRef.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await Promise.all(Array.from({ length: 100 }, () => dispatcher.dispatchProviderDirect(
      "prune pressure",
      { providerId: "deepseek", modelId: "missing-model", source: "provider" }
    )))
    const statusAfterPrune = taskRef.status
    if (statusAfterPrune !== "cancelled") dispatcher.cancel(taskId)
    const task = await running

    expect(statusAfterPrune).toBe("cancelled")
    expect(task.status).toBe("cancelled")
    expect(events.filter(event => event.taskId === taskId && event.kind === "error" && event.code === "AGENT_CANCELLED")).toHaveLength(1)
    expect(lifecycle).toEqual(["final-stream", "task:finished", "task:removed"])
    expect(removedReason).toBe("prune")
  })

  it("rejects stale provider selections that accidentally enter local agent routing", async () => {
    const { dispatcher, localCodex } = makeDispatcher()

    await expect(dispatcher.dispatch(
      "stale mixed state",
      "auto",
      "codex",
      { modelSelection: { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" } }
    )).rejects.toThrow(/provider direct/i)

    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.clientCalls).toHaveLength(0)
    expect(h.state.resolveBindingCalls).toEqual([])
  })

  it("labels local CLI runs with the configured local model instead of stale API binding defaults", async () => {
    h.state.localModels.codex = {
      agentId: "codex",
      source: "codex",
      status: "ok",
      modelId: "gpt-5.5",
      configPath: "C:/Users/test/.codex/config.toml",
      models: [{ id: "gpt-5.5" }]
    }
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatch("hello", "auto", "codex")

    expect(task.status).toBe("completed")
    expect(localCodex.send).toHaveBeenCalled()
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "start",
        agentId: "codex",
        providerId: "local-cli",
        modelId: "gpt-5.5"
      }),
      expect.objectContaining({
        kind: "done",
        agentId: "codex",
        providerId: "local-cli",
        modelId: "gpt-5.5"
      })
    ]))
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "openai", modelId: "gpt-4o" })
    ]))
  })

  it("does not treat a stale local adapter as usable for an HTTP binding", async () => {
    h.state.bindingProtocol = "http"
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatch("hello over http", "auto", "codex")

    expect(task.status).toBe("completed")
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.clientCalls).toHaveLength(1)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "start",
        agentId: "codex",
        providerId: "deepseek",
        modelId: "deepseek-v4-flash"
      }),
      expect.objectContaining({
        kind: "done",
        agentId: "codex",
        providerId: "deepseek",
        modelId: "deepseek-v4-flash"
      })
    ]))
  })

  it("permanently closes admission and cancels running tasks plus approvals when shutdown begins", async () => {
    h.state.clientDeferred = true
    const { dispatcher } = makeDispatcher()
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })
    const running = dispatcher.dispatchProviderDirect(
      "running during shutdown",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )
    let resolveApproval!: (approved: boolean) => void
    const approval = new Promise<boolean>(resolve => { resolveApproval = resolve })
    const timer = setTimeout(() => resolveApproval(true), 60_000)
    ;(dispatcher as any).pendingApprovals.set("shutdown-approval", {
      resolve: resolveApproval,
      timer,
      taskId,
      agentId: "provider:deepseek",
      request: { id: "shutdown-approval", stepId: "step-1", tool: "exec", toolName: "exec" }
    })

    dispatcher.beginShutdown()

    await expect(approval).resolves.toBe(false)
    await expect(running).resolves.toMatchObject({ status: "cancelled" })
    expect(dispatcher.getPendingApprovalIds()).toEqual([])
    await expect(dispatcher.dispatch("after shutdown", "auto", "codex")).rejects.toThrow(/shutting down/i)
    await expect(dispatcher.dispatchProviderDirect(
      "after shutdown",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )).rejects.toThrow(/shutting down/i)
    await expect(dispatcher.stopAndDrain()).resolves.toBeUndefined()
  })

  it("aborts provider-direct HTTP and waits for the original transport while suppressing late output", async () => {
    h.state.clientSourceDeferred = true
    const { dispatcher, events } = makeDispatcher()
    const running = dispatcher.dispatchProviderDirect(
      "deferred provider transport",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )
    await vi.waitFor(() => expect(h.state.clientCalls).toHaveLength(1))
    const call = h.state.clientCalls[0]

    let drained = false
    const draining = dispatcher.stopAndDrain().then(() => { drained = true })
    await Promise.resolve()

    expect(call.opts.signal).toBeInstanceOf(AbortSignal)
    expect(call.opts.signal.aborted).toBe(true)
    call.cb.onContent?.("late provider content")
    call.cb.onThinking?.("late provider thinking")
    call.cb.onDone?.({ content: "late provider content" })
    await expect(running).resolves.toMatchObject({ status: "cancelled" })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(events.some(event => event.kind === "delta" && event.text.includes("late provider"))).toBe(false)
    expect(events.some(event => event.kind === "done")).toBe(false)

    h.state.clientSourceRelease?.()
    await draining
  })

  it("propagates shutdown abort into agentic HTTP and drains the original transport", async () => {
    h.state.bindingProtocol = "http"
    h.state.httpAgenticEnabled = true
    h.state.clientSourceDeferred = true
    const { dispatcher, events } = makeDispatcher()
    const running = dispatcher.dispatch("deferred agentic transport", "auto", "codex")
    await vi.waitFor(() => expect(h.state.clientCalls).toHaveLength(1))
    const call = h.state.clientCalls[0]

    let drained = false
    const draining = dispatcher.stopAndDrain().then(() => { drained = true })
    await Promise.resolve()

    expect(call.opts.signal).toBeInstanceOf(AbortSignal)
    expect(call.opts.signal.aborted).toBe(true)
    call.cb.onContent?.("late agentic content")
    call.cb.onDone?.({ content: "late agentic content" })
    await expect(running).resolves.toMatchObject({ status: "cancelled" })
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(events.some(event => event.kind === "delta" && event.text.includes("late agentic"))).toBe(false)
    expect(events.some(event => event.kind === "done")).toBe(false)

    h.state.clientSourceRelease?.()
    await draining
  })

  it("tracks and observes a rejecting local stdio stop started by cancellation", async () => {
    const { dispatcher, localCodex } = makeDispatcher()
    const firstStop = deferred<void>()
    localCodex.stop = vi.fn()
      .mockReturnValueOnce(firstStop.promise)
      .mockResolvedValue(undefined)
    let taskId = ""
    dispatcher.on("task:created", task => { taskId = task.id })

    const running = dispatcher.dispatch("cancel local stdio", "auto", "codex")
    await vi.waitFor(() => expect(localCodex.send).toHaveBeenCalledOnce())
    expect(dispatcher.cancelAgent(taskId, "codex")).toBe(true)
    await running

    let drained = false
    const draining = dispatcher.stopAndDrain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)

    firstStop.reject(new Error("local stop rejected"))
    await expect(draining).resolves.toBeUndefined()
    expect(drained).toBe(true)
  })

  it("cancels every concurrent same-task same-agent transport and drains each source", async () => {
    const { dispatcher } = makeDispatcher()
    const task = { id: "shared-task", status: "running", errors: new Map<string, string>() }
    ;(dispatcher as any).tasks.set(task.id, task)
    const firstSource = deferred<void>()
    const secondSource = deferred<void>()
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const start = (source: Promise<void>, abort: AbortController) => (
      (dispatcher as any).withAgentTimeout(
        task,
        "codex",
        () => (dispatcher as any).trackSourceOperation(source),
        () => abort.abort(),
        60_000
      ) as Promise<void>
    )
    const first = start(firstSource.promise, firstAbort)
    const second = start(secondSource.promise, secondAbort)

    let draining: Promise<void> | undefined
    try {
      expect(dispatcher.cancelAgent(task.id, "codex")).toBe(true)
      expect(firstAbort.signal.aborted).toBe(true)
      expect(secondAbort.signal.aborted).toBe(true)
      await expect(Promise.allSettled([first, second])).resolves.toEqual([
        expect.objectContaining({ status: "rejected" }),
        expect.objectContaining({ status: "rejected" })
      ])

      let drained = false
      draining = dispatcher.stopAndDrain().then(() => { drained = true })
      await Promise.resolve()
      expect(drained).toBe(false)
    } finally {
      firstSource.resolve()
      secondSource.resolve()
      await Promise.allSettled([first, second])
      await draining
    }
  })

  it("falls back at the final deadline when a local stdio stop stays pending past an event loop", async () => {
    vi.useFakeTimers()
    const { dispatcher, localCodex, registry } = makeDispatcher()
    const forceKillSpy = vi.spyOn(registry, "forceKillAll")
    const stopGate = deferred<void>()
    localCodex.stop = vi.fn(() => stopGate.promise)
    const runtimeStore = {
      attachTask: vi.fn(async () => undefined),
      appendStreamEvent: vi.fn(async () => undefined)
    }
    const stopTaskTurnTracking = installTaskTurnTracking(dispatcher, runtimeStore)
    const runtimeProducers = new RuntimeProducerTracker()
    const running = dispatcher.dispatch("local shutdown", "auto", "codex", { turnId: "turn-local" })
    for (let attempt = 0; attempt < 20 && localCodex.send.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve()
    }
    expect(localCodex.send).toHaveBeenCalledOnce()
    runtimeProducers.close()
    const interruptRuntimeWork = vi.fn(async () => undefined)
    let shutdownFinished = false
    const shutdown = drainRuntimeProducersForShutdown({
      dispatcher,
      registry,
      runtimeProducers,
      stopTaskTurnTracking,
      timeoutMs: 25,
      finalTimeoutMs: 25,
      interruptRuntimeWork,
      onFailure: vi.fn()
    }).then(() => { shutdownFinished = true })

    await vi.advanceTimersByTimeAsync(0)
    expect(shutdownFinished).toBe(false)
    await vi.advanceTimersByTimeAsync(25)
    expect(forceKillSpy).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(25)
    await Promise.resolve()

    expect(shutdownFinished).toBe(true)
    expect(interruptRuntimeWork).toHaveBeenCalledOnce()
    await shutdown

    stopGate.resolve()
    await running
    await vi.advanceTimersByTimeAsync(200)
    await dispatcher.stopAndDrain()
    vi.useRealTimers()
  })
})
