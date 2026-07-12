import { describe, expect, it } from 'vitest'
import { validateIpcArgs } from '../../../shared/ipc-contract'

describe('SDD IPC validation', () => {
  it('accepts legacy and unified updateDraft calls but validates optional design context', () => {
    expect(validateIpcArgs('sdd:updateDraft', ['E:\\workspace', 'draft-1', '# body'])).toBeNull()
    expect(validateIpcArgs('sdd:updateDraft', [
      'E:\\workspace',
      'draft-1',
      '# body',
      { designType: 'brand', brandColor: '#123456', tone: ['calm'] }
    ])).toBeNull()

    expect(validateIpcArgs('sdd:updateDraft', [
      'E:\\workspace',
      'draft-1',
      '# body',
      'not-a-design-context'
    ])).toMatchObject({
      respond: false,
      error: expect.stringContaining('designContext must be an object')
    })
  })
})
