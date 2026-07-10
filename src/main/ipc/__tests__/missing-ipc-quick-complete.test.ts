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
    vi.resetModules()
  })

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  })

  it.each([
    ["undefined input", undefined, "Invalid IPC payload: input must be an object"],
    ["null input", null, "Invalid IPC payload: input must be an object"],
    ["empty string", { prompt: "" }, "Invalid IPC payload: input.prompt must not be empty"],
    ["whitespace string", { prompt: "   " }, "Invalid IPC payload: input.prompt must not be empty"],
    ["newline whitespace string", { prompt: "\n\t  \r\n" }, "Invalid IPC payload: input.prompt must not be empty"],
    ["non-string prompt", { prompt: 123 }, "Invalid IPC payload: input.prompt must be a string"]
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

    await expect(electronMock.handlers.get("ai:quickComplete")?.({}, {
      prompt: "Use the requirement document",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      workspaceRoot: tempRoot
    })).resolves.toEqual({ ok: true, content: "done" })

    expect(stream).toHaveBeenCalledTimes(1)
    const prompt = stream.mock.calls[0][0].messages[0].content
    expect(prompt).toContain("[AgentHub Workspace Context]")
    expect(prompt).toContain("Quick Context")
    expect(prompt).toContain("package.json")
    expect(prompt).toContain("Use the requirement document")
  })
})
