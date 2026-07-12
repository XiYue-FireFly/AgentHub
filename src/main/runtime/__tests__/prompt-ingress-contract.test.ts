import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PROMPT_ORIGINS, type PromptPolicy } from "../../../shared/prompt-contract"
import {
  PROMPT_INGRESS_REGISTRY,
  requirePromptIngress
} from "../prompt-ingress-registry"

const ROOT = process.cwd()

const source = (file: string): string => readFileSync(join(ROOT, file), "utf8")

const EXPECTED_ROOT_FUNNELS = [
  {
    file: "src/main/runtime/workbench-turn-runner.ts",
    origins: ["workbench:create", "workbench:retry"],
    marker: "promptPreparationService.prepareRoot({"
  },
  {
    file: "src/main/index.ts",
    origins: ["hub:websocket"],
    marker: "promptPreparationService.prepareRoot({"
  },
  {
    file: "src/main/runtime/headless-run.ts",
    origins: ["cli:headless"],
    marker: "prepareHeadlessPrompt"
  },
  {
    file: "src/main/ipc/missing-ipc.ts",
    origins: [] as readonly string[],
    marker: 'typedHandle("ai:quickComplete"',
    requiredRegistration: "requirePromptIngress(input.origin)"
  }
] as const

const EXPECTED_NON_ROOT_FUNNELS = [
  {
    file: "src/main/ipc/missing-ipc.ts",
    origins: ["internal:prompt-candidate"],
    marker: "typedHandle('ai:promptCandidates'",
    requiredRegistration: "requirePromptIngress(input.origin)",
    sectionOnly: true
  },
  {
    file: "src/main/routing/proxy.ts",
    origins: ["external-proxy:openai", "external-proxy:anthropic", "external-proxy:agent"],
    marker: "streamWithFailover"
  },
  {
    file: "src/main/runtime/schedule-helpers.ts",
    origins: ["internal:schedule"],
    marker: "dispatcher.dispatch(stepPrompt"
  },
  {
    file: "src/main/agentic/executor.ts",
    origins: ["internal:agentic-round"],
    marker: "runAgenticHttp"
  },
  {
    file: "src/main/runtime/prompt-candidate-provider.ts",
    origins: ["internal:prompt-candidate"],
    marker: "createPromptCandidateProviderInvoker"
  },
  {
    file: "src/main/runtime/models-center.ts",
    origins: ["internal:model-diagnostic"],
    marker: "testModelRoute"
  }
] as const

const DIRECT_PROVIDER_STREAMS = [
  { file: "src/main/ipc/missing-ipc.ts", pattern: /client\.stream\s*\(\s*\{/gu, count: 2 },
  { file: "src/main/runtime/prompt-candidate-provider.ts", pattern: /\.stream\s*\(\s*\{/gu, count: 1 },
  { file: "src/main/agentic/executor.ts", pattern: /client\.stream\s*\(\s*\{/gu, count: 1 },
  { file: "src/main/routing/proxy.ts", pattern: /client\.stream\s*\(\s*\{/gu, count: 1 },
  { file: "src/main/runtime/models-center.ts", pattern: /client\.stream\s*\(\s*\{/gu, count: 1 }
] as const

function policyCounts(): Record<PromptPolicy, number> {
  const counts: Record<PromptPolicy, number> = {
    optimize: 0,
    structured: 0,
    passthrough: 0,
    internal: 0
  }
  for (const registration of Object.values(PROMPT_INGRESS_REGISTRY)) {
    counts[registration.policy] += 1
  }
  return counts
}

describe("Prompt ingress contract", () => {
  it("registers every declared origin exactly once with the expected policy counts", () => {
    expect(Object.keys(PROMPT_INGRESS_REGISTRY).sort()).toEqual([...PROMPT_ORIGINS].sort())
    for (const origin of PROMPT_ORIGINS) {
      expect(() => requirePromptIngress(origin)).not.toThrow()
    }
    expect(policyCounts()).toEqual({ optimize: 4, structured: 5, passthrough: 3, internal: 8 })
  })

  it.each(EXPECTED_ROOT_FUNNELS)("$file prepares every declared root origin", entry => {
    const content = source(entry.file)
    expect(content).toContain(entry.marker)
    for (const origin of entry.origins) expect(content).toContain(origin)
    if ("requiredRegistration" in entry) expect(content).toContain(entry.requiredRegistration)
  })

  it("runs the CLI root through the shared prompt core instead of private heuristics", () => {
    const headless = source("src/main/runtime/headless-run.ts")

    expect(headless).toContain('from "../../prompt-core/prompt-preparation-core.ts"')
    expect(headless).toContain("startPromptPreparation")
    expect(headless).toContain("analyzePrompt")
    expect(headless).toContain("shouldGeneratePromptCandidates")
    expect(headless).toContain("finalizePromptEnvelope")
    expect(headless).not.toContain("function optimizeHeadlessPrompt")
    expect(headless).not.toContain("function requiresHeadlessPromptChoice")
  })

  it.each(EXPECTED_NON_ROOT_FUNNELS)("$file registers every non-root origin without creating a root session", entry => {
    const content = source(entry.file)
    expect(content).toContain(entry.marker)
    for (const origin of entry.origins) expect(content).toContain(origin)
    if ("requiredRegistration" in entry) expect(content).toContain(entry.requiredRegistration)
    const section = "sectionOnly" in entry && entry.sectionOnly
      ? content.slice(content.indexOf(entry.marker))
      : content
    expect(section).not.toContain("prepareRoot(")
  })

  it("passes an explicit dispatch envelope to every direct ProviderClient stream", () => {
    for (const { file, pattern, count } of DIRECT_PROVIDER_STREAMS) {
      const content = source(file)
      const calls = [...content.matchAll(pattern)]
      expect(calls, file).toHaveLength(count)
      for (const call of calls) {
        const invocation = content.slice(call.index, call.index + 1_200)
        expect(invocation, `${file} stream at ${call.index}`).toContain("dispatchEnvelope")
      }
    }
  })

  it("requires Dispatcher to build envelopes before ProviderClient, stdio, and ACP calls", () => {
    const dispatcher = source("src/main/hub/dispatcher.ts")
    expect(dispatcher).toContain("private prepareDispatchEnvelope")
    expect(dispatcher.match(/prepareDispatchEnvelope\(/gu)).toHaveLength(5)
    expect(dispatcher).toContain("{ messages, systemPrompt, thinkingOverride: resolved.thinking, signal: abortController.signal, dispatchEnvelope")
    expect(dispatcher).toContain("{ messages, systemPrompt, thinkingOverride: thinking, signal: abortController.signal, dispatchEnvelope")
    expect(dispatcher).toContain("protocol: 'stdio'")
    expect(dispatcher).toContain("protocol: 'acp'")
  })

  it("keeps internal child funnels out of root preparation while retaining root lineage", () => {
    const schedule = source("src/main/runtime/schedule-helpers.ts")
    const agentic = source("src/main/agentic/executor.ts")
    const candidates = source("src/main/runtime/prompt-candidate-provider.ts")

    expect(schedule).toContain("childDispatchLineage(rootLineage, parentDispatchId, \"internal:schedule\")")
    expect(agentic).toContain("childDispatchLineage(rootLineage, previousDispatchId, 'internal:agentic-round')")
    expect(candidates).toContain("origin: 'internal:prompt-candidate'")
    expect(schedule).not.toContain("prepareRoot(")
    expect(agentic).not.toContain("prepareRoot(")
    expect(candidates).not.toContain("prepareRoot(")
  })
})
