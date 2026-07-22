import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { ProviderClient } from "../../providers/client"

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getPath: vi.fn((name: string) => `/${name}`)
}))

const workspaceMock = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string; rootPath: string; createdAt: number; updatedAt: number }>,
  activeId: null as string | null
}))

const auditMock = vi.hoisted(() => ({ append: vi.fn() }))

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  shell: { openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  app: { getPath: electronMock.getPath }
}))

vi.mock("../../providers/client", () => ({
  ProviderClient: vi.fn()
}))

vi.mock("../../runtime/app-event-log", () => ({
  appendAppEventLog: auditMock.append
}))

vi.mock("../../hub/workspace", () => ({
  getWorkspaceManager: () => ({
    list: () => workspaceMock.workspaces,
    getActive: () => workspaceMock.activeId,
    getById: (id: string) => workspaceMock.workspaces.find(workspace => workspace.id === id)
  })
}))

describe("missing IPC quick complete handler", () => {
  let tempRoot = ""

  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.workspaces = []
    workspaceMock.activeId = null
    tempRoot = ""
    vi.clearAllMocks()
    auditMock.append.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  })

  it.each([
    ["undefined input", undefined, "Invalid IPC payload: input must be an object"],
    ["null input", null, "Invalid IPC payload: input must be an object"],
    ["empty string", { origin: "quick-complete:prompt-enhancer", prompt: "" }, "Invalid IPC payload: input.prompt must not be empty"],
    ["whitespace string", { origin: "quick-complete:prompt-enhancer", prompt: "   " }, "Invalid IPC payload: input.prompt must not be empty"],
    ["newline whitespace string", { origin: "quick-complete:prompt-enhancer", prompt: "\n\t  \r\n" }, "Invalid IPC payload: input.prompt must not be empty"],
    ["non-string prompt", { origin: "quick-complete:prompt-enhancer", prompt: 123 }, "Invalid IPC payload: input.prompt must be a string"]
  ])("rejects %s before selecting a provider", async (_label, input, error) => {
    const providerMgr = {
      getProvider: vi.fn(),
      getEnabledProviders: vi.fn()
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    const handler = electronMock.handlers.get("ai:quickComplete")
    expect(handler).toBeTruthy()
    expect(handler?.({}, input)).toEqual({ ok: false, error })
    expect(providerMgr.getProvider).not.toHaveBeenCalled()
    expect(providerMgr.getEnabledProviders).not.toHaveBeenCalled()
    expect(ProviderClient).not.toHaveBeenCalled()
  }, 15000)

  it("rejects QuickComplete without a registered origin before selecting a provider", async () => {
    const providerMgr = {
      getProvider: vi.fn(),
      getEnabledProviders: vi.fn()
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    expect(electronMock.handlers.get("ai:quickComplete")?.({}, { prompt: "missing origin" })).toEqual({
      ok: false,
      error: "Invalid IPC payload: input.origin is invalid"
    })
    expect(providerMgr.getProvider).not.toHaveBeenCalled()
    expect(providerMgr.getEnabledProviders).not.toHaveBeenCalled()
  })

  it("returns only a validated 2-3 item candidate set bound to the submitted draft hash", async () => {
    const stream = vi.fn(async (_options: any, callbacks: any) => {
      callbacks.onDone?.({ content: JSON.stringify({
        schemaVersion: "prompt-candidates-v1",
        candidates: [
          { text: "Clarify the expected behavior and implement the smallest safe change." },
          { text: "Identify the target module, reproduce the issue, then make and verify a focused fix." }
        ]
      }) })
    })
    vi.mocked(ProviderClient).mockImplementation(function () {
      return { stream }
    } as any)
    const provider = {
      id: "deepseek",
      name: "DeepSeek",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      enabled: true,
      builtIn: false,
      capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: "off", level: "medium" },
      models: [{ id: "deepseek-chat", label: "DeepSeek Chat", contextWindow: 128000, supportsTools: false, supportsVision: false, supportsThinking: false }]
    }
    const providerMgr = {
      getProvider: vi.fn(() => provider),
      getEnabledProviders: vi.fn(() => [provider])
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    await expect(electronMock.handlers.get("ai:promptCandidates")?.({}, {
      origin: "quick-complete:prompt-enhancer",
      prompt: "Make it better",
      draftHash: "sha256-draft"
    })).resolves.toEqual({
      candidates: [
        "Clarify the expected behavior and implement the smallest safe change.",
        "Identify the target module, reproduce the issue, then make and verify a focused fix."
      ],
      draftHash: "sha256-draft"
    })

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
      tools: [],
      toolChoice: "none",
      dispatchEnvelope: expect.objectContaining({ origin: "internal:prompt-candidate", policy: "internal" })
    }), expect.any(Object))
  })

  it("skips disabled models and disabled-model-only providers when selecting the candidate model", async () => {
    const stream = vi.fn(async (_options: any, callbacks: any) => {
      callbacks.onDone?.({ content: JSON.stringify({
        schemaVersion: "prompt-candidates-v1",
        candidates: [
          { text: "Clarify the expected behavior and implement the smallest safe change." },
          { text: "Identify the target module, reproduce the issue, then make and verify a focused fix." }
        ]
      }) })
    })
    vi.mocked(ProviderClient).mockImplementation(function () {
      return { stream }
    } as any)
    const modelBase = { label: "m", contextWindow: 128000, supportsTools: false, supportsVision: false, supportsThinking: false }
    const disabledOnlyProvider = {
      id: "disabled-only",
      name: "Disabled Only",
      kind: "openai-compatible",
      baseUrl: "https://example.com",
      apiKey: "sk-test",
      enabled: true,
      builtIn: false,
      capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: "off", level: "medium" },
      models: [{ ...modelBase, id: "disabled-model", enabled: false }]
    }
    const usableProvider = {
      ...disabledOnlyProvider,
      id: "usable",
      name: "Usable",
      models: [
        { ...modelBase, id: "first-disabled", enabled: false },
        { ...modelBase, id: "second-enabled" }
      ]
    }
    const providerMgr = {
      getProvider: vi.fn(() => usableProvider),
      getEnabledProviders: vi.fn(() => [disabledOnlyProvider, usableProvider])
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    await expect(electronMock.handlers.get("ai:promptCandidates")?.({}, {
      origin: "quick-complete:prompt-enhancer",
      prompt: "Make it better",
      draftHash: "sha256-draft"
    })).resolves.toMatchObject({ draftHash: "sha256-draft" })

    expect(vi.mocked(ProviderClient).mock.calls[0]?.[0]?.id).toBe("usable")
    expect(vi.mocked(ProviderClient).mock.calls[0]?.[1]?.id).toBe("second-enabled")
  })

  it("returns an explicit error instead of a fabricated model when no enabled model exists", async () => {
    const provider = {
      id: "deepseek",
      name: "DeepSeek",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      enabled: true,
      builtIn: false,
      capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: "off", level: "medium" },
      models: [{ id: "deepseek-chat", label: "DeepSeek Chat", contextWindow: 128000, supportsTools: false, supportsVision: false, supportsThinking: false, enabled: false }]
    }
    const providerMgr = {
      getProvider: vi.fn(() => provider),
      getEnabledProviders: vi.fn(() => [provider])
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    await expect(electronMock.handlers.get("ai:promptCandidates")?.({}, {
      origin: "quick-complete:prompt-enhancer",
      prompt: "Make it better",
      draftHash: "sha256-draft"
    })).resolves.toEqual({
      candidates: [],
      draftHash: "sha256-draft",
      error: "No enabled provider model is available for prompt candidates"
    })
    expect(ProviderClient).not.toHaveBeenCalled()
  })

  it("injects registered workspace context for requirements AI provider calls", async () => {
    tempRoot = join(tmpdir(), `agenthub-quick-${Date.now()}`)
    mkdirSync(tempRoot, { recursive: true })
    writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ name: "quick-context-app" }))
    workspaceMock.workspaces = [{ id: "ws-1", name: "Quick Context", rootPath: tempRoot, createdAt: 1, updatedAt: 1 }]
    const stream = vi.fn(async (options: any, callbacks: any) => {
      callbacks.onDone?.({ content: "done" })
    })
    vi.mocked(ProviderClient).mockImplementation(function () {
      return { stream }
    } as any)
    const provider = {
      id: "deepseek",
      name: "DeepSeek",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      enabled: true,
      builtIn: false,
      capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: "off", level: "medium" },
      models: [{ id: "deepseek-chat", label: "DeepSeek Chat", contextWindow: 128000, supportsTools: false, supportsVision: false, supportsThinking: false }]
    }
    const providerMgr = {
      getProvider: vi.fn(() => provider),
      getEnabledProviders: vi.fn(() => [provider])
    }
    const promptPreparationService: any = {
      prepareRoot: vi.fn(async (input: any) => ({
        kind: 'ready',
        envelope: {
          envelopeId: 'quick-envelope',
          rootInputId: 'quick-root-input',
          preparedTextHash: 'quick-prepared-hash',
          origin: input.origin,
          policy: 'structured',
          effectivePrompt: input.prompt
        }
      }))
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null,
      promptPreparationService
    })

    await expect(electronMock.handlers.get("ai:quickComplete")?.({}, {
      origin: "quick-complete:sdd-requirements",
      prompt: "Use the requirement document",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      workspaceRoot: tempRoot
    })).resolves.toEqual({ ok: true, content: "done" })

    expect(stream).toHaveBeenCalledTimes(1)
    const options = stream.mock.calls[0][0]
    const prompt = options.messages[0].content
    expect(prompt).toContain("[AgentHub Workspace Context]")
    expect(prompt).toContain("Quick Context")
    expect(prompt).toContain("package.json")
    expect(prompt).toContain("Use the requirement document")
    expect(options.dispatchEnvelope).toMatchObject({
      origin: "quick-complete:sdd-requirements",
      policy: "structured",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      rootInputId: 'quick-root-input',
      rootEnvelopeId: 'quick-envelope',
      rootPreparedTextHash: 'quick-prepared-hash'
    })
    expect(promptPreparationService.prepareRoot).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'quick-complete:sdd-requirements',
      prompt: 'Use the requirement document'
    }))
    expect(auditMock.append).toHaveBeenCalledWith("dispatch:prepared", expect.objectContaining({
      dispatchId: options.dispatchEnvelope.dispatchId,
      providerId: "deepseek",
      modelId: "deepseek-chat",
      canonicalPayloadHash: expect.any(String),
      origin: "quick-complete:sdd-requirements",
      policy: "structured",
      rootInputId: 'quick-root-input',
      rootEnvelopeId: 'quick-envelope',
      rootPreparedTextHash: 'quick-prepared-hash',
      parentDispatchId: undefined
    }))
    const auditPayload = auditMock.append.mock.calls[0][1]
    expect(auditPayload).not.toHaveProperty("messages")
    expect(auditPayload).not.toHaveProperty("prompt")
    expect(auditPayload).not.toHaveProperty("apiKey")
  })
})
