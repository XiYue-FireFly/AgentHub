// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { useSddDraftStore, type SddDraft } from '../sdd-draft-store'
import { SddRequirementsList } from './SddRequirementsList'

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Resizable AI',
  content: '# Resizable AI\n',
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z'
}

function installElectronApi() {
  ;(window as any).electronAPI = {
    ai: {
      quickComplete: vi.fn(async () => ({ ok: true, content: 'ok' }))
    },
    sdd: {
      listDrafts: vi.fn(async () => [draft]),
      createDraft: vi.fn(),
      getDraft: vi.fn(async () => draft),
      getTrace: vi.fn(async () => null),
      updateDraft: vi.fn(),
      updateDesignContext: vi.fn(),
      deleteDraft: vi.fn(),
      parseBlocks: vi.fn(async () => []),
      computeTrace: vi.fn(),
      saveTrace: vi.fn(),
      exists: vi.fn()
    },
    todos: {
      syncFromMarkdown: vi.fn()
    }
  }
}

describe('SddRequirementsList assistant resize', () => {
  beforeEach(() => {
    setLang('en')
    localStorage.clear()
    installElectronApi()
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    delete (window as any).electronAPI
    useSddDraftStore.getState().clearDraft()
  })

  it('lets the requirements AI panel width grow by dragging the split handle', async () => {
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Resizable AI'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    fireEvent.click(view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement)

    const layout = view.container.querySelector('.sdd-requirements-full') as HTMLElement
    const handle = await view.findByRole('separator', { name: /Resize requirements AI panel/ })
    expect(layout.style.getPropertyValue('--sdd-assistant-width')).toBe('420px')

    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 760, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 760, pointerId: 1 })

    await waitFor(() => expect(layout.style.getPropertyValue('--sdd-assistant-width')).toBe('560px'))
    expect(localStorage.getItem('sdd.assistantPanelWidth')).toBe('560')
  })

  it('keeps the requirements surface and assistant width rules compatible', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/renderer/globals.css'), 'utf8')
    const assistantPanelRule = css.match(/\.sdd-assistant-panel\s*\{[^}]+\}/)?.[0] ?? ''

    expect(css).toContain('.wb-requirements-surface')
    expect(css).toContain('minmax(360px, var(--sdd-assistant-width, 420px))')
    expect(assistantPanelRule).toContain('min-width: 0;')
    expect(assistantPanelRule).not.toContain('min-width: 420px;')
  })
})
