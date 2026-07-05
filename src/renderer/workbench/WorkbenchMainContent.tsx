import React from 'react'
import { BindingDef, ProviderDef, type TaskItem } from '../glass/meta'
import type { ConnectionSummary } from '../glass/connection-status'
import { tr } from '../glass/i18n'
import { TasksScreen } from '../screens/Tasks'
import { ErrorBoundary } from '../ErrorBoundary'
import { SddRequirementsList } from '../sdd/components/SddRequirementsList'
import { WorkbenchChatTopBar } from './WorkbenchChatTopBar'
import { WriteWorkspace } from './WriteWorkspace'
import { ThreadView } from './ThreadView'
import { ComposerBar } from './ComposerBar'
import { GitBranchControl } from './GitBranchControl'
import type { ViewMode } from './viewModes'
import type { WorkbenchRightPanel, WorkbenchSettingsTabKey } from './NativeTitlebar'
import type { AgentMap, WorkspaceItem } from './types'
import type { WorkbenchThinking } from './utils/modelUtils'

type SettingsTabKey = WorkbenchSettingsTabKey

interface WorkbenchMainContentProps {
  view: ViewMode
  setView: (view: ViewMode) => void
  configLoadError?: string | null
  onReloadConfig: () => void
  activeWorkspace: WorkspaceItem | null
  workspaceId: string | null
  activeThreadId: string | null
  activeThread: WorkbenchThread | null
  activeTurns: WorkbenchTurn[]
  activeEvents: RuntimeEvent[]
  activeGoal: WorkbenchGoal | null
  threadTodos: ThreadTodo[]
  readyLocalAgents: number
  title: string
  workspaceName: string
  sendError: string | null
  rightPanel: WorkbenchRightPanel
  setRightPanel: (panel: WorkbenchRightPanel) => void
  selectWorkspace: (id: string | null) => void | Promise<void>
  selectTargetAgent: (agentId: string | null) => void
  targetAgent: string | null
  agents: AgentMap
  localAgents: LocalAgentStatus[]
  sending: boolean
  sendPrompt: (prompt: string, attachments?: WorkbenchAttachment[], overrides?: { targetAgent?: string | null; mode?: DispatchPreset; customSchedule?: SchedulePreview; modelSelection?: ModelSelection | null }) => Promise<any>
  cancelLatest: () => Promise<void>
  openCreateProject: () => void
  openSetup: (tab?: SettingsTabKey) => void
  updateTodoStatus: (todo: ThreadTodo, status: ThreadTodoStatus) => void | Promise<void>
  deleteTodo: (todoId: string) => void | Promise<void>
  dispatchTodo: (todo: ThreadTodo) => void | Promise<void>
  dispatchingTodoId: string | null
  refreshThreadTodos: (threadId?: string | null) => void | Promise<void>
  runSlashCommand: (input: { text: string; command?: WorkbenchCommand | null }) => Promise<boolean>
  retryTurn: (turnId: string) => Promise<void>
  cancelAgent: (turnId: string, agentId: string) => Promise<void>
  resolveGuard: (requestId: string, approved: boolean) => Promise<void>
  createThread: (workspaceId?: string | null) => Promise<void>
  handleThreadScroll: () => void
  threadScrollRef: React.RefObject<HTMLElement>
  search: string
  runtimeTasks: TaskItem[]
  cancelRuntimeTask: (id: string) => Promise<void>
  deleteRuntimeTask: (id: string) => Promise<void>
  clearCompletedRuntimeTasks: () => Promise<void>
  providers: ProviderDef[]
  bindings: BindingDef[]
  fallbackChain: string[]
  providerActions: {
    onSetEnabled: (id: string, enabled: boolean) => void
    onSetKey: (id: string, key: string) => void
    onSetBinding: (b: BindingDef) => void
    onSetFallback: (chain: string[]) => void
    onReload: () => void
    onUpsertProvider: (p: any) => void
    onDeleteProvider: (id: string) => void
    onReorderProvidersForClaude: (orderedIds: string[]) => void
  }
  motion: 'off' | 'subtle' | 'rich'
  setMotion: (m: 'off' | 'subtle' | 'rich') => void
  settingsTab: SettingsTabKey
  connectionSummary: ConnectionSummary
  mode: DispatchPreset
  setMode: (mode: DispatchPreset) => void
  modelSelection: ModelSelection | null
  setModelSelection: (selection: ModelSelection | null) => void
  thinking: WorkbenchThinking
  setThinking: (thinking: WorkbenchThinking) => void
  schedules: SchedulePreview[]
  workspaces: WorkspaceItem[]
  pendingComposerAttachments: WorkbenchAttachment[]
  onExternalAttachmentsConsumed: () => void
}

