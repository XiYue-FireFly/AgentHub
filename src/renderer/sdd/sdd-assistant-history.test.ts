// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAssistantHistorySession,
  getAssistantHistory,
  getAssistantHistoryState,
  saveAssistantHistory,
  setActiveAssistantHistorySession
} from './sdd-assistant-history'

afterEach(() => {
  localStorage.clear()
})

describe('sdd assistant history', () => {
  it('migrates legacy single-session history into a selectable session', () => {
    localStorage.setItem('sdd-assistant-history-E%3A%2Fworkspace::draft-legacy', JSON.stringify([
      {
        id: 'm-1',
        role: 'user',
        content: 'Legacy question',
        timestamp: '2026-07-06T01:00:00.000Z'
      },
      {
        id: 'm-2',
        role: 'assistant',
        content: 'Legacy answer',
        timestamp: '2026-07-06T01:01:00.000Z',
        mode: 'plan'
      }
    ]))

    const state = getAssistantHistoryState('draft-legacy', 'E:\\workspace')

    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].title).toContain('Legacy question')
    expect(state.sessions[0].messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Legacy question' }),
      expect.objectContaining({ role: 'assistant', content: 'Legacy answer', mode: undefined })
    ])
    expect(localStorage.getItem('sdd-assistant-history-v2-E%3A%2Fworkspace::draft-legacy')).toBeTruthy()
  })

  it('creates a new active session and keeps previous session messages selectable', () => {
    saveAssistantHistory('draft-1', 'E:\\workspace', [
      {
        id: 'first-user',
        role: 'user',
        content: 'First question',
        timestamp: '2026-07-06T01:00:00.000Z'
      }
    ])
    const firstState = getAssistantHistoryState('draft-1', 'E:\\workspace')

    const secondState = createAssistantHistorySession('draft-1', 'E:\\workspace')
    expect(secondState.activeSessionId).not.toBe(firstState.activeSessionId)
    expect(getAssistantHistory('draft-1', 'E:\\workspace', secondState.activeSessionId)).toEqual([])

    saveAssistantHistory('draft-1', 'E:\\workspace', [
      {
        id: 'second-user',
        role: 'user',
        content: 'Second question',
        timestamp: '2026-07-06T02:00:00.000Z'
      }
    ], secondState.activeSessionId)

    const restoredFirst = setActiveAssistantHistorySession('draft-1', 'E:\\workspace', firstState.activeSessionId)
    expect(restoredFirst.activeSessionId).toBe(firstState.activeSessionId)
    expect(getAssistantHistory('draft-1', 'E:\\workspace', firstState.activeSessionId)).toEqual([
      expect.objectContaining({ content: 'First question' })
    ])
  })
})
