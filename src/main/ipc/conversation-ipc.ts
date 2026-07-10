import { app } from 'electron'
import { formatAsMarkdown, formatAsHtml, exportConversation } from '../runtime/conversation-export'
import { importConversationFromFile, importConversationFromJson, branchFromCheckpoint, summarizeConversation } from '../runtime/conversation-import'
import { resolvePathWithinAllowedBases } from './path-guards'
import { typedHandle } from './typed-ipc'

export function registerConversationIpc(): void {
  typedHandle("conversation:exportMarkdown", (_e, data) => formatAsMarkdown(data))
  typedHandle("conversation:exportHtml", (_e, data) => formatAsHtml(data))
  typedHandle("conversation:exportFile", (_e, data, format, path) => {
    const home = app.getPath('home')
    const normalized = resolvePathWithinAllowedBases(path, home, [home])
    return exportConversation(data, format, normalized)
  })

  typedHandle("conversation:importFile", (_e, filePath) => {
    const home = app.getPath('home')
    const normalized = resolvePathWithinAllowedBases(filePath, home, [home])
    return importConversationFromFile(normalized)
  })
  typedHandle("conversation:importJson", (_e, json) => importConversationFromJson(json))
  typedHandle("conversation:branch", (_e, conversation, index) => branchFromCheckpoint(conversation, index))
  typedHandle("conversation:summarize", (_e, conversation) => summarizeConversation(conversation))
}
