import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { tr } from '../glass/i18n'
import { AGENT_META } from '../glass/meta'
import type { AgentUIStatus, BindingDef, ProviderDef } from '../glass/meta'
import { WorkspaceItem } from './types'
import { localAgentLabel, localAgentOptions } from './localAgentOptions'

type ComposerThinkingConfig = { mode: 'off' | 'auto' | 'enabled'; level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; collapseInUI?: boolean; budgetTokens?: number }
type PickerAgentRow =
  | { source: 'local-agent'; id: string; label: string; subtitle: string; agentId: string }
  | { source: 'provider-agent'; id: string; label: string; subtitle: string; providerId: string; modelCount: number }
type PickerModelRow = { source: 'provider-model'; id: string; label: string; subtitle: string; providerId: string; modelId: string; contextWindow?: number }

export function ComposerBar({
  mode,
  setMode,
  providers,
  bindings,
  modelSelection,
  setModelSelection,
  thinking,
  setThinking,
  schedules,
  sending,
  onSend,
  onCancel,
  workspaceId,
  workspaces,
  setWorkspaceId,
  onCreateProject,
  localAgents,
  targetAgent,
  setTargetAgent,
  agents,
  onRunCommand,
  externalAttachments,
  onExternalAttachmentsConsumed,
  gitBranchNode,
  threadId,
  turns,
  events
}: {
  mode: DispatchPreset
  setMode: (mode: DispatchPreset) => void
  providers: ProviderDef[]
  bindings: BindingDef[]
  modelSelection: ModelSelection | null
  setModelSelection: (selection: ModelSelection | null) => void
  thinking: ComposerThinkingConfig
  setThinking: (thinking: ComposerThinkingConfig) => void
  schedules: SchedulePreview[]
  sending: boolean
  onSend: (prompt: string, attachments?: WorkbenchAttachment[]) => void
  onCancel: () => void
  workspaceId: string | null
  workspaces: WorkspaceItem[]
  setWorkspaceId: (id: string | null) => void
  onCreateProject: () => void
  localAgents: LocalAgentStatus[]
  targetAgent: string | null
  setTargetAgent: (agentId: string | null) => void
  agents: Record<string, { status: AgentUIStatus }>
  onRunCommand?: (input: { text: string; command?: WorkbenchCommand | null }) => Promise<boolean>
  onOpenProviderSettings?: () => void
  onRefreshProviders?: () => void
  externalAttachments?: WorkbenchAttachment[]
  onExternalAttachmentsConsumed?: () => void
  gitBranchNode?: React.ReactNode
  threadId?: string | null
  turns?: WorkbenchTurn[]
  events?: RuntimeEvent[]
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<WorkbenchAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [commands, setCommands] = useState<WorkbenchCommand[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [contextCapacityOpen, setContextCapacityOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const modelPickerRef = useRef<HTMLDivElement | null>(null)
  const workspacePickerRef = useRef<HTMLDivElement | null>(null)
  const contextCapacityRef = useRef<HTMLDivElement | null>(null)
  const workspace = workspaces.find(item => item.id === workspaceId) ?? null
  void mode
  void setMode
  void bindings
  void thinking
  void setThinking
  void schedules
  void agents
  const readyAgentIds = localAgentOptions(localAgents)
  const apiProviderRows = providerAgentRows(providers)
  const pickerAgentRows = filterPickerAgentRows([
    ...localAgentRows(readyAgentIds),
    ...apiProviderRows
  ], modelQuery)
  const apiModelRows = activeProviderId ? providerModelRows(providers, activeProviderId) : []
  const selectedProviderRows = modelSelection?.source === 'provider' && modelSelection.providerId
    ? providerModelRows(providers, modelSelection.providerId)
    : []
  const pickerAvailable = readyAgentIds.length > 0 || apiProviderRows.length > 0
  const selectedAgentId = targetAgent && readyAgentIds.includes(targetAgent) ? targetAgent : null
  const selectedAgentLabel = selectedAgentId ? agentDisplayName(selectedAgentId) : tr('未检测到可用 Agent', 'No available agent')

  const selectedProviderModel = modelSelection?.source === 'provider' && modelSelection.providerId
    ? selectedProviderRows.find(row => row.id === `provider:${modelSelection.providerId}:${modelSelection.modelId}`)
    : null
  const selectedProviderAgent = modelSelection?.source === 'provider' && modelSelection.providerId
    ? apiProviderRows.find(row => row.source === 'provider-agent' && row.providerId === modelSelection.providerId)
    : null
  const activeProviderAgent = activeProviderId
    ? apiProviderRows.find(row => row.source === 'provider-agent' && row.providerId === activeProviderId)
    : null
  const selectedPickerLabel = selectedProviderModel?.label || selectedProviderAgent?.label || activeProviderAgent?.label || selectedAgentLabel
  const activeModelRows = filterPickerModelRows(activeProviderId ? apiModelRows : [], modelQuery)
  const selectedPickerModelKey = modelSelectionKey(modelSelection)
  const contextCapacity = useMemo(() => buildContextCapacity({
    turns: turns || [],
    events: events || [],
    attachments,
    workspaceBound: !!workspaceId,
    modelSelection,
    providers
  }), [turns, events, attachments, workspaceId, modelSelection, providers])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 42), 118)}px`
  }, [text])

  useEffect(() => {
    window.electronAPI.commands.list().then(setCommands).catch(() => {})
  }, [])

  useEffect(() => {
    if (!externalAttachments?.length) return
    addAttachments(externalAttachments)
    onExternalAttachmentsConsumed?.()
  }, [externalAttachments])

  useEffect(() => {
    if (!modelPickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (modelPickerRef.current?.contains(target)) return
      setModelPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [modelPickerOpen])

  useEffect(() => {
    if (!workspacePickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (workspacePickerRef.current?.contains(target)) return
      setWorkspacePickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [workspacePickerOpen])

  useEffect(() => {
    if (!contextCapacityOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (contextCapacityRef.current?.contains(target)) return
      setContextCapacityOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [contextCapacityOpen])

  const slashQuery = slashCommandQuery(text)
  const commandMatches = slashQuery !== null ? rankCommandsForPalette(filterCommands(commands, slashQuery), slashQuery).slice(0, 12) : []

  useEffect(() => {
    setPaletteOpen(slashQuery !== null)
    setActiveCommandIndex(0)
  }, [slashQuery])

  const send = async () => {
    const prompt = text.trim() || (attachments.length ? tr('请分析我附加的内容。', 'Please analyze the attached content.') : '')
    if (!prompt || sending) return
    if ((prompt.startsWith('/') || prompt.startsWith('@')) && onRunCommand) {
      const handled = await onRunCommand({ text: prompt })
      if (handled) {
        setText('')
        setPaletteOpen(false)
        return
      }
      setAttachError(tr('未识别的指令，请从 / 指令面板选择，或移除开头的 / 或 @ 后再发送。', 'Unknown command. Choose one from the / palette, or remove the leading / or @ before sending.'))
      return
    }
    const nextAttachments = attachments
    setText('')
    setAttachments([])
    onSend(prompt, nextAttachments)
  }

  const addAttachments = (items: WorkbenchAttachment[]) => {
    if (!items.length) return
    setAttachError(null)
    setAttachments(current => {
      const seen = new Set(current.map(item => item.path || item.dataUrl || item.id))
      const merged = [...current]
      for (const item of items) {
        const key = item.path || item.dataUrl || item.id
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(item)
        }
      }
      return merged.slice(0, 12)
    })
  }

  const pickAttachments = async () => {
    if (sending) return
    try {
      const picked = await window.electronAPI.app.pickFiles()
      addAttachments(picked)
    } catch (e: any) {
      setAttachError(e?.message || tr('添加附件失败。', 'Failed to add attachments.'))
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments(current => current.filter(item => item.id !== id))
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file && file.type.startsWith('image/'))
    if (files.length > 0) {
      event.preventDefault()
      addAttachments(await Promise.all(files.map(fileToAttachment)))
    }
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files || [])
    if (!files.length) return
    event.preventDefault()
    addAttachments(await Promise.all(files.map(fileToAttachment)))
  }

  const insertToken = (token: string) => {
    setText(current => {
      const prefix = current.trim() ? `${current.trimEnd()} ` : ''
      return `${prefix}${token} `
    })
  }

  const selectAgentChoice = (agentId: string) => {
    setTargetAgent(agentId)
    setModelSelection(null)
    setModelQuery('')
    setActiveProviderId(null)
  }

  const selectProviderChoice = (providerId: string) => {
    setTargetAgent(null)
    setActiveProviderId(providerId)
    if (modelSelection?.providerId !== providerId || modelSelection?.source !== 'provider') {
      const firstModel = providers.find(provider => provider.id === providerId)?.models?.[0]
      setModelSelection(firstModel ? { providerId, modelId: firstModel.id, source: 'provider' } : null)
    }
    setModelQuery('')
  }

  const selectProviderModel = (providerId: string, modelId: string) => {
    setTargetAgent(null)
    setModelSelection({ providerId, modelId, source: 'provider' })
    setModelPickerOpen(false)
    setModelQuery('')
    setActiveProviderId(providerId)
  }

  const selectWorkspace = (nextWorkspaceId: string | null) => {
    setWorkspaceId(nextWorkspaceId)
    setWorkspacePickerOpen(false)
  }

  const createWorkspaceFromPicker = () => {
    setWorkspacePickerOpen(false)
    onCreateProject()
  }

  const chooseCommand = async (command: WorkbenchCommand) => {
    if (command.source === 'ecc') {
      if (currentTextHasCommandArgs(text.trim(), command)) {
        const handled = await onRunCommand?.({ text: commandTextForSelection(text.trim(), command), command })
        if (handled) {
          setText('')
          setPaletteOpen(false)
          return
        }
      }
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'use-skill') {
      const handled = await onRunCommand?.({ text: command.insertText || command.label, command })
      if (handled) {
        setText('')
        setPaletteOpen(false)
        return
      }
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'use-agent') {
      const currentText = text.trim()
      const handled = await onRunCommand?.({ text: commandTextForSelection(currentText, command), command })
      if (handled) {
        setText('')
        setPaletteOpen(false)
        return
      }
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'insert') {
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'run-terminal') {
      setText('/terminal ')
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    const handled = await onRunCommand?.({ text: command.insertText || command.label, command })
    if (handled) {
      setText('')
      setPaletteOpen(false)
    } else if (command.insertText) {
      setText(command.insertText)
      setPaletteOpen(false)
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={'wb-composer-wrap' + (attachments.length ? ' has-attachments' : '')}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={handleDrop}
    >
      <div className="wb-composer">
        <div className="wb-composer-input-layer">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={e => {
              if (paletteOpen && commandMatches.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActiveCommandIndex(index => (index + 1) % commandMatches.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveCommandIndex(index => (index - 1 + commandMatches.length) % commandMatches.length)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setPaletteOpen(false)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const currentText = text.trim()
                  const command = commandMatches[activeCommandIndex]
                  const rawFirstToken = currentText.split(/\s+/, 1)[0] || ''
                  const firstToken = normalizeCommandToken(rawFirstToken)
                  if (firstToken === command.label.toLowerCase() && currentText.length > rawFirstToken.length) {
                    send().catch(() => {})
                  } else {
                    chooseCommand(command).catch(() => {})
                  }
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={tr('输入后发送，系统会自动新建会话...', 'Send to start a new session...')}
            rows={1}
          />

          <div className="wb-composer-input-actions">
            <button className="wb-icon-button" title={tr('添加文件或图片', 'Attach file or image')} disabled={sending} onClick={pickAttachments}>
              <Icon d={IC.plus} size={17} />
            </button>
            <div className="wb-composer-model-menu-host" ref={modelPickerRef}>
              <button
                type="button"
                className="wb-agent-picker-trigger"
                disabled={!pickerAvailable}
                title={readyAgentIds.length ? tr('切换 Agent', 'Switch agent') : tr('请先在设置里配置本地 Agent', 'Configure a local agent in Settings first')}
                aria-label={tr('切换 Agent', 'Switch agent')}
                aria-expanded={modelPickerOpen}
                onClick={() => setModelPickerOpen(open => {
                  const next = !open
                  if (next) setActiveProviderId(null)
                  return next
                })}
              >
                {selectedAgentId
                  ? <AgentMark id={selectedAgentId} size={24} radius={7} />
                  : selectedProviderAgent || activeProviderAgent ? <span className="wb-provider-mark small"><Icon d={IC.pulse} size={14} /></span> : <Icon d={IC.terminal} size={16} />}
                <span>{selectedPickerLabel}</span>
                <Icon d={IC.chevDown} size={12} />
              </button>
              {modelPickerOpen && (
                <div className={'wb-agent-picker' + (activeModelRows.length > 0 ? ' has-models' : '')} role="menu" aria-label={tr('选择 Agent', 'Choose agent')}>
                  <section className="wb-agent-picker-agents">
                    <div className="wb-agent-picker-title">Agents</div>
                    <div className="wb-agent-picker-list">
                      {pickerAgentRows.map(row => (
                        <button
                          key={row.id}
                          type="button"
                          className={pickerAgentRowSelected(row, selectedAgentId, activeProviderId, modelSelection) ? 'selected' : ''}
                          title={row.label}
                          onClick={() => row.source === 'local-agent' ? selectAgentChoice(row.agentId) : selectProviderChoice(row.providerId)}
                        >
                          {row.source === 'local-agent'
                            ? <AgentMark id={row.agentId} size={32} radius={9} />
                            : <span className="wb-provider-mark"><Icon d={IC.pulse} size={16} /></span>}
                          <span>
                            <strong>{row.label}</strong>
                            {row.subtitle && <small>{row.subtitle}</small>}
                          </span>
                          {pickerAgentRowSelected(row, selectedAgentId, activeProviderId, modelSelection) && <Icon d={IC.check} size={14} />}
                        </button>
                      ))}
                    </div>
                  </section>
                  {activeModelRows.length > 0 && (
                    <section className="wb-agent-model-panel" aria-label={tr('模型', 'Models')}>
                      <div className="wb-agent-picker-title">{tr('模型', 'Models')}</div>
                      {activeProviderId && !modelQuery.trim() && (
                        <button type="button" className="wb-agent-model-back" onClick={() => setActiveProviderId(null)}>
                          ‹ {tr('厂商', 'Providers')}
                        </button>
                      )}
                      <label className="wb-agent-model-search">
                        <Icon d={IC.search} size={13} />
                        <input
                          value={modelQuery}
                          onChange={event => setModelQuery(event.target.value)}
                          placeholder={tr('搜索模型', 'Search models')}
                        />
                      </label>
                      <div className="wb-agent-model-list">
                        {activeModelRows.map(model => (
                          <button
                            key={model.id}
                            type="button"
                            className={model.id === selectedPickerModelKey ? 'selected' : ''}
                            title={model.label}
                            onClick={() => selectProviderModel(model.providerId, model.modelId)}
                          >
                            <span>
                              <strong>{model.label}</strong>
                              <small>{model.subtitle}</small>
                            </span>
                            {model.contextWindow ? <em>{formatContextWindow(model.contextWindow)}</em> : null}
                            {model.id === selectedPickerModelKey && <Icon d={IC.check} size={14} />}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {false && (
                    <div className="wb-agent-model-loading">{tr('正在读取本地模型配置...', 'Reading local model config...')}</div>
                  )}
                </div>
              )}
            </div>
            {sending
              ? <button className="wb-send stop" onClick={onCancel} title={tr('停止', 'Stop')}><Icon d={IC.stop} size={15} /></button>
              : <button className="wb-send" disabled={!text.trim() && attachments.length === 0} onClick={send} title={tr('发送', 'Send')}><Icon d={IC.send} size={15} /></button>}
          </div>
        </div>

        {paletteOpen && commandMatches.length > 0 && (
          <div className="wb-command-palette">
            {commandMatches.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={index === activeCommandIndex ? 'active' : ''}
                onMouseEnter={() => setActiveCommandIndex(index)}
                onClick={() => chooseCommand(command).catch(() => {})}
              >
                <code>{command.label}</code>
                <span>
                  <strong>{commandCategoryLabel(command.category)}</strong>
                  {command.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="wb-attachment-strip">
            {attachments.map(att => (
              <button key={att.id} className={'wb-attachment-chip ' + att.kind} type="button" onClick={() => removeAttachment(att.id)} title={att.path || tr('点击移除附件', 'Click to remove')}>
                {att.kind === 'image' && att.dataUrl
                  ? <img src={att.dataUrl} alt={att.name} />
                  : <Icon d={att.kind === 'image' ? IC.image : IC.file} size={14} />}
                <span>{att.name}</span>
                {att.size ? <small>{formatBytes(att.size)}</small> : null}
                <Icon d={IC.x} size={12} />
              </button>
            ))}
          </div>
        )}

        {attachError && <div className="wb-voice-error">{attachError}</div>}

        <div className="wb-composer-context wb-composer-context-minimal">
          <div className="wb-composer-context-left">
            <div className="wb-workspace-picker-host" ref={workspacePickerRef}>
              <button
                type="button"
                className="wb-workspace-trigger"
                onClick={() => setWorkspacePickerOpen(open => !open)}
                aria-expanded={workspacePickerOpen}
                aria-label={tr('切换工作目录', 'Switch working folder')}
                title={workspace?.rootPath || tr('个人会话', 'Personal chat')}
              >
                <Icon d={IC.folder} size={14} />
                <span>{workspace?.name || tr('个人会话', 'Personal chat')}</span>
                <Icon d={IC.chevDown} size={12} />
              </button>
              {workspacePickerOpen && (
                <div className="wb-workspace-popover" role="menu" aria-label={tr('选择工作目录', 'Choose working folder')}>
                  <button
                    type="button"
                    className={!workspaceId ? 'selected' : ''}
                    onClick={() => selectWorkspace(null)}
                  >
                    <Icon d={IC.chat} size={14} />
                    <span>
                      <strong>{tr('个人会话', 'Personal chat')}</strong>
                      <small>{tr('不绑定本地目录', 'No local folder bound')}</small>
                    </span>
                    {!workspaceId && <Icon d={IC.check} size={14} />}
                  </button>
                  {workspaces.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={workspaceId === item.id ? 'selected' : ''}
                      onClick={() => selectWorkspace(item.id)}
                    >
                      <Icon d={IC.folder} size={14} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.rootPath}</small>
                      </span>
                      {workspaceId === item.id && <Icon d={IC.check} size={14} />}
                    </button>
                  ))}
                  <button type="button" className="create" onClick={createWorkspaceFromPicker}>
                    <Icon d={IC.plus} size={14} />
                    <span>
                      <strong>{tr('添加工作目录', 'Add working folder')}</strong>
                      <small>{tr('选择一个本地目录作为上下文', 'Choose a local folder as context')}</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
            {gitBranchNode}
            <div className="wb-context-capacity-host" ref={contextCapacityRef}>
              <button
                type="button"
                className={'wb-context-capacity-trigger ' + contextCapacity.tone}
                onClick={() => setContextCapacityOpen(open => !open)}
                aria-expanded={contextCapacityOpen}
                title={tr('查看本轮上下文容量估算', 'View context capacity estimate')}
              >
                <Icon d={IC.brain} size={13} />
                <span>{tr('上下文', 'Context')}</span>
                <strong>{Math.round(contextCapacity.usedRatio * 100)}%</strong>
              </button>
              {contextCapacityOpen && (
                <div className="wb-context-capacity-popover">
                  <div className="wb-context-capacity-head">
                    <strong>{tr('上下文容量', 'Context capacity')}</strong>
                    <span>{formatCompactTokens(contextCapacity.usedTokens)} / {formatCompactTokens(contextCapacity.windowTokens)}</span>
                  </div>
                  <div className="wb-context-capacity-bar" aria-hidden="true">
                    {contextCapacity.categories.map(item => (
                      <i key={item.key} className={item.key} style={{ width: `${Math.max(1, item.ratio * 100)}%` }} />
                    ))}
                  </div>
                  <div className="wb-context-capacity-rows">
                    {contextCapacity.categories.map(item => (
                      <div key={item.key}>
                        <span><i className={item.key}></i>{contextCategoryLabel(item.key)}</span>
                        <strong>{formatCompactTokens(item.tokens)}</strong>
                      </div>
                    ))}
                    <div>
                      <span><i className="free"></i>{tr('空余', 'Free')}</span>
                      <strong>{formatCompactTokens(contextCapacity.freeTokens)}</strong>
                    </div>
                  </div>
                  <p>{tr('数值为估算；75% 开始建议压缩，85% 需要压缩。', 'Estimated only; consider compaction at 75%, required near 85%.')}</p>
                </div>
              )}
            </div>
          </div>
          <button className="wb-command-open-hint" type="button" onClick={() => insertToken('/')} title={tr('输入 / 打开命令', 'Type / to open commands')}>
            {tr('输入 / 打开命令', 'Type / for commands')}
          </button>
        </div>
      </div>
    </div>
  )
}

async function fileToAttachment(file: File): Promise<WorkbenchAttachment> {
  const path = (file as any).path as string | undefined
  const kind: WorkbenchAttachment['kind'] = file.type.startsWith('image/') ? 'image' : isTextLike(file) ? 'text' : 'file'
  const att: WorkbenchAttachment = {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: file.name || (kind === 'image' ? 'pasted-image.png' : 'attachment'),
    path,
    mime: file.type || undefined,
    size: file.size,
    createdAt: Date.now()
  }
  if (kind === 'image' && file.size <= 2 * 1024 * 1024) {
    att.dataUrl = await readAsDataUrl(file)
  } else if (kind === 'text' && file.size <= 96 * 1024) {
    att.text = await file.text()
  }
  return att
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/') || /json|xml|yaml|javascript|typescript/.test(file.type)) return true
  return /\.(txt|md|markdown|json|jsonc|yaml|yml|toml|ini|env|js|jsx|ts|tsx|css|html|py|go|rs|java|cs|cpp|c|h|sql|sh|ps1)$/i.test(file.name)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function localAgentRows(agentIds: string[]): PickerAgentRow[] {
  return agentIds.map(agentId => ({
    source: 'local-agent',
    id: `local-agent:${agentId}`,
    label: agentDisplayName(agentId),
    subtitle: 'Local CLI',
    agentId
  }))
}

function providerAgentRows(providers: ProviderDef[]): PickerAgentRow[] {
  return providers
    .filter(provider => provider.enabled && !!provider.apiKey && !!provider.models?.length)
    .map(provider => ({
      source: 'provider-agent',
      id: `provider-agent:${provider.id}`,
      label: provider.name,
      subtitle: `${provider.models.length} models`,
      providerId: provider.id,
      modelCount: provider.models.length
    }))
}

function providerModelRows(providers: ProviderDef[], onlyProviderId?: string | null): PickerModelRow[] {
  const rows: PickerModelRow[] = []
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey || !provider.models?.length) continue
    if (onlyProviderId && provider.id !== onlyProviderId) continue
    for (const model of provider.models) {
      rows.push({
        source: 'provider-model',
        id: `provider:${provider.id}:${model.id}`,
        label: model.label || model.id,
        subtitle: `${provider.name} · ${model.id}`,
        providerId: provider.id,
        modelId: model.id,
        contextWindow: model.contextWindow || 258_000
      })
    }
  }
  return rows
}

function filterPickerAgentRows(rows: PickerAgentRow[], query: string): PickerAgentRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(row => `${row.id} ${row.label} ${row.subtitle}`.toLowerCase().includes(q))
}

function filterPickerModelRows(models: PickerModelRow[], query: string): PickerModelRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter(model => `${model.id} ${model.label} ${model.subtitle}`.toLowerCase().includes(q))
}

function pickerAgentRowSelected(row: PickerAgentRow, selectedAgentId: string | null, activeProviderId: string | null, selection: ModelSelection | null): boolean {
  if (row.source === 'local-agent') return row.agentId === selectedAgentId
  return row.providerId === activeProviderId || (!!selection?.providerId && selection.providerId === row.providerId && !selectedAgentId)
}

function modelSelectionKey(selection: ModelSelection | null): string {
  if (selection?.source === 'provider' && selection.providerId) return `provider:${selection.providerId}:${selection.modelId}`
  return ''
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

type ContextCapacityCategoryKey = 'system' | 'messages' | 'attachments' | 'skills' | 'workspace'
type ContextCapacityCategory = { key: ContextCapacityCategoryKey; tokens: number; ratio: number }

function buildContextCapacity(input: {
  turns: WorkbenchTurn[]
  events: RuntimeEvent[]
  attachments: WorkbenchAttachment[]
  workspaceBound: boolean
  modelSelection: ModelSelection | null
  providers: ProviderDef[]
}): { windowTokens: number; usedTokens: number; freeTokens: number; usedRatio: number; tone: 'ok' | 'warn' | 'danger'; categories: ContextCapacityCategory[] } {
  const windowTokens = resolveContextWindow(input.modelSelection, input.providers)
  const system = 1800
  const skills = 420
  const workspace = input.workspaceBound ? 900 : 80
  const messages = estimateTokens(input.turns.map(turn => turn.prompt).join('\n\n')) +
    estimateTokens(input.events.filter(event => event.kind === 'agent:done').map(event => event.payload?.content || '').join('\n\n'))
  const attachments = input.attachments.reduce((sum, item) => sum + estimateTokens(item.text || item.name || item.path || ''), 0)
  const rawCategories: Array<{ key: ContextCapacityCategoryKey; tokens: number }> = [
    { key: 'system', tokens: system },
    { key: 'messages', tokens: messages },
    { key: 'attachments', tokens: attachments },
    { key: 'skills', tokens: skills },
    { key: 'workspace', tokens: workspace }
  ]
  const usedTokens = Math.min(windowTokens, rawCategories.reduce((sum, item) => sum + item.tokens, 0))
  const scale = usedTokens > 0 ? usedTokens / Math.max(usedTokens, rawCategories.reduce((sum, item) => sum + item.tokens, 0)) : 1
  const categories = rawCategories.map(item => ({
    key: item.key,
    tokens: Math.round(item.tokens * scale),
    ratio: Math.max(0, Math.round(item.tokens * scale) / windowTokens)
  }))
  const usedRatio = usedTokens / windowTokens
  return {
    windowTokens,
    usedTokens,
    freeTokens: Math.max(0, windowTokens - usedTokens),
    usedRatio,
    tone: usedRatio >= 0.85 ? 'danger' : usedRatio >= 0.75 ? 'warn' : 'ok',
    categories
  }
}

function resolveContextWindow(selection: ModelSelection | null, providers: ProviderDef[]): number {
  if (selection?.providerId) {
    const provider = providers.find(item => item.id === selection.providerId)
    const model = provider?.models?.find(item => item.id === selection.modelId)
    const contextWindow = (model as any)?.contextWindow
    if (typeof contextWindow === 'number' && contextWindow > 0) return contextWindow
  }
  return 258_000
}

function estimateTokens(value: string): number {
  const text = String(value || '')
  if (!text) return 0
  let cjk = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) cjk += 1
  }
  return Math.ceil(cjk * 0.9 + (text.length - cjk) / 4)
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return String(value)
}

function contextCategoryLabel(key: ContextCapacityCategoryKey): string {
  if (key === 'system') return tr('系统', 'System')
  if (key === 'messages') return tr('消息', 'Messages')
  if (key === 'attachments') return tr('附件', 'Attachments')
  if (key === 'skills') return tr('技能', 'Skills')
  return tr('工作目录', 'Workspace')
}

function slashCommandQuery(value: string): string | null {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('/') && !trimmed.startsWith('@')) return null
  return normalizeCommandToken(trimmed.split(/\s+/, 1)[0] || '').replace(/^\/+/, '').toLowerCase()
}

function normalizeCommandToken(value: string): string {
  const lower = value.toLowerCase()
  if (lower.startsWith('@')) {
    const alias = lower.slice(1)
    return `/agent:${alias === 'minimax-code' ? 'opencode' : alias}`
  }
  if (lower.startsWith('/agent:minimax-code')) return '/agent:opencode'
  return lower
}

function commandTextForSelection(currentText: string, command: WorkbenchCommand): string {
  const rawFirstToken = currentText.split(/\s+/, 1)[0] || ''
  const firstToken = normalizeCommandToken(rawFirstToken)
  if (firstToken === command.label.toLowerCase() && currentText.length > rawFirstToken.length) return currentText
  return command.insertText || command.label
}

function currentTextHasCommandArgs(currentText: string, command: WorkbenchCommand): boolean {
  const rawFirstToken = currentText.split(/\s+/, 1)[0] || ''
  const firstToken = normalizeCommandToken(rawFirstToken)
  return firstToken === command.label.toLowerCase() && currentText.trim().length > rawFirstToken.length
}

function filterCommands(commands: WorkbenchCommand[], query: string): WorkbenchCommand[] {
  const raw = query.trim().toLowerCase()
  const q = raw.startsWith('agent:') ? raw : raw ? `agent:${raw}` : raw
  if (!q) return commands
  return commands.filter(command => {
    const haystack = [
      command.label,
      command.label.replace(/^\/agent:/, ''),
      command.description,
      command.category,
      command.source,
      command.payload?.name,
      command.payload?.category,
      Array.isArray(command.payload?.tags) ? command.payload.tags.join(' ') : ''
    ].join(' ').toLowerCase()
    return haystack.includes(raw) || (command.source === 'local-agent' && haystack.includes(q))
  })
}

export function rankCommandsForPalette(commands: WorkbenchCommand[], query: string): WorkbenchCommand[] {
  const q = query.trim().toLowerCase()
  return [...commands].sort((a, b) => commandRank(a, q) - commandRank(b, q))
}

function commandRank(command: WorkbenchCommand, query: string): number {
  const label = command.label.toLowerCase().replace(/^\//, '')
  const exact = query && label === query ? -100 : 0
  const prefix = query && label.startsWith(query) ? -50 : 0
  const source = command.source === 'ecc' ? 0
    : command.category === 'session' ? 100
    : command.category === 'tool' ? 200
    : command.category === 'agent' ? 300
    : command.category === 'skill' ? 400
    : command.category === 'schedule' ? 500
    : 600
  const common = COMMON_COMMAND_ORDER.get(command.label.toLowerCase()) ?? 80
  return exact + prefix + source + common
}

const COMMON_COMMAND_ORDER = new Map<string, number>([
  ['/plan', 0],
  ['/tdd', 1],
  ['/code-review', 2],
  ['/review', 3],
  ['/verify', 4],
  ['/bug-hunt', 5],
  ['/ui-polish', 6],
  ['/docs', 7],
  ['/research', 8],
  ['/new', 10],
  ['/clear', 11],
  ['/context', 12],
  ['/terminal', 20],
  ['/git', 21],
  ['/browser', 22],
  ['/memory', 23]
])

function commandCategoryLabel(category: WorkbenchCommand['category']): string {
  if (category === 'session') return tr('会话', 'Session')
  if (category === 'agent') return 'Agent'
  if (category === 'schedule') return tr('调度', 'Schedule')
  if (category === 'tool') return tr('工具', 'Tool')
  if (category === 'skill') return tr('技能', 'Skill')
  if (category === 'ecc') return 'ECC 指令'
  return tr('工作区', 'Workspace')
}

function agentDisplayName(agentId: string): string {
  return AGENT_META[agentId]?.name || localAgentLabel(agentId)
}
