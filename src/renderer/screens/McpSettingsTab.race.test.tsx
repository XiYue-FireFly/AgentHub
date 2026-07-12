// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLang, setLang, type Lang } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'
import { McpSettingsTab } from './McpSettingsTab'

vi.mock('../lib/confirm', () => ({ styledConfirm: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function server(
  name: string,
  id = name.toLowerCase(),
  source: McpServerConfig['source'] = 'workspace'
): McpServerConfig {
  return {
    id,
    name,
    source,
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: [`${name}.js`],
    status: 'ok'
  }
}

function installMcpApi(overrides: {
  list: (workspaceId?: string | null) => Promise<McpServerConfig[]>
  listTools?: (id: string, workspaceId?: string | null) => Promise<McpServerToolsResult>
  scanLocal?: (workspaceId?: string | null) => Promise<McpServerConfig[]>
  upsert?: (input: Partial<McpServerConfig> & { name: string }) => Promise<McpServerConfig>
  setEnabled?: (id: string, enabled: boolean, workspaceId?: string | null) => Promise<McpServerConfig | null>
  test?: (id: string, workspaceId?: string | null) => Promise<McpServerConfig>
  remove?: (id: string) => Promise<boolean>
  setSystemEnabled?: (enabled: boolean) => Promise<void>
}) {
  const mcp = {
    list: vi.fn(overrides.list),
    listTools: vi.fn(overrides.listTools ?? (async () => ({ ok: true, tools: [] }))),
    getSystemConfig: vi.fn(async (): Promise<McpSystemConfig> => ({
      version: 1,
      enabled: true,
      allowedCategories: ['read', 'write', 'exec'],
      defaultPolicy: 'ask',
      timeoutMs: 30_000
    })),
    setSystemEnabled: vi.fn(overrides.setSystemEnabled ?? (async () => undefined)),
    setEnabled: vi.fn(overrides.setEnabled ?? (async () => null)),
    upsert: vi.fn(overrides.upsert ?? (async input => server(input.name))),
    scanLocal: vi.fn(overrides.scanLocal ?? (async () => [])),
    test: vi.fn(overrides.test ?? (async id => server(id, id))),
    remove: vi.fn(overrides.remove ?? (async () => true))
  }

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { mcp } as unknown as Window['electronAPI']
  })
  return mcp
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function resolveDeferred<T>(pending: ReturnType<typeof deferred<T>>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value)
    await pending.promise
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function rejectDeferred<T>(pending: ReturnType<typeof deferred<T>>, error: Error): Promise<void> {
  await act(async () => {
    pending.reject(error)
    await pending.promise.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('McpSettingsTab workspace request ownership', () => {
  let originalElectronApi: PropertyDescriptor | undefined
  let originalLanguage: Lang

  beforeEach(() => {
    originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
    originalLanguage = getLang()
    setLang('en')
    vi.mocked(styledConfirm).mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    setLang(originalLanguage)
    if (originalElectronApi) Object.defineProperty(window, 'electronAPI', originalElectronApi)
    else Reflect.deleteProperty(window, 'electronAPI')
  })

  it('keeps workspace B servers when workspace A resolves last', async () => {
    const workspaceA = deferred<McpServerConfig[]>()
    const workspaceB = deferred<McpServerConfig[]>()
    const mcp = installMcpApi({
      list: workspaceId => workspaceId === 'A' ? workspaceA.promise : workspaceB.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()

    expect(mcp.list).toHaveBeenCalledWith('A')
    expect(mcp.list).toHaveBeenCalledWith('B')

    await resolveDeferred(workspaceB, [server('Workspace B')])
    await resolveDeferred(workspaceA, [server('Workspace A')])

    expect.soft(screen.getByText('Workspace B')).toBeTruthy()
    expect(screen.queryByText('Workspace A')).toBeNull()
  })

  it('does not let a stale workspace A list rejection pollute workspace B', async () => {
    const workspaceA = deferred<McpServerConfig[]>()
    const workspaceB = deferred<McpServerConfig[]>()
    installMcpApi({
      list: workspaceId => workspaceId === 'A' ? workspaceA.promise : workspaceB.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    await resolveDeferred(workspaceB, [server('Workspace B')])
    await rejectDeferred(workspaceA, new Error('workspace A list failed'))

    expect.soft(screen.getByText('Workspace B')).toBeTruthy()
    expect(screen.queryByText('workspace A list failed')).toBeNull()
  })

  it('does not show tools resolved for workspace A after switching to workspace B', async () => {
    const workspaceATools = deferred<McpServerToolsResult>()
    const mcp = installMcpApi({
      list: async workspaceId => [server(workspaceId === 'A' ? 'Workspace A' : 'Workspace B', 'shared-server')],
      listTools: (_id, workspaceId) => workspaceId === 'A'
        ? workspaceATools.promise
        : Promise.resolve({ ok: true, tools: [] })
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    await flushEffects()
    expect(mcp.listTools).toHaveBeenCalledWith('shared-server', 'A')

    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    expect.soft(screen.getByRole('button', { name: 'Tools' })).toBeTruthy()

    await resolveDeferred(workspaceATools, {
      ok: true,
      tools: [{ name: 'workspace-a-tool', description: 'must stay in A' }]
    })

    expect.soft(screen.getByText('Workspace B')).toBeTruthy()
    expect(screen.queryByText('workspace-a-tool')).toBeNull()
  })

  it('keeps workspace B tools loading when workspace A tools reject and finish', async () => {
    const workspaceATools = deferred<McpServerToolsResult>()
    const workspaceBTools = deferred<McpServerToolsResult>()
    const mcp = installMcpApi({
      list: async workspaceId => [server(workspaceId === 'A' ? 'Workspace A' : 'Workspace B', 'shared-server')],
      listTools: (_id, workspaceId) => workspaceId === 'A' ? workspaceATools.promise : workspaceBTools.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    await flushEffects()

    expect(mcp.listTools).toHaveBeenNthCalledWith(1, 'shared-server', 'A')
    expect(mcp.listTools).toHaveBeenNthCalledWith(2, 'shared-server', 'B')
    await rejectDeferred(workspaceATools, new Error('stale workspace A tools failure'))

    expect.soft(screen.queryByText('stale workspace A tools failure')).toBeNull()
    expect(screen.getByText('Loading tools...')).toBeTruthy()
    await resolveDeferred(workspaceBTools, { ok: true, tools: [{ name: 'workspace-b-tool' }] })
  })

  it('does not let a stale add completion reset the workspace B draft or refresh workspace A', async () => {
    const upsertA = deferred<McpServerConfig>()
    const mcp = installMcpApi({
      list: async workspaceId => [server(workspaceId === 'A' ? 'Workspace A' : 'Workspace B')],
      upsert: () => upsertA.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }))
    fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'A pending draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    await resolveDeferred(upsertA, server('Created in A'))

    expect((screen.getByPlaceholderText('Service name') as HTMLInputElement).value).toBe('A pending draft')
    expect(mcp.list).toHaveBeenCalledTimes(2)
    expect(mcp.list).toHaveBeenNthCalledWith(1, 'A')
    expect(mcp.list).toHaveBeenNthCalledWith(2, 'B')
  })

  it('ignores a stale setEnabled rejection after switching to workspace B', async () => {
    const updateA = deferred<McpServerConfig | null>()
    const mcp = installMcpApi({
      list: async workspaceId => [server(workspaceId === 'A' ? 'Workspace A' : 'Workspace B', 'shared-server')],
      setEnabled: () => updateA.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getAllByRole('switch')[1])
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    await rejectDeferred(updateA, new Error('stale setEnabled failure'))

    expect(mcp.setEnabled).toHaveBeenCalledWith('shared-server', false, 'A')
    expect(screen.queryByText('stale setEnabled failure')).toBeNull()
  })

  it('ignores a stale server test rejection after switching to workspace B', async () => {
    const testA = deferred<McpServerConfig>()
    const mcp = installMcpApi({
      list: async workspaceId => [server(workspaceId === 'A' ? 'Workspace A' : 'Workspace B', 'shared-server')],
      test: () => testA.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    await rejectDeferred(testA, new Error('stale test failure'))

    expect(mcp.test).toHaveBeenCalledWith('shared-server', 'A')
    expect(screen.queryByText('stale test failure')).toBeNull()
  })

  it('ignores a stale remove rejection after switching to workspace B', async () => {
    const removeA = deferred<boolean>()
    const mcp = installMcpApi({
      list: async workspaceId => [server(workspaceId === 'A' ? 'Workspace A' : 'Workspace B', 'shared-server', 'user')],
      remove: () => removeA.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    await rejectDeferred(removeA, new Error('stale remove failure'))

    expect(styledConfirm).toHaveBeenCalledTimes(1)
    expect(mcp.remove).toHaveBeenCalledWith('shared-server')
    expect(screen.queryByText('stale remove failure')).toBeNull()
  })

  it('does not continue a workspace scan after unmount', async () => {
    const scanA = deferred<McpServerConfig[]>()
    const mcp = installMcpApi({
      list: async () => [server('Workspace A')],
      scanLocal: () => scanA.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Scan local' }))
    await flushEffects()
    view.unmount()
    await resolveDeferred(scanA, [server('Scanned A')])

    expect(mcp.scanLocal).toHaveBeenCalledWith('A')
    expect(mcp.list).toHaveBeenCalledTimes(1)
  })

  it('settles a system toggle after unmount without starting workspace work', async () => {
    const toggle = deferred<void>()
    const mcp = installMcpApi({
      list: async () => [server('Workspace A')],
      setSystemEnabled: () => toggle.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    fireEvent.click(screen.getAllByRole('switch')[0])
    await flushEffects()
    view.unmount()
    await resolveDeferred(toggle, undefined)

    expect(mcp.setSystemEnabled).toHaveBeenCalledWith(false)
    expect(mcp.list).toHaveBeenCalledTimes(1)
  })

  it('keeps workspace B loading and ignores workspace A reject and finally', async () => {
    const workspaceA = deferred<McpServerConfig[]>()
    const workspaceB = deferred<McpServerConfig[]>()
    installMcpApi({
      list: workspaceId => workspaceId === 'A' ? workspaceA.promise : workspaceB.promise
    })

    const view = render(<McpSettingsTab workspaceId="A" />)
    await flushEffects()
    view.rerender(<McpSettingsTab workspaceId="B" />)
    await flushEffects()
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true)

    await rejectDeferred(workspaceA, new Error('stale workspace A failure'))

    expect.soft(screen.queryByText('stale workspace A failure')).toBeNull()
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true)

    await resolveDeferred(workspaceB, [server('Workspace B')])
  })
})
