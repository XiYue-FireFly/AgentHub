import { beforeEach, describe, expect, it, vi } from "vitest"
import { IpcPayloadValidationError } from "../../../shared/ipc-contract"

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn((name: string) => `/${name}`)
}))

const takeoverMock = vi.hoisted(() => ({
  takeoverStatus: vi.fn(),
  takeoverApply: vi.fn(),
  takeoverRestore: vi.fn()
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
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

vi.mock("../../routing/takeover", () => ({
  takeoverStatus: takeoverMock.takeoverStatus,
  takeoverApply: takeoverMock.takeoverApply,
  takeoverRestore: takeoverMock.takeoverRestore
}))

const state = {
  supported: true,
  configPath: "/config",
  configExists: true,
  takenOver: false,
  model: null,
  current: null
}

function deps(proxy: unknown = null) {
  return {
    dispatcher: null,
    runtimeStore: null,
    registry: null,
    providerMgr: null,
    proxy,
    hub: null,
    getMainWindow: () => null,
    memory: () => null
  }
}

async function register(proxy: unknown = null) {
  const { registerMissingIpc } = await import("../missing-ipc")
  registerMissingIpc(deps(proxy))
}

describe("missing IPC takeover handlers", () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    takeoverMock.takeoverStatus.mockReset()
    takeoverMock.takeoverApply.mockReset()
    takeoverMock.takeoverRestore.mockReset()
    vi.resetModules()
  })

  it("returns fixed takeover status keys on success", async () => {
    const status = {
      codex: { ...state, configPath: "/codex" },
      claude: { ...state, configPath: "/claude" },
      hermes: { ...state, configPath: "/hermes" },
      openclaw: { ...state, configPath: "/openclaw" }
    }
    takeoverMock.takeoverStatus.mockReturnValue(status)
    await register()

    const handler = electronMock.handlers.get("takeover:status")
    expect(handler).toBeTruthy()
    await expect(handler?.({})).resolves.toEqual(status)
    expect(Object.keys(await handler?.({}) as object)).toEqual(["codex", "claude", "hermes", "openclaw"])
  })

  it("returns plain error object for takeover status failures", async () => {
    takeoverMock.takeoverStatus.mockImplementation(() => {
      throw new Error("status failed")
    })
    await register()

    const handler = electronMock.handlers.get("takeover:status")
    expect(handler).toBeTruthy()
    await expect(handler?.({})).resolves.toEqual({ error: "status failed" })
  })

  it("returns ok false when applying while proxy is stopped", async () => {
    const proxy = {
      getUrl: vi.fn(() => "http://127.0.0.1:4321/v1"),
      isRunning: vi.fn(() => false)
    }
    await register(proxy)

    const handler = electronMock.handlers.get("takeover:apply")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "codex", "openai/gpt-4")).resolves.toEqual({
      ok: false,
      error: "Proxy is not running. Start the proxy first."
    })
    expect(takeoverMock.takeoverApply).not.toHaveBeenCalled()
  })

  it("rejects invalid takeover payloads before side effects", async () => {
    const proxy = {
      getUrl: vi.fn(() => "http://127.0.0.1:4321/v1"),
      isRunning: vi.fn(() => true)
    }
    await register(proxy)

    expect(() => electronMock.handlers.get("takeover:status")?.({}, "extra")).toThrow(
      new IpcPayloadValidationError("takeover:status", "expected no arguments")
    )
    expect(() => electronMock.handlers.get("takeover:apply")?.({}, "minimax-code", "openai/gpt-4")).toThrow(
      new IpcPayloadValidationError("takeover:apply", "app must be one of: codex, claude, hermes, openclaw")
    )
    expect(() => electronMock.handlers.get("takeover:apply")?.({}, "codex", "")).toThrow(
      new IpcPayloadValidationError("takeover:apply", "modelRef must not be empty")
    )
    expect(() => electronMock.handlers.get("takeover:restore")?.({}, "opencode")).toThrow(
      new IpcPayloadValidationError("takeover:restore", "app must be one of: codex, claude, hermes, openclaw")
    )

    expect(takeoverMock.takeoverStatus).not.toHaveBeenCalled()
    expect(takeoverMock.takeoverApply).not.toHaveBeenCalled()
    expect(takeoverMock.takeoverRestore).not.toHaveBeenCalled()
  })

  it("applies with proxy URL and stripped proxy origin when proxy is running", async () => {
    const applied = { ...state, takenOver: true, model: "openai/gpt-4" }
    takeoverMock.takeoverApply.mockReturnValue(applied)
    const proxy = {
      getUrl: vi.fn(() => "http://127.0.0.1:4321/v1"),
      isRunning: vi.fn(() => true)
    }
    await register(proxy)

    const handler = electronMock.handlers.get("takeover:apply")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "claude", "openai/gpt-4")).resolves.toEqual(applied)
    expect(takeoverMock.takeoverApply).toHaveBeenCalledWith(
      "claude",
      "openai/gpt-4",
      "http://127.0.0.1:4321/v1",
      "http://127.0.0.1:4321"
    )
  })

  it("returns ok false when takeover apply throws", async () => {
    takeoverMock.takeoverApply.mockImplementation(() => {
      throw new Error("apply failed")
    })
    const proxy = {
      getUrl: vi.fn(() => "http://127.0.0.1:4321/v1"),
      isRunning: vi.fn(() => true)
    }
    await register(proxy)

    const handler = electronMock.handlers.get("takeover:apply")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "codex", "openai/gpt-4")).resolves.toEqual({ ok: false, error: "apply failed" })
  })

  it("returns restore state on success", async () => {
    const restored = { ...state, configPath: "/codex" }
    takeoverMock.takeoverRestore.mockReturnValue(restored)
    await register()

    const handler = electronMock.handlers.get("takeover:restore")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "codex")).resolves.toEqual(restored)
    expect(takeoverMock.takeoverRestore).toHaveBeenCalledWith("codex")
  })

  it("returns ok false when takeover restore throws", async () => {
    takeoverMock.takeoverRestore.mockImplementation(() => {
      throw new Error("restore failed")
    })
    await register()

    const handler = electronMock.handlers.get("takeover:restore")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "codex")).resolves.toEqual({ ok: false, error: "restore failed" })
  })
})
