/**
 * SDD Progress Bar - 需求进度条组件
 *
 * 显示需求的完成进度
 */

import React, { useMemo } from 'react'
import { tr } from '../../glass/i18n'
import type { SddRequirementBlock } from '../sdd-draft-store'

interface SddProgressBarProps {
  blocks: SddRequirementBlock[]
}

const STATUS_COLORS: Record<string, string> = {
  verified: 'var(--color-success)',
  done: 'var(--color-info)',
  building: 'var(--color-warning)',
  planned: 'var(--color-purple)',
  draft: 'var(--tx-3)'
}

const STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  verified: { zh: '已验收', en: 'Verified' },
  done: { zh: '已完成', en: 'Done' },
  building: { zh: '开发中', en: 'Building' },
  planned: { zh: '已规划', en: 'Planned' },
  draft: { zh: '草稿', en: 'Draft' }
}

export function SddProgressBar({ blocks }: SddProgressBarProps) {
  const counts = useMemo(() => {
    const result = { verified: 0, done: 0, building: 0, planned: 0, draft: 0 }
    blocks.forEach(b => {
      if (Object.prototype.hasOwnProperty.call(result, b.status)) {
        result[b.status as keyof typeof result]++
      }
    })
    return result
  }, [blocks])

  const total = blocks.length

  if (total === 0) return null

  const completedCount = counts.verified + counts.done
  const completionRate = total > 0 ? (completedCount / total) * 100 : 0

  return (
    <div className="sdd-progress-bar">
      {/* Progress segments */}
      <div className="sdd-progress-segments">
        {(['verified', 'done', 'building', 'planned', 'draft'] as const).map(status => {
          const count = counts[status]
          if (count === 0) return null
          const width = (count / total) * 100
          return (
            <div
              key={status}
              className={`sdd-progress-segment sdd-status-${status}`}
              style={{
                width: `${width}%`,
                backgroundColor: STATUS_COLORS[status]
              }}
              title={`${STATUS_LABELS[status].zh}: ${count}`}
            />
          )
        })}
      </div>

      {/* Labels */}
      <div className="sdd-progress-labels">
        <span className="sdd-progress-rate">
          {tr(`${completionRate.toFixed(0)}% 完成`, `${completionRate.toFixed(0)}% complete`)}
        </span>
        <span className="sdd-progress-count">
          {tr(
            `${completedCount}/${total} 验收`,
            `${completedCount}/${total} verified`
          )}
        </span>
      </div>

      {/* Legend */}
      <div className="sdd-progress-legend">
        {(['verified', 'done', 'building', 'planned', 'draft'] as const).map(status => {
          const count = counts[status]
          if (count === 0) return null
          return (
            <div key={status} className="sdd-legend-item">
              <span
                className="sdd-legend-dot"
                style={{ backgroundColor: STATUS_COLORS[status] }}
              />
              <span className="sdd-legend-label">
                {tr(STATUS_LABELS[status].zh, STATUS_LABELS[status].en)}
              </span>
              <span className="sdd-legend-count">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
