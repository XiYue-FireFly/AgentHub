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
  if (embeddedFence) {
    const fencedCore = extractCoreRequirementMarkdown(embeddedFence[1])
    if (fencedCore && looksLikeFullRequirementDocument(fencedCore)) return fencedCore
  }

  return trimmed
}

export function extractCoreRequirementMarkdown(content: string): string | null {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return null
  if (looksLikeFullRequirementDocument(normalized)) return normalized

  const lines = normalized.split('\n')
  const markerIndex = lines.findIndex(line =>
    /完整.*需求文档|修订后.*需求文档|新版.*需求文档|以下.*需求文档|需求文档如下|revised requirement|complete requirement/i.test(line.trim())
  )
  const candidateStarts = new Set<number>()

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (/^#(?!#)\s+\S+/.test(line)) candidateStarts.add(index)
    if (/^\d+[.、]\s*(背景|目标|范围|验收标准|功能需求|非功能需求|业务流程|假设|约束|风险)\b/.test(line)) candidateStarts.add(index)
    if (
      markerIndex >= 0 &&
      index > markerIndex &&
      index <= markerIndex + 8 &&
      isPlainRequirementTitle(line)
    ) {
      candidateStarts.add(index)
    }
    if (
      isPlainRequirementTitle(line) &&
      lines.slice(index + 1, index + 10).some(nextLine =>
        /^\s*(?:#{1,3}\s+|\d+[.、]\s*)(背景|目标|范围|验收标准|功能需求|非功能需求|业务流程|假设|约束|风险)\b/.test(nextLine.trim())
      )
    ) {
      candidateStarts.add(index)
    }
  }

  const orderedStarts = Array.from(candidateStarts).sort((a, b) => a - b)
  for (const start of orderedStarts) {
    const candidate = trimTrailingAssistantCommentary(lines.slice(start).join('\n').trim())
    if (looksLikeFullRequirementDocument(candidate)) return candidate
  }

  return null
}

export function looksLikeFullRequirementDocument(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return false

  const firstLine = normalized.split('\n').find((line) => line.trim())
  if (!firstLine) return false

  const title = firstLine.replace(/^#+\s+/, '').trim()
  if (/需求分析反馈|分析反馈|AI\s*需求整理|当前问题|修改建议|优化建议|主要修改建议/.test(title)) return false

  const levelTwoHeadings = Array.from(normalized.matchAll(/^##\s+(.+)$/gm), (match) => match[1].trim())
  const sectionHits = levelTwoHeadings.filter((heading) =>
    /背景|目标|验收标准|范围|用户故事|功能需求|非功能需求|业务流程|约束|依赖|风险|需求/.test(heading)
  ).length
  const numberedSectionHits = Array.from(normalized.matchAll(/^\d+[.、]\s*(.+)$/gm), (match) => match[1].trim())
    .filter((heading) => /背景|目标|验收标准|范围|用户故事|功能需求|非功能需求|业务流程|约束|依赖|风险|假设|需求/.test(heading))
    .length
  const hasRequirementBlock = /^###\s*R-\d+/m.test(normalized)
  const hasChecklist = /^\s*(?:-\s*)?\[\s?[xX]?\s?\]\s+\S+/m.test(normalized)
  const hasMarkdownTitle = /^#(?!#)\s+\S+/.test(firstLine.trim())
  const hasPlainTitle = isPlainRequirementTitle(firstLine.trim())
  const sectionCount = sectionHits + numberedSectionHits

  if (hasRequirementBlock) return true
  if (hasMarkdownTitle) return sectionCount >= 2 || (sectionCount >= 1 && hasChecklist)
  if (hasPlainTitle) return sectionCount >= 2 || (sectionCount >= 1 && hasChecklist)
  if (/^\d+[.、]\s+\S+/.test(firstLine.trim())) return numberedSectionHits >= 2 && hasChecklist
  return false
}

export function applyAssistantRequirementResponse(
  current: string,
  response: string,
  options: ApplyAssistantRequirementOptions = {}
): string {
  const cleaned = extractCoreRequirementMarkdown(cleanAssistantMarkdown(response)) ?? cleanAssistantMarkdown(response)
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

function isPlainRequirementTitle(line: string): boolean {
  const normalized = line.trim()
  if (!normalized || normalized.length > 100) return false
  if (/^[#>\-\[\]`]|^\d+[.、]/.test(normalized)) return false
  if (/[。！？.!?：:]$/.test(normalized)) return false
  if (/建议|问题|分析|总结|说明|如下|基于以上/.test(normalized)) return false
  return /需求|系统|平台|应用|产品|项目|V\d|v\d|PRD|文档/.test(normalized)
}

function trimTrailingAssistantCommentary(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const trailingMarkerIndex = lines.findIndex((line, index) =>
    index > 0 && /^(以上|这样|如果你|需要我|后续我可以)/.test(line.trim())
  )
  if (trailingMarkerIndex > 0) return lines.slice(0, trailingMarkerIndex).join('\n').trim()
  return content.trim()
}
