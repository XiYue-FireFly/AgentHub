import type {
  PromptDecisionCapability,
  PromptOrigin,
  PromptPolicy,
  PromptSessionScope
} from "../../shared/prompt-contract"

export interface PromptIngressRegistration {
  readonly policy: PromptPolicy
  readonly scope: PromptSessionScope
  readonly decisionCapability: PromptDecisionCapability
}

const registration = (
  policy: PromptPolicy,
  scope: PromptSessionScope,
  decisionCapability: PromptDecisionCapability
): PromptIngressRegistration => Object.freeze({ policy, scope, decisionCapability })

export const PROMPT_INGRESS_REGISTRY: Readonly<Record<PromptOrigin, PromptIngressRegistration>> = Object.freeze({
  "workbench:create": registration("optimize", "root", "desktop-inline"),
  "workbench:retry": registration("optimize", "root", "desktop-inline"),
  "hub:websocket": registration("optimize", "root", "websocket"),
  "cli:headless": registration("optimize", "root", "terminal"),
  "quick-complete:prompt-enhancer": registration("structured", "draft", "desktop-inline"),
  "quick-complete:sdd-requirements": registration("structured", "root", "none"),
  "quick-complete:inline-edit": registration("structured", "root", "none"),
  "quick-complete:browser-summary": registration("structured", "root", "none"),
  "quick-complete:browser-analysis": registration("structured", "root", "none"),
  "external-proxy:openai": registration("passthrough", "none", "client-owned"),
  "external-proxy:anthropic": registration("passthrough", "none", "client-owned"),
  "external-proxy:agent": registration("passthrough", "none", "client-owned"),
  "internal:schedule": registration("internal", "none", "none"),
  "internal:agentic-round": registration("internal", "none", "none"),
  "internal:prompt-candidate": registration("internal", "none", "none"),
  "internal:loop-candidate": registration("internal", "none", "none"),
  "internal:loop-synthesizer": registration("internal", "none", "none"),
  "internal:loop-judge": registration("internal", "none", "none"),
  "internal:loop-executor": registration("internal", "none", "none"),
  "internal:model-diagnostic": registration("internal", "none", "none")
})

export function requirePromptIngress(origin: PromptOrigin): PromptIngressRegistration {
  const found = PROMPT_INGRESS_REGISTRY[origin]
  if (!found) throw new Error("Unregistered Prompt ingress: " + String(origin))
  return found
}
