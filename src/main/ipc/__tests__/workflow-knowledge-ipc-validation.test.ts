import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError, type ProjectMapLike } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

const validBackupFilename = 'agenthub-backup-2026-01-01T00-00-00-000Z.json'
const validProjectMap: ProjectMapLike = {
  root: 'C:\\repo',
  nodes: [
    {
      name: 'src',
      path: 'C:\\repo\\src',
      type: 'directory',
      children: [
        {
          name: 'index.ts',
          path: 'C:\\repo\\src\\index.ts',
          type: 'file',
          extension: '.ts',
          sizeBytes: 42,
          language: 'TypeScript'
        }
      ]
    }
  ],
  stats: {
    totalFiles: 1,
    totalDirectories: 1,
    totalSize: 42,
    languages: {
      TypeScript: 1
    }
  }
}

describe('workflow and knowledge IPC runtime validation', () => {
  it('rejects invalid backup filenames before restore/delete side effects', async () => {
    const restoreHandler = vi.fn(async () => ({ restored: [] }))
    const deleteHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('backup:restore', restoreHandler)
    typedHandle('backup:delete', deleteHandler)

    expect(() => electronMock.handlers.get('backup:restore')?.({}, '../agenthub-backup-x.json')).toThrow(
      new IpcPayloadValidationError('backup:restore', 'filename must not contain path separators or traversal')
    )
    expect(() => electronMock.handlers.get('backup:delete')?.({}, 'nested\\agenthub-backup-x.json')).toThrow(
      new IpcPayloadValidationError('backup:delete', 'filename must not contain path separators or traversal')
    )
    expect(() => electronMock.handlers.get('backup:delete')?.({}, 'manual.json')).toThrow(
      new IpcPayloadValidationError('backup:delete', 'filename must be an AgentHub backup JSON filename')
    )

    expect(restoreHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
  })

  it('passes valid backup filenames through unchanged', async () => {
    const handler = vi.fn(async () => ({ restored: ['providers.config.v1'] }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('backup:restore', handler)

    const result = await electronMock.handlers.get('backup:restore')?.({}, validBackupFilename)

    expect(result).toEqual({ restored: ['providers.config.v1'] })
    expect(handler).toHaveBeenCalledWith({}, validBackupFilename)
  })

  it('rejects invalid project map build and search payloads', async () => {
    const buildHandler = vi.fn(async () => null)
    const searchHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('projectMap:build', buildHandler)
    typedHandle('projectMap:search', searchHandler)

    expect(() => electronMock.handlers.get('projectMap:build')?.({}, 123, 4)).toThrow(
      new IpcPayloadValidationError('projectMap:build', 'rootPath must be a string')
    )
    expect(() => electronMock.handlers.get('projectMap:build')?.({}, 'C:\\repo', 1.5)).toThrow(
      new IpcPayloadValidationError('projectMap:build', 'maxDepth must be an integer')
    )
    expect(() => electronMock.handlers.get('projectMap:build')?.({}, 'C:\\repo', 17)).toThrow(
      new IpcPayloadValidationError('projectMap:build', 'maxDepth must be at most 16')
    )
    expect(() => electronMock.handlers.get('projectMap:search')?.({}, { ...validProjectMap, nodes: null }, 'index')).toThrow(
      new IpcPayloadValidationError('projectMap:search', 'map.nodes must be an array')
    )
    expect(() => electronMock.handlers.get('projectMap:search')?.({}, {
      ...validProjectMap,
      nodes: [{ name: 'link', path: 'C:\\repo\\link', type: 'symlink' }]
    }, 'link')).toThrow(
      new IpcPayloadValidationError('projectMap:search', 'map.nodes[0].type must be one of: file, directory')
    )
    expect(() => electronMock.handlers.get('projectMap:search')?.({}, {
      ...validProjectMap,
      stats: { ...validProjectMap.stats, languages: { TypeScript: -1 } }
    }, 'index')).toThrow(
      new IpcPayloadValidationError('projectMap:search', 'map.stats.languages.TypeScript must be at least 0')
    )
    expect(() => electronMock.handlers.get('projectMap:search')?.({}, validProjectMap, 42)).toThrow(
      new IpcPayloadValidationError('projectMap:search', 'query must be a string')
    )

    expect(buildHandler).not.toHaveBeenCalled()
    expect(searchHandler).not.toHaveBeenCalled()
  })

  it('passes valid project map payloads through unchanged', async () => {
    const buildHandler = vi.fn(async () => validProjectMap)
    const searchHandler = vi.fn(async () => validProjectMap.nodes)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('projectMap:build', buildHandler)
    typedHandle('projectMap:search', searchHandler)

    await expect(electronMock.handlers.get('projectMap:build')?.({}, 'C:\\repo', 0)).resolves.toEqual(validProjectMap)
    await expect(electronMock.handlers.get('projectMap:search')?.({}, validProjectMap, '')).resolves.toEqual(validProjectMap.nodes)

    expect(buildHandler).toHaveBeenCalledWith({}, 'C:\\repo', 0)
    expect(searchHandler).toHaveBeenCalledWith({}, validProjectMap, '')
  })

  it('rejects invalid knowledge payloads before side effects', async () => {
    const detectHandler = vi.fn(async () => ({ language: 'unknown' }))
    const summaryHandler = vi.fn(async () => '')
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('knowledge:detectTechStack', detectHandler)
    typedHandle('knowledge:generateSummary', summaryHandler)

    expect(() => electronMock.handlers.get('knowledge:detectTechStack')?.({}, '')).toThrow(
      new IpcPayloadValidationError('knowledge:detectTechStack', 'rootPath must not be empty')
    )
    expect(() => electronMock.handlers.get('knowledge:detectTechStack')?.({}, 'C:\\repo\0')).toThrow(
      new IpcPayloadValidationError('knowledge:detectTechStack', 'rootPath must not contain NUL bytes')
    )
    expect(() => electronMock.handlers.get('knowledge:generateSummary')?.({}, 'C:\\repo', null)).toThrow(
      new IpcPayloadValidationError('knowledge:generateSummary', 'entries must be an array')
    )
    expect(() => electronMock.handlers.get('knowledge:generateSummary')?.({}, 'C:\\repo', [null])).toThrow(
      new IpcPayloadValidationError('knowledge:generateSummary', 'entries[0] must be an object')
    )
    expect(() => electronMock.handlers.get('knowledge:generateSummary')?.({}, 'C:\\repo', [{
      title: 'Architecture',
      content: 123,
      category: 'notes'
    }])).toThrow(
      new IpcPayloadValidationError('knowledge:generateSummary', 'entries[0].content must be a string')
    )
    expect(() => electronMock.handlers.get('knowledge:generateSummary')?.({}, 'C:\\repo', Array.from({ length: 101 }, () => ({
      title: 'Architecture',
      content: '',
      category: 'notes'
    })))).toThrow(
      new IpcPayloadValidationError('knowledge:generateSummary', 'entries must contain at most 100 items')
    )
    expect(() => electronMock.handlers.get('knowledge:generateSummary')?.({}, 'C:\\repo', [{
      title: 'Architecture',
      content: 'x'.repeat(64 * 1024 + 1),
      category: 'notes'
    }])).toThrow(
      new IpcPayloadValidationError('knowledge:generateSummary', 'entries[0].content must be at most 65536 characters')
    )

    expect(detectHandler).not.toHaveBeenCalled()
    expect(summaryHandler).not.toHaveBeenCalled()
  })

  it('passes valid knowledge payloads through unchanged', async () => {
    const detectHandler = vi.fn(async () => ({ language: 'JavaScript/TypeScript', framework: 'React' }))
    const summaryHandler = vi.fn(async () => 'Language: JavaScript/TypeScript')
    const entries = [{ title: 'Architecture', content: '', category: 'notes' }]
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('knowledge:detectTechStack', detectHandler)
    typedHandle('knowledge:generateSummary', summaryHandler)

    await expect(electronMock.handlers.get('knowledge:detectTechStack')?.({}, 'C:\\repo')).resolves.toEqual({
      language: 'JavaScript/TypeScript',
      framework: 'React'
    })
    await expect(electronMock.handlers.get('knowledge:generateSummary')?.({}, 'C:\\repo', entries)).resolves.toBe(
      'Language: JavaScript/TypeScript'
    )

    expect(detectHandler).toHaveBeenCalledWith({}, 'C:\\repo')
    expect(summaryHandler).toHaveBeenCalledWith({}, 'C:\\repo', entries)
  })
})
