/**
 * ExecutionReport: final run summary panel.
 *
 * The report outcome must follow the final agent/turn state. Failed tool
 * attempts are still shown, but they should not mark a completed run as failed.
 */

import React from 'react'
import { tr } from './i18n'

interface ExecutionStats {
  totalTools: number
  successfulTools: number
  failedTools: number
  totalDuration: number
  filesModified: string[]
  testsRun?: { passed: number; failed: number }
  outcome?: 'completed' | 'failed' | 'cancelled'
}

interface ExecutionReportProps {
  stats: ExecutionStats
  className?: string
}

function formatDuration(ms: number): string {
  const value = Math.max(0, Math.round(ms))
  if (value < 1000) return `${value}ms`
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.floor(value / 60000)}m ${((value % 60000) / 1000).toFixed(0)}s`
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12,
      background: 'var(--bg-input, rgba(255,255,255,0.02))', borderRadius: 8,
      border: '1px solid var(--glass-border-default, rgba(255,255,255,0.06))'
    }}>
      <span style={{ color, fontSize: 14, marginBottom: 4, fontWeight: 700 }}>{icon}</span>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function reportTone(stats: ExecutionStats): 'success' | 'warning' | 'failed' | 'cancelled' {
  if (stats.outcome === 'failed') return 'failed'
  if (stats.outcome === 'cancelled') return 'cancelled'
  if ((stats.outcome === 'completed' || !stats.outcome) && stats.failedTools > 0) return 'warning'
  return 'success'
}

function toneColor(tone: ReturnType<typeof reportTone>): string {
  if (tone === 'failed') return 'var(--color-error)'
  if (tone === 'warning') return 'var(--color-warning)'
  if (tone === 'cancelled') return 'var(--tx-3)'
  return 'var(--color-success)'
}

function toneBackground(tone: ReturnType<typeof reportTone>): string {
  if (tone === 'failed') return 'color-mix(in srgb, var(--color-error) 5%, transparent)'
  if (tone === 'warning') return 'color-mix(in srgb, var(--color-warning) 7%, transparent)'
  if (tone === 'cancelled') return 'color-mix(in srgb, var(--tx-3) 6%, transparent)'
  return 'color-mix(in srgb, var(--color-success) 5%, transparent)'
}

function toneBorder(tone: ReturnType<typeof reportTone>): string {
  if (tone === 'failed') return 'color-mix(in srgb, var(--color-error) 20%, transparent)'
  if (tone === 'warning') return 'color-mix(in srgb, var(--color-warning) 26%, transparent)'
  if (tone === 'cancelled') return 'color-mix(in srgb, var(--tx-3) 20%, transparent)'
  return 'color-mix(in srgb, var(--color-success) 20%, transparent)'
}

function toneLabel(tone: ReturnType<typeof reportTone>): string {
  if (tone === 'failed') return tr('失败', 'failed')
  if (tone === 'warning') return tr('完成', 'done')
  if (tone === 'cancelled') return tr('已取消', 'cancelled')
  return tr('成功', 'success')
}

export function ExecutionReport({ stats, className = '' }: ExecutionReportProps) {
  const successRate = stats.totalTools > 0
    ? (stats.successfulTools / stats.totalTools * 100).toFixed(1)
    : '0.0'
  const tone = reportTone(stats)
  const accentColor = toneColor(tone)

  return (
    <div className={className} style={{
      margin: '16px 0',
      padding: 20,
      background: toneBackground(tone),
      border: `1px solid ${toneBorder(tone)}`,
      borderRadius: 12,
      backdropFilter: 'blur(var(--glass-blur, 24px))'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ color: accentColor, fontSize: 20, fontWeight: 700 }}>{tone === 'failed' ? 'X' : tone === 'warning' ? '!' : 'OK'}</span>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--tx-1)', margin: 0 }}>{tr('执行报告', 'Execution report')}</h3>
        <span style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 12px', borderRadius: 20, fontWeight: 600, background: toneBorder(tone), color: accentColor }}>
          {toneLabel(tone)}
        </span>
      </div>

      {tone === 'warning' && (
        <div style={{ margin: '-8px 0 16px', color: 'var(--tx-2)', fontSize: 12 }}>
          {tr('最终任务已完成，但过程中存在失败尝试。', 'The run completed, but some attempts failed during execution.')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard icon="OK" value={stats.successfulTools} label={tr('成功', 'succeeded')} color="var(--color-success)" />
        <StatCard icon="X" value={stats.failedTools} label={tr('失败尝试', 'failed attempts')} color="var(--color-error)" />
        <StatCard icon="T" value={formatDuration(stats.totalDuration)} label={tr('总耗时', 'duration')} color="var(--color-info)" />
        <StatCard icon="%" value={`${successRate}%`} label={tr('成功率', 'success rate')} color="var(--color-success)" />
      </div>

      {stats.filesModified.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--glass-border-default, rgba(255,255,255,0.06))' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-success)', fontSize: 13, marginBottom: 12 }}>
            {tr(`修改文件 (${stats.filesModified.length}):`, `Modified files (${stats.filesModified.length}):`)}
          </strong>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {stats.filesModified.map((file, index) => (
              <li key={index} style={{ padding: '4px 0', fontSize: 13 }}>
                <code style={{ background: 'var(--bg-code-block, rgba(0,0,0,0.22))', padding: '2px 8px', borderRadius: 4, fontSize: 12, color: 'var(--tx-2)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  {file}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.testsRun && (
        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--glass-border-default, rgba(255,255,255,0.06))' }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-success)', fontSize: 13, marginBottom: 12 }}>
            {tr('测试结果:', 'Test results:')}
          </strong>
          <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {stats.testsRun.passed > 0 && (
              <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                OK {stats.testsRun.passed} passed
              </span>
            )}
            {stats.testsRun.failed > 0 && (
              <span style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 4 }}>
                X {stats.testsRun.failed} failed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export type { ExecutionStats, ExecutionReportProps }
