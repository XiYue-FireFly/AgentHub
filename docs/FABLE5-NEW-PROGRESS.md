# Fable5 New Branch Progress

## Context

- Branch: `new`
- Source requirements: `E:\Agent\AgentHub\fable5.md` and `E:\Agent\AgentHub\fable5BUG.md`
- Goal: iterate AgentHub according to fable5, starting with guarded 1.2.3/1.2.4 fixes and 1.3.0 groundwork.

## Completed In This Branch

- Added release register `VERSION.md`.
- Added version sync guard test.
- Added architecture guard test for renderer/main import boundaries and new IPC registrations.
- Expanded CI to Windows and Ubuntu.
- Improved SDD draft durability:
  - title and timestamps persisted in `meta.json`
  - content, metadata, and trace writes use temporary-file rename
  - list view avoids full draft reads
  - delete uses confirmation UI
- Stabilized provider action callbacks in `App.tsx`.
- Stabilized BrowserPanel initial URL behavior.
- Extended terminal run polling until completion/disappearance/abort.
- Made command palette extra commands mutually exclusive with shortcut handling.
- Added `docs/SECURITY.md` for fable5 path trust rules.
- Restricted SDD IPC operations to registered workspace roots and added a guard
  test for rejected unregistered roots.
- Fixed the Settings requirements tab so it resolves `workspaceId` to the
  workspace `rootPath` before loading SDD drafts.
- Completed a residual fable5 1.2.4 cleanup batch:
  - removed the unused legacy `_AgentSlotBar` implementation and slot state
    from `WorkbenchLayout`
  - made `conversation:exportFile` use resolved-path guards so filenames such
    as `project..demo.md` are allowed while traversal is still blocked
  - added `view-requirements` as a first-class shortcut/command palette command
  - surfaced provider config load exhaustion as a visible workbench alert with a
    retry action
  - added path, shortcut, and architecture guard coverage
- Started fable5 1.3.0 Workbench decomposition:
  - moved `NativeTitlebar` and its private menu component into
    `src/renderer/workbench/NativeTitlebar.tsx`
  - kept the move behavior-preserving apart from the intentional Requirements
    menu entry that matches the existing `view-requirements` command
  - reduced `WorkbenchLayout.tsx` from 2548 lines to 2389 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - moved the inspector shell, bottom dock, tool panel bar, panel title, and
    inspector width clamp helper into
    `src/renderer/workbench/WorkbenchPanels.tsx`
  - kept business panels in `WorkbenchLayout.tsx` for later isolated batches
  - reduced `WorkbenchLayout.tsx` from 2389 lines to 2085 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - connected `WorkbenchLayout.tsx` to the existing extracted
    `src/renderer/workbench/components/panels/WorktreePanel.tsx`
  - removed the duplicate inline `WorktreePanel` and `worktreeStatusLabel`
    implementation from `WorkbenchLayout.tsx`
  - preserved the previous status labels and worktree create/sync/open/remove
    behavior in the extracted component
- Continued fable5 1.3.0 Workbench decomposition:
  - connected `WorkbenchLayout.tsx` to the extracted
    `src/renderer/workbench/components/panels/BrowserPanel.tsx`
  - removed the inline `BrowserPanelV2` plus duplicate browser URL and capture
    attachment helpers from `WorkbenchLayout.tsx`
  - aligned the extracted browser panel with the current inline behavior,
    including stable `open()` dependencies and markdown attachment metadata
- Continued fable5 1.3.0 Workbench decomposition:
  - connected `WorkbenchLayout.tsx` to existing extracted pure utility modules
    for runtime event merging, slash command parsing, loop flag handling,
    provider model command resolution, and reasoning command labels
  - removed duplicate pure helper implementations from `WorkbenchLayout.tsx`
  - kept the fixed `watchTerminalRun` implementation local because the older
    utility version still has the pre-fix 24-poll cap
  - reduced `WorkbenchLayout.tsx` to 1695 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - connected `WorkbenchLayout.tsx` to the extracted
    `src/renderer/workbench/components/TodoPopoverRow.tsx`
  - removed the duplicate inline Todo row component from `WorkbenchLayout.tsx`
  - changed the extracted Todo row to use the renderer global `ThreadTodo` and
    `ThreadTodoStatus` types instead of a narrowed local copy
