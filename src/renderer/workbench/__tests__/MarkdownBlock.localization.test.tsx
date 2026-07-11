// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang, type Lang } from '../../glass/i18n'
import { MarkdownBlock } from '../MarkdownBlock'

function installApi() {
  ;(window as any).electronAPI = {
    app: {
      openPath: vi.fn().mockResolvedValue({ ok: false, error: 'denied' }),
      resolvePath: vi.fn().mockResolvedValue({ ok: true, path: 'C:\\repo\\src\\main\\runtime\\mcp.ts' }),
      readTextFile: vi.fn().mockResolvedValue({ ok: true, path: 'C:\\repo\\src\\main\\runtime\\mcp.ts', content: 'test' })
    }
  }
}

describe('MarkdownBlock localization', () => {
  beforeEach(() => {
    localStorage.removeItem('ah-appearance')
    installApi()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    setLang('zh')
    localStorage.removeItem('ah-appearance')
    delete (window as any).electronAPI
    vi.restoreAllMocks()
  })

  it.each([
    ['zh', '默认：文件管理器', '在编辑器中打开', '打开方式', '复制解析后的路径', '打开失败：denied'],
    ['en', 'Default: file manager', 'Open in editor', 'Open with', 'Copy resolved path', 'Open failed: denied']
  ] as Array<[Lang, string, string, string, string, string]>)('localizes the real file-reference menu and failure state in %s', async (lang, target, openEditor, openWith, copyPath, failure) => {
    setLang(lang)
    render(<MarkdownBlock content={'Open `src/main/runtime/mcp.ts:145`.'} workspaceRoot="C:\\repo" />)

    const fileLink = document.querySelector('a[data-file-path]') as HTMLAnchorElement
    expect(fileLink).toBeTruthy()
    fireEvent.contextMenu(fileLink, { clientX: 20, clientY: 20 })

    expect(screen.getByText(target)).toBeTruthy()
    expect(screen.getByText(openWith)).toBeTruthy()
    expect(screen.getByRole('button', { name: copyPath })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: openEditor }))
    expect((await screen.findByRole('status')).textContent).toBe(failure)
  })
})
