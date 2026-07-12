import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  mapAcpUpdate,
  acpBlockText,
  acpToolContent,
  acpPermissionRequest,
  normalizeAcpPermissionOptions,
  acpReadTextFile,
  acpWriteTextFile,
  acpResolveWorkspacePath
} from '../acp-client'

/**
 * ACP 协议核心单测 —— session/update → AgentHub 活动模型的纯函数映射。
 * IO 层（spawn + JSON-RPC 收发）需真实 ACP server，归入端到端联机验证。
 */

describe('acpBlockText', () => {
  it('text 块 / string / 数组', () => {
    expect(acpBlockText({ type: 'text', text: 'hi' })).toBe('hi')
    expect(acpBlockText('plain')).toBe('plain')
    expect(acpBlockText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(acpBlockText({ type: 'image' })).toBe('')
    expect(acpBlockText(null)).toBe('')
  })
})

describe('acpToolContent', () => {
  it('content 块取文本，diff 块取路径+新内容', () => {
    const out = acpToolContent([
      { type: 'content', content: { type: 'text', text: 'found 3 files' } },
      { type: 'diff', path: '/p/config.json', oldText: 'a', newText: '{"debug":true}' }
    ])
    expect(out).toContain('found 3 files')
    expect(out).toContain('/p/config.json')
    expect(out).toContain('{"debug":true}')
  })
  it('非数组 → 空串', () => {
    expect(acpToolContent(undefined)).toBe('')
  })
})

describe('mapAcpUpdate', () => {
  it('agent_message_chunk → content', () => {
    expect(mapAcpUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Paris' } }))
      .toEqual({ content: 'Paris' })
  })

  it('agent_thought_chunk → thinking', () => {
    expect(mapAcpUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }))
      .toEqual({ thinking: 'hmm' })
  })

  it('tool_call → running 步骤，含 tool/label/detail', () => {
    const m = mapAcpUpdate({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Read config', kind: 'read', status: 'pending', rawInput: { filepath: '/x' } })
    expect(m?.steps?.[0]).toMatchObject({ id: 'c1', kind: 'tool', tool: 'read', label: 'Read config', status: 'running' })
    expect(m?.steps?.[0].detail).toContain('/x')
  })

  it('tool_call_update → 状态映射 + 输出', () => {
    const done = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'ok' } }] })
    expect(done?.steps?.[0]).toMatchObject({ id: 'c1', status: 'done', output: 'ok' })
    const failed = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed' })
    expect(failed?.steps?.[0].status).toBe('error')
    const running = mapAcpUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' })
    expect(running?.steps?.[0].status).toBe('running')
  })

  it('缺 toolCallId / 未知类型 / 非对象 → null', () => {
    expect(mapAcpUpdate({ sessionUpdate: 'tool_call' })).toBeNull()
    expect(mapAcpUpdate({ sessionUpdate: 'plan', entries: [] })).toBeNull()
    expect(mapAcpUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'x' } })).toBeNull()
    expect(mapAcpUpdate(null)).toBeNull()
  })
})

