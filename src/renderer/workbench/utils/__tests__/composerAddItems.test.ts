import { describe, expect, it } from 'vitest'
import { buildPluginAddItems } from '../composerAddItems'

describe('composer plugin add items', () => {
  it('includes manifest-only plugin slash commands', () => {
    const items = buildPluginAddItems(
      [{ id: 'plugin-a', manifest: { name: 'Plugin A' } }],
      {
        slashCommands: [{
          pluginId: 'plugin-a',
          id: 'summarize',
          label: '/summarize',
          description: 'Summarize current context',
          promptTemplate: 'Summarize {{input}}'
        }]
      }
    )

    expect(items).toContainEqual(expect.objectContaining({
      id: 'plugin-slash-command:plugin-a:summarize',
      kind: 'plugin-command',
      title: '/summarize',
      detail: 'Plugin A - Slash command',
      token: '/summarize ',
      body: 'Summarize {{input}}'
    }))
  })
})
