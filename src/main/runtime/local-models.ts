import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

const DEFAULT_CONTEXT_WINDOW = 258_000

export type LocalModelAuthMode = "api-key" | "oauth" | "unknown" | "missing"
export type LocalModelStatus = "ok" | "missing" | "partial" | "error"

export interface LocalModelInfo {
  id: string
  label?: string
  contextWindow?: number
  capabilities?: string[]
}

export interface LocalModelConfig {
  agentId: string
  source: "codex" | "gemini"
  modelId?: string
  authMode?: LocalModelAuthMode
  baseUrl?: string
  configPath: string
  status: LocalModelStatus
  error?: string
  models?: LocalModelInfo[]
}

export function scanLocalModels(agentId?: string | null): LocalModelConfig[] {
  const ids = agentId ? [agentId] : ["codex", "gemini"]
  return ids.flatMap(id => {
    if (id === "codex") return [readCodexConfig()]
    if (id === "gemini") return [readGeminiConfig()]
    return []
  })
}

export function readLocalModelConfig(agentId: string): LocalModelConfig | null {
  return scanLocalModels(agentId)[0] ?? null
}

export function readCodexConfig(root = join(homedir(), ".codex")): LocalModelConfig {
  const configPath = join(root, "config.toml")
  try {
    if (!existsSync(root)) return missing("codex", "codex", configPath)
    const toml = readText(configPath)
    const auth = readJson(join(root, "auth.json"))
    const cache = readJson(join(root, "models_cache.json"))
    const defaultContextWindow = findTomlNumber(toml, "model_context_window") || DEFAULT_CONTEXT_WINDOW
    const catalogs = codexCatalogPaths(root, toml).flatMap(path => extractCodexModels(readJson(path), defaultContextWindow))
    const models = extractCodexModels(cache, defaultContextWindow).concat(catalogs)
    return {
      agentId: "codex",
      source: "codex",
      configPath,
      status: toml || auth || models.length ? "ok" : "partial",
      modelId: findTomlString(toml, "model") || firstModel(models),
      baseUrl: findTomlString(toml, "base_url") || findTomlString(toml, "baseUrl"),
      authMode: authModeFromCodexAuth(auth),
      models: uniqueModels(models)
    }
  } catch (e: any) {
    return errorConfig("codex", "codex", configPath, e)
  }
}

export function readGeminiConfig(root = join(homedir(), ".gemini")): LocalModelConfig {
  const envPath = join(root, ".env")
  const settingsPath = join(root, "settings.json")
  try {
    if (!existsSync(root)) return missing("gemini", "gemini", settingsPath)
    const env = parseDotEnv(readText(envPath))
    const settings = readJson(settingsPath)
    const modelId = stringValue(env.GEMINI_MODEL) ||
      stringValue(settings?.model) ||
      stringValue(settings?.selectedModel) ||
      stringValue(settings?.mcp?.model)
    const apiKey = stringValue(env.GEMINI_API_KEY) || stringValue(settings?.apiKey)
    const oauth = !!settings?.auth || !!settings?.oauth || !!settings?.credentials
    const hasModel = !!modelId
    return {
      agentId: "gemini",
      source: "gemini",
      configPath: existsSync(settingsPath) ? settingsPath : envPath,
      status: hasModel ? "ok" : "partial",
      modelId,
      authMode: apiKey ? "api-key" : oauth ? "oauth" : "unknown",
      baseUrl: stringValue(env.GEMINI_BASE_URL) || stringValue(settings?.baseUrl),
      models: modelId ? [{ id: modelId, label: modelId }] : []
    }
  } catch (e: any) {
    return errorConfig("gemini", "gemini", settingsPath, e)
  }
}

function readText(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : ""
  } catch {
    return ""
  }
}

function readJson(path: string): any {
  const text = readText(path)
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseDotEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = stripInlineComment(line.trim().replace(/^export\s+/, ""))
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    env[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return env
}

function stripInlineComment(value: string): string {
  let quote: string | null = null
  let escaped = false
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "#" && (i === 0 || /\s/.test(value[i - 1] || ""))) return value.slice(0, i).trim()
  }
  return value
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\(["'\\#])/g, "$1")
  }
  return trimmed
}

function findTomlString(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`, "m"))
  return match?.[1]
}

function findTomlNumber(text: string, key: string): number | undefined {
  const match = text.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*([0-9][0-9_]*)`, "m"))
  return match ? numberValue(Number(match[1].replace(/_/g, ""))) : undefined
}

function codexCatalogPaths(root: string, toml: string): string[] {
  const configured = findTomlString(toml, "model_catalog_json")
  const paths: string[] = []
  if (configured) paths.push(isAbsolute(configured) ? configured : resolve(root, configured))
  paths.push(join(root, "cc-switch-model-catalog.json"))
  paths.push(join(root, "model_catalog_json"))
  return uniqueStrings(paths)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function extractCodexModels(value: any, fallbackContextWindow?: number): LocalModelInfo[] {
  if (!value) return []
  const rows = modelRows(value)
  return rows.flatMap((item: any): LocalModelInfo[] => {
    if (!item) return []
    if (typeof item === "string") return []
    const id = stringValue(item.slug) || stringValue(item.id) || stringValue(item.model) || stringValue(item.name)
    if (!id) return []
    const contextWindow = numberValue(item.contextWindow) ||
      numberValue(item.context_window) ||
      numberValue(item.contextWindowTokens) ||
      numberValue(item.inputTokenLimit) ||
      numberValue(item.max_context_window) ||
      numberValue(item.model_context_window) ||
      fallbackContextWindow
    const capabilities = Array.isArray(item.capabilities) ? item.capabilities.map(String) : undefined
    return [{
      id,
      label: stringValue(item.label) || stringValue(item.displayName) || stringValue(item.display_name) || id,
      contextWindow,
      capabilities
    }]
  })
}

function modelRows(value: any): any[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  for (const key of ["models", "model_catalog", "modelCatalog", "items", "data"]) {
    if (Array.isArray(value?.[key])) return value[key]
  }
  if (typeof value === "object" && Object.values(value).every(isModelLikeValue)) return Object.values(value)
  return []
}

function isModelLikeValue(value: any): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return ["slug", "id", "model", "name"].some(key => typeof value[key] === "string" && value[key].trim())
}

function authModeFromCodexAuth(auth: any): LocalModelAuthMode {
  if (!auth) return "missing"
  if (auth.openai_api_key || auth.OPENAI_API_KEY || auth.api_key || auth.apiKey) return "api-key"
  if (auth.tokens || auth.oauth || auth.refresh_token || auth.access_token) return "oauth"
  return "unknown"
}

function uniqueModels(models: LocalModelInfo[]): LocalModelInfo[] {
  const seen = new Set<string>()
  const out: LocalModelInfo[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

function firstModel(models: Array<{ id: string }>): string | undefined {
  return models[0]?.id
}

function stringValue(value: any): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: any): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function missing(agentId: string, source: "codex" | "gemini", configPath: string): LocalModelConfig {
  return { agentId, source, configPath, status: "missing", authMode: "missing", models: [] }
}

function errorConfig(agentId: string, source: "codex" | "gemini", configPath: string, e: any): LocalModelConfig {
  return { agentId, source, configPath, status: "error", error: e?.message || String(e), models: [] }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
