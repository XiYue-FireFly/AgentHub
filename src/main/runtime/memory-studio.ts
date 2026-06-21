/**
 * MemoryStudio: enhanced memory management and visualization.
 *
 * Provides memory quality scoring, conflict detection,
 * batch operations, and export capabilities.
 *
 * P4-F3: Memory Studio.
 */

export interface MemoryQualityScore {
  entryId: string
  score: number // 0-100
  reasons: string[]
}

/**
 * Score a memory entry's quality based on content analysis.
 */
export function scoreMemoryQuality(entry: {
  title: string
  summary?: string
  content?: string
  tags?: string[]
  confidence?: number
  category: string
}): MemoryQualityScore {
  const reasons: string[] = []
  let score = 50 // base

  // Title quality
  if (entry.title.length > 5) { score += 10; reasons.push('Good title length') }
  if (entry.title.length > 20) { score += 5; reasons.push('Descriptive title') }

  // Summary quality
  if (entry.summary && entry.summary.length > 20) { score += 10; reasons.push('Has summary') }
  if (entry.summary && entry.summary.length > 80) { score += 5; reasons.push('Detailed summary') }

  // Tags
  if (entry.tags && entry.tags.length > 0) { score += 5; reasons.push('Has tags') }
  if (entry.tags && entry.tags.length >= 3) { score += 5; reasons.push('Well-tagged') }

  // Confidence
  if (entry.confidence && entry.confidence > 0.8) { score += 10; reasons.push('High confidence') }

  // Category value
  if (['preference', 'correction', 'decision'].includes(entry.category)) {
    score += 10; reasons.push('High-value category')
  }

  return { entryId: '', score: Math.min(100, score), reasons }
}

/**
 * Detect conflicting memory entries.
 */
export function detectMemoryConflicts(entries: Array<{ id: string; title: string; summary?: string; category: string }>): Array<{ entryA: string; entryB: string; reason: string }> {
  const conflicts: Array<{ entryA: string; entryB: string; reason: string }> = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j]
      if (a.category === b.category && a.title === b.title) {
        conflicts.push({ entryA: a.id, entryB: b.id, reason: 'Same title and category — possible duplicate' })
      }
    }
  }
  return conflicts
}
