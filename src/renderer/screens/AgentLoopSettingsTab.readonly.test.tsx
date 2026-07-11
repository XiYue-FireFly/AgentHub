// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../glass/i18n'
import { AgentLoopSettingsTab } from './AgentLoopSettingsTab'

function installElectronApi() {
  const getRouteInfo = vi.fn(async () => ({
    taskType: 'implementation',
    selectedAgent: 'codex',
    confidence: 0.9,
    reasoning: 'Best implementation fit',
    suggestedRole: 'implementer'
  }))
  const api = {
    agentLoop: {
      getConfig: vi.fn(async () => ({
        maxSteps: 12,
        timeoutMs: 180000,
        enableDelegation: true,
        mode: 'auto' as const
      })),
      getRouteInfo
    },
    localAgents: {
      status: vi.fn(async () => [])
    }
  }
  ;(window as any).electronAPI = api
  return { api, getRouteInfo }
}

describe('AgentLoopSettingsTab unavailable execution settings', () => {
  beforeEach(() => {
    setLang('en')
  })

  afterEach(() => {
    cleanup()
    setLang('zh')
    delete (window as any).electronAPI
  })

  it('shows execution configuration as an explicit read-only preview', async () => {
    installElectronApi()
    render(<AgentLoopSettingsTab />)

    const heading = await screen.findByText('Loop Configuration')
    const section = heading.closest('section')
    expect(section).not.toBeNull()
    expect(within(section!).getByText(
      'This is a read-only preview. Agent Loop execution settings are not connected yet and cannot be changed here.'
    )).toBeTruthy()

    const readonlyValues = [
      ['Default Mode', 'Auto Route'],
      ['Max Steps', '12'],
      ['Timeout(ms)', '180000 ms'],
      ['Delegation', 'Enabled']
    ] as const
    for (const [name, value] of readonlyValues) {
      const status = within(section!).getByRole('status', { name })
      expect(status.textContent).toBe(value)
    }

    expect(section!.querySelector('input, select, button, textarea')).toBeNull()
    const editableContent = Array.from(section!.querySelectorAll<HTMLElement>('[contenteditable]'))
      .filter((element) => element.getAttribute('contenteditable')?.toLowerCase() !== 'false')
    expect(editableContent).toEqual([])
  })

  it('keeps route preview available while execution settings are read-only', async () => {
    const { getRouteInfo } = installElectronApi()
    render(<AgentLoopSettingsTab />)

    const prompt = await screen.findByPlaceholderText('Enter your task description to test Agent routing...')
    fireEvent.change(prompt, { target: { value: 'Implement a parser' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Route' }))

    await waitFor(() => expect(getRouteInfo).toHaveBeenCalledWith('Implement a parser'))
    expect(await screen.findByText('Best implementation fit')).toBeTruthy()
  })
})
