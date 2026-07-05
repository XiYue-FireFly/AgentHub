/**
 * Real agent detection - no mock data.
 */
import { execFileSync, execFile } from "child_process";
import { getProviderManager, isProviderRuntimeUsable } from "../providers/manager";
import { AGENTS } from "./agents";

export interface DetectedAgent {
  id: string;
  name: string;
  found: boolean;
  version?: string;
  path?: string;
  capabilities: string[];
  providerId?: string | null;
  modelId?: string | null;
  baseUrl?: string | null;
  reachable?: boolean;
  latencyMs?: number | null;
  error?: string | null;
}

// 已知 agent 的探测项派生自 manifest（有 probeBinary 的）；marvis 无 CLI 不参与探测。
// 额外的发现型 CLI（非 AgentHub 内置 agent）单列，用于扫描机器上还装了哪些工具。
const EXTRA_PROBES = [
  { id: "aider", name: "Aider", binary: "aider", caps: ["coding", "pair-programming"] },
  { id: "goose", name: "Goose", binary: "goose", caps: ["automation", "coding"] },
  { id: "gemini", name: "Gemini CLI", binary: "gemini", caps: ["analysis", "coding"] },
  { id: "mimocode", name: "Mimocode CLI", binary: "mimocode", caps: ["coding", "cli"] },
  { id: "zcode", name: "ZCode CLI", binary: "zcode", caps: ["coding", "cli"] },
  { id: "reasonix", name: "Reasonix CLI", binary: "reasonix", caps: ["reasoning", "cli"] },
  { id: "copilot", name: "Copilot CLI", binary: "copilot", caps: ["coding", "cli"] }
];

const CLI_PROBES = [
  ...AGENTS.filter(a => a.probeBinary).map(a => ({ id: a.id, name: a.name, binary: a.probeBinary as string, caps: a.caps })),
  ...EXTRA_PROBES
];

// MED-14: Use platform-appropriate binary lookup command
const WHICH_CMD = process.platform === 'win32' ? 'where.exe' : 'which';

function probe(probe: typeof CLI_PROBES[0]) {
  try {
    const out = execFileSync(probe.binary, ["--version"], {
      timeout: 3000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    const version = out.trim().split(/\r?\n/)[0];
    let binaryPath = probe.binary;
    try {
      binaryPath = execFileSync(WHICH_CMD, [probe.binary], {
        timeout: 2000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }).trim().split(/\r?\n/)[0].trim();
    } catch {}
    return { id: probe.id, name: probe.name, found: true, version, path: binaryPath, capabilities: probe.caps };
  } catch {
    return { id: probe.id, name: probe.name, found: false, capabilities: probe.caps };
  }
}

// MED-13: Async probe using execFile + Promise.all for non-blocking detection
function probeAsync(probe: typeof CLI_PROBES[0]): Promise<DetectedAgent> {
  return new Promise(resolve => {
    execFile(probe.binary, ["--version"], {
      timeout: 3000,
      encoding: "utf-8",
      windowsHide: true
    }, (err: Error | null, stdout: string) => {
      if (err) {
        resolve({ id: probe.id, name: probe.name, found: false, capabilities: probe.caps });
        return;
      }
      const version = stdout.trim().split(/\r?\n/)[0];
      execFile(WHICH_CMD, [probe.binary], {
        timeout: 2000,
        encoding: "utf-8",
        windowsHide: true
      }, (e2: Error | null, pathOut: string) => {
        const binaryPath = e2 ? probe.binary : pathOut.trim().split(/\r?\n/)[0].trim();
        resolve({ id: probe.id, name: probe.name, found: true, version, path: binaryPath, capabilities: probe.caps });
      });
    });
  });
}

function buildProviderAgents(): DetectedAgent[] {
  const mgr = getProviderManager();
  const bindings = mgr.getBindings();
  return bindings.map(b => {
    const resolved = mgr.resolveBinding(b.agentId);
    const provider = resolved && resolved.provider;
    const health = provider && provider.health;
    const caps = b.agentId === "codex"
      ? ["coding", "debug", "refactor", "api"]
      : b.agentId === "claude"
      ? ["analysis", "writing", "translation", "research"]
      : b.agentId === "openclaw"
      ? ["automation", "deploy", "pipeline", "script"]
      : ["tools", "system", "automation"];
    return {
      id: b.agentId,
      name: b.agentId.charAt(0).toUpperCase() + b.agentId.slice(1),
      found: isProviderRuntimeUsable(provider),
      capabilities: caps,
      providerId: provider && provider.id,
      modelId: resolved && resolved.model.id,
      baseUrl: provider && provider.baseUrl,
      reachable: health ? !!health.reachable : undefined,
      latencyMs: health && health.latencyMs,
      error: health && health.error
    };
  });
}

export function detectAgents() {
  return buildProviderAgents().concat(CLI_PROBES.map(probe) as any);
}

export async function detectAgentsAsync() {
  const mgr = getProviderManager();
  for (const p of mgr.getEnabledProviders()) {
    await mgr.checkProviderHealth(p.id);
  }
  const providerAgents = buildProviderAgents();
  // MED-13: Use async probes with Promise.all instead of blocking execFileSync
  const cliAgents = await Promise.all(CLI_PROBES.map(probeAsync));
  return providerAgents.concat(cliAgents as any);
}
