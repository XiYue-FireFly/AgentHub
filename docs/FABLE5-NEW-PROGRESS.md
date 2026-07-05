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
- Continued fable5 1.3.0 Workbench decomposition:
  - moved main view content routing into
    `src/renderer/workbench/WorkbenchMainContent.tsx`
  - kept state, effects, dispatch, runtime event handling, and side-panel
    containers in `WorkbenchLayout.tsx`
  - preserved write, chat, tasks, requirements, settings, and workflows view
    rendering, including the static Settings import behavior
  - reduced `WorkbenchLayout.tsx` from 1496 lines to 1361 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - moved keyboard shortcut command-id routing into
    `src/renderer/workbench/utils/shortcutCommands.ts`
  - kept `WorkbenchLayout.tsx` responsible only for executing the resolved
    UI/runtime side effects
  - fixed the registered `stop-task` shortcut so it now invokes the same
    `cancelLatest` path used by the composer cancel button
  - added direct shortcut resolver coverage plus a guard that every registered
    keyboard shortcut command maps to an action
  - reduced `WorkbenchLayout.tsx` from 1361 lines to 1355 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - moved native desktop menu command parsing into
    `src/renderer/workbench/utils/menuCommands.ts`
  - kept `WorkbenchLayout.tsx` responsible only for executing resolved menu
    side effects
  - preserved the menu whitelist for runs/git/worktrees/browser panels and the
    default setup-tab behavior when a menu setup command omits `tab`
  - added direct menu resolver coverage and a structure guard scoped to the
    native menu effect
  - reduced `WorkbenchLayout.tsx` from 1355 lines to 1352 lines
- Continued fable5 1.3.0 Workbench decomposition:
  - moved send-prompt dispatch request resolution into
    `src/renderer/workbench/utils/dispatchRequest.ts`
  - kept `WorkbenchLayout.tsx` responsible for UI state and the `turns.create`
    IPC call while pure routing decisions now live in a tested helper
  - preserved provider-direct, local-agent direct, editable-schedule sanitize,
    override schedule priority, and custom/smart schedule unavailable behavior
  - added direct resolver coverage and updated provider/slash routing structure
    guards to inspect the extracted helper
  - reduced `WorkbenchLayout.tsx` from 1352 lines to 1346 lines
- Continued fable5 1.3.0 SDD closed-loop work:
  - plan generation now flushes dirty requirement draft content before calling
    AI and builds the plan prompt from the latest editor state
  - assistant-generated plans persist SDD trace snapshots without overwriting a
    newly selected active draft, including same draft id in a different
    workspace
  - plan assistant messages expose a `Sync to Todo` action wired to the active
    Workbench thread
  - Todo markdown sync now accepts only machine-readable plan checklist items
    with valid `(covers: R-x)` markers, preventing acceptance criteria
    checkboxes from becoming Todos
  - the plan prompt template now requires `- [ ] T-x: ... (covers: R-x)` task
    checklist lines and no longer demonstrates checkbox syntax inside
    acceptance-criteria details
  - Workbench todo refresh now guards against stale async writes after thread
    switches, and Requirements view receives `activeThreadId` plus the todo
    refresh callback
- Continued fable5 1.3.0 SDD closed-loop work:
  - SDD plan Todo sync now carries draft/workspace/source metadata so synced
    Todos can be traced back to the requirement draft and plan item
  - plan Todo sync now updates only the matching SDD plan scope, preserving
    unrelated manual/agent Todos and existing plan metadata such as `turnId`
  - Todo rows expose a run action that dispatches through the existing
    Workbench `sendPrompt` path instead of calling `turns.create` directly
  - `sendPrompt` now returns the created turn result to callers that need the
    `turn.id`, while existing callers can continue ignoring the return value
  - dispatched plan Todos persist `source.turnId` and write the resulting
    `turnId` plus `in_progress` status back into the matching SDD trace plan
    item
  - SDD plan parsing now preserves explicit `T-x` task ids for trace/Todo
    matching
- Continued fable5 SDD trace visualization work:
  - added a read-only SDD trace matrix panel that shows requirement blocks,
    linked plan items, plan execution status, dispatched `turnId` badges, and
    uncovered requirements
  - mounted the trace panel in the SDD draft editor so generated/synced traces
    are visible next to the requirement document
  - made `loadDraft()` reload persisted `trace.json` via `sdd:getTrace` after
    opening a draft, with an active-draft/workspace guard so late trace loads do
    not overwrite a newly selected draft
  - kept this batch read-only; no requirement status propagation or acceptance
    criterion mutation was added
- Continued fable5 SDD status propagation work:
  - Todo status changes for SDD plan Todos now write the matching trace plan
    item status back to `trace.json`
  - trace status writeback recomputes requirement `derivedStatuses` so the
    trace panel reflects `planned`, `building`, and `done` as plan work moves
    from pending to in progress or completed
  - active draft/workspace guards keep late trace status writes scoped to the
    currently open requirement draft
  - this batch intentionally does not mutate acceptance criteria or call a
    review agent; AI-backed acceptance review remains a later SDD step
- Continued fable5 SDD acceptance verification work:
  - verification prompts now require a human report followed by a stable
    `sdd-verify-json` verdict block for every acceptance criterion
  - verification responses are parsed into `pass` / `fail` / `unknown` verdicts
    and invalid, duplicate, missing, or out-of-range criteria are rejected with
    warnings
  - the SDD editor exposes a manual Verify action that sends the saved/latest
    requirement draft plus trace plan evidence to the configured quick-complete
    provider
  - verification writeback is user-triggered through an assistant message
    action; only `pass` verdicts check acceptance boxes, and a requirement is
    marked `{verified}` only after all criteria are checked
  - writeback records an AI history snapshot before mutation, saves the draft,
    and reparses requirement blocks
  - each verification result is bound to draft id, workspace root, and a
    content hash so stale AI verdicts cannot be applied after the user edits or
    reorders the requirement document
  - assistant auto-send triggers now use a separate `initialMessageKey`, so the
    same visible Verify or Generate Plan prompt can be run repeatedly while the
    assistant panel stays open
- Continued fable5 SDD verification evidence work:
  - verification prompts now include a renderer-side evidence summary built from
    the current SDD trace plan items, current-thread SDD plan Todos, and related
    runtime events
  - evidence is scoped to the active draft id, workspace root, and relative
    requirement path so a thread containing SDD Todos from another draft cannot
    leak unrelated implementation evidence into the current verification prompt
  - related runtime events are included only when their `turnId` is referenced
    by the scoped trace or scoped SDD Todos
  - this batch remains review-only until the user clicks `Apply passed`; stale
    draft/workspace/content-hash writeback guards from the previous batch remain
    in place
- Continued fable5 SDD verification result presentation work:
  - verification assistant messages now show a read-only Pass / Fail / Unknown
    summary parsed from the `sdd-verify-json` block before the user applies any
    writeback
  - malformed JSON verdict entries such as `criteria: [null]` are ignored with
    parser warnings instead of throwing during message render
  - `Apply passed` remains manual and still sends the original verification
    markdown plus apply context through the existing stale writeback guard
- Continued fable5 runtime event performance work:
  - optimized `mergeRuntimeEventLists` with a conservative append fast path for
    monotonic runtime events that do not carry explicit ids
  - preserved existing id-based dedupe semantics by routing id-bearing incoming
    events through the original base-scan path
  - added coverage for monotonic append order, repeated incoming events,
    cross-base id duplicates with newer seq values, and the newest-5000 cap
- Continued fable5 stdio adapter robustness work:
  - changed Windows `StdioAgentAdapter.stop()` to await
    `taskkill /pid <pid> /t /f` via `execFile` instead of fire-and-forget shell
    command execution
  - taskkill failures are now logged with the adapter name and pid while
    preserving the previous cleanup behavior of clearing `proc` and returning
    the adapter to idle
  - non-Windows `SIGKILL` behavior is unchanged
- Continued fable5 provider performance work:
  - `ProviderManager.getConfig()` now caches the sorted deep-cloned provider
    config snapshot by an internal revision, avoiding repeated provider sorting
    when the config has not changed.
  - `getConfig()` still returns a fresh deep clone on every call so renderer IPC
    sanitizers and other callers cannot mutate manager state or the cached
    snapshot.
  - Provider, routing, model, secret-unlock, save, and delayed health-check save
    paths invalidate the cached snapshot before subsequent reads.
  - Added regression coverage for stable sorted snapshots, returned-object
    isolation, and cache invalidation after provider/routing changes.
- Continued fable5 SDD verification evidence work:
  - SDD verification prompts now include bounded runtime status evidence for
    scoped dispatched plan turns: `turn:summary`, `turn:status`, `run:status`,
    and `guard:verdict`.
  - Runtime evidence formatting now exposes prompt-optimizer/dispatcher summary
    fields such as intent, selected skills/plugins, routing strategy, dispatch
    mode, and selected agent.
  - Evidence summaries cap trace items, todos, and runtime events with omission
    markers, and each evidence line is shortened before entering the AI prompt.
  - Same-draft SDD todos are now filtered against the current trace plan item
    ids and turn ids when a trace is available, preventing old or parallel plan
    evidence from leaking into the current verification prompt.
  - Acceptance writeback behavior remains manual: only parsed AI verdicts from
    `sdd-verify-json` are applied when the user clicks `Apply passed`.

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
- Workbench main content extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/provider-routing-state.test.ts src/renderer/workbench/__tests__/settings-chunk.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 3 files and 15 tests after updating static structure tests to inspect
    `WorkbenchMainContent.tsx`.
  - Earlier targeted Workbench set passed:
    `npx vitest run src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/workbench-copy.test.ts src/renderer/workbench/__tests__/paletteCommands.test.ts`
    with 4 files and 19 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed main-content/workbench tests passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for config error, write/chat/tasks/requirements/settings/
    workflows view branches, chat props, Settings props, and static Settings
    import behavior.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 162 files and 1060 tests.
  - `npm run build` passed.
- Workbench shortcut command routing extraction validation:
  - Initial targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/shortcutCommands.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/paletteCommands.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 4 files and 18 tests.
  - Read-only subagent review initially returned `BLOCKED` because the
    registered `stop-task` shortcut had no resolver action and there was no
    complete registered-command mapping guard.
  - Added `stop-task` to the resolver and routed it through `cancelLatest`;
    added complete `KEYBOARD_SHORTCUT_COMMANDS` mapping coverage and structure
    coverage for the cancel path.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/shortcutCommands.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts src/renderer/workbench/__tests__/paletteCommands.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 4 files and 19 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed shortcut/workbench files passed.
  - `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE` with no blockers.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm run build` passed.
  - First parallel `npm test` attempt timed out in three unrelated long-running
    tests while `lint` and `build` were running concurrently; a fresh standalone
    `npm test` rerun passed with 163 files and 1066 tests.
- Workbench native menu command parsing extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/menuCommands.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/titlebar-menu-copy.test.ts`
    with 3 files and 14 tests after narrowing the structure guard to the
    native menu effect so it does not inspect slash-command branches.
  - `npm run typecheck` passed.
  - Targeted eslint for changed menu/workbench files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    behavior parity for new-thread, open-project, view, open-panel, and setup
    commands, including default setup-tab behavior.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 164 files and 1071 tests.
  - `npm run build` passed.
- Workbench dispatch request extraction validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/dispatchRequest.test.ts src/renderer/workbench/__tests__/provider-routing-state.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/customSchedule.test.ts`
    with 5 files and 44 tests.
  - `npm run typecheck` passed.
  - Targeted eslint for changed dispatch/workbench files passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE` with no blockers and confirmed
    parity for provider direct, local direct, override schedule priority,
    schedule sanitization, and unavailable custom/smart schedules.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 165 files and 1077 tests.
  - `npm run build` passed.
- SDD closed-loop minimum validation:
  - Initial read-only subagent review found two blockers: trace stale guard only
    compared `draft.id`, and the plan prompt still showed non-task checkbox
    examples. Both were fixed.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/components/SddAssistantPanel.test.tsx src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/sdd-draft-actions.test.ts src/renderer/sdd/sdd-plan-prompt.test.ts src/main/runtime/__tests__/todos.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 6 files and 21 tests.
  - Targeted eslint for changed SDD, Todo, and Workbench files passed.
  - `git diff --check` passed.
  - `npm run typecheck` passed.
  - Follow-up read-only subagent review returned `APPROVE` with no blockers.
  - `npm run lint` passed with 0 errors and 36 existing warnings.
  - `npm test` passed with 168 files and 1086 tests.
  - `npm run build` passed.
- SDD Todo dispatch closed-loop validation:
  - Targeted validation passed:
    `npx vitest run src/main/runtime/__tests__/todos.test.ts src/main/sdd/__tests__/sdd-trace.test.ts src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 5 files and 36 tests.
  - Targeted eslint for changed Todo, SDD dispatch, and Workbench files passed.
  - `git diff --check` passed.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 Settings/Workbench behavior coverage:
  - Added `src/renderer/screens/WorkspacesTab.test.tsx` with real
    Testing Library coverage for workspace list loading, active workspace
    display, folder picking during create, saving, setting another workspace
    active, and confirmed removal.
  - This directly covers the Settings workspace-management UI path that had
    previously been protected mostly by IPC and source-structure tests.
  - Targeted validation passed:
    `npx vitest run src/renderer/screens/WorkspacesTab.test.tsx src/renderer/screens/Settings.models.test.ts src/main/ipc/__tests__/workspace-ipc.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/provider-ipc.test.ts`
    with 5 files and 25 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/screens/WorkspacesTab.tsx src/renderer/screens/WorkspacesTab.test.tsx`.
- Continued fable5 Settings model-center behavior coverage:
  - Exported `ModelsTab` from `src/renderer/screens/Settings.tsx` so it can be
    tested as a real component instead of only through source-string checks.
  - Extended `src/renderer/screens/Settings.models.test.ts` with Testing
    Library coverage for provider model-card rendering, default model route
    selection, upstream model updates, model test execution with the current
    upstream value, and Codex catalog export feedback.
  - Targeted validation passed:
    `npx vitest run src/renderer/screens/Settings.models.test.ts src/renderer/screens/WorkspacesTab.test.tsx src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/provider-ipc.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/screens/Settings.tsx src/renderer/screens/Settings.models.test.ts src/renderer/screens/WorkspacesTab.test.tsx`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Initial read-only subagent review returned `BLOCKED` because plan sync
    replaced unrelated thread Todos and Todo dispatch marked `in_progress`
    before a turn existed. Both blockers were fixed.
  - Follow-up read-only subagent review returned `APPROVE` with no remaining
    blockers.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 169 files and 1092 tests, and `npm run build`.
- SDD trace visualization validation:
  - Initial targeted validation passed:
    `npx vitest run src/renderer/sdd/components/SddTracePanel.test.tsx src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/sdd-trace-dispatch.test.ts`
    with 3 files and 7 tests.
  - Targeted eslint for the new trace panel, editor mount, and SDD export
    passed.
  - `npx tsc -b --noEmit --pretty false` passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `BLOCKED` because persisted traces were
    not reloaded when reopening a draft; `loadDraft()` only set the draft and
    cleared in-memory trace.
  - Fixed `loadDraft()` to call `sdd:getTrace` after opening a draft and to
    guard late trace writes by active draft id plus workspace root.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-draft-actions.test.ts src/renderer/sdd/components/SddTracePanel.test.tsx src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/sdd-trace-dispatch.test.ts`
    with 4 files and 10 tests.
  - Follow-up targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE` with no remaining
    blockers.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 170 files and 1097 tests, and `npm run build`.
- SDD Todo status propagation validation:
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/sdd/components/SddTracePanel.test.tsx`
    with 3 files and 20 tests.
  - Targeted eslint for `sdd-trace-dispatch`, `WorkbenchLayout`, and the related
    tests passed.
  - `npx tsc -b --noEmit --pretty false` passed.
  - `git diff --check` passed.
  - Read-only subagent review returned `APPROVE`, confirming Todo status changes
    flow through `persistSddPlanTodoStatus`, match trace plan items by
    `planItemId` or normalized text, recompute requirement derived statuses, and
    update the active SDD trace store when draft/workspace scopes match.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 170 files and 1100 tests, and `npm run build`.
- SDD acceptance verification validation:
  - Initial targeted validation exposed a TSX parse error caused by an
    unsafe localized string in the new verification action; the string was
    replaced with ASCII-safe text and retested.
  - First read-only subagent review returned `BLOCKED` with two P1 issues:
    stale AI verdicts could be applied after requirement content changed, and
    Verify could not be triggered twice while the assistant panel stayed open.
  - Fixed both blockers by adding draft/workspace/content-hash verification
    snapshots and a separate assistant `initialMessageKey`.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/sdd-draft-actions.test.ts src/renderer/sdd/components/SddAssistantPanel.test.tsx src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx`
    with 5 files and 19 tests.
  - Targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE` and independently
    reran the 5-file targeted vitest set successfully.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 172 files and 1112 tests, and `npm run build`.
- SDD verification evidence summary validation:
  - Initial targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx`
    with 2 files and 12 tests.
  - Targeted eslint for changed SDD evidence files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - First read-only subagent review returned `BLOCKED` because all SDD plan
    Todos with any `source.draftId` were included, which could leak Todos and
    their runtime events from another draft in the same thread.
  - Fixed the blocker by passing active draft id, workspace root, and relative
    path into `buildVerifyEvidenceSummary`, filtering SDD Todos to that scope,
    and deriving related runtime event turn ids only from scoped trace/Todos.
  - Added regression coverage for mixed same-thread SDD Todos/events from other
    drafts and workspaces.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx`
    with 2 files and 13 tests.
  - Follow-up targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE` and independently
    reran:
    `npm test -- src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/sdd-draft-actions.test.ts`
    with 3 files and 18 tests.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 172 files and 1114 tests, and `npm run build`.
