import React from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'

interface PanelTitleProps {
  title: string
  subtitle?: string
  onClose: () => void
  onRefresh?: () => void | Promise<void>
  loading?: boolean
}

export function PanelTitle({ title, subtitle, onClose, onRefresh, loading }: PanelTitleProps) {
  return (
    <div className="wb-timeline-head">
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="wb-timeline-head-actions">
        {onRefresh && <button onClick={() => onRefresh()} disabled={loading} title={tr('刷新', 'Refresh')}><Icon d={IC.refresh} size={14} /></button>}
        <button onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
    </div>
  )
}
