// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadView } from '../ThreadView'

afterEach(() => cleanup())

function renderAgentOutput(output: string): string {
  const view = render(React.createElement(ThreadView, {
    thread: { id: 'thread-1', title: 'Thread' } as any,
    turns: [{
      id: 'turn-1',
      threadId: 'thread-1',
      prompt: 'Show output',
      status: 'running',
      targetAgent: 'codex',
      createdAt: 1
    }] as any,
    events: [{
      id: 'event-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      agentId: 'codex',
      kind: 'agent:delta',
      payload: { text: output },
      createdAt: 2
    }] as any,
    onRetry: () => {},
    onCancelAgent: () => {},
    openSetup: () => {},
    onCreateProject: () => {},
    onCreateThread: () => {},
    hasWorkspace: true
  }))
  const rendered = view.container.querySelector('.wb-streaming-text')
  expect(rendered).not.toBeNull()
  return rendered?.textContent || ''
}

describe('ThreadView output normalization', () => {
  it('preserves an unknown JSON object in its original mixed-text position and spacing', () => {
    const output = ['before', '', '{"foo":"bar"}', '', 'after'].join('\n')

    expect(renderAgentOutput(output)).toBe(output)
  })

  it('preserves an unknown JSON object inside a json code fence', () => {
    const output = ['```json', '{"foo":"bar"}', '```'].join('\n')

    expect(renderAgentOutput(output)).toBe(output)
  })

  it('still converts a recognized completed agent-message envelope', () => {
    const envelope = '{"type":"item.completed","item":{"type":"agent_message","text":"internal answer"}}'

    expect(renderAgentOutput(envelope)).toBe('internal answer')
  })
})