- SDD verification result presentation validation:
  - Initial targeted validation passed:
    `npx vitest run src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx src/renderer/sdd/components/SddAssistantPanel.test.tsx src/renderer/sdd/sdd-verify-prompt.test.ts`
    with 3 files and 11 tests.
  - Targeted TS/TSX eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - First read-only subagent review returned `BLOCKED` because malformed
    machine-readable AI output like `criteria: [null]` could still throw during
    verification summary render.
  - Fixed the parser to ignore non-object verdict entries with warnings and
    added regression coverage for malformed JSON verdict entries.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx src/renderer/sdd/components/SddAssistantPanel.test.tsx`
    with 3 files and 12 tests.
  - Follow-up targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE` and independently
    reran:
    `npm test -- --run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx`
    with 2 files and 10 tests.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 172 files and 1115 tests, and `npm run build`.
- Runtime event merge optimization validation:
  - Initial targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/taskItems.test.ts`
    with 2 files and 15 tests.
  - Targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - First read-only subagent review returned `BLOCKED` because the initial fast
    path could append an incoming event with the same explicit `id` as an
    existing base event when the incoming `seq` was newer.
  - Fixed the parity issue by making the fast path apply only to monotonic
    incoming events without explicit ids; id-bearing events continue through the
    original dedupe path.
  - Added regression coverage for cross-base id duplicates with newer seq
    values.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/taskItems.test.ts`
    with 2 files and 16 tests.
  - Follow-up targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE` and independently
    reran:
    `npx vitest run src/renderer/workbench/__tests__/workbench-runtime-events.test.ts`
    with 13 tests passed.
  - Full validation passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 36 existing warnings,
    `npm test` with 172 files and 1119 tests, and `npm run build`.
- Stdio adapter stop/taskkill validation:
  - Targeted validation passed:
    `npx vitest run src/main/hub/adapters/__tests__/stdio-prompt.test.ts src/main/hub/__tests__/createAdapter.test.ts`
    with 2 files and 20 tests.
  - Targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Read-only subagent review returned `APPROVE`; it independently reran
    `npm test -- --run src/main/hub/adapters/__tests__/stdio-prompt.test.ts`
    and confirmed the Windows path now avoids shell command composition and
    waits for `taskkill` completion.
  - Full validation:
    `npm run typecheck` passed; `npm run lint` passed with 0 errors and 36
    existing warnings; `npm run build` passed.
  - The first `npm test` full run had one unrelated
    `src/main/runtime/__tests__/git-runtime.test.ts` timeout in
    `does not commit unselected staged files`; the failed file then passed on a
    standalone rerun with 3 tests passed.
  - A fresh full `npm test` rerun passed with 172 files and 1120 tests.
- Diagnostics recent app-event-log validation:
  - Added read-only recent app event log access through `logs:recent`, exposed
    as `window.electronAPI.diagnostics.recentLogs(limit)`.
  - The recent log reader tail-reads at most 512KB, clamps returned entries to
    500, returns an empty result for missing logs, and reports malformed JSON
    lines as parse warnings instead of throwing.
  - Settings now has a Diagnostics tab that runs the existing quick
    `diagnostics.run()` checks and shows recent error/event rows in bounded
    scrollable panels; it does not call the heavy diagnostics suite or release
    checks.
  - Palette command `open-diagnostics` now opens Settings > Diagnostics instead
    of Appearance.
  - Initial read-only subagent review returned `BLOCKED` with two issues:
    `logs:recent` was being wrapped by global IPC logging and therefore wrote
    to the same log it read, and historical positional provider key args could
    be exposed when displayed from existing app-event-log entries.
  - Fixed both blockers by excluding `logs:path`/`logs:recent` from the global
    IPC logging wrapper, redacting provider positional keys for
    `providers:setKey`, redacting common sk/Bearer/Gemini/GitHub token-shaped
    strings, and re-redacting parsed historical entries before returning them
    to the renderer.
  - Targeted validation passed:
    `npx vitest run src/main/runtime/__tests__/app-event-log.test.ts src/renderer/workbench/__tests__/paletteCommands.test.ts src/renderer/workbench/__tests__/settings-copy.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 4 files and 23 tests.
  - Targeted eslint for changed diagnostics/logging files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE`; it independently
    reran the app-event-log, palette, settings-copy, and git-dock-layout test
    sets successfully and confirmed the two blockers were closed.
  - Full validation:
    `npm run typecheck` passed; `npm run lint` passed with 0 errors and 36
    existing warnings; `npm run build` passed.
  - The first full `npm test` run was executed in parallel with lint/build and
    hit three unrelated 5s timeouts in `missing-ipc-tasks`, `open-target`, and
    `skills/manager`; each failed file passed on a standalone rerun.
  - A fresh standalone full `npm test` rerun passed with 173 files and 1127
    tests.
- Provider config event-driven refresh validation:
  - Added `providers:configChanged` forwarding from the main provider manager
    to renderer windows through the existing provider IPC module.
  - Exposed `window.electronAPI.providers.onConfigChanged(callback)` with
    listener cleanup in preload and renderer types.
  - `App.tsx` now subscribes to provider config events, applies incoming
    configs, clears empty-config retry state for non-empty configs, and keeps
    manual Settings reload as the fallback path.
  - Normal provider/routing writes no longer call an immediate extra
    `loadConfig(); refreshStatus()` after operations that already return or
    broadcast sanitized config.
  - Initial read-only subagent review returned `BLOCKED` because the first
    event payload sanitizer masked only `apiKey` and could leak custom auth
    headers or token-like provider fields.
  - Fixed the blocker by deleting `customHeaders` from renderer-facing provider
    config and recursively masking sensitive field names such as API keys,
    authorization, password, secret, credential, bearer, and singular token
    fields, while preserving normal numeric fields such as `budgetTokens`.
  - Follow-up read-only subagent review returned `APPROVE` with no remaining
    blockers.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/provider-ipc.test.ts src/renderer/provider-config-events.test.ts src/renderer/provider-config-load-policy.test.ts src/main/providers/__tests__/managerFetchModels.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint for changed provider IPC, preload, App, renderer type, and
    provider event test files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 175 files and 1130 tests.
- Provider getConfig cache validation:
  - Targeted validation passed:
    `npx vitest run src/main/providers/__tests__/managerFetchModels.test.ts src/main/ipc/__tests__/provider-ipc.test.ts src/renderer/provider-config-events.test.ts src/renderer/provider-config-load-policy.test.ts`
    with 4 files and 20 tests.
  - Targeted eslint for changed provider manager and provider manager test files
    passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Read-only subagent review returned `APPROVE`, confirming cache invalidation,
    fresh-return clone semantics, and preserved sorted provider ordering.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 175 files and 1132 tests.
- SDD verification runtime evidence validation:
  - Initial targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx`
    with 3 files and 15 tests.
  - Initial read-only subagent review returned `BLOCKED`: runtime evidence was
    too broad, trace/todo sections were not capped, and same-draft todos could
    include old or parallel plan evidence.
  - Fixed the blockers by allowing only `turn:summary`, `turn:status`,
    `run:status`, and `guard:verdict`, adding caps/omission markers, shortening
    trace and todo text, and requiring todos to match the active trace plan item
    and turn set when available.
  - Follow-up targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx`
    with 3 files and 16 tests.
  - Follow-up targeted eslint, `npx tsc -b --noEmit --pretty false`, and
    `git diff --check` passed.
  - Follow-up read-only subagent review returned `APPROVE`, confirming all
    three blockers were closed and writeback behavior remained manual.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 175 files and 1133 tests.
- SDD version history and rollback validation:
  - Normal requirements assistant chat writeback now records a pre-mutation AI
    history snapshot before changing the requirement document. Plan and verify
    assistant responses remain report-only until their existing explicit user
    actions are used.
  - Draft history is now scoped by draft id plus workspace root, returns
    defensive copies, keeps the latest 20 snapshots, and no longer truncates
    persisted snapshot content.
  - `restoreFromHistory()` no longer marks restored content as saved; the
    editor history panel restores the selected version, then calls
    `saveDraftToDisk()` and `parseRequirementBlocks()` so rollback is written
    back to disk.
  - Added a compact editor history panel with version selection, timestamp and
    author metadata, simple added/removed diff counts, and an explicit Restore
    action.
  - Added coverage for full long-document snapshots, workspace-scoped history
    isolation, history retention/version numbering, diff output, wrong-workspace
    restore refusal, normal assistant chat pre-write snapshots, and editor
    restore save/parse behavior.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-draft-history.test.ts src/renderer/sdd/sdd-draft-actions.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/components/SddTracePanel.test.tsx`
    with 4 files and 22 tests.
  - Targeted eslint for changed SDD history/editor/list/test files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Initial read-only subagent review returned `BLOCKED` because the first
    scoped-history implementation could still import legacy unscoped
    `draftId` history into a workspace-scoped key.
  - Fixed the blocker by removing legacy unscoped-key fallback reads. Follow-up
    subagent review returned `APPROVE` with no remaining blockers.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 176 files and 1142 tests.
- SDD explicit commit evidence validation:
  - Added `SddCommitEvidence` to the renderer SDD store, main SDD types, and
    renderer preload globals so trace plan items can carry explicit commit
    links without changing runtime event kinds or scanning recent Git history.
  - Verification evidence now includes a bounded `Related commit evidence`
    section built only from commits explicitly attached to current trace plan
    items. Commit entries with a `turnId` are included only when that turn is
    part of the scoped trace/todo evidence set.
  - Commit evidence lines contain short SHA, optional summary, changed-file
    summaries, and turn linkage only; full diffs are intentionally excluded
    from the verification prompt.
  - The SDD trace panel now renders compact commit short-SHA chips with full
    SHA/summary/file-count hover details beside the existing dispatched turn
    badge.
  - Added `persistSddPlanCommitEvidence()` as the controlled write path for
    explicitly attaching a `GitCommitDetails` result to a single draft,
    workspace, and trace plan item with SHA de-duplication.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddTracePanel.test.tsx src/renderer/sdd/sdd-trace-dispatch.test.ts`
    with 3 files and 20 tests.
  - Targeted eslint for changed SDD commit-evidence files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Read-only subagent review returned `APPROVE`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 176 files and 1144 tests.
- Git to SDD explicit commit linkage validation:
  - Added a user-facing manual linkage entry in `GitWorkbenchPanel` commit
    details. The entry appears only when the renderer has an active SDD draft,
    an active trace, `git status` reports a repository root, that root exactly
    matches the draft workspace root, and the trace draft id matches the active
    draft id.
  - Users must select a trace plan item and click `Link commit`; the Git panel
    does not auto-associate recent commits, newly created commits, timestamps,
    or commit messages with SDD work.
  - The link action calls the controlled `persistSddPlanCommitEvidence()` path
    with `workspaceRoot`, `draftId`, `planItemId`, `GitCommitDetails`, and the
    selected plan item `turnId`.
  - Added regression coverage for no active SDD trace and `git status.rootPath`
    being null, both of which must hide `Requirement trace` / `Link commit`.
  - Initial read-only subagent review returned `BLOCKED` because the first
    implementation allowed the linkage entry when `status.rootPath` was
    missing. Fixed it by requiring `status.rootPath` to exist and match the
    active draft workspace root. Follow-up subagent review returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddTracePanel.test.tsx`
    with 4 files and 23 tests.
  - Targeted eslint for changed Git/SDD TS/TSX files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 177 files and 1147 tests.
- IPC workspace path trust validation:
  - Added shared registered-workspace root guards for IPC paths:
    `resolveRegisteredWorkspaceRoot()`, `assertRegisteredWorkspaceRoot()`, and
    `resolvePathInRegisteredWorkspace()`.
  - `workspaceFiles:read`, `write`, `readImage`, and `listDirectory` now require
    a registered workspace root before resolving relative paths, while retaining
    the `resolve + relative` traversal check that allows legal filenames such as
    `release..notes.md`.
  - `workspaceFiles:list` and `search` now allow directories inside a registered
    workspace, preserving lazy file-tree subdirectory expansion, and reject
    paths outside every registered workspace.
  - `app:openPath`, `app:resolvePath`, and `app:readTextFile` now require an
    explicitly supplied `workspaceRoot` to be registered. Calls without an
    explicit root keep the existing active-workspace/userData/home behavior.
  - SDD IPC now validates and then uses the canonical registered workspace root
    for `createSddStore()` and create-draft options, avoiding casing or
    `.`/`..` normalization drift after validation.
  - Added regression coverage for unregistered root rejection, registered
    subdirectory list/search, legal two-dot filenames, traversal rejection,
    explicit app path root rejection, and SDD canonical root usage.
  - Initial read-only subagent review returned `BLOCKED` because exact-root
    matching broke file-tree subdirectory expansion and SDD validation discarded
    the canonical root. Both blockers were fixed and follow-up subagent review
    returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/workspace-ipc.test.ts src/main/ipc/__tests__/missing-ipc-app-path.test.ts src/main/ipc/__tests__/path-guards.test.ts src/main/ipc/__tests__/sdd-ipc.test.ts src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts`
    with 5 files and 13 tests.
  - Targeted eslint for changed IPC and test files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 179 files and 1155 tests.
- Webview and sensitive text-file guard validation:
  - Extracted webview attach security into
    `src/main/security/webview-guards.ts` so it can be tested directly.
  - `will-attach-webview` now rejects non-HTTP(S) URLs, strips preload fields,
    disables Node integration in frames and workers, keeps context isolation and
    sandbox enabled, disables insecure content, and pins webviews to the
    independent `persist:agenthub-browser-webview` partition.
  - `setWindowOpenHandler` still denies all popups and opens only HTTP(S)
    targets externally.
  - Replaced extension-only `app:readTextFile` sensitive-file blocking with
    `isSensitiveTextFilePath()`, covering `.env`, `.env.*`, `.npmrc`, `.netrc`,
    `.pypirc`, key/cert extensions, and common SSH key filenames including
    `id_rsa_backup`.
  - Added targeted coverage for scheme filtering, webview preference
    sanitization, partition pinning, popup denial, sensitive filename blocking,
    and `app:readTextFile` refusing sensitive names before disk access.
  - Read-only subagent review returned `APPROVE`; its minor suggestion to block
    `id_rsa*` prefix backup names was adopted.
  - Targeted validation passed:
    `npx vitest run src/main/security/__tests__/webview-guards.test.ts src/main/ipc/__tests__/sensitive-files.test.ts src/main/ipc/__tests__/missing-ipc-app-path.test.ts src/main/ipc/__tests__/path-guards.test.ts`
    with 4 files and 11 tests.
  - Targeted eslint for changed webview/security/IPC files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 181 files and 1161 tests.
- IPC contract skeleton validation:
  - Added `src/shared/ipc-contract.ts` as the first shared IPC contract
    skeleton for migrated `workspaceFiles:*` and `sdd:*` channels.
  - Added `typedHandle<K extends IpcChannel>()` for main-process handlers and
    `typedInvoke<K extends IpcChannel>()` for preload invocations.
  - Migrated `workspace-ipc.ts`, `sdd-ipc.ts`, and the matching preload
    `workspaceFiles`/`sdd` calls to the typed wrappers while leaving unrelated
    IPC channels untouched for later batches.
  - Kept the shared contract self-contained instead of importing main-process
    SDD types, preserving renderer/main TypeScript project boundaries.
  - Added a guard test that checks the contracted channel set, prevents migrated
    main handlers from regressing to bare `ipcMain.handle`, and prevents
    migrated preload calls from regressing to bare `ipcRenderer.invoke`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/workspace-ipc.test.ts src/main/ipc/__tests__/sdd-ipc.test.ts`
    with 3 files and 10 tests.
  - Targeted eslint for changed IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Read-only spec compliance subagent review returned `APPROVE`.
  - Read-only code quality subagent review returned `APPROVE`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 36 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1164 tests.
