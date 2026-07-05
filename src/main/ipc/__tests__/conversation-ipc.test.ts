import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  home: `${process.cwd()}\\tmp-home`
}))

const exportMock = vi.hoisted(() => ({
  formatAsMarkdown: vi.fn(() => '# Export'),
  formatAsHtml: vi.fn(() => '<html></html>'),
  exportConversation: vi.fn((_data: unknown, _format: string, outputPath: string) => ({ ok: true, path: outputPath }))
}))

const importMock = vi.hoisted(() => ({
  importConversationFromFile: vi.fn(),
  importConversationFromJson: vi.fn(() => ({ ok: true, messageCount: 1 })),
  branchFromCheckpoint: vi.fn(() => ({ ok: true, messages: [] })),
  summarizeConversation: vi.fn(() => ({
    title: 'Imported',
    messageCount: 1,
    userMessages: 1,
    assistantMessages: 0,
    agentIds: [],
    firstMessage: 'hello',
    lastMessage: 'hello'
  }))
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
  formatAsMarkdown: exportMock.formatAsMarkdown,
  formatAsHtml: exportMock.formatAsHtml,
  exportConversation: exportMock.exportConversation
}))

vi.mock('../../runtime/conversation-import', () => ({
  importConversationFromFile: importMock.importConversationFromFile,
  importConversationFromJson: importMock.importConversationFromJson,
  branchFromCheckpoint: importMock.branchFromCheckpoint,
  summarizeConversation: importMock.summarizeConversation
}))

describe('conversation IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    exportMock.formatAsMarkdown.mockClear()
    exportMock.formatAsHtml.mockClear()
    exportMock.exportConversation.mockClear()
    importMock.importConversationFromFile.mockClear()
    importMock.importConversationFromJson.mockClear()
    importMock.branchFromCheckpoint.mockClear()
    importMock.summarizeConversation.mockClear()
    vi.resetModules()
  })

  const exportData = {
    version: 1,
    title: 'Session',
    exportedAt: '2026-07-05T00:00:00.000Z',
    messages: [{ role: 'user', content: 'hello', attachments: [{ name: 'note.txt', kind: 'text' }] }],
    metadata: { workspaceId: 'ws-1', agentIds: ['codex'], turnCount: 1 }
  }

  const importedConversation = {
    version: 1,
    title: 'Imported',
    messages: [{ role: 'assistant', content: 'done', agentId: 'codex' }]
  }

  it('validates conversation export/import payloads before side effects', async () => {
    const { registerConversationIpc } = await import('../conversation-ipc')
    registerConversationIpc()

    expect(() => electronMock.handlers.get('conversation:exportMarkdown')?.({}, {
      ...exportData,
      messages: [{ role: 'alien', content: 'hello' }]
    })).toThrow(new IpcPayloadValidationError('conversation:exportMarkdown', 'data.messages[0].role must be one of: user, assistant, system, tool'))
    expect(() => electronMock.handlers.get('conversation:exportHtml')?.({}, {
      ...exportData,
      messages: [{ role: 'user', content: 42 }]
    })).toThrow(new IpcPayloadValidationError('conversation:exportHtml', 'data.messages[0].content must be a string'))
    expect(electronMock.handlers.get('conversation:importJson')?.({}, 42)).toEqual({
      ok: false,
      error: 'Invalid IPC payload: json must be a string'
    })
    expect(() => electronMock.handlers.get('conversation:branch')?.({}, importedConversation, -1)).toThrow(
      new IpcPayloadValidationError('conversation:branch', 'index must be at least 0')
    )
    expect(() => electronMock.handlers.get('conversation:summarize')?.({}, {
      ...importedConversation,
      messages: [{ role: 'assistant', content: null }]
    })).toThrow(new IpcPayloadValidationError('conversation:summarize', 'conversation.messages[0].content must be a string'))

    expect(exportMock.formatAsMarkdown).not.toHaveBeenCalled()
    expect(exportMock.formatAsHtml).not.toHaveBeenCalled()
    expect(importMock.importConversationFromJson).not.toHaveBeenCalled()
    expect(importMock.branchFromCheckpoint).not.toHaveBeenCalled()
    expect(importMock.summarizeConversation).not.toHaveBeenCalled()
  })

  it('passes valid conversation payloads through unchanged', async () => {
    const { registerConversationIpc } = await import('../conversation-ipc')
    registerConversationIpc()

    expect(electronMock.handlers.get('conversation:exportMarkdown')?.({}, exportData)).toBe('# Export')
    expect(electronMock.handlers.get('conversation:exportHtml')?.({}, exportData)).toBe('<html></html>')
    expect(electronMock.handlers.get('conversation:importJson')?.({}, JSON.stringify(exportData))).toEqual({ ok: true, messageCount: 1 })
    expect(electronMock.handlers.get('conversation:branch')?.({}, importedConversation, 0)).toEqual({ ok: true, messages: [] })
    expect(electronMock.handlers.get('conversation:summarize')?.({}, importedConversation)).toMatchObject({ title: 'Imported' })

    expect(exportMock.formatAsMarkdown).toHaveBeenCalledWith(exportData)
    expect(exportMock.formatAsHtml).toHaveBeenCalledWith(exportData)
    expect(importMock.importConversationFromJson).toHaveBeenCalledWith(JSON.stringify(exportData))
    expect(importMock.branchFromCheckpoint).toHaveBeenCalledWith(importedConversation, 0)
    expect(importMock.summarizeConversation).toHaveBeenCalledWith(importedConversation)
  })

  it('allows export filenames that contain two dots under the user home', async () => {
    const { registerConversationIpc } = await import('../conversation-ipc')
    registerConversationIpc()

    const handler = electronMock.handlers.get('conversation:exportFile')
    expect(handler).toBeTruthy()

    const target = resolve(electronMock.home, 'project..demo.md')
    const result = await Promise.resolve(handler?.({}, { messages: [] }, 'markdown', target))
    expect(result).toEqual({ ok: true, path: target })
    expect(exportMock.exportConversation).toHaveBeenCalledWith({ messages: [] }, 'markdown', target)
  })

  it('rejects exports outside the user home', async () => {
    const { registerConversationIpc } = await import('../conversation-ipc')
    registerConversationIpc()

    const handler = electronMock.handlers.get('conversation:exportFile')
    expect(() => handler?.({}, {}, 'markdown', resolve(electronMock.home, '..', 'secret.md'))).toThrow('Access denied')
  })
})
