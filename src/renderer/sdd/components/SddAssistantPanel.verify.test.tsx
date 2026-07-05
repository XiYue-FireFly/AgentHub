// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { SddAssistantPanel } from './SddAssistantPanel'

vi.mock('../../workbench/MarkdownBlock', () => ({
  MarkdownBlock: ({ content }: { content: string }) => <div>{content}</div>
}))

afterEach(() => cleanup())

describe('SddAssistantPanel verification actions', () => {
  it('offers a manual apply action on assistant verification messages', async () => {
    setLang('en')
    const verification = [
      '## Report',
      '```sdd-verify-json',
      JSON.stringify({
        criteria: [
          { requirementId: 'R-1', criterionIndex: 0, status: 'pass' },
          { requirementId: 'R-1', criterionIndex: 1, status: 'fail' },
          { requirementId: 'R-1', criterionIndex: 2, status: 'unknown' }
        ]
      }),
      '```'
    ].join('\n')
    const onSendMessage = vi.fn(async () => verification)
    const onApplyVerification = vi.fn(async () => ({
      appliedCount: 1,
      verifiedRequirementIds: ['R-1'],
      warnings: []
    }))

    const view = render(
      <SddAssistantPanel
        draftId="draft-1"
        workspaceRoot="E:\\workspace"
        initialMessage="Verify acceptance"
        initialMode="verify"
        onSendMessage={onSendMessage}
        onApplyVerification={onApplyVerification}
      />
    )

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('Verify acceptance', [], 'verify'))
    await view.findByText('Pass 1')
    await view.findByText('Fail 1')
    await view.findByText('Unknown 1')
    fireEvent.click(await view.findByRole('button', { name: /Apply passed/ }))

    await waitFor(() => expect(onApplyVerification).toHaveBeenCalledWith(verification, undefined))
    await view.findByText('Applied 1 passing criteria')
  })
})
