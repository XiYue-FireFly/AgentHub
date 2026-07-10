import { describe, expect, it } from 'vitest'
import {
  deriveThreadTitleFromPrompt,
  isDefaultThreadTitle,
  maybeAutoTitle
} from '../thread-auto-title'

describe('thread-auto-title (IT-1)', () => {
  describe('isDefaultThreadTitle', () => {
    it('treats empty and known placeholders as default', () => {
      expect(isDefaultThreadTitle('')).toBe(true)
      expect(isDefaultThreadTitle('   ')).toBe(true)
      expect(isDefaultThreadTitle('New session')).toBe(true)
      expect(isDefaultThreadTitle('New chat')).toBe(true)
      expect(isDefaultThreadTitle('new chat')).toBe(true)
      expect(isDefaultThreadTitle('新对话')).toBe(true)
      expect(isDefaultThreadTitle('新会话')).toBe(true)
      expect(isDefaultThreadTitle('Untitled')).toBe(true)
      expect(isDefaultThreadTitle('Thread')).toBe(true)
      expect(isDefaultThreadTitle('Thread 1')).toBe(true)
    })

    it('rejects real titles and forks', () => {
      expect(isDefaultThreadTitle('Fix login bug')).toBe(false)
      expect(isDefaultThreadTitle('Fork: hello')).toBe(false)
      expect(isDefaultThreadTitle('Read the project')).toBe(false)
    })
  })

  describe('deriveThreadTitleFromPrompt', () => {
    it('uses first non-empty line and collapses whitespace', () => {
      expect(deriveThreadTitleFromPrompt('  hello world  ')).toBe('hello world')
      expect(deriveThreadTitleFromPrompt('line one\n\nline two')).toBe('line one')
      expect(deriveThreadTitleFromPrompt('a   b\tc')).toBe('a b c')
    })

    it('strips light markdown noise', () => {
      expect(deriveThreadTitleFromPrompt('# Heading title')).toBe('Heading title')
      expect(deriveThreadTitleFromPrompt('- list item')).toBe('list item')
      expect(deriveThreadTitleFromPrompt('```ts\nconst x = 1')).toBe('const x = 1')
    })

    it('truncates with ellipsis', () => {
      const long = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP'
      const title = deriveThreadTitleFromPrompt(long, 20)
      expect(title.endsWith('…')).toBe(true)
      expect(title.length).toBeLessThanOrEqual(20)
    })

    it('falls back for empty prompt', () => {
      expect(deriveThreadTitleFromPrompt('')).toBe('New session')
      expect(deriveThreadTitleFromPrompt('   \n  ')).toBe('New session')
    })
  })

  describe('maybeAutoTitle', () => {
    it('renames New chat / 新对话 placeholders', () => {
      expect(maybeAutoTitle('New chat', 'Explain React hooks')).toBe('Explain React hooks')
      expect(maybeAutoTitle('新对话', '修复登录 bug')).toBe('修复登录 bug')
      expect(maybeAutoTitle('New session', 'Investigate flaky test')).toBe('Investigate flaky test')
    })

    it('does not rename user-chosen titles', () => {
      expect(maybeAutoTitle('My project notes', 'something else')).toBeNull()
      expect(maybeAutoTitle('Fork: hello', 'next')).toBeNull()
    })

    it('returns null for empty prompt on default title', () => {
      expect(maybeAutoTitle('New session', '   ')).toBeNull()
    })
  })
})
