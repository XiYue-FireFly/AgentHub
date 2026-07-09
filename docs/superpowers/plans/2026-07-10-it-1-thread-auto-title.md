# IT-1 Plan: Thread auto-title from first prompt

**Goal:** When a workbench thread still has a default/placeholder title, derive a short human title from the first user prompt (Kun/ccgui session UX).

## Approach
1. Pure module `src/main/runtime/thread-auto-title.ts`:
   - `isDefaultThreadTitle(title: string): boolean` — matches empty, "New chat", "新会话", "Untitled", "Thread *", etc.
   - `deriveThreadTitleFromPrompt(prompt: string, maxLen?: number): string` — first line, strip markdown fences noise, collapse whitespace, truncate with ellipsis.
2. Unit tests call real functions (no mocks of SUT).
3. Optional thin helper `maybeAutoTitle(currentTitle, prompt): string | null` returns new title or null if should not rename.
4. Wire: export from runtime; call site from hub-threads create path if trivial, else document helper for renderer `threads:rename` — prefer pure + one integration point if low risk.

## Out of scope
- LLM-generated titles
- i18n of every placeholder in all locales beyond zh/en defaults

## Tests
`src/main/runtime/__tests__/thread-auto-title.test.ts`
