# Wave4+ Final Report — Headless / Signature / WebDAV

**Date:** 2026-07-10  
**Branch:** `feat/w4-impl`

## Delivered

### 1. Real headless agent execution
- Module: `src/main/runtime/headless-run.ts`
- CLI: `scripts/agenthub-cli.mjs`
  - `run --dry-run` — validate only
  - `run --mock` — offline deterministic agent
  - `run --agent-binary <bin>` — **real oneshot spawn** (stdin prompt)
  - `status --run-id` / `logs --run-id`
- Runs stored under `~/.agenthub/cli-runs/` (or `--runs-dir`)
- Exit codes: 0 / 2 / 3 / 5 (timeout)

### 2. Plugin publisher signatures + marketplace
- `plugin-signature.ts`: ed25519 over `SHA256SUMS`, trust store `~/.agenthub/plugin-trust.json`
- Scan attaches `signature` on `PluginEntry`; invalid signature **disables** plugin
- `plugin-marketplace.ts`: builtin catalog + optional HTTPS remote catalog (host allowlist)
- IPC: `plugins:marketplaceList|Install`, `plugins:trustList|Add|Remove`
- Settings: marketplace card + signature status in plugin list

### 3. WebDAV automatic sync
- `webdav-sync.ts`: HTTPS + Basic auth PUT/GET/PROPFIND
- Push/pull **encrypted** sync envelopes (same crypto as config-sync)
- IPC: `sync:webdavGetConfig|SetConfig|Test|Push|Pull`
- Settings appearance: WebDAV form (save/test/push/pull)
- Password stored via safeStorage when available

## Tests
- `headless-run.test.ts`, `agenthub-cli.test.ts` (mock real run)
- `plugin-signature.test.ts`, `plugin-marketplace.test.ts`
- `webdav-sync.test.ts` (mocked fetch round-trip)
- typecheck + targeted suites green

## Usage

```bash
# Headless mock (CI)
npm run cli -- run --workspace . --prompt "hi" --mock

# Headless real binary
npm run cli -- run --workspace . --prompt "hi" --agent-binary /path/to/agent

# Status / logs
npm run cli -- status --run-id <id>
npm run cli -- logs --run-id <id>
```

## Security notes
- No API keys printed in CLI JSON
- WebDAV password not logged; package passphrase required for push/pull
- Marketplace only HTTPS allowlisted hosts
- Signature ≠ full supply-chain root of trust until publishers are added to trust store
