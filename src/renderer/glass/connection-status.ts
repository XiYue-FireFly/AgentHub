import { AGENT_IDS, AGENT_META, AgentUIStatus, BindingDef, ProviderDef } from './meta'

export type ConnectionState = 'usable' | 'busy' | 'error' | 'needs-provider' | 'needs-install' | 'off'
export type SetupTab = 'providers' | 'local-agents' | 'routing' | 'approvals' | 'workspaces' | 'skills' | 'mcp' | 'usage' | 'memory' | 'updates'

export interface ConnectionAction {
  labelZh: string
  labelEn: string
  tab: SetupTab
}

export interface AgentConnectionItem {
  agentId: string
  state: ConnectionState
  status: AgentUIStatus
  titleZh: string
  titleEn: string
  detailZh: string
  detailEn: string
  action: ConnectionAction | null
}

export interface ConnectionSummary {
  items: AgentConnectionItem[]
  counts: {
    usable: number
    busy: number
    error: number
    needsProvider: number
    needsInstall: number
    off: number
  }
  headlineZh: string
  headlineEn: string
  firstAction: ConnectionAction | null
}

const configureProviderAction: ConnectionAction = {
  labelZh: '配置供应商',
  labelEn: 'Configure provider',
  tab: 'providers'
}

const chooseCliAction: ConnectionAction = {
  labelZh: '选择 CLI 路径',
  labelEn: 'Choose CLI path',
  tab: 'local-agents'
}

function providerUsable(provider?: ProviderDef): boolean {
  return !!provider && provider.enabled && !!provider.apiKey
}

function isStdioBinding(binding?: BindingDef): boolean {
  return binding?.protocol === 'stdio-plain' || binding?.protocol === 'stdio-ndjson' || binding?.protocol === 'acp'
}

function stdioReady(binding?: BindingDef): boolean {
  return isStdioBinding(binding) && !!binding?.binary?.trim()
}

function itemForState(
  agentId: string,
  state: ConnectionState,
  status: AgentUIStatus,
  binding?: BindingDef,
  provider?: ProviderDef
): AgentConnectionItem {
  const name = AGENT_META[agentId]?.name ?? agentId
  if (state === 'needs-provider') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 需要 Provider Key`,
      titleEn: `${name} needs a provider key`,
      detailZh: provider
        ? `当前绑定到 ${provider.name}，但该供应商未启用或缺少 API Key。`
        : '当前 HTTP 路由没有可用供应商。',
      detailEn: provider
        ? `It is bound to ${provider.name}, but that provider is disabled or missing an API key.`
        : 'The current HTTP route has no usable provider.',
      action: configureProviderAction
    }
  }
  if (state === 'needs-install') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 未检测到本地 CLI`,
      titleEn: `${name} local CLI not detected`,
      detailZh: binding?.binary
        ? '已选择自定义路径，但当前 Hub 状态仍未就绪。'
        : 'StdIO/ACP 模式需要先安装 CLI，或在本地 Agent 设置里选择可执行文件路径。',
      detailEn: binding?.binary
        ? 'A custom path is selected, but the Hub still does not report it as ready.'
        : 'StdIO/ACP mode needs an installed CLI, or an executable path selected under Local Agents.',
      action: chooseCliAction
    }
  }
  if (state === 'error') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 连接异常`,
      titleEn: `${name} has a connection error`,
      detailZh: '检查 Provider Key、模型绑定或本地 CLI 路径后再试。',
      detailEn: 'Check the provider key, model binding or local CLI path before trying again.',
      action: isStdioBinding(binding) ? chooseCliAction : configureProviderAction
    }
  }
  if (state === 'busy') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 正在运行`,
      titleEn: `${name} is running`,
      detailZh: '这个 Agent 已可用，当前正在处理任务。',
      detailEn: 'This agent is available and currently processing a task.',
      action: null
    }
  }
  if (state === 'usable') {
    return {
      agentId,
      state,
      status,
      titleZh: `${name} 可用`,
      titleEn: `${name} is ready`,
      detailZh: isStdioBinding(binding) ? '本地 CLI 已绑定，可以直接派发任务。' : 'Provider Key 与模型绑定已就绪。',
      detailEn: isStdioBinding(binding) ? 'The local CLI is bound and ready for dispatch.' : 'Provider key and model binding are ready.',
      action: null
    }
  }
  return {
    agentId,
    state,
    status,
    titleZh: `${name} 未启用`,
    titleEn: `${name} is disabled`,
    detailZh: '先完成 Provider 或本地 Agent 路由设置。',
    detailEn: 'Finish provider or local agent routing setup first.',
    action: isStdioBinding(binding) ? chooseCliAction : configureProviderAction
  }
}

export function summarizeAgentConnections({ agents, bindings, providers }: {
  agents: Record<string, { status: AgentUIStatus } | undefined>
  bindings: BindingDef[]
  providers: ProviderDef[]
}): ConnectionSummary {
  const counts = {
    usable: 0,
    busy: 0,
    error: 0,
    needsProvider: 0,
    needsInstall: 0,
    off: 0
  }

  const agentIds = AGENT_IDS.filter(agentId => agents[agentId] || bindings.some(binding => binding.agentId === agentId))

  const items = agentIds.map(agentId => {
    const binding = bindings.find(b => b.agentId === agentId)
    const provider = providers.find(p => p.id === binding?.providerId)
    const status = agents[agentId]?.status ?? 'off'
    let state: ConnectionState

    if (isStdioBinding(binding)) {
      if (!stdioReady(binding)) state = 'needs-install'
      else if (status === 'busy') state = 'busy'
      else if (status === 'error') state = 'error'
      else if (status === 'off') state = 'off'
      else state = 'usable'
    } else if (!binding || !providerUsable(provider)) {
      state = 'needs-provider'
    } else if (status === 'busy') {
      state = 'busy'
    } else if (status === 'error') {
      state = 'error'
    } else if (status === 'off') {
      state = 'off'
    } else {
      state = 'usable'
    }

    if (state === 'needs-provider') counts.needsProvider += 1
    else if (state === 'needs-install') counts.needsInstall += 1
    else counts[state] += 1
    return itemForState(agentId, state, status, binding, provider)
  })

  const firstAction = items.find(item => item.action)?.action ?? null
  return {
    items,
    counts,
    headlineZh: `${counts.usable} 个可用 / ${counts.busy} 个运行中 / ${counts.needsProvider} 个缺 Key / ${counts.needsInstall} 个待安装`,
    headlineEn: `${counts.usable} ready / ${counts.busy} running / ${counts.needsProvider} need keys / ${counts.needsInstall} need installs`,
    firstAction
  }
}

export function firstRunActionForError(error: string | undefined | null): ConnectionAction | null {
  const text = (error || '').toLowerCase()
  if (!text) return null
  if (text.includes('provider') || text.includes('api key') || text.includes('key') || text.includes('鉴权') || text.includes('unauthorized')) {
    return configureProviderAction
  }
  if (text.includes('local install') || text.includes('未检测到') || text.includes('cli') || text.includes('enoent') || text.includes('spawn')) {
    return chooseCliAction
  }
  return null
}