- Continued fable5 1.3.0 Workbench decomposition:
  - moved the chat top bar and Todo popover shell into
    `src/renderer/workbench/WorkbenchChatTopBar.tsx`
  - removed the inline `WorkbenchChatTopBar` implementation from
    `WorkbenchLayout.tsx`
  - reduced `WorkbenchLayout.tsx` to 1502 lines
- Started fable5 1.3.0 runtime-pipeline consolidation:
  - moved the Tasks screen data source off `App.tsx` legacy task state and onto
    derived Workbench runtime data
  - added `src/renderer/workbench/utils/taskItems.ts` to derive `TaskItem[]`
    from `WorkbenchSnapshot` plus per-thread runtime events
  - made `WorkbenchLayout` maintain full task-history event caches per thread
    so task history includes non-selected threads in the current workspace
  - changed Tasks cancel to use turn ids through `turns.cancel`
  - made task delete/clear remove runtime turns through `runtimeStore` before
    legacy dispatcher cleanup
  - fixed the pending-thread-switch event route so non-visible task-history
    events are still cached before the pending-switch early return
  - kept legacy `dispatch:stream` renderer subscription in place for the
    remaining chat-bubble and approval path; this is the next 3.1 slice
- Continued fable5 1.3.0 runtime-pipeline consolidation:
  - moved approval queue handling from `App.tsx` legacy `dispatch:stream`
    handling into `WorkbenchLayout` runtime event handling
  - added `src/renderer/workbench/utils/approvalEvents.ts` to convert
    `agent:approval` runtime events into `ApprovalDialog` items
  - kept legacy `hub.onStream` only for the remaining old chat-bubble
    compatibility path; approvals no longer depend on it
- Continued fable5 1.3.0 runtime-pipeline consolidation:
  - removed the renderer `hub.onStream` subscription from `App.tsx`
  - removed legacy memory-backed `messages`/`tasks` state and persistence from
    `App.tsx`
  - moved task delete/clear confirmation and IPC ownership into
    `WorkbenchLayout`
  - added runtime-event-driven agent busy display through
    `runtimeAgentStatusFromEvent` and `onRuntimeAgentStatus`, so short runs no
    longer depend on the 8 second `hub.getStatus()` polling interval
  - kept the renderer off legacy `dispatch:stream`; busy, approvals, chat, and
    task history now use `runtime:event` for this batch
- Continued fable5 1.3.0 runtime-pipeline consolidation:
  - removed dead renderer-facing legacy event APIs from `preload/index.ts` and
    `vite-env.d.ts`: `hub.onStatus`, `hub.onStream`, and `chat.onResponse`
  - removed the Electron `webContents.send("dispatch:stream", ...)` broadcast
    from `main/index.ts` while preserving `runtimeStore.appendStreamEvent`
  - added an architecture guard preventing `dispatch:stream`,
    `hub:status-update`, and `chat:response` from returning through preload or
    Electron `webContents.send`
  - intentionally kept `hub.broadcast("chat:response", ...)` for the external
    HubServer/WebSocket compatibility path
- Continued fable5 1.3.0 runtime-pipeline consolidation:
  - removed renderer-facing legacy invoke APIs from `preload/index.ts` and
    `vite-env.d.ts`: `hub.dispatch`, `hub.cancel`, `hub.routePreview`,
    `memory.loadState`, and `memory.saveState`
  - removed matching retired IPC registrations: `hub:dispatch`,
    `hub:cancel`, `hub:routePreview`, `memory:loadState`, and
    `memory:saveState`
  - kept provider-direct dispatch in the current `turns:create` and retry
    paths, and kept `MemoryLibrary.loadRuntimeState/saveRuntimeState` as
    internal/tested storage helpers without renderer IPC exposure
  - added an architecture guard preventing retired renderer invoke channels
    from returning through preload or `ipcMain.handle`
