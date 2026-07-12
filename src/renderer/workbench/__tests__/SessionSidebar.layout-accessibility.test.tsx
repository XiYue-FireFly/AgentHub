// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { SessionSidebar } from '../SessionSidebar'

const styles = readFileSync(join(process.cwd(), 'src/renderer/globals.css'), 'utf8')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function renderSidebar(options: {
  restoredWidth?: Promise<unknown>
  search?: string
  decisionCount?: Record<string, number>
} = {}) {
  const storeGet = vi.fn(() => options.restoredWidth ?? Promise.resolve(null))
  const storeSet = vi.fn(async () => undefined)
  const selectWorkspace = vi.fn()
  const selectThread = vi.fn()
  const createThreadInWorkspace = vi.fn()

  ;(window as any).electronAPI = {
    store: { get: storeGet, set: storeSet }
  }

  const thread: WorkbenchThread = {
    id: 'thread-1',
    workspaceId: 'workspace-1',
    title: 'Thread One',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  const view = render(
    <div className="wb-shell">
      <SessionSidebar
        view="chat"
        setView={vi.fn()}
        workspaces={[{
          id: 'workspace-1',
          name: 'Project One',
          rootPath: 'E:\\ProjectOne',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }]}
        workspaceId="workspace-1"
        selectWorkspace={selectWorkspace}
        createProject={vi.fn()}
        threads={[thread]}
        activeThreadId={thread.id}
        selectThread={selectThread}
        createThread={vi.fn()}
        createThreadInWorkspace={createThreadInWorkspace}
        openSetup={vi.fn()}
        renameThread={vi.fn()}
        deleteThread={vi.fn()}
        search={options.search ?? ''}
        setSearch={vi.fn()}
        proxyHost="127.0.0.1"
        pendingThreadId={null}
        decisionCount={options.decisionCount ?? {}}
      />
      <main className="wb-main">Main content</main>
      <section className="wb-bottom-dock">Git dock</section>
    </div>
  )

  return { ...view, storeGet, storeSet, selectWorkspace, selectThread, createThreadInWorkspace }
}

function expectSidebarGeometry(container: HTMLElement, expectedWidth: number) {
  const owner = container.querySelector<HTMLElement>('.wb-shell')
  const sidebar = container.querySelector<HTMLElement>('.wb-sidebar')
  const dock = container.querySelector<HTMLElement>('.wb-bottom-dock')

  expect(sidebar?.style.width).toBe(`${expectedWidth}px`)
  expect(sidebar?.style.flexBasis).toBe(`${expectedWidth}px`)
  expect(owner?.style.getPropertyValue('--wb-sidebar-width')).toBe(`${expectedWidth}px`)
  expect(dock?.parentElement).toBe(owner)
}

describe('SessionSidebar layout and narrow-viewport accessibility', () => {
  let styleElement: HTMLStyleElement

  beforeEach(() => {
    setLang('en')
    ;(window as any).happyDOM.setInnerWidth(320)
    styleElement = document.createElement('style')
    styleElement.textContent = styles
    document.head.append(styleElement)
  })

  afterEach(() => {
    cleanup()
    styleElement.remove()
    setLang('zh')
    delete (window as any).electronAPI
    ;(window as any).happyDOM.setInnerWidth(1024)
  })

  it('publishes the initial and clamped restored geometry token on the sidebar and Git dock owner', async () => {
    ;(window as any).happyDOM.setInnerWidth(1024)
    const restored = deferred<unknown>()
    const view = renderSidebar({ restoredWidth: restored.promise })

    expectSidebarGeometry(view.container, 312)

    await act(async () => {
      restored.resolve(999)
      await restored.promise
    })

    await waitFor(() => expectSidebarGeometry(view.container, 420))
  })

  it('keeps the owner geometry token synchronized while pointer resizing clamps at both bounds', async () => {
    ;(window as any).happyDOM.setInnerWidth(1024)
    const view = renderSidebar()
    const handle = view.container.querySelector<HTMLButtonElement>('.wb-sidebar-resize-handle')!

    fireEvent.pointerDown(handle, { clientX: 312 })
    fireEvent.pointerMove(window, { clientX: 1000 })
    await waitFor(() => expectSidebarGeometry(view.container, 420))
    fireEvent.pointerUp(window, { clientX: 1000 })
    expect(view.storeSet).toHaveBeenLastCalledWith('agenthub.workbench.sidebarWidth.v1', 420)

    fireEvent.pointerDown(handle, { clientX: 420 })
    fireEvent.pointerMove(window, { clientX: -1000 })
    await waitFor(() => expectSidebarGeometry(view.container, 248))
    fireEvent.pointerUp(window, { clientX: -1000 })
    expect(view.storeSet).toHaveBeenLastCalledWith('agenthub.workbench.sidebarWidth.v1', 248)
  })

  it('keeps workspace and thread navigation visible and keyboard focusable at 320 CSS pixels', () => {
    const view = renderSidebar()
    const shell = view.container.querySelector<HTMLElement>('.wb-shell')
    const sidebar = view.container.querySelector<HTMLElement>('.wb-sidebar')
    const resizeHandle = view.container.querySelector<HTMLButtonElement>('.wb-sidebar-resize-handle')!

    expect(window.matchMedia('(max-width: 820px)').matches).toBe(true)
    expect(getComputedStyle(shell!).flexDirection).toBe('column')
    expect(getComputedStyle(sidebar!).display).toBe('flex')
    expect(getComputedStyle(resizeHandle).display).toBe('none')

    const workspaceButton = view.getByRole('button', { name: /Project One/ })
    const threadButton = view.getByRole('button', { name: /Thread One/ })
    workspaceButton.focus()
    expect(document.activeElement).toBe(workspaceButton)
    threadButton.focus()
    expect(document.activeElement).toBe(threadButton)

    fireEvent.click(workspaceButton)
    fireEvent.click(threadButton)
    expect(view.selectWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(view.selectThread).toHaveBeenCalledWith('thread-1')
  })

  it('renders an accessible pending-decision count badge for a thread', () => {
    const view = renderSidebar({ decisionCount: { 'thread-1': 2 } })

    const badge = view.getByRole('status', { name: '2 pending decisions' })
    expect(badge.textContent).toBe('2')
  })

  it('gives narrow-viewport icon controls robust names, 24px targets, and a visible focus style', () => {
    const view = renderSidebar({ search: 'Thread' })
    const clearSearch = view.getByRole('button', { name: 'Clear search' })
    const addSession = view.getByRole('button', { name: 'New session in folder' })

    expect(clearSearch.getAttribute('aria-label')).toBe('Clear search')
    expect(addSession.getAttribute('aria-label')).toBe('New session in folder')
    expect(parseFloat(getComputedStyle(clearSearch).width)).toBeGreaterThanOrEqual(24)
    expect(parseFloat(getComputedStyle(clearSearch).height)).toBeGreaterThanOrEqual(24)

    clearSearch.focus()
    expect(document.activeElement).toBe(clearSearch)
    expect(styles).toContain('.wb-sidebar button:focus-visible')
  })

  it('uses one 312px default for the CSS token and appearance initialization', () => {
    const appearanceSource = readFileSync(join(process.cwd(), 'src/renderer/appearance.ts'), 'utf8')

    expect(styles).toMatch(/--wb-sidebar-width:\s*312px/)
    expect(appearanceSource).toContain("root.style.setProperty('--wb-sidebar-width', '312px')")
  })
})
