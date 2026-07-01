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

  useEffect(() => {
    const el = threadScrollRef.current
    if (!el) return
    if (shouldStickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  })

  useEffect(() => {
    shouldStickToBottom.current = true
  }, [selectedThreadId])

  return {
    threadScrollRef,
    shouldStickToBottom,
    handleThreadScroll
  }
}
