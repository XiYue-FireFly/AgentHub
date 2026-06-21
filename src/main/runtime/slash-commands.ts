/**
 * Slash Command Builder: manage custom slash commands.
 *
 * Slash commands are user-created quick actions accessible via / in the
 * Composer. Each command has a shortcut (e.g. "/review"), a prompt template,
 * and optional parameters. Built on top of prompt-library's isSlashCommand
 * feature with additional validation and conflict detection.
 */

import { getSlashCommands, upsertPrompt, deletePrompt, type PromptEntry } from './prompt-library'

export interface SlashCommand {
  shortcut: string
  name: string
  body: string
  category: string
  /** Extracted {{param}} placeholders from the body */
  params: string[]
  /** Whether this is a built-in system command */
  system: boolean
}

/** Extract {{param}} placeholders from a prompt body. */
export function extractParams(body: string): string[] {
  const matches = body.match(/\{\{(\w+)\}\}/g) || []
  return [...new Set(matches.map(m => m.slice(2, -2)))]
}

/** Build the slash command list from prompt-library entries. */
export function listSlashCommands(): SlashCommand[] {
  const prompts = getSlashCommands()
  return prompts
    .filter(p => p.shortcut?.startsWith('/'))
    .map(p => ({
      shortcut: p.shortcut!,
      name: p.name,
      body: p.body,
      category: p.category,
      params: extractParams(p.body),
      system: false
    }))
    .sort((a, b) => a.shortcut.localeCompare(b.shortcut))
}

/** Get a specific slash command by shortcut. */
export function getSlashCommand(shortcut: string): SlashCommand | null {
  return listSlashCommands().find(cmd => cmd.shortcut === shortcut) || null
}

/** Validate a slash command shortcut format. */
export function validateShortcut(shortcut: string): { valid: boolean; error?: string } {
  if (!shortcut.startsWith('/')) return { valid: false, error: 'Shortcut must start with /' }
  if (shortcut.length < 2) return { valid: false, error: 'Shortcut must have at least one character after /' }
  if (shortcut.length > 32) return { valid: false, error: 'Shortcut too long (max 32 chars)' }
  if (!/^\/[a-z0-9_-]+$/i.test(shortcut)) return { valid: false, error: 'Shortcut can only contain letters, numbers, hyphens, and underscores' }
  return { valid: true }
}

/** Check if a shortcut conflicts with existing commands. */
export function checkConflict(shortcut: string, excludeId?: string): { conflict: boolean; conflictingName?: string } {
  const commands = listSlashCommands()
  const existing = commands.find(cmd => cmd.shortcut === shortcut)
  if (existing) return { conflict: true, conflictingName: existing.name }
  return { conflict: false }
}

/** Create or update a slash command. */
export function saveSlashCommand(input: {
  id?: string
  shortcut: string
  name: string
  body: string
  category?: string
}): { ok: boolean; command?: SlashCommand; error?: string } {
  const validation = validateShortcut(input.shortcut)
  if (!validation.valid) return { ok: false, error: validation.error }

  const conflict = checkConflict(input.shortcut, input.id)
  if (conflict.conflict) return { ok: false, error: `Conflicts with "${conflict.conflictingName}"` }

  if (!input.name.trim()) return { ok: false, error: 'Name is required' }
  if (!input.body.trim()) return { ok: false, error: 'Body is required' }

  const prompt = upsertPrompt({
    id: input.id,
    name: input.name,
    body: input.body,
    category: (input.category as any) || 'custom',
    isSlashCommand: true,
    shortcut: input.shortcut,
    tags: ['slash-command']
  })

  return {
    ok: true,
    command: {
      shortcut: prompt.shortcut!,
      name: prompt.name,
      body: prompt.body,
      category: prompt.category,
      params: extractParams(prompt.body),
      system: false
    }
  }
}

/** Delete a slash command by its shortcut. */
export function deleteSlashCommand(shortcut: string): boolean {
  const commands = listSlashCommands()
  const cmd = commands.find(c => c.shortcut === shortcut)
  if (!cmd) return false
  // Find the prompt by shortcut and delete
  const prompts = getSlashCommands()
  const prompt = prompts.find(p => p.shortcut === shortcut)
  if (!prompt) return false
  return deletePrompt(prompt.id)
}

/** Resolve a slash command's body by substituting parameters. */
export function resolveSlashCommand(shortcut: string, params: Record<string, string>): { ok: boolean; body?: string; error?: string } {
  const cmd = getSlashCommand(shortcut)
  if (!cmd) return { ok: false, error: `Unknown command: ${shortcut}` }
  let body = cmd.body
  for (const [key, value] of Object.entries(params)) {
    body = body.replaceAll(`{{${key}}}`, value)
  }
  return { ok: true, body }
}
