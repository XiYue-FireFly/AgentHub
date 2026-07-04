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

## Pending

- Commit the verified baseline patch set.
- Continue fable5 1.2.4 residual fixes and 1.3.0 groundwork in small
  verified batches.
