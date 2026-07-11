// @vitest-environment happy-dom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { WorkbenchAnnouncementModal } from '../WorkbenchAnnouncementModal'
import { CreateWorkspaceDialog } from '../CreateWorkspaceDialog'
import { CommandPalette } from '../CommandPalette'
import { SessionSidebar } from '../SessionSidebar'

describe('workbench modal focus management', () => {
  beforeEach(() => {
    setLang('en')
    ;(window as any).electronAPI = {
      store: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
      app: { pickFolder: vi.fn(async () => null) },
      workspaces: { create: vi.fn() }
    }
  })

  afterEach(() => {
    cleanup()
    setLang('zh')
    delete (window as any).electronAPI
  })

  it('contains announcement focus, closes on Escape, and restores its trigger', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Show announcement</button>
          {open && <WorkbenchAnnouncementModal onClose={() => setOpen(false)} onOpenSetup={vi.fn()} />}
        </>
      )
    }

    const view = render(<Harness />)
    const trigger = view.getByRole('button', { name: 'Show announcement' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = view.getByRole('dialog', { name: 'Finish run setup before starting' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    const first = view.getByRole('button', { name: 'Close announcement' })
    const last = view.getByRole('button', { name: 'Got it' })
    expect(document.activeElement).toBe(first)

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes only the topmost React modal for each Escape press', async () => {
    const bottomClose = vi.fn()
    const topClose = vi.fn()

    function Harness() {
      const [bottomOpen, setBottomOpen] = useState(true)
      const [topOpen, setTopOpen] = useState(true)
      return (
        <>
          {bottomOpen && (
            <WorkbenchAnnouncementModal
              onClose={() => { bottomClose(); setBottomOpen(false) }}
              onOpenSetup={vi.fn()}
            />
          )}
          {topOpen && (
            <WorkbenchAnnouncementModal
              onClose={() => { topClose(); setTopOpen(false) }}
              onOpenSetup={vi.fn()}
            />
          )}
        </>
      )
    }

    const view = render(<Harness />)
    expect(view.getAllByRole('dialog')).toHaveLength(2)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(topClose).toHaveBeenCalledTimes(1)
    expect(bottomClose).not.toHaveBeenCalled()
    await waitFor(() => expect(view.getAllByRole('dialog')).toHaveLength(1))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(bottomClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(view.queryAllByRole('dialog')).toHaveLength(0))
  })

  it('gives the create-folder dialog semantics and a complete focus lifecycle', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Add workspace</button>
          {open && (
            <CreateWorkspaceDialog
              onClose={() => setOpen(false)}
              onCreated={vi.fn()}
            />
          )}
        </>
      )
    }

    const view = render(<Harness />)
    const trigger = view.getByRole('button', { name: 'Add workspace' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = view.getByRole('dialog', { name: 'Add working folder' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    const name = view.getByPlaceholderText('Name this folder')
    expect(document.activeElement).toBe(name)

    const last = view.getByRole('button', { name: 'Add folder' })
    const first = view.getByRole('button', { name: 'Close add folder dialog' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('does not close the create-folder dialog from Escape or the overlay while submitting', async () => {
    let resolveCreate!: (workspace: WorkbenchWorkspace) => void
    const createResult = new Promise<WorkbenchWorkspace>(resolve => {
      resolveCreate = resolve
    })
    window.electronAPI.workspaces.create = vi.fn(() => createResult)
    const onClose = vi.fn()
    const view = render(<CreateWorkspaceDialog onClose={onClose} onCreated={vi.fn()} />)

    fireEvent.change(view.getByPlaceholderText('Name this folder'), { target: { value: 'AgentHub' } })
    fireEvent.change(view.getByPlaceholderText('Choose a local folder'), { target: { value: 'E:\\AgentHub' } })
    fireEvent.click(view.getByRole('button', { name: 'Add folder' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true))
    expect(view.getByRole('button', { name: 'Close add folder dialog' }).hasAttribute('disabled')).toBe(true)

    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' })
    fireEvent.mouseDown(view.container.querySelector('.wb-modal-backdrop') as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      resolveCreate({
        id: 'workspace-1',
        name: 'AgentHub',
        rootPath: 'E:\\AgentHub',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      await createResult
    })
  })

  it('exposes the command palette as a named dialog and traps focus until Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open commands</button>
          {open && (
            <CommandPalette
              commands={[{ id: 'open', label: 'Open file' }, { id: 'save', label: 'Save file' }]}
              onExecute={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }

    const view = render(<Harness />)
    const trigger = view.getByRole('button', { name: 'Open commands' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = view.getByRole('dialog', { name: 'Command palette' })
    const input = view.getByRole('combobox', { name: 'Search commands' })
    const listbox = view.getByRole('listbox', { name: 'Commands' })
    const options = view.getAllByRole('option')
    expect(listbox).toContain(options[0])
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(options.every(option => (option as HTMLElement).tabIndex === -1)).toBe(true)
    expect(document.activeElement).toBe(input)

    pressTab(input as HTMLElement)
    expect(document.activeElement).toBe(input)

    const last = view.getByRole('option', { name: 'Save file' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('executes the command selected with arrow keys while focus stays on the combobox', () => {
    const onExecute = vi.fn()
    const onClose = vi.fn()
    const view = render(
      <CommandPalette
        commands={[{ id: 'open', label: 'Open file' }, { id: 'save', label: 'Save file' }]}
        onExecute={onExecute}
        onClose={onClose}
      />
    )
    const input = view.getByRole('combobox', { name: 'Search commands' })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
    expect(view.getByRole('option', { name: 'Save file' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onExecute).toHaveBeenCalledWith('save')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses unique ARIA ids for concurrent command palettes', () => {
    const commands = [{ id: 'open', label: 'Open file' }]
    const view = render(
      <>
        <CommandPalette commands={commands} onExecute={vi.fn()} onClose={vi.fn()} />
        <CommandPalette commands={commands} onExecute={vi.fn()} onClose={vi.fn()} />
      </>
    )

    const ids = Array.from(view.container.querySelectorAll<HTMLElement>('[id^="wb-command-palette"]'))
      .map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('clamps command selection when results disappear and commands shrink', async () => {
    const onExecute = vi.fn()
    const onClose = vi.fn()
    const commands = [
      { id: 'open', label: 'Open file' },
      { id: 'save', label: 'Save file' },
      { id: 'close', label: 'Close file' }
    ]
    const view = render(<CommandPalette commands={commands} onExecute={onExecute} onClose={onClose} />)
    const input = view.getByRole('combobox', { name: 'Search commands' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(view.getByRole('option', { name: 'Close file' }).getAttribute('aria-selected')).toBe('true')

    view.rerender(<CommandPalette commands={[]} onExecute={onExecute} onClose={onClose} />)
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    view.rerender(<CommandPalette commands={[commands[0]]} onExecute={onExecute} onClose={onClose} />)
    await waitFor(() => {
      const option = view.getByRole('option', { name: 'Open file' })
      expect(option.getAttribute('aria-selected')).toBe('true')
      expect(input.getAttribute('aria-activedescendant')).toBe(option.id)
    })
  })

  it('treats the rename form as a modal and restores focus after Escape', async () => {
    const thread: WorkbenchThread = {
      id: 'thread-1',
      workspaceId: null,
      title: 'Session one',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const view = render(
      <SessionSidebar
        view="chat"
        setView={vi.fn()}
        workspaces={[]}
        workspaceId={null}
        selectWorkspace={vi.fn()}
        createProject={vi.fn()}
        threads={[thread]}
        activeThreadId={thread.id}
        selectThread={vi.fn()}
        createThread={vi.fn()}
        createThreadInWorkspace={vi.fn()}
        openSetup={vi.fn()}
        renameThread={vi.fn()}
        deleteThread={vi.fn()}
        search=""
        setSearch={vi.fn()}
        proxyHost="127.0.0.1"
        pendingThreadId={null}
      />
    )

    const trigger = view.getByTitle('Rename session')
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = view.getByRole('dialog', { name: 'Rename session' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    const input = view.getByDisplayValue('Session one')
    expect(document.activeElement).toBe(input)

    const last = view.getByRole('button', { name: 'Rename' })
    const first = view.getByRole('button', { name: 'Close rename dialog' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})

function pressTab(target: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  const shouldMove = target.dispatchEvent(event)
  if (!shouldMove) return

  const tabbable = Array.from(document.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(element => element.tabIndex >= 0)
  const index = tabbable.indexOf(target)
  const next = shiftKey
    ? tabbable[(index - 1 + tabbable.length) % tabbable.length]
    : tabbable[(index + 1) % tabbable.length]
  next?.focus()
}