- Hook execution warning degradation validation:
  - Centralized hook timeout and exception handling in `executeHook()` so
    `PreToolUse`, `PostToolUse`, `PreDispatch`, and `PostDispatch` hooks all
    degrade to phase-scoped warnings instead of aborting the full hook chain.
  - Preserved existing normal hook behavior for allow/deny decisions, argument
    rewrites, output rewrites, additional dispatch context, and observer
    messages.
  - Added regression coverage proving failing `PreToolUse` and `PostToolUse`
    hooks warn and allow later hooks to continue, including the timeout path for
    `PreToolUse`; also covered `PreDispatch` and `PostDispatch` continuation.
  - Targeted validation passed:
    `npx vitest run src/main/hooks/__tests__/hook-engine.test.ts`
    with 1 file and 23 tests.
  - Targeted eslint for changed hook files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Read-only spec compliance subagent review returned `APPROVE`.
  - Read-only code quality subagent review returned `APPROVE`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Provider/routing IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `providers:*` and
    `routing:*` invoke channels with renderer-safe provider, routing, health,
    fetch-models, and thinking config structures.
  - Kept the new provider contract self-contained and did not import
    main-process provider types into the shared contract.
  - Migrated `provider-ipc.ts` provider/routing handlers from bare
    `ipcMain.handle` to `typedHandle` without changing handler bodies or
    provider behavior.
  - Migrated the matching `providers` and `routing` preload methods to
    `typedInvoke` while preserving the exposed `window.electronAPI` shape.
  - Expanded the IPC contract guard so migrated provider/routing channels must
    be declared in the contract and must not regress to bare IPC calls.
  - Initial read-only spec review returned `BLOCKED` because
    `providers:healthAll` had to account for the existing per-provider fallback
    shape `{ ok: false, error }`; the contract was corrected with
    `ProviderHealthResultLike` without changing runtime behavior.
  - Follow-up read-only spec review returned `APPROVE`; read-only code quality
    review returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/provider-ipc.test.ts src/renderer/provider-config-events.test.ts src/main/providers/__tests__/managerFetchModels.test.ts`
    with 4 files and 21 tests.
  - Targeted eslint for changed provider IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Workflows IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `workflows:list/get/upsert/delete/search/seed` channels with workflow
    definition, step, category, and upsert input types matching the current
    runtime workflow API.
  - Migrated only the workflows handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; store, shortcut, diagnostics, backup,
    notification, onboarding, slash-command, project-map, and GitHub handlers
    in the same file were intentionally left untouched for later batches.
  - Migrated the matching preload `workflows` methods to `typedInvoke` while
    preserving the existing `window.electronAPI.workflows` method names and
    return shapes.
  - Expanded the IPC contract guard so workflow channels must be declared in
    the contract and must not regress to bare IPC calls.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 1 file and 3 tests.
  - Targeted eslint for changed workflow IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Read-only spec compliance subagent review returned `APPROVE`.
  - Read-only code quality subagent review returned `APPROVE`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Plugins IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `plugins:*`
    channels with manifest, contribution, repository import, and installed
    plugin structures matching the current plugin runtimes.
  - Migrated `plugins-ipc.ts` plugin handlers from bare `ipcMain.handle` to
    `typedHandle` without changing handler bodies or plugin behavior.
  - Migrated the matching preload `plugins` and `pluginManager` methods to
    `typedInvoke` while preserving the exposed `window.electronAPI` method
    names and return shapes.
  - Strengthened the IPC contract guard to parse TypeScript AST call
    expressions and `IpcContract` members instead of relying on brittle string
    containment checks.
  - Initial read-only code quality review returned `BLOCKED` because
    `pluginManager.install` used `manifest as any` and the guard used brittle
    substring checks. The preload plugin inputs now use `IpcArgs<'...'>[0]`
    and the guard now checks AST-collected channel calls.
  - Read-only spec compliance review returned `APPROVE`; follow-up read-only
    code quality review returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/batch4-modules.test.ts src/main/runtime/__tests__/p4-remaining.test.ts`
    with 3 files and 30 tests.
  - Targeted eslint for changed plugin IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Todos IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `todos:list/set/upsert/delete/clear/syncFromMarkdown` channels with
    `ThreadTodo`, `ThreadTodoSource`, status, set input, upsert input, and SDD
    plan sync source-context structures matching the current todo runtime.
  - Migrated only the six `todos:*` handlers in `passthrough-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; other passthrough handlers were left for
    later batches.
  - Migrated the matching preload `todos` methods to `typedInvoke` while
    preserving the exposed `window.electronAPI.todos` method names.
  - Aligned `src/renderer/vite-env.d.ts` so renderer callers see the same todo
    input shapes as the shared IPC contract, including `ThreadTodoSetInput`,
    `ThreadTodoSource`, and the narrower SDD plan sync source context.
  - Expanded the IPC contract guard so migrated todo channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Initial read-only code quality review returned `BLOCKED` because renderer
    todo declarations still used `source?: any` and a broader
    `Partial<ThreadTodoSource>` sync context. Initial read-only spec review
    returned `BLOCKED` because `todos.set` still exposed `ThreadTodo[]` rather
    than the contract set-input shape. Both were fixed and follow-up read-only
    reviews returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/todos.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/sdd-trace-dispatch.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint for changed todo IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Goals IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `goals:get/set/clear` channels with the current `WorkbenchGoal` structure.
  - Migrated only the three `goals:*` handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; other passthrough handlers remain
    governed by their own completed or future batches.
  - Migrated the matching preload `goals` methods to `typedInvoke` while
    preserving the exposed `window.electronAPI.goals` method names and argument
    shapes.
  - Expanded the IPC contract guard so migrated goal channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Initial read-only spec review returned `BLOCKED` after treating earlier
    approved plugin, todo, diagnostics, workspace, provider, workflow, and SDD
    cumulative changes as part of this goal batch. After providing the progress
    log evidence and the exact goal-only delta, follow-up read-only spec review
    returned `APPROVE`. Read-only code quality review returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/goals.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 3 files and 21 tests.
  - Targeted eslint for changed goal IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Settings run-timeout IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `settings:getRunTimeout` and `settings:setRunTimeout` channels with the
    current `{ value, defaultMs, minMs, maxMs }` response structure.
  - Migrated only those two run-timeout settings handlers in
    `passthrough-ipc.ts` from bare `ipcMain.handle` to `typedHandle`; other
    settings/local-agent passthrough handlers remain for later batches.
  - Migrated the matching preload `settings.getRunTimeout` and
    `settings.setRunTimeout` methods to `typedInvoke` while preserving exposed
    method names and argument shapes.
  - Expanded the IPC contract guard so migrated run-timeout settings channels
    must be declared in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/run-preferences.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/settings-copy.test.ts`
    with 4 files and 20 tests.
  - Targeted eslint for changed settings IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Commands IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `commands:list` and `commands:run` channels with `WorkbenchCommand`
    category, action, source, payload, and run-input structures matching the
    current command runtime.
  - Migrated only those two command handlers in `passthrough-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; command parsing, ECC priority, schedule,
    skill, and local-agent command generation were not changed.
  - Migrated the matching preload `commands.list` and `commands.run` methods to
    `typedInvoke` while preserving exposed method names and argument shapes.
  - Expanded the IPC contract guard so migrated command channels must be
    declared in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/commands.test.ts src/main/runtime/__tests__/command-priority.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts`
    with 4 files and 27 tests.
  - Targeted eslint for changed command IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Schedules/ECC/Updates IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `schedules:list`, `schedules:runPreview`, `ecc:status`, `ecc:update`,
    `updates:status`, `updates:check`, `updates:setChannel`, and
    `updates:openDownload` channels with renderer-safe schedule preview, ECC
    status, update status, and update channel structures.
  - Migrated only those eight passthrough handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; schedule generation, ECC command
    refresh, and update download behavior were not changed.
  - Migrated the matching preload `schedules`, `ecc`, and `updates` methods to
    `typedInvoke` while preserving the exposed `window.electronAPI` method
    names.
  - Aligned `src/renderer/vite-env.d.ts` so `updates.openDownload` returns
    `Promise<void>`, matching the current `openUpdateDownload()` runtime
    implementation.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/commands.test.ts src/main/runtime/__tests__/command-priority.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts`
    with 4 files and 27 tests.
  - Targeted eslint for changed schedule/ECC/update IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Local agents/models IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `localAgents:detect`, `localAgents:status`, `localAgents:options`,
    `localAgents:configure`, `localModels:scan`, and
    `localModels:readConfig` channels with renderer-safe local agent,
    candidate, agent option, configure patch, and local model config
    structures.
  - Migrated only those six passthrough handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; configured-agent refresh,
    `registerAgentsFromBindings()`, cached status, and local model scan
    behavior were not changed.
  - Migrated the matching preload `localAgents` and `localModels` methods to
    `typedInvoke` while preserving the exposed `window.electronAPI` method
    names.
  - Aligned `src/renderer/vite-env.d.ts` so `localAgents.options` matches the
    actual `AgentOption` response shape and local agent candidates retain
    verification, note, and kind metadata.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/local-agents.test.ts src/main/runtime/__tests__/agent-options.test.ts src/main/runtime/__tests__/local-models.test.ts src/renderer/workbench/__tests__/localAgentOptions.test.ts`
    with 5 files and 28 tests.
  - Targeted eslint for changed local-agent/model IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Routes/logs/diagnostics-suite IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `routes:explain`, `logs:path`, `logs:recent`, and
    `diagnostics:runSuite` channels with renderer-safe route payload, app event
    log, recent-log result, diagnostic check, and diagnostic report
    structures.
  - Migrated only those four passthrough handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; route payload lookup, log path/read
    behavior, and diagnostics-suite dependency assembly were not changed.
  - Migrated the matching preload `routes.explain`,
    `diagnostics.logPath`, `diagnostics.recentLogs`, and
    `diagnosticsSuite.run` methods to `typedInvoke`. The older
    `diagnostics.run` entry remains outside this batch because it is a separate
    IPC channel with a different renderer-facing summary shape.
  - Added `diagnosticsSuite.run` to `src/renderer/vite-env.d.ts` with a
    `DiagnosticReport` shape matching `runDiagnosticSuite()`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/app-event-log.test.ts src/main/runtime/__tests__/diagnostics-suite.test.ts src/renderer/workbench/__tests__/settings-copy.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 5 files and 27 tests.
  - Targeted eslint for changed routes/logs/diagnostics IPC contract files
    passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Usage IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `usage:stats`,
    `usage:records`, `usage:recordDetail`, `usage:pricing:list`,
    `usage:pricing:upsert`, and `usage:pricing:delete` channels with
    renderer-safe usage stats, request record, paginated record, provider/model
    rollup, heatmap, and pricing rule structures.
  - Migrated only those six usage handlers in `passthrough-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; existing defaulting behavior such as
    `filter || {}`, `String(id || "")`, and `rule || {}` was preserved.
  - Migrated the matching preload `usage` methods to `typedInvoke` while
    preserving the exposed `window.electronAPI.usage` method names.
  - Aligned `src/renderer/vite-env.d.ts` usage shapes with runtime stats by
    adding cache-savings, surface-token, and cache-hit fields used by the
    current usage dashboard data.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/usage-stats.test.ts src/main/runtime/__tests__/usage-stats-dispatcher.test.ts src/main/runtime/__tests__/local-usage-scanner.test.ts`
    with 4 files and 35 tests.
  - Targeted eslint for changed usage IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Prompts IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `prompts:list`,
    `prompts:get`, `prompts:upsert`, `prompts:delete`, `prompts:search`,
    `prompts:slashCommands`, `prompts:incrementUse`, and
    `prompts:seedDefaults` channels with renderer-safe prompt category,
    prompt entry, and prompt upsert structures.
  - Migrated only those eight prompt handlers in `passthrough-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; prompt library filtering, slash-command
    listing, usage-count incrementing, and default seeding behavior were not
    changed.
  - Migrated the matching preload `prompts` methods to `typedInvoke` while
    preserving the exposed `window.electronAPI.prompts` method names.
  - Aligned `src/renderer/vite-env.d.ts` so prompt APIs use `PromptEntry`,
    `PromptCategory`, and `PromptUpsertInput` instead of `any`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/prompt-library.test.ts src/main/runtime/__tests__/slash-commands.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts`
    with 4 files and 34 tests.
  - Targeted eslint for changed prompts IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Memory Studio IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `memory:scoreQuality` and `memory:detectConflicts` channels with
    renderer-safe memory quality input, quality score, conflict entry, and
    conflict result structures.
  - Migrated only those two memory studio handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; the scoring and duplicate-detection
    runtime logic in `memory-studio.ts` was not changed.
  - Migrated the matching preload `memoryStudio` methods to `typedInvoke` and
    added the missing renderer ambient `memoryStudio` API declaration.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/renderer/workbench/__tests__/memory-panel.test.ts src/renderer/memory-save-policy.test.ts src/main/memory/__tests__/memory-library.test.ts src/main/memory/__tests__/memory-scoring.test.ts`
    with 5 files and 44 tests.
  - Targeted eslint for changed memory studio IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Budget IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `budget:get`,
    `budget:update`, and `budget:check` channels with renderer-safe budget
    config, config patch, and budget check result structures.
  - Migrated only those three budget handlers in `passthrough-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; `budget:check` still evaluates against
    `getBudgetConfig()` and update patch handling was not changed.
  - Migrated the matching preload `budget` methods to `typedInvoke` and added
    the missing renderer ambient `budget` API declaration.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/p4-modules.test.ts`
    with 2 files and 11 tests.
  - Targeted eslint for changed budget IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Inline Edit IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `inlineEdit:buildPrompt`, `inlineEdit:validate`, and `inlineEdit:apply`
    channels with renderer-safe edit range, edit request, validation result,
    and apply result structures.
  - Migrated only those three inline edit handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; prompt building, validation, CRLF
    handling, and replacement range calculation were not changed.
  - Migrated the matching preload `inlineEdit` methods to `typedInvoke` and
    aligned renderer ambient declarations with explicit inline edit types.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/inline-edit.test.ts src/main/runtime/__tests__/dx-modules.test.ts`
    with 3 files and 24 tests.
  - Targeted eslint for changed inline edit IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Workflow Center IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `workflow:substituteVars`, `workflow:evaluateCondition`,
    `workflow:saveRun`, `workflow:runHistory`, and `workflow:runHistoryFor`
    channels with renderer-safe workflow variable and run-record structures.
  - Migrated only those five workflow center handlers in `passthrough-ipc.ts`
    from bare `ipcMain.handle` to `typedHandle`; variable substitution,
    condition evaluation, run-history persistence, and workflow-id filtering
    behavior were not changed.
  - Migrated the matching preload `workflowCenter` methods to `typedInvoke`
    and added the missing renderer ambient `workflowCenter` API declaration.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/p4-remaining.test.ts src/main/runtime/__tests__/workflows.test.ts src/main/runtime/__tests__/workflow-runner.test.ts`
    with 4 files and 28 tests.
  - Targeted eslint for changed workflow center IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Teams IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `teams:list`,
    `teams:save`, `teams:delete`, and `teams:defaultFirefly` channels with
    renderer-safe team role, member, preset, and save-input structures.
  - Migrated only those four team handlers in `passthrough-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; preset persistence, delete behavior, and
    default Firefly team selection were not changed.
  - Migrated the matching preload `teams` methods to `typedInvoke` and added
    the missing renderer ambient `teams` API declaration.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/p4-remaining.test.ts`
    with 2 files and 13 tests.
  - Targeted eslint for changed teams IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Project Knowledge IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `knowledge:detectTechStack` and `knowledge:generateSummary` channels with
    renderer-safe detected tech-stack and project knowledge entry structures.
  - Migrated only those two project knowledge handlers in `passthrough-ipc.ts`
    from bare `ipcMain.handle` to `typedHandle`; this batch intentionally did
    not change existing root-path trust behavior or tech-stack detection logic.
  - Migrated the matching preload `projectKnowledge` methods to `typedInvoke`
    and added the missing renderer ambient `projectKnowledge` API declaration.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/p4-remaining.test.ts`
    with 2 files and 13 tests.
  - Targeted eslint for changed project knowledge IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Firefly IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `firefly:createState`, `firefly:completeRole`,
    `firefly:getRoleContext`, `firefly:isComplete`, and
    `firefly:getOutput` channels with renderer-safe Firefly role, phase, state,
    and role-context structures.
  - Migrated only those five Firefly state-machine handlers in
    `passthrough-ipc.ts` from bare `ipcMain.handle` to `typedHandle`; state
    creation, role completion/advance, context isolation, completion checks,
    and final-output behavior were not changed.
  - Migrated the matching preload `firefly` methods to `typedInvoke` and added
    the missing renderer ambient `firefly` API declaration.
  - Kept the existing `roleTimings: Map<FireflyRole, ...>` state shape in the
    contract to match the current state-machine implementation.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/firefly-state-machine.test.ts src/main/__tests__/firefly-custom.test.ts`
    with 3 files and 22 tests.
  - Targeted eslint for changed Firefly IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Terminal AI IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `terminalAi:buildPrompt`, `terminalAi:suggestCommand`, and
    `terminalAi:explainOutput` channels with a renderer-safe terminal context
    structure.
  - Migrated only those three terminal AI handlers in `terminal-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; terminal run/cancel/history
    handlers remain outside this batch.
  - Migrated the matching preload `terminalAi` methods to `typedInvoke` and
    aligned renderer ambient declarations with explicit `TerminalContext`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls, including
    `terminal-ipc.ts` in the migrated main-handler source set.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/dx-modules.test.ts`
    with 2 files and 13 tests.
  - Targeted eslint for changed terminal AI IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.

## Pending

- Continue fable5 1.3.0 runtime-pipeline consolidation in small verified
  batches.
- Continue fable5 3.2 IPC contract/type work by migrating additional high-risk
  write/path channels in small typed batches.
- Continue fable5 3.4/1.4 SDD closed-loop work: tighten review-to-writeback
  ergonomics and continue productizing the acceptance verification loop.
- Re-run full validation after the next patch batch before commit.

- Browser IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `browser:open`,
    `browser:capture`, `browser:summarize`, `browser:extractText`, and
    `browser:analyzePrompt` channels with renderer-safe browser open input,
    session, capture attachment, and page-snapshot structures.
  - Migrated only those five browser handlers in `browser-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; existing browser-session id generation,
    capture sanitation/truncation, text extraction, summary, and analysis prompt
    behavior were preserved.
  - Migrated the matching preload `browser` methods to `typedInvoke` and aligned
    renderer ambient browser API declarations with explicit capture and page
    snapshot types.
  - Added `browserCaptureToSnapshot()` so the browser panel passes the full
    `PageSnapshot` shape to `browser:summarize` and `browser:analyzePrompt`
    while preserving the existing captured-context attachment behavior.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls, including
    `browser-ipc.ts` in the migrated main-handler source set.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially required removing one explicit `any` in browser link
    sanitation, then returned `APPROVE` after the fix.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/dx-modules.test.ts`
    with 2 files and 13 tests.
  - Targeted eslint for changed browser IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Window/release IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `win:minimize`,
    `win:maximizeToggle`, `win:isMaximized`, `win:close`, and
    `release:checks` channels with explicit window-control and release-report
    result structures.
  - Migrated only those five passthrough handlers in `passthrough-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; window minimize/maximize/close
    behavior and the existing release-check `execFile`/cwd/runReleaseChecks flow
    were preserved.
  - Migrated the matching preload `win` and `release` methods to `typedInvoke`.
  - Aligned renderer ambient declarations so `release.checks()` returns an
    explicit `ReleaseReport` instead of `any`; while addressing code-quality
    review feedback, also typed the existing provider config change callback
    with the provider config contract shape.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially requested removal of explicit `any` from the provider
    config change callback in the same touched file, then returned `APPROVE`
    after the callback was typed.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/batch4-modules.test.ts`
    with 2 files and 20 tests.
  - Targeted eslint for changed window/release IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Terminal runtime IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `terminal:run`,
    `terminal:cancel`, and `terminal:history` channels with explicit terminal
    run input and `TerminalRun` result structures.
  - Migrated only those three terminal runtime handlers in `terminal-ipc.ts`
    from bare `ipcMain.handle` to `typedHandle`; existing
    `getTerminalRuntime().run/cancel/history` behavior was preserved.
  - Migrated the matching preload `terminal.run`, `terminal.cancel`, and
    `terminal.history` methods to `typedInvoke` while preserving the preload
    empty-command `Promise.reject(new Error('Invalid terminal command'))` guard.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially requested removal of several explicit `any`/`as any`
    typed-IPC bypasses in the same touched preload file, then returned
    `APPROVE` after workflow and SDD preload parameters were typed with
    `IpcArgs<...>`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/dx-modules.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 3 files and 27 tests.
  - Targeted eslint for changed terminal IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Shortcuts IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `shortcuts:list`,
    `shortcuts:get`, `shortcuts:update`, `shortcuts:reset`,
    `shortcuts:resetAll`, and `shortcuts:conflicts` channels with explicit
    shortcut binding, category, and conflict result structures.
  - Migrated only those six keyboard-shortcut handlers in `workflow-ipc.ts`
    from bare `ipcMain.handle` to `typedHandle`; list/get/update/reset,
    reset-all, and conflict detection behavior were preserved.
  - Migrated the matching preload `shortcuts` methods to `typedInvoke` and
    aligned renderer ambient declarations with explicit `ShortcutBinding`,
    `ShortcutCategory`, and `ShortcutConflict` structures instead of `any`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/batch3-modules.test.ts src/renderer/workbench/__tests__/settings-copy.test.ts src/renderer/workbench/__tests__/shortcutCommands.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint for changed shortcuts IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Notifications IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `notifications:list`, `notifications:unreadCount`, `notifications:push`,
    `notifications:markRead`, `notifications:markAllRead`,
    `notifications:delete`, and `notifications:clearAll` channels with explicit
    notification, category, action, and push-input structures.
  - Migrated only those seven notification handlers in `workflow-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; list, unread count, push, mark,
    delete, and clear behavior were preserved.
  - Migrated the matching preload `notifications` methods to `typedInvoke` and
    aligned renderer ambient declarations with explicit `AppNotification`,
    `AppNotificationInput`, category, and action types instead of `any`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/new-modules.test.ts`
    with 2 files and 16 tests.
  - Targeted eslint for changed notifications IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Onboarding IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `onboarding:getState`, `onboarding:shouldShow`,
    `onboarding:completeStep`, `onboarding:skipAll`, `onboarding:reset`, and
    `onboarding:nextStep` channels with explicit onboarding step and state
    structures.
  - Migrated only those six onboarding handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; state read, visibility, complete-step,
    skip-all, reset, and next-step behavior were preserved, and the previous
    `step as any` cast was removed by typing the channel argument.
  - Migrated the matching preload `onboarding` methods to `typedInvoke` and
    aligned renderer ambient declarations with explicit `OnboardingStep` and
    `OnboardingState` structures instead of string/any shapes.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/new-modules.test.ts`
    with 2 files and 16 tests.
  - Targeted eslint for changed onboarding IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Backup IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `backup:create`,
    `backup:list`, `backup:restore`, and `backup:delete` channels with explicit
    backup metadata, create-result, and restore-result structures.
  - Migrated only those four backup handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; create/list/restore/delete behavior and
    restore store writeback were preserved.
  - Migrated the matching preload `backup` methods to `typedInvoke` and aligned
    renderer ambient declarations with explicit `BackupMeta`,
    `BackupCreateResult`, and `BackupRestoreResult` structures.
  - Split backup create/list result types after code-quality review:
    `backup:create` can return `error?: string`, while `backup:list` remains a
    pure metadata array matching `listBackups()`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially required the backup create/list result split, then
    returned `APPROVE` after the fix.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/batch2-modules.test.ts`
    with 2 files and 12 tests.
  - Targeted eslint for changed backup IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Diagnostics and Project Map IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `diagnostics:run`,
    `projectMap:build`, and `projectMap:search` channels with explicit legacy
    diagnostic-suite, project-map, and project-node structures.
  - Migrated only those three handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; diagnostic dependency injection,
    project-map scanning, and project-map search behavior were preserved.
  - Migrated the matching preload `diagnostics.run` and `projectMap` methods to
    `typedInvoke` and aligned renderer ambient declarations with
    `LegacyDiagnosticSuite`, `ProjectMap`, and `ProjectNode` instead of `any`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/batch2-modules.test.ts src/main/runtime/__tests__/project-map.test.ts`
    with 3 files and 17 tests.
  - Targeted eslint for changed diagnostics/project-map IPC contract files
    passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- Slash Commands IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `slashCommands:list`, `slashCommands:get`, `slashCommands:save`,
    `slashCommands:delete`, `slashCommands:resolve`,
    `slashCommands:validate`, and `slashCommands:conflict` channels with
    explicit slash-command, save-result, resolve-result, validation-result, and
    conflict-result structures.
  - Migrated only those seven handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; list/get/save/delete/resolve/validate
    and conflict semantics continue to delegate to the existing
    `slash-commands` runtime functions.
  - Migrated the matching preload `slashCommands` methods to `typedInvoke` and
    aligned renderer ambient declarations with `SlashCommand` and related
    result types instead of `any`.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/slash-commands.test.ts src/main/runtime/__tests__/prompt-library.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts`
    with 4 files and 34 tests.
  - Targeted eslint for changed slash-command IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 182 files and 1169 tests.
- GitHub IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `github:checkCli`, `github:listPrs`, `github:listIssues`, and
    `github:currentBranchPr` channels with explicit CLI-status, PR, issue,
    list-state, and current-branch PR structures.
  - Migrated only those four handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; existing `gh` CLI availability,
    authentication, PR listing, issue listing, and current-branch PR lookup
    semantics were preserved.
  - Migrated the matching preload `github` methods to `typedInvoke` and
    aligned renderer ambient declarations with `GitHubCliStatus`, `GitHubPr`,
    `GitHubIssue`, and `GitHubCurrentBranchPr` instead of `any`.
  - Added `src/main/runtime/__tests__/github-integration.test.ts` with mocked
    `gh` execution coverage for unavailable CLI status, PR JSON parsing, and
    current-branch PR parsing.
  - Expanded the IPC contract guard so these migrated channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance and code quality subagent reviews both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/runtime/__tests__/github-integration.test.ts`
    with 2 files and 6 tests.
  - Targeted eslint for changed GitHub IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 183 files and 1172 tests.
