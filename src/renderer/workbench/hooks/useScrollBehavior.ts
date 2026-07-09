import { useCallback, useEffect, useRef } from 'react'

interface UseScrollBehaviorOptions {
  selectedThreadId: string | null
}

export function useScrollBehavior({ selectedThreadId }: UseScrollBehaviorOptions) {
  const threadScrollRef = useRef<HTMLElement | null>(null)
  const shouldStickToBottom = useRef(true)

  const handleThreadScroll = useCallback(() => {
    const el = threadScrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldStickToBottom.current = distanceFromBottom < 80
  }, [])

  // Stick to bottom when content grows (ResizeObserver) or thread switches — not on every render,
  // so the user can scroll up to read history without being yanked back down.
  useEffect(() => {
    const el = threadScrollRef.current
    if (!el) return
    // Reset stick-to-bottom on thread switch
    shouldStickToBottom.current = true
    const stick = () => {
      if (shouldStickToBottom.current) {
        el.scrollTop = el.scrollHeight
      }
    }
    stick()
    const ro = new ResizeObserver(() => stick())
    ro.observe(el)
    return () => ro.disconnect()
  }, [selectedThreadId])

  return {
    threadScrollRef,
    shouldStickToBottom,
    handleThreadScroll
  }
}
