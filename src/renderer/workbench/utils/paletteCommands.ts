import type { PaletteCommand } from '../CommandPalette'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../keyboard-shortcuts'
import { localAgentOptions } from '../localAgentOptions'

export type PaletteSetupTab =
  | 'appearance'
  | 'memory'
  | 'models'
  | 'plugins'
  | 'shortcuts'
  | 'skills'
  | 'usage'
  | 'diagnostics'

export type PaletteExtraAction =
  | { type: 'setup'; tab: PaletteSetupTab }
  | { type: 'seed-workflows' }
  | { type: 'switch-agent'; agentId: string }

const PALETTE_EXTRA_COMMANDS: PaletteCommand[] = [
  { id: 'open-memory', label: 'Open Memory', labelZh: '打开记忆', category: 'navigation' },
  { id: 'open-skills', label: 'Open Skills', labelZh: '打开技能', category: 'navigation' },
  { id: 'open-prompts', label: 'Open Prompts', labelZh: '打开提示词库', category: 'navigation' },
  { id: 'open-plugins', label: 'Open Plugins', labelZh: '打开插件管理', category: 'navigation' },
  { id: 'open-usage', label: 'Open Usage Stats', labelZh: '打开用量统计', category: 'navigation' },
  { id: 'open-models', label: 'Open Models', labelZh: '打开模型列表', category: 'navigation' },
  { id: 'open-diagnostics', label: 'Run Diagnostics', labelZh: '运行诊断', category: 'system' },
  { id: 'open-backup', label: 'Create Backup', labelZh: '创建备份', category: 'system' },
  { id: 'seed-workflows', label: 'Seed Default Workflows', labelZh: '加载默认工作流', category: 'system' }
]

export function buildPaletteCommands(localAgents: LocalAgentStatus[]): PaletteCommand[] {
  const shortcutCommands: PaletteCommand[] = KEYBOARD_SHORTCUT_COMMANDS.map(command => ({
    id: command.id,
    label: command.labelEn,
    labelZh: command.labelZh,
    labelEn: command.labelEn,
    descriptionZh: command.descriptionZh,
    descriptionEn: command.descriptionEn,
    category: 'keyboard'
  }))
  const agentCommands: PaletteCommand[] = localAgentOptions(localAgents).map(id => ({
    id: `switch-agent:${id}`,
    label: `Switch to ${id}`,
    labelZh: `切换到 ${id}`,
    category: 'agent'
  }))
  return [...shortcutCommands, ...PALETTE_EXTRA_COMMANDS, ...agentCommands]
}

export function resolvePaletteExtraAction(id: string, localAgents: LocalAgentStatus[]): PaletteExtraAction | null {
  if (id === 'open-memory') return { type: 'setup', tab: 'memory' }
  if (id === 'open-skills') return { type: 'setup', tab: 'skills' }
  if (id === 'open-plugins') return { type: 'setup', tab: 'plugins' }
  if (id === 'open-usage') return { type: 'setup', tab: 'usage' }
  if (id === 'open-models') return { type: 'setup', tab: 'models' }
  if (id === 'open-prompts') return { type: 'setup', tab: 'shortcuts' }
  if (id === 'open-diagnostics') return { type: 'setup', tab: 'diagnostics' }
  if (id === 'open-backup') return { type: 'setup', tab: 'appearance' }
  if (id === 'seed-workflows') return { type: 'seed-workflows' }
  if (id.startsWith('switch-agent:')) {
    const agentId = id.slice('switch-agent:'.length)
    if (agentId && localAgentOptions(localAgents).includes(agentId)) return { type: 'switch-agent', agentId }
    return null
  }
  return null
}
