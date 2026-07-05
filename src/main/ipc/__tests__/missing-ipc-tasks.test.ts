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

describe("missing IPC task handlers", () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.resetModules()
  })

  it("deletes task history from runtimeStore before legacy dispatcher cleanup", async () => {
    const runtimeStore = { deleteTask: vi.fn(() => true) }
    const dispatcher = { deleteTask: vi.fn() }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher,
      runtimeStore,
      registry: null,
      providerMgr: null,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    const handler = electronMock.handlers.get("tasks:delete")
    expect(handler).toBeTruthy()
    await expect(handler?.({}, "turn-1")).resolves.toBe(true)
    expect(runtimeStore.deleteTask).toHaveBeenCalledWith("turn-1")
    expect(dispatcher.deleteTask).toHaveBeenCalledWith("turn-1")
  })

  it("clears completed task history from runtimeStore and legacy dispatcher", async () => {
    const runtimeStore = { clearCompletedTasks: vi.fn(() => ["turn-1"]) }
    const dispatcher = { clearCompleted: vi.fn() }
    const { registerMissingIpc } = await import("../missing-ipc")
    registerMissingIpc({
      dispatcher,
      runtimeStore,
      registry: null,
      providerMgr: null,
      proxy: null,
      hub: null,
      getMainWindow: () => null,
      memory: () => null
    })

    const handler = electronMock.handlers.get("tasks:clearCompleted")
    expect(handler).toBeTruthy()
    await expect(handler?.({})).resolves.toBe(true)
    expect(runtimeStore.clearCompletedTasks).toHaveBeenCalled()
    expect(dispatcher.clearCompleted).toHaveBeenCalled()
  })
})
