import { tr } from '../../glass/i18n'

export type ApprovalPolicy = 'allow' | 'ask' | 'deny'
export type ApprovalPreset = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'
export type ApprovalDisplayMode = 'ask' | 'auto' | 'full' | 'read-only' | 'custom'

export interface ApprovalModeConfig {
  preset?: ApprovalPreset
  default: { write?: ApprovalPolicy; exec?: ApprovalPolicy }
}

export function approvalDisplayModeFromConfig(config: ApprovalModeConfig): ApprovalDisplayMode {
  if (config.preset === 'ask-all') return 'ask'
  if (config.preset === 'auto') return 'auto'
  if (config.preset === 'full-access') return 'full'
  if (config.preset === 'read-only') return 'read-only'
  if (config.preset === 'custom') return 'custom'

  const { write, exec } = config.default
  if (write === 'ask' && exec === 'ask') return 'ask'
  if (write === 'ask' && exec === 'allow') return 'auto'
  if (write === 'allow' && exec === 'allow') return 'full'
  if (write === 'deny' && exec === 'deny') return 'read-only'
  return 'custom'
}

export function approvalDisplayModeLabel(mode: ApprovalDisplayMode): string {
  if (mode === 'ask') return tr('请求批准', 'Ask for approval')
  if (mode === 'auto') return tr('替我审批', 'Auto approve')
  if (mode === 'full') return tr('完全访问权限', 'Full access')
  if (mode === 'read-only') return tr('只读', 'Read only')
  return tr('自定义', 'Custom')
}

export function approvalDisplayModeDetail(mode: ApprovalDisplayMode): string {
  if (mode === 'ask') return tr('编辑文件和执行命令时始终询问', 'Ask before writing files or running commands')
  if (mode === 'auto') return tr('仅对检测到的风险操作请求批准', 'Ask only for riskier operations')
  if (mode === 'full') return tr('不经询问即可写入文件和执行命令', 'Allow writes and commands without prompts')
  if (mode === 'read-only') return tr('拒绝写入文件和执行命令', 'Block writes and commands')
  return tr('使用已配置的写入和执行策略', 'Use the configured write and command policies')
}

export function approvalPresetForDisplayMode(mode: Exclude<ApprovalDisplayMode, 'custom'>): ApprovalPreset {
  if (mode === 'ask') return 'ask-all'
  if (mode === 'auto') return 'auto'
  if (mode === 'full') return 'full-access'
  return 'read-only'
}
