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

## Pending

- Continue fable5 1.3.0 Workbench decomposition in small verified batches.
- Next likely candidates: remove now-redundant older workbench component shards
  if unused, or extract pure command/runtime helpers with direct unit coverage.
- Re-run full validation after the next patch batch before commit.
