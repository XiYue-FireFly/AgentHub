import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readCodexConfig, readGeminiConfig } from "../local-models"

describe("local model config readers", () => {
  it("reads Codex model, auth and cached model catalog from local config files", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-codex-"))
    writeFileSync(join(root, "config.toml"), 'model = "gpt-4.1"\nbase_url = "https://api.example.test/v1"\n')
    writeFileSync(join(root, "auth.json"), JSON.stringify({ openai_api_key: "redacted" }))
    writeFileSync(join(root, "models_cache.json"), JSON.stringify({ models: [{ id: "gpt-4.1", label: "GPT 4.1" }] }))

    const config = readCodexConfig(root)

    expect(config.status).toBe("ok")
    expect(config.modelId).toBe("gpt-4.1")
    expect(config.authMode).toBe("api-key")
    expect(config.baseUrl).toBe("https://api.example.test/v1")
    expect(config.models?.map(model => model.id)).toContain("gpt-4.1")
  })

  it("reads Codex cc-switch model catalog path and context fields", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-codex-catalog-"))
    writeFileSync(join(root, "config.toml"), [
      'model = "gpt-5.1-codex"',
      'model_catalog_json = "cc-switch-model-catalog.json"',
      'model_context_window = 258000'
    ].join("\n"))
    writeFileSync(join(root, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "redacted" }))
    writeFileSync(join(root, "cc-switch-model-catalog.json"), JSON.stringify({
      models: [
        { slug: "gpt-5.1-codex", display_name: "GPT 5.1 Codex", max_context_window: 512000 },
        { slug: "codex-mini", display_name: "Codex Mini" }
      ]
    }))

    const config = readCodexConfig(root)

    expect(config.status).toBe("ok")
    expect(config.modelId).toBe("gpt-5.1-codex")
    expect(config.authMode).toBe("api-key")
    expect(config.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gpt-5.1-codex", label: "GPT 5.1 Codex", contextWindow: 512000 }),
      expect.objectContaining({ id: "codex-mini", label: "Codex Mini", contextWindow: 258000 })
    ]))
  })

  it("reads Gemini model and API key mode from local env/settings files", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-gemini-"))
    writeFileSync(join(root, ".env"), 'export GEMINI_MODEL="gemini-2.5-pro" # current model\nGEMINI_API_KEY=redacted\n')
    writeFileSync(join(root, "settings.json"), JSON.stringify({ baseUrl: "https://generativelanguage.googleapis.com" }))

    const config = readGeminiConfig(root)

    expect(config.status).toBe("ok")
    expect(config.modelId).toBe("gemini-2.5-pro")
    expect(config.authMode).toBe("api-key")
    expect(config.baseUrl).toBe("https://generativelanguage.googleapis.com")
  })

  it("ignores non-model Codex JSON objects instead of inventing model ids", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-codex-noise-"))
    writeFileSync(join(root, "config.toml"), "")
    writeFileSync(join(root, "models_cache.json"), JSON.stringify({ token: "not-a-model", metadata: { version: "1" } }))

    const config = readCodexConfig(root)

    expect(config.models).toEqual([])
  })

  it("does not invent Gemini models when only auth is present", () => {
    const root = mkdtempSync(join(tmpdir(), "agenthub-gemini-auth-only-"))
    writeFileSync(join(root, ".env"), "GEMINI_API_KEY=redacted\n")

    const config = readGeminiConfig(root)

    expect(config.status).toBe("partial")
    expect(config.authMode).toBe("api-key")
    expect(config.modelId).toBeUndefined()
    expect(config.models).toEqual([])
  })
})
