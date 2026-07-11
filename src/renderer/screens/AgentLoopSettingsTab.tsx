/**
 * AgentLoopSettingsTab - Agent Loop 配置页面
 *
 * 架构：用户输入 → prompt优化器 → router → 各agent → 输出
 * 使用设置里本地 Agent 的可用状态
 */

import React, { useState, useEffect, useCallback, useId, useMemo } from 'react'
import { Icon, IC } from '../glass/ui'
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'

interface AgentLoopConfig {
  maxSteps: number
  timeoutMs: number
  enableDelegation: boolean
  mode: 'auto' | 'single'
}

interface RouteResult {
  taskType: string
  selectedAgent: string
  confidence: number
  reasoning: string
  suggestedRole: string
}

const ROLE_LABELS: Record<string, { zh: string; en: string }> = {
  orchestrator: { zh: '编排者', en: 'Orchestrator' },
  explorer: { zh: '探索者', en: 'Explorer' },
  reviewer: { zh: '审查者', en: 'Reviewer' },
  implementer: { zh: '实现者', en: 'Implementer' },
  optimizer: { zh: '优化者', en: 'Optimizer' }
}

// Agent 角色映射
const AGENT_DEFAULT_ROLES: Record<string, string> = {
  codex: 'implementer',
  claude: 'orchestrator',
  hermes: 'explorer',
  openclaw: 'implementer',
  marvis: 'explorer',
  'minimax-code': 'implementer',
  gemini: 'explorer',
  codebuddy: 'implementer'
}

