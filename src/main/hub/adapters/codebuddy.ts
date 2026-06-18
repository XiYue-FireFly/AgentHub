import { StdioAgentAdapter } from './stdio-adapter'
import { codeBuddyCandidates } from '../agent-locator'

export class CodeBuddyAdapter extends StdioAgentAdapter {
  constructor() {
    super('codebuddy', 'CodeBuddy', codeBuddyCandidates()[0]?.path || 'codebuddy', [])
  }
}
