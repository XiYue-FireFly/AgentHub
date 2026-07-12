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
    let releaseRuntime!: () => void
    const runtimeStore = {
      deleteTask: vi.fn(() => new Promise<boolean>(resolve => {
        releaseRuntime = () => resolve(true)
      }))
    }
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
    const operation = handler?.({}, "turn-1")
    await Promise.resolve()
    expect(dispatcher.deleteTask).not.toHaveBeenCalled()
    releaseRuntime()
    await expect(operation).resolves.toBe(true)
    expect(runtimeStore.deleteTask).toHaveBeenCalledWith("turn-1")
    expect(dispatcher.deleteTask).toHaveBeenCalledWith("turn-1")
  })

  it("clears completed task cards for the requested workspace from runtimeStore and legacy dispatcher", async () => {
    let releaseRuntime!: () => void
    const runtimeStore = {
      clearCompletedTasks: vi.fn(() => new Promise<string[]>(resolve => {
        releaseRuntime = () => resolve(["turn-1"])
      }))
    }
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
    const operation = handler?.({}, "ws-1")
    await Promise.resolve()
    expect(dispatcher.clearCompleted).not.toHaveBeenCalled()
    releaseRuntime()
    await expect(operation).resolves.toBe(true)
    expect(runtimeStore.clearCompletedTasks).toHaveBeenCalledWith("ws-1")
    expect(dispatcher.clearCompleted).toHaveBeenCalled()
  })
})
