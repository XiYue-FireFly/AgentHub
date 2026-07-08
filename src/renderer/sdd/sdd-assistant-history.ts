export interface SddAssistantHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  mode?: 'chat' | 'plan' | 'verify'
}

export interface SddAssistantHistorySession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: SddAssistantHistoryMessage[]
}

export interface SddAssistantHistoryState {
  activeSessionId: string
  sessions: SddAssistantHistorySession[]
}

const LEGACY_STORAGE_KEY_PREFIX = 'sdd-assistant-history-'
const STORAGE_KEY_PREFIX = 'sdd-assistant-history-v2-'
const MAX_MESSAGES = 100
const MAX_CONTENT_LENGTH = 12000
const MAX_SESSIONS = 50

function normalizeWorkspaceRoot(workspaceRoot?: string): string {
  return (workspaceRoot || '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function scopedKey(prefix: string, draftId: string, workspaceRoot?: string): string {
  const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedRoot) return `${prefix}${draftId}`
  return `${prefix}${encodeURIComponent(normalizedRoot)}::${draftId}`
}

function historyKey(draftId: string, workspaceRoot?: string): string {
  return scopedKey(STORAGE_KEY_PREFIX, draftId, workspaceRoot)
}

function legacyHistoryKey(draftId: string, workspaceRoot?: string): string {
  return scopedKey(LEGACY_STORAGE_KEY_PREFIX, draftId, workspaceRoot)
}

