import React from 'react'
import { tr } from '../../glass/i18n'
import type { SddRequirementBlock, SddTrace } from '../sdd-draft-store'

type PlanItem = SddTrace['planItems'][number]

interface SddTracePanelProps {
  trace?: SddTrace | null
  blocks?: SddRequirementBlock[]
}

const REQUIREMENT_STATUS_LABELS: Record<SddRequirementBlock['status'], { zh: string; en: string }> = {
  draft: { zh: '草稿', en: 'Draft' },
  planned: { zh: '已规划', en: 'Planned' },
  building: { zh: '开发中', en: 'Building' },
  done: { zh: '已完成', en: 'Done' },
  verified: { zh: '已验收', en: 'Verified' }
}

const PLAN_STATUS_LABELS: Record<PlanItem['status'], { zh: string; en: string }> = {
  pending: { zh: '待执行', en: 'Pending' },
  in_progress: { zh: '执行中', en: 'In progress' },
  completed: { zh: '已完成', en: 'Completed' }
}

function statusLabel(status: SddRequirementBlock['status']) {
  const label = REQUIREMENT_STATUS_LABELS[status]
  return tr(label.zh, label.en)
}

function planStatusLabel(status: PlanItem['status']) {
  const label = PLAN_STATUS_LABELS[status]
  return tr(label.zh, label.en)
}

function shortTurnId(turnId: string) {
  return turnId.length > 12 ? `${turnId.slice(0, 12)}...` : turnId
}

function shortCommitSha(sha: string) {
  const clean = sha.trim()
  return clean.length > 12 ? clean.slice(0, 12) : clean
}

function commitTitle(commit: NonNullable<PlanItem['commits']>[number]): string {
  const parts = [
    commit.sha,
    commit.summary,
    commit.turnId ? `turn: ${commit.turnId}` : '',
    commit.files?.length ? `${commit.files.length} changed files` : ''
  ].filter(Boolean)
  return parts.join('\n')
}

function stripCovers(text: string) {
  return text
    .replace(/\s*\(covers?:\s*[^)]+\)\s*$/i, '')
    .replace(/^(T-\d+|P-\d+)\s*[:：]\s+/i, '')
    .trim()
}

function findPlanItemsForBlock(trace: SddTrace, blockId: string): PlanItem[] {
  const coveredIds = new Set(trace.coverage[blockId] ?? [])
  const items: PlanItem[] = []

  for (const item of trace.planItems) {
    if (coveredIds.has(item.id) || item.covers.includes(blockId)) {
      items.push(item)
    }
  }

  return items
}

export function SddTracePanel({ trace, blocks = [] }: SddTracePanelProps) {
  if (!trace) return null

  const displayBlocks = blocks.length > 0 ? blocks : trace.requirementBlocks
  if (displayBlocks.length === 0 && trace.planItems.length === 0) return null

  const coveredCount = displayBlocks.filter(block =>
    findPlanItemsForBlock(trace, block.id).length > 0
  ).length
  const dispatchedCount = trace.planItems.filter(item => Boolean(item.turnId)).length
  const updatedAt = new Date(trace.timestamp)
  const updatedLabel = Number.isNaN(updatedAt.getTime())
    ? trace.timestamp
    : updatedAt.toLocaleString()

  return (
    <section className="sdd-trace-panel" aria-label={tr('需求追踪矩阵', 'Requirement trace matrix')}>
      <div className="sdd-trace-header">
        <div>
          <div className="sdd-trace-title">{tr('追踪矩阵', 'Trace Matrix')}</div>
          <div className="sdd-trace-subtitle">
            {tr(
              `${coveredCount}/${displayBlocks.length} 个需求已覆盖 · ${dispatchedCount} 个任务已派发`,
              `${coveredCount}/${displayBlocks.length} requirements covered · ${dispatchedCount} tasks dispatched`
            )}
          </div>
        </div>
        <span className="sdd-trace-updated">{updatedLabel}</span>
      </div>

      <div className="sdd-trace-list">
        {displayBlocks.map(block => {
          const planItems = findPlanItemsForBlock(trace, block.id)
          const derivedStatus = trace.derivedStatuses[block.id] ?? block.status
          const uncovered = trace.uncoveredRequirementIds.includes(block.id) || planItems.length === 0

          return (
            <div key={block.id} className={`sdd-trace-row ${uncovered ? 'sdd-trace-row-uncovered' : ''}`}>
              <div className="sdd-trace-requirement">
                <span className={`sdd-trace-node sdd-trace-node-${derivedStatus}`} />
                <span className="sdd-trace-req-id">{block.id}</span>
                <span className="sdd-trace-req-title">{block.title}</span>
                <span className={`sdd-trace-status sdd-trace-status-${derivedStatus}`}>
                  {statusLabel(derivedStatus)}
                </span>
              </div>

              <div className="sdd-trace-plan-items">
                {planItems.length > 0 ? planItems.map(item => (
                  <div key={item.id} className="sdd-trace-plan-item">
                    <span className="sdd-trace-plan-id">{item.id}</span>
                    <span className="sdd-trace-plan-text">{stripCovers(item.text)}</span>
                    <span className={`sdd-trace-plan-status sdd-trace-plan-status-${item.status}`}>
                      {planStatusLabel(item.status)}
                    </span>
                    {item.turnId && (
                      <span className="sdd-trace-turn" title={item.turnId}>
                        {tr('Turn', 'Turn')} {shortTurnId(item.turnId)}
                      </span>
                    )}
                    {(item.commits ?? []).map(commit => (
                      <span key={commit.sha} className="sdd-trace-commit" title={commitTitle(commit)}>
                        {tr('Commit', 'Commit')} {shortCommitSha(commit.shortSha || commit.sha)}
                      </span>
                    ))}
                  </div>
                )) : (
                  <div className="sdd-trace-empty-link">
                    {tr('暂无关联计划任务', 'No linked plan item')}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
