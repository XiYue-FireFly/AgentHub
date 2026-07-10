/**
 * McpSettingsTab: MCP server management settings panel.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles MCP server CRUD, testing, tool listing, and source display.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Icon, IC, Switch } from '../glass/ui'
import { tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'

function mcpSourceLabel(source: McpServerConfig['source']): string {
  return ({
    workspace: tr('工作目录', 'Workspace'),
    user: tr('手动添加', 'Manual'),
    local: tr('本机配置', 'Local config'),
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    opencode: 'OpenCode',
    ccgui: tr('全局配置', 'Global config'),
    kun: tr('插件目录', 'Plugin folder'),
    ecc: tr('插件目录', 'Plugin folder')
  } as Record<McpServerConfig['source'], string>)[source] || source
}

function mcpStatusLabel(status: string): string {
  if (status === 'ok') return tr('可用', 'OK')
  if (status === 'error') return tr('异常', 'Error')
  return tr('未测试', 'Untested')
}

function dedupeMcpServers(servers: McpServerConfig[]): McpServerConfig[] {
  const out: McpServerConfig[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (const server of servers) {
    const nameKey = server.name.trim().toLowerCase()
    if (seenIds.has(server.id) || seenNames.has(nameKey)) continue
    seenIds.add(server.id)
    seenNames.add(nameKey)
    out.push(server)
  }
  return out
}

export function McpSettingsTab({ workspaceId }: { workspaceId: string | null }) {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', transport: 'stdio' as McpServerConfig['transport'], command: '', args: '', url: '' })
  const [toolsForServer, setToolsForServer] = useState<string | null>(null)
  const [toolsList, setToolsList] = useState<{ name: string; description?: string }[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolsError, setToolsError] = useState<string | null>(null)
  // MCP 系统级控制状态
  const [systemConfig, setSystemConfig] = useState<McpSystemConfig | null>(null)
  const [systemLoading, setSystemLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setServers(dedupeMcpServers(await window.electronAPI.mcp.list(workspaceId)))
      setError(null)
    } catch (err: any) {
      setError(err?.message || tr('加载 MCP 失败', 'Failed to load MCP servers'))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    let alive = true
    refresh().catch(() => {})
    return () => { alive = false }
  }, [refresh])

  // 加载 MCP 系统配置
  useEffect(() => {
    let alive = true
    window.electronAPI.mcp.getSystemConfig().then(config => {
      if (alive) setSystemConfig(config)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const toggleSystemEnabled = async () => {
    if (!systemConfig) return
    setSystemLoading(true)
    try {
      const newEnabled = !systemConfig.enabled
      await window.electronAPI.mcp.setSystemEnabled(newEnabled)
      setSystemConfig({ ...systemConfig, enabled: newEnabled })
    } catch (err: any) {
      setError(err?.message || tr('更新系统配置失败', 'Failed to update system config'))
    } finally {
      setSystemLoading(false)
    }
  }

  const add = async () => {
    if (!draft.name.trim()) return
    try {
      await window.electronAPI.mcp.upsert({
        name: draft.name.trim(),
        transport: draft.transport,
        command: draft.transport === 'stdio' ? draft.command.trim() : undefined,
        args: draft.args.split(/\s+/).map(item => item.trim()).filter(Boolean),
        url: draft.transport !== 'stdio' ? draft.url.trim() : undefined,
        enabled: true
      })
      setDraft({ name: '', transport: 'stdio', command: '', args: '', url: '' })
      setAdding(false)
      await refresh()
    } catch (err: any) {
      setError(err?.message || tr('添加 MCP 失败', 'Failed to add MCP server'))
    }
  }

  const scan = async () => {
    setLoading(true)
    try {
      await window.electronAPI.mcp.scanLocal(workspaceId)
      setServers(dedupeMcpServers(await window.electronAPI.mcp.list(workspaceId)))
      setError(null)
    } catch (err: any) {
      setError(err?.message || tr('扫描 MCP 失败', 'Failed to scan MCP servers'))
    } finally {
      setLoading(false)
    }
  }

  const listToolsRequestId = useRef(0)

  const listTools = async (serverId: string) => {
    if (toolsForServer === serverId) { setToolsForServer(null); return }
    const requestId = ++listToolsRequestId.current
    setToolsForServer(serverId)
    setToolsLoading(true)
    setToolsError(null)
    setToolsList([])
    try {
      const result = await window.electronAPI.mcp.listTools(serverId, workspaceId)
      // Only apply if this is still the latest request
      if (requestId !== listToolsRequestId.current) return
      if (result.ok) setToolsList(result.tools || [])
      else setToolsError(result.error || tr('获取工具列表失败', 'Failed to list tools'))
    } catch (err: any) {
      // Only apply if this is still the latest request
      if (requestId !== listToolsRequestId.current) return
      setToolsError(err?.message || tr('获取工具列表失败', 'Failed to list tools'))
    } finally {
      // Only update loading state if this is still the latest request
      if (requestId === listToolsRequestId.current) setToolsLoading(false)
    }
  }

  const copyCommand = (server: McpServerConfig) => {
    const cmd = server.transport === 'stdio'
      ? [server.command, ...(server.args || [])].filter(Boolean).join(' ')
      : server.url || ''
    navigator.clipboard.writeText(cmd).catch(() => {})
  }

  return (
    <div className="wb-settings-stack wb-mcp-clean">
      {/* MCP 系统级控制卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('MCP 系统底层控制', 'MCP System Control')}</strong>
            <span>{tr('为 Agent 提供全盘文件系统读写、Shell 执行、系统信息查询能力。', 'Provides agents with full disk filesystem read/write, shell execution, and system info queries.')}</span>
          </div>
          <div className="wb-card-actions">
            <Switch
              on={systemConfig?.enabled ?? true}
              onChange={toggleSystemEnabled}
              disabled={systemLoading}
            />
          </div>
        </div>
        {systemConfig && (
          <div className="wb-mcp-clean-stats">
            <div><span>{tr('状态', 'Status')}</span><strong>{systemConfig.enabled ? tr('已启用', 'Enabled') : tr('已禁用', 'Disabled')}</strong></div>
            <div><span>{tr('默认策略', 'Default Policy')}</span><strong>{systemConfig.defaultPolicy}</strong></div>
            <div><span>{tr('超时', 'Timeout')}</span><strong>{Math.round(systemConfig.timeoutMs / 1000)}s</strong></div>
          </div>
        )}
      </section>

      {/* MCP 服务管理卡片 */}
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('MCP 服务', 'MCP services')}</strong>
            <span>{tr('管理本地、工作目录和插件目录中的 MCP 服务，启用后同步给支持工具调用的 Agent。', 'Manage MCP services from local, workspace, and plugin folders; enabled services sync to capable agents.')}</span>
          </div>
          <div className="wb-card-actions">
            <button className="ah-btn sm" onClick={scan} disabled={loading}><Icon d={IC.search} size={13} />{tr('扫描本地', 'Scan local')}</button>
            <button className="ah-btn sm" onClick={refresh} disabled={loading}><Icon d={IC.refresh} size={13} />{tr('刷新', 'Refresh')}</button>
            <button className="ah-btn sm primary" onClick={() => setAdding(open => !open)}><Icon d={IC.plus} size={13} />{adding ? tr('收起', 'Collapse') : tr('添加服务', 'Add service')}</button>
          </div>
        </div>

        <div className="wb-mcp-clean-stats">
          <div><span>{tr('总数', 'Total')}</span><strong>{servers.length}</strong></div>
          <div><span>{tr('已启用', 'Enabled')}</span><strong>{servers.filter(server => server.enabled).length}</strong></div>
          <div><span>{tr('工作目录', 'Workspace')}</span><strong>{workspaceId ? tr('已选择', 'Selected') : tr('未选择', 'None')}</strong></div>
        </div>

        {adding && (
          <div className="wb-mcp-editor wb-mcp-clean-editor">
            <input className="ah-input" placeholder={tr('服务名称', 'Service name')} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            <select className="ah-select" value={draft.transport} onChange={event => setDraft({ ...draft, transport: event.target.value as McpServerConfig['transport'] })}>
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="http">http</option>
            </select>
            {draft.transport === 'stdio' ? (
              <>
                <input className="ah-input mono" placeholder={tr('启动命令', 'Launch command')} value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} />
                <input className="ah-input mono" placeholder={tr('参数', 'Args')} value={draft.args} onChange={event => setDraft({ ...draft, args: event.target.value })} />
              </>
            ) : (
              <input className="ah-input mono wide" placeholder={tr('服务 URL', 'Service URL')} value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} />
            )}
            <button className="ah-btn sm primary" onClick={add}>{tr('添加', 'Add')}</button>
          </div>
        )}

        <div className="wb-mcp-clean-list">
          {servers.map(server => (
            <div key={server.id} className={'wb-mcp-clean-row' + (server.enabled ? ' enabled' : '')}>
              <span className="wb-mcp-clean-mark"><Icon d={IC.link} size={15} /></span>
              <div>
                <strong>{server.name}</strong>
                <small className="mono">{server.transport === 'stdio' ? [server.command, ...(server.args || [])].filter(Boolean).join(' ') : server.url}</small>
                {(server.args?.length || server.env) && <small className="wb-mcp-meta">{server.args?.length ? tr(`${server.args.length} 参数`, `${server.args.length} args`) : ''}{server.env ? ` · ${Object.keys(server.env).length} env` : ''}</small>}
              </div>
              <span className="ah-chip">{mcpSourceLabel(server.source)}</span>
              <span className={'wb-mcp-clean-status ' + (server.status || 'unknown')} title={server.error || ''}>{mcpStatusLabel(server.status || 'unknown')}</span>
               <Switch on={server.enabled} onChange={async value => {
                try {
                  await window.electronAPI.mcp.setEnabled(server.id, value, workspaceId)
                  await refresh()
                } catch (err: any) {
                  setError(err?.message || tr('设置状态失败', 'Failed to set state'))
                }
              }} />
              <span className="wb-card-actions">
                <button className="ah-btn sm" onClick={async () => {
                  try {
                    await window.electronAPI.mcp.test(server.id, workspaceId)
                    await refresh()
                  } catch (err: any) {
                    setError(err?.message || tr('测试失败', 'Test failed'))
                  }
                }}>{tr('测试', 'Test')}</button>
                {server.transport === 'stdio' && <button className="ah-btn sm" onClick={() => listTools(server.id)}>{toolsForServer === server.id ? tr('收起工具', 'Hide tools') : tr('工具列表', 'Tools')}</button>}
                <button className="ah-btn sm" onClick={() => copyCommand(server)}>{tr('复制命令', 'Copy')}</button>
                {server.source === 'user' && <button className="ah-btn sm danger" onClick={async () => {
                  try {
                    const ok = await styledConfirm({ message: tr(`删除 MCP 服务「${server.name}」？`, `Delete MCP service "${server.name}"?`), danger: true })
                    if (!ok) return
                    await window.electronAPI.mcp.remove(server.id)
                    await refresh()
                  } catch (err: any) {
                    setError(err?.message || tr('删除失败', 'Failed to delete'))
                  }
                }}>{tr('删除', 'Delete')}</button>}
              </span>
              {server.error && <small className="wb-mcp-clean-error">{server.error}</small>}
              {toolsForServer === server.id && (
                <div className="wb-mcp-tools-panel">
                  {toolsLoading && <small>{tr('正在获取工具列表...', 'Loading tools...')}</small>}
                  {toolsError && <small className="wb-mcp-clean-error">{toolsError}</small>}
                  {toolsList.length > 0 && (
                    <div className="wb-mcp-tools-list">
                      <small>{tr(`共 ${toolsList.length} 个工具`, `${toolsList.length} tool(s) found`)}</small>
                      {toolsList.map(tool => (
                        <div key={tool.name} className="wb-mcp-tool-item">
                          <strong>{tool.name}</strong>
                          {tool.description && <span>{tool.description.slice(0, 120)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {!toolsLoading && !toolsError && toolsList.length === 0 && (
                    <small>{tr('未发现工具', 'No tools found')}</small>
                  )}
                </div>
              )}
            </div>
          ))}
          {servers.length === 0 && <div className="wb-memory-kun-empty"><Icon d={IC.link} size={24} /><span>{tr('暂无 MCP 服务。', 'No MCP services yet.')}</span></div>}
        </div>
      </section>
      {error && <div className="glass wb-error-text">{error}</div>}
    </div>
  )
}
