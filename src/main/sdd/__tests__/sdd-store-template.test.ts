import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createSddStore, getDefaultTemplate } from '../sdd-store'

describe('SDD default template selection', () => {
  it('uses the Chinese template for Chinese environments', () => {
    expect(getDefaultTemplate({ LANG: 'zh_CN.UTF-8' }, 'en-US')).toContain('# 未命名需求')
    expect(getDefaultTemplate({ LANG: 'C.UTF-8', LC_ALL: 'zh_CN.UTF-8' }, 'en-US')).toContain('# 未命名需求')
    expect(getDefaultTemplate({}, 'zh-CN')).toContain('# 未命名需求')
  })

  it('uses the English template for non-Chinese environments', () => {
    const template = getDefaultTemplate({ LANG: 'en_US.UTF-8' }, 'en-US')

    expect(template).toContain('# Untitled requirement')
    expect(template).toContain('## Acceptance criteria')
  })
})

describe('SDD draft persistence', () => {
  it('persists the requested title and timestamps in metadata', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-sdd-'))
    const store = createSddStore(workspace)

    const draft = await store.createDraft({ workspaceRoot: workspace, title: 'Checkout Flow' })
    const reloaded = await store.getDraft(draft.id)
    const listed = await store.listDrafts()

    expect(reloaded?.title).toBe('Checkout Flow')
    expect(reloaded?.content.startsWith('# Checkout Flow')).toBe(true)
    expect(reloaded?.createdAt).toBe(draft.createdAt)
    expect(listed[0]?.title).toBe('Checkout Flow')
    expect(listed[0]?.createdAt).toBe(draft.createdAt)
  })

  it('updates draft metadata and trace snapshots with atomic writes', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-sdd-'))
    const store = createSddStore(workspace)
    const draft = await store.createDraft({ workspaceRoot: workspace, title: 'Initial' })

    await store.updateDraft(draft.id, { content: '# Revised\n\nBody' })
    const updated = await store.getDraft(draft.id)
    expect(updated?.title).toBe('Revised')
    expect(new Date(updated?.updatedAt || 0).getTime()).toBeGreaterThanOrEqual(new Date(draft.updatedAt).getTime())

    const trace = {
      draftId: draft.id,
      requirementBlocks: [],
      planItems: [],
      coverage: {},
      derivedStatuses: {},
      uncoveredRequirementIds: [],
      timestamp: new Date().toISOString()
    }
    await store.saveTrace(draft.id, trace)
    await expect(store.getTrace(draft.id)).resolves.toEqual(trace)
  })

  it('preserves title and createdAt when only design context changes', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-sdd-'))
    const store = createSddStore(workspace)
    const draft = await store.createDraft({ workspaceRoot: workspace, title: 'Context Only' })

    await store.updateDraft(draft.id, {
      designContext: {
        designType: 'product',
        brandColor: '#2563eb',
        tone: ['professional']
      }
    })
    const updated = await store.getDraft(draft.id)

    expect(updated?.title).toBe('Context Only')
    expect(updated?.createdAt).toBe(draft.createdAt)
    expect(updated?.designContext?.designType).toBe('product')
    expect(updated?.designContext?.brandColor).toBe('#2563eb')
  })

  it.each(['deleted', 'never-created'] as const)('rejects updates for a %s draft instead of creating it', async state => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-sdd-'))
    const store = createSddStore(workspace)
    const draftId = state === 'deleted'
      ? (await store.createDraft({ workspaceRoot: workspace, title: 'Temporary' })).id
      : 'missing-draft'
    if (state === 'deleted') await store.deleteDraft(draftId)

    await expect(store.updateDraft(draftId, { content: '# Must not exist' })).rejects.toThrow(`Failed to update draft ${draftId}`)
    await expect(store.getDraft(draftId)).resolves.toBeNull()
  })
})
