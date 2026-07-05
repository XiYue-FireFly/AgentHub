// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SddAssistantPanel } from './SddAssistantPanel'

vi.mock('../../workbench/MarkdownBlock', () => ({
  MarkdownBlock: ({ content }: { content: string }) => <div>{content}</div>
}))

afterEach(() => cleanup())

function ParentRerenderHarness({ onSendMessage }: {
  onSendMessage: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, mode?: 'chat' | 'plan' | 'verify') => Promise<string>
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

  it('offers a sync action on assistant plan messages', async () => {
    const onSendMessage = vi.fn(async () => '- [ ] Implement checkout (covers: R-1)')
    const onSyncPlanTodos = vi.fn(async () => [{
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'Implement checkout (covers: R-1)',
      status: 'pending' as const,
      updatedAt: Date.now()
    }])
    const view = render(
      <SddAssistantPanel
        draftId="draft-1"
        workspaceRoot="E:\\workspace"
        initialMessage="Generate an implementation plan"
        initialMode="plan"
        threadId="thread-1"
        onSendMessage={onSendMessage}
        onSyncPlanTodos={onSyncPlanTodos}
      />
    )

    const syncButton = await view.findByText('同步到 Todo')
    fireEvent.click(syncButton)

    await waitFor(() => expect(onSyncPlanTodos).toHaveBeenCalledWith('- [ ] Implement checkout (covers: R-1)'))
    await view.findByText('已同步 1 个 Todo')
  })
  it('requires manual apply for normal requirement update candidates', async () => {
    const onSendMessage = vi.fn(async () => ({
      content: 'Add shipping address collection.',
      applyContext: {
        kind: 'requirement-apply',
        preview: {
          added: ['Add shipping address collection.'],
          removed: []
        }
      }
    }))
    const onApplyRequirementResponse = vi.fn(async () => undefined)
    const view = render(
      <SddAssistantPanel
        draftId="draft-1"
        workspaceRoot="E:\\workspace"
        onSendMessage={onSendMessage}
        onApplyRequirementResponse={onApplyRequirementResponse}
      />
    )

    fireEvent.change(view.container.querySelector('.sdd-composer-textarea') as HTMLTextAreaElement, {
      target: { value: 'Improve the draft' }
    })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)

    await view.findByRole('button', { name: /Apply to document/ })
    expect(onApplyRequirementResponse).not.toHaveBeenCalled()

    fireEvent.click(await view.findByRole('button', { name: /Preview changes/ }))
    await view.findByText('Add shipping address collection.')

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))
    await waitFor(() => expect(onApplyRequirementResponse).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'requirement-apply'
    })))
    await view.findByText('Applied to document')
    const applyButton = await view.findByRole('button', { name: /Apply to document/ }) as HTMLButtonElement
    expect(applyButton.disabled).toBe(true)
    fireEvent.click(applyButton)
    expect(onApplyRequirementResponse).toHaveBeenCalledTimes(1)
  })

  it('can discard normal requirement update candidates', async () => {
    const onSendMessage = vi.fn(async () => ({
      content: 'Add shipping address collection.',
      applyContext: {
        kind: 'requirement-apply',
        preview: { added: ['Add shipping address collection.'], removed: [] }
      }
    }))
    const onApplyRequirementResponse = vi.fn(async () => undefined)
    const view = render(
      <SddAssistantPanel
        draftId="draft-1"
        workspaceRoot="E:\\workspace"
        onSendMessage={onSendMessage}
        onApplyRequirementResponse={onApplyRequirementResponse}
      />
    )

    fireEvent.change(view.container.querySelector('.sdd-composer-textarea') as HTMLTextAreaElement, {
      target: { value: 'Improve the draft' }
    })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)

    fireEvent.click(await view.findByRole('button', { name: /Discard/ }))
    await view.findByText('Discarded')
    expect((await view.findByRole('button', { name: /Apply to document/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(onApplyRequirementResponse).not.toHaveBeenCalled()
  })
})
