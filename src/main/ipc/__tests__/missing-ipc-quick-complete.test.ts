import { beforeEach, describe, expect, it, vi } from "vitest"

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
    vi.resetModules()
  })

  it("rejects empty prompts before selecting a provider", async () => {
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
    await expect(handler?.({}, { prompt: "   " })).resolves.toEqual({ ok: false, error: "empty prompt" })
    expect(providerMgr.getProvider).not.toHaveBeenCalled()
    expect(providerMgr.getEnabledProviders).not.toHaveBeenCalled()
  }, 15000)
})
