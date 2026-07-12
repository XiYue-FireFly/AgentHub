// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang, type Lang } from '../../glass/i18n'
import { CommandPalette, type PaletteCommand } from '../CommandPalette'

const bilingualCommand: PaletteCommand = {
  id: 'open-file',
  label: 'Generic open',
  labelZh: '打开文件',
  labelEn: 'Open file'
}

describe('CommandPalette localization', () => {
  afterEach(() => {
    cleanup()
    setLang('zh')
  })

  it.each([
    { lang: 'zh', visibleLabel: '打开文件' },
    { lang: 'en', visibleLabel: 'Open file' }
  ] satisfies Array<{ lang: Lang; visibleLabel: string }>)('renders the $lang command label', ({ lang, visibleLabel }) => {
    setLang(lang)
    const view = renderPalette([bilingualCommand])

    expect(view.getByRole('option', { name: visibleLabel })).toBeTruthy()
  })

  it.each([
    { lang: 'zh', visibleLabel: '打开文件', hiddenLabel: 'Open file' },
    { lang: 'en', visibleLabel: 'Open file', hiddenLabel: '打开文件' }
  ] satisfies Array<{ lang: Lang; visibleLabel: string; hiddenLabel: string }>)('searches only the visible $lang label', ({ lang, visibleLabel, hiddenLabel }) => {
    setLang(lang)
    const view = renderPalette([bilingualCommand])
    const input = view.getByRole('combobox')

    fireEvent.change(input, { target: { value: visibleLabel } })
    expect(view.getByRole('option', { name: visibleLabel })).toBeTruthy()

    fireEvent.change(input, { target: { value: hiddenLabel } })
    expect(view.queryAllByRole('option')).toHaveLength(0)
  })

  it.each([
    {
      lang: 'zh',
      commands: [
        { id: 'generic-zh', label: 'Generic Chinese fallback', labelEn: 'English alternate' },
        { id: 'alternate-zh', label: '', labelEn: 'English alternate' }
      ],
      expectedLabels: ['Generic Chinese fallback', 'English alternate']
    },
    {
      lang: 'en',
      commands: [
        { id: 'generic-en', label: 'Generic English fallback', labelZh: '中文备选' },
        { id: 'alternate-en', label: '', labelZh: '中文备选' }
      ],
      expectedLabels: ['Generic English fallback', '中文备选']
    }
  ] satisfies Array<{ lang: Lang; commands: PaletteCommand[]; expectedLabels: string[] }>)('falls back deterministically for $lang labels', ({ lang, commands, expectedLabels }) => {
    setLang(lang)
    const view = renderPalette(commands)

    expect(view.getAllByRole('option').map(option => option.textContent)).toEqual(expectedLabels)
  })

  it('uses the command id as the visible and searchable final fallback in both languages', () => {
    const command: PaletteCommand = {
      id: 'fallback-command',
      label: '',
      labelZh: '',
      labelEn: ''
    }
    setLang('zh')
    const view = renderPalette([command])
    const input = view.getByRole('combobox')

    expect(view.getByRole('option', { name: command.id })).toBeTruthy()
    fireEvent.change(input, { target: { value: command.id } })
    expect(view.getByRole('option', { name: command.id })).toBeTruthy()

    act(() => setLang('en'))
    expect(view.getByRole('option', { name: command.id })).toBeTruthy()
    fireEvent.change(input, { target: { value: 'not-the-id' } })
    expect(view.queryAllByRole('option')).toHaveLength(0)
    fireEvent.change(input, { target: { value: command.id } })
    expect(view.getByRole('option', { name: command.id })).toBeTruthy()
  })

  it('rerenders visible labels and search results when the language changes', () => {
    setLang('zh')
    const view = renderPalette([bilingualCommand])
    const input = view.getByRole('combobox')
    fireEvent.change(input, { target: { value: '打开文件' } })
    expect(view.getByRole('option', { name: '打开文件' })).toBeTruthy()

    act(() => setLang('en'))

    expect(view.queryByRole('option', { name: '打开文件' })).toBeNull()
    expect(view.queryAllByRole('option')).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'Open file' } })
    expect(view.getByRole('option', { name: 'Open file' })).toBeTruthy()
  })
})

function renderPalette(commands: PaletteCommand[]) {
  return render(<CommandPalette commands={commands} onExecute={vi.fn()} onClose={vi.fn()} />)
}
