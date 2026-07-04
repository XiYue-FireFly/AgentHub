# Design 1.3.0 Fable5 Architecture Track

## Scope

This design records the fable5 architecture track for AgentHub 1.3.0. The work
must land in guarded batches so the app remains shippable after each merge.

## Batch 1: Release Discipline And SDD Durability

- Restore `VERSION.md` as the release register.
- Add a test that fails when `VERSION.md`, `package.json.version`, and
  `build.buildVersion` diverge.
- Keep CI on typecheck, lint, test, and build.
- Persist SDD draft title and timestamps in `meta.json`.
- Use atomic writes for draft content, metadata, and trace snapshots.
- Require confirmation before deleting a requirements draft.

## Batch 2: Runtime And IPC Guardrails

- Move renderer dependencies off legacy `dispatch:stream`.
- Keep runtime events as the renderer-facing event source.
- Introduce shared IPC contract types gradually, starting with write and path
  channels.
- Document the path trust rule in `docs/SECURITY.md`: workspace-root IPC must
  be limited to registered workspaces or explicit user-selected safe roots.

## Batch 3: Workbench Decomposition

- Move tail components out of `WorkbenchLayout.tsx` without behavior changes.
- Extract view, runtime, and dispatch state into focused stores after the pure
  move is verified.
- Add tests for extracted pure functions and store actions before removing old
  state paths.

## Batch 4: SDD Closed Loop

- Parse plan items into todos.
- Allow a selected plan step to dispatch as an agent prompt.
- Record the created turn in SDD trace data.
- Add trace UI after the dispatch path is stable.

## Verification Gate

Every batch must pass:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

For UI-affecting changes, also perform a desktop smoke test covering workspace
loading, Settings provider/model cards, terminal attach, and SDD draft creation.
