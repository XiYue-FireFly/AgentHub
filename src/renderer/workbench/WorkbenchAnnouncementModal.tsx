import React from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'

interface WorkbenchAnnouncementModalProps {
  onClose: () => void
  onOpenSetup: (tab: 'local-agents' | 'providers') => void
}

export function WorkbenchAnnouncementModal({
  onClose,
  onOpenSetup
}: WorkbenchAnnouncementModalProps) {
  return (
    <div className="wb-modal-backdrop wb-announcement-backdrop" onMouseDown={onClose}>
      <section className="wb-announcement-modal" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={tr('AgentHub 使用公告', 'AgentHub announcement')}>
        <div className="wb-announcement-head">
          <div>
            <span>{tr('AgentHub 0.5.4', 'AgentHub 0.5.4')}</span>
            <h2>{tr('开始前请先完成运行配置', 'Finish run setup before starting')}</h2>
          </div>
          <button onClick={onClose} aria-label={tr('关闭公告', 'Close announcement')}>
            <Icon d={IC.x} size={15} />
          </button>
        </div>
        <p className="wb-announcement-intro">
          {tr(
            '本版本把 AgentHub 工作台、Agent 切换、API 厂商直连、Git、Skills 和 MCP 整合到一个桌面流程中。为了避免任务发错 Agent，请按下面顺序完成首次配置。',
            'This release combines the workbench, agent switching, provider direct runs, Git, Skills, and MCP into one desktop workflow. Complete the setup below before sending tasks.'
          )}
        </p>
        <div className="wb-announcement-steps">
          <article>
            <strong>{tr('1. 配置可用 Agent CLI', '1. Configure an Agent CLI')}</strong>
            <p>{tr('进入 设置 -> Local Agents，点击检测或手动选择 Codex、Claude、Gemini、OpenCode 等 CLI 路径。只有检测通过或已配置可用路径的 Agent 才会出现在工作台选择器中。', 'Open Settings -> Local Agents, then detect or choose the CLI path for Codex, Claude, Gemini, OpenCode, and other agents. Only available agents appear in the workbench picker.')}</p>
          </article>
          <article>
            <strong>{tr('2. 检查路由与 API 厂商', '2. Check routing and providers')}</strong>
            <p>{tr('进入 设置 -> Providers / Routing，为需要的 API 厂商填写 Key，并确认 Agent 路由绑定。选择 DeepSeek、OpenAI 等厂商模型时，AgentHub 会直接走 API，不会误调用本地 CLI。', 'Open Settings -> Providers / Routing, add API keys, and confirm agent bindings. Provider models such as DeepSeek or OpenAI run through direct API calls instead of local CLIs.')}</p>
          </article>
          <article>
            <strong>{tr('3. 回到工作台选择运行对象', '3. Choose who runs the task')}</strong>
            <p>{tr('回到聊天工作台，在右侧/底部的运行选择器中点击要使用的 Agent 或 API 厂商模型。选中本地 Agent 后走 CLI/ACP；选中厂商模型后走 API 直连。', 'Return to the chat workbench and choose the agent or provider model from the run picker. Local agents use CLI/ACP; provider models use direct API calls.')}</p>
          </article>
          <article>
            <strong>{tr('4. 绑定工作目录并使用工具区', '4. Bind a folder and use tools')}</strong>
            <p>{tr('需要读取项目、查看 Git 或执行终端命令时，请先添加工作目录。Git、MCP、运行记录和外观设置都在工作台工具区或设置页中。', 'Add a working folder before reading project files, using Git, or running terminal commands. Git, MCP, run history, and appearance settings live in the tool area or Settings.')}</p>
          </article>
        </div>
        <div className="wb-announcement-actions">
          <button onClick={() => onOpenSetup('local-agents')}>{tr('去选择 Agent CLI', 'Choose Agent CLI')}</button>
          <button onClick={() => onOpenSetup('providers')}>{tr('配置 API 厂商', 'Configure providers')}</button>
          <button className="primary" onClick={onClose}>{tr('我知道了', 'Got it')}</button>
        </div>
      </section>
    </div>
  )
}
