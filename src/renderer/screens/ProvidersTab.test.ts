import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildClaudeProviderReorderIds } from "./ProvidersTab"

describe("buildClaudeProviderReorderIds", () => {
  it("reorders non-active providers and keeps active provider at its home index", () => {
    expect(buildClaudeProviderReorderIds([
      { id: "a" },
      { id: "b", isActive: true },
      { id: "c" }
    ], 1, 0)).toEqual(["c", "b", "a"])
  })

  it("reorders all providers when there is no active provider", () => {
    expect(buildClaudeProviderReorderIds([
      { id: "a" },
      { id: "b" },
      { id: "c" }
    ], 0, 2)).toEqual(["b", "c", "a"])
  })

  it("clamps destination index and ignores invalid source", () => {
    expect(buildClaudeProviderReorderIds([
      { id: "a" },
      { id: "b" }
    ], 0, 99)).toEqual(["b", "a"])
    expect(buildClaudeProviderReorderIds([
      { id: "a" },
      { id: "b" }
    ], 10, 0)).toEqual(["a", "b"])
  })

  it("auto-fetches provider models from the current local API URL and key", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/screens/ProvidersTab.tsx"), "utf8")

    expect(source).toContain("autoFetchSignaturesRef")
    expect(source).toContain("providerInputBaseUrl(provider)")
    expect(source).toContain("providerInputApiKey(provider)")
    expect(source).toContain("fetchModels(provider, { automatic: true })")
    expect(source).toContain("providerRequestApiKey(provider)")
    expect(source).toContain("apiKey: providerRequestApiKey(provider)")
    expect(source).toContain("commitProviderApiKey(provider)")
  })
})
