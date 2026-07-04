import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  home: `${process.cwd()}\\tmp-home`
}))

const exportMock = vi.hoisted(() => ({
  exportConversation: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  app: {
    getPath: vi.fn((name: string) => name === 'home' ? electronMock.home : resolve(process.cwd(), name))
  }
}))

vi.mock('../../runtime/conversation-export', () => ({
  formatAsMarkdown: vi.fn(),
  formatAsHtml: vi.fn(),
  exportConversation: exportMock.exportConversation
}))

vi.mock('../../runtime/conversation-import', () => ({
  importConversationFromFile: vi.fn(),
  importConversationFromJson: vi.fn(),
  branchFromCheckpoint: vi.fn(),
  summarizeConversation: vi.fn()
}))

describe('conversation IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    exportMock.exportConversation.mockClear()
    vi.resetModules()
  })

  it('allows export filenames that contain two dots under the user home', async () => {
    const { registerConversationIpc } = await import('../conversation-ipc')
    registerConversationIpc()

    const handler = electronMock.handlers.get('conversation:exportFile')
    expect(handler).toBeTruthy()

    const target = resolve(electronMock.home, 'project..demo.md')
    expect(handler?.({}, { messages: [] }, 'markdown', target)).toBe(true)
    expect(exportMock.exportConversation).toHaveBeenCalledWith({ messages: [] }, 'markdown', target)
  })

  it('rejects exports outside the user home', async () => {
    const { registerConversationIpc } = await import('../conversation-ipc')
    registerConversationIpc()

    const handler = electronMock.handlers.get('conversation:exportFile')
    expect(() => handler?.({}, {}, 'markdown', resolve(electronMock.home, '..', 'secret.md'))).toThrow('Access denied')
  })
})
