export interface SddAssistantHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  mode?: 'chat' | 'plan' | 'verify'
}

const STORAGE_KEY_PREFIX = 'sdd-assistant-history-'
const MAX_MESSAGES = 100
const MAX_CONTENT_LENGTH = 12000

function normalizeWorkspaceRoot(workspaceRoot?: string): string {
  return (workspaceRoot || '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function historyKey(draftId: string, workspaceRoot?: string): string {
  const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedRoot) return `${STORAGE_KEY_PREFIX}${draftId}`
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(normalizedRoot)}::${draftId}`
}

function normalizeMessage(message: Partial<SddAssistantHistoryMessage>): SddAssistantHistoryMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  if (typeof message.content !== 'string' || !message.content.trim()) return null
  return {
    id: typeof message.id === 'string' && message.id ? message.id : `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: message.role,
    content: message.content.slice(0, MAX_CONTENT_LENGTH),
    timestamp: typeof message.timestamp === 'string' && message.timestamp ? message.timestamp : new Date().toISOString(),
    // Restored history is conversational context only. Plan/verify/writeback actions
    // depend on live snapshot data and must not be resurrected from storage.
    mode: message.mode === 'chat' ? 'chat' : undefined
  }
}

function normalizeMessages(messages: Partial<SddAssistantHistoryMessage>[]): SddAssistantHistoryMessage[] {
  return messages
    .map(normalizeMessage)
    .filter((message): message is SddAssistantHistoryMessage => !!message)
    .slice(-MAX_MESSAGES)
}

export function getAssistantHistory(draftId: string, workspaceRoot?: string): SddAssistantHistoryMessage[] {
  try {
    const raw = localStorage.getItem(historyKey(draftId, workspaceRoot))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeMessages(parsed)
  } catch {
    return []
  }
}

export function saveAssistantHistory(
  draftId: string,
  workspaceRoot: string | undefined,
  messages: Partial<SddAssistantHistoryMessage>[]
): void {
  try {
    localStorage.setItem(historyKey(draftId, workspaceRoot), JSON.stringify(normalizeMessages(messages)))
  } catch {
    // localStorage can fail in private mode or when quota is exceeded. Chat should still work in memory.
  }
}
