// @vitest-environment happy-dom
import React, { useState } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})