- Store IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `store:get` and
    `store:set` channels with raw `unknown` store values and a boolean write
    result.
  - Migrated both store handlers in `workflow-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle` while preserving the existing allowlist
    policy: allowed `agenthub.` / `appearance.` keys pass through, blocked
    reads return the supplied default without touching the store, and blocked
    writes throw before mutation.
  - Migrated the matching preload store calls to `typedInvoke` and aligned the
    renderer ambient API so `store.get` returns `Promise<unknown>` instead of
    an unchecked generic assertion; known keyboard-shortcut reads now normalize
    raw store values before state use.
  - Added `src/main/ipc/__tests__/workflow-store-ipc.test.ts` covering allowed
    read/write, blocked read default behavior, and blocked write no-mutation
    behavior.
  - Expanded the IPC contract guard so both store channels must be declared in
    the contract and must not regress to bare IPC calls.
  - Read-only spec compliance subagent initially flagged unrelated prior
    WorkbenchLayout dirty diff, then returned `APPROVE` after the current
    batch boundary was clarified; code quality subagent requested replacing the
    unchecked `store.get<T>` ambient API with raw `unknown`, then returned
    `APPROVE` after the fix.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/workflow-store-ipc.test.ts src/renderer/workbench/__tests__/shortcutCommands.test.ts src/renderer/workbench/__tests__/keyboard-shortcuts.test.ts`
    with 4 files and 15 tests.
  - Targeted eslint for changed store IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 184 files and 1175 tests.
- Conversation IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `conversation:exportMarkdown`, `conversation:exportHtml`,
    `conversation:exportFile`, `conversation:importFile`,
    `conversation:importJson`, `conversation:branch`, and
    `conversation:summarize` channels with explicit export/import,
    export-file result, branch, and summary structures.
  - Migrated all seven conversation handlers in `conversation-ipc.ts` from
    bare `ipcMain.handle` to `typedHandle`; markdown/html formatting,
    export-file home-directory path guarding, import, branch, and summarize
    delegation behavior were preserved.
  - Migrated the matching preload `conversation` and `conversationImport`
    methods to `typedInvoke`, and aligned renderer ambient declarations with
    explicit conversation shapes instead of `any`.
  - Normalized imported conversation metadata so only non-array objects are
    returned, matching the IPC contract and dropping invalid string, array, or
    null metadata values.
  - Updated `conversation-ipc.test.ts` so `exportFile` mocks and assertions use
    the contracted `{ ok, path, error? }` result shape, and added regression
    coverage in `batch4-modules.test.ts` for invalid metadata dropping and
    object metadata preservation.
  - Expanded the IPC contract guard so all seven conversation channels must be
    declared in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially requested metadata normalization and contract-shaped
    export-file tests, then returned `APPROVE` after the fixes.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/conversation-ipc.test.ts src/main/runtime/__tests__/batch4-modules.test.ts`
    with 3 files and 23 tests.
  - Targeted eslint for changed conversation IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 35 existing warnings;
    `npm run build`; standalone `npm test` with 184 files and 1176 tests.
- AgentLoop IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `agentLoop:getConfig`, `agentLoop:getStatus`, `agentLoop:getAgents`,
    `agentLoop:refreshAgents`, and `agentLoop:getRouteInfo` channels with
    explicit config, status, agent, and route-info structures.
  - Migrated all five agentLoop handlers in `agent-loop-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; normal agent detection caching,
    manual refresh, found-agent filtering, role enrichment, and route keyword
    classification were preserved.
  - Corrected `agentLoop:getConfig` to return `mode: 'auto'`, matching the
    renderer API and settings page state shape, instead of the previous
    `defaultMode` mismatch.
  - Preserved manual refresh invalidation semantics by clearing cached agents
    and `lastDetectionTime` before forced detection; added regression coverage
    so a failed refresh cannot leave a stale fresh cache for the next
    `getAgents` call.
  - Migrated the matching preload agentLoop methods to `typedInvoke`, aligned
    renderer ambient declarations with explicit `AgentLoop*` interfaces, and
    expanded the IPC contract guard so all five channels must remain typed.
  - Read-only spec compliance and code quality subagents both initially
    requested restoring refresh cache invalidation before detection, then both
    returned `APPROVE` after the fix.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/agent-loop-ipc.test.ts src/renderer/workbench/__tests__/settings-copy.test.ts`
    with 3 files and 9 tests.
  - Targeted eslint for changed agentLoop IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 34 existing warnings;
    `npm run build`; standalone `npm test` with 185 files and 1181 tests.
- Models IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `models:list`,
    `models:routeSettings:get`, `models:routeSettings:set`,
    `models:updateRoute`, `models:test`, `models:exportCodexCatalog`,
    `models:toggleFavorite`, `models:toggleHidden`, `models:favorites`, and
    `models:hidden` channels with explicit model list, route settings, route
    patch, test result, catalog export, and favorite/hidden result structures.
  - Migrated all ten model handlers in `models-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; explicit-provider list delegation,
    global list fallback, route settings, model route updates, model testing,
    Codex catalog export, and favorite/hidden set conversion behavior were
    preserved.
  - Migrated the matching preload model methods to `typedInvoke`, aligned
    renderer ambient declarations with explicit `ModelRoute*` structures, and
    narrowed renderer update patches so reasoning levels match the shared IPC
    contract instead of accepting arbitrary strings.
  - Updated `Settings.tsx` so the local model-route update helper accepts the
    narrowed `ModelRoutePatch` type before calling `models.updateRoute`.
  - Added `src/main/ipc/__tests__/models-ipc.test.ts` covering explicit
    provider list vs global fallback, route settings/update delegation, model
    test/catalog delegation, and favorite/hidden array returns.
  - Expanded the IPC contract guard so all ten model channels must be declared
    in the contract and must not regress to bare IPC calls.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially requested matching the renderer `ModelRoutePatch` type
    to the narrowed shared contract, then returned `APPROVE` after the fix.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/runtime/__tests__/p4-modules.test.ts src/main/runtime/__tests__/models-center-routes.test.ts src/renderer/screens/Settings.models.test.ts`
    with 5 files and 18 tests.
  - Targeted eslint for changed models IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 34 existing warnings;
    `npm run build`; standalone `npm test` with 186 files and 1184 tests.
