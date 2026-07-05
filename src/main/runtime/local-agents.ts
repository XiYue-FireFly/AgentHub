import { execFile } from "node:child_process"
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
let refreshInFlight: Promise<LocalAgentStatus[]> | null = null
let configuredRevalidationInFlight: Promise<void> | null = null
let lastConfiguredRevalidationAt = 0
const CONFIGURED_REVALIDATION_INTERVAL_MS = 5_000

function manualAgentDispatchReady(agent: { manualOnly?: boolean; requiresPromptArg?: boolean }, binding?: { protocol?: string; args?: string }): boolean {
  if (!agent.manualOnly) return true
  if (binding?.protocol === "acp") return true
  if (!agent.requiresPromptArg) return true
  return /\{prompt\}/i.test(binding?.args || "")
}

async function readVersion(binary?: string, args: string[] = ["--version"]): Promise<string | undefined> {
  const result = await probeBinary(binary, args)
  return result.output
}

async function probeBinary(binary?: string, args: string[] = ["--version"]): Promise<{ available: boolean; output?: string; reason?: "empty" | "unsafe-command" | "missing" | "failed" }> {
  if (!binary) return { available: false, reason: "empty" }

  const cmd = binary.trim()
  const safeCommands = ['claude', 'gemini', 'codebuddy', 'antigravity', 'mimocode', 'zcode', 'reasonix', 'npx', 'npm', 'node', 'python', 'python3']

  if (!isAbsolute(cmd) && !safeCommands.includes(cmd.toLowerCase())) {
    return { available: false, reason: "unsafe-command" }
  }

  if (isAbsolute(cmd) && !existsSync(cmd)) {
    return { available: false, reason: "missing" }
  }

  return new Promise(resolve => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 2500, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ available: false, reason: "failed" })
        return
      }
      const output = String(stdout || "").trim().split(/\r?\n/)[0]
      resolve({ available: true, output })
    })
  })
}

function unprobedConfiguredBinaryAvailable(binary?: string): boolean {
  if (!binary?.trim()) return false
  const cmd = binary.trim()
  return isAbsolute(cmd) && existsSync(cmd)
}

function buildCachedFallbackStatuses(): LocalAgentStatus[] {
  const bindings = getProviderManager().getBindings()
  return DETECTABLE_LOCAL_AGENTS.map(agent => {
    const binding = bindings.find(b => b.agentId === agent.agentId)
    const isLocalProtocol = binding?.protocol === "stdio-plain" || binding?.protocol === "acp"
    const manualDispatchReady = manualAgentDispatchReady(agent, binding)
    const configuredBinaryAvailable = unprobedConfiguredBinaryAvailable(binding?.binary)
    const userConfigured = !!binding && isLocalProtocol && !!binding.binary && manualDispatchReady && configuredBinaryAvailable
    const staleConfiguredBinary = !!binding && isLocalProtocol && !!binding.binary && isAbsolute(binding.binary.trim()) && !configuredBinaryAvailable
    const diagnostic = staleConfiguredBinary
      ? {
          code: "configured-binary-missing",
          message: "Configured executable was not found or no longer responds. Reconfigure this local agent.",
          action: "reconfigure"
        }
      : undefined
    return {
      agentId: agent.agentId,
      label: agent.label,
      installed: userConfigured,
      configured: userConfigured,
      protocol: binding?.protocol || (binding ? "http" : undefined),
      binary: binding?.binary?.trim() || undefined,
      args: binding?.args,
      manualOnly: agent.manualOnly,
      candidateKind: "candidateKind" in agent ? agent.candidateKind : undefined,
      requiresPromptArg: "requiresPromptArg" in agent ? agent.requiresPromptArg : false,
      note: diagnostic?.message || ("note" in agent && typeof agent.note === "string" ? agent.note : undefined),
      loginState: userConfigured ? "unknown" : "not-installed",
      candidates: [],
      workspaceSession: "per-dispatch",
      diagnostic
    }
  })
}

