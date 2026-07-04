// @vitest-environment happy-dom
import React, { useState } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SddAssistantPanel } from './SddAssistantPanel'

vi.mock('../../workbench/MarkdownBlock', () => ({
  MarkdownBlock: ({ content }: { content: string }) => <div>{content}</div>
}))

function ParentRerenderHarness({ onSendMessage }: {
  onSendMessage: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, mode?: 'chat' | 'plan') => Promise<string>
}) {
  const [count, setCount] = useState(0)
  return (
    <>
      <button onClick={() => setCount(value => value + 1)}>rerender {count}</button>
      <SddAssistantPanel
        draftId="draft-1"
        workspaceRoot="E:\\workspace"
        initialMessage="Generate an implementation plan"
        initialMode="plan"
        onSendMessage={(message, history, mode) => onSendMessage(message, history, mode)}
      />
    </>
  )
}

describe('SddAssistantPanel', () => {
  it('auto-sends the initial plan message once even when the parent rerenders first', async () => {
    const onSendMessage = vi.fn(async () => 'plan ready')
    const view = render(<ParentRerenderHarness onSendMessage={onSendMessage} />)

    view.getByText(/rerender/).click()
    view.getByText(/rerender/).click()

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1))
    expect(onSendMessage).toHaveBeenCalledWith('Generate an implementation plan', [], 'plan')
  })
})
