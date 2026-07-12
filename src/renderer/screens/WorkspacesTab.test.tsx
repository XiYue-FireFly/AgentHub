// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacesTab } from './WorkspacesTab'
import { setLang } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'
import { WORKSPACE_CHANGE_EVENT, type WorkspaceChangeDetail } from '../workspace-change'

vi.mock('../lib/confirm', () => ({
  styledConfirm: vi.fn(async () => true)
}))

const workspaces = [
  { id: 'ws-1', name: 'AgentHub', rootPath: 'E:\\Agent\\AgentHub-v123-main' },
  { id: 'ws-2', name: 'Kun', rootPath: 'E:\\Agent\\kun' }
]

const workspaceChangeCleanups: Array<() => void> = []

function observeWorkspaceChanges() {
  const details: WorkspaceChangeDetail[] = []
  const listener = (event: Event) => {
    details.push((event as CustomEvent<WorkspaceChangeDetail>).detail)
  }
  window.addEventListener(WORKSPACE_CHANGE_EVENT, listener)
  workspaceChangeCleanups.push(() => window.removeEventListener(WORKSPACE_CHANGE_EVENT, listener))
  return details
}

function installElectronApi(options: {
  activeId?: string | null
  pickedFolder?: string | null
  initialWorkspaces?: typeof workspaces
} = {}) {
  let currentWorkspaces = (options.initialWorkspaces ?? workspaces).map(workspace => ({ ...workspace }))
  let activeId = options.activeId === undefined ? 'ws-1' : options.activeId
  const api = {
    workspaces: {
      list: vi.fn(async () => currentWorkspaces),
      getActive: vi.fn(async () => activeId),
      create: vi.fn(async (input: { name: string; rootPath: string }) => {
        const created = { id: 'ws-new', ...input }
        currentWorkspaces = [...currentWorkspaces, created]
        if (!activeId) activeId = created.id
        return created
      }),
      update: vi.fn(async (id: string, patch: { name?: string; rootPath?: string }) => {
        const current = currentWorkspaces.find(workspace => workspace.id === id)
        if (!current) throw new Error('workspace not found')
        const updated = { ...current, ...patch }
        currentWorkspaces = currentWorkspaces.map(workspace => workspace.id === id ? updated : workspace)
        return updated
      }),
      setActive: vi.fn(async (id: string | null) => {
        activeId = id
        return activeId
      }),
      remove: vi.fn(async (id: string) => {
        const nextWorkspaces = currentWorkspaces.filter(workspace => workspace.id !== id)
        if (nextWorkspaces.length === currentWorkspaces.length) return false
        currentWorkspaces = nextWorkspaces
        if (activeId === id) activeId = currentWorkspaces[0]?.id ?? null
        return true
      })
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
    workspaceChangeCleanups.splice(0).forEach(dispose => dispose())
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
    const changes = observeWorkspaceChanges()

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
    expect(changes).toEqual([{ kind: 'known', activeWorkspaceId: 'ws-1' }])
  })

  it('notifies with the created workspace id when the first workspace becomes active', async () => {
    const api = installElectronApi({ activeId: null, initialWorkspaces: [] })
    const changes = observeWorkspaceChanges()

    render(<WorkspacesTab />)
    await screen.findByText('No workspaces yet')
    fireEvent.click(screen.getByRole('button', { name: /Add workspace/ }))
    fireEvent.change(screen.getByPlaceholderText('Name this folder'), { target: { value: 'First' } })
    fireEvent.change(screen.getByPlaceholderText('Choose local folder'), { target: { value: 'E:\\First' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.workspaces.create).toHaveBeenCalledWith({ name: 'First', rootPath: 'E:\\First' }))
    await waitFor(() => expect(changes).toEqual([{ kind: 'known', activeWorkspaceId: 'ws-new' }]))
  })

  it('notifies after editing the active workspace with its authoritative active id', async () => {
    const api = installElectronApi({ activeId: 'ws-1' })
    const changes = observeWorkspaceChanges()

    render(<WorkspacesTab />)
    const row = (await screen.findByText('AgentHub')).closest('.wb-workspace-row') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByPlaceholderText('Name this folder'), { target: { value: 'AgentHub Next' } })
    fireEvent.change(screen.getByPlaceholderText('Choose local folder'), { target: { value: 'E:\\Agent\\AgentHub-next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.workspaces.update).toHaveBeenCalledWith('ws-1', {
      name: 'AgentHub Next',
      rootPath: 'E:\\Agent\\AgentHub-next'
    }))
    await screen.findByText('AgentHub Next')
    expect(changes).toEqual([{ kind: 'known', activeWorkspaceId: 'ws-1' }])
  })

  it('sets another workspace active and removes a workspace after confirmation', async () => {
    const api = installElectronApi({ activeId: 'ws-1' })
    const changes = observeWorkspaceChanges()

    render(<WorkspacesTab />)
    const kunRow = (await screen.findByText('Kun')).closest('.wb-workspace-row') as HTMLElement

    fireEvent.click(within(kunRow).getByRole('button', { name: 'Set active' }))
    await waitFor(() => expect(api.workspaces.setActive).toHaveBeenCalledWith('ws-2'))
    await waitFor(() => expect(changes).toEqual([{ kind: 'known', activeWorkspaceId: 'ws-2' }]))

    fireEvent.click(within(kunRow).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(styledConfirm).toHaveBeenCalled())
    await waitFor(() => expect(api.workspaces.remove).toHaveBeenCalledWith('ws-2'))
    expect(changes).toEqual([
      { kind: 'known', activeWorkspaceId: 'ws-2' },
      { kind: 'known', activeWorkspaceId: 'ws-1' }
    ])
  })

  it('notifies with null after removing the only active workspace', async () => {
    const api = installElectronApi({ activeId: 'ws-1', initialWorkspaces: [workspaces[0]] })
    const changes = observeWorkspaceChanges()

    render(<WorkspacesTab />)
    const row = (await screen.findByText('AgentHub')).closest('.wb-workspace-row') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(api.workspaces.remove).toHaveBeenCalledWith('ws-1'))
    expect(changes).toEqual([{ kind: 'known', activeWorkspaceId: null }])
  })

  it('does not notify for cancelled or failed mutations', async () => {
    const api = installElectronApi({ activeId: 'ws-1' })
    const changes = observeWorkspaceChanges()

    render(<WorkspacesTab />)
    await screen.findByText('AgentHub')

    fireEvent.click(screen.getByRole('button', { name: /Add workspace/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(changes).toEqual([])

    api.workspaces.create.mockRejectedValueOnce(new Error('create failed'))
    fireEvent.click(screen.getByRole('button', { name: /Add workspace/ }))
    fireEvent.change(screen.getByPlaceholderText('Name this folder'), { target: { value: 'Broken' } })
    fireEvent.change(screen.getByPlaceholderText('Choose local folder'), { target: { value: 'E:\\Broken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.workspaces.create).toHaveBeenCalled())
    expect(changes).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    api.workspaces.update.mockRejectedValueOnce(new Error('update failed'))
    const agentHubRow = screen.getByText('AgentHub').closest('.wb-workspace-row') as HTMLElement
    fireEvent.click(within(agentHubRow).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByPlaceholderText('Name this folder'), { target: { value: 'Broken edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.workspaces.update).toHaveBeenCalled())
    expect(changes).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    const kunRow = screen.getByText('Kun').closest('.wb-workspace-row') as HTMLElement
    api.workspaces.setActive.mockRejectedValueOnce(new Error('set active failed'))
    fireEvent.click(within(kunRow).getByRole('button', { name: 'Set active' }))
    await waitFor(() => expect(api.workspaces.setActive).toHaveBeenCalled())
    expect(changes).toEqual([])

    vi.mocked(styledConfirm).mockResolvedValueOnce(false)
    fireEvent.click(within(kunRow).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(styledConfirm).toHaveBeenCalled())
    expect(api.workspaces.remove).not.toHaveBeenCalled()
    expect(changes).toEqual([])

    api.workspaces.remove.mockRejectedValueOnce(new Error('remove failed'))
    fireEvent.click(within(kunRow).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.workspaces.remove).toHaveBeenCalled())
    expect(changes).toEqual([])
  })

  it.each(['list', 'getActive'] as const)('emits invalidate and reports an applied change when %s refresh fails after a successful mutation', async failingCall => {
    const api = installElectronApi({ activeId: 'ws-1' })
    const changes = observeWorkspaceChanges()
    render(<WorkspacesTab />)
    const row = (await screen.findByText('AgentHub')).closest('.wb-workspace-row') as HTMLElement

    api.workspaces[failingCall].mockRejectedValueOnce(new Error(`${failingCall} refresh failed`))
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByPlaceholderText('Name this folder'), { target: { value: 'Applied edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.workspaces.update).toHaveBeenCalled())
    await waitFor(() => expect(changes).toEqual([{ kind: 'invalidate' }]))
    expect(screen.getByText('The workspace change was applied, but this page failed to refresh.')).toBeTruthy()
  })
})