- Continued fable5 1.3.0 Workbench decomposition:
  - moved secondary tool-panel dispatch into
    `src/renderer/workbench/WorkbenchToolPanel.tsx`
  - moved the fixed terminal run watcher into
    `src/renderer/workbench/utils/terminalRunWatcher.ts`
  - kept Git in the bottom dock path and kept browser/worktree panel props
    behavior-preserving
  - added structure coverage to prevent the terminal watcher from regressing to
    the older fixed 24-poll cap
- Continued fable5 1.3.0 Workbench decomposition:
  - moved add-working-folder modal state, folder picking, validation, and
    `workspaces.create` into `src/renderer/workbench/CreateWorkspaceDialog.tsx`
  - kept post-create workbench orchestration in `WorkbenchLayout.tsx`:
    activate workspace, remember it, reload workbench, create a new chat, and
    select it
  - reduced `WorkbenchLayout.tsx` from 1659 lines to 1614 lines
  - added structure coverage to keep workspace creation dialog logic out of
    `WorkbenchLayout.tsx`
- Continued fable5 1.3.0 Workbench decomposition:
  - moved command palette command construction and extra-command resolution
    into `src/renderer/workbench/utils/paletteCommands.ts`
  - kept command execution side effects in `WorkbenchLayout.tsx`, with unknown
    palette commands falling back to the existing shortcut dispatcher
  - added direct utility coverage for shortcut command inclusion, extra command
    mappings, usable local-agent filtering, invalid agent rejection, and
    shortcut fallback behavior
  - reduced `WorkbenchLayout.tsx` from 1614 lines to 1577 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - moved the first-run workbench announcement modal into
    `src/renderer/workbench/WorkbenchAnnouncementModal.tsx`
  - kept localStorage seen-state and setup navigation side effects in
    `WorkbenchLayout.tsx`
  - preserved modal classes, backdrop close behavior, setup buttons, and the
    "Got it" close action
  - reduced `WorkbenchLayout.tsx` from 1577 lines to 1534 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - moved non-Git right-panel content routing into
    `src/renderer/workbench/WorkbenchRightPanelContent.tsx`
  - kept the non-Git inspector container/scrim and Git bottom dock in
    `WorkbenchLayout.tsx`
  - preserved runs, files, side-chat, terminal, and browser/worktree fallback
    panel behavior
  - reduced `WorkbenchLayout.tsx` from 1534 lines to 1496 lines

## Validation Log

- Earlier validation on this branch passed:
  - targeted vitest set: 13 tests passed
  - `npm run typecheck`
  - `npm run lint` with existing warnings only
  - `npm test`: 1027 tests passed
  - `npm run build`
- Current targeted validation:
  - `npx vitest run src/main/__tests__/version-sync.test.ts src/main/__tests__/architecture-guards.test.ts src/main/sdd/__tests__/sdd-store-template.test.ts src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts src/main/ipc/__tests__/terminal-pty-ipc.test.ts src/renderer/workbench/__tests__/viewModes.test.ts src/renderer/workbench/__tests__/terminalTabs.test.ts src/renderer/memory-save-policy.test.ts src/renderer/provider-config-load-policy.test.ts`
    - 9 files passed, 21 tests passed.
  - `npx vitest run src/main/ipc/__tests__/sdd-ipc.test.ts src/main/ipc/__tests__/path-guards.test.ts src/main/sdd/__tests__/sdd-store-template.test.ts`
    - 3 files passed, 8 tests passed.
  - `npx vitest run src/main/sdd/__tests__/sdd-store-template.test.ts`
    - 1 file passed, 5 tests passed, including the design-context metadata
      preservation regression.
