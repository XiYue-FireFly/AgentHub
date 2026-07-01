import { execFileSync } from "node:child_process"
import { isAbsolute } from "node:path"
import { existsSync } from "node:fs"
import { getProviderManager } from "../providers/manager"
import { locateAgentCandidates, AgentBinaryCandidate } from "../hub/agent-locator"
import { AGENTS } from "../hub/agents"

export interface LocalAgentStatus {
  agentId: string
  label: string
  installed: boolean
  configured: boolean
  protocol?: string
  binary?: string
  args?: string
  version?: string
  manualOnly?: boolean
  candidateKind?: "cli" | "desktop"
  requiresPromptArg?: boolean
  note?: string
  loginState: "unknown" | "ready" | "needs-login" | "not-installed"
  candidates: AgentBinaryCandidate[]
  workspaceSession: "per-dispatch" | "persistent"
  diagnostic?: { code: string; message: string; action?: string }
  error?: string
}

const LOCAL_AGENTS = AGENTS.map(agent => ({
  agentId: agent.id,
  label: agent.id === "minimax-code" ? "OpenCode" : agent.name,
  versionArgs: ["--version"],
  manualOnly: false
}))

interface DetectableLocalAgent {
  agentId: string
  label: string
  versionArgs: string[]
  manualOnly: boolean
  candidateKind?: "cli" | "desktop"
  requiresPromptArg?: boolean
  note?: string
}

const CONSERVATIVE_LOCAL_CANDIDATES: DetectableLocalAgent[] = [
  { agentId: "gemini", label: "Gemini CLI", versionArgs: ["--version"], manualOnly: true, candidateKind: "cli" as const, requiresPromptArg: false, note: "CLI candidate. AgentHub can send prompts through stdin; add args only if this CLI needs them." },
  { agentId: "codebuddy", label: "CodeBuddy", versionArgs: ["--version"], manualOnly: true, candidateKind: "cli" as const, requiresPromptArg: false, note: "CLI candidate. AgentHub can send prompts through stdin; add args only if this CLI needs them." },
  { agentId: "antigravity", label: "Antigravity", versionArgs: ["--version"], manualOnly: true, candidateKind: "desktop" as const, requiresPromptArg: true, note: "Desktop/manual candidate. Use ACP or add non-interactive args containing {prompt} before dispatch." },
  { agentId: "mimocode", label: "Mimocode CLI", versionArgs: ["--version"], manualOnly: true, candidateKind: "cli" as const, requiresPromptArg: false, note: "CLI candidate. AgentHub can send prompts through stdin; add args only if this CLI needs them." },
  { agentId: "zcode", label: "ZCode CLI", versionArgs: ["--version"], manualOnly: true, candidateKind: "cli" as const, requiresPromptArg: false, note: "CLI candidate. AgentHub can send prompts through stdin; add args only if this CLI needs them." },
  { agentId: "reasonix", label: "Reasonix CLI/Desktop", versionArgs: ["--version"], manualOnly: true, candidateKind: "desktop" as const, requiresPromptArg: true, note: "Desktop/manual candidate. Use ACP or add non-interactive args containing {prompt} before dispatch." }
]

const DETECTABLE_LOCAL_AGENTS: DetectableLocalAgent[] = [...LOCAL_AGENTS, ...CONSERVATIVE_LOCAL_CANDIDATES]
let statusCache: { value: LocalAgentStatus[]; updatedAt: number } | null = null

function manualAgentDispatchReady(agent: { manualOnly?: boolean; requiresPromptArg?: boolean }, binding?: { protocol?: string; args?: string }): boolean {
  if (!agent.manualOnly) return true
  if (binding?.protocol === "acp") return true
  if (!agent.requiresPromptArg) return true
  return /\{prompt\}/i.test(binding?.args || "")
}

function readVersion(binary?: string, args: string[] = ["--version"]): string | undefined {
  const result = probeBinary(binary, args)
  return result.output
}

function probeBinary(binary?: string, args: string[] = ["--version"]): { available: boolean; output?: string; reason?: "empty" | "unsafe-command" | "missing" | "failed" } {
  if (!binary) return { available: false, reason: "empty" }

  const cmd = binary.trim()
  const safeCommands = ['claude', 'gemini', 'codebuddy', 'antigravity', 'mimocode', 'zcode', 'reasonix', 'npx', 'npm', 'node', 'python', 'python3']

  if (!isAbsolute(cmd) && !safeCommands.includes(cmd.toLowerCase())) {
    return { available: false, reason: "unsafe-command" }
  }

  if (isAbsolute(cmd) && !existsSync(cmd)) {
    return { available: false, reason: "missing" }
  }

  try {
    const output = execFileSync(cmd, args, { encoding: "utf-8", timeout: 2500, windowsHide: true }).trim().split(/\r?\n/)[0]
    return { available: true, output }
  } catch {
    return { available: false, reason: "failed" }
  }
}

