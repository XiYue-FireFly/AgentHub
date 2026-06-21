# AgentHub Coding Standards

> Inspired by OpenAI Codex AGENTS.md and CC Switch architecture patterns.

## Module Size Limits

- Target: ≤ 500 lines per module.
- Hard limit: 800 lines. Files exceeding this must be split.
- Current known violations (tracked):
  - `src/main/index.ts`: ~2128 lines — IPC extraction in progress
  - `src/renderer/workbench/WorkbenchLayout.tsx`: ~2333 lines — component extraction in progress
  - `src/renderer/screens/Settings.tsx`: ~2521 lines — sub-tab extraction needed
  - `src/renderer/globals.css`: ~10164 lines — CSS splitting in progress

## TypeScript Conventions

- Strict mode enabled (`strict: true` in tsconfig).
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Use `as const` assertions for literal arrays and objects.
- Prefer explicit return types on exported functions.
- Avoid `any` — use `unknown` and narrow with type guards.
- Prefer `readonly` arrays and properties where mutation is not needed.

## React Conventions

- Functional components only (no class components).
- Custom hooks for stateful logic (prefix with `use`).
- Lazy-load major views with `React.lazy()` + `<Suspense>`.
- Error boundaries wrap each major section.
- Prefer `useCallback`/`useMemo` for expensive computations or stable references.
- No early returns before hooks (React rules of hooks).

## CSS / Styling Conventions

- Design tokens defined in `src/renderer/globals.css` (`:root` variables).
- All colors must use CSS variables — no hardcoded hex/rgba in components.
- Tailwind CSS 4 available for utility classes; semantic styles use custom classes.
- Component-scoped CSS allowed for complex features (prefixed with feature name).
- Dark/light themes via `[data-theme]` attribute selector.

## IPC Conventions

- All IPC handlers registered in `src/main/ipc/` domain modules.
- Payloads validated at boundary (Zod or manual checks).
- Renderer types defined in `src/renderer/vite-env.d.ts` and `src/shared/ipc-types.ts`.
- Preload bridges use `contextBridge.exposeInMainWorld` only.
- No direct `ipcRenderer` usage in renderer — only via `window.electronAPI`.

## Security Rules

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `store:get/set` access controlled by `isStoreKeyAllowed` — no sensitive keys exposed.
- API keys encrypted via Electron `safeStorage` (DPAPI/Keychain/libsecret).
- WebSocket server bound to `127.0.0.1` only, token-authenticated.
- Path traversal checks on all file operations.
- No `eval()` or `Function()` in renderer.

## Git Conventions

- Commit format: `<type>: <description>` (feat/fix/refactor/docs/test/chore/perf/ci).
- No emoji, no "Co-Authored-By", no "Generated with".
- One logical change per commit.
- Run `git diff --check` before committing.

## Testing Conventions

- Vitest for all tests.
- Prefer integration tests over unit tests for agent logic.
- Mock IPC at preload boundary, not internal modules.
- Test files co-located in `__tests__/` directories.
- Target: renderer ≥60% file coverage, main process ≥80% module coverage.

## File Organization

```
src/
├── main/
│   ├── index.ts              # App lifecycle only (window, tray, app events)
│   ├── ipc/                   # IPC handler modules by domain
│   ├── hub/                   # Agent dispatch, routing, registry
│   ├── agentic/               # Tool loop, approval, capabilities
│   ├── runtime/               # Feature modules (git, terminal, mcp, etc.)
│   ├── providers/             # Provider manager, client
│   └── routing/               # Proxy, takeover
├── preload/
│   └── index.ts               # Single preload, typed bridge
├── renderer/
│   ├── main.tsx               # React entry
│   ├── App.tsx                # App shell, state, streaming
│   ├── workbench/             # Workbench components
│   │   ├── views/             # View components (chat, write, tasks)
│   │   ├── panels/            # Panel components (runs, git, browser)
│   │   └── hooks/             # Workbench-specific hooks
│   ├── screens/               # Full-screen views (Settings, Skills, Tasks)
│   ├── glass/                 # Shared glass-design components
│   ├── styles/                # Per-feature CSS files
│   └── globals.css            # Design tokens + Tailwind import only
└── shared/                    # Types/constants shared across processes
    └── ipc-types.ts           # IPC type contracts
```

## Change Size Guidance

- Ideal: < 300 lines per change.
- Acceptable: < 500 lines.
- Requires justification: 500–800 lines.
- Not allowed without explicit approval: > 800 lines.
