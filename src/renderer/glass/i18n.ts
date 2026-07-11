/* ============================================================
   AgentHub — 轻量双语（zh/en）
   tr(zh, en) 按当前语言取值；App 根节点订阅语言变化并重渲染，
   因此组件内直接调用 tr() 即可，同时保留组件本地状态。
   ============================================================ */

import { useSyncExternalStore } from 'react'
import type { AgentUIStatus, TaskUIStatus } from './meta'

export type Lang = 'zh' | 'en'

let lang: Lang = (() => {
  try { return (localStorage.getItem('ah-lang') as Lang) || 'zh' } catch { return 'zh' }
})()

const listeners = new Set<() => void>()

export function getLang(): Lang { return lang }

export function setLang(l: Lang): void {
  lang = l
  try { localStorage.setItem('ah-lang', l) } catch { /* noop */ }
  listeners.forEach(f => f())
}

export function useLang(): Lang {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => lang
  )
}

/** 内联翻译：当前语言为中文返回 zh，否则返回 en */
export function tr(zh: string, en: string): string {
  return lang === 'zh' ? zh : en
}

/* ---------- 状态/模式标签 ---------- */

const STATUS_LABELS: Record<Lang, Record<AgentUIStatus, string>> = {
  zh: { idle: '空闲', busy: '运行中', error: '异常', off: '未启用' },
  en: { idle: 'Idle', busy: 'Busy', error: 'Error', off: 'Off' }
}

export function statusLabel(s: AgentUIStatus): string {
  return STATUS_LABELS[lang][s]
}

const MODE_LABELS: Record<Lang, Record<string, string>> = {
  zh: { auto: '智能路由', broadcast: '广播', chain: '链式', orchestrate: '编排' },
  en: { auto: 'Auto route', broadcast: 'Broadcast', chain: 'Chain', orchestrate: 'Orchestrate' }
}

export function modeLabel(m: string): string {
  return MODE_LABELS[lang][m] ?? m
}

const TASK_ST_LABELS: Record<Lang, Record<TaskUIStatus, string>> = {
  zh: { running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' },
  en: { running: 'Running', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled' }
}

export function taskStatusLabel(s: TaskUIStatus): string {
  return TASK_ST_LABELS[lang][s]
}

/* ---------- Agent 描述 ---------- */

const AGENT_DESC_EN: Record<string, string> = {
  codex: 'Precise coding · debugging · refactors',
  claude: 'Analysis · writing · research',
  hermes: 'Toolchains · system config · commands',
  openclaw: 'Pipelines · deploys · scripted tasks',
  marvis: 'Knowledge base · browser automation · cloud phone',
  'minimax-code': 'Coding agent · OpenCode core'
}

export function agentDesc(id: string, zhDesc: string): string {
  return lang === 'zh' ? zhDesc : (AGENT_DESC_EN[id] ?? zhDesc)
}
