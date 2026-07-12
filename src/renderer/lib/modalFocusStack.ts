interface ModalFocusRegistration {
  container: HTMLElement
  initialFocus?: HTMLElement | null
  onEscape: () => void
}

interface ModalFocusEntry extends ModalFocusRegistration {
  restoreFocus: HTMLElement | null
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const stack: ModalFocusEntry[] = []
let listeningDocument: Document | null = null

export function registerModalFocus({
  container,
  initialFocus,
  onEscape
}: ModalFocusRegistration): () => void {
  const ownerDocument = container.ownerDocument
  const restoreFocus = ownerDocument.activeElement instanceof HTMLElement
    ? ownerDocument.activeElement
    : null
  const entry: ModalFocusEntry = { container, initialFocus, onEscape, restoreFocus }

  if (stack.length === 0) {
    listeningDocument = ownerDocument
    listeningDocument.addEventListener('keydown', onDocumentKeyDown, true)
  }
  stack.push(entry)
  focusEntry(entry)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const index = stack.indexOf(entry)
    if (index < 0) return

    const wasTopmost = index === stack.length - 1
    stack.splice(index, 1)
    if (stack.length === 0 && listeningDocument) {
      listeningDocument.removeEventListener('keydown', onDocumentKeyDown, true)
      listeningDocument = null
    }

    if (!wasTopmost) return
    if (isRestorable(entry.restoreFocus)) {
      entry.restoreFocus.focus()
      return
    }
    const next = stack[stack.length - 1]
    if (next) focusEntry(next)
  }
}

function onDocumentKeyDown(event: KeyboardEvent) {
  const entry = stack[stack.length - 1]
  if (!entry) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    entry.onEscape()
    return
  }

  if (event.key !== 'Tab') return
  const focusable = getFocusableElements(entry.container)
  const focused = entry.container.ownerDocument.activeElement
  if (focusable.length === 0) {
    event.preventDefault()
    event.stopPropagation()
    entry.container.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (focusable.length === 1 || !entry.container.contains(focused)) {
    event.preventDefault()
    event.stopPropagation()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && focused === first) {
    event.preventDefault()
    event.stopPropagation()
    last.focus()
  } else if (!event.shiftKey && focused === last) {
    event.preventDefault()
    event.stopPropagation()
    first.focus()
  }
}

function focusEntry(entry: ModalFocusEntry) {
  const initial = entry.initialFocus && isAvailable(entry.initialFocus)
    ? entry.initialFocus
    : getFocusableElements(entry.container)[0]
  ;(initial ?? entry.container).focus()
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.tabIndex >= 0 && isAvailable(element))
}

function isRestorable(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && element.tabIndex >= 0 && isAvailable(element))
}

function isAvailable(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (
      current.hidden ||
      current.hasAttribute('inert') ||
      current.getAttribute('aria-hidden') === 'true' ||
      current.getAttribute('aria-disabled') === 'true'
    ) return false

    if (current instanceof HTMLFieldSetElement && current.disabled) return false
    if ('disabled' in current && Boolean((current as HTMLButtonElement).disabled)) return false

    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
  }
  return true
}
