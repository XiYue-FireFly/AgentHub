export type ThemeMode = 'light' | 'dark' | 'system'
export type MotionLevel = 'off' | 'subtle' | 'rich'
export type DiffMarkerStyle = 'color' | 'sign'
export type DefaultOpenTarget = 'chat' | 'last' | 'settings'
export type AgentEnvironment = 'inherit' | 'clean' | 'login-shell'
export type TerminalShell = 'system' | 'powershell' | 'cmd' | 'git-bash' | 'wsl'

export interface AppearancePreferences {
  themeMode: ThemeMode
  accentColor: string
  backgroundColor: string
  foregroundColor: string
  uiFont: string
  codeFont: string
  uiFontSize: number
  codeFontSize: number
  translucentSidebar: boolean
  usePointerCursor: boolean
  contrast: number
  motion: MotionLevel
  diffMarker: DiffMarkerStyle
  defaultOpenTarget: DefaultOpenTarget
  agentEnvironment: AgentEnvironment
  terminalShell: TerminalShell
  language: 'zh' | 'en'
}

export const APPEARANCE_KEY = 'appearance.preferences'
const LOCAL_KEY = 'ah-appearance'

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  themeMode: 'system',
  accentColor: '#2f6feb',
  backgroundColor: '#f7f8fb',
  foregroundColor: '#20242c',
  uiFont: '-apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  codeFont: 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace',
  uiFontSize: 14,
  codeFontSize: 13,
  translucentSidebar: false,
  usePointerCursor: true,
  contrast: 100,
  motion: 'rich',
  diffMarker: 'color',
  defaultOpenTarget: 'chat',
  agentEnvironment: 'inherit',
  terminalShell: 'system',
  language: 'zh'
}

export function normalizeAppearance(input: Partial<AppearancePreferences> | null | undefined): AppearancePreferences {
  const value = input && typeof input === 'object' ? input : {}
  return {
    ...DEFAULT_APPEARANCE,
    themeMode: pick(value.themeMode, ['light', 'dark', 'system'], DEFAULT_APPEARANCE.themeMode),
    accentColor: color(value.accentColor, DEFAULT_APPEARANCE.accentColor),
    backgroundColor: color(value.backgroundColor, DEFAULT_APPEARANCE.backgroundColor),
    foregroundColor: color(value.foregroundColor, DEFAULT_APPEARANCE.foregroundColor),
    uiFont: text(value.uiFont, DEFAULT_APPEARANCE.uiFont),
    codeFont: text(value.codeFont, DEFAULT_APPEARANCE.codeFont),
    uiFontSize: clampNumber(value.uiFontSize, 12, 18, DEFAULT_APPEARANCE.uiFontSize),
    codeFontSize: clampNumber(value.codeFontSize, 11, 18, DEFAULT_APPEARANCE.codeFontSize),
    translucentSidebar: typeof value.translucentSidebar === 'boolean' ? value.translucentSidebar : DEFAULT_APPEARANCE.translucentSidebar,
    usePointerCursor: typeof value.usePointerCursor === 'boolean' ? value.usePointerCursor : DEFAULT_APPEARANCE.usePointerCursor,
    contrast: clampNumber(value.contrast, 80, 125, DEFAULT_APPEARANCE.contrast),
    motion: pick(value.motion, ['off', 'subtle', 'rich'], DEFAULT_APPEARANCE.motion),
    diffMarker: pick(value.diffMarker, ['color', 'sign'], DEFAULT_APPEARANCE.diffMarker),
    defaultOpenTarget: pick(value.defaultOpenTarget, ['chat', 'last', 'settings'], DEFAULT_APPEARANCE.defaultOpenTarget),
    agentEnvironment: pick(value.agentEnvironment, ['inherit', 'clean', 'login-shell'], DEFAULT_APPEARANCE.agentEnvironment),
    terminalShell: pick(value.terminalShell, ['system', 'powershell', 'cmd', 'git-bash', 'wsl'], DEFAULT_APPEARANCE.terminalShell),
    language: pick(value.language, ['zh', 'en'], DEFAULT_APPEARANCE.language)
  }
}

export function readAppearanceLocal(): AppearancePreferences {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) {
      const motion = localStorage.getItem('ah-motion') as MotionLevel | null
      const language = localStorage.getItem('ah-lang') as 'zh' | 'en' | null
      return normalizeAppearance({ motion: motion || undefined, language: language || undefined })
    }
    return normalizeAppearance(JSON.parse(raw))
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function writeAppearanceLocal(preferences: AppearancePreferences): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(preferences))
    localStorage.setItem('ah-motion', preferences.motion)
    localStorage.setItem('ah-lang', preferences.language)
  } catch {
    /* noop */
  }
}

export async function loadAppearance(): Promise<AppearancePreferences> {
  const local = readAppearanceLocal()
  try {
    const stored = await window.electronAPI?.store?.get?.(APPEARANCE_KEY)
    const next = normalizeAppearance(stored || local)
    writeAppearanceLocal(next)
    return next
  } catch {
    return local
  }
}

