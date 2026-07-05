import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH, MIN_INSPECTOR_WIDTH } from '../WorkbenchPanels'
import {
  ANNOUNCEMENT_STORE_KEY,
  LAST_VIEW_STORE_KEY,
  resetWorkbenchUiStoreForTests,
  useWorkbenchUiStore
} from '../state/ui-store'

function installLocalStorageStub() {
  const values = new Map<string, string>()
  const storage = {
    get length() { return values.size },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, String(value)) })
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })
}

describe('workbench ui store', () => {
  beforeEach(() => {
    installLocalStorageStub()
    localStorage.clear()
    resetWorkbenchUiStoreForTests()
  })

  it('restores the startup settings target and persists the selected view', () => {
    useWorkbenchUiStore.getState().applyStartupView('settings')

    expect(useWorkbenchUiStore.getState()).toMatchObject({
      view: 'settings',
      settingsTab: 'appearance'
    })
    expect(localStorage.getItem(LAST_VIEW_STORE_KEY)).toBe('settings')
  })

  it('restores the last valid view and ignores malformed values', () => {
    localStorage.setItem(LAST_VIEW_STORE_KEY, 'requirements')
    useWorkbenchUiStore.getState().applyStartupView('last')
    expect(useWorkbenchUiStore.getState().view).toBe('requirements')

    localStorage.setItem(LAST_VIEW_STORE_KEY, 'providers')
    useWorkbenchUiStore.getState().setView('chat')
    useWorkbenchUiStore.getState().applyStartupView('last')
    expect(useWorkbenchUiStore.getState().view).toBe('chat')
  })

  it('resets to chat for default startup targets instead of leaking a prior mount view', () => {
    useWorkbenchUiStore.getState().setView('requirements')
    useWorkbenchUiStore.getState().applyStartupView('chat')

    expect(useWorkbenchUiStore.getState().view).toBe('chat')
  })

  it('stores side panel and command palette state', () => {
    useWorkbenchUiStore.getState().setRightPanel('git')
    useWorkbenchUiStore.getState().setCommandPaletteOpen(true)
    useWorkbenchUiStore.getState().setCommandPaletteOpen(previous => !previous)

    expect(useWorkbenchUiStore.getState().rightPanel).toBe('git')
    expect(useWorkbenchUiStore.getState().commandPaletteOpen).toBe(false)
  })

  it('clamps hydrated and previewed inspector widths', () => {
    useWorkbenchUiStore.getState().hydrateInspectorWidth('wide')
    expect(useWorkbenchUiStore.getState().inspectorWidth).toBe(DEFAULT_INSPECTOR_WIDTH)

    useWorkbenchUiStore.getState().hydrateInspectorWidth(9999, 4000)
    expect(useWorkbenchUiStore.getState().inspectorWidth).toBe(MAX_INSPECTOR_WIDTH)

    useWorkbenchUiStore.getState().setInspectorWidth(1, 4000)
    expect(useWorkbenchUiStore.getState().inspectorWidth).toBe(MIN_INSPECTOR_WIDTH)
  })

  it('marks the first-run announcement as seen when closed', () => {
    useWorkbenchUiStore.getState().setAnnouncementOpen(true)
    useWorkbenchUiStore.getState().closeAnnouncement()

    expect(useWorkbenchUiStore.getState().announcementOpen).toBe(false)
    expect(localStorage.getItem(ANNOUNCEMENT_STORE_KEY)).toBe('seen')
  })

  it('treats localStorage failures as non-fatal', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => useWorkbenchUiStore.getState().setView('tasks')).not.toThrow()
    expect(useWorkbenchUiStore.getState().view).toBe('tasks')
    spy.mockRestore()
  })
})
