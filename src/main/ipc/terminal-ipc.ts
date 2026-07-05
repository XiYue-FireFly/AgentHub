import { getTerminalRuntime } from '../runtime/terminal'
import { buildTerminalPrompt, suggestCommandPrompt, explainOutputPrompt } from '../runtime/terminal-ai'
import { typedHandle } from './typed-ipc'

export function registerTerminalIpc(): void {
  typedHandle("terminal:run", (_event, input) => getTerminalRuntime().run(input))
  typedHandle("terminal:cancel", (_event, runId) => getTerminalRuntime().cancel(runId))
  typedHandle("terminal:history", () => getTerminalRuntime().history())

  typedHandle("terminalAi:buildPrompt", (_e, userPrompt, context) => buildTerminalPrompt(userPrompt, context))
  typedHandle("terminalAi:suggestCommand", (_e, intent, context) => suggestCommandPrompt(intent, context))
  typedHandle("terminalAi:explainOutput", (_e, context) => explainOutputPrompt(context))
}
