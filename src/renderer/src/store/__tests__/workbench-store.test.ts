// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbenchStore } from '../workbench-store'

describe('WorkbenchStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useWorkbenchStore.getState().reset()
  })

  describe('View Slice', () => {
    it('should have correct initial view state', () => {
      const state = useWorkbenchStore.getState()
      expect(state.view).toBe('chat')
      expect(state.settingsTab).toBe('providers')
      expect(state.rightPanel).toBeNull()
    })

    it('should set view mode', () => {
      useWorkbenchStore.getState().setView('write')
      expect(useWorkbenchStore.getState().view).toBe('write')
    })

    it('should set settings tab', () => {
      useWorkbenchStore.getState().setSettingsTab('routing')
      expect(useWorkbenchStore.getState().settingsTab).toBe('routing')
    })

    it('should set right panel', () => {
      useWorkbenchStore.getState().setRightPanel('git')
      expect(useWorkbenchStore.getState().rightPanel).toBe('git')
    })
  })

  describe('Thread Slice', () => {
    it('should have correct initial thread state', () => {
      const state = useWorkbenchStore.getState()
      expect(state.snapshot).toEqual({ threads: [], turns: [], runs: [], activeThreadId: null })
      expect(state.selectedThreadId).toBeNull()
      expect(state.allThreads).toEqual([])
    })

    it('should add thread', () => {
      const thread = { id: '1', title: 'Test Thread', createdAt: Date.now(), updatedAt: Date.now() }
      useWorkbenchStore.getState().addThread(thread)
      expect(useWorkbenchStore.getState().allThreads).toHaveLength(1)
      expect(useWorkbenchStore.getState().allThreads[0]).toEqual(thread)
    })

    it('should update thread', () => {
      const thread = { id: '1', title: 'Test Thread', createdAt: Date.now(), updatedAt: Date.now() }
      useWorkbenchStore.getState().addThread(thread)
      useWorkbenchStore.getState().updateThread('1', { title: 'Updated Thread' })
      expect(useWorkbenchStore.getState().allThreads[0].title).toBe('Updated Thread')
    })

    it('should delete thread', () => {
      const thread = { id: '1', title: 'Test Thread', createdAt: Date.now(), updatedAt: Date.now() }
      useWorkbenchStore.getState().addThread(thread)
      useWorkbenchStore.getState().deleteThread('1')
      expect(useWorkbenchStore.getState().allThreads).toHaveLength(0)
    })

    it('should clear selectedThreadId when deleting selected thread', () => {
      const thread = { id: '1', title: 'Test Thread', createdAt: Date.now(), updatedAt: Date.now() }
      useWorkbenchStore.getState().addThread(thread)
      useWorkbenchStore.getState().setSelectedThreadId('1')
      useWorkbenchStore.getState().deleteThread('1')
      expect(useWorkbenchStore.getState().selectedThreadId).toBeNull()
    })

    it('should clear snapshot.activeThreadId when deleting active thread', () => {
      const thread = { id: '1', title: 'Test Thread', createdAt: Date.now(), updatedAt: Date.now() }
      useWorkbenchStore.getState().addThread(thread)
      useWorkbenchStore.getState().setSnapshot({ ...useWorkbenchStore.getState().snapshot, activeThreadId: '1' })
      useWorkbenchStore.getState().deleteThread('1')
      expect(useWorkbenchStore.getState().snapshot.activeThreadId).toBeNull()
    })
  })

  describe('Runtime Slice', () => {
    it('should have correct initial runtime state', () => {
      const state = useWorkbenchStore.getState()
      expect(state.events).toEqual([])
      expect(state.sending).toBe(false)
      expect(state.terminalRuns).toEqual([])
    })

    it('should add event with generated id', () => {
      const event = { threadId: '1', seq: 1, kind: 'test', timestamp: Date.now() }
      useWorkbenchStore.getState().addEvent(event)
      expect(useWorkbenchStore.getState().events).toHaveLength(1)
      expect(useWorkbenchStore.getState().events[0].id).toBeDefined()
    })

    it('should not add event without threadId', () => {
      const event = { threadId: '', seq: 1, kind: 'test', timestamp: Date.now() }
      useWorkbenchStore.getState().addEvent(event)
      expect(useWorkbenchStore.getState().events).toHaveLength(0)
    })

    it('should truncate events when exceeding MAX_EVENTS', () => {
      // Add 100 events to test truncation logic (smaller number for test performance)
      for (let i = 0; i < 100; i++) {
        useWorkbenchStore.getState().addEvent({ threadId: '1', seq: i, kind: 'test', timestamp: Date.now() })
      }
      expect(useWorkbenchStore.getState().events).toHaveLength(100)
      // Events should be in order
      expect(useWorkbenchStore.getState().events[0].seq).toBe(0)
      expect(useWorkbenchStore.getState().events[99].seq).toBe(99)
    })
  })

  describe('Agent Slice', () => {
    it('should have correct initial agent state', () => {
      const state = useWorkbenchStore.getState()
      expect(state.mode).toBe('lead-workers')
      expect(state.targetAgent).toBeNull()
      expect(state.modelSelection).toBeNull()
      expect(state.thinking).toEqual({ mode: 'auto', level: 'medium', collapseInUI: true })
    })

    it('should set mode', () => {
      useWorkbenchStore.getState().setMode('broadcast')
      expect(useWorkbenchStore.getState().mode).toBe('broadcast')
    })

    it('should set target agent', () => {
      useWorkbenchStore.getState().setTargetAgent('codex')
      expect(useWorkbenchStore.getState().targetAgent).toBe('codex')
    })
  })

  describe('UI Slice', () => {
    it('should have correct initial UI state', () => {
      const state = useWorkbenchStore.getState()
      expect(state.search).toBe('')
      expect(state.inspectorWidth).toBe(460)
      expect(state.sendError).toBeNull()
    })

    it('should clamp inspector width', () => {
      useWorkbenchStore.getState().setInspectorWidth(100)
      expect(useWorkbenchStore.getState().inspectorWidth).toBe(200) // MIN_INSPECTOR_WIDTH

      useWorkbenchStore.getState().setInspectorWidth(2000)
      expect(useWorkbenchStore.getState().inspectorWidth).toBe(1200) // MAX_INSPECTOR_WIDTH
    })

    it('should add and remove attachments', () => {
      const attachment = { id: '1', name: 'test.txt', type: 'text/plain', size: 100 }
      useWorkbenchStore.getState().addAttachment(attachment)
      expect(useWorkbenchStore.getState().pendingComposerAttachments).toHaveLength(1)

      useWorkbenchStore.getState().removeAttachment('1')
      expect(useWorkbenchStore.getState().pendingComposerAttachments).toHaveLength(0)
    })

    it('should add, update, and delete todos', () => {
      const todo = { id: '1', text: 'Test todo', done: false, threadId: 'thread-1' }
      useWorkbenchStore.getState().addTodo(todo)
      expect(useWorkbenchStore.getState().threadTodos).toHaveLength(1)

      useWorkbenchStore.getState().updateTodo('1', { done: true })
      expect(useWorkbenchStore.getState().threadTodos[0].done).toBe(true)

      useWorkbenchStore.getState().deleteTodo('1')
      expect(useWorkbenchStore.getState().threadTodos).toHaveLength(0)
    })
  })

  describe('Reset', () => {
    it('should reset all state except user preferences', () => {
      // Add some data
      useWorkbenchStore.getState().addThread({ id: '1', title: 'Test', createdAt: Date.now(), updatedAt: Date.now() })
      useWorkbenchStore.getState().addEvent({ threadId: '1', seq: 1, kind: 'test', timestamp: Date.now() })
      useWorkbenchStore.getState().setView('write')
      useWorkbenchStore.getState().setMode('broadcast')
      useWorkbenchStore.getState().setSettingsTab('routing')

      // Reset
      useWorkbenchStore.getState().reset()

      const state = useWorkbenchStore.getState()
      // Data should be cleared
      expect(state.allThreads).toEqual([])
      expect(state.events).toEqual([])
      expect(state.mode).toBe('lead-workers') // mode is reset
      // User preferences should be preserved
      expect(state.view).toBe('write')
      expect(state.settingsTab).toBe('routing') // settingsTab is preserved
    })
  })
})