- Final validation for this pass:
  - `npm run typecheck` passed.
  - `npm run lint` passed with existing warnings only.
  - `npm test` passed: 157 files, 1030 tests.
  - `npm run build` passed.
- Continuation baseline verification on 2026-07-04:
  - `npm run typecheck` passed.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed: 157 files, 1030 tests.
  - `npm run build` passed.
  - Read-only subagent review returned `APPROVE` with no blockers.
- Residual 1.2.4 cleanup validation:
  - Targeted tests passed:
    `npx vitest run src/main/ipc/__tests__/conversation-ipc.test.ts src/main/ipc/__tests__/path-guards.test.ts src/main/__tests__/architecture-guards.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/viewModes.test.ts`
    with 5 files and 14 tests passed.
  - `npm run typecheck` passed.
  - Targeted eslint passed for changed code and tests.
  - `git diff --check` passed.
  - Full validation before the final retry-counter tweak passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 158 files and 1034 tests, and `npm run build`.
  - Read-only subagent review returned `APPROVE`; its retry-counter note was
    addressed by adding the `reloadConfig` wrapper.
- Workbench titlebar split validation:
  - Initial read-only subagent review returned `BLOCKED` because
    `titlebar-menu-copy.test.ts` still searched `WorkbenchLayout.tsx`.
  - Updated the test to read `NativeTitlebar.tsx`; the follow-up targeted
    command passed with 3 files and 7 tests:
    `npm test -- --run src/renderer/workbench/__tests__/titlebar-menu-copy.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/viewModes.test.ts`.
  - `npm run typecheck` passed.
  - Targeted eslint for `NativeTitlebar`, `WorkbenchLayout`, and the titlebar
    test passed.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 158 files and 1034 tests.
  - `npm run build` passed.
- Workbench panel shell split validation:
  - Read-only subagent review returned `APPROVE` with no blockers. It noted
    that `WorkbenchPanels.tsx` must be included in the commit and suggested a
    later shared type extraction for `WorkbenchRightPanel`.
  - `npm run typecheck` passed.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 158 files and 1034 tests.
  - `npm run build` passed.
- Workbench WorktreePanel extraction validation:
  - `npm run typecheck` passed.
  - Targeted eslint for `WorkbenchLayout.tsx` and
    `components/panels/WorktreePanel.tsx` passed.
  - Targeted Workbench tests passed with 4 files and 9 tests:
    `titlebar-menu-copy`, `keyboard-shortcuts`, `viewModes`, and
    `git-dock-layout`.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for workspace-empty UI, create/sync/open/remove flows,
    confirmation, error handling, refresh, and loading state.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 158 files and 1034 tests.
  - `npm run build` passed.
- Workbench BrowserPanel extraction validation:
  - `npm run typecheck` passed.
  - Targeted eslint for `WorkbenchLayout.tsx`, `components/panels/BrowserPanel.tsx`,
    and `utils/browserUtils.ts` passed.
  - Targeted Workbench tests passed with 4 files and 9 tests:
    `titlebar-menu-copy`, `keyboard-shortcuts`, `viewModes`, and
    `git-dock-layout`.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for URL opening, initial URL handling, webview listeners,
    capture attachment, AI summary/analyze, loading/error UI, and external-open.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 158 files and 1034 tests.
  - `npm run build` passed.
- Workbench pure utility extraction validation:
  - `npm run typecheck` passed.
  - Targeted eslint for changed layout, utility modules, and tests passed.
  - Targeted tests passed with 3 files and 29 tests:
    `workbench-runtime-events`, `slash-command-behavior`, and
    `provider-routing-state`.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    compatibility with the current renderer `RuntimeEvent` shape, CJK slash
    command parsing, `@minimax-code` normalization, provider-direct model
    selection, and reasoning command behavior.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 158 files and 1038 tests.
  - `npm run build` passed.
