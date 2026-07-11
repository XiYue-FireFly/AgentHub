// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../glass/i18n'
import * as workbenchLayout from '../WorkbenchLayout'

const ApprovalNotice = (workbenchLayout as unknown as {
  ApprovalNotice?: React.ComponentType<{ notice: string | null; onClose: () => void }>
}).ApprovalNotice

afterEach(() => {
  cleanup()
  setLang('zh')
})

describe('ApprovalNotice', () => {
  it('remains globally visible as a status message and can be dismissed', () => {
    setLang('en')
    expect(ApprovalNotice).toBeTypeOf('function')
    if (!ApprovalNotice) return
    const Notice = ApprovalNotice

    function Harness() {
      const [notice, setNotice] = useState('Approval submitted, but this choice could not be remembered.')
      return <Notice notice={notice} onClose={() => setNotice('')} />
    }

    render(<Harness />)
    expect(screen.getByRole('status').textContent).toContain('Approval submitted, but this choice could not be remembered.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss approval notice' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