export function AgentLoopSettingsTab() {
  const loopConfigLabelPrefix = useId()
  const [config, setConfig] = useState<AgentLoopConfig>({
    maxSteps: 10,
    timeoutMs: 120000,
    enableDelegation: true,
    mode: 'auto'
  })
  const [localAgents, setLocalAgents] = useState<LocalAgentStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testPrompt, setTestPrompt] = useState('')
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [customAgents, setCustomAgents] = useState<Array<{ agentId: string; name: string; role: string; source: 'local' | 'custom' }>>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addMode, setAddMode] = useState<'local' | 'custom'>('local')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<string>('implementer')
  const [customName, setCustomName] = useState('')
  const [customRole, setCustomRole] = useState('implementer')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [configData, agentsData] = await Promise.all([
        window.electronAPI.agentLoop.getConfig(),
        window.electronAPI.localAgents.status()
      ])
      setConfig(configData)
      setLocalAgents(agentsData)
      setError(null)
    } catch (err: any) {
      setError(err?.message || tr('加载配置失败', 'Failed to load config'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    refresh().catch(() => {})
    return () => { alive = false }
  }, [refresh])

  // 只显示已安装的 Agent
  const availableAgents = useMemo(() => {
    return localAgents.filter(agent => agent.installed)
  }, [localAgents])

  // 获取未添加到自定义列表的可用 Agent
  const availableForAdd = useMemo(() => {
    return availableAgents.filter(
      agent => !customAgents.some(c => c.agentId === agent.agentId)
    )
  }, [availableAgents, customAgents])

  const testRoute = async () => {
    if (!testPrompt.trim()) return
    setTestLoading(true)
    try {
      const result = await window.electronAPI.agentLoop.getRouteInfo(testPrompt)
      setRouteResult(result)
    } catch (err) {
      console.error('Route test failed:', err)
    } finally {
      setTestLoading(false)
    }
  }

  // 添加本地 Agent
  const addLocalAgent = () => {
    if (!selectedAgentId) return
    if (customAgents.some(c => c.agentId === selectedAgentId)) return
    const agent = availableAgents.find(a => a.agentId === selectedAgentId)
    const meta = AGENT_META[selectedAgentId]
    setCustomAgents([...customAgents, {
      agentId: selectedAgentId,
      name: meta?.name || agent?.label || selectedAgentId,
      role: selectedRole,
      source: 'local'
    }])
    setSelectedAgentId('')
    setSelectedRole('implementer')
    setShowAddForm(false)
  }

  // 添加自定义 Agent（手动输入）
  const addCustomAgentManual = () => {
    if (!customName.trim()) return
    const agentId = `custom-${Date.now()}`
    setCustomAgents([...customAgents, {
      agentId,
      name: customName.trim(),
      role: customRole,
      source: 'custom'
    }])
    setCustomName('')
    setCustomRole('implementer')
    setShowAddForm(false)
  }

  const removeCustomAgent = (agentId: string) => {
    setCustomAgents(customAgents.filter(a => a.agentId !== agentId))
  }

  // 获取 Agent 的显示信息
  const getAgentDisplay = (agentId: string) => {
    const meta = AGENT_META[agentId]
    const local = localAgents.find(a => a.agentId === agentId)
    return {
      name: meta?.name || local?.label || agentId,
      icon: meta?.icon || 'icons/default.svg',
      color: meta?.color || 'var(--ag-codex)',
      version: local?.version,
      installed: local?.installed || false,
      loginState: local?.loginState || 'unknown'
    }
  }

  return (
    <div className="wb-settings-stack wb-mcp-clean">
      {/* 架构说明卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('Agent Loop 架构', 'Agent Loop Architecture')}</strong>
            <span>{tr('多Agent协作自循环系统', 'Multi-Agent collaboration self-loop system')}</span>
          </div>
        </div>
        <div className="wb-agent-loop-architecture">
          <div className="wb-agent-loop-flow">
            <div className="wb-agent-loop-node">{tr('用户输入', 'Input')}</div>
            <div className="wb-agent-loop-arrow">→</div>
            <div className="wb-agent-loop-node">{tr('Prompt优化', 'Prompt')}</div>
            <div className="wb-agent-loop-arrow">→</div>
            <div className="wb-agent-loop-node">{tr('Router', 'Router')}</div>
            <div className="wb-agent-loop-arrow">→</div>
            <div className="wb-agent-loop-node">{tr('Agents', 'Agents')}</div>
            <div className="wb-agent-loop-arrow">→</div>
            <div className="wb-agent-loop-node">{tr('输出', 'Output')}</div>
          </div>
        </div>
      </section>

      {/* 循环配置卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('循环配置', 'Loop Configuration')}</strong>
            <span>{tr('只读预览：当前版本尚未接入执行配置。', 'Read-only preview: execution settings are not connected in this version.')}</span>
          </div>
        </div>
        <div className="wb-muted-box" role="status">
          {tr(
            '这是只读预览。Agent Loop 执行设置尚未接线，无法在此处修改。',
            'This is a read-only preview. Agent Loop execution settings are not connected yet and cannot be changed here.'
          )}
        </div>
        <div className="wb-mcp-clean-stats">
          <div>
            <span id={`${loopConfigLabelPrefix}-mode`}>{tr('默认模式', 'Default Mode')}</span>
            <output aria-labelledby={`${loopConfigLabelPrefix}-mode`}>
              <strong>{config.mode === 'auto' ? tr('自动路由', 'Auto Route') : tr('单Agent', 'Single Agent')}</strong>
            </output>
          </div>
          <div>
            <span id={`${loopConfigLabelPrefix}-max-steps`}>{tr('最大步数', 'Max Steps')}</span>
            <output aria-labelledby={`${loopConfigLabelPrefix}-max-steps`}><strong>{config.maxSteps}</strong></output>
          </div>
          <div>
            <span id={`${loopConfigLabelPrefix}-timeout`}>{tr('超时(ms)', 'Timeout(ms)')}</span>
            <output aria-labelledby={`${loopConfigLabelPrefix}-timeout`}><strong>{config.timeoutMs} ms</strong></output>
          </div>
          <div>
            <span id={`${loopConfigLabelPrefix}-delegation`}>{tr('启用委托', 'Delegation')}</span>
            <output aria-labelledby={`${loopConfigLabelPrefix}-delegation`}>
              <strong>{config.enableDelegation ? tr('已启用', 'Enabled') : tr('已禁用', 'Disabled')}</strong>
            </output>
          </div>
        </div>
      </section>

      {/* 可用 Agents 卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('可用 Agents', 'Available Agents')}</strong>
            <span>{tr('本地已安装的 Agent', 'Locally installed Agents')} ({availableAgents.length})</span>
          </div>
          <div className="wb-card-actions">
            <button className="ah-btn sm" onClick={refresh} disabled={loading}>
              <Icon d={IC.refresh} size={13} />{tr('刷新', 'Refresh')}
            </button>
            <button className="ah-btn sm primary" onClick={() => setShowAddForm(!showAddForm)}>
              <Icon d={IC.plus} size={13} />{tr('添加Agent', 'Add Agent')}
            </button>
          </div>
        </div>
        {error && <div className="wb-mcp-clean-error">{error}</div>}

        {/* 添加 Agent 表单 */}
        {showAddForm && (
          <div className="wb-mcp-clean-editor wb-agent-loop-add-form">
            {/* 模式切换 */}
            <div className="wb-agent-loop-form-tabs">
              <button
                className={`wb-agent-loop-tab ${addMode === 'local' ? 'active' : ''}`}
                onClick={() => setAddMode('local')}
              >
                {tr('从本地选择', 'From Local')}
              </button>
              <button
                className={`wb-agent-loop-tab ${addMode === 'custom' ? 'active' : ''}`}
                onClick={() => setAddMode('custom')}
              >
                {tr('自定义输入', 'Custom Input')}
              </button>
            </div>

            {/* 本地 Agent 选择 */}
            {addMode === 'local' && (
              <>
                <div className="wb-agent-loop-form-row">
                  <label>{tr('选择 Agent', 'Select Agent')}</label>
                  <select
                    className="ah-select"
                    value={selectedAgentId}
                    onChange={(e) => {
                      setSelectedAgentId(e.target.value)
                      const defaultRole = AGENT_DEFAULT_ROLES[e.target.value] || 'implementer'
                      setSelectedRole(defaultRole)
                    }}
                  >
                    <option value="">{tr('-- 选择可用 Agent --', '-- Select Available Agent --')}</option>
                    {availableForAdd.map(agent => {
                      const meta = AGENT_META[agent.agentId]
                      return (
                        <option key={agent.agentId} value={agent.agentId}>
                          {meta?.name || agent.label} {agent.version ? `(${agent.version})` : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div className="wb-agent-loop-form-row">
                  <label>{tr('选择身份', 'Select Role')}</label>
                  <select
                    className="ah-select"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                  >
                    {Object.entries(ROLE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{tr(label.zh, label.en)}</option>
                    ))}
                  </select>
                </div>
                <div className="wb-agent-loop-form-actions">
                  <button className="ah-btn sm primary" onClick={addLocalAgent} disabled={!selectedAgentId}>
                    {tr('添加', 'Add')}
                  </button>
                  <button className="ah-btn sm" onClick={() => setShowAddForm(false)}>
                    {tr('取消', 'Cancel')}
                  </button>
                </div>
              </>
            )}

            {/* 自定义 Agent 输入 */}
            {addMode === 'custom' && (
              <>
                <div className="wb-agent-loop-form-row">
                  <label>{tr('Agent 名称', 'Agent Name')}</label>
                  <input
                    className="ah-input"
                    placeholder={tr('输入 Agent 名称，如 MyAgent', 'Enter Agent name, e.g. MyAgent')}
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div className="wb-agent-loop-form-row">
                  <label>{tr('选择身份', 'Select Role')}</label>
                  <select
                    className="ah-select"
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                  >
                    {Object.entries(ROLE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{tr(label.zh, label.en)}</option>
                    ))}
                  </select>
                </div>
                <div className="wb-agent-loop-form-actions">
                  <button className="ah-btn sm primary" onClick={addCustomAgentManual} disabled={!customName.trim()}>
                    {tr('添加', 'Add')}
                  </button>
                  <button className="ah-btn sm" onClick={() => setShowAddForm(false)}>
                    {tr('取消', 'Cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Agent 列表 */}
        <div className="wb-mcp-clean-list">
          {availableAgents.length === 0 && !loading && (
            <div className="wb-mcp-clean-empty">
              {tr('未检测到可用的 Agent，请先安装 CLI 工具或配置 API 密钥。', 'No available Agents detected. Please install CLI tools or configure API keys first.')}
            </div>
          )}
          {availableAgents.map(agent => {
            const display = getAgentDisplay(agent.agentId)
            const isCustom = customAgents.some(c => c.agentId === agent.agentId)
            const customRole = customAgents.find(c => c.agentId === agent.agentId)?.role

            return (
              <div key={agent.agentId} className="wb-mcp-clean-row">
                <span className="wb-mcp-clean-mark">
                  <img src={display.icon} alt={display.name} className="wb-agent-icon-img" />
                </span>
                <div>
                  <strong>{display.name}</strong>
                  <small>{ROLE_LABELS[customRole || AGENT_DEFAULT_ROLES[agent.agentId] || 'implementer']?.zh || '实现者'}</small>
                </div>
                <div className="wb-mcp-clean-tags">
                  {agent.protocol && <span className="ah-chip">{agent.protocol}</span>}
                  {agent.loginState === 'ready' && <span className="ah-chip wb-agent-ready">{tr('就绪', 'Ready')}</span>}
                  {agent.loginState === 'needs-login' && <span className="ah-chip wb-agent-need-login">{tr('需登录', 'Need Login')}</span>}
                </div>
                {agent.version && (
                  <span className="ah-chip wb-agent-version">{agent.version}</span>
                )}
                {isCustom && (
                  <button className="ah-btn sm danger" onClick={() => removeCustomAgent(agent.agentId)}>
                    <Icon d={IC.trash} size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* 路由测试卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('路由测试', 'Route Test')}</strong>
            <span>{tr('测试系统如何为你的任务选择 Agent', 'Test how the system selects an Agent for your task')}</span>
          </div>
        </div>

        {/* ComposerBar 风格的输入框 */}
        <div className="wb-route-composer">
          <div className="wb-route-composer-input">
            <textarea
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder={tr('输入你的任务描述，测试 Agent 路由...', 'Enter your task description to test Agent routing...')}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  testRoute()
                }
              }}
            />
          </div>

          {/* 快捷示例 */}
          <div className="wb-route-composer-examples">
            {[
              { text: tr('查找所有 TypeScript 文件', 'Find all TypeScript files'), icon: '🔍' },
              { text: tr('审查代码安全性', 'Review code security'), icon: '👁️' },
              { text: tr('实现登录功能', 'Implement login feature'), icon: '⚒️' },
              { text: tr('优化查询性能', 'Optimize query performance'), icon: '⚡' }
            ].map((example, i) => (
              <button
                key={i}
                className="wb-route-composer-chip"
                onClick={() => setTestPrompt(example.text)}
              >
                <span>{example.icon}</span>
                <span>{example.text}</span>
              </button>
            ))}
          </div>

          {/* 操作栏 */}
          <div className="wb-route-composer-actions">
            <div className="wb-route-composer-hint">
              {tr('Enter 发送，Shift+Enter 换行', 'Enter to send, Shift+Enter for new line')}
            </div>
            <button
              className="wb-route-composer-send"
              onClick={testRoute}
              disabled={testLoading || !testPrompt.trim()}
            >
              {testLoading ? (
                <span className="wb-route-composer-loading">{tr('分析中...', 'Analyzing...')}</span>
              ) : (
                <>
                  <span>{tr('测试路由', 'Test Route')}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 路由结果 - 更直观的展示 */}
        {routeResult && (
          <div className="wb-agent-loop-route-result">
            <div className="wb-route-result-header">
              <span className="wb-route-result-type">{routeResult.taskType}</span>
              <span className="wb-route-result-confidence">
                {tr('置信度', 'Confidence')}: {(routeResult.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="wb-route-result-body">
              <div className="wb-route-result-agent">
                <strong>{tr('选择的 Agent', 'Selected Agent')}:</strong>
                <span className="wb-route-result-agent-name">
                  {(() => {
                    const display = getAgentDisplay(routeResult.selectedAgent)
                    return (
                      <>
                        <img src={display.icon} alt={display.name} className="wb-route-result-agent-icon" />
                        {display.name}
                      </>
                    )
                  })()}
                </span>
              </div>
              <div className="wb-route-result-role">
                <strong>{tr('建议身份', 'Suggested Role')}:</strong>
                <span>{ROLE_LABELS[routeResult.suggestedRole]?.zh || routeResult.suggestedRole}</span>
              </div>
              <div className="wb-route-result-reason">
                <strong>{tr('原因', 'Reasoning')}:</strong>
                <span>{routeResult.reasoning}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 使用说明卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('使用说明', 'Usage Guide')}</strong>
            <span>{tr('如何使用 Agent Loop 系统', 'How to use the Agent Loop system')}</span>
          </div>
        </div>
        <div className="wb-agent-loop-guide">
          <div className="wb-agent-loop-guide-item">
            <span className="wb-agent-loop-guide-step">1</span>
            <div>
              <strong>{tr('自动路由模式', 'Auto Route Mode')}</strong>
              <p>{tr('系统根据关键词自动选择 Agent：', 'System auto-selects Agent by keywords:')}</p>
              <ul>
                <li><code>find/search/explore</code> → {tr('Explorer（搜索专家）', 'Explorer')}</li>
                <li><code>review/check/audit</code> → {tr('Reviewer（审查专家）', 'Reviewer')}</li>
                <li><code>implement/create/build</code> → {tr('Implementer（实现专家）', 'Implementer')}</li>
              </ul>
            </div>
          </div>
          <div className="wb-agent-loop-guide-item">
            <span className="wb-agent-loop-guide-step">2</span>
            <div>
              <strong>{tr('添加 Agent', 'Add Agent')}</strong>
              <p>{tr('点击"添加Agent"按钮，从本地可用的 Agent 中选择，并指定身份（角色）。系统会自动检测本地已安装的 Agent。', 'Click "Add Agent" button, select from locally available Agents, and specify a role. The system auto-detects locally installed Agents.')}</p>
            </div>
          </div>
          <div className="wb-agent-loop-guide-item">
            <span className="wb-agent-loop-guide-step">3</span>
            <div>
              <strong>{tr('路由测试', 'Route Test')}</strong>
              <p>{tr('输入任务描述，测试系统会如何选择 Agent。这可以帮助你理解自动路由的工作方式。', 'Enter a task description to test how the system selects an Agent. This helps you understand how auto-routing works.')}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