- MCP IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `mcp:list`,
    `mcp:scanLocal`, `mcp:upsert`, `mcp:remove`, `mcp:setEnabled`,
    `mcp:test`, `mcp:listTools`, `mcp:getSystemConfig`,
    `mcp:setSystemConfig`, and `mcp:setSystemEnabled` channels with explicit
    MCP server, tool-listing, upsert-input, and system-config structures.
  - Migrated all ten MCP handlers in `mcp-ipc.ts` from bare IPC registration
    to `typedHandle`; server inventory, local scan, mutation, test, tool
    listing, and system-level config delegation continue to call the existing
    runtime/config functions.
  - Migrated the matching preload MCP methods to `typedInvoke` and removed the
    stale duplicate `mcp:getSystemConfig` direct `ipcRenderer.invoke` property.
  - Aligned renderer ambient declarations with the full MCP tool-listing result
    shape, including `inputSchema`, `resources`, and `prompts`, and restored a
    single visible `getSystemConfig` declaration.
  - Added `src/main/ipc/__tests__/mcp-ipc.test.ts` covering all MCP channel
    registrations and argument-preserving delegation without starting real MCP
    processes or network calls.
  - Expanded the IPC contract guard so all ten MCP channels must be declared in
    the contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Read-only spec compliance subagent returned `APPROVE`; code quality
    subagent initially requested removal of a duplicate renderer
    `getSystemConfig` declaration, then returned `APPROVE` after the cleanup.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/mcp-ipc.test.ts src/main/runtime/__tests__/mcp.test.ts`
    with 3 files and 17 tests.
  - Targeted eslint for changed MCP IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 34 existing warnings;
    `npm run build`; standalone `npm test` with 187 files and 1188 tests.
- Workspace and Worktree IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `worktrees:list`,
    `worktrees:create`, `worktrees:remove`, `worktrees:sync`,
    `worktrees:open`, `workspaces:list`, `workspaces:create`,
    `workspaces:update`, `workspaces:remove`, `workspaces:getActive`, and
    `workspaces:setActive` channels with explicit workspace, worktree, create,
    and update-patch structures.
  - Migrated those eleven handlers in `workspace-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; worktree operations still delegate to
    the existing runtime functions, and workspace CRUD/active-selection still
    uses `WorkspaceManager` with `serialiseWsError` preserving workspace error
    codes.
  - Migrated the matching preload `workspaces` and `worktrees` methods to
    `typedInvoke`, and aligned renderer ambient declarations with
    `WorkbenchWorkspace`, `WorkbenchWorkspaceCreateInput`,
    `WorkbenchWorkspaceUpdatePatch`, and `WorktreeItem`.
  - Corrected `worktrees.open` in the renderer ambient API from `Promise<any>`
    to `Promise<WorkbenchWorkspace>` after spec review.
  - Expanded `workspace-ipc.test.ts` to cover workspace CRUD/active delegation,
    workspace error-code preservation, and argument-preserving worktree
    delegation without starting real Git/worktree operations.
  - Expanded the IPC contract guard so all eleven workspace/worktree channels
    must be declared in the contract and must not regress to bare IPC calls.
  - Updated the legacy IPC registration uniqueness guard to count both
    `ipcMain.handle` and `typedHandle`, preserving duplicate-channel coverage
    as typed IPC migration reduces direct `ipcMain.handle` usage.
  - Read-only spec compliance subagent initially requested the
    `worktrees.open` ambient return type fix, then returned `APPROVE`; code
    quality subagent returned `APPROVE`, and re-approved the uniqueness guard
    update after full-test feedback.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/workspace-ipc.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/settings-copy.test.ts`
    with 4 files and 26 tests.
  - Follow-up uniqueness guard validation passed:
    `npx vitest run src/main/__tests__/ipc-registration-uniqueness.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/workspace-ipc.test.ts`
    with 3 files and 13 tests.
  - Targeted eslint for changed workspace IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 34 existing warnings;
    `npm run build`; standalone `npm test` with 187 files and 1191 tests.
- Memory IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `memory:catalog`,
    `memory:getSettings`, `memory:updateSettings`, `memory:list`,
    `memory:search`, `memory:addEntry`, `memory:importConversation`,
    `memory:listCandidates`, `memory:approveCandidate`, `memory:updateEntry`,
    `memory:disableEntry`, `memory:delete`, `memory:restore`,
    `memory:graph`, and `memory:cleanupSuggestions` channels with explicit
    legacy memory-entry, settings, catalog, graph-node, graph-edge, and graph
    result structures.
  - Migrated all fifteen memory handlers in `memory-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; catalog/settings/search/mutation,
    conversation import, candidate approval, soft delete/restore, graph build,
    and cleanup-suggestion semantics continue to delegate to the existing
    legacy memory library and memory graph utilities.
  - Migrated the matching preload `memory` and `memoryGraph` methods to
    `typedInvoke`, and aligned renderer ambient declarations with
    `MemoryCatalog`, `MemoryEntryInput`, `MemoryEntryPatch`, `MemoryGraph`,
    and `MemoryGraphNode` instead of `any`.
  - Added `src/main/ipc/__tests__/memory-ipc.test.ts` covering catalog,
    settings, list/search, mutation, import, candidates, graph, and cleanup
    delegation without starting Electron or touching the real memory store.
  - Expanded the IPC contract guard so all fifteen memory channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Read-only code quality subagent returned `APPROVE`; read-only spec
    compliance subagent returned `APPROVE` and requested a follow-up target
    rerun for the contract guard plus memory IPC test.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/memory-ipc.test.ts src/main/memory-library.test.ts src/renderer/workbench/__tests__/memory-panel.test.ts`
    with 4 files and 25 tests.
  - Targeted eslint for changed memory IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Spec-review follow-up validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/memory-ipc.test.ts`
    with 2 files and 6 tests.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 34 existing warnings;
    `npm run build`; standalone `npm test` with 188 files and 1194 tests.
- Git IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `git:status`,
    `git:branches`, `git:checkoutBranch`, `git:createBranch`,
    `git:renameBranch`, `git:deleteBranch`, `git:log`, `git:diff`,
    `git:diffs`, `git:commitDetails`, `git:commitDiff`, `git:stageFile`,
    `git:stageAll`, `git:unstageFile`, `git:revertFile`, `git:revertAll`,
    `git:commit`, `git:fetch`, `git:pull`, `git:push`, `git:sync`, and
    `git:updateBranch` channels with explicit Git status, branch, log, diff,
    commit, and update-branch structures aligned to `src/main/runtime/types.ts`.
  - Migrated those twenty-two Git operation handlers in `git-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; the existing `wrapGit` error
    sanitization and `git:createBranch` default checkout behavior are
    preserved.
  - Migrated the matching preload `git` operation methods to `typedInvoke`;
    `git:query` intentionally remains outside this batch because it lives in
    `hub-threads-ipc.ts` and couples Git output to runtime thread/turn state.
  - Added `src/main/ipc/__tests__/git-ipc.test.ts` covering Git read
    delegation, branch/stage/commit/remote mutation delegation, create-branch
    default checkout behavior, and wrapped Git error path sanitization without
    invoking real Git.
  - Expanded the IPC contract guard so all twenty-two Git operation channels
    must be declared in the contract, registered through `typedHandle`, and
    invoked through `typedInvoke`.
  - Read-only spec compliance subagent returned `APPROVE`; read-only code
    quality subagent initially flagged prior non-Git preload typed migrations
    as a boundary concern, then returned `APPROVE` after the current Git-batch
    diff boundary was clarified.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/git-ipc.test.ts src/main/runtime/__tests__/git-runtime.test.ts src/main/runtime/__tests__/git-copy.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 5 files and 25 tests.
  - Targeted eslint for changed Git IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 34 existing warnings;
    `npm run build`; standalone `npm test` with 189 files and 1198 tests.
- Terminal PTY IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `terminal:create`, `terminal:write`, `terminal:resize`, and
    `terminal:dispose` channels with explicit PTY create, write, resize, and
    create-result structures.
  - Migrated the four PTY lifecycle handlers in `terminal-pty-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; live-session reattach, ring-buffer
    replay, normal-exit listener cleanup, write, resize, and dispose behavior
    were preserved.
  - Migrated the matching preload `terminalPty` methods to `typedInvoke`, and
    added the renderer ambient `terminalPty` API declaration in
    `vite-env.d.ts`.
  - Expanded the IPC contract guard so the four PTY lifecycle channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Added focused PTY regression coverage for write/resize forwarding and
    dispose stopping later writes to the released session.
  - Read-only code quality subagent returned `APPROVE`; read-only spec
    compliance subagent initially misattributed historical dirty worktree
    changes to this batch, then returned `APPROVE` after the batch boundary was
    clarified.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/terminal-pty-ipc.test.ts`
    with 2 files and 7 tests.
  - Targeted eslint for changed Terminal PTY IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 33 existing warnings;
    `npm run build`; standalone `npm test` with 189 files and 1199 tests.
- Threads IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `threads:list`,
    `threads:create`, `threads:rename`, `threads:delete`, `threads:select`,
    and `threads:fork` channels with explicit Workbench thread, create-input,
    and fork-input structures.
  - Migrated the six thread handlers in `hub-threads-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; `hub:status`, `runtime:*`,
    `context:projection`, and `git:query` intentionally remain outside this
    small batch.
  - Migrated the matching preload `threads` methods to `typedInvoke`, and
    added renderer ambient `ThreadCreateInput` and `ThreadForkInput`
    declarations instead of relying on exported module types.
  - Fixed `threads:fork` so copied source-turn events are attached to a real
    fork turn id rather than incorrectly passing the new thread id into
    `appendStreamEvent`; fork turns now receive a final status derived from the
    source turn status, preventing permanently running fork threads.
  - Added `hub-threads-ipc.test.ts` coverage for handler registration,
    delegation, workspace id normalization, fork input validation, source-turn
    event filtering, target turn usage, and fork turn status finalization.
  - Expanded the IPC contract guard so the six thread channels must be declared
    in the contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Read-only spec compliance subagent first requested explicit ambient thread
    input declarations, then returned `APPROVE`; read-only code quality
    subagent first found the thread-id-as-turn-id fork bug and then the
    running-turn finalization gap, and returned `APPROVE` after both fixes.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts src/main/runtime/__tests__/store.test.ts`
    with 3 files and 20 tests.
  - Targeted eslint for changed threads IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 33 existing warnings;
    `npm run build`; standalone `npm test` with 190 files and 1204 tests.
- Runtime query IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `runtime:snapshot` and `runtime:eventsSince` query channels with explicit
    Workbench snapshot, turn, run, runtime event, attachment, and context
    projection structures.
  - Migrated both runtime query handlers in `hub-threads-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; `runtime:eventsSince` still defaults
    `seq` to `0`.
  - Migrated the matching preload `runtime.snapshot` and `runtime.eventsSince`
    methods to `typedInvoke`; the renderer API still passes `seq ?? 0`.
  - Expanded the IPC contract guard so both runtime query channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Added `hub-threads-ipc.test.ts` coverage for runtime snapshot delegation,
    explicit events-since sequence forwarding, and default sequence behavior.
  - Read-only spec compliance and code quality subagents both returned
    `APPROVE`; code quality noted that `RuntimeEventLike.kind` intentionally
    remains `string` to match renderer ambient compatibility for future event
    kinds.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts src/main/runtime/__tests__/store.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts`
    with 4 files and 34 tests.
  - Targeted eslint for changed runtime query IPC contract files passed.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
  - Full validation passed:
    `npm run typecheck`; `npm run lint` with 0 errors and 33 existing warnings;
    `npm run build`; standalone `npm test` with 190 files and 1205 tests.
- Hub status IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `hub:status` with
    explicit hub status, agent summary, and recent task summary structures.
  - Migrated `hub:status` in `hub-threads-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`, preserving hub/proxy/client count,
    registry agent summaries, and recent dispatcher task truncation behavior.
  - Migrated the matching preload `hub.getStatus()` call to `typedInvoke`.
  - Added `hub-threads-ipc.test.ts` coverage for populated status, null hub
    defaults, and absent dispatcher task fallback.
  - Expanded the IPC contract guard so `hub:status` must be declared in the
    contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Read-only reviewer subagent returned `APPROVE`, confirming contract,
    main/preload/ambient typing, behavior preservation, and guard coverage.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts src/main/ipc/__tests__/missing-ipc-tasks.test.ts`
    with 3 files and 14 tests.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
- Tasks IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `tasks:delete` and
    `tasks:clearCompleted` channels with boolean success results.
  - Migrated both task handlers in `missing-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; runtime-store cleanup still runs before
    legacy dispatcher cleanup.
  - Migrated the matching preload `tasks.delete()` and
    `tasks.clearCompleted()` calls to `typedInvoke`.
  - Existing `missing-ipc-tasks.test.ts` coverage continues to verify runtime
    cleanup plus legacy dispatcher cleanup for delete and clear-completed.
  - Expanded the IPC contract guard so both task channels must be declared in
    the contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Read-only reviewer subagent returned `APPROVE`, confirming contract,
    main/preload/ambient typing, behavior preservation, and guard coverage.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts src/main/ipc/__tests__/missing-ipc-tasks.test.ts`
    with 3 files and 14 tests.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