describe('acpPermissionRequest', () => {
  it('normalizes permission options in protocol order and bounds untrusted display text', () => {
    const options = normalizeAcpPermissionOptions([
      { optionId: 'deny.exact', name: 'D'.repeat(300), kind: 'deny_once', description: 'x'.repeat(5_000) },
      { optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once', description: 'Allowed once' },
      { optionId: 'deny.exact', name: 'Duplicate' },
      { optionId: '   ', name: 'Blank' },
      ...Array.from({ length: 10 }, (_, index) => ({ optionId: `extra-${index}` }))
    ])

    expect(options.map(option => option.optionId)).toEqual([
      'deny.exact', 'allow.once/exact', 'extra-0', 'extra-1', 'extra-2', 'extra-3', 'extra-4', 'extra-5'
    ])
    expect(options[0]).toMatchObject({ kind: 'deny_once' })
    expect(options[0]?.name).toHaveLength(256)
    expect(options[0]?.description).toHaveLength(4096)
  })

  it('rejects accessor and non-plain protocol options without reading them', () => {
    let reads = 0
    const accessor: Record<string, unknown> = {}
    Object.defineProperty(accessor, 'optionId', {
      enumerable: true,
      get: () => {
        reads++
        return 'allow.once/exact'
      }
    })
    const inherited = Object.create({ optionId: 'allow.once/inherited' })

    expect(normalizeAcpPermissionOptions([accessor, inherited])).toEqual([])
    expect(reads).toBe(0)
  })

  it('rejects oversized protocol option IDs without truncating them', () => {
    const oversizedId = 'x'.repeat(1024 * 1024)

    expect(normalizeAcpPermissionOptions([
      { optionId: oversizedId, kind: 'allow_once' }
    ])).toEqual([])
  })

  it('carries normalized ACP protocol options to the permission handler', () => {
    const req = acpPermissionRequest({
      options: [
        { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
        { optionId: 'allow.once/exact', name: 'Allow', kind: 'allow_once' }
      ],
      toolCall: { name: 'run_command', rawInput: { command: 'npm test' } }
    })

    expect(req.options).toEqual([
      { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
      { optionId: 'allow.once/exact', name: 'Allow', kind: 'allow_once' }
    ])
  })

  it('maps shell/command permission requests to exec', () => {
    const req = acpPermissionRequest({
      sessionId: 's1',
      toolCall: { kind: 'terminal', title: 'Run tests', rawInput: { command: 'npm test' } }
    })

    expect(req.tool).toBe('exec')
    expect(req.toolName).toBe('terminal')
    expect(req.label).toBe('Run tests')
    expect(req.detail).toBe('npm test')
  })

  it('maps edit/write permission requests to write', () => {
    const req = acpPermissionRequest({
      toolCall: { name: 'edit_file', title: 'Edit config', input: { path: 'config.json', newText: '{}' } }
    })

    expect(req.tool).toBe('write')
    expect(req.toolName).toBe('edit_file')
    expect(req.detail).toBe('config.json')
  })

  it('leaves read-only permission requests unguarded', () => {
    const req = acpPermissionRequest({
      toolCall: { kind: 'read', title: 'Read README', input: { path: 'README.md' } }
    })

    expect(req.tool).toBeNull()
    expect(req.toolName).toBe('read')
  })

  it('maps snake_case destructive ACP tool names to write', () => {
    for (const name of ['delete_file', 'move_file', 'rename_file']) {
      const req = acpPermissionRequest({
        toolCall: { name, title: name, input: { path: 'src/app.ts' } }
      })

      expect(req.tool).toBe('write')
      expect(req.toolName).toBe(name)
    }
  })

  it('maps chmod and mkdir style ACP tool names to write', () => {
    for (const name of ['chmod', 'mkdir', 'create_directory']) {
      const req = acpPermissionRequest({
        toolCall: { name, title: name, input: { path: 'scripts' } }
      })

      expect(req.tool).toBe('write')
    }
  })

  it('maps run_command with nested rawInput to exec and exposes args', () => {
    const req = acpPermissionRequest({
      toolCall: { name: 'run_command', title: 'Run command', rawInput: { command: 'npm test' } }
    })

    expect(req.tool).toBe('exec')
    expect(req.detail).toBe('npm test')
    expect(req.args).toEqual({ command: 'npm test' })
  })

  it('marks unclassified permission requests as not read-only', () => {
    const req = acpPermissionRequest({
      toolCall: { name: 'custom_plugin_action', input: { target: 'workspace' } }
    })

    expect(req.tool).toBeNull()
    expect(req.readOnly).toBe(false)
  })
})

describe('AcpClient permission request handling', () => {
  const writeTextFileOptions = [
    { optionId: 'agenthub.acp.fs.write_text_file.deny', name: 'Deny', kind: 'deny_once' },
    { optionId: 'agenthub.acp.fs.write_text_file.allow_once', name: 'Allow once', kind: 'allow_once' }
  ]

  async function invokePermission(client: any, params: any) {
    const responses: any[] = []
    vi.spyOn(client, 'respond').mockImplementation((...args: unknown[]) => {
      responses.push(args[1])
    })
    await client.handlePermissionRequest({ id: 7, method: 'session/request_permission', params })
    return responses.at(-1)
  }

  it('cancels permission requests without an active session handler instead of selecting a deny option', async () => {
    const { AcpClient } = await import('../acp-client')
    const client = new AcpClient('fake-acp', [])
    ;(client as any).sessionRoots.set('s1', process.cwd())

    const response = await invokePermission(client as any, {
      sessionId: 's1',
      options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'deny' }],
      toolCall: { name: 'run_command', rawInput: { command: 'npm test' } }
    })

    expect(response).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('returns only the exact option ID selected by an active structured handler', async () => {
    const { AcpClient } = await import('../acp-client')
    const client = new AcpClient('fake-acp', [])
    ;(client as any).sessionRoots.set('s1', process.cwd())
    const handler = vi.fn()
    ;(client as any).promptHandlers.set('s1', { onRequestPermission: handler })

    handler.mockResolvedValueOnce({ outcome: 'selected', optionId: 'allow.once/exact' })
    await expect(invokePermission(client as any, {
      sessionId: 's1',
      options: [{ optionId: 'deny.exact', kind: 'deny_once' }, { optionId: 'allow.once/exact', kind: 'allow_once' }],
      toolCall: { name: 'delete_file', input: { path: 'old.txt' } }
    })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow.once/exact' } })

    handler.mockResolvedValueOnce({ outcome: 'selected', optionId: 'not-offered' })
    await expect(invokePermission(client as any, {
      sessionId: 's1',
      options: [{ optionId: 'deny.exact', kind: 'deny_once' }, { optionId: 'allow.once/exact', kind: 'allow_once' }],
      toolCall: { name: 'delete_file', input: { path: 'old.txt' } }
    })).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('cancels rather than producing a default allow outcome when no protocol options were offered', async () => {
    const { AcpClient } = await import('../acp-client')
    const client = new AcpClient('fake-acp', [])
    ;(client as any).sessionRoots.set('s1', process.cwd())
    ;(client as any).promptHandlers.set('s1', {
      onRequestPermission: vi.fn(async () => ({ outcome: 'selected', optionId: 'allow.once/exact' }))
    })

    await expect(invokePermission(client as any, {
      sessionId: 's1',
      options: [],
      toolCall: { name: 'delete_file', input: { path: 'old.txt' } }
    })).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('does not admit an oversized protocol option to the permission handler', async () => {
    const { AcpClient } = await import('../acp-client')
    const client = new AcpClient('fake-acp', [])
    const handler = vi.fn(async () => ({ outcome: 'selected', optionId: 'x'.repeat(1024 * 1024) }))
    ;(client as any).sessionRoots.set('s1', process.cwd())
    ;(client as any).promptHandlers.set('s1', { onRequestPermission: handler })

    await expect(invokePermission(client as any, {
      sessionId: 's1',
      options: [{ optionId: 'x'.repeat(1024 * 1024), kind: 'allow_once' }],
      toolCall: { name: 'delete_file', input: { path: 'old.txt' } }
    })).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('fails closed for fs writes when a structured handler cancellation is returned', async () => {
    const { AcpClient } = await import('../acp-client')
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const client = new AcpClient('fake-acp', [])
      ;(client as any).sessionRoots.set('s1', root)
      const handler = vi.fn(async () => ({ outcome: 'cancelled' }))
      ;(client as any).promptHandlers.set('s1', {
        onRequestPermission: handler
      })
      const respondError = vi.spyOn(client as any, 'respondError')

      await (client as any).handleWriteTextFileRequest({
        id: 8,
        params: { sessionId: 's1', path: 'blocked.txt', content: 'must not be written' }
      })

      expect(respondError).toHaveBeenCalledWith(8, -32000, 'write_text_file denied by approval policy')
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ options: writeTextFileOptions }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes only after the handler selects the exact scoped allow option', async () => {
    const { AcpClient } = await import('../acp-client')
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const client = new AcpClient('fake-acp', [])
      ;(client as any).sessionRoots.set('s1', root)
      const handler = vi.fn(async () => ({
        outcome: 'selected',
        optionId: 'agenthub.acp.fs.write_text_file.allow_once'
      }))
      ;(client as any).promptHandlers.set('s1', { onRequestPermission: handler })

      await (client as any).handleWriteTextFileRequest({
        id: 9,
        params: { sessionId: 's1', path: 'approved.txt', content: 'written after exact approval' }
      })

      expect(readFileSync(join(root, 'approved.txt'), 'utf-8')).toBe('written after exact approval')
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ options: writeTextFileOptions }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('denies fs writes when the handler selects the offered scoped deny option', async () => {
    const { AcpClient } = await import('../acp-client')
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const client = new AcpClient('fake-acp', [])
      ;(client as any).sessionRoots.set('s1', root)
      ;(client as any).promptHandlers.set('s1', {
        onRequestPermission: vi.fn(async () => ({
          outcome: 'selected',
          optionId: 'agenthub.acp.fs.write_text_file.deny'
        }))
      })
      const respondError = vi.spyOn(client as any, 'respondError')

      await (client as any).handleWriteTextFileRequest({
        id: 11,
        params: { sessionId: 's1', path: 'blocked-deny.txt', content: 'must not be written' }
      })

      expect(respondError).toHaveBeenCalledWith(11, -32000, 'write_text_file denied by approval policy')
      expect(() => readFileSync(join(root, 'blocked-deny.txt'), 'utf-8')).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('denies fs writes when the handler selects an unknown scoped option', async () => {
    const { AcpClient } = await import('../acp-client')
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const client = new AcpClient('fake-acp', [])
      ;(client as any).sessionRoots.set('s1', root)
      const handler = vi.fn(async () => ({ outcome: 'selected', optionId: 'unknown-write-choice' }))
      ;(client as any).promptHandlers.set('s1', { onRequestPermission: handler })
      const respondError = vi.spyOn(client as any, 'respondError')

      await (client as any).handleWriteTextFileRequest({
        id: 10,
        params: { sessionId: 's1', path: 'blocked-unknown.txt', content: 'must not be written' }
      })

      expect(respondError).toHaveBeenCalledWith(10, -32000, 'write_text_file denied by approval policy')
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ options: writeTextFileOptions }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stops the ACP client and clears session state when a JSON-RPC request times out', async () => {
    vi.useFakeTimers()
    try {
      const { AcpClient } = await import('../acp-client')
      const client = new AcpClient('fake-acp', [], undefined, 25)
      const fakeProc = {
        pid: 0,
        stdin: { write: vi.fn() },
        kill: vi.fn(),
        removeAllListeners: vi.fn()
      }
      ;(client as any).proc = fakeProc
      ;(client as any).promptHandlers.set('s1', {})
      ;(client as any).sessionRoots.set('s1', process.cwd())

      const request = (client as any).request('session/prompt', { sessionId: 's1' })
      const expectation = expect(request).rejects.toThrow(/timed out: session\/prompt/)
      await vi.advanceTimersByTimeAsync(25)

      await expectation
      expect(fakeProc.stdin.write).toHaveBeenCalled()
      expect((client as any).proc).toBeNull()
      expect((client as any).pending.size).toBe(0)
      expect((client as any).promptHandlers.size).toBe(0)
      expect((client as any).sessionRoots.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ACP client fs helpers', () => {
  it('reads text files with 1-based line and limit support', () => {
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const file = join(root, 'notes.txt')
      writeFileSync(file, 'one\ntwo\nthree\nfour', 'utf-8')

      const res = acpReadTextFile(root, { path: file, line: 2, limit: 2 })

      expect(res.ok).toBe(true)
      expect(res.content).toBe('two\nthree')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes text files inside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const res = acpWriteTextFile(root, { path: 'sub/out.txt', content: 'hello' })

      expect(res.ok).toBe(true)
      expect(readFileSync(join(root, 'sub', 'out.txt'), 'utf-8')).toBe('hello')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects paths outside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'agenthub-acp-'))
    try {
      const res = acpResolveWorkspacePath(root, '../escape.txt')

      expect(res.ok).toBe(false)
      expect(res.error).toContain('escapes')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