const WorkflowsPanel = React.lazy(() => import('./WorkflowsPanel').then(m => ({ default: m.WorkflowsPanel })))
const SettingsScreen = React.lazy(() => import('../screens/Settings').then(m => ({ default: m.SettingsScreen })))

export function WorkbenchMainContent({
  view,
  setView,
  configLoadError,
  onReloadConfig,
  activeWorkspace,
  workspaceId,
  activeThreadId,
  activeThread,
  activeTurns,
  activeEvents,
  activeGoal,
  threadTodos,
  readyLocalAgents,
  title,
  workspaceName,
  sendError,
  rightPanel,
  setRightPanel,
  selectWorkspace,
  selectTargetAgent,
  targetAgent,
  agents,
  localAgents,
  sending,
  sendPrompt,
  cancelLatest,
  openCreateProject,
  openSetup,
  updateTodoStatus,
  deleteTodo,
  dispatchTodo,
  dispatchingTodoId,
  refreshThreadTodos,
  runSlashCommand,
  retryTurn,
  cancelAgent,
  resolveGuard,
  createThread,
  handleThreadScroll,
  threadScrollRef,
  search,
  runtimeTasks,
  cancelRuntimeTask,
  deleteRuntimeTask,
  clearCompletedRuntimeTasks,
  providers,
  bindings,
  fallbackChain,
  providerActions,
  motion,
  setMotion,
  settingsTab,
  connectionSummary,
  mode,
  setMode,
  modelSelection,
  setModelSelection,
  thinking,
  setThinking,
  schedules,
  workspaces,
  pendingComposerAttachments,
  onExternalAttachmentsConsumed
}: WorkbenchMainContentProps) {
  return (
    <main className="wb-main">
      {configLoadError && (
        <div className="wb-config-error" role="alert">
          <span>{configLoadError}</span>
          <button type="button" onClick={onReloadConfig}>{tr('重试', 'Retry')}</button>
        </div>
      )}

      {view === 'write' && (
        <ErrorBoundary label="Write">
        <WriteWorkspace
          workspace={activeWorkspace}
          hasWorkspace={!!workspaceId}
          targetAgent={targetAgent}
          setTargetAgent={selectTargetAgent}
          agents={agents}
          localAgents={localAgents}
          sending={sending}
          onSend={sendPrompt}
          onCancel={cancelLatest}
          onCreateProject={openCreateProject}
          openChat={() => setView('chat')}
          thread={activeThread}
          turns={activeTurns}
          events={activeEvents}
        />
        </ErrorBoundary>
      )}

      {view === 'chat' && (
        <ErrorBoundary label="Chat">
        <>
          <div className="wb-chat-head">
            <WorkbenchChatTopBar
              title={title}
              workspaceName={workspaceName}
              workspaceTitle={activeWorkspace?.rootPath || tr('添加工作目录', 'Add working folder')}
              openWorkspace={workspaceId ? () => selectWorkspace(workspaceId) : openCreateProject}
              workspaceRoot={activeWorkspace?.rootPath ?? null}
              activePanel={rightPanel}
              setPanel={setRightPanel}
              workspaceId={workspaceId}
              readyLocalAgents={readyLocalAgents}
              todos={threadTodos}
              activeThreadId={activeThreadId}
              openTasks={() => setView('tasks')}
              updateTodoStatus={updateTodoStatus}
              deleteTodo={deleteTodo}
              dispatchTodo={dispatchTodo}
              dispatchingTodoId={dispatchingTodoId}
            />
          </div>

          {activeGoal && (
            <div className="wb-goal-strip">
              <div>
                <strong>{tr('当前目标', 'Current goal')}</strong>
                <span>{activeGoal.goal}</span>
                <small>{tr(`Loop 上限 ${activeGoal.loopLimit} 轮`, `Loop limit ${activeGoal.loopLimit}`)}</small>
              </div>
              <button className="ah-btn sm" onClick={() => runSlashCommand({ text: `/loop --limit ${activeGoal.loopLimit}` })}>
                {tr('启动 Loop', 'Run loop')}
              </button>
              <button className="ah-btn sm" onClick={() => runSlashCommand({ text: '/goal clear' })}>
                {tr('清除', 'Clear')}
              </button>
            </div>
          )}

          <ThreadView
            thread={activeThread}
            turns={activeTurns}
            events={activeEvents}
            onRetry={retryTurn}
            onCancelAgent={cancelAgent}
            onResolveGuard={resolveGuard}
            openSetup={openSetup}
            onCreateProject={openCreateProject}
            onCreateThread={createThread}
            hasWorkspace={!!workspaceId}
            workspaceRoot={activeWorkspace?.rootPath ?? null}
            scrollRef={threadScrollRef}
            onScroll={handleThreadScroll}
          />

          {sendError && <div className="wb-send-error">{sendError}</div>}

          <ComposerBar
            mode={mode}
            setMode={setMode}
            providers={providers}
            bindings={bindings}
            modelSelection={modelSelection}
            setModelSelection={setModelSelection}
            thinking={thinking}
            setThinking={setThinking}
            schedules={schedules}
            sending={sending}
            onSend={sendPrompt}
            onCancel={cancelLatest}
            workspaceId={workspaceId}
            workspaces={workspaces}
            setWorkspaceId={selectWorkspace}
            onCreateProject={openCreateProject}
            localAgents={localAgents}
            targetAgent={targetAgent}
            setTargetAgent={selectTargetAgent}
            agents={agents}
            onRunCommand={runSlashCommand}
            onOpenProviderSettings={() => openSetup('providers')}
            onRefreshProviders={providerActions.onReload}
            externalAttachments={pendingComposerAttachments}
            onExternalAttachmentsConsumed={onExternalAttachmentsConsumed}
            gitBranchNode={<GitBranchControl workspaceId={workspaceId} onOpenGit={() => setRightPanel('git')} compact />}
            threadId={activeThread?.id ?? null}
            turns={activeTurns}
            events={activeEvents}
          />
        </>
        </ErrorBoundary>
      )}

      {view === 'tasks' && (
        <ErrorBoundary label="Tasks">
        <div className="wb-scroll-surface">
          <TasksScreen
            tasks={runtimeTasks}
            search={search}
            onCancelTask={cancelRuntimeTask}
            onDeleteTask={deleteRuntimeTask}
            onClearCompleted={clearCompletedRuntimeTasks}
            openSetup={openSetup}
          />
        </div>
        </ErrorBoundary>
      )}

      {view === 'requirements' && (
        <ErrorBoundary label="Requirements">
        <div className="wb-scroll-surface">
          <SddRequirementsList
            workspaceRoot={activeWorkspace?.rootPath ?? null}
            threadId={activeThreadId}
            threadTodos={threadTodos}
            events={activeEvents}
            onThreadTodosChanged={refreshThreadTodos}
          />
        </div>
        </ErrorBoundary>
      )}

      {view === 'settings' && (
        <ErrorBoundary label="Settings">
        <div className="wb-scroll-surface wb-settings-surface">
          <React.Suspense fallback={<div className="wb-muted-box">{tr('加载设置...', 'Loading settings...')}</div>}>
          <SettingsScreen
            providers={providers}
            bindings={bindings}
            onSetEnabled={providerActions.onSetEnabled}
            onSetKey={providerActions.onSetKey}
            onSetBinding={providerActions.onSetBinding}
            fallbackChain={fallbackChain}
            onSetFallback={providerActions.onSetFallback}
            onReload={providerActions.onReload}
            onUpsertProvider={providerActions.onUpsertProvider}
            onDeleteProvider={providerActions.onDeleteProvider}
            onReorderProvidersForClaude={providerActions.onReorderProvidersForClaude}
            motion={motion}
            setMotion={setMotion}
            initialTab={settingsTab}
            workspaceId={workspaceId}
            connectionSummary={connectionSummary}
            goChat={agentId => { selectTargetAgent(agentId); setView('chat') }}
            openSetup={openSetup}
          />
          </React.Suspense>
        </div>
        </ErrorBoundary>
      )}

      {view === 'workflows' && (
        <ErrorBoundary label="Workflows">
        <div className="wb-scroll-surface wb-settings-surface">
          <React.Suspense fallback={<div className="wb-muted-box">{tr('加载工作流...', 'Loading workflows...')}</div>}>
          <WorkflowsPanel onClose={() => setView('chat')} />
          </React.Suspense>
        </div>
        </ErrorBoundary>
      )}
    </main>
  )
}
