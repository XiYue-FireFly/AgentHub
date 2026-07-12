import { useEffect, useRef, type RefObject } from 'react'
import { registerModalFocus } from '../lib/modalFocusStack'

interface ModalFocusOptions<T extends HTMLElement> {
  containerRef: RefObject<T>
  initialFocusRef?: RefObject<HTMLElement>
  onEscape: () => void
  active?: boolean
  activationKey?: unknown
}

export function useModalFocus<T extends HTMLElement>({
  containerRef,
  initialFocusRef,
  onEscape,
  active = true,
  activationKey
}: ModalFocusOptions<T>) {
  const onEscapeRef = useRef(onEscape)

  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return
    return registerModalFocus({
      container,
      initialFocus: initialFocusRef?.current,
      onEscape: () => onEscapeRef.current()
    })
  }, [active, activationKey, containerRef, initialFocusRef])
}