export async function saveAppearance(preferences: AppearancePreferences): Promise<AppearancePreferences> {
  const next = normalizeAppearance(preferences)
  writeAppearanceLocal(next)
  try { window.dispatchEvent(new CustomEvent('agenthub:appearance-change', { detail: next })) } catch { /* noop */ }
  try { await window.electronAPI?.store?.set?.(APPEARANCE_KEY, next) } catch { /* noop */ }
  return next
}

export function applyAppearance(preferences: AppearancePreferences): void {
  const root = document.documentElement
  const resolvedTheme = resolveTheme(preferences.themeMode)
  const palette = resolvedTheme === 'dark' ? DARK_THEME_TOKENS : LIGHT_THEME_TOKENS
  const background = coerceThemeColor(preferences.backgroundColor, resolvedTheme, 'background')
  const foreground = coerceThemeColor(preferences.foregroundColor, resolvedTheme, 'foreground')
  root.dataset.theme = resolvedTheme
  root.dataset.themeMode = preferences.themeMode
  root.dataset.motion = preferences.motion
  root.dataset.diffMarker = preferences.diffMarker
  root.dataset.pointerCursor = preferences.usePointerCursor ? 'on' : 'off'
  root.dataset.translucentSidebar = preferences.translucentSidebar ? 'on' : 'off'
  root.style.setProperty('--font-ui', preferences.uiFont)
  root.style.setProperty('--font-mono', preferences.codeFont)
  root.style.setProperty('--ah-ui-font-size', `${preferences.uiFontSize}px`)
  root.style.setProperty('--ah-code-font-size', `${preferences.codeFontSize}px`)
  root.style.setProperty('--wb-accent', preferences.accentColor)
  root.style.setProperty('--mint', preferences.accentColor)
  root.style.setProperty('--wb-accent-soft', rgbaFromHex(preferences.accentColor, resolvedTheme === 'dark' ? 0.2 : 0.12))
  root.style.setProperty('--mint-soft', rgbaFromHex(preferences.accentColor, resolvedTheme === 'dark' ? 0.2 : 0.12))
  root.style.setProperty('--mint-line', rgbaFromHex(preferences.accentColor, resolvedTheme === 'dark' ? 0.46 : 0.36))
  root.style.setProperty('--wb-bg', background)
  root.style.setProperty('--bg-0', background)
  root.style.setProperty('--bg-1', background)
  root.style.setProperty('--wb-panel', palette.panel)
  root.style.setProperty('--wb-sidebar', palette.sidebar)
  root.style.setProperty('--wb-line', palette.line)
  root.style.setProperty('--wb-line-soft', palette.lineSoft)
  root.style.setProperty('--wb-muted', palette.muted)
  root.style.setProperty('--wb-faint', palette.faint)
  root.style.setProperty('--glass-bg', palette.glass)
  root.style.setProperty('--glass-bg-strong', palette.glassStrong)
  root.style.setProperty('--glass-border', palette.line)
  root.style.setProperty('--glass-border-strong', palette.lineStrong)
  root.style.setProperty('--wb-text', foreground)
  root.style.setProperty('--tx-1', foreground)
  root.style.setProperty('--tx-2', palette.secondaryText)
  root.style.setProperty('--tx-3', palette.muted)
  root.style.setProperty('--ah-contrast', String(preferences.contrast / 100))
}

export function subscribeSystemTheme(preferences: AppearancePreferences, callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (preferences.themeMode === 'system') callback()
  }
  media.addEventListener?.('change', handler)
  return () => media.removeEventListener?.('change', handler)
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const LIGHT_PRESET = {
  background: '#f7f8fb',
  foreground: '#20242c'
}

const DARK_PRESET = {
  background: '#10141c',
  foreground: '#e7edf7'
}

const LIGHT_THEME_TOKENS = {
  panel: '#ffffff',
  sidebar: '#eef2f7',
  line: '#dfe5ee',
  lineSoft: '#edf0f5',
  lineStrong: '#cfd8e6',
  muted: '#7b8494',
  faint: '#aab2c0',
  secondaryText: '#515b6b',
  glass: 'rgba(255, 255, 255, 0.78)',
  glassStrong: '#ffffff'
}

const DARK_THEME_TOKENS = {
  panel: '#161b24',
  sidebar: '#131923',
  line: '#2a3443',
  lineSoft: '#222b38',
  lineStrong: '#354154',
  muted: '#a4afbf',
  faint: '#748095',
  secondaryText: '#c5cfde',
  glass: 'rgba(22, 27, 36, 0.86)',
  glassStrong: '#161b24'
}

function coerceThemeColor(value: string, theme: 'light' | 'dark', kind: 'background' | 'foreground'): string {
  const current = value.toLowerCase()
  const light = LIGHT_PRESET[kind]
  const dark = DARK_PRESET[kind]
  if (theme === 'dark' && current === light) return dark
  if (theme === 'light' && current === dark) return light
  return value
}

function rgbaFromHex(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return `rgba(47, 111, 235, ${alpha})`
  const value = match[1]
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
