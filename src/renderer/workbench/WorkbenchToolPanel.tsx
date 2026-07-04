import React from 'react'
import { GitWorkbenchPanel } from './GitWorkbenchPanel'
import { WorktreePanel } from './components/panels/WorktreePanel'
import { BrowserPanel } from './components/panels/BrowserPanel'
import type { WorkbenchRightPanel } from './NativeTitlebar'

interface WorkbenchToolPanelProps {
  panel: Exclude<WorkbenchRightPanel, null | 'runs' | 'files' | 'terminal' | 'side-chat'>
  workspaceId: string | null
  onClose: () => void
  browserUrl?: string | null
  onBrowserUrlConsumed?: () => void
  onAttachBrowserCapture: (attachment: WorkbenchAttachment) => void
}

export function WorkbenchToolPanel({
  panel,
  workspaceId,
  onClose,
  browserUrl,
  onBrowserUrlConsumed,
  onAttachBrowserCapture
}: WorkbenchToolPanelProps) {
  if (panel === 'git') return <GitWorkbenchPanel workspaceId={workspaceId} onClose={onClose} />
  if (panel === 'worktrees') return <WorktreePanel workspaceId={workspaceId} onClose={onClose} />
  if (panel === 'browser') {
    return (
      <BrowserPanel
        workspaceId={workspaceId}
        onClose={onClose}
        initialUrl={browserUrl}
        onInitialUrlConsumed={onBrowserUrlConsumed}
        onAttach={onAttachBrowserCapture}
      />
    )
  }
  return null
}
