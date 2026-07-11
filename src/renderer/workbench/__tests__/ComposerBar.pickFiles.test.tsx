// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { ComposerBar } from '../ComposerBar'

const baseThinking = { mode: 'off', level: 'minimal' } as const
const baseSchedule: SchedulePreview = {
  preset: 'auto',
  label: 'Auto',
  description: 'Auto route',
  steps: []
}

function installElectronApi(pickFiles: ReturnType<typeof vi.fn>) {
  ;(window as any).electronAPI = {
    agentic: {
      getApprovalConfig: vi.fn().mockResolvedValue({ preset: 'custom', default: { write: 'allow', exec: 'ask' } })
    },
    app: {
      pickFiles
    },
    commands: {
      list: vi.fn().mockResolvedValue([])
    },
    plugins: {
      scan: vi.fn().mockResolvedValue([]),
      contributions: vi.fn().mockResolvedValue([])
    }
  }
}

function renderComposer(overrides: Partial<React.ComponentProps<typeof ComposerBar>> = {}) {
  const props: React.ComponentProps<typeof ComposerBar> = {
    mode: 'auto',
    setMode: vi.fn(),
    providers: [],
    bindings: [],
    modelSelection: null,
    setModelSelection: vi.fn(),
    thinking: baseThinking,
    setThinking: vi.fn(),
    schedules: [baseSchedule],
    sending: false,
    onSend: vi.fn(),
    onCancel: vi.fn(),
    workspaceId: 'ws-1',
    workspaces: [{ id: 'ws-1', name: 'Workspace', rootPath: 'C:\\repo', createdAt: 1, updatedAt: 1 }],
    setWorkspaceId: vi.fn(),
    onCreateProject: vi.fn(),
    localAgents: [],
    targetAgent: null,
    setTargetAgent: vi.fn(),
    agents: {},
    ...overrides
  }

  render(<ComposerBar {...props} />)
  return props
}

describe('ComposerBar pickFiles attachments', () => {
  beforeEach(() => {
    setLang('en')
  })

  afterEach(() => {
    cleanup()
    delete (window as any).electronAPI
    vi.restoreAllMocks()
  })

  it('does not add attachments when pickFiles returns null', async () => {
    const pickFiles = vi.fn().mockResolvedValue(null)
    installElectronApi(pickFiles)
    const props = renderComposer()

    fireEvent.click(screen.getByTitle('Attach file or image'))

    await waitFor(() => expect(pickFiles).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('notes.md')).toBeNull()
    expect((screen.getByTitle('Send') as HTMLButtonElement).disabled).toBe(true)
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('converts picked file paths into file attachments using path basenames', async () => {
    const pickFiles = vi.fn().mockResolvedValue(['C:\\repo\\notes.md', '/tmp/screenshot.png'])
    installElectronApi(pickFiles)
    const props = renderComposer()

    fireEvent.click(screen.getByTitle('Attach file or image'))

    await screen.findByText('notes.md')
    expect(screen.getByText('screenshot.png')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(props.onSend).toHaveBeenCalledTimes(1))
    const attachments = (props.onSend as any).mock.calls[0][1] as WorkbenchAttachment[]
    expect(attachments).toHaveLength(2)
    expect(attachments).toMatchObject([
      { kind: 'file', path: 'C:\\repo\\notes.md', name: 'notes.md' },
      { kind: 'file', path: '/tmp/screenshot.png', name: 'screenshot.png' }
    ])
    expect(attachments.every(item => item.id && typeof item.createdAt === 'number')).toBe(true)
  })
})