export function detectLocalAgentStatuses(): LocalAgentStatus[] {
  const located = locateAgentCandidates()
  const bindings = getProviderManager().getBindings()
  return DETECTABLE_LOCAL_AGENTS.map(agent => {
    const binding = bindings.find(b => b.agentId === agent.agentId)
    const candidates = located[agent.agentId] ?? []
    const binary = (binding?.binary || candidates[0]?.path || "").trim() || undefined
    const isLocalProtocol = binding?.protocol === "stdio-plain" || binding?.protocol === "acp"
    const manualDispatchReady = manualAgentDispatchReady(agent, binding)
    const configuredProbe = binding?.binary ? probeBinary(binding.binary, agent.versionArgs) : undefined
    const configuredBinaryAvailable = configuredProbe?.available === true
    const userConfigured = !!binding && isLocalProtocol && !!binding.binary && manualDispatchReady && configuredBinaryAvailable
    const candidateInstalled = !agent.manualOnly && candidates.some(candidate => candidate.verification !== "manual")
    const installed = candidateInstalled || userConfigured
    const configured = userConfigured || (!agent.manualOnly && !!binding && isLocalProtocol && !binding.binary && candidates.length > 0)
    const agentNote = "note" in agent && typeof agent.note === "string" ? agent.note : undefined
    const candidateNote = candidates.find(candidate => typeof candidate.note === "string")?.note
    const staleConfiguredBinary = !!binding && isLocalProtocol && !!binding.binary && !configuredBinaryAvailable
    const diagnostic = staleConfiguredBinary
      ? {
          code: configuredProbe?.reason === "missing" ? "configured-binary-missing" : "configured-binary-unavailable",
          message: "Configured executable was not found or no longer responds. Reconfigure this local agent.",
          action: "reconfigure"
        }
      : undefined
    return {
      agentId: agent.agentId,
      label: agent.label,
      installed,
      configured,
      protocol: binding?.protocol || (binding ? "http" : undefined),
      binary,
      args: binding?.args,
      version: installed ? configuredProbe?.output || readVersion(binary, agent.versionArgs) : undefined,
      manualOnly: agent.manualOnly,
      candidateKind: "candidateKind" in agent ? agent.candidateKind : undefined,
      requiresPromptArg: "requiresPromptArg" in agent ? agent.requiresPromptArg : false,
      note: diagnostic?.message || (agent.manualOnly && binding?.binary && !manualDispatchReady
        ? "This desktop/manual candidate needs non-interactive args with {prompt}, or ACP protocol, before it can be dispatched."
        : agentNote || candidateNote),
      loginState: installed ? "unknown" : "not-installed",
      candidates,
      workspaceSession: "per-dispatch",
      diagnostic
    }
  })
}

export function getCachedLocalAgentStatuses(): LocalAgentStatus[] {
  if (statusCache) return statusCache.value
  return refreshLocalAgentStatusCache()
}

export function isUsableLocalAgentStatus(agent: LocalAgentStatus): boolean {
  if (!agent.agentId || (!agent.configured && !agent.installed)) return false
  if (agent.loginState === "needs-login" || agent.loginState === "not-installed") return false
  if (agent.configured && (agent.protocol === "stdio-plain" || agent.protocol === "acp") && !agent.binary?.trim()) return false
  if (agent.manualOnly && agent.requiresPromptArg && agent.protocol !== "acp" && !/\{prompt\}/i.test(agent.args || "")) return false
  return true
}

export function refreshLocalAgentStatusCache(): LocalAgentStatus[] {
  statusCache = { value: detectLocalAgentStatuses(), updatedAt: Date.now() }
  return statusCache.value
}

export function configureLocalAgent(agentId: string, patch: { binary?: string; args?: string; protocol?: "stdio-plain" | "acp" }): LocalAgentStatus[] {
  const agent = DETECTABLE_LOCAL_AGENTS.find(item => item.agentId === agentId)
  if (!agent) throw new Error(`Unsupported local agent: ${agentId}`)
  if (agent.manualOnly && !patch.binary?.trim()) throw new Error(`${agent.label} needs an explicit executable path before it can be used`)
  if (agent.manualOnly && agent.requiresPromptArg && (patch.protocol || "stdio-plain") !== "acp" && !/\{prompt\}/i.test(patch.args || "")) {
    throw new Error(`${agent.label} needs non-interactive CLI args containing {prompt}, or ACP protocol, before it can be used`)
  }
  const providerMgr = getProviderManager()
  const prev = providerMgr.getBinding(agentId)
  const protocol = patch.protocol || prev?.protocol || "stdio-plain"
  const isLocalProtocol = protocol === "stdio-plain" || protocol === "acp"
  providerMgr.upsertBinding({
    agentId,
    providerId: isLocalProtocol ? "local-cli" : prev?.providerId || "local-cli",
    modelId: isLocalProtocol ? "local" : prev?.modelId || "local",
    thinking: prev?.thinking || { mode: "auto", level: "medium", collapseInUI: true },
    protocol,
    binary: patch.binary ?? prev?.binary ?? "",
    args: patch.args ?? prev?.args ?? ""
  } as any)
  return refreshLocalAgentStatusCache()
}
