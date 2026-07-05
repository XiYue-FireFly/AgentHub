import React from 'react'
import { SetupTab } from '../glass/connection-status'
import { RunTimeline } from './RunTimeline'
import { WorkbenchToolPanel } from './WorkbenchToolPanel'
import { TerminalPanel } from './TerminalPanel'
import { FileTreePanel } from './FileTreePanel'
import { SubagentDetailPanel } from './SubagentDetailPanel'
import { SideConversationPanel } from './SideConversationPanel'
import type { WorkbenchRightPanel } from './NativeTitlebar'

interface WorkbenchRightPanelContentProps {
  panel: Exclude<WorkbenchRightPanel, null | 'git'>
  workspaceId: string | null
  workspaceRoot?: string | null
  parentThreadId: string | null
  parentTurnId: string | null
  activeEvents: RuntimeEvent[]
  activeTurns: WorkbenchTurn[]
  localAgents: LocalAgentStatus[]
  setLocalAgents: (agents: LocalAgentStatus[]) => void
  schedules: SchedulePreview[]
  mode: DispatchPreset
  setMode: (mode: DispatchPreset) => void
  scheduleForMode: (preset: DispatchPreset) => SchedulePreview | undefined
  setScheduleForMode: (preset: DispatchPreset, schedule: SchedulePreview) => void
  openSetup: (tab?: SetupTab | 'appearance') => void
  terminalRuns: TerminalRun[]
  setTerminalRuns: (runs: TerminalRun[]) => void
  selectedAgentDetail: { agentId: string; turnId: string } | null
  onSelectAgentDetail: (detail: { agentId: string; turnId: string } | null) => void
  onClose: () => void
  browserUrl?: string | null
  onBrowserUrlConsumed?: () => void
  onAttachBrowserCapture: (attachment: WorkbenchAttachment) => void
}

export function WorkbenchRightPanelContent({
  panel,
  workspaceId,
  workspaceRoot,
  parentThreadId,
  parentTurnId,
  activeEvents,
  activeTurns,
  localAgents,
  setLocalAgents,
  schedules,
  mode,
  setMode,
  scheduleForMode,
  setScheduleForMode,
  openSetup,
  terminalRuns,
  setTerminalRuns,
  selectedAgentDetail,
  onSelectAgentDetail,
  onClose,
  browserUrl,
  onBrowserUrlConsumed,
  onAttachBrowserCapture
}: WorkbenchRightPanelContentProps) {
  if (panel === 'runs') {
    if (selectedAgentDetail) {
      return (
        <SubagentDetailPanel
          agentId={selectedAgentDetail.agentId}
          turnId={selectedAgentDetail.turnId}
          events={activeEvents}
          onClose={() => onSelectAgentDetail(null)}
        />
      )
    }
    return (
      <RunTimeline
        events={activeEvents}
        turns={activeTurns}
        localAgents={localAgents}
        setLocalAgents={setLocalAgents}
        schedules={schedules}
        mode={mode}
        setMode={setMode}
        currentSchedule={scheduleForMode(mode)}
        setScheduleForMode={setScheduleForMode}
        openSetup={openSetup}
        onClose={onClose}
        terminalRuns={terminalRuns}
        setTerminalRuns={setTerminalRuns}
        onSelectAgent={(agentId, turnId) => onSelectAgentDetail({ agentId, turnId })}
      />
    )
  }
  if (panel === 'files') {
    return (
      <FileTreePanel
        workspaceRoot={workspaceRoot ?? null}
        workspaceId={workspaceId}
        onClose={onClose}
        onFileSelect={path => {
          window.electronAPI.app.openPath({ path, target: 'editor' }).catch(() => {})
        }}
      />
    )
  }
  if (panel === 'side-chat') {
    return (
      <SideConversationPanel
        parentThreadId={parentThreadId}
        parentTurnId={parentTurnId}
        workspaceId={workspaceId}
        onClose={onClose}
      />
    )
  }
  if (panel === 'terminal') return <TerminalPanel workspaceRoot={workspaceRoot ?? undefined} onClose={onClose} />
  return (
    <WorkbenchToolPanel
      panel={panel}
      workspaceId={workspaceId}
      onClose={onClose}
      browserUrl={browserUrl}
      onBrowserUrlConsumed={onBrowserUrlConsumed}
      onAttachBrowserCapture={onAttachBrowserCapture}
    />
  )
}
