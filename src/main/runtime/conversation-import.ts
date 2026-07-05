/**
 * Conversation Import: import and replay historical conversations.
 *
 * Supports importing JSON export files with schema version validation
 * and automatic migration. Provides "branch from checkpoint" to continue
 * a conversation from any assistant message.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export interface ImportedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  agentId?: string
  timestamp?: string
  toolCalls?: Array<{ name: string; args?: string; result?: string }>
  thinking?: string
}

export interface ImportedConversation {
  version: number
  title: string
  exportedAt?: string
  messages: ImportedMessage[]
  metadata?: Record<string, unknown>
}

export interface ImportResult {
  ok: boolean
  conversation?: ImportedConversation
  messageCount?: number
  error?: string
  warnings?: string[]
}

/**
 * Import a conversation from a JSON file.
 */
export async function importConversationFromFile(filePath: string): Promise<ImportResult> {
  if (!existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` }
  try {
    const content = await readFile(filePath, 'utf-8')
    return importConversationFromJson(content)
  } catch (e: any) {
    return { ok: false, error: `Failed to read file: ${e?.message}` }
  }
}

/**
 * Import a conversation from a JSON string.
 */
export function importConversationFromJson(json: string): ImportResult {
  let raw: any
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Invalid JSON' }
  }
  return validateAndMigrate(raw)
}

/**
 * Validate and migrate imported data to current schema.
 */
function validateAndMigrate(raw: any): ImportResult {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid data: not an object' }

  // Handle version 0 (legacy) — no version field
  if (!raw.version) {
    warnings.push('Legacy format (no version), migrated to v1')
    raw.version = 1
  }

  if (raw.version !== 1) return { ok: false, error: `Unsupported version: ${raw.version}` }

  if (!Array.isArray(raw.messages)) return { ok: false, error: 'Missing or invalid messages array' }

  const messages: ImportedMessage[] = raw.messages
    .filter((m: any) => m && typeof m === 'object' && m.role && typeof m.content === 'string')
    .map((m: any) => ({
      role: ['user', 'assistant', 'system', 'tool'].includes(m.role) ? m.role : 'user',
      content: String(m.content || ''),
      agentId: m.agentId ? String(m.agentId) : undefined,
      timestamp: m.timestamp ? String(m.timestamp) : undefined,
      toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls.map((tc: any) => ({
        name: String(tc.name || 'unknown'),
        args: tc.args ? String(tc.args) : undefined,
        result: tc.result ? String(tc.result) : undefined
      })) : undefined,
      thinking: m.thinking ? String(m.thinking) : undefined
    }))

  if (messages.length === 0) return { ok: false, error: 'No valid messages found' }
  if (messages.length < raw.messages.length) {
    warnings.push(`${raw.messages.length - messages.length} invalid messages skipped`)
  }

  return {
    ok: true,
    conversation: {
      version: 1,
      title: String(raw.title || 'Imported conversation'),
      exportedAt: raw.exportedAt || undefined,
      messages,
      metadata: normalizeMetadata(raw.metadata)
    },
    messageCount: messages.length,
    warnings: warnings.length ? warnings : undefined
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Create a branch point from an assistant message at the given index.
 * Returns all messages up to and including the checkpoint.
 */
export function branchFromCheckpoint(
  conversation: ImportedConversation,
  messageIndex: number
): { ok: boolean; messages?: ImportedMessage[]; error?: string } {
  if (messageIndex < 0 || messageIndex >= conversation.messages.length) {
    return { ok: false, error: `Invalid message index: ${messageIndex}` }
  }
  const checkpoint = conversation.messages[messageIndex]
  if (checkpoint.role !== 'assistant') {
    return { ok: false, error: 'Checkpoint must be an assistant message' }
  }
  return { ok: true, messages: conversation.messages.slice(0, messageIndex + 1) }
}

/**
 * Extract a summary of the conversation for display.
 */
export function summarizeConversation(conversation: ImportedConversation): {
  title: string
  messageCount: number
  userMessages: number
  assistantMessages: number
  agentIds: string[]
  firstMessage: string
  lastMessage: string
} {
  const msgs = conversation.messages
  return {
    title: conversation.title,
    messageCount: msgs.length,
    userMessages: msgs.filter(m => m.role === 'user').length,
    assistantMessages: msgs.filter(m => m.role === 'assistant').length,
    agentIds: [...new Set(msgs.filter(m => m.agentId).map(m => m.agentId!))],
    firstMessage: msgs[0]?.content?.slice(0, 100) || '',
    lastMessage: msgs[msgs.length - 1]?.content?.slice(0, 100) || ''
  }
}
