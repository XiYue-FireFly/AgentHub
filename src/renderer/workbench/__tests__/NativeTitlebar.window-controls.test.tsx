// @vitest-environment happy-dom
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeTitlebar } from '../NativeTitlebar'
import { resolveKeyboardShortcutBindings } from '../../keyboard-shortcuts'

const shortcuts = resolveKeyboardShortcutBindings()

function renderTitlebar() {
  return render(
    <NativeTitlebar
      hubRunning={true}
      search=""
      setSearch={vi.fn()}
      view="chat"
      setView={vi.fn()}
      createThread={vi.fn(async () => undefined)}
      openCreateProject={vi.fn()}
      openSetup={vi.fn()}
      setRightPanel={vi.fn()}
      shortcuts={shortcuts}
    />
  )
}

describe('NativeTitlebar window controls', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.dataset.uiStyle = 'mac'
    localStorage.setItem('ah-appearance', JSON.stringify({ uiStyle: 'win' }))
    ;(window as any).electronAPI = {
      app: { openExternal: vi.fn() },
      platform: 'win32',
      win: {
        minimize: vi.fn(),
        maximizeToggle: vi.fn(),
        close: vi.fn()
      }
    }
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    delete (window as any).electronAPI
    delete document.documentElement.dataset.uiStyle
  })

  it('keeps Windows window controls mounted even when the selected visual style is mac', () => {
    const view = renderTitlebar()

    expect(view.container.querySelector('.wb-titlebar.platform-win32')).toBeTruthy()
    expect(view.container.querySelector('.wb-traffic-lights')).toBeNull()
    fireEvent.click(view.getByTitle('Minimize'))
    fireEvent.click(view.getByTitle('Maximize'))
    fireEvent.click(view.getByTitle('Close'))

    expect(window.electronAPI.win.minimize).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.win.maximizeToggle).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.win.close).toHaveBeenCalledTimes(1)
  })

  it('only hides Windows controls for the native macOS titlebar variant', () => {
    const css = readFileSync(join(process.cwd(), 'src/renderer/globals.css'), 'utf8')

    expect(css).toContain('[data-ui-style="mac"] .wb-titlebar.platform-darwin .wb-window-actions')
    expect(css).not.toContain('[data-ui-style="mac"] .wb-titlebar .wb-window-actions')
  })
})