- Skills IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `skills:list`,
    `skills:builtins`, `skills:scanLocal`, `skills:importLocal`,
    `skills:refreshLocal`, `skills:add`, `skills:update`, `skills:remove`,
    `skills:getInstalls`, `skills:install`, and `skills:uninstall` channels
    with explicit skill category, skill definition, skill input/patch,
    install-map, and local candidate structures.
  - Migrated the eleven skill handlers in `missing-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`; list, bundled skills, local scan/import,
    add/update/remove, and install/uninstall behavior were preserved.
  - Migrated the matching preload `skills` methods to `typedInvoke`, keeping
    `skills.scanLocal()` intentionally argument-free.
  - Aligned renderer ambient declarations with the shared skill structures,
    including `SkillDef | undefined` for `skills.update()`.
  - Expanded the IPC contract guard so all eleven skill channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Spec compliance reviewer initially scoped the review to the whole dirty
    worktree and flagged earlier approved typed IPC migrations as out of scope;
    after the batch boundary was clarified, it returned `APPROVE`.
  - Code quality reviewer returned `APPROVE`, confirming the skill structures
    remain compatible with `SkillsManager` and local skill candidates.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/missing-ipc-skills.test.ts`
    with 2 files and 7 tests.
  - Implementer validation also passed `npm run lint -- --quiet` and
    `npx tsc -b --noEmit --pretty false`.
- Agentic IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `agentic:capabilities`, `agentic:getEnabled`, `agentic:setEnabled`,
    `agentic:getMode`, `agentic:setMode`, `agentic:getApprovalConfig`,
    `agentic:setApprovalPreset`, `agentic:setApprovalDefault`,
    `agentic:setApprovalOverride`, and `agentic:resolveApproval` channels with
    explicit capability, mode, approval policy, guarded tool, preset, and
    approval config structures.
  - Migrated the ten agentic handlers in `missing-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle`, preserving agentic config and approval
    config behavior.
  - Fixed `agentic:resolveApproval` to call the live dispatcher
    `dispatcher?.resolveApproval(requestId, approved) ?? false` and return its
    boolean result, rather than only updating persisted pending approval state.
  - Migrated the matching preload `agentic` methods to `typedInvoke` and
    aligned renderer ambient declarations with the shared agentic structures.
  - Added `missing-ipc-agentic.test.ts` coverage for live dispatcher approval
    resolution and false fallback when no dispatcher is present.
  - Expanded the IPC contract guard so all ten agentic channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Spec compliance and code quality reviewer subagents both returned
    `APPROVE`, including confirmation that `src/shared/ipc-contract.ts` does
    not import `src/main/agentic/*` and that the live approval path is covered.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/missing-ipc-agentic.test.ts`
    with 2 files and 5 tests.
  - `npx tsc -b --noEmit --pretty false` passed; implementer validation also
    passed `npm run lint -- --quiet`.
- Info and discovery IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `proxy:info` and
    `agents:locate` channels with explicit proxy status and local-agent status
    result structures.
  - Migrated both handlers in `missing-ipc.ts` from bare `ipcMain.handle` to
    `typedHandle`; `proxy:info` still returns only `{ url, running }`, and
    `agents:locate` still returns `getCachedLocalAgentStatuses()`.
  - Migrated the matching preload methods to `typedInvoke`.
  - Corrected renderer ambient declarations so `proxy.info()` no longer
    advertises nonexistent `openaiUrl` / `anthropicUrl` fields and
    `agents.locate()` returns `LocalAgentStatus[]` instead of the old candidate
    map shape.
  - Updated `RoutingTab.tsx` to consume `LocalAgentStatus[]` and derive each
    binding row's candidate list by `agentId`, preserving an empty candidate
    fallback when an agent is absent.
  - Added `missing-ipc-info.test.ts` coverage for proxy normal/fallback
    results and cached local-agent status passthrough.
  - Expanded the IPC contract guard so both channels must be declared in the
    contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Spec compliance and code quality reviewer subagents both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/missing-ipc-info.test.ts`
    with 2 files and 6 tests.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
- Takeover IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `takeover:status`, `takeover:apply`, and `takeover:restore` channels with
    explicit takeover state, status, and mutation result structures.
  - Migrated the three takeover handlers in `missing-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle` and migrated matching preload methods to
    `typedInvoke`.
  - Preserved existing result shapes: status errors remain `{ error: string }`
    without `ok: false`, and apply/restore successes return `TakeoverState`
    while failures return `{ ok: false, error }`.
  - Preserved apply proxy behavior, including stopped-proxy rejection and
    `proxy.getUrl().replace(/\/v1$/, '')` origin derivation.
  - Aligned renderer ambient takeover declarations so apply/restore no longer
    use `any`.
  - Added `missing-ipc-takeover.test.ts` coverage for status success/error,
    apply stopped-proxy behavior, proxy URL argument derivation, apply error,
    restore success, and restore error.
  - Expanded the IPC contract guard so all three takeover channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Spec compliance and code quality reviewer subagents both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/missing-ipc-takeover.test.ts src/renderer/workbench/__tests__/ComposerBar.pickFiles.test.tsx`
    with 3 files and 12 tests.
  - `npx tsc -b --noEmit --pretty false`, targeted eslint, and
    `git diff --check` passed; diff check still reports only the existing CRLF
    normalization warnings for the progress document and `BrowserPanel.tsx`.
- Composer file picker attachment conversion validation:
  - Fixed `ComposerBar` to treat `app.pickFiles()` as the current main-process
    behavior of `string[] | null` instead of assuming `WorkbenchAttachment[]`.
  - Added renderer-side conversion from file paths to `WorkbenchAttachment`
    objects with `id`, `kind`, `name`, `path`, and `createdAt` fields.
  - Null, non-array, empty-array, and blank-path results are now ignored
    without throwing or adding invalid attachments.
  - Windows and Unix path basenames are both handled when deriving attachment
    names.
  - Added `ComposerBar.pickFiles.test.tsx` coverage for cancelled/invalid
    picker results and multi-path attachment creation.
  - Reviewer subagent returned `APPROVE`, and targeted validation passed in the
    same batch as the takeover IPC migration.
- App and dialog IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `dialog:selectDirectory`, `app:openExternal`, `app:openPath`,
    `app:resolvePath`, `app:readTextFile`, `app:pickFolder`, and
    `app:pickFiles` channels with explicit app path, open-path, operation,
    read-file, and picker result structures.
  - Migrated `dialog:selectDirectory` in `src/main/ipc/index.ts` and all six
    app shell/path handlers in `missing-ipc.ts` from bare `ipcMain.handle` to
    `typedHandle`.
  - Migrated matching preload methods to `typedInvoke` and aligned renderer
    ambient declarations; `app.pickFiles()` now correctly returns
    `Promise<string[] | null>`.
  - Fixed `app:readTextFile` result shape so success and failure responses now
    include `path`, while preserving sensitive filename early rejection,
    registered-workspace root validation, allowed-base resolution, size guard,
    and read behavior.
  - Expanded `missing-ipc-app-path.test.ts` coverage for successful read path,
    unregistered root failure path, sensitive pre-stat rejection, oversized
    file rejection, `openExternal` allowlist behavior, and picker
    cancel/success behavior.
  - Expanded the IPC contract guard so all seven app/dialog channels must be
    declared in the contract, registered through `typedHandle`, and invoked
    through `typedInvoke`.
  - Spec compliance and code quality reviewer subagents both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/missing-ipc-app-path.test.ts`
    with 2 files and 11 tests.
  - `npx tsc -b --noEmit --pretty false`, targeted eslint, and
    `git diff --check` passed; diff check still reports only the existing CRLF
    normalization warnings for the progress document and `BrowserPanel.tsx`.
- Quick complete IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `ai:quickComplete` with explicit quick-complete input and result
    structures.
  - Migrated the `ai:quickComplete` handler in `missing-ipc.ts` from bare
    `ipcMain.handle` to `typedHandle` and migrated the matching preload method
    to `typedInvoke`.
  - Aligned renderer ambient declarations with `prompt`, `systemPrompt`,
    `providerId`, `modelId`, and `timeoutMs` input fields and
    `{ ok, content?, error? }` result shape.
  - Preserved invalid-prompt short-circuit behavior before provider lookup and
    `ProviderClient` construction.
  - Expanded `missing-ipc-quick-complete.test.ts` coverage for `undefined`,
    `null`, empty string, whitespace/newline, and non-string prompts, with
    assertions that provider lookup and client construction are not called for
    invalid prompts.
  - Expanded the IPC contract guard so `ai:quickComplete` must be declared in
    the contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Spec compliance and code quality reviewer subagents initially scoped their
    review to the entire dirty worktree and flagged earlier approved IPC
    migrations as out of scope; after the quick-complete batch boundary was
    clarified, both returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts`
    with 2 files and 9 tests.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports only the existing CRLF normalization warnings for the
    progress document and `BrowserPanel.tsx`.
- Context projection and Git query IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing
    `context:projection` and `git:query` channels with explicit context block,
    context projection input/result, and Git query input/result structures.
  - Migrated both handlers in `hub-threads-ipc.ts` from bare `ipcMain.handle`
    to `typedHandle` and migrated matching preload methods to `typedInvoke`.
  - Tightened context projection result typing so `blocks` is
    `ContextBlockLike[]` instead of an unknown array.
  - Aligned `GitQueryResult` with the real handler result shape:
    `{ threadId, turnId, result: string | null, error? }`.
  - Fixed `git:query` to append stream events with `turn.id` rather than the
    thread id on both success and failure paths.
  - Fixed failure event ordering so the error content event is appended before
    the final `failed` turn status event.
  - Expanded `hub-threads-ipc.test.ts` coverage for context projection
    arguments, Git query success, Git query failure, missing workspace, correct
    append turn id, and failure event ordering.
  - Expanded the IPC contract guard so both channels must be declared in the
    contract, registered through `typedHandle`, and invoked through
    `typedInvoke`.
  - Spec reviewer returned `APPROVE`; code quality reviewer found the failure
    event-ordering issue, and returned `APPROVE` after the fix and re-test.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts`
    with 2 files and 17 tests.
  - `npx tsc -b --noEmit --pretty false` and targeted eslint passed.
- Simple turns IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `turns:cancel`,
    `turns:cancelAgent`, and `turns:resolveGuard` channels with explicit
    boolean results.
  - Migrated only those three handlers in `src/main/index.ts` from bare
    `ipcMain.handle` to `typedHandle`, leaving `turns:create` and
    `turns:retry` for a separate high-risk batch.
  - Migrated the matching preload methods to `typedInvoke`; renderer ambient
    declarations already matched `Promise<boolean>`.
  - Expanded the IPC contract guard so these channels are declared in the
    contract, registered through `typedHandle`, and invoked through
    `typedInvoke`, including scanning `src/main/index.ts` for main-process
    typed handlers.
  - Spec compliance and code quality reviewer subagents both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 1 file and 3 tests.
  - `npx tsc -b --noEmit --pretty false` and `git diff --check` passed; diff
    check still reports CRLF normalization warnings for touched/generated files.
- Turn create/retry IPC contract migration validation:
  - Extended `src/shared/ipc-contract.ts` to cover existing `turns:create` and
    `turns:retry` channels with explicit `TurnCreateInputLike` and
    `TurnCreateResultLike` structures.
  - Migrated both handlers in `src/main/index.ts` from bare `ipcMain.handle` to
    `typedHandle` without extracting the handlers or changing their bodies.
  - Migrated the matching preload methods to `typedInvoke`.
  - Aligned renderer ambient declarations so `turns.create()` and
    `turns.retry()` now return `Promise<TurnCreateResult>` instead of
    `Promise<any>`.
  - Preserved provider-direct dispatch, custom schedule routing, attachment
    materialization and retry reuse, memory candidate fire-and-forget behavior,
    and context projection handling.
  - Expanded the IPC contract guard so both channels must be declared in the
    contract, registered through `typedHandle` in `src/main/index.ts`, and
    invoked through `typedInvoke`.
  - Spec compliance and code quality reviewer subagents both returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 1 file and 4 tests.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Production direct request/response IPC scan found no remaining bare
    `ipcMain.handle` / raw `ipcRenderer.invoke` matches outside typed wrappers,
    tests, guards, and logging instrumentation.
- Full validation and current boundary record:
  - Full validation from the IPC migration checkpoint passed:
    `npm run typecheck`, `npm run lint` with 0 errors and 33 warnings,
    `npm run build`, and `npm test` with 194 files and 1238 tests.
  - Fresh direct request/response IPC scan:
    `rg -n "ipcMain\.handle\(|ipcRenderer\.invoke\(" src/main src/preload`
    shows only typed wrappers, tests/guards, and app-event-log instrumentation.
  - `git diff --check` passed at the checkpoint, with CRLF normalization
    warnings recorded for `docs/FABLE5-NEW-PROGRESS.md`,
    `src/main/ipc/hub-threads-ipc.ts`, and
    `src/renderer/workbench/components/panels/BrowserPanel.tsx`.
  - Read-only fable5 audit confirms 1.2.3/1.2.4 are mostly complete, but
    1.3.0 is not complete yet. Remaining productization work includes
    Workbench state decomposition, runtime schema validation on write/path
    IPC, explicit dispatcher/adapter contracts, local-agent detection
    responsiveness, and worktree/release convergence.
- Continued fable5 1.3.0 provider/local-agent/runtime hardening:
  - Preserved encrypted provider API keys when safeStorage decrypt fails by
    marking providers as locked instead of clearing the ciphertext.
  - Excluded locked providers from runtime routing, model picker selection,
    fallback selection, health checks, model fetches, model-center runtime
    lists, and exported Codex catalogs until the user re-enters the API key.
  - Blocked disabled provider models from renderer model choices and from both
    provider-direct and agent model-selection runtime paths.
  - Sorted enabled providers above disabled providers after pinned/local
    provider exceptions so configured custom providers surface first.
  - Targeted validation passed:
    `npm test -- src/main/providers/__tests__/managerFetchModels.test.ts src/main/runtime/__tests__/models-center-routes.test.ts src/main/hub/__tests__/provider-direct.test.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/workbench/__tests__/provider-routing-state.test.ts src/renderer/workbench/__tests__/routingSelectionState.test.ts src/renderer/workbench/__tests__/dispatchRequest.test.ts`
    with 7 files and 62 tests.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation hooks to typed IPC for high-risk
    mutation/path channels.
  - Invalid envelope-style channels now return their existing `{ ok: false,
    error }` shape where applicable; other invalid calls fail before handler
    side effects through `IpcPayloadValidationError`.
  - Tightened workspace path guard entry checks for non-string, empty, and NUL
    path payloads.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/workspace-ipc.test.ts src/main/ipc/__tests__/sdd-ipc.test.ts src/main/ipc/__tests__/git-ipc.test.ts src/main/ipc/__tests__/missing-ipc-app-path.test.ts src/main/ipc/__tests__/conversation-ipc.test.ts src/main/ipc/__tests__/terminal-pty-ipc.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 8 files and 36 tests.
- Continued fable5 1.3.0 dispatcher/adapter lifecycle contracts:
  - Added explicit local adapter lifecycle and availability result structures.
  - `StdioAgentAdapter` now exposes `getLifecycle()` and resets stale exit
    code/stderr state at the beginning of each run.
  - Dispatcher local routing now only uses local adapters for explicit local
    bindings, preventing stale local adapters from hijacking HTTP/provider
    routes.
  - Targeted validation passed:
    `npx vitest run src/main/hub/adapters/__tests__/stdio-prompt.test.ts src/main/hub/__tests__/provider-direct.test.ts`
    with 2 files and 13 tests.
- Continued fable5 1.3.0 Workbench state decomposition:
  - Extracted routing selection transitions for local-agent selection,
    schedule slash commands, provider-model slash commands, and loop command
    state into `src/renderer/workbench/state/routingSelectionState.ts`.
  - Kept `WorkbenchLayout.tsx` responsible for applying the resulting UI state
    patch while moving the pure transition decisions into tested code.
  - Targeted validation passed:
    `npm run test -- src/renderer/workbench/__tests__/routingSelectionState.test.ts src/renderer/workbench/__tests__/provider-routing-state.test.ts src/renderer/workbench/__tests__/dispatchRequest.test.ts`
    with 3 files and 18 tests.
- Full validation after this batch:
  - `npx tsc -b --noEmit --pretty false` passed.
  - `npm run lint` passed with 0 errors and 33 existing warnings.
  - `npm run build` passed.
  - `npm test` passed with 196 files and 1260 tests.
  - Fresh direct request/response IPC scan:
    `rg -n "ipcMain\.handle\(|ipcRenderer\.invoke\(" src/main src/preload`
    shows only typed wrappers, tests/guards, and app-event-log
    instrumentation.
  - `git diff --check` passed with only CRLF normalization warnings for
    existing touched files.
  - Remaining fable5 work is still not complete: Workbench store/container
    decomposition, broader schema coverage for lower-risk IPC, diagnostics UI,
    release/worktree convergence, and packaged-app E2E validation remain.
- Continued fable5 1.3.0 Workbench container decomposition:
  - Extracted the non-Git inspector container and Git bottom dock container
    from `WorkbenchLayout.tsx` into
    `src/renderer/workbench/WorkbenchPanelContainers.tsx`.
  - Kept inspector width state/preview/commit ownership in `WorkbenchLayout`
    while moving only scrim, inspector/dock shell, and panel content mounting
    into the focused container.
  - Preserved behavior-critical panel props, including workspace root,
    parent thread/turn ids, pending browser URL consumption, and browser
    capture attachment forwarding.
  - Updated the Git dock structure guard to verify the new container rather
    than requiring panel JSX to remain inside `WorkbenchLayout`.
  - Reviewer subagent returned `APPROVE` for this extraction.
  - Targeted validation passed:
    `npm run test -- src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/provider-routing-state.test.ts src/renderer/workbench/__tests__/dispatchRequest.test.ts`
    with 3 files and 27 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/WorkbenchPanelContainers.tsx src/renderer/workbench/__tests__/git-dock-layout.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for high-risk MCP channels:
    `mcp:list`, `mcp:scanLocal`, `mcp:upsert`, `mcp:remove`,
    `mcp:setEnabled`, `mcp:test`, `mcp:listTools`,
    `mcp:setSystemConfig`, and `mcp:setSystemEnabled`.
  - MCP server upsert now validates server shape before persistence,
    including transport enum, stdio command, HTTP/SSE URL scheme, args,
    env/header string records, workspace roots, timeout bounds, and boolean
    fields.
  - MCP test/tool listing now rejects invalid server ids and workspace ids
    before reaching probe/spawn-capable runtime functions.
  - MCP system config patches now validate policy/category/timeout/enabled
    fields by key presence so explicit `null` cannot be persisted as an
    invalid config value.
  - Added regression coverage for invalid stdio/env, invalid HTTP URL,
    oversized timeout, invalid probe/list args, invalid system policy/category,
    invalid enabled payloads, and explicit-null system config patches.
  - Reviewer subagent initially found the explicit-null system config gap; the
    validator and tests were tightened, and follow-up review returned
    `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/mcp-ipc.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 3 files and 16 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/mcp-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for high-risk provider, routing, model
    route, and local-agent configuration channels before they can persist
    provider config, mutate route bindings, test models, or configure local
    binaries.
  - Covered provider mutations including provider id/type/base URL/model list,
    fetch-model override, enabled/key mutations, provider reorder ids, and
    complete custom-provider creation checks for new provider ids.
  - Covered routing mutations including binding protocol, required thinking
    config, `thinkingAllow`, fallback chain ids, route strategy, provider
    thinking, binding thinking, and active binding ids.
  - Covered model-center route mutations including route settings, Codex slot
    modes, model route patch bounds, model test input, favorite/hidden ids, and
    local agent configure protocol/binary/args payloads.
  - Reviewer subagent found and rechecked multiple explicit-null config holes:
    provider capabilities/defaultThinking, binding thinking/`thinkingAllow`,
    and thinking `budgetTokens`/`collapseInUI`. The validator and regression
    tests were tightened until follow-up review returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/provider-ipc.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/provider-ipc.ts src/main/ipc/__tests__/provider-ipc.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for high-risk plugin channels:
    `plugins:scan`, `plugins:validate`, `plugins:contributions`,
    `plugins:importRepository`, `plugins:install`, `plugins:uninstall`, and
    `plugins:toggle`.
  - Plugin repository import now rejects invalid payloads before clone/runtime
    work, requiring HTTPS, supported GitHub/GitCode hosts, and owner/repo path.
  - Plugin manifests and contribution sets now validate command, skill, prompt,
    dependency, install id, and registry mutation shapes before persistence or
    contribution processing.
  - Skill contribution paths remain strict at the IPC boundary: relative only,
    no traversal, no absolute paths.
  - Fixed Codex-style plugin scanning so generated `SKILL.md` contribution
    paths are relative to the plugin/package root with POSIX separators,
    preserving compatibility with the stricter IPC validator.
  - Reviewer subagent found and rechecked absolute scanned skill paths,
    explicit-null contribution arrays, and repository URL policy gaps. The
    runtime scanner, validator, and tests were tightened until follow-up review
    returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/plugins-ipc.test.ts src/main/runtime/__tests__/batch4-modules.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 31 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/plugins-ipc.test.ts src/main/runtime/plugin-manager.ts src/main/runtime/__tests__/batch4-modules.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for backup, project map, and project
    knowledge channels: `backup:restore`, `backup:delete`,
    `projectMap:build`, `projectMap:search`,
    `knowledge:detectTechStack`, and `knowledge:generateSummary`.
  - Backup restore/delete now reject invalid filenames before reaching backup
    file operations, including traversal, path separators, non-AgentHub backup
    names, and oversized names.
  - Project map build/search now validate root paths, depth bounds, map stats,
    recursive node shape, total node count, language counts, and query type
    before recursive runtime work.
  - Knowledge summary now validates workspace root, entries array shape,
    maximum entry count, and entry string lengths before summary generation.
  - Added `workflow-knowledge-ipc-validation.test.ts` coverage for invalid
    payloads being blocked before handler side effects and valid payloads being
    passed through unchanged.
  - Reviewer subagent returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/workflow-knowledge-ipc-validation.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/ipc/__tests__/workflow-store-ipc.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/workflow-knowledge-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for SDD/Todo execution channels:
    `todos:list`, `todos:set`, `todos:upsert`, `todos:delete`,
    `todos:clear`, and `todos:syncFromMarkdown`.
  - Todo mutations now validate thread ids, todo ids, status enum values,
    source kind/metadata, per-call item count, todo content size, markdown
    sync payload size, and SDD plan source context before persistence.
  - Kept compatibility with existing runtime behavior: `todos:set` still
    allows generated ids and optional source metadata, `todos:upsert` keeps
    id/status/source optional, and `todos:syncFromMarkdown` accepts the
    renderer-provided SDD `workspaceRoot`/`draftId`/`relativePath` context
    while runtime still generates plan metadata.
  - Added `todos-ipc.test.ts` coverage for invalid payloads being blocked
    before handler side effects and valid manual/plan payloads passing through
    unchanged.
  - Reviewer subagent returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/todos-ipc.test.ts src/main/runtime/__tests__/todos.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 17 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/todos-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation and workflow/team
  correctness:
  - Added runtime payload validation for workflow template channels:
    `workflows:list`, `workflows:get`, `workflows:upsert`,
    `workflows:delete`, and `workflows:search`.
  - Workflow upsert now validates name/category, step count, step type/label,
    prompt size, dependencies array size/type, tag count/size, and pinned
    boolean values before persistence.
  - Added runtime payload validation for team preset channels:
    `teams:save`, `teams:delete`, and `teams:defaultFirefly`.
  - Team preset save now validates name, member count, role enum, agent id,
    and system prompt size before persistence; Firefly default agent ids are
    bounded before role assignment.
  - Fixed `deleteTeamPreset()` so deleting an existing team preset returns
    `true` after writing the filtered preset list instead of comparing the
    original list length to itself.
  - Added `workflow-team-ipc.test.ts` coverage for invalid payloads being
    blocked before handler side effects and valid workflow/team payloads
    passing through unchanged.
  - Added runtime coverage in `batch2-modules.test.ts` for successful team
    preset deletion returning `true` and removing the stored preset.
  - Reviewer subagent returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/workflow-team-ipc.test.ts src/main/runtime/__tests__/workflows.test.ts src/main/runtime/__tests__/batch2-modules.test.ts src/main/ipc/__tests__/workflow-store-ipc.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 6 files and 34 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/workflow-team-ipc.test.ts src/main/runtime/team-builder.ts src/main/runtime/__tests__/batch2-modules.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for prompt library channels:
    `prompts:list`, `prompts:get`, `prompts:upsert`, `prompts:delete`,
    `prompts:search`, and `prompts:incrementUse`.
  - Prompt mutations now validate category enum values, prompt ids, prompt
    names, prompt body size, tag count/size, optional slash-command shortcuts,
    search query size, and use-count mutation ids before reaching the prompt
    library runtime.
  - Added `prompts-ipc.test.ts` coverage for invalid payloads being blocked
    before handler side effects and valid prompt list/upsert/search/use-count
    payloads passing through unchanged.
  - Reviewer subagent returned `APPROVE`. It noted one non-blocking product
    choice: prompt shortcuts are currently wider than custom slash-command
    shortcuts; this remains compatible with prompt-library behavior.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/prompts-ipc.test.ts src/main/runtime/__tests__/batch2-modules.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 22 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/prompts-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for usage statistics and budget center
    channels: `usage:stats`, `usage:records`, `usage:recordDetail`,
    `usage:pricing:upsert`, `usage:pricing:delete`, `budget:update`, and
    `budget:check`.
  - Usage queries now validate range/view enums, filter shape, timestamps,
    provider/model/agent ids, source/status/sort enums, query length, page
    bounds, and page-size bounds before statistics runtime work.
  - Usage pricing mutations now validate model ids, optional provider/display
    fields, non-negative finite pricing values, and pricing delete ids before
    persistence.
  - Budget updates now validate nullable numeric budget limits, token bounds,
    notification percentage bounds, and boolean flags; budget checks validate
    finite non-negative spend/token inputs before policy evaluation.
  - Added `usage-budget-ipc.test.ts` coverage for invalid payloads being
    blocked before handler side effects, legal full pricing payloads, legal
    minimal `{ modelId }` pricing payloads, nullable budget fields, and valid
    usage/budget payloads passing through unchanged.
  - Reviewer subagent returned `APPROVE` and suggested a minimal pricing
    payload test; the test was added before recording this slice.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/usage-budget-ipc.test.ts src/main/runtime/__tests__/usage-stats.test.ts src/main/runtime/__tests__/usage-stats-dispatcher.test.ts src/main/runtime/__tests__/p4-modules.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 6 files and 49 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/usage-budget-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for goal, command, schedule,
    notification, onboarding, and inline-edit channels:
    `goals:get`, `goals:set`, `goals:clear`, `commands:run`,
    `schedules:runPreview`, `notifications:list`, `notifications:push`,
    `notifications:markRead`, `notifications:delete`,
    `onboarding:completeStep`, `inlineEdit:buildPrompt`,
    `inlineEdit:validate`, and `inlineEdit:apply`.
  - Goal mutations now validate optional thread lookups, required thread ids,
    goal body length, and loop limits matching the runtime 1-20 clamp range.
  - Command execution validation keeps runtime compatibility by allowing `{}`,
    empty text, id-based commands, and text commands while bounding id/text
    size and rejecting non-object payloads.
  - Schedule preview now validates dispatch preset enum values before runtime
    lookup.
  - Notification pushes now validate title/body/category/action shape, keep
    empty body compatibility, bound ids for read/delete mutations, and restrict
    open-url actions to HTTP/HTTPS URLs.
  - Onboarding completion now validates the onboarding step enum and optional
    skipped boolean.
  - Inline-edit validation now rejects malformed ranges and oversized edit
    payloads while preserving UI-compatible empty file path, selected text,
    original text, replacement text, and content payloads.
  - Added `goals-commands-ipc.test.ts` and `notifications-inline-ipc.test.ts`
    coverage for invalid payloads being blocked before handler side effects
    and valid payloads passing through unchanged.
  - Reviewer subagent returned `APPROVE` for both groups.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/goals-commands-ipc.test.ts src/main/ipc/__tests__/notifications-inline-ipc.test.ts src/main/runtime/__tests__/p4-modules.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 5 files and 23 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/goals-commands-ipc.test.ts src/main/ipc/__tests__/notifications-inline-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for keyboard shortcut and slash-command
    channels: `shortcuts:list`, `shortcuts:get`, `shortcuts:update`,
    `shortcuts:reset`, `slashCommands:get`, `slashCommands:save`,
    `slashCommands:delete`, `slashCommands:resolve`,
    `slashCommands:validate`, and `slashCommands:conflict`.
  - Shortcut validation now checks category enum values, shortcut ids, and
    bounded key strings without parsing the key-combination grammar, preserving
    the runtime's string-based customization behavior.
  - Slash-command save/get/delete/resolve now use the runtime-compatible
    shortcut grammar: slash prefix, 2-32 characters, and letters/numbers/
    hyphen/underscore only.
  - Slash-command resolve parameters now validate object shape, maximum entry
    count, `\w+` placeholder names, and bounded string values before template
    substitution.
  - Slash-command validate/conflict remain feedback/query channels: they only
    validate type/length/NUL payload safety so invalid but type-safe shortcut
    strings can still reach runtime and produce `{ valid: false }` or conflict
    feedback instead of IPC exceptions.
  - Added `shortcuts-slash-ipc.test.ts` coverage for invalid payloads being
    blocked before handler side effects, valid shortcut updates, valid slash
    command save/resolve, and invalid-format validate/conflict calls passing
    through unchanged.
  - Initial reviewer subagent requested fixing `slashCommands:validate` so
    invalid-format strings were not preemptively rejected; the validator and
    regression tests were adjusted, and follow-up review returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/shortcuts-slash-ipc.test.ts src/main/runtime/__tests__/p4-modules.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 20 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/shortcuts-slash-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for small mutation channels:
    `settings:setRunTimeout`, `updates:check`, `updates:setChannel`, and
    `tasks:delete`.
  - Run timeout updates now validate finite numbers within the runtime clamp
    range of 60,000-3,600,000 ms before persistence.
  - Update checks now validate optional update channels, while update channel
    persistence requires `stable` or `preview`.
  - Task deletion now validates non-empty bounded task ids before reaching the
    task recovery IPC handler; `tasks:clearCompleted` remains zero-argument and
    has no payload to validate.
  - Added `settings-updates-tasks-ipc.test.ts` coverage for invalid payloads
    being blocked before handler side effects and valid payloads passing
    through unchanged.
  - Reviewer subagent returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/settings-updates-tasks-ipc.test.ts src/main/ipc/__tests__/missing-ipc-tasks.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 13 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/settings-updates-tasks-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for Workflow Center channels:
    `workflow:substituteVars`, `workflow:evaluateCondition`,
    `workflow:saveRun`, and `workflow:runHistoryFor`.
  - Workflow variable substitution and condition evaluation now validate
    bounded template/condition strings, variable arrays, variable names,
    values, and type enums before runtime evaluation.
  - Workflow run history persistence now validates workflow/run ids, workflow
    name, timestamps, status enum values, step result count, step ids/status
    strings, and bounded step output/error strings before storing history.
  - `workflow:runHistoryFor` now validates the requested workflow id;
    `workflow:runHistory` remains zero-argument.
  - Added `workflow-center-ipc.test.ts` coverage for invalid payloads being
    blocked before handler side effects and valid payloads passing through
    unchanged.
  - Reviewer subagent returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/workflow-center-ipc.test.ts src/main/runtime/__tests__/p4-modules.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 20 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/workflow-center-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for Terminal AI, quick-complete, and
    browser context channels: `terminalAi:buildPrompt`,
    `terminalAi:suggestCommand`, `terminalAi:explainOutput`,
    `ai:quickComplete`, `browser:open`, `browser:capture`,
    `browser:summarize`, `browser:extractText`, and
    `browser:analyzePrompt`.
  - Terminal AI validation now bounds prompt/intent strings and validates
    terminal context command/output arrays, optional cwd, and optional integer
    exit codes before prompt construction.
  - Quick-complete validation now blocks malformed prompt/provider/model/
    timeout payloads before provider selection, returning the existing
    `{ ok: false, error }` response shape for invalid IPC payloads.
  - Browser validation now preserves renderer compatibility for `about:blank`,
    HTTP/HTTPS URLs, partial capture objects, empty captured text, empty
    analyze requests, and empty browser metadata while bounding page text,
    links, headings, forms, and HTML inputs.
  - Added `terminal-browser-ai-ipc.test.ts` coverage for invalid payloads being
    blocked before handler side effects or returned as quick-complete error
    envelopes, plus valid payloads passing through unchanged.
  - Updated `missing-ipc-quick-complete.test.ts` for the new typed validation
    error envelope while retaining the no-provider-side-effect assertions.
  - Reviewer subagent returned `APPROVE`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/terminal-browser-ai-ipc.test.ts src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 19 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/terminal-browser-ai-ipc.test.ts src/main/ipc/__tests__/missing-ipc-quick-complete.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added Firefly state-machine IPC runtime validation for
    `firefly:createState`, `firefly:completeRole`,
    `firefly:getRoleContext`, `firefly:isComplete`, and
    `firefly:getOutput`.
  - Firefly validation now rejects malformed phases, roles, state text fields,
    action/reason arrays, timestamps, role timing entries, duplicate timing
    roles, and extra arguments on the zero-argument `createState` channel before
    handler side effects.
  - Preserved runtime compatibility with actual `Map<FireflyRole, timing>`
    values while also accepting serialized entries arrays for renderer/main IPC
    round trips.
  - Added `firefly-ipc.test.ts` coverage for invalid payloads being blocked and
    valid Map/entries-array states passing through unchanged.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/firefly-ipc.test.ts src/main/runtime/__tests__/firefly-state-machine.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 18 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/firefly-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - IPC coverage scan after this batch: 311 channels, 175 validated, 136
    missing runtime validators.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for turn execution channels:
    `turns:create`, `turns:retry`, `turns:cancel`, `turns:cancelAgent`,
    and `turns:resolveGuard`.
  - Turn creation validation now bounds prompt size, thread/workspace/agent ids,
    provider/local model selections, thinking config, attachments, and custom
    schedule step graphs without changing existing auto/custom/direct dispatch
    behavior.
  - Turn action validation now rejects malformed turn ids, agent ids, guard
    approval ids, and non-boolean guard decisions before runtime side effects.
  - Added `turns-ipc-validation.test.ts` coverage for malformed creation/action
    payloads being blocked and a valid complex custom-schedule payload passing
    through unchanged.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/turns-ipc-validation.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts src/main/__tests__/firefly-custom.test.ts`
    with 4 files and 24 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/turns-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - IPC coverage scan after this batch: 311 channels, 180 validated, 131
    missing runtime validators.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for agentic capability/config/approval
    channels: `agentic:capabilities`, `agentic:getEnabled`,
    `agentic:setEnabled`, `agentic:getMode`, `agentic:setMode`,
    `agentic:getApprovalConfig`, `agentic:setApprovalPreset`,
    `agentic:setApprovalDefault`, `agentic:setApprovalOverride`, and
    `agentic:resolveApproval`.
  - Agentic validation now rejects unexpected arguments on zero-argument query
    channels and enforces bounded agent/request ids, approval mode/preset/tool/
    policy enums, boolean enablement, boolean guard decisions, and nullable
    override policy resets.
  - Added `agentic-ipc-validation.test.ts` coverage for invalid payloads being
    blocked before handler side effects and valid config updates passing through
    unchanged.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/agentic-ipc-validation.test.ts src/main/ipc/__tests__/missing-ipc-agentic.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 13 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/agentic-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - IPC coverage scan after this batch: 311 channels, 190 validated, 121
    missing runtime validators.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for skill management channels:
    `skills:list`, `skills:builtins`, `skills:scanLocal`,
    `skills:refreshLocal`, `skills:add`, `skills:update`, `skills:remove`,
    `skills:getInstalls`, `skills:install`, and `skills:uninstall`.
  - Skill validation now rejects unexpected arguments on zero-argument query
    channels and bounds skill names, categories, descriptions, instruction
    bodies, tags, sources, skill ids, and agent ids before SkillManager
    persistence or install state changes.
  - Preserved SkillManager-compatible inputs: category may be string or object,
    install/uninstall may target `*`, and optional description/source values may
    be empty strings.
  - Added `skills-ipc-validation.test.ts` coverage for invalid payloads being
    blocked and valid add/update/install/uninstall payloads passing through
    unchanged.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/skills-ipc-validation.test.ts src/main/ipc/__tests__/missing-ipc-skills.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 15 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/skills-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - IPC coverage scan after this batch: 311 channels, 200 validated, 111
    missing runtime validators.
  - Reviewer subagent initially returned `BLOCKED` because `skills:update`
    accepted `patch.tags: null`, which would reach `SkillManager.update()` and
    fail on `patch.tags.map(...)`.
  - Fixed `validateSkillTags()` so explicitly present `null` tags are rejected
    while omitted tags remain optional, and added a regression assertion for
    `skills:update('skill-1', { tags: null })`.
  - Revalidation passed:
    `npx vitest run src/main/ipc/__tests__/skills-ipc-validation.test.ts src/main/ipc/__tests__/missing-ipc-skills.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 4 files and 15 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/skills-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Follow-up reviewer subagent returned `APPROVE`.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for memory catalog/settings/entry/search/
    import/candidate/graph/quality/conflict channels:
    `memory:catalog`, `memory:getSettings`, `memory:updateSettings`,
    `memory:list`, `memory:search`, `memory:addEntry`,
    `memory:importConversation`, `memory:listCandidates`,
    `memory:approveCandidate`, `memory:updateEntry`, `memory:disableEntry`,
    `memory:delete`, `memory:restore`, `memory:graph`,
    `memory:cleanupSuggestions`, `memory:scoreQuality`, and
    `memory:detectConflicts`.
  - Memory validation now rejects malformed categories, settings patches, entry
    payloads, candidate ids, graph arrays, cleanup graph payloads, and conflict
    entry arrays before handler side effects.
  - Metadata validation remains runtime-compatible but bounded: shallow
    primitive/null/undefined values and primitive arrays are allowed, nested
    objects are rejected.
  - Added `memory-ipc-validation.test.ts` coverage for invalid payloads being
    blocked before handler side effects and valid payloads passing through
    unchanged.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/memory-ipc-validation.test.ts src/main/ipc/__tests__/memory-ipc.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/memory-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Reviewer subagent returned `APPROVE`.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for Workbench foundation IPC channels:
    `takeover:status`, `takeover:apply`, `takeover:restore`,
    `store:get`, `store:set`, `hub:status`, `threads:list`,
    `threads:create`, `threads:rename`, `threads:delete`,
    `threads:select`, `threads:fork`, `runtime:snapshot`,
    `runtime:eventsSince`, and `context:projection`.
  - Takeover validation now rejects unsupported app ids before config takeover
    side effects while matching the current runtime support list:
    `codex`, `claude`, `hermes`, and `openclaw`.
  - Store validation now allows JSON-like values and undefined read defaults
    while rejecting non-serializable values, non-finite numbers, and oversized
    nested structures before store access.
  - Thread/runtime/context validation now bounds thread/workspace ids, fork
    messages, event sequence numbers, attachments, write drafts, and pinned
    context blocks before runtimeStore/context side effects.
  - Added coverage in `missing-ipc-takeover.test.ts`,
    `workflow-store-ipc.test.ts`, and `hub-threads-ipc.test.ts` for invalid
    payloads being blocked before side effects and valid edge payloads passing
    through unchanged.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/missing-ipc-takeover.test.ts src/main/ipc/__tests__/workflow-store-ipc.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 5 files and 38 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/missing-ipc-takeover.test.ts src/main/ipc/__tests__/workflow-store-ipc.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Reviewer subagent returned `APPROVE`.
  - IPC coverage scan after this batch: 311 channels, 232 validated, 79
    missing runtime validators.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for query/zero-argument IPC channels:
    window controls, proxy info, agent locate/status/options, providers get/
    health-all, workspaces list/get-active, agent loop config/status/agents/
    refresh/route-info, model route queries, MCP system config, workflows
    seed, plugin repository/install queries, local model scan/read, settings,
    commands, schedules, ECC, update status/open-download, logs, diagnostics,
    GitHub queries, release checks, terminal history, task clear-completed,
    shortcut/slash-command list/reset/conflict queries, notification/onboarding
    actions, backup list/create, usage pricing list, prompt slash/default
    queries, budget get, workflow history, teams list, and SDD parser channels.
  - Zero-argument channels now reject unexpected arguments without changing
    their successful handler return path.
  - Small argument channels now validate local model agent ids, log limits,
    route turn ids, GitHub state/limit filters, agent-loop prompts, and SDD
    parser markdown inputs while preserving key compatibility edges such as
    `localModels:scan(undefined/null)`, optional GitHub filters, empty prompts,
    and empty markdown.
  - Added `query-ipc-validation.test.ts` coverage for invalid-before-side-
    effects and valid-through cases.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/query-ipc-validation.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 3 files and 13 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/main/ipc/__tests__/query-ipc-validation.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Reviewer subagent returned `APPROVE`.
  - IPC coverage scan after this batch: 311 channels, 301 validated, 10
    missing runtime validators.
- Continued fable5 1.3.0 runtime IPC validation:
  - Added runtime payload validation for the final uncovered channels:
    `dialog:selectDirectory`, `conversation:exportMarkdown`,
    `conversation:exportHtml`, `conversation:importJson`,
    `conversation:branch`, `conversation:summarize`, `models:list`,
    `git:status`, `git:branches`, and `git:diffs`.
  - Conversation export validation preserves legacy `{ messages: [] }`
    compatibility while bounding message roles, content, attachments,
    metadata, and imported conversation payloads before file/import side
    effects.
  - `models:list` now uses a read-only provider-list validator instead of the
    provider mutation schema. It accepts future provider `kind` strings,
    partial `capabilities.protocol`, and custom reasoning levels, while
    rejecting missing/non-array `providers[i].models` and malformed model
    fields before `buildModelList`.
  - Type contracts now mirror the runtime split: `models:list` input accepts
    custom reasoning level strings, while `models:updateRoute` patch remains
    constrained to the existing `ModelReasoningLevelLike` enum.
  - Git read-only status/branch/diff channels now validate optional workspace
    ids while preserving the global/default call path.
  - Added and updated coverage in `conversation-ipc.test.ts`,
    `models-ipc.test.ts`, `git-ipc.test.ts`, `query-ipc-validation.test.ts`,
    and `Settings.models.test.ts` for valid-through and
    invalid-before-side-effects cases.
  - Reviewer subagent initially returned `BLOCKED` because `models:list`
    reused provider upsert validation and allowed missing `models`; this was
    fixed with the dedicated validator and regression tests.
  - Follow-up reviewer subagent returned `BLOCKED` for a type-level mismatch
    where custom reasoning levels were accepted at runtime but rejected by
    `ModelListProviderModelLike` / renderer ambient types. The list input type
    was widened and route mutation patch typing was split to keep write-path
    constraints.
  - Final reviewer subagent returned `APPROVED`.
  - Targeted validation passed:
    `npx vitest run src/main/ipc/__tests__/conversation-ipc.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/git-ipc.test.ts src/main/ipc/__tests__/query-ipc-validation.test.ts src/renderer/screens/Settings.models.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 7 files and 32 tests.
  - Targeted eslint passed:
    `npx eslint src/shared/ipc-contract.ts src/renderer/vite-env.d.ts src/main/ipc/__tests__/conversation-ipc.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/git-ipc.test.ts src/main/ipc/__tests__/query-ipc-validation.test.ts src/renderer/screens/Settings.models.test.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - IPC coverage scan after this batch: 311 channels, 311 validated, 0 missing
    runtime validators.
  - Cumulative IPC validation passed:
    `npx vitest run src/main/ipc/__tests__/skills-ipc-validation.test.ts src/main/ipc/__tests__/memory-ipc-validation.test.ts src/main/ipc/__tests__/missing-ipc-takeover.test.ts src/main/ipc/__tests__/workflow-store-ipc.test.ts src/main/ipc/__tests__/hub-threads-ipc.test.ts src/main/ipc/__tests__/query-ipc-validation.test.ts src/main/ipc/__tests__/conversation-ipc.test.ts src/main/ipc/__tests__/models-ipc.test.ts src/main/ipc/__tests__/git-ipc.test.ts src/renderer/screens/Settings.models.test.ts src/main/ipc/__tests__/typed-ipc-runtime-validation.test.ts src/main/ipc/__tests__/ipc-contract-guard.test.ts`
    with 12 files and 65 tests.
- Continued fable5 1.3.0 Workbench state decomposition:
  - Added `src/renderer/workbench/state/ui-store.ts` as the first production
    Workbench UI state store for low-side-effect UI state: active view,
    settings tab, right panel, inspector width, first-run announcement state,
    and command palette visibility.
  - `WorkbenchLayout.tsx` now reads those UI states/actions from
    `useWorkbenchUiStore` instead of owning local `useState` for them, while
    keeping runtime snapshot, thread selection, dispatch, Todo, and IPC flows
    in the layout for later dedicated batches.
  - Startup view restoration moved into the store and preserves existing
    behavior: `settings` opens the appearance tab, `last` restores only valid
    Workbench views, and default startup targets reset to `chat` so store state
    does not leak across remounts.
  - Inspector width hydration/preview remains clamped, first-run announcement
    close still persists the `seen` marker, and command palette toggling
    preserves functional updater support.
  - Added `ui-store.test.ts` coverage for startup restore, malformed last-view
    fallback, default startup remount reset, right-panel/command-palette state,
    inspector width clamp, announcement close persistence, and localStorage
    failure tolerance.
  - Initial reviewer subagent returned `BLOCKED` because the dirty worktree also
    contained earlier SDD/Todo/sendPrompt changes outside this batch boundary.
    The UI store batch was kept scoped, the default startup reset regression was
    added, and follow-up reviewer subagent returned `APPROVED` for the UI store
    increment.
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/ui-store.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts src/renderer/workbench/__tests__/viewModes.test.ts`
    with 3 files and 23 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/workbench/state/ui-store.ts src/renderer/workbench/__tests__/ui-store.test.ts src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/WorkbenchMainContent.tsx`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 SDD assistant writeback safety:
  - Normal Requirements AI chat responses now create a manual requirement-apply candidate instead of directly modifying the requirement document.
  - Candidate actions expose Preview changes, Apply to document, and Discard; Discard prevents later application.
  - Apply writes through the guarded SDD draft path with draft id, workspace root, and content hash checks, records history, saves the draft, reparses requirement blocks, and refreshes the draft list.
  - Fixed reviewer-blocked state bug: requirement apply UI now stores stable state objects (`applying`, `applied`, `failed`, `discarded`) and no longer uses localized display text for disabled logic.
  - Added regression coverage so a successful Apply disables the button and a second click does not call writeback again.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/components/SddAssistantPanel.test.tsx src/renderer/sdd/sdd-assistant-apply.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx`
    with 3 files and 17 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/sdd/components/SddAssistantPanel.tsx src/renderer/sdd/components/SddAssistantPanel.test.tsx`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Read-only reviewer subagent initially returned `BLOCKED` because localized status text was used as logic state; after the stable-state fix and regression test, the same reviewer returned `APPROVED`.
- Continued fable5 1.3.0 SDD Todo/trace runtime synchronization:
  - Added runtime-event mapping for SDD plan Todos: `turn:status completed` marks the matching dispatched plan Todo `completed`, while `failed` and `cancelled` return it to `pending` because the current Todo contract has no failed state.
  - Workbench runtime event handling now matches only current-thread SDD plan Todos whose `source.turnId` equals the runtime event turn id, avoiding manual Todos and unrelated turns.
  - Automatic synchronization upserts the Todo and reuses `persistSddPlanTodoStatus()` so `trace.json` plan item status and derived requirement statuses are updated without requiring the user to manually mark the Todo done.
  - Existing manual Todo status updates remain in place.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/workbench/__tests__/workbench-runtime-events.test.ts`
    with 2 files and 20 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/sdd/sdd-trace-dispatch.ts src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/workbench/WorkbenchLayout.tsx`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Read-only reviewer subagent returned `APPROVED`.
- Continued fable5 1.3.0 Composer decomposition and SDD evidence hygiene:
  - Extracted Composer slash/add-command pure logic into
    `src/renderer/workbench/utils/composerCommandUtils.ts`, including command
    token normalization, command matching, slash palette ranking, and active
    `@` mention replacement.
  - Extracted Composer attachment helpers into
    `src/renderer/workbench/utils/composerAttachments.ts`, including pasted
    file conversion, picked path conversion, and size formatting.
  - Extracted Composer `@` add palette/plugin context helpers into
    `src/renderer/workbench/utils/composerAddItems.ts`, including base add
    items, plugin contribution items, plugin context attachment creation,
    grouping, labels, and safe plugin mention tokens.
  - `ComposerBar.tsx` now imports those helpers and was reduced from 1625
    lines to 1241 lines while preserving UI behavior.
  - Fixed an SDD verification evidence callback dependency so
    `SddRequirementsList` rebuilds verification prompts with the latest
    `threadId` after thread switches.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/sdd/components/SddAssistantPanel.verify.test.tsx src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/workbench/__tests__/ComposerBar.pickFiles.test.tsx`
    with 7 files and 57 tests.
  - Composer-focused validation passed:
    `npx vitest run src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/workbench/__tests__/ComposerBar.pickFiles.test.tsx src/renderer/workbench/__tests__/composerQuickRole.test.ts src/renderer/workbench/__tests__/composerApprovalMode.test.ts src/renderer/workbench/__tests__/provider-routing-state.test.ts`
    with 5 files and 31 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/workbench/ComposerBar.tsx src/renderer/workbench/utils/composerCommandUtils.ts src/renderer/workbench/utils/composerAttachments.ts src/renderer/workbench/utils/composerAddItems.ts src/renderer/workbench/__tests__/slash-command-behavior.test.ts src/renderer/sdd/components/SddRequirementsList.tsx`.
  - `npx tsc -b --noEmit --pretty false` passed.
- Continued fable5 1.3.0 SDD evidence closure:
  - Repaired `src/renderer/workbench/GitWorkbenchPanel.tsx` after a broken
    encoded write left the file syntactically invalid; restored Git workbench
    behavior and retained SDD commit-link controls.
  - SDD plan Todo metadata now carries `threadId`, dispatch Git baseline
    (`gitRootAtDispatch` and `gitHeadAtDispatch`), and linked commit evidence
    can carry `threadId`.
  - Plan Todo markdown sync now writes `source.threadId` and clears stale SDD
    plan Todos for the same scope when a regenerated plan contains no valid
    covered checklist items.
  - Workbench runtime completion handling now loads Todos by `event.threadId`
    instead of relying only on the visible thread; pending/loading thread events
    can still update SDD Todo and trace state.
  - Dispatching an SDD plan Todo captures the current Git HEAD/root before the
    run starts; when the matching turn completes, commits after that baseline
    are linked as verification evidence for the matching plan item.
  - Verification evidence summaries and manual Git-panel commit links are now
    thread-aware to reduce same-draft cross-thread evidence leakage.
  - Targeted validation passed:
    `npx vitest run src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.test.ts src/main/runtime/__tests__/todos.test.ts src/main/ipc/__tests__/todos-ipc.test.ts src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx`
    with 5 files and 34 tests.
  - Extended SDD/Workbench validation passed:
    `npx vitest run src/renderer/sdd/sdd-draft-actions.test.ts src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.test.ts src/renderer/sdd/components/SddRequirementsList.closed-loop.test.tsx src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/main/runtime/__tests__/todos.test.ts src/main/ipc/__tests__/todos-ipc.test.ts`
    with 8 files and 62 tests.
  - Targeted eslint passed:
    `npx eslint src/renderer/sdd/sdd-trace-dispatch.ts src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.ts src/renderer/sdd/sdd-verify-prompt.test.ts src/main/runtime/todos.ts src/main/runtime/__tests__/todos.test.ts src/main/ipc/__tests__/todos-ipc.test.ts src/renderer/workbench/GitWorkbenchPanel.tsx src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/renderer/workbench/WorkbenchLayout.tsx src/renderer/workbench/WorkbenchPanelContainers.tsx src/shared/ipc-contract.ts src/renderer/vite-env.d.ts src/main/runtime/types.ts src/main/sdd/sdd-types.ts`.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Read-only reviewer subagent returned `BLOCKED` for four important risks:
    fast completion could still arrive before the dispatched Todo had a
    `turnId`, automatic Git evidence could over-bind multiple commits after a
    shared baseline, `dispatchThreadTodo` missed `workspaceId` in its callback
    dependencies, and thread-scoped verification still accepted unscoped legacy
    commits.
  - Follow-up fixes:
    - extracted `syncSddPlanTodoForRuntimeEvent()` so visible, hidden, and
      pending/loading thread events use the same SDD Todo/trace writeback path
    - after dispatch writes the `turnId`, Workbench checks the latest runtime
      snapshot and immediately compensates if the turn already completed,
      failed, or cancelled
    - automatic Git evidence now links only when exactly one commit appears
      after the dispatch baseline; multi-commit histories require manual Git
      panel linking
    - thread-scoped verification excludes commits without matching `threadId`
    - `dispatchThreadTodo` now includes `workspaceId` in its dependencies
  - Follow-up validation passed:
    `npx vitest run src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.test.ts src/main/runtime/__tests__/todos.test.ts src/main/ipc/__tests__/todos-ipc.test.ts src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/renderer/workbench/__tests__/workbench-runtime-events.test.ts src/renderer/workbench/__tests__/git-dock-layout.test.ts`
    with 7 files and 63 tests.
  - Follow-up `npx tsc -b --noEmit --pretty false` passed.
  - Follow-up targeted eslint passed over the same SDD, Todo, Git panel,
    Workbench, IPC contract, ambient type, and runtime type files.
- Continued fable5 1.3.0 SDD evidence closure follow-up:
  - Fixed the manual Git evidence link UI so same-SHA legacy commit evidence
    without `threadId` no longer disables the Link commit action when an active
    thread is present.
  - `GitWorkbenchPanel` now treats a selected commit as already linked only
    when the evidence SHA matches and, for thread-scoped work, the evidence
    `threadId` matches the active thread. This makes the existing
    `persistSddPlanCommitEvidence()` upgrade path reachable from the UI.
  - Added regression coverage for re-linking old unscoped same-SHA evidence to
    the active thread and for disabling the action when the commit is already
    linked to that same thread.
  - Targeted validation passed:
    `npx vitest run src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/renderer/sdd/sdd-trace-dispatch.test.ts src/renderer/sdd/sdd-verify-prompt.test.ts`
    with 3 files and 29 tests.
  - `npx tsc -b --noEmit --pretty false` passed.
  - Targeted eslint passed:
    `npx eslint src/renderer/workbench/GitWorkbenchPanel.tsx src/renderer/workbench/__tests__/GitWorkbenchPanel.sdd-link.test.tsx src/renderer/sdd/sdd-trace-dispatch.ts src/renderer/sdd/sdd-verify-prompt.ts`.
  - Read-only reviewer subagent returned `APPROVED`.
- Continued fable5 packaging/E2E validation work:
  - Reworked `test/e2e/app.spec.ts` from multiple per-test Electron launches
    into one serial smoke flow with `test.step` sections, because repeated
    launch/close was unstable with tray, slow renderer boot, and the host
    machine's existing AgentHub Electron instance.
  - Added the test-only `AGENTHUB_E2E=1` environment flag and guarded
    `src/main/index.ts` so E2E runs skip the production single-instance lock
    while normal dev and packaged builds keep the existing lock behavior.
  - Hardened E2E cleanup by terminating only the Electron process tree started
    by the test and retrying temporary user-data deletion on Windows file locks.
  - Corrected the Settings shortcut used by E2E from `Ctrl+4` to `Ctrl+5`,
    matching the current shortcut map where `Ctrl+4` opens Requirements.
  - Kept the E2E checks focused on real packaged-renderer behavior: workbench
    shell renders, Settings opens, built-in provider cards appear from clean
    user data, and the composer input is visible after returning to chat.
  - Validation passed:
    `npm run test:e2e`
    with 1 Electron smoke test.
  - Reviewer follow-up found the GitHub Actions Ubuntu runner would run
    Electron E2E without a display server. CI now runs Linux E2E through
    `xvfb-run -a npm run test:e2e` and keeps Windows E2E on the normal
    `npm run test:e2e` path.
  - Final local verification after the CI fix passed:
    `npm run typecheck`,
    `npm run lint` with 0 errors and 33 existing warnings,
    `npm test` with 216 files and 1372 tests,
    `npm run build`,
    `npm run test:e2e` with 1 Electron smoke test, and
    `npm run build:win`.
  - Windows package output:
    `dist/AgentHub-Setup-1.2.3.exe`,
    `dist/AgentHub-Setup-1.2.3.exe.blockmap`, and
    `dist/win-unpacked/AgentHub.exe`.
