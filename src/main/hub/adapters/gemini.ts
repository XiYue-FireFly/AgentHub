import { StdioAgentAdapter } from './stdio-adapter'
import { locateGeminiBinary } from '../agent-locator'

export class GeminiAdapter extends StdioAgentAdapter {
  constructor() {
    super('gemini', 'Gemini CLI', locateGeminiBinary() || 'gemini', ['--skip-trust', '--output-format', 'text', '--prompt', ''])
    this.envOverrides = { GEMINI_CLI_TRUST_WORKSPACE: 'true' }
  }

  supportsModelOverride(): boolean {
    return true
  }

  protected modelArgsForOverride(args: string[], modelId: string): string[] {
    return args.some(arg => arg === '--model' || arg === '-m')
      ? args
      : ['--model', modelId, ...args]
  }

  protected formatExitError(code: number | null, detail: string): string {
    if (code === 55 || /trusted directory|trusted folders|FatalUntrustedWorkspaceError|GEMINI_CLI_TRUST_WORKSPACE|skip-trust/i.test(detail)) {
      return [
        'Gemini CLI 拒绝在未信任目录中运行。',
        'AgentHub 默认会使用 --skip-trust 与 GEMINI_CLI_TRUST_WORKSPACE=true 进行本次会话信任。',
        '如果你在设置里覆盖了 CLI 参数，请恢复默认参数，或在 Gemini 交互模式中信任该目录。',
        detail
      ].filter(Boolean).join('\n')
    }
    return super.formatExitError(code, detail)
  }
}
