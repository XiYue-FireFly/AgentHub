import { ipcMain, app } from 'electron'
import { formatAsMarkdown, formatAsHtml, exportConversation } from '../runtime/conversation-export'
import { importConversationFromFile, importConversationFromJson, branchFromCheckpoint, summarizeConversation } from '../runtime/conversation-import'
import { resolvePathWithinAllowedBases } from './path-guards'

export function registerConversationIpc(): void {
  ipcMain.handle("conversation:exportMarkdown", (_e, data: any) => formatAsMarkdown(data))
  ipcMain.handle("conversation:exportHtml", (_e, data: any) => formatAsHtml(data))
  ipcMain.handle("conversation:exportFile", (_e, data: any, format: string, path: string) => {
    const home = app.getPath('home')
    const normalized = resolvePathWithinAllowedBases(path, home, [home])
    return exportConversation(data, format as any, normalized)
  })

  ipcMain.handle("conversation:importFile", (_e, filePath: string) => importConversationFromFile(filePath))
  ipcMain.handle("conversation:importJson", (_e, json: string) => importConversationFromJson(json))
  ipcMain.handle("conversation:branch", (_e, conversation: any, index: number) => branchFromCheckpoint(conversation, index))
  ipcMain.handle("conversation:summarize", (_e, conversation: any) => summarizeConversation(conversation))
}
