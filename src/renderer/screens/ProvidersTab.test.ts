import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildClaudeProviderReorderIds, buildProviderFetchModelsOverride, isMaskedProviderApiKey } from "./ProvidersTab"

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
    expect(source).toContain("buildProviderFetchModelsOverride")
    expect(source).toContain("commitProviderApiKey(provider)")
  })

  it("omits undefined apiKey from fetchModels override payloads", () => {
    const payload = buildProviderFetchModelsOverride({
      baseUrl: "https://api.example.com/v1",
      apiKey: undefined,
      kind: "openai-compatible"
    })

    expect(Object.prototype.hasOwnProperty.call(payload, "apiKey")).toBe(false)
    expect(payload).toEqual({
      baseUrl: "https://api.example.com/v1",
      kind: "openai-compatible"
    })
  })

  it("keeps real API keys and excludes masked API keys from model fetch payloads", () => {
    expect(isMaskedProviderApiKey("********")).toBe(true)
    expect(isMaskedProviderApiKey("••••••••")).toBe(true)
    expect(isMaskedProviderApiKey("sk-real")).toBe(false)

    expect(buildProviderFetchModelsOverride({
      baseUrl: "https://api.example.com/v1",
      apiKey: "********",
      kind: "openai-compatible"
    })).not.toHaveProperty("apiKey")

    expect(buildProviderFetchModelsOverride({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-real",
      kind: "openai-compatible"
    })).toMatchObject({ apiKey: "sk-real" })
  })
})
