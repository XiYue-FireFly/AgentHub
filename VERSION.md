# AgentHub Version Register

Current code version: 2.1.1
Current branch baseline: main
Updated: 2026-07-22

This file is the release discipline record for AgentHub. Before any release,
keep `package.json.version`, `package.json.build.buildVersion`, this current
version, and release notes aligned.

## Release History

### 2.1.1

Purpose: follow-up bugfix release for the prompt-decision and multi-model fusion feature set.

Main changes:
- Multi-model fusion Judge parser now accepts standard Markdown code fences (``` / ~~~) so real model output is no longer silently rejected, ending wasteful REVISE rounds and unverified degraded releases.
- Composer prompt-optimizer (`ai:promptCandidates`) now selects the first provider with an enabled model instead of the first provider's first model, so disabled models and fabricated `gpt-4` fallbacks can no longer be called.
- The inline DecisionBar no longer allows a draft "Use custom text" choice to be submitted with empty text, which previously swallowed the decision with no effect.
- The workbench decision-resolution notice is now localized and auto-dismisses after six seconds instead of showing a hardcoded English string indefinitely.
- DecisionBar prompt-optimizer labels and guidance now localize by structural option id rather than matching exact main-side English wording, and draft prompt-enhancer labels follow live language switches.
- Headless CLI prompt candidates are no longer silently truncated to 16K; the full optimized prompt is preserved for both the TTY chooser and non-interactive callers.
- Prompt optimizer skill matching deduplicates registered and builtin skills by a single `source:name` key so duplicate skill lines no longer appear in the optimized prompt.

Verification recorded:
- `npm run typecheck`
- `npx vitest run` across runtime, ipc, renderer workbench, and prompt-core test directories
- `npx eslint` on all changed source files (0 errors)

### 2.1.0

Purpose: prompt preparation and durable decision workflow release.

Main changes:
- Added a prompt-preparation pipeline for every top-level input, including
  model-generated candidates for broad or explicitly requested optimization.
- Replaced blocking approval flows with an inline decision bar above the
  composer so prompt, permission, and Agent decisions resume the same Turn.
- Added opt-in multi-model fusion with bounded candidate, synthesis, and Judge
  rounds that produce one gated final response.
- Hardened decision, dispatch, agent-tool, and ACP boundaries with typed
  contracts, replay-safe continuations, and read-only fail-closed behavior.

Verification recorded:
- `npm run typecheck`
- `npm run lint`
- `npm test -- --reporter=dot`
- `npm run test:e2e -- --workers=1`
- `npm run build:win`

### 2.0.1

Purpose: defensive bugfix release for ACP permission/lifecycle hardening, local process cleanup, dependency refresh, and Electron E2E coverage.

Main changes:
- Completed the previously deferred ACP permission and lifecycle hardening batches.
- Hardened local process cancellation so POSIX process groups and Windows process trees are cleaned up consistently.
- Updated runtime/build/test dependencies to the compatible Electron 43 / Vite 7 toolchain.
- Added an active Electron E2E guard for blocked local top-level navigation without using HTTP(S), localhost, or external network fallback.

Verification recorded:
- `npm run typecheck`
- `npm run lint`
- `npm test -- --reporter=dot --maxWorkers=4`
- `npm run build`
- `npm run test:e2e -- --reporter=line`
- `npm run build:win -- --config.directories.output=<system-temp>`

### 2.0.0

Purpose: AgentHub 2.0 orchestration release with local-agent detection hardening.

Main changes:
- Added visual DAG scheduling metadata while keeping compiled steps as the runtime execution format.
- Added dispatch budget estimation, pre-dispatch budget blocking, and usage attribution filters.
- Added declarative plugin contribution points for slash commands, activity parsers, and pre-dispatch hooks.
- Added multi-window workbench support with shared runtime state and per-window UI state.
- Added unsigned GitHub auto-update flow with manual check, download, progress, and install states.
- Hardened local Agent detection so invalid, quoted, `.cmd`/`.bat`, and Windows shim command paths cannot crash `localAgents:detect`.

Fixes:
- Prevents `spawn EINVAL` from escaping local Agent detection IPC.
- Preserves usable local Agent entries when one configured binary is stale or malformed.
- Supports configured local command names such as `codex`, `opencode`, `codex.cmd`, and quoted executable paths.

Verification recorded:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `npm run build:win`

### 1.2.4

Purpose: fable5 iteration, SDD closed-loop hardening, IPC safety, E2E packaging validation, and text encoding cleanup.

Main changes:
- Expanded SDD requirements workflows with guarded assistant writeback, plan/Todo synchronization, trace visualization, execution status propagation, and verification evidence handling.
- Hardened renderer-to-main IPC contracts with runtime validation across the remaining exposed channels.
- Improved Workbench structure by extracting UI state, panel routing, composer helpers, command routing, and dispatch request resolution into focused modules.
- Stabilized local-agent execution lifecycle reporting, stdio shutdown on Windows, provider model caching, and runtime event handling.
- Added Electron smoke E2E coverage and CI support for Linux display-server execution through Xvfb.
- Cleaned visible Chinese mojibake from source and tests while preserving runtime detection through escaped patterns.

Fixes:
- Prevents stale SDD assistant responses or verification verdicts from applying to a changed draft.
- Prevents unrelated manual or cross-draft Todos from being overwritten by SDD plan sync.
- Prevents same-thread/cross-thread SDD verification evidence leakage.
- Prevents packaged Electron E2E runs from colliding with the production single-instance lock during tests.
- Removes directly visible garbled Chinese fragments from source files and keeps UTF-8 text readable.

Verification recorded:
- `npm run typecheck`
- `npm run lint` with 0 errors and 33 existing warnings.
- `npm test` with 216 files and 1372 tests.
- `npm run build`
- `npm run test:e2e` with 1 Electron smoke test.
- `npm run build:win`

### 1.2.3

Purpose: fable5 first-stop stability release.

Main changes:
- Stabilized packaged startup by registering workbench IPC before renderer load.
- Restored provider settings, model fetch state, and startup workspace hydration.
- Fixed SDD assistant draft write behavior so full generated documents replace
  drafts while feedback updates one managed section.
- Hardened provider model routing, local-token persistence, terminal PTY reuse,
  quick-complete validation, view restoration, and memory save throttling.
- Replaced the Windows installer asset for the v1.2.3 release.

Verification recorded:
- Added targeted tests for startup IPC order, local-token flush, quick-complete
  validation, terminal PTY behavior, SDD assistant draft writes, view
  restoration, terminal tab state, provider config retries, and memory save
  policy.
- Branch `new` must pass `typecheck`, `lint`, `test`, and `build` before any
  release replacement.

### 1.2.2

Purpose: provider and workspace restoration baseline.

Main changes:
- Improved requirements assistant rendering and workspace restore behavior.
- Preserved provider keys and Windows packaging behavior.
- Continued startup workspace and provider hydration fixes.

Verification recorded:
- Packaged-app checks focused on issues that reproduced after installation.

### 1.2.1

Purpose: local agent and provider usability fixes.

Main changes:
- Improved local agent availability checks and display behavior.
- Adjusted provider/model card display and configured-provider ordering.
- Refined OpenCode/Minimax-Code naming and icon mapping.

Verification recorded:
- UI checks focused on Settings provider/model cards and local-agent selector
  behavior.

### 1.2.0

Purpose: requirements assistant and orchestration feature expansion.

Main changes:
- Added requirements assistant workflows and SDD draft management.
- Expanded prompt optimizer, router, dispatcher, and multi-model loop features.
- Added local agent/provider integration improvements.

Verification recorded:
- Feature checks covered dev-server behavior, requirements assistant flow, and
  provider configuration persistence.

## Release Rules

- Update this file in the same change set as any version bump.
- Add a verification note for every release or patch train.
- Keep generated files out of the repository root; use `output/` for local
  reports, screenshots, and temporary execution artifacts.