export async function detectLocalAgentStatuses(): Promise<LocalAgentStatus[]> {
  const located = locateAgentCandidates()
  const bindings = getProviderManager().getBindings()
  return Promise.all(DETECTABLE_LOCAL_AGENTS.map(async agent => {
    const binding = bindings.find(b => b.agentId === agent.agentId)
    const candidates = located[agent.agentId] ?? []
    const binary = (binding?.binary || candidates[0]?.path || "").trim() || undefined
    const isLocalProtocol = binding?.protocol === "stdio-plain" || binding?.protocol === "acp"
    const manualDispatchReady = manualAgentDispatchReady(agent, binding)
    const configuredProbe = binding?.binary ? await probeBinary(binding.binary, agent.versionArgs) : undefined
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
      version: installed ? configuredProbe?.output || await readVersion(binary, agent.versionArgs) : undefined,
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
  }))
}

export function getCachedLocalAgentStatuses(): LocalAgentStatus[] {
  if (statusCache) {
    scheduleConfiguredStatusRevalidation()
    return statusCache.value
  }
  scheduleFullStatusRefresh()
  return buildCachedFallbackStatuses()
}

export function isUsableLocalAgentStatus(agent: LocalAgentStatus): boolean {
  if (!agent.agentId || (!agent.configured && !agent.installed)) return false
  if (agent.loginState === "needs-login" || agent.loginState === "not-installed") return false
  if (agent.configured && (agent.protocol === "stdio-plain" || agent.protocol === "acp") && !agent.binary?.trim()) return false
  if (agent.manualOnly && agent.requiresPromptArg && agent.protocol !== "acp" && !/\{prompt\}/i.test(agent.args || "")) return false
  return true
}

export async function refreshLocalAgentStatusCache(): Promise<LocalAgentStatus[]> {
  if (!refreshInFlight) {
    refreshInFlight = detectLocalAgentStatuses()
      .then(value => {
        statusCache = { value, updatedAt: Date.now() }
        return value
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

function scheduleFullStatusRefresh(): void {
  if (refreshInFlight) return
  const timer = setTimeout(() => {
    void refreshLocalAgentStatusCache().catch(() => {})
  }, 0)
  timer.unref?.()
}

function scheduleConfiguredStatusRevalidation(): void {
  if (!statusCache || configuredRevalidationInFlight) return
  const now = Date.now()
  if (now - lastConfiguredRevalidationAt < CONFIGURED_REVALIDATION_INTERVAL_MS) return
  lastConfiguredRevalidationAt = now
  const cached = statusCache.value
  configuredRevalidationInFlight = revalidateConfiguredStatuses(cached)
    .finally(() => {
      configuredRevalidationInFlight = null
    })
}

async function revalidateConfiguredStatuses(cached: LocalAgentStatus[]): Promise<void> {
  const bindings = getProviderManager().getBindings()
  const next = await Promise.all(cached.map(async status => {
    const agent = DETECTABLE_LOCAL_AGENTS.find(item => item.agentId === status.agentId)
    const binding = bindings.find(b => b.agentId === status.agentId)
    const isLocalProtocol = binding?.protocol === "stdio-plain" || binding?.protocol === "acp"
    if (!agent || !binding?.binary || !isLocalProtocol) return status

    const manualDispatchReady = manualAgentDispatchReady(agent, binding)
    const probe = await probeBinary(binding.binary, agent.versionArgs)
    const configured = manualDispatchReady && probe.available
    if (configured) {
      return {
        ...status,
        installed: true,
        configured: true,
        binary: binding.binary.trim(),
        args: binding.args,
        protocol: binding.protocol,
        version: probe.output || status.version,
        loginState: status.loginState === "not-installed" ? "unknown" : status.loginState,
        diagnostic: undefined,
        note: status.manualOnly && !manualDispatchReady
          ? "This desktop/manual candidate needs non-interactive args with {prompt}, or ACP protocol, before it can be dispatched."
          : status.note
      } satisfies LocalAgentStatus
    }

    const reason = probe.reason === "missing" ? "configured-binary-missing" : "configured-binary-unavailable"
    return {
      ...status,
      installed: false,
      configured: false,
      binary: binding.binary.trim(),
      args: binding.args,
      protocol: binding.protocol,
      version: undefined,
      loginState: "not-installed" as const,
      diagnostic: {
        code: reason,
        message: "Configured executable was not found or no longer responds. Reconfigure this local agent.",
        action: "reconfigure"
      },
      note: "Configured executable was not found or no longer responds. Reconfigure this local agent."
    } satisfies LocalAgentStatus
  }))

  statusCache = { value: next, updatedAt: Date.now() }
}

export async function configureLocalAgent(agentId: string, patch: { binary?: string; args?: string; protocol?: "stdio-plain" | "acp" }): Promise<LocalAgentStatus[]> {
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
