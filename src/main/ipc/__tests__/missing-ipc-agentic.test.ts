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

vi.mock("../../agentic/capabilities", () => ({
  getCapabilityMatrix: vi.fn(() => [])
}))

vi.mock("../../agentic/config", () => ({
  getAgenticConfig: vi.fn(() => ({
    getEnabled: vi.fn(() => []),
    setEnabled: vi.fn(() => []),
    getMode: vi.fn(() => "all"),
    setMode: vi.fn((mode: "all" | "selected") => mode)
  }))
}))

vi.mock("../../agentic/approval", () => ({
  getApprovalConfig: vi.fn(() => ({
    getConfig: vi.fn(() => ({ version: 1, preset: "auto", default: { write: "allow", exec: "allow" }, overrides: {} })),
    setPreset: vi.fn(() => ({ version: 1, preset: "auto", default: { write: "allow", exec: "allow" }, overrides: {} })),
    setDefault: vi.fn(() => ({ version: 1, preset: "custom", default: { write: "ask", exec: "allow" }, overrides: {} })),
    setOverride: vi.fn(() => ({ version: 1, preset: "custom", default: { write: "allow", exec: "allow" }, overrides: {} }))
  }))
}))

function deps(dispatcher: any) {
  return {
    dispatcher,
    runtimeStore: null,
    registry: null,
    providerMgr: null,
    proxy: null,
    hub: null,
    getMainWindow: () => null,
    memory: () => null
  }
}

describe("missing IPC agentic handlers", () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.resetModules()
  })

  it("resolves live approvals through the dispatcher and returns its result", async () => {
    const dispatcher = { resolveApproval: vi.fn(() => true) }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc(deps(dispatcher))

    const handler = electronMock.handlers.get("agentic:resolveApproval")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "approval-1", true)).resolves.toBe(true)
    expect(dispatcher.resolveApproval).toHaveBeenCalledWith("approval-1", true)
  })

  it("returns false when there is no live dispatcher", async () => {
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc(deps(null))

    const handler = electronMock.handlers.get("agentic:resolveApproval")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "approval-2", false)).resolves.toBe(false)
  })
})
