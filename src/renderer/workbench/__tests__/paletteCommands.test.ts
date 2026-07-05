import { describe, expect, it } from 'vitest'
import { buildPaletteCommands, resolvePaletteExtraAction } from '../utils/paletteCommands'

function agent(patch: Partial<LocalAgentStatus> & { agentId: string }): LocalAgentStatus {
  return {
    agentId: patch.agentId,
    label: patch.label || patch.agentId,
    installed: patch.installed ?? false,
    configured: patch.configured ?? false,
    protocol: patch.protocol,
    binary: patch.binary,
    args: patch.args,
    version: patch.version,
    manualOnly: patch.manualOnly,
    candidateKind: patch.candidateKind,
    requiresPromptArg: patch.requiresPromptArg,
    note: patch.note,
    loginState: patch.loginState || 'unknown',
    candidates: patch.candidates || [],
    workspaceSession: patch.workspaceSession || 'per-dispatch',
    diagnostic: patch.diagnostic,
    error: patch.error
  }
}

describe('palette command utilities', () => {
  it('builds shortcut, extra, and usable local-agent commands', () => {
    const commands = buildPaletteCommands([
      agent({ agentId: 'codex', installed: true, configured: false, loginState: 'ready' }),
      agent({ agentId: 'gemini', installed: false, configured: false, loginState: 'not-installed' })
    ])
    const ids = commands.map(command => command.id)

    expect(ids).toContain('new-chat')
    expect(ids).toContain('view-requirements')
    expect(ids).toContain('open-memory')
    expect(ids).toContain('seed-workflows')
    expect(ids).toContain('switch-agent:codex')
    expect(ids).not.toContain('switch-agent:gemini')
    expect(commands.find(command => command.id === 'new-chat')).toMatchObject({
      category: 'keyboard',
      label: 'New chat'
    })
  })

  it('resolves only palette-owned commands as extra actions', () => {
    const localAgents = [agent({ agentId: 'opencode', installed: true, configured: false, loginState: 'ready' })]

    expect(resolvePaletteExtraAction('open-models', localAgents)).toEqual({ type: 'setup', tab: 'models' })
    expect(resolvePaletteExtraAction('open-prompts', localAgents)).toEqual({ type: 'setup', tab: 'shortcuts' })
    expect(resolvePaletteExtraAction('open-diagnostics', localAgents)).toEqual({ type: 'setup', tab: 'diagnostics' })
    expect(resolvePaletteExtraAction('open-backup', localAgents)).toEqual({ type: 'setup', tab: 'appearance' })
    expect(resolvePaletteExtraAction('seed-workflows', localAgents)).toEqual({ type: 'seed-workflows' })
    expect(resolvePaletteExtraAction('switch-agent:opencode', localAgents)).toEqual({ type: 'switch-agent', agentId: 'opencode' })
    expect(resolvePaletteExtraAction('switch-agent:missing', localAgents)).toBeNull()
    expect(resolvePaletteExtraAction('new-chat', localAgents)).toBeNull()
  })
})
