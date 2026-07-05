// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacesTab } from './WorkspacesTab'
import { setLang } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'

vi.mock('../lib/confirm', () => ({
  styledConfirm: vi.fn(async () => true)
}))

const workspaces = [
  { id: 'ws-1', name: 'AgentHub', rootPath: 'E:\\Agent\\AgentHub-v123-main' },
  { id: 'ws-2', name: 'Kun', rootPath: 'E:\\Agent\\kun' }
]

function installElectronApi(options: { activeId?: string | null; pickedFolder?: string | null } = {}) {
  const api = {
    workspaces: {
      list: vi.fn(async () => workspaces),
      getActive: vi.fn(async () => options.activeId ?? 'ws-1'),
      create: vi.fn(async (_input: { name: string; rootPath: string }) => undefined),
      update: vi.fn(async (_id: string, _patch: { name?: string; rootPath?: string }) => undefined),
      setActive: vi.fn(async (_id: string) => undefined),
      remove: vi.fn(async (_id: string) => undefined)
    },
    app: {
      pickFolder: vi.fn(async () => options.pickedFolder ?? 'E:\\Agent\\NewProject')
    }
  }
  ;(window as any).electronAPI = api
  return api
}

describe('WorkspacesTab', () => {
  beforeEach(() => {
    setLang('en')
    vi.mocked(styledConfirm).mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as any).electronAPI
  })

  it('loads workspaces and marks the active workspace', async () => {
    installElectronApi({ activeId: 'ws-2' })

    render(<WorkspacesTab />)

    await screen.findByText('AgentHub')
    await screen.findByText('Kun')
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('E:\\Agent\\kun')).toBeTruthy()
  })

  it('creates a workspace from the selected folder and refreshes the list', async () => {
    const api = installElectronApi({ pickedFolder: 'E:\\Agent\\NewProject' })

    render(<WorkspacesTab />)

    fireEvent.click(await screen.findByRole('button', { name: /Add workspace/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Choose' }))
    await waitFor(() => expect(api.app.pickFolder).toHaveBeenCalledWith({ defaultPath: '' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.workspaces.create).toHaveBeenCalledWith({
      name: 'NewProject',
      rootPath: 'E:\\Agent\\NewProject'
    }))
    expect(api.workspaces.list).toHaveBeenCalledTimes(2)
  })

  it('sets another workspace active and removes a workspace after confirmation', async () => {
    const api = installElectronApi({ activeId: 'ws-1' })

    render(<WorkspacesTab />)
    await screen.findByText('Kun')

    fireEvent.click(screen.getByRole('button', { name: 'Set active' }))
    await waitFor(() => expect(api.workspaces.setActive).toHaveBeenCalledWith('ws-2'))

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(removeButtons[1])

    await waitFor(() => expect(styledConfirm).toHaveBeenCalled())
    await waitFor(() => expect(api.workspaces.remove).toHaveBeenCalledWith('ws-2'))
  })
})
