/**
 * useResponsiveLayout: responsive layout detection hook.
 *
 * Detects window size and returns layout mode (desktop/tablet/phone).
 * Provides panel collapse states and sidebar visibility.
 *
 * Phase 4.3: Responsive layout.
 */

import { useState, useEffect, useMemo } from 'react'

export type LayoutMode = 'desktop' | 'tablet' | 'phone'

export interface ResponsiveLayout {
  mode: LayoutMode
  /** Sidebar visible on desktop/tablet, hidden on phone */
  sidebarVisible: boolean
  /** Right panel visible only on desktop */
  rightPanelVisible: boolean
  /** Bottom dock visible on desktop/tablet */
  bottomDockVisible: boolean
  /** Composer compact mode on phone */
  composerCompact: boolean
  /** Window width in pixels */
  width: number
  /** Window height in pixels */
  height: number
}

const BREAKPOINTS = {
  phone: 640,
  tablet: 1024
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)
  const [height, setHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // LOW-16: rAF throttle to avoid excessive re-renders during resize
    let rafId = 0
    const onResize = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        setWidth(window.innerWidth)
        setHeight(window.innerHeight)
      })
    }

    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  const mode: LayoutMode = width < BREAKPOINTS.phone ? 'phone'
    : width < BREAKPOINTS.tablet ? 'tablet'
    : 'desktop'

  return useMemo(() => ({
    mode,
    sidebarVisible: mode !== 'phone',
    rightPanelVisible: mode === 'desktop',
    bottomDockVisible: mode !== 'phone',
    composerCompact: mode === 'phone',
    width,
    height
  }), [mode, width, height])
}

/**
 * Clamp inspector width based on viewport.
 */
export function clampInspectorWidth(
  width: number,
  viewportWidth: number,
  minWidth = 340,
  maxWidth = 760
): number {
  const sidebarAndMain = viewportWidth > 1160 ? 292 + 560 + 40 : 290 + 420 + 32
  const responsiveMax = Math.max(minWidth, viewportWidth - sidebarAndMain)
  return Math.max(minWidth, Math.min(maxWidth, responsiveMax, Math.round(width)))
}
