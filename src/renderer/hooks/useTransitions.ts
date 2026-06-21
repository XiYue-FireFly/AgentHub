/**
 * useTransitions: CSS transition utilities for glassmorphism UI.
 *
 * Provides reusable transition presets for panel slides, fades,
 * and scale animations. Respects prefers-reduced-motion.
 *
 * Phase 4.2: Animation system.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

export interface TransitionConfig {
  /** CSS transition property */
  property: string
  /** Duration in ms */
  duration: number
  /** Easing function */
  easing: string
  /** Delay in ms */
  delay?: number
}

/** Predefined transition presets */
export const TRANSITIONS = {
  /** Panel slide in/out */
  slideIn: { property: 'transform, opacity', duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  slideOut: { property: 'transform, opacity', duration: 150, easing: 'ease-in' },

  /** Fade in/out */
  fadeIn: { property: 'opacity', duration: 200, easing: 'ease-out' },
  fadeOut: { property: 'opacity', duration: 150, easing: 'ease-in' },

  /** Scale pop (for modals/popovers) */
  scaleIn: { property: 'transform, opacity', duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },

  /** Height expand (for collapsible sections) */
  expand: { property: 'height, opacity', duration: 250, easing: 'ease-out' },

  /** Background color */
  color: { property: 'background-color, color, border-color', duration: 150, easing: 'ease' },

  /** Generic hover */
  hover: { property: 'all', duration: 100, easing: 'ease' }
} as const

/** Convert TransitionConfig to CSS transition string */
export function toTransitionString(config: TransitionConfig): string {
  const delay = config.delay ? ` ${config.delay}ms` : ''
  return `${config.property} ${config.duration}ms ${config.easing}${delay}`
}

/**
 * Check if user prefers reduced motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

/**
 * Transition-aware visibility hook.
 * Returns { visible, mounted } for use with CSS transitions.
 * Use `mounted` for mount/unmount, `visible` for transition class.
 */
export function useTransitionState(open: boolean, duration = 200) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Next frame: trigger transition-in
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else {
      setVisible(false)
      // Wait for transition-out, then unmount
      const timer = setTimeout(() => setMounted(false), duration)
      return () => clearTimeout(timer)
    }
  }, [open, duration])

  return { mounted, visible }
}

/**
 * Stagger animation for lists.
 * Returns a transition delay for each item based on its index.
 */
export function useStagger(itemCount: number, baseDelay = 30, maxDelay = 300) {
  return (index: number) => Math.min(index * baseDelay, maxDelay)
}
