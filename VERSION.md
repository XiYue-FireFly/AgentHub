# AgentHub Version Register

Current code version: 1.2.3
Current branch baseline: release-v1.2.3-main
Updated: 2026-07-04

This file is the release discipline record for AgentHub. Before any release,
keep `package.json.version`, `package.json.build.buildVersion`, this current
version, and release notes aligned.

## Release History

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
