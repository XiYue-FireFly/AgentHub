import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderClient } from "../../providers/client"

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getPath: vi.fn((name: string) => `/${name}`)
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

describe("missing IPC quick complete handler", () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.clearAllMocks()
    vi.resetModules()
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
})
