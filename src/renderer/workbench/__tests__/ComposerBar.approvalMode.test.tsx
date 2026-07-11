// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { ApprovalsTab } from '../../screens/ApprovalsTab'
import { ComposerBar } from '../ComposerBar'

type Policy = 'allow' | 'ask' | 'deny'
type Preset = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'

const baseProps: React.ComponentProps<typeof ComposerBar> = {
  mode: 'auto',
  setMode: vi.fn(),
  providers: [],
  bindings: [],
  modelSelection: null,
  setModelSelection: vi.fn(),
  thinking: { mode: 'off', level: 'minimal' },
  setThinking: vi.fn(),
  schedules: [],
  sending: false,
  onSend: vi.fn(),
  onCancel: vi.fn(),
  workspaceId: null,
  workspaces: [],
  setWorkspaceId: vi.fn(),
  onCreateProject: vi.fn(),
  localAgents: [],
  targetAgent: null,
  setTargetAgent: vi.fn(),
  agents: {}
}

function installApi(config: { preset: Preset; default: { write: Policy; exec: Policy }; overrides?: Record<string, never> }) {
  const stored = { ...config, version: 1 as const, overrides: config.overrides || {} }
  const api = {
    agentic: {
      getApprovalConfig: vi.fn().mockResolvedValue(stored),
      capabilities: vi.fn().mockResolvedValue([]),
      setApprovalPreset: vi.fn(async (preset: Preset) => ({ ...stored, preset })),
      setApprovalDefault: vi.fn(),
      setApprovalOverride: vi.fn()
    },
    commands: { list: vi.fn().mockResolvedValue([]) },
    plugins: { scan: vi.fn().mockResolvedValue([]), contributions: vi.fn().mockResolvedValue([]) }
  }
  ;(window as any).electronAPI = api
  return api
}

async function expectComposerLabel(config: { preset: Preset; default: { write: Policy; exec: Policy } }, label: string) {
  installApi(config)
  const view = render(<ComposerBar {...baseProps} />)
  const trigger = view.container.querySelector('.wb-approval-mode-trigger') as HTMLButtonElement
  await waitFor(() => expect(trigger.textContent).toContain(label))
  cleanup()
}

describe('approval mode display mapping', () => {
  afterEach(() => {
    cleanup()
    setLang('zh')
    delete (window as any).electronAPI
    vi.restoreAllMocks()
  })

  it('prefers every persisted preset over contradictory default policies', async () => {
    setLang('en')
    const cases: Array<[Preset, string]> = [
      ['ask-all', 'Ask for approval'],
      ['auto', 'Auto approve'],
      ['full-access', 'Full access'],
      ['read-only', 'Read only'],
      ['custom', 'Custom']
    ]

    for (const [preset, label] of cases) {
      await expectComposerLabel({ preset, default: { write: 'allow', exec: 'allow' } }, label)
    }
  })

  it('uses the existing translation mechanism for read-only and custom labels', async () => {
    setLang('zh')
    await expectComposerLabel({ preset: 'read-only', default: { write: 'allow', exec: 'allow' } }, '只读')
    await expectComposerLabel({ preset: 'custom', default: { write: 'allow', exec: 'allow' } }, '自定义')
  })

  it('shows the exact current mode in the approvals settings tab', async () => {
    setLang('en')
    installApi({ preset: 'custom', default: { write: 'allow', exec: 'allow' } })
    render(<ApprovalsTab />)

    expect((await screen.findByLabelText('Current approval mode')).textContent).toContain('Custom')
  })

  it('persists picker choices as real presets so refresh keeps the selected label', async () => {
    setLang('en')
    const api = installApi({ preset: 'full-access', default: { write: 'allow', exec: 'allow' } })
    const view = render(<ComposerBar {...baseProps} />)
    const trigger = view.container.querySelector('.wb-approval-mode-trigger') as HTMLButtonElement
    await waitFor(() => expect(trigger.textContent).toContain('Full access'))

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Approval mode' })).getByRole('button', { name: /Auto approve/ }))

    await waitFor(() => expect(api.agentic.setApprovalPreset).toHaveBeenCalledWith('auto'))
  })

  it('uses the successful preset response even when any subsequent config refresh would fail', async () => {
    setLang('en')
    const api = installApi({ preset: 'full-access', default: { write: 'allow', exec: 'allow' } })
    api.agentic.getApprovalConfig
      .mockResolvedValueOnce({ version: 1, preset: 'full-access', default: { write: 'allow', exec: 'allow' }, overrides: {} })
      .mockRejectedValue(new Error('refresh unavailable'))
    const autoConfig = { version: 1 as const, preset: 'auto' as const, default: { write: 'allow' as const, exec: 'allow' as const }, overrides: {} }
    let persist!: (value: typeof autoConfig) => void
    api.agentic.setApprovalPreset.mockImplementation(() => new Promise(resolve => { persist = resolve }))
    const view = render(<ComposerBar {...baseProps} />)
    const trigger = view.container.querySelector('.wb-approval-mode-trigger') as HTMLButtonElement
    await waitFor(() => expect(trigger.textContent).toContain('Full access'))

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Approval mode' })).getByRole('button', { name: /Auto approve/ }))

    expect(trigger.textContent).toContain('Full access')
    await act(async () => { persist(autoConfig) })
    await waitFor(() => expect(trigger.textContent).toContain('Auto approve'))
    expect(api.agentic.getApprovalConfig).toHaveBeenCalledTimes(1)
  })

  it('locks the picker while a preset save is pending and ignores a second selection', async () => {
    setLang('en')
    const api = installApi({ preset: 'full-access', default: { write: 'allow', exec: 'allow' } })
    const autoConfig = { version: 1 as const, preset: 'auto' as const, default: { write: 'allow' as const, exec: 'allow' as const }, overrides: {} }
    let persist!: (value: typeof autoConfig) => void
    api.agentic.setApprovalPreset.mockImplementation(() => new Promise(resolve => { persist = resolve }))
    const view = render(<ComposerBar {...baseProps} />)
    const trigger = view.container.querySelector('.wb-approval-mode-trigger') as HTMLButtonElement
    await waitFor(() => expect(trigger.textContent).toContain('Full access'))

    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Approval mode' })
    const autoButton = within(menu).getByRole('button', { name: /Auto approve/ }) as HTMLButtonElement
    const askButton = within(menu).getByRole('button', { name: /Ask for approval/ }) as HTMLButtonElement
    fireEvent.click(autoButton)

    await waitFor(() => expect(trigger.disabled).toBe(true))
    expect(autoButton.disabled).toBe(true)
    expect(askButton.disabled).toBe(true)
    fireEvent.click(askButton)
    expect(api.agentic.setApprovalPreset).toHaveBeenCalledTimes(1)

    await act(async () => { persist(autoConfig) })
    await waitFor(() => expect(trigger.textContent).toContain('Auto approve'))
  })

  it('keeps the current label and reports an error when preset persistence fails', async () => {
    setLang('en')
    const api = installApi({ preset: 'full-access', default: { write: 'allow', exec: 'allow' } })
    api.agentic.setApprovalPreset.mockRejectedValue(new Error())
    const view = render(<ComposerBar {...baseProps} />)
    const trigger = view.container.querySelector('.wb-approval-mode-trigger') as HTMLButtonElement
    await waitFor(() => expect(trigger.textContent).toContain('Full access'))

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Approval mode' })).getByRole('button', { name: /Auto approve/ }))

    await screen.findByText('Failed to switch approval mode.')
    expect(trigger.textContent).toContain('Full access')
  })
})