function createId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch {
    // Fall back to a timestamp id below.
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function normalizeMessage(message: Partial<SddAssistantHistoryMessage>): SddAssistantHistoryMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  if (typeof message.content !== 'string' || !message.content.trim()) return null
  return {
    id: typeof message.id === 'string' && message.id ? message.id : createId('hist-msg'),
    role: message.role,
    content: message.content.slice(0, MAX_CONTENT_LENGTH),
    timestamp: isValidDateString(message.timestamp) ? message.timestamp : new Date().toISOString(),
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

function titleFromMessages(messages: SddAssistantHistoryMessage[]): string {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim())
  if (!firstUserMessage) return 'New chat'
  const compact = firstUserMessage.content.replace(/\s+/g, ' ').trim()
  return `Chat: ${compact.slice(0, 56)}${compact.length > 56 ? '...' : ''}`
}

function latestMessageTimestamp(messages: SddAssistantHistoryMessage[], fallback: string): string {
  const latest = messages
    .map(message => message.timestamp)
    .filter(isValidDateString)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
  return latest ?? fallback
}

function normalizeSession(session: Partial<SddAssistantHistorySession>): SddAssistantHistorySession | null {
  const now = new Date().toISOString()
  const messages = Array.isArray(session.messages) ? normalizeMessages(session.messages) : []
  const createdAt = isValidDateString(session.createdAt)
    ? session.createdAt
    : messages[0]?.timestamp ?? now
  const updatedAt = isValidDateString(session.updatedAt)
    ? session.updatedAt
    : latestMessageTimestamp(messages, createdAt)
  const title = typeof session.title === 'string' && session.title.trim()
    ? session.title.trim().slice(0, 80)
    : titleFromMessages(messages)

  return {
    id: typeof session.id === 'string' && session.id ? session.id : createId('hist-session'),
    title,
    createdAt,
    updatedAt,
    messages
  }
}

function emptySession(): SddAssistantHistorySession {
  const now = new Date().toISOString()
  return {
    id: createId('hist-session'),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}

function normalizeState(value: unknown): SddAssistantHistoryState {
  if (!value || typeof value !== 'object') {
    const session = emptySession()
    return { activeSessionId: session.id, sessions: [session] }
  }

  const record = value as Partial<SddAssistantHistoryState>
  const seenSessionIds = new Set<string>()
  const sessions = (Array.isArray(record.sessions) ? record.sessions : [])
    .map(normalizeSession)
    .filter((session): session is SddAssistantHistorySession => !!session)
    .filter(session => {
      if (seenSessionIds.has(session.id)) return false
      seenSessionIds.add(session.id)
      return true
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_SESSIONS)

  if (sessions.length === 0) {
    const session = emptySession()
    return { activeSessionId: session.id, sessions: [session] }
  }

  const activeSessionId = typeof record.activeSessionId === 'string' &&
    sessions.some(session => session.id === record.activeSessionId)
    ? record.activeSessionId
    : sessions[0].id

  return { activeSessionId, sessions }
}

function persistState(draftId: string, workspaceRoot: string | undefined, state: SddAssistantHistoryState): void {
  try {
    // Save state as-is without re-normalizing to preserve session ID associations
    localStorage.setItem(historyKey(draftId, workspaceRoot), JSON.stringify(state))
    const activeSession = state.sessions.find(session => session.id === state.activeSessionId)
    localStorage.setItem(legacyHistoryKey(draftId, workspaceRoot), JSON.stringify(activeSession?.messages ?? []))
  } catch {
    // localStorage can fail in private mode or when quota is exceeded. Chat should still work in memory.
  }
}

function migrateLegacyHistory(draftId: string, workspaceRoot?: string): SddAssistantHistoryState | null {
  try {
    const raw = localStorage.getItem(legacyHistoryKey(draftId, workspaceRoot))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const messages = normalizeMessages(parsed)
    if (messages.length === 0) return null
    const session: SddAssistantHistorySession = {
      id: createId('hist-session'),
      title: titleFromMessages(messages),
      createdAt: messages[0]?.timestamp ?? new Date().toISOString(),
      updatedAt: latestMessageTimestamp(messages, new Date().toISOString()),
      messages
    }
    const state = normalizeState({ activeSessionId: session.id, sessions: [session] })
    persistState(draftId, workspaceRoot, state)
    return state
  } catch {
    return null
  }
}

export function getAssistantHistoryState(draftId: string, workspaceRoot?: string): SddAssistantHistoryState {
  try {
    const raw = localStorage.getItem(historyKey(draftId, workspaceRoot))
    if (raw) return normalizeState(JSON.parse(raw))
  } catch {
    // Try legacy history before returning an empty state.
  }
  return migrateLegacyHistory(draftId, workspaceRoot) ?? normalizeState(null)
}

export function saveAssistantHistoryState(
  draftId: string,
  workspaceRoot: string | undefined,
  state: Partial<SddAssistantHistoryState>
): SddAssistantHistoryState {
  const normalized = normalizeState(state)
  persistState(draftId, workspaceRoot, normalized)
  return normalized
}

export function getAssistantHistory(
  draftId: string,
  workspaceRoot?: string,
  sessionId?: string
): SddAssistantHistoryMessage[] {
  const state = getAssistantHistoryState(draftId, workspaceRoot)
  const targetSession = state.sessions.find(session => session.id === (sessionId ?? state.activeSessionId))
  return targetSession?.messages ?? []
}

export function saveAssistantHistory(
  draftId: string,
  workspaceRoot: string | undefined,
  messages: Partial<SddAssistantHistoryMessage>[],
  sessionId?: string
): SddAssistantHistoryState {
  const state = getAssistantHistoryState(draftId, workspaceRoot)
  const targetSessionId = sessionId && state.sessions.some(session => session.id === sessionId)
    ? sessionId
    : state.activeSessionId
  const normalizedMessages = normalizeMessages(messages)
  const now = new Date().toISOString()
  const updatedSessions = state.sessions.map(session => {
    if (session.id !== targetSessionId) return session
    return {
      ...session,
      title: normalizedMessages.length > 0 ? titleFromMessages(normalizedMessages) : 'New chat',
      updatedAt: normalizedMessages.length > 0 ? latestMessageTimestamp(normalizedMessages, now) : now,
      messages: normalizedMessages
    }
  })

  return saveAssistantHistoryState(draftId, workspaceRoot, {
    activeSessionId: targetSessionId,
    sessions: updatedSessions
  })
}

export function createAssistantHistorySession(
  draftId: string,
  workspaceRoot?: string
): SddAssistantHistoryState {
  const state = getAssistantHistoryState(draftId, workspaceRoot)
  const activeSession = state.sessions.find(session => session.id === state.activeSessionId)
  if (activeSession && activeSession.messages.length === 0) {
    return saveAssistantHistoryState(draftId, workspaceRoot, state)
  }

  const session = emptySession()
  return saveAssistantHistoryState(draftId, workspaceRoot, {
    activeSessionId: session.id,
    sessions: [session, ...state.sessions].slice(0, MAX_SESSIONS)
  })
}

export function setActiveAssistantHistorySession(
  draftId: string,
  workspaceRoot: string | undefined,
  sessionId: string
): SddAssistantHistoryState {
  const state = getAssistantHistoryState(draftId, workspaceRoot)
  if (!state.sessions.some(session => session.id === sessionId)) return state
  return saveAssistantHistoryState(draftId, workspaceRoot, {
    ...state,
    activeSessionId: sessionId
  })
}
