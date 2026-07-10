# AgentHub-v123 Bug 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 BUG_REPORT.md 中识别的 105 个 bug，提升项目安全性、稳定性和性能。

**Architecture:** 按优先级分 5 个阶段执行：安全 Critical → 功能 Critical → High → Medium → Low。每个 bug 修复遵循 TDD 流程：先写失败测试 → 验证失败 → 最小实现 → 验证通过 → 提交。

**Tech Stack:** TypeScript, Electron, React, Zustand, Vitest, Playwright

## Global Constraints

- 所有修改必须通过现有测试（`npm test`）
- 每个 bug 修复必须有对应的测试用例
- 代码修改必须保持向后兼容
- 安全类修复优先级最高
- 每次修改后必须运行完整测试套件

---

## Phase 1: 安全类 Critical Bug 修复

### Task 1.1: M-C1 - workspaceFiles:preview 和 workspaceFiles:read 敏感文件校验

**Files:**
- Modify: `src/main/ipc/workspace-ipc.ts:42-66`
- Test: `src/main/ipc/__tests__/workspace-ipc.test.ts`

**Interfaces:**
- Consumes: `isSensitiveTextFilePath` from `./sensitive-files`
- Produces: 敏感文件访问被拒绝时返回 `{ ok: false, error: 'Access denied: sensitive file' }`

- [ ] **Step 1: Write the failing test**

```typescript
// 在 src/main/ipc/__tests__/workspace-ipc.test.ts 中添加
it('rejects reading sensitive files like .env', async () => {
  const result = await handler({}, 'workspace-id', '.env')
  expect(result.ok).toBe(false)
  expect(result.error).toContain('sensitive file')
})

it('rejects previewing sensitive files like id_rsa', async () => {
  const result = await handler({}, 'workspace-id', '.ssh/id_rsa')
  expect(result.ok).toBe(false)
  expect(result.error).toContain('sensitive file')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/__tests__/workspace-ipc.test.ts`
Expected: FAIL with "sensitive file check not implemented"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/ipc/workspace-ipc.ts
import { isSensitiveTextFilePath } from './sensitive-files'

// 在 workspaceFiles:read 处理器中（第 57-66 行）添加：
typedHandle("workspaceFiles:read", async (_e, workspaceRoot, relPath) => {
  const absPath = validateWorkspacePath(workspaceRoot, relPath)
  if (!absPath) return { ok: false, content: '', path: '', error: 'Invalid path' }
  
  // 新增：敏感文件校验
  if (isSensitiveTextFilePath(absPath)) {
    return { ok: false, content: '', path: '', error: 'Access denied: sensitive file' }
  }
  
  try {
    const content = await fs.readFile(absPath, 'utf-8')
    return { ok: true, content, path: absPath }
  } catch {
    return { ok: false, content: '', path: '', error: 'File not found' }
  }
})

