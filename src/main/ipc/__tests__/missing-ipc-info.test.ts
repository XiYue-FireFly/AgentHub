import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getPath: vi.fn((name: string) => `/${name}`)
}))

const localAgentStatusesMock = vi.hoisted(() => ({
  getCachedLocalAgentStatuses: vi.fn()
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

vi.mock("../../runtime/local-agents", () => ({
  getCachedLocalAgentStatuses: localAgentStatusesMock.getCachedLocalAgentStatuses
}))

function deps(proxy: any = null) {
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

describe("missing IPC info/discovery handlers", () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    localAgentStatusesMock.getCachedLocalAgentStatuses.mockReset()
    vi.resetModules()
  })

  it("returns proxy URL and running state", async () => {
    const proxy = {
      getUrl: vi.fn(() => "http://127.0.0.1:4321/v1"),
      isRunning: vi.fn(() => true)
    }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc(deps(proxy))

    const handler = electronMock.handlers.get("proxy:info")
    expect(handler).toBeTruthy()
    await expect(handler?.({})).resolves.toEqual({
      url: "http://127.0.0.1:4321/v1",
      running: true
    })
  })

  it("falls back when proxy or proxy methods are missing", async () => {
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc(deps({}))

    const handler = electronMock.handlers.get("proxy:info")
    expect(handler).toBeTruthy()
    await expect(handler?.({})).resolves.toEqual({
      url: "",
      running: false
    })
  })

  it("returns cached local agent statuses unchanged", async () => {
    const statuses = [
      {
        agentId: "codex",
        label: "Codex",
        installed: true,
        configured: true,
        loginState: "ready",
        candidates: [{ source: "terminal", label: "codex", path: "C:\\tools\\codex.exe" }],
        workspaceSession: "persistent"
      }
    ]
    localAgentStatusesMock.getCachedLocalAgentStatuses.mockReturnValue(statuses)

    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc(deps())

    const handler = electronMock.handlers.get("agents:locate")
    expect(handler).toBeTruthy()
    await expect(handler?.({})).resolves.toBe(statuses)
  })
})
