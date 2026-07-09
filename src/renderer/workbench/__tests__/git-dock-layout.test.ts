import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("workbench git dock layout", () => {
  it("keeps Git in the wide bottom dock instead of the narrow inspector", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const containers = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchPanelContainers.tsx"), "utf8")
    const styles = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(layout).toContain("import { WorkbenchPanelContainers } from './WorkbenchPanelContainers'")
    expect(layout).toContain("<WorkbenchPanelContainers")
    expect(layout).not.toContain("rightPanel && rightPanel !== 'git'")
    expect(layout).not.toContain("<WorkbenchBottomDock")
    expect(layout).not.toContain("<WorkbenchInspector")
    expect(containers).toContain("rightPanel && rightPanel !== 'git'")
    expect(containers).toContain("rightPanel === 'git'")
    expect(containers).toContain("WorkbenchBottomDock")
    expect(styles).toContain(".wb-bottom-dock")
    expect(styles).toContain("left: calc(var(--wb-sidebar-width, 312px) + 12px)")
    expect(styles).toContain(".wb-bottom-dock .wb-git-workflow")
  })

  it("keeps secondary panel dispatch and terminal polling outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const panelContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchRightPanelContent.tsx"), "utf8")
    const toolPanel = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchToolPanel.tsx"), "utf8")
    const terminalWatcher = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/terminalRunWatcher.ts"), "utf8")

    expect(panelContent).toContain("import { WorkbenchToolPanel } from './WorkbenchToolPanel'")
    expect(layout).toContain("import { watchTerminalRun } from './utils/terminalRunWatcher'")
    expect(layout).not.toContain("function WorkbenchToolPanel")
    expect(layout).not.toContain("async function watchTerminalRun")
    expect(toolPanel).toContain("export function WorkbenchToolPanel")
    expect(toolPanel).toContain("<BrowserPanel")
    expect(terminalWatcher).toContain("while (!signal?.aborted)")
    expect(terminalWatcher).toContain("Math.min(5000")
    expect(terminalWatcher).not.toContain("i < 24")
  })

  it("keeps non-Git right panel content routing outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const containers = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchPanelContainers.tsx"), "utf8")
    const panelContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchRightPanelContent.tsx"), "utf8")

    expect(containers).toContain("import { WorkbenchRightPanelContent } from './WorkbenchRightPanelContent'")
    expect(containers).toContain("<WorkbenchRightPanelContent")
    expect(layout).not.toContain("import { WorkbenchRightPanelContent } from './WorkbenchRightPanelContent'")
    expect(layout).not.toContain("<WorkbenchRightPanelContent")
    expect(layout).not.toContain("rightPanel === 'side-chat' ?")
    expect(layout).not.toContain("rightPanel === 'terminal' ?")
    expect(panelContent).toContain("export function WorkbenchRightPanelContent")
    expect(panelContent).toContain("panel === 'runs'")
    expect(panelContent).toContain("panel === 'files'")
    expect(panelContent).toContain("panel === 'side-chat'")
    expect(panelContent).toContain("panel === 'terminal'")
    expect(panelContent).toContain("<WorkbenchToolPanel")
  })

  it("keeps main view content routing outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const mainContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchMainContent.tsx"), "utf8")

    expect(layout).toContain("import { WorkbenchMainContent } from './WorkbenchMainContent'")
    expect(layout).toContain("<WorkbenchMainContent")
    expect(layout).not.toContain("view === 'settings'")
    expect(layout).not.toContain("view === 'requirements'")
    expect(mainContent).toContain("export function WorkbenchMainContent")
    expect(mainContent).toContain("view === 'chat'")
    expect(mainContent).toContain("<ComposerBar")
    expect(mainContent).toContain("<SettingsScreen")
    expect(mainContent).toContain("<SddRequirementsList")
    expect(mainContent).toContain("threadId={activeThreadId}")
    expect(mainContent).toContain("onThreadTodosChanged={refreshThreadTodos}")
    expect(mainContent).toContain("<WorkflowsPanel")
  })

  it("guards async todo refreshes against stale selected thread writes", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const refreshStart = layout.indexOf("const refreshThreadTodos = useCallback")
    const refreshEnd = layout.indexOf("const appendRuntimeEvents", refreshStart)
    const refreshSource = layout.slice(refreshStart, refreshEnd)

    expect(refreshStart).toBeGreaterThan(-1)
    expect(refreshEnd).toBeGreaterThan(refreshStart)
    expect(refreshSource).toContain("if (!selectedThreadIdRef.current) setThreadTodosState([])")
    expect(refreshSource).toContain("if (selectedThreadIdRef.current === threadId)")
    expect(refreshSource).toContain("setThreadTodosState(todos)")
  })

  it("keeps workspace creation dialog logic outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const dialog = readFileSync(join(process.cwd(), "src/renderer/workbench/CreateWorkspaceDialog.tsx"), "utf8")

    expect(layout).toContain("import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'")
    expect(layout).not.toContain("const pickProjectFolder")
    expect(layout).not.toContain("const submitProject")
    expect(dialog).toContain("export function CreateWorkspaceDialog")
    expect(dialog).toContain("window.electronAPI.app.pickFolder")
    expect(dialog).toContain("window.electronAPI.workspaces.create")
    expect(dialog).toContain("defaultDialogPath('folder'")
  })

  it("keeps shortcut command routing outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const shortcutCommands = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/shortcutCommands.ts"), "utf8")

    expect(layout).toContain("import { resolveShortcutCommandAction } from './utils/shortcutCommands'")
    expect(layout).toContain("const action = resolveShortcutCommandAction(commandId)")
    expect(layout).toContain("action.type === 'stop-task'")
    expect(layout).toContain("void cancelLatest()")
    expect(layout).not.toContain("commandId === 'view-chat'")
    expect(layout).not.toContain("commandId === 'panel-git'")
    expect(layout).not.toContain("commandId === 'settings-shortcuts'")
    expect(shortcutCommands).toContain("export function resolveShortcutCommandAction")
    expect(shortcutCommands).toContain("case 'stop-task'")
    expect(shortcutCommands).toContain("case 'view-requirements'")
    expect(shortcutCommands).toContain("case 'open-workflows'")
  })

  it("keeps native menu command parsing outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const menuCommands = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/menuCommands.ts"), "utf8")
    const menuEffectStart = layout.indexOf("window.electronAPI.app.onMenuCommand")
    const menuEffectEnd = layout.indexOf("const shortcutBindings", menuEffectStart)
    const menuEffect = layout.slice(menuEffectStart, menuEffectEnd)

    expect(menuEffectStart).toBeGreaterThan(-1)
    expect(menuEffectEnd).toBeGreaterThan(menuEffectStart)
    expect(layout).toContain("import { resolveWorkbenchMenuCommand } from './utils/menuCommands'")
    expect(menuEffect).toContain("const action = resolveWorkbenchMenuCommand(link)")
    expect(menuEffect).not.toContain("link?.action")
    expect(menuEffect).not.toContain("action === 'new-thread'")
    expect(menuEffect).not.toContain("panel === 'worktrees'")
    expect(menuCommands).toContain("export function resolveWorkbenchMenuCommand")
    expect(menuCommands).toContain("isWorkbenchViewMode(params.view)")
    expect(menuCommands).toContain("'worktrees'")
  })

  it("keeps send-prompt dispatch request routing outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const dispatchRequest = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/dispatchRequest.ts"), "utf8")
    const sendPromptStart = layout.indexOf("const sendPrompt = async")
    const sendPromptEnd = layout.indexOf("const cancelAgent", sendPromptStart)
    const sendPromptSource = layout.slice(sendPromptStart, sendPromptEnd)

    expect(sendPromptStart).toBeGreaterThan(-1)
    expect(sendPromptEnd).toBeGreaterThan(sendPromptStart)
    expect(layout).toContain("import { resolveDispatchRequest } from './utils/dispatchRequest'")
    expect(sendPromptSource).toContain("const dispatchRequest = resolveDispatchRequest")
    expect(sendPromptSource).toContain("return result")
    expect(sendPromptSource).not.toContain("const selectedProviderDirect")
    expect(sendPromptSource).not.toContain("sanitizeCustomSchedule")
    expect(sendPromptSource).not.toContain("customScheduleHasRunnableSteps")
    expect(dispatchRequest).toContain("export function resolveDispatchRequest")
    expect(dispatchRequest).toContain("selectedProviderDirect")
    expect(dispatchRequest).toContain("sanitizeCustomSchedule")
  })

  it("dispatches Todo rows through sendPrompt and records SDD trace metadata", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const row = readFileSync(join(process.cwd(), "src/renderer/workbench/components/TodoPopoverRow.tsx"), "utf8")
    const dispatchStart = layout.indexOf("const dispatchThreadTodo = useCallback")
    const dispatchEnd = layout.indexOf("const cancelAgent", dispatchStart)
    const dispatchSource = layout.slice(dispatchStart, dispatchEnd)

    expect(dispatchStart).toBeGreaterThan(-1)
    expect(dispatchEnd).toBeGreaterThan(dispatchStart)
    expect(dispatchSource).toContain("const result = await sendPromptRef.current(todo.content")
    expect(dispatchSource).toContain("result?.turn?.id")
    expect(dispatchSource).toContain("window.electronAPI.todos.upsert")
    expect(dispatchSource).toContain("persistSddPlanDispatch")
    expect(dispatchSource.indexOf("const result = await sendPromptRef.current")).toBeLessThan(dispatchSource.indexOf("window.electronAPI.todos.upsert"))
    expect(row).toContain("onDispatch")
    expect(row).not.toContain("window.electronAPI.turns.create")
  })

  it("syncs SDD Todo status changes back into trace metadata", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const updateStart = layout.indexOf("const updateThreadTodoStatus = useCallback")
    const updateEnd = layout.indexOf("const deleteThreadTodo", updateStart)
    const updateSource = layout.slice(updateStart, updateEnd)

    expect(updateStart).toBeGreaterThan(-1)
    expect(updateEnd).toBeGreaterThan(updateStart)
    expect(layout).toContain("persistSddPlanTodoStatus")
    expect(updateSource).toContain("window.electronAPI.todos.upsert")
    expect(updateSource).toContain("if (isSddPlanTodo(todo))")
    expect(updateSource).toContain("await persistSddPlanTodoStatus(todo, status)")
    expect(updateSource.indexOf("window.electronAPI.todos.upsert")).toBeLessThan(updateSource.indexOf("persistSddPlanTodoStatus"))
  })

  it("keeps the first-run announcement modal outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const modal = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchAnnouncementModal.tsx"), "utf8")

    expect(layout).toContain("import { WorkbenchAnnouncementModal } from './WorkbenchAnnouncementModal'")
    expect(layout).not.toContain('className="wb-announcement-modal"')
    expect(layout).toContain("<WorkbenchAnnouncementModal")
    expect(modal).toContain("export function WorkbenchAnnouncementModal")
    expect(modal).toContain("wb-announcement-actions")
    expect(modal).toContain("onOpenSetup('local-agents')")
    expect(modal).toContain("onOpenSetup('providers')")
  })

  it("keeps new floating workbench surfaces on theme tokens", () => {
    const styles = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(styles).toContain(':root[data-theme="dark"] .wb-workspace-popover')
    expect(styles).toContain(':root[data-theme="dark"] .wb-git-branch-popover')
    expect(styles).not.toContain('.wb-context-capacity-trigger')
    expect(styles).not.toMatch(/var\(--line\)/)
    expect(styles).not.toMatch(/var\(--bg-2\)/)
  })

  it("keeps diagnostics settings logs readable and bounded", () => {
    const settings = readFileSync(join(process.cwd(), "src/renderer/screens/Settings.tsx"), "utf8")
    const styles = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(settings).toContain("function DiagnosticsSettingsTab")
    expect(settings).toContain("window.electronAPI.diagnostics.run()")
    expect(settings).toContain("window.electronAPI.diagnostics.recentLogs(100)")
    expect(styles).toContain(".wb-settings-shell .wb-diagnostics-log-list")
    expect(styles).toContain("max-height: 420px")
    expect(styles).toContain("white-space: pre-wrap")
  })
})
