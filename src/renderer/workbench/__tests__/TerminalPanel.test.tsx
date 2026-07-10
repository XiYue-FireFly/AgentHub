// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalPanel } from '../TerminalPanel'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: any = {}
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
    onData() { return { dispose() {} } }
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() { return { cols: 80, rows: 24 } }
  }
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {}
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function TerminalWorkspaceHarness() {
  const [workspaceRoot, setWorkspaceRoot] = useState('E:/workspace-a')
  return (
    <>
      <button onClick={() => setWorkspaceRoot('E:/workspace-b')}>workspace-b</button>
      <button onClick={() => setWorkspaceRoot('E:/workspace-a')}>workspace-a</button>
      <TerminalPanel workspaceRoot={workspaceRoot} />
    </>
  )
}

describe('TerminalPanel', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('remembers latest tab state when switching workspaces', async () => {
    ;(globalThis as any).ResizeObserver = ResizeObserverMock
    ;(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }
    ;(globalThis as any).electronAPI = {
      terminalPty: {
        create: vi.fn(async () => ({ ok: true })),
        resize: vi.fn(),
        write: vi.fn(),
        dispose: vi.fn(),
        onData: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {})
      }
    }

    const view = render(<TerminalWorkspaceHarness />)

    await waitFor(() => expect(view.getByText('Terminal 1')).toBeTruthy())
    fireEvent.click(view.getByTitle(/New terminal|新建终端/))
    await waitFor(() => expect(view.getByText('Terminal 2')).toBeTruthy())

    fireEvent.click(view.getByText('workspace-b'))
    await waitFor(() => expect(view.queryByText('Terminal 2')).toBeNull())

    fireEvent.click(view.getByText('workspace-a'))
    await waitFor(() => expect(view.getByText('Terminal 2')).toBeTruthy())
  })

  it('does not dispose PTY when switching terminal tabs (F-W3)', async () => {
    ;(globalThis as any).ResizeObserver = ResizeObserverMock
    ;(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }
    const dispose = vi.fn()
    ;(globalThis as any).electronAPI = {
      terminalPty: {
        create: vi.fn(async () => ({ ok: true })),
        resize: vi.fn(),
        write: vi.fn(),
        dispose,
        onData: vi.fn(() => () => {}),
        onExit: vi.fn(() => () => {})
      }
    }

    const view = render(<TerminalPanel workspaceRoot="E:/workspace-a" />)
    await waitFor(() => expect(view.getAllByText('Terminal 1').length).toBeGreaterThan(0))
    fireEvent.click(view.getByTitle(/New terminal|新建终端/))
    await waitFor(() => expect(view.getAllByText('Terminal 2').length).toBeGreaterThan(0))
    // Switch back to first tab without closing
    fireEvent.click(view.getAllByText('Terminal 1')[0])
    await waitFor(() => expect((globalThis as any).electronAPI.terminalPty.create).toHaveBeenCalled())
    // Switching tabs should not kill PTY sessions (only tab close does)
    expect(dispose).not.toHaveBeenCalled()
  })
})