- Workbench TodoPopoverRow extraction validation:
  - `npm run typecheck` passed.
  - Targeted eslint for `WorkbenchLayout.tsx` and `components/TodoPopoverRow.tsx`
    passed.
  - Targeted tests passed with 3 files and 8 tests:
    `workbench-runtime-events`, `thread-switching-layout`, and `workbench-copy`.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    JSX behavior parity plus valid ambient Todo types.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 158 files and 1038 tests.
  - `npm run build` passed.
- WorkbenchChatTopBar extraction validation:
  - `npm run typecheck` passed.
  - Targeted eslint for `WorkbenchLayout.tsx`, `WorkbenchChatTopBar.tsx`, and
    `TodoPopoverRow.tsx` passed.
  - Initial targeted tests passed with 3 files and 5 tests:
    `thread-switching-layout`, `workbench-copy`, and `git-dock-layout`.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for workspace selection, editor opening, tool panel bar,
    runs toggle, and Todo popover interactions.
  - Full `npm test` initially failed because `open-editor-actions.test.ts`
    still inspected `WorkbenchLayout.tsx` for code that moved into
    `WorkbenchChatTopBar.tsx`; the test was updated to inspect the new component.
  - Follow-up targeted tests passed with 4 files and 7 tests:
    `open-editor-actions`, `thread-switching-layout`, `workbench-copy`, and
    `git-dock-layout`.
  - `npm test` passed with 158 files and 1038 tests.
  - `npm run build` passed.
- Runtime-derived Tasks screen validation:
  - Initial read-only subagent review found two blockers:
    selected-thread loaded events were not written into the task event cache,
    and non-visible thread `agent:activity`/`orchestrate` events were not kept
    live for task history. Both were fixed before completion.
  - Follow-up read-only subagent review returned `APPROVE` with no blockers.
  - A later read-only re-review found one additional blocker: events for an
    already-loaded non-visible thread could be dropped during
    `pendingActiveThreadId` thread switching because the task-history append
    was after the early return. The event route was reordered and
    `isTaskHistoryEvent` was extracted for direct test coverage.
  - Follow-up read-only re-review returned `APPROVE` with no blockers for the
    pending-thread-switch fix.
  - Targeted tests passed with 4 files and 23 tests:
    `taskItems`, `runtime store`, `missing-ipc-tasks`, and
    `workbench-runtime-events`.
  - Extended targeted tests passed:
    - renderer workbench set: 8 files, 25 tests
    - main runtime/ipc set: 4 files, 18 tests
  - `npm run typecheck` passed.
  - Targeted eslint for changed files passed.
  - `git diff --check` passed.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 160 files and 1046 tests.
  - `npm run build` passed.
  - Final fresh validation after the pending-thread-switch fix:
    - `npx vitest run src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/taskItems.test.ts`
      passed with 2 files and 9 tests.
    - targeted eslint for the changed workbench runtime-event files passed.
    - `git diff --check` passed.
    - `npm run typecheck` passed.
    - `npm run lint` passed with 0 errors and 36 existing warnings.
    - `npm test` passed with 160 files and 1046 tests.
    - `npm run build` passed.
- Runtime approval queue validation:
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    that `App.tsx` no longer consumes legacy `approval` stream events,
    `WorkbenchLayout` queues `agent:approval` before visibility branching,
    duplicates are deduped by approval id, malformed approval payloads are
    ignored, and remember/resolve still calls the agentic IPC methods.
  - Targeted tests passed:
    `npx vitest run src/renderer/workbench/__tests__/approvalEvents.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts`
    with 2 files and 9 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed renderer approval/runtime files passed.
  - `git diff --check` passed.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 161 files and 1049 tests.
  - `npm run build` passed.
