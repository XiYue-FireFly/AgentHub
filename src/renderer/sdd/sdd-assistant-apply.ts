export const AI_REQUIREMENT_SECTION_TITLE = '## AI 需求整理'

const AI_SECTION_RE = /^##\s+AI\s+需求整理\s*$/m
const LEGACY_FEEDBACK_RE = /^#\s+需求分析反馈\s*$/m

export interface ApplyAssistantRequirementOptions {
  now?: Date
}

export interface AssistantRequirementPreview {
  content: string
  changed: boolean
  added: string[]
  removed: string[]
}

export function cleanAssistantMarkdown(content: string): string {
  const trimmed = content.trim()
  const fullFence = trimmed.match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i)
  if (fullFence) return fullFence[1].trim()

  const embeddedFence = trimmed.match(/```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```/i)
  if (embeddedFence && looksLikeFullRequirementDocument(embeddedFence[1])) {
    return embeddedFence[1].trim()
  }

  return trimmed
}

export function looksLikeFullRequirementDocument(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return false

  const firstLine = normalized.split('\n').find((line) => line.trim())
  if (!firstLine || !/^#(?!#)\s+\S+/.test(firstLine.trim())) return false

  const title = firstLine.replace(/^#\s+/, '').trim()
  if (/需求分析反馈|分析反馈|AI\s*需求整理|当前问题|修改建议/.test(title)) return false

  const levelTwoHeadings = Array.from(normalized.matchAll(/^##\s+(.+)$/gm), (match) => match[1].trim())
  const sectionHits = levelTwoHeadings.filter((heading) =>
    /背景|目标|验收标准|范围|用户故事|功能需求|非功能需求|业务流程|约束|依赖|风险|需求/.test(heading)
  ).length
  const hasRequirementBlock = /^###\s*R-\d+/m.test(normalized)

  return sectionHits >= 2 || hasRequirementBlock
}

export function applyAssistantRequirementResponse(
  current: string,
  response: string,
  options: ApplyAssistantRequirementOptions = {}
): string {
  const cleaned = cleanAssistantMarkdown(response)
  if (!cleaned) return current

  if (looksLikeFullRequirementDocument(cleaned)) {
    return `${cleaned.trimEnd()}\n`
  }

  const timestamp = (options.now ?? new Date()).toLocaleString()
  const section = `${AI_REQUIREMENT_SECTION_TITLE}\n\n> 更新时间：${timestamp}\n\n${cleaned}`
  const currentTrimmed = current.trimEnd()
  const existingSectionStart = findManagedSectionStart(currentTrimmed)

  if (existingSectionStart >= 0) {
    const base = currentTrimmed.slice(0, existingSectionStart).trimEnd()
    return base ? `${base}\n\n${section}\n` : `${section}\n`
  }

  return currentTrimmed ? `${currentTrimmed}\n\n${section}\n` : `${section}\n`
}

export function previewAssistantRequirementResponse(
  current: string,
  response: string,
  options: ApplyAssistantRequirementOptions = {}
): AssistantRequirementPreview {
  const content = applyAssistantRequirementResponse(current, response, options)
  const currentLines = current.split('\n')
  const nextLines = content.split('\n')
  const currentSet = new Set(currentLines)
  const nextSet = new Set(nextLines)
  return {
    content,
    changed: content !== current,
    added: nextLines.filter(line => line.trim() && !currentSet.has(line)),
    removed: currentLines.filter(line => line.trim() && !nextSet.has(line))
  }
}

function findManagedSectionStart(content: string): number {
  const aiSection = AI_SECTION_RE.exec(content)
  if (aiSection) return aiSection.index

  const legacyFeedback = LEGACY_FEEDBACK_RE.exec(content)
  return legacyFeedback ? legacyFeedback.index : -1
}
