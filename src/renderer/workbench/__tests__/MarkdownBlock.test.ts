import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../markdown-renderer'

describe('renderMarkdown', () => {
  it('renders common assistant markdown safely', () => {
    const html = renderMarkdown('根据系统上下文，你是 **pyh20**:\n\n- **Git 用户名**: `pyh20`\n\n```ts\nconst x = 1\n```')

    expect(html).toContain('<strong>pyh20</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>pyh20</code>')
    expect(html).toContain('<pre><code data-lang="ts">const x = 1</code></pre>')
  })

  it('escapes raw html', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;')
  })

  it('renders markdown tables and removes internal placeholders', () => {
    const html = renderMarkdown([
      '| 文件 | 行数 | 问题 |',
      '|---|---:|---|',
      '| @@AGENTHUBTOKEN0@@App.tsx | 120 | 重复渲染 |'
    ].join('\n'))

    expect(html).toContain('<table>')
    expect(html).toContain('<th>文件</th>')
    expect(html).toContain('<td>App.tsx</td>')
    expect(html).not.toContain('AGENTHUBTOKEN')
  })
})