// 在 workspaceFiles:preview 处理器中（第 42-54 行）添加：
typedHandle("workspaceFiles:preview", (_e, filePath, maxLines) => {
  const resolved = resolve(filePath)
  const activeId = getWorkspaceManager()?.getActive()
  const ws = activeId ? getWorkspaceManager()?.getById(activeId) : null
  const root = ws?.rootPath
  const home = app.getPath('home')
  const inWorkspace = root && isPathInsideBase(resolved, root)
  const inHome = isPathInsideBase(resolved, home)
  if (!inWorkspace && !inHome) {
    return { ok: false, error: 'Access denied: path outside allowed directories' }
  }
  
  // 新增：敏感文件校验
  if (isSensitiveTextFilePath(resolved)) {
    return { ok: false, error: 'Access denied: sensitive file' }
  }
  
  return readFilePreview(resolved, maxLines)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/__tests__/workspace-ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/workspace-ipc.ts src/main/ipc/__tests__/workspace-ipc.test.ts
git commit -m "fix(security): add sensitive file check to workspaceFiles:read and workspaceFiles:preview"
```

---

### Task 1.2: M-C2 - conversation:importFile 路径校验

**Files:**
- Modify: `src/main/ipc/conversation-ipc.ts:16`
- Test: `src/main/ipc/__tests__/conversation-ipc.test.ts`

**Interfaces:**
- Consumes: `resolvePathWithinAllowedBases` from `./path-guards`
- Produces: 路径校验失败时返回错误结果

- [ ] **Step 1: Write the failing test**

```typescript
it('rejects importing from outside home directory', async () => {
  const result = await handler({}, 'C:/Windows/System32/config.json')
  expect(result.ok).toBe(false)
  expect(result.error).toContain('Access denied')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/__tests__/conversation-ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/ipc/conversation-ipc.ts
typedHandle("conversation:importFile", (_e, filePath) => {
  const home = app.getPath('home')
  const normalized = resolvePathWithinAllowedBases(filePath, home, [home])
  if (!normalized) {
    return { ok: false, error: 'Access denied: path outside allowed directories' }
  }
  return importConversationFromFile(normalized)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/__tests__/conversation-ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/conversation-ipc.ts src/main/ipc/__tests__/conversation-ipc.test.ts
git commit -m "fix(security): add path validation to conversation:importFile"
```

---

### Task 1.3: M-C3 - plugins:scan 路径校验

**Files:**
- Modify: `src/main/ipc/plugins-ipc.ts:6`
- Test: `src/main/ipc/__tests__/plugins-ipc.test.ts`

**Interfaces:**
- Consumes: `resolveRegisteredWorkspaceRoot` from `./workspace-root-guard`
- Produces: 路径校验失败时返回空数组

- [ ] **Step 1: Write the failing test**

```typescript
it('rejects scanning unregistered workspace paths', async () => {
  const result = await handler({}, 'C:/unregistered/path')
  expect(result).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/__tests__/plugins-ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/ipc/plugins-ipc.ts
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'

typedHandle("plugins:scan", (_e, workspaceRoot) => {
  const root = resolveRegisteredWorkspaceRoot(workspaceRoot)
  if (!root) return []
  return scanPlugins(root)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/__tests__/plugins-ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/plugins-ipc.ts src/main/ipc/__tests__/plugins-ipc.test.ts
git commit -m "fix(security): add workspace root validation to plugins:scan"
```

---

### Task 1.4: M-C4 - knowledge:detectTechStack 和 knowledge:generateSummary 路径校验

**Files:**
- Modify: `src/main/ipc/passthrough-ipc.ts:141-142`
- Test: `src/main/ipc/__tests__/passthrough-ipc.test.ts`

**Interfaces:**
- Consumes: `resolveRegisteredWorkspaceRoot` from `./workspace-root-guard`
- Produces: 路径校验失败时返回空结果

- [ ] **Step 1: Write the failing test**

```typescript
it('rejects detecting tech stack for unregistered paths', async () => {
  const result = await handler({}, 'C:/unregistered/path')
  expect(result).toEqual({})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/__tests__/passthrough-ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/ipc/passthrough-ipc.ts
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'

typedHandle("knowledge:detectTechStack", async (_e, rootPath) => {
  const root = resolveRegisteredWorkspaceRoot(rootPath)
  if (!root) return {}
  return detectTechStack(root)
})

typedHandle("knowledge:generateSummary", async (_e, rootPath, entries) => {
  const root = resolveRegisteredWorkspaceRoot(rootPath)
  if (!root) return ''
  return generateWorkspaceSummary(root, entries)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/__tests__/passthrough-ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/passthrough-ipc.ts src/main/ipc/__tests__/passthrough-ipc.test.ts
git commit -m "fix(security): add workspace root validation to knowledge:detectTechStack and knowledge:generateSummary"
```

---

### Task 1.5: M-C5 - projectMap:build 路径校验

**Files:**
- Modify: `src/main/ipc/workflow-ipc.ts:114`
- Test: `src/main/ipc/__tests__/workflow-ipc.test.ts`

**Interfaces:**
- Consumes: `resolveRegisteredWorkspaceRoot` from `./workspace-root-guard`
- Produces: 路径校验失败时返回空结果

- [ ] **Step 1: Write the failing test**

```typescript
it('rejects building project map for unregistered paths', async () => {
  const result = await handler({}, 'C:/Windows', 3)
  expect(result).toEqual({ nodes: [], stats: { totalFiles: 0, totalDirectories: 0, totalSize: 0, languages: {} } })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/__tests__/workflow-ipc.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/ipc/workflow-ipc.ts
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'

typedHandle("projectMap:build", async (_e, rootPath, maxDepth) => {
  const root = resolveRegisteredWorkspaceRoot(rootPath)
  if (!root) return { nodes: [], stats: { totalFiles: 0, totalDirectories: 0, totalSize: 0, languages: {} } }
  return buildProjectMap(root, maxDepth)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/__tests__/workflow-ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/workflow-ipc.ts src/main/ipc/__tests__/workflow-ipc.test.ts
git commit -m "fix(security): add workspace root validation to projectMap:build"
```

---

### Task 1.6: M-C6 - 备份文件移除明文 API Key

**Files:**
- Modify: `src/main/runtime/backup.ts:66-72`
- Test: `src/main/runtime/__tests__/backup.test.ts`

**Interfaces:**
- Produces: 备份文件保留加密形态的 API key

- [ ] **Step 1: Write the failing test**

```typescript
it('backup does not contain plaintext API keys', async () => {
  const backup = await createBackup(mockStoreGetAll, mockDataDir, '1.0.0')
  const content = readFileSync(join(mockDataDir, 'backups', backup.filename), 'utf-8')
  const data = JSON.parse(content)
  
  // API key 应该是加密形态（包含加密标记），不是明文
  const provider = data.store['providers.config.v1'].providers[0]
  expect(provider.apiKey).toContain('encrypted:')  // 或其他加密标记
  expect(provider.apiKey).not.toBe('sk-plaintext-key')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/runtime/__tests__/backup.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/runtime/backup.ts
// 删除第 67-72 行的解密逻辑，直接使用 store 中的加密形态
for (const key of BACKUP_KEYS) {
  if (allData[key] !== undefined) {
    let value = allData[key]
    // 移除解密逻辑，保留加密形态
    backupStore[key] = value
    includedKeys.push(key)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/runtime/__tests__/backup.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/runtime/backup.ts src/main/runtime/__tests__/backup.test.ts
git commit -m "fix(security): remove plaintext API key from backups, keep encrypted form"
```

---

### Task 1.7: R-C1 - sanitize.ts XSS 过滤增强

**Files:**
- Modify: `src/renderer/lib/sanitize.ts:1-12`
- Test: `src/renderer/lib/__tests__/sanitize.test.ts`

**Interfaces:**
- Produces: 更完整的 HTML 清理

- [ ] **Step 1: Write the failing test**

```typescript
it('blocks img onerror XSS vectors', () => {
  const html = '<img/src=x onerror=alert(1)>'
  const result = sanitizeHtml(html)
  expect(result).not.toContain('onerror')
})

it('blocks formaction XSS vectors', () => {
  const html = '<form><button formaction="javascript:alert(1)">Click</button></form>'
  const result = sanitizeHtml(html)
  expect(result).not.toContain('formaction')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/__tests__/sanitize.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/renderer/lib/sanitize.ts
const DANGEROUS_TAGS = /<(script|iframe|object|embed|form|link|meta|style|base|template|slot)[\s\S]*?>[\s\S]*?<\/\1>|<(script|iframe|object|embed|form|link|meta|style|base|template|slot)[\s\S]*?\/?>/gi
const EVENT_HANDLERS = /[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi  // 修改：支持 / 分隔
const JS_PROTOCOL = /(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi  // 修改：增加 formaction 和 xlink:href
const SVG_EVENTS = /<(?:svg|img|video|audio|source|input|details|select|textarea|button)[^>]*?\son[a-z]+\s*=/gi

export function sanitizeHtml(html: string): string {
  return html
    .replace(DANGEROUS_TAGS, '')
    .replace(EVENT_HANDLERS, '')
    .replace(JS_PROTOCOL, '')
    .replace(SVG_EVENTS, (match) => match.replace(/[\s/]+on[a-z]+/gi, ''))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/__tests__/sanitize.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/sanitize.ts src/renderer/lib/__tests__/sanitize.test.ts
git commit -m "fix(security): enhance XSS sanitization to cover img/onerror, formaction, xlink:href"
```

---

## Phase 1 完成检查点

- [ ] 所有 7 个安全类 Critical bug 已修复
- [ ] 每个修复都有对应的测试用例
- [ ] 所有测试通过（`npm test`）
- [ ] TypeScript 编译通过（`npm run typecheck`）
- [ ] 代码已提交到 glm 分支

---

## Phase 2: 功能类 Critical Bug 修复

### Task 2.1: H-C1 - system-tools hostname 是 Promise

**Files:**
- Modify: `src/main/mcp/system-tools.ts:395`
- Test: `src/main/mcp/__tests__/system-tools.test.ts`

**Interfaces:**
- Consumes: `hostname` from `node:os`
- Produces: hostname 字段为字符串而非 Promise

- [ ] **Step 1: Write the failing test**

```typescript
it('getSystemInfo returns hostname as string, not Promise', () => {
  const result = getSystemInfo()
  expect(typeof result.output).toBe('string')
  const info = JSON.parse(result.output)
  expect(typeof info.hostname).toBe('string')
  expect(info.hostname).not.toBe('{}')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp/__tests__/system-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/mcp/system-tools.ts
import { homedir, platform, arch, release, totalmem, freemem, cpus, hostname } from 'node:os'

// 第 395 行改为：
hostname: hostname(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/mcp/__tests__/system-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/system-tools.ts src/main/mcp/__tests__/system-tools.test.ts
git commit -m "fix(mcp): use synchronous hostname() instead of Promise"
```

---

### Task 2.2: H-C2 - safeDelete 异步删除返回假成功

**Files:**
- Modify: `src/main/mcp/system-tools.ts:266`
- Test: `src/main/mcp/__tests__/system-tools.test.ts`

**Interfaces:**
- Produces: 目录删除同步完成后再返回成功

- [ ] **Step 1: Write the failing test**

```typescript
it('safeDelete actually removes directory before returning success', () => {
  const testDir = join(tmpDir, 'test-delete-dir')
  mkdirSync(testDir)
  writeFileSync(join(testDir, 'file.txt'), 'test')
  
  const result = safeDelete(testDir)
  expect(result.ok).toBe(true)
  expect(existsSync(testDir)).toBe(false)  // 目录应该已被删除
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/mcp/__tests__/system-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/mcp/system-tools.ts
import { existsSync, statSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs'  // 添加 rmdirSync

// 第 266 行改为同步删除：
if (stat.isDirectory()) {
  const entries = readdirSync(targetPath)
  for (const entry of entries) {
    const fullPath = join(targetPath, entry)
    safeDelete(fullPath)
  }
  rmdirSync(targetPath)  // 同步删除，替代异步 import
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/mcp/__tests__/system-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp/system-tools.ts src/main/mcp/__tests__/system-tools.test.ts
git commit -m "fix(mcp): make safeDelete synchronous to avoid false success reports"
```

---

### Task 2.3: H-C3 - TtlLruCache.cleanup 过期条目残留

**Files:**
- Modify: `src/main/cache/lru-cache.ts`, `src/main/cache/ttl-lru-cache.ts:70-81`
- Test: `src/main/cache/__tests__/ttl-lru-cache.test.ts`

**Interfaces:**
- Produces: `peek(key)` 方法，不提升条目位置

- [ ] **Step 1: Write the failing test**

```typescript
it('cleanup removes all expired entries even with many entries', () => {
  const cache = new TtlLruCache<string, number>(100, 100)  // 100ms TTL
  
  // 添加 100 个条目
  for (let i = 0; i < 100; i++) {
    cache.set(`key-${i}`, i)
  }
  
  // 等待过期
  vi.advanceTimersByTime(150)
  
  // cleanup 应该删除所有过期条目
  const removed = cache.cleanup()
  expect(removed).toBe(100)
  expect(cache.size).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/cache/__tests__/ttl-lru-cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/cache/lru-cache.ts
// 添加 peek 方法：
peek(key: K): V | undefined {
  return this.entries.get(key)
}

// src/main/cache/ttl-lru-cache.ts
// 修改 cleanup 方法（第 70-81 行）：
cleanup(): number {
  const now = Date.now()
  let removed = 0
  for (const key of this.cache.keys()) {
    const entry = this.cache.peek(key)  // 使用 peek 代替 get，不提升位置
    if (entry && now > entry.expiresAt) {
      this.cache.delete(key)
      removed++
    }
  }
  return removed
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/cache/__tests__/ttl-lru-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/cache/lru-cache.ts src/main/cache/ttl-lru-cache.ts src/main/cache/__tests__/ttl-lru-cache.test.ts
git commit -m "fix(cache): add peek() to LruCache and use it in TtlLruCache.cleanup to fix incomplete cleanup"
```

---

### Task 2.4: H-C4 - agentLoop 永久替换

**Files:**
- Modify: `src/main/hub/agent-loop-integration.ts:83-92`
- Test: `src/main/hub/__tests__/agent-loop-integration.test.ts`

**Interfaces:**
- Produces: 每次 dispatch 根据 mode 重建 agentLoop 实例

- [ ] **Step 1: Write the failing test**

```typescript
it('dispatch recreates agentLoop when switching from single to auto mode', async () => {
  const integration = new AgentLoopIntegration(mockProviderManager)
  
  // 第一次 single 模式
  await integration.dispatch('test', { mode: 'single', singleAgentId: 'agent1' })
  const singleLoop = integration.agentLoop
  
  // 第二次 auto 模式
  await integration.dispatch('test', { mode: 'auto' })
  const autoLoop = integration.agentLoop
  
  // 应该是不同的实例
  expect(autoLoop).not.toBe(singleLoop)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/hub/__tests__/agent-loop-integration.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/hub/agent-loop-integration.ts
// 删除第 83-92 行的条件判断，改为每次 dispatch 都重建：
this.agentLoop = createAgentLoop({
  maxSteps: options.maxSteps || 10,
  timeoutMs: options.timeoutMs || 120000,
  enableDelegation: mode !== 'single',
  mode: mode === 'single' ? 'single' : 'auto',
  singleAgentId
}, this.providerManager)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/hub/__tests__/agent-loop-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/hub/agent-loop-integration.ts src/main/hub/__tests__/agent-loop-integration.test.ts
git commit -m "fix(hub): always recreate agentLoop instance based on current mode"
```

---

### Task 2.5: W-C1 - ComposerBar 队列消息永久丢失

**Files:**
- Modify: `src/renderer/workbench/ComposerBar.tsx:321-334`
- Test: `src/renderer/workbench/__tests__/ComposerBar.test.tsx`

**Interfaces:**
- Produces: 队列消息在 sending 完成后正确发送

- [ ] **Step 1: Write the failing test**

```typescript
it('queued messages are sent after current message completes', async () => {
  const onSend = vi.fn()
  render(<ComposerBar onSend={onSend} />)
  
  // 发送第一条消息
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first' } })
  fireEvent.click(screen.getByText('Send'))
  
  // 发送第二条消息（应该进入队列）
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second' } })
  fireEvent.click(screen.getByText('Send'))
  
  // 等待第一条发送完成
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledTimes(2)
  })
  
  // 第二条消息应该也被发送
  expect(onSend).toHaveBeenCalledWith('second', expect.anything(), expect.anything())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/workbench/__tests__/ComposerBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/renderer/workbench/ComposerBar.tsx
// 修改第 321-334 行的队列处理 effect：
useEffect(() => {
  if (sending || queue.length === 0) return
  const next = queue[0]
  setText(next.text)
  setAttachments(next.attachments)
  const timer = setTimeout(() => {
    if (next.text.trim()) onSend(next.text.trim(), next.attachments, next.overrides)
    setQueue(prev => prev.slice(1))  // 移到 onSend 之后，避免触发 effect 重运行
  }, 50)
  return () => clearTimeout(timer)
}, [sending, onSend])  // 移除 queue 依赖，用 queueRef 读取
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/workbench/__tests__/ComposerBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/workbench/ComposerBar.tsx src/renderer/workbench/__tests__/ComposerBar.test.tsx
git commit -m "fix(workbench): fix queue message loss by moving setQueue after onSend"
```

---

### Task 2.6: W-C2 - TerminalPanel PTY 进程泄漏

**Files:**
- Modify: `src/renderer/workbench/TerminalPanel.tsx:258-266`
- Test: `src/renderer/workbench/__tests__/TerminalPanel.test.tsx`

**Interfaces:**
- Produces: 切换 tab 时 dispose PTY 进程

- [ ] **Step 1: Write the failing test**

```typescript
it('disposes PTY when switching tabs', async () => {
  const disposeSpy = vi.spyOn(window.electronAPI.terminalPty, 'dispose')
  render(<TerminalPanel workspaceRoot="/test" />)
  
  // 创建新 tab
  fireEvent.click(screen.getByText('New Tab'))
  
  // 切换回第一个 tab
  fireEvent.click(screen.getByText('Terminal 1'))
  
  // 应该 dispose 了前一个 tab 的 PTY
  expect(disposeSpy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/workbench/__tests__/TerminalPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/renderer/workbench/TerminalPanel.tsx
// 添加 ref 保存当前 sessionId
const sessionIdRef = useRef<string>('')

// 修改 effect（第 258-266 行）：
useEffect(() => {
  aliveRef.current = true
  const sessionId = terminalSessionId(workspaceRoot, activeTabId)
  sessionIdRef.current = sessionId
  if (xtermLoaded) attachTerminal(activeTabId)
  return () => {
    aliveRef.current = false
    attachTokenRef.current++
    disposeRenderer()
    // 新增：dispose PTY 进程
    window.electronAPI?.terminalPty?.dispose?.(sessionIdRef.current)
  }
}, [activeTabId, xtermLoaded, attachTerminal, disposeRenderer])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/workbench/__tests__/TerminalPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/workbench/TerminalPanel.tsx src/renderer/workbench/__tests__/TerminalPanel.test.tsx
git commit -m "fix(workbench): dispose PTY process when switching terminal tabs"
```

---

## Phase 2 完成检查点

- [ ] 所有 6 个功能类 Critical bug 已修复
- [ ] 每个修复都有对应的测试用例
- [ ] 所有测试通过（`npm test`）
- [ ] TypeScript 编译通过（`npm run typecheck`）
- [ ] 代码已提交到 glm 分支

---

## Phase 3-5: High/Medium/Low 级别 Bug 修复

（High 24个、Medium 37个、Low 29个 bug 的详细修复计划将在 Phase 1-2 完成后按相同模式补充）

---

## 执行顺序

1. **Phase 1** (7 个安全 Critical) - 最高优先级
2. **Phase 2** (6 个功能 Critical + 2 个渲染 Critical) - 次高优先级
3. **Phase 3** (24 个 High) - 重要功能和性能问题
4. **Phase 4** (37 个 Medium) - 逻辑错误和优化
5. **Phase 5** (29 个 Low) - 代码质量和用户体验

## 测试策略

- **单元测试**: 每个 bug 修复必须有对应的测试用例
- **集成测试**: 修复后运行完整测试套件
- **E2E 测试**: 关键路径修复后运行 Playwright 测试
- **回归测试**: 每个 Phase 完成后运行全面回归测试

## 提交规范

```
fix(<module>): <description>

<optional body explaining the fix>
```

模块名: security, mcp, cache, hub, workbench, renderer, main, ipc, runtime, sdd, memory, routing, agentic
