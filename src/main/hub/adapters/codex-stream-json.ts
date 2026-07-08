/* ============================================================
   Codex CLI `exec --json` NDJSON 解析器
   把每行 JSON 事件解析成 AgentHub 的「活动步骤 / 最终内容」。

   契约与 claude-stream-json 保持一致：
   - item.started command_execution   → running 工具步骤
   - item.completed command_execution → done/error 工具步骤
   - item.completed agent_message     → 最终内容
   - 非 JSON 行原样透传，兼容用户把 args 改回纯文本输出
   ============================================================ */

export interface ActivityStepLike {
  id: string
  kind?: 'tool' | 'thinking' | 'text' | 'note'
  tool?: string
  label?: string
  detail?: string
  output?: string
  status: 'running' | 'done' | 'error'
}

export interface ParsedActivity {
  steps?: ActivityStepLike[]
  content?: string
  usage?: any
}

function contentBlockText(block: any): string {
  if (!block) return ''
  if (typeof block === 'string') return block
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  if (block.type === 'output_text' && typeof block.text === 'string') return block.text
  if (typeof block.content === 'string') return block.content
  if (Array.isArray(block.content)) return block.content.map(contentBlockText).join('')
  return ''
}

function agentMessageText(item: any): string {
  if (!item || typeof item !== 'object') return ''
  if (typeof item.text === 'string') return item.text
  if (typeof item.content === 'string') return item.content
  if (Array.isArray(item.content)) return item.content.map(contentBlockText).filter(Boolean).join('\n')
  if (typeof item.message === 'string') return item.message
  if (Array.isArray(item.message?.content)) return item.message.content.map(contentBlockText).filter(Boolean).join('\n')
  return ''
}

function basename(path: string): string {
  if (!path) return ''
  const parts = String(path).split(/[\\/]/)
  return parts[parts.length - 1] || String(path)
}

function oneLine(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function truncate(value: unknown, max: number): string {
  const text = String(value ?? '')
  return text.length > max ? text.slice(0, max) + '…' : text
}

export function codexCommandLabel(command: unknown): string {
  const raw = String(command ?? '').replace(/\s+/g, ' ').trim()
  const quotedExe = raw.match(/^"([^"]+)"\s*(.*)$/)
  if (quotedExe) {
    const exe = basename(quotedExe[1])
    const rest = quotedExe[2]?.trim()
    return `$ ${oneLine(rest ? `${exe} ${rest}` : exe, 72)}`
  }
  return `$ ${oneLine(raw, 72)}`
}

export function parseCodexStreamJsonLine(line: string): ParsedActivity | null {
  const trimmed = (line ?? '').trim()
  if (!trimmed) return null

  let obj: any
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return { content: line.endsWith('\n') ? line : line + '\n' }
  }
  if (!obj || typeof obj !== 'object') return { content: line + '\n' }

  const item = obj.item
  if (!item || typeof item !== 'object') {
    if (obj.type === 'turn.completed' && obj.usage && typeof obj.usage === 'object') {
      return { usage: obj.usage }
    }
    return null
  }

  if (item.type === 'command_execution') {
    if (obj.type === 'item.started') {
      return {
        steps: [{
          id: String(item.id || item.command || 'command'),
          kind: 'tool',
          tool: 'command_execution',
          label: codexCommandLabel(item.command),
          detail: truncate(item.command, 400) || undefined,
          status: 'running'
        }]
      }
    }
    if (obj.type === 'item.completed') {
      const exitCode = typeof item.exit_code === 'number' ? item.exit_code : undefined
      return {
        steps: [{
          id: String(item.id || item.command || 'command'),
          status: exitCode === 0 ? 'done' : exitCode === undefined ? 'done' : 'error',
          output: truncate(item.aggregated_output, 800).trim() || undefined
        }]
      }
    }
  }

  if (obj.type === 'item.completed' && item.type === 'agent_message') {
    const text = agentMessageText(item)
    return text ? { content: text } : null
  }

  return null
}
