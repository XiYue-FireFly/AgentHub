import { ipcMain, app } from 'electron'
import { normalize, resolve } from 'path'
import { formatAsMarkdown, formatAsHtml, exportConversation } from '../runtime/conversation-export'
import { importConversationFromFile, importConversationFromJson, branchFromCheckpoint, summarizeConversation } from '../runtime/conversation-import'

export function registerConversationIpc(): void {
  ipcMain.handle("conversation:exportMarkdown", (_e, data: any) => formatAsMarkdown(data))
  ipcMain.handle("conversation:exportHtml", (_e, data: any) => formatAsHtml(data))
  ipcMain.handle("conversation:exportFile", (_e, data: any, format: string, path: string) => {
    // Check for traversal BEFORE normalization (normalize strips '..' making post-check useless)
    if (path.includes('..')) throw new Error('Invalid path: traversal not allowed')
    const normalized = resolve(normalize(path))
    // Ensure the resolved path is within user-accessible directories
    const home = app.getPath('home')
    if (!normalized.startsWith(home)) throw new Error('Invalid path: must be within user directory')
    return exportConversation(data, format as any, normalized)
  })

  ipcMain.handle("conversation:importFile", (_e, filePath: string) => importConversationFromFile(filePath))
  ipcMain.handle("conversation:importJson", (_e, json: string) => importConversationFromJson(json))
  ipcMain.handle("conversation:branch", (_e, conversation: any, index: number) => branchFromCheckpoint(conversation, index))
  ipcMain.handle("conversation:summarize", (_e, conversation: any) => summarizeConversation(conversation))
}
