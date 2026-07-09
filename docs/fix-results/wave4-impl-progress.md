# Wave4 Implementation Progress (`feat/w4-impl`)

**Date:** 2026-07-09  
**Branch:** `feat/w4-impl`  
**Plan:** `docs/superpowers/plans/2026-07-09-wave4-impl-plan.md`

## Status

| ID | Item | Status |
|----|------|--------|
| W4-P1 | 插件 SHA256SUMS 完整性校验 + scan `integrity` | **done** |
| W4-P2 | 口令加密配置导出/导入 | **done** |
| W4-P3 | Firefly 内置 ≥3 模板 list/get + RunTimeline 应用 | **done** |
| W4-P4 | `scripts/agenthub-cli.mjs` version/run dry-run | **done** |
| W4-P5 | 关键路径 aria-label + Terminal tablist | **done** |

**整体：全部写完。**

## Implementation notes

### P1
- `verifyPluginIntegrity` in `plugin-manager.ts`
- Scan attaches `integrity` and **disables** on mismatch/missing/error
- Unsigned (no SHA256SUMS) stays enabled for legacy plugins
- Settings plugins list shows integrity status
- Contract: optional `PluginEntryLike.integrity`

### P2
- `config-sync.ts`: scrypt + AES-256-GCM envelope
- IPC: `sync:export|list|preview|import|delete`
- Settings appearance: Config sync / migrate card
- Wrong passphrase does not write keys

### P3
- `firefly-templates.ts`: `firefly-five-role`, `pair-review`, `solo-tdd`
- IPC: `firefly:listTemplates`, `firefly:getTemplate`

### P4
- `scripts/agenthub-cli.mjs` + `npm run cli` / `bin.agenthub-cli`
- `version` + `run --dry-run` workspace validation

### P5
- aria-label on Composer send/stop/attach, Terminal tab actions, Git refresh/close

## Tests added
- `plugin-integrity.test.ts`
- `config-sync.test.ts`
- `firefly-templates.test.ts`
- `agenthub-cli.test.ts`
