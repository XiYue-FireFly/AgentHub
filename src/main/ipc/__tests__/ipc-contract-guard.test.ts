import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const workspaceIpc = readFileSync(join(__dirname, '../workspace-ipc.ts'), 'utf-8')
const sddIpc = readFileSync(join(__dirname, '../sdd-ipc.ts'), 'utf-8')
const providerIpc = readFileSync(join(__dirname, '../provider-ipc.ts'), 'utf-8')
const workflowIpc = readFileSync(join(__dirname, '../workflow-ipc.ts'), 'utf-8')
const pluginsIpc = readFileSync(join(__dirname, '../plugins-ipc.ts'), 'utf-8')
const passthroughIpc = readFileSync(join(__dirname, '../passthrough-ipc.ts'), 'utf-8')
const browserIpc = readFileSync(join(__dirname, '../browser-ipc.ts'), 'utf-8')
const terminalIpc = readFileSync(join(__dirname, '../terminal-ipc.ts'), 'utf-8')
const terminalPtyIpc = readFileSync(join(__dirname, '../terminal-pty-ipc.ts'), 'utf-8')
const hubThreadsIpc = readFileSync(join(__dirname, '../hub-threads-ipc.ts'), 'utf-8')
const conversationIpc = readFileSync(join(__dirname, '../conversation-ipc.ts'), 'utf-8')
const agentLoopIpc = readFileSync(join(__dirname, '../agent-loop-ipc.ts'), 'utf-8')
const modelsIpc = readFileSync(join(__dirname, '../models-ipc.ts'), 'utf-8')
const mcpIpc = readFileSync(join(__dirname, '../mcp-ipc.ts'), 'utf-8')
const memoryIpc = readFileSync(join(__dirname, '../memory-ipc.ts'), 'utf-8')
const gitIpc = readFileSync(join(__dirname, '../git-ipc.ts'), 'utf-8')
const missingIpc = readFileSync(join(__dirname, '../missing-ipc.ts'), 'utf-8')
const decisionIpcPath = join(__dirname, '../decision-ipc.ts')
const decisionIpc = existsSync(decisionIpcPath) ? readFileSync(decisionIpcPath, 'utf-8') : ''
const turnsIpcPath = join(__dirname, '../turns-ipc.ts')
const turnsIpc = existsSync(turnsIpcPath) ? readFileSync(turnsIpcPath, 'utf-8') : ''
const indexIpc = readFileSync(join(__dirname, '../index.ts'), 'utf-8')
const mainIndex = readFileSync(join(__dirname, '../../index.ts'), 'utf-8')
const preload = readFileSync(join(__dirname, '../../../preload/index.ts'), 'utf-8')
const contract = readFileSync(join(__dirname, '../../../shared/ipc-contract.ts'), 'utf-8')

