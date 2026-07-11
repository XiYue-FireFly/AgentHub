// @vitest-environment happy-dom
import React, { useRef } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModalFocus } from '../useModalFocus'

describe('useModalFocus focus candidates', () => {
  afterEach(cleanup)

  it('skips controls hidden or disabled by an ancestor when wrapping focus', () => {
    function Modal() {
      const dialogRef = useRef<HTMLDivElement>(null)
      useModalFocus({ containerRef: dialogRef, onEscape: vi.fn() })
      return (
        <div ref={dialogRef} role="dialog" aria-label="Filter focus" tabIndex={-1}>
          <button>First visible</button>
          <button>Last visible</button>
          <div hidden><button>Hidden control</button></div>
          <div aria-hidden="true"><button>ARIA hidden control</button></div>
          <div ref={element => { element?.setAttribute('inert', '') }}><button>Inert control</button></div>
          <fieldset disabled><button>Disabled fieldset control</button></fieldset>
        </div>
      )
    }

    const view = render(<Modal />)
    const first = view.getByRole('button', { name: 'First visible' })
    const last = view.getByRole('button', { name: 'Last visible' })
    first.focus()

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(last)
  })
})