- Legacy renderer stream removal validation:
  - Initial read-only subagent review blocked the batch because removing
    `busyOverride` could hide short agent runs between `hub.getStatus()` polls.
  - Added runtime-event-driven busy tracking keyed by agent/run and requested a
    follow-up read-only subagent review.
  - Follow-up read-only subagent review returned `APPROVE` with no blockers and
    confirmed live `agent:start/done/error` events update the App immediately
    without restoring `hub.onStream`.
  - Targeted tests passed:
    `npx vitest run src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/approvalEvents.test.ts src/renderer/workbench/__tests__/taskItems.test.ts`
    with 3 files and 14 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed renderer runtime files passed.
  - `git diff --check` passed.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 161 files and 1051 tests.
  - `npm run build` passed.
- Legacy renderer stream API cleanup validation:
  - Targeted validation passed:
    `npx vitest run src/main/__tests__/architecture-guards.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts`
    with 2 files and 13 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed preload/main/type files passed.
  - `git diff --check` passed.
  - Initial read-only subagent review returned `BLOCKED` because the guard only
    blocked `dispatch:stream` in `webContents.send`; the guard was expanded to
    block all three legacy renderer event channels through `webContents.send`.
  - Follow-up read-only subagent review returned `APPROVE` with no blockers and
    confirmed no live renderer references to `hub.onStatus`, `hub.onStream`, or
    `chat.onResponse`.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 161 files and 1052 tests.
  - `npm run build` passed.
- Retired invoke API cleanup validation:
  - Static search confirmed the retired channel strings only remain in guard
    assertions after the patch.
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/main/__tests__/architecture-guards.test.ts src/main/__tests__/ipc-registration-uniqueness.test.ts src/main/ipc/__tests__/missing-ipc-tasks.test.ts src/main/memory-library.test.ts`
    with 5 files and 44 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed preload/main/type/test files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    task cancellation now goes through `turns.cancel`, provider-direct still
    routes through `turns:create`, and runtime-state memory methods are no
    longer exposed over IPC.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 161 files and 1053 tests.
  - `npm run build` passed.
- Workbench tool-panel and terminal watcher extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/workbench-copy.test.ts`
    with 4 files and 30 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed Workbench files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    WorkbenchToolPanel prop parity, Git bottom dock preservation, and
    open-ended terminal polling.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 161 files and 1054 tests.
  - `npm run build` passed.
- CreateWorkspaceDialog extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/viewModes.test.ts src/renderer/workbench/__tests__/workbench-copy.test.ts`
    with 4 files and 11 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed Workbench files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for dialog labels/classes, folder picking, remembered
    dialog path, validation, `workspaces.create`, and post-create workbench
    orchestration.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 161 files and 1055 tests.
  - `npm run build` passed.
- Palette command utility extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/paletteCommands.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 4 files and 27 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed palette/workbench files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for shortcut commands, extra commands, usable local-agent
    switch commands, setup mappings, workflow seeding, and shortcut fallback.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 162 files and 1057 tests.
  - `npm run build` passed.
- Workbench announcement modal extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/paletteCommands.test.ts src/renderer/workbench/__tests__/workbench-copy.test.ts`
    with 4 files and 12 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed announcement/workbench files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for seen-state ownership, modal structure, close behavior,
    setup navigation, and action buttons.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 162 files and 1058 tests.
  - `npm run build` passed.
- Workbench non-Git right panel content extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/workbench-copy.test.ts src/renderer/workbench/__tests__/paletteCommands.test.ts`
    with 4 files and 18 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed Workbench panel files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for the inspector container, Git bottom dock, run detail
    branch, RunTimeline props, files openPath behavior, side chat, terminal,
    and tool panel fallback.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 162 files and 1059 tests.
  - `npm run build` passed.

## Pending

- Continue fable5 1.3.0 runtime-pipeline consolidation in small verified
  batches.
- Next likely candidates: continue Workbench decomposition and store migration
  from fable5 3.3, with project creation modal and command palette logic as
  likely low-risk extraction targets.
- Re-run full validation after the next patch batch before commit.