function collectFirstStringArgs(sourceText: string, calleeName: string): Set<string> {
  const sourceFile = ts.createSourceFile('ipc-source.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const channels = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && getCalleeName(node.expression) === calleeName) {
      const firstArg = node.arguments[0]
      if (firstArg && ts.isStringLiteralLike(firstArg)) {
        channels.add(firstArg.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return channels
}

function getCalleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const base = getCalleeName(expression.expression)
    return base ? `${base}.${expression.name.text}` : expression.name.text
  }
  return null
}

function collectIpcContractChannels(sourceText: string): Set<string> {
  const sourceFile = ts.createSourceFile('ipc-contract.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const channels = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'IpcContract') {
      for (const member of node.members) {
        const name = member.name
        if (name && ts.isStringLiteral(name)) channels.add(name.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return channels
}

const contractedChannels = [
  'win:minimize',
  'win:maximizeToggle',
  'win:isMaximized',
  'win:close',
  'windows:openWorkbench',
  'hub:status',
  'proxy:info',
  'agents:locate',
  'dialog:selectDirectory',
  'app:openExternal',
  'app:openPath',
  'app:resolvePath',
  'app:readTextFile',
  'app:pickFolder',
  'app:pickFiles',
  'takeover:status',
  'takeover:apply',
  'takeover:restore',
  'providers:get',
  'providers:upsert',
  'providers:delete',
  'providers:setEnabled',
  'providers:setKey',
  'providers:health',
  'providers:healthAll',
  'providers:fetchModels',
  'providers:reorderForClaude',
  'routing:setBinding',
  'routing:removeBinding',
  'routing:setFallback',
  'routing:setStrategy',
  'routing:setBindingThinking',
  'routing:setProviderThinking',
  'routing:activeBinding',
  'store:get',
  'store:set',
  'conversation:exportMarkdown',
  'conversation:exportHtml',
  'conversation:exportFile',
  'conversation:importFile',
  'conversation:importJson',
  'conversation:branch',
  'conversation:summarize',
  'agentLoop:getConfig',
  'agentLoop:getStatus',
  'agentLoop:getAgents',
  'agentLoop:refreshAgents',
  'agentLoop:getRouteInfo',
  'models:list',
  'models:routeSettings:get',
  'models:routeSettings:set',
  'models:updateRoute',
  'models:test',
  'models:exportCodexCatalog',
  'models:toggleFavorite',
  'models:toggleHidden',
  'models:favorites',
  'models:hidden',
  'mcp:list',
  'mcp:scanLocal',
  'mcp:upsert',
  'mcp:remove',
  'mcp:setEnabled',
  'mcp:test',
  'mcp:listTools',
  'mcp:getSystemConfig',
  'mcp:setSystemConfig',
  'mcp:setSystemEnabled',
  'worktrees:list',
  'worktrees:create',
  'worktrees:remove',
  'worktrees:sync',
  'worktrees:open',
  'workspaces:list',
  'workspaces:create',
  'workspaces:update',
  'workspaces:remove',
  'workspaces:getActive',
  'workspaces:setActive',
  'workflows:list',
  'workflows:get',
  'workflows:upsert',
  'workflows:delete',
  'workflows:search',
  'workflows:seed',
  'plugins:scan',
  'plugins:validate',
  'plugins:contributions',
  'plugins:repositories',
  'plugins:importRepository',
  'plugins:install',
  'plugins:uninstall',
  'plugins:toggle',
  'plugins:listInstalled',
  'plugins:enabledContributions',
  'plugins:marketplaceList',
  'plugins:marketplaceInstall',
  'plugins:trustList',
  'plugins:trustAdd',
  'plugins:trustRemove',
  'localAgents:detect',
  'localAgents:status',
  'localAgents:options',
  'localAgents:configure',
  'localModels:scan',
  'localModels:readConfig',
  'goals:get',
  'goals:set',
  'goals:clear',
  'settings:getRunTimeout',
  'settings:setRunTimeout',
  'commands:list',
  'commands:run',
  'schedules:list',
  'schedules:runPreview',
  'ecc:status',
  'ecc:update',
  'updates:status',
  'updates:check',
  'updates:setChannel',
  'updates:download',
  'updates:install',
  'updates:openDownload',
  'routes:explain',
  'logs:path',
  'logs:recent',
  'diagnostics:runSuite',
  'diagnostics:run',
  'diagnostics:providerDoctor',
  'diagnostics:supportBundle',
  'projectMap:build',
  'projectMap:search',
  'github:checkCli',
  'github:listPrs',
  'github:listIssues',
  'github:currentBranchPr',
  'release:checks',
  'git:status',
  'git:branches',
  'git:checkoutBranch',
  'git:createBranch',
  'git:renameBranch',
  'git:deleteBranch',
  'git:log',
  'git:diff',
  'git:diffs',
  'git:commitDetails',
  'git:commitDiff',
  'git:stageFile',
  'git:stageAll',
  'git:unstageFile',
  'git:revertFile',
  'git:revertAll',
  'git:commit',
  'git:fetch',
  'git:pull',
  'git:push',
  'git:sync',
  'git:updateBranch',
  'git:query',
  'context:projection',
  'usage:stats',
  'usage:records',
  'usage:recordDetail',
  'usage:pricing:list',
  'usage:pricing:upsert',
  'usage:pricing:delete',
  'prompts:list',
  'prompts:get',
  'prompts:upsert',
  'prompts:delete',
  'prompts:search',
  'prompts:slashCommands',
  'prompts:incrementUse',
  'prompts:seedDefaults',
  'memory:catalog',
  'memory:getSettings',
  'memory:updateSettings',
  'memory:list',
  'memory:search',
  'memory:addEntry',
  'memory:importConversation',
  'memory:listCandidates',
  'memory:approveCandidate',
  'memory:updateEntry',
  'memory:disableEntry',
  'memory:delete',
  'memory:restore',
  'memory:graph',
  'memory:cleanupSuggestions',
  'memory:scoreQuality',
  'memory:detectConflicts',
  'budget:get',
  'budget:update',
  'budget:check',
  'budget:estimateDispatch',
  'inlineEdit:buildPrompt',
  'inlineEdit:validate',
  'inlineEdit:apply',
  'workflow:substituteVars',
  'workflow:evaluateCondition',
  'workflow:saveRun',
  'workflow:runHistory',
  'workflow:runHistoryFor',
  'teams:list',
  'teams:save',
  'teams:delete',
  'teams:defaultFirefly',
  'knowledge:detectTechStack',
  'knowledge:generateSummary',
  'firefly:createState',
  'firefly:completeRole',
  'firefly:getRoleContext',
  'firefly:isComplete',
  'firefly:getOutput',
  'firefly:listTemplates',
  'firefly:getTemplate',
  'terminalAi:buildPrompt',
  'terminalAi:suggestCommand',
  'terminalAi:explainOutput',
  'ai:quickComplete',
  'terminal:run',
  'terminal:cancel',
  'terminal:history',
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:dispose',
  'tasks:delete',
  'tasks:clearCompleted',
  'skills:list',
  'skills:builtins',
  'skills:scanLocal',
  'skills:importLocal',
  'skills:refreshLocal',
  'skills:add',
  'skills:update',
  'skills:remove',
  'skills:getInstalls',
  'skills:install',
  'skills:uninstall',
  'agentic:capabilities',
  'agentic:getEnabled',
  'agentic:setEnabled',
  'agentic:getMode',
  'agentic:setMode',
  'agentic:getApprovalConfig',
  'agentic:setApprovalPreset',
  'agentic:setApprovalDefault',
  'agentic:setApprovalOverride',
  'threads:list',
  'threads:create',
  'threads:rename',
  'threads:delete',
  'threads:select',
  'threads:fork',
  'turns:create',
  'turns:retry',
  'turns:rerunInterrupted',
  'turns:cancel',
  'turns:cancelAgent',
  'turns:listQueuedSubmissions',
  'turns:clearQueue',
  'turns:listPendingDecisions',
  'turns:resolveDecision',
  'runtime:snapshot',
  'runtime:eventsSince',
  'shortcuts:list',
  'shortcuts:get',
  'shortcuts:update',
  'shortcuts:reset',
  'shortcuts:resetAll',
  'shortcuts:conflicts',
  'slashCommands:list',
  'slashCommands:get',
  'slashCommands:save',
  'slashCommands:delete',
  'slashCommands:resolve',
  'slashCommands:validate',
  'slashCommands:conflict',
  'notifications:list',
  'notifications:unreadCount',
  'notifications:push',
  'notifications:markRead',
  'notifications:markAllRead',
  'notifications:delete',
  'notifications:clearAll',
  'onboarding:getState',
  'onboarding:shouldShow',
  'onboarding:completeStep',
  'onboarding:skipAll',
  'onboarding:reset',
  'onboarding:nextStep',
  'backup:create',
  'backup:list',
  'backup:restore',
  'backup:delete',
  'sync:export',
  'sync:list',
  'sync:preview',
  'sync:import',
  'sync:delete',
  'sync:webdavGetConfig',
  'sync:webdavSetConfig',
  'sync:webdavTest',
  'sync:webdavPush',
  'sync:webdavPull',
  'browser:open',
  'browser:capture',
  'browser:summarize',
  'browser:extractText',
  'browser:analyzePrompt',
  'todos:list',
  'todos:set',
  'todos:upsert',
  'todos:delete',
  'todos:clear',
  'todos:syncFromMarkdown',
  'workspaceFiles:list',
  'workspaceFiles:search',
  'workspaceFiles:preview',
  'workspaceFiles:read',
  'workspaceFiles:write',
  'workspaceFiles:readImage',
  'workspaceFiles:listDirectory',
  'sdd:createDraft',
  'sdd:getDraft',
  'sdd:updateDraft',
  'sdd:updateDesignContext',
  'sdd:deleteDraft',
  'sdd:listDrafts',
  'sdd:parseBlocks',
  'sdd:parsePlanCovers',
  'sdd:computeTrace',
  'sdd:saveTrace',
  'sdd:getTrace',
  'sdd:exists'
]

describe('IPC contract guard', () => {
  it('declares the first migrated channel set in the shared contract', () => {
    const declaredChannels = collectIpcContractChannels(contract)
    for (const channel of contractedChannels) {
      expect(declaredChannels.has(channel)).toBe(true)
    }
  })

  it('registers migrated main-process handlers through typedHandle', () => {
    const source = `${indexIpc}\n${mainIndex}\n${providerIpc}\n${workflowIpc}\n${pluginsIpc}\n${passthroughIpc}\n${browserIpc}\n${terminalIpc}\n${terminalPtyIpc}\n${hubThreadsIpc}\n${conversationIpc}\n${agentLoopIpc}\n${modelsIpc}\n${mcpIpc}\n${memoryIpc}\n${gitIpc}\n${workspaceIpc}\n${sddIpc}\n${missingIpc}\n${decisionIpc}\n${turnsIpc}`
    const typedChannels = collectFirstStringArgs(source, 'typedHandle')
    const directChannels = collectFirstStringArgs(source, 'ipcMain.handle')
    for (const channel of contractedChannels) {
      expect(typedChannels.has(channel)).toBe(true)
      expect(directChannels.has(channel)).toBe(false)
    }
  })

  it('invokes migrated preload channels through typedInvoke', () => {
    const typedChannels = collectFirstStringArgs(preload, 'typedInvoke')
    const directChannels = collectFirstStringArgs(preload, 'ipcRenderer.invoke')
    for (const channel of contractedChannels) {
      expect(typedChannels.has(channel)).toBe(true)
      expect(directChannels.has(channel)).toBe(false)
    }
  })

  it('keeps turn creation channels off bare IPC and Promise<any>', () => {
    expect(mainIndex).not.toMatch(/ipcMain\.handle\(\s*['"]turns:(?:create|retry)['"]/)
    expect(preload).not.toMatch(/ipcRenderer\.invoke\(\s*['"]turns:(?:create|retry)['"]/)
    expect(preload).toMatch(/typedInvoke\(\s*['"]turns:create['"]/)
    expect(preload).toMatch(/typedInvoke\(\s*['"]turns:retry['"]/)
    expect(contract).toMatch(/['"]turns:create['"]:\s*{\s*args:\s*\[payload: TurnCreateInputLike\]\s*result:\s*TurnCreateResultLike\s*}/)
    expect(contract).toMatch(/export type TurnRetryStrategyLike = ['"]reuse-selection['"] \| ['"]reoptimize['"]/)
    expect(contract).toMatch(/export interface TurnRetryInputLike\s*{\s*turnId: string\s*retryStrategy\?: TurnRetryStrategyLike\s*}/)
    expect(contract).toMatch(/['"]turns:retry['"]:\s*{\s*args:\s*\[input: TurnRetryInputLike\]\s*result:\s*TurnCreateResultLike\s*}/)
    expect(preload).toMatch(/create:\s*\(input: IpcArgs<['"]turns:create['"]>\[0\]\)/)
    expect(preload).toMatch(/retry:\s*\(input: IpcArgs<['"]turns:retry['"]>\[0\]\) => typedInvoke\(['"]turns:retry['"], input\)/)
    expect(readFileSync(join(__dirname, '../../../renderer/vite-env.d.ts'), 'utf-8')).not.toMatch(
      /(create:\s*\([^)]*\)\s*=>\s*Promise<any>|retry:\s*\([^)]*\)\s*=>\s*Promise<any>)/
    )
  })

  it('keeps sender-bound Decision IPC in the contract, preload, and central registrar', () => {
    expect(contract).toMatch(/['"]turns:listPendingDecisions['"]:\s*{\s*args:\s*\[threadId\?: string\]/)
    expect(contract).toMatch(/['"]turns:resolveDecision['"]:\s*{\s*args:\s*\[submission: DecisionSubmission\]/)
    expect(contract).toMatch(/function validateDecisionSubmission/)
    expect(preload).toMatch(/typedInvoke\(\s*['"]turns:listPendingDecisions['"]/)
    expect(preload).toMatch(/typedInvoke\(\s*['"]turns:resolveDecision['"]/)
    expect(indexIpc).toMatch(/registerDecisionIpc\(/)
    expect(decisionIpc).toMatch(/function registerDecisionIpc/)
    expect(decisionIpc).toMatch(/function senderScope/)
  })

  it('keeps durable queue IPC in the contract, preload, and central registrar', () => {
    expect(contract).toMatch(/['"]turns:listQueuedSubmissions['"]:\s*{\s*args:\s*\[threadId\?: string\]/)
    expect(contract).toMatch(/['"]turns:clearQueue['"]:\s*{\s*args:\s*\[threadId: string\]/)
    expect(contract).toMatch(/['"]turns:rerunInterrupted['"]:\s*{\s*args:\s*\[originalTurnId: string\]/)
    expect(preload).toMatch(/typedInvoke\(\s*['"]turns:listQueuedSubmissions['"]/)
    expect(preload).toMatch(/typedInvoke\(\s*['"]turns:clearQueue['"]/)
    expect(indexIpc).toMatch(/registerTurnsIpc\(/)
    expect(turnsIpc).toMatch(/function registerTurnsIpc/)
  })

  it('keeps main-process turn execution in the runner and central registrar', () => {
    expect(mainIndex).not.toContain('Legacy turns handlers')
    expect(mainIndex).not.toMatch(/typedHandle\(\s*['"]turns:/)
    expect(mainIndex).toMatch(/new WorkbenchTurnRunner(?:<[^>]+>)?\s*\(/)
    expect(mainIndex).toMatch(/new ThreadExecutionCoordinator\(/)
    expect(indexIpc).toMatch(/registerTurnsIpc\(/)
  })
})
