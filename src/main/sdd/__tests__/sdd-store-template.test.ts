import { describe, expect, it } from 'vitest'
import { getDefaultTemplate } from '../sdd-store'

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
