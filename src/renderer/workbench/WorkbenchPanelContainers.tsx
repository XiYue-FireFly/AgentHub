import React from 'react'
import { SetupTab } from '../glass/connection-status'
import { tr } from '../glass/i18n'
import { GitWorkbenchPanel } from './GitWorkbenchPanel'
import { WorkbenchRightPanelContent } from './WorkbenchRightPanelContent'
import type { WorkbenchRightPanel } from './NativeTitlebar'
import { WorkbenchBottomDock, WorkbenchInspector } from './WorkbenchPanels'

interface WorkbenchPanelContainersProps {
  rightPanel: WorkbenchRightPanel
  setRightPanel: (panel: WorkbenchRightPanel) => void
  inspectorWidth: number
  viewportWidth: number
  previewInspectorWidth: (width: number) => void
  setInspectorWidthPersisted: (width: number) => void
  workspaceId: string | null
  workspaceRoot: string | null
  activeThreadId: string | null
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
  browserUrl: string | null
  onBrowserUrlConsumed: () => void
  onAttachBrowserCapture: (attachment: WorkbenchAttachment) => void
}

export function WorkbenchPanelContainers({
  rightPanel,
  setRightPanel,
  inspectorWidth,
  viewportWidth,
  previewInspectorWidth,
  setInspectorWidthPersisted,
  workspaceId,
  workspaceRoot,
  activeThreadId,
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
  browserUrl,
  onBrowserUrlConsumed,
  onAttachBrowserCapture
}: WorkbenchPanelContainersProps) {
  const closePanel = () => setRightPanel(null)

  if (rightPanel && rightPanel !== 'git') {
    return (
      <>
        <button className="wb-panel-scrim" type="button" aria-label={tr('关闭侧边栏', 'Close side panel')} onClick={closePanel} />
        <WorkbenchInspector
          width={inspectorWidth}
          viewportWidth={viewportWidth}
          setWidth={previewInspectorWidth}
          commitWidth={setInspectorWidthPersisted}
          activePanel={rightPanel}
          setPanel={setRightPanel}
          workspaceId={workspaceId}
          onClose={closePanel}
        >
          <WorkbenchRightPanelContent
            panel={rightPanel}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            parentThreadId={activeThreadId}
            parentTurnId={parentTurnId}
            activeEvents={activeEvents}
            activeTurns={activeTurns}
            localAgents={localAgents}
            setLocalAgents={setLocalAgents}
            schedules={schedules}
            mode={mode}
            setMode={setMode}
            scheduleForMode={scheduleForMode}
            setScheduleForMode={setScheduleForMode}
            openSetup={openSetup}
            terminalRuns={terminalRuns}
            setTerminalRuns={setTerminalRuns}
            selectedAgentDetail={selectedAgentDetail}
            onSelectAgentDetail={onSelectAgentDetail}
            onClose={closePanel}
            browserUrl={browserUrl}
            onBrowserUrlConsumed={onBrowserUrlConsumed}
            onAttachBrowserCapture={onAttachBrowserCapture}
          />
        </WorkbenchInspector>
      </>
    )
  }

  if (rightPanel === 'git') {
    return (
      <>
        <button className="wb-panel-scrim bottom" type="button" aria-label={tr('关闭底部面板', 'Close bottom panel')} onClick={closePanel} />
        <WorkbenchBottomDock
          workspaceId={workspaceId}
          activePanel={rightPanel}
          setPanel={setRightPanel}
          onClose={closePanel}
        >
          <GitWorkbenchPanel workspaceId={workspaceId} activeThreadId={activeThreadId} onClose={closePanel} />
        </WorkbenchBottomDock>
      </>
    )
  }

  return null
}
