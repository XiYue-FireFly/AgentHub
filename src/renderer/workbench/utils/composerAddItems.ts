import type React from 'react'
import { IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'

export type ComposerAddItem = {
  id: string
  section: 'add' | 'plugins'
  kind: 'attachments' | 'goal' | 'schedule' | 'workspace' | 'plugin-skill' | 'plugin-prompt' | 'plugin-command'
  title: string
  detail: string
  icon: React.ReactNode
  token?: string
  pluginId?: string
  pluginName?: string
  path?: string
  body?: string
}

export function buildBaseAddItems(input: { hasWorkspace: boolean; hasAgents: boolean }): ComposerAddItem[] {
  const items: ComposerAddItem[] = [
    {
      id: 'add:attachments',
      section: 'add',
      kind: 'attachments',
      title: tr('Files and folders', 'Files and folders'),
      detail: tr('Attach local files or images to this turn', 'Attach local files or images to this turn'),
      icon: IC.file
    },
    {
      id: 'add:goal',
      section: 'add',
      kind: 'goal',
      title: tr('Goal', 'Goal'),
      detail: tr('Start a structured /goal request', 'Start a structured /goal request'),
      icon: IC.tasks
    }
  ]
  if (input.hasAgents) {
    items.push({
      id: 'add:smart-five-role',
      section: 'add',
      kind: 'schedule',
      title: tr('Smart five-role', 'Smart five-role'),
      detail: tr('Use router, reviewer, executor, and gatekeeper agents', 'Use router, reviewer, executor, and gatekeeper agents'),
      icon: IC.brain
    })
  }
  if (!input.hasWorkspace) {
    items.push({
      id: 'add:workspace',
      section: 'add',
      kind: 'workspace',
      title: tr('Working folder', 'Working folder'),
      detail: tr('Bind a project folder before sending', 'Bind a project folder before sending'),
      icon: IC.folder
    })
  }
  return items
}

export function buildPluginAddItems(plugins: any[], contributions: { commands?: any[]; skills?: any[]; prompts?: any[] }): ComposerAddItem[] {
  const pluginById = new Map<string, any>()
  for (const plugin of plugins || []) pluginById.set(plugin.id, plugin)
  const items: ComposerAddItem[] = []
  for (const skill of contributions.skills || []) {
    const plugin = pluginById.get(skill.pluginId)
    const pluginName = plugin?.manifest?.name || skill.pluginId || 'Plugin'
    const title = skill.id || 'skill'
    items.push({
      id: `plugin-skill:${skill.pluginId}:${skill.id}`,
      section: 'plugins',
      kind: 'plugin-skill',
      title,
      detail: `${pluginName} - Skill`,
      icon: IC.brain,
      token: pluginMentionToken(pluginName, title),
      pluginId: skill.pluginId,
      pluginName,
      path: skill.path,
      body: skill.content
    })
  }
  for (const prompt of contributions.prompts || []) {
    const plugin = pluginById.get(prompt.pluginId)
    const pluginName = plugin?.manifest?.name || prompt.pluginId || 'Plugin'
    const title = prompt.name || prompt.id || 'prompt'
    items.push({
      id: `plugin-prompt:${prompt.pluginId}:${prompt.id}`,
      section: 'plugins',
      kind: 'plugin-prompt',
      title,
      detail: `${pluginName} - Prompt`,
      icon: IC.pencil,
      token: pluginMentionToken(pluginName, prompt.id || title),
      pluginId: prompt.pluginId,
      pluginName,
      body: prompt.body
    })
  }
  for (const command of contributions.commands || []) {
    const plugin = pluginById.get(command.pluginId)
    const pluginName = plugin?.manifest?.name || command.pluginId || 'Plugin'
    const title = command.label || command.id || 'command'
    items.push({
      id: `plugin-command:${command.pluginId}:${command.id}`,
      section: 'plugins',
      kind: 'plugin-command',
      title,
      detail: `${pluginName} - Command`,
      icon: IC.terminal,
      token: pluginMentionToken(pluginName, command.id || title),
      pluginId: command.pluginId,
      pluginName
    })
  }
  return items.sort((a, b) => a.title.localeCompare(b.title))
}

export function filterComposerAddItems(items: ComposerAddItem[], query: string): ComposerAddItem[] {
  const q = query.trim().replace(/^@+/, '').toLowerCase()
  if (!q) return items
  return items.filter(item => [
    item.title,
    item.detail,
    item.token,
    item.pluginId,
    item.pluginName,
    item.path
  ].filter(Boolean).join(' ').toLowerCase().includes(q))
}

export function pluginAddItemToAttachment(item: ComposerAddItem): WorkbenchAttachment {
  return {
    id: `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: `Plugin: ${item.title}`,
    text: pluginAddItemContext(item),
    createdAt: Date.now()
  }
}

function pluginAddItemContext(item: ComposerAddItem): string {
  const lines = [
    `[AgentHub Plugin] ${item.title}`,
    `Type: ${item.kind.replace(/^plugin-/, '')}`,
    item.pluginName ? `Plugin: ${item.pluginName}` : '',
    item.pluginId ? `Plugin ID: ${item.pluginId}` : '',
    item.path ? `Source: ${item.path}` : '',
    '',
    'Use this plugin capability for the current user request. Follow its instructions when provided; if the instructions are insufficient, ask a focused clarification instead of inventing missing behavior.',
    ''
  ].filter(Boolean)
  if (item.body?.trim()) {
    lines.push('Instructions:')
    lines.push(item.body.trim().slice(0, 24000))
  } else {
    lines.push('Instructions: No inline body was available. Use the plugin name, source path, and requested task as routing context.')
  }
  return lines.join('\n')
}

function pluginMentionToken(pluginName: string, id: string): string {
  return `@plugin-${safeMentionToken(pluginName)}-${safeMentionToken(id)}`
}

export function safeMentionToken(value: string): string {
  return String(value || 'plugin')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'plugin'
}

export function groupComposerAddItems(items: ComposerAddItem[]): Array<{ section: ComposerAddItem['section']; items: ComposerAddItem[] }> {
  const groups: Array<{ section: ComposerAddItem['section']; items: ComposerAddItem[] }> = []
  for (const item of items) {
    let group = groups.find(entry => entry.section === item.section)
    if (!group) {
      group = { section: item.section, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

export function composerAddSectionLabel(section: ComposerAddItem['section']): string {
  return section === 'plugins' ? tr('Plugins', 'Plugins') : tr('Add', 'Add')
}
