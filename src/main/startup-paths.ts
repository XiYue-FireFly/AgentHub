import { app } from "electron"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { join, resolve } from "path"

const APP_NAME = "AgentHub"
const CONFIG_FILE = "config.json"
const LEGACY_DEV_USER_DATA_DIR = "Electron"

let configured = false
let configuredPath: string | null = null

type JsonRecord = Record<string, unknown>

export function configureAgentHubUserDataPath(): string | null {
  if (configured) return configuredPath
  configured = true

  try {
    app.setName(APP_NAME)
  } catch {
    // The name is a convenience for Electron defaults; an explicit userData path is set below.
  }

  try {
    const overridePath = process.env.AGENTHUB_USER_DATA_DIR?.trim()
    const targetPath = overridePath
      ? resolve(overridePath)
      : join(app.getPath("appData"), APP_NAME)

    mkdirSync(targetPath, { recursive: true })
    app.setPath("userData", targetPath)
    configuredPath = targetPath

    if (!overridePath) {
      migrateLegacyDevConfig(app.getPath("appData"), targetPath)
    }

    return configuredPath
  } catch (error) {
    console.error("[AgentHub] Failed to configure userData path:", error)
    return null
  }
}

function migrateLegacyDevConfig(appDataPath: string, targetUserDataPath: string): void {
  const legacyUserDataPath = join(appDataPath, LEGACY_DEV_USER_DATA_DIR)
  if (resolve(legacyUserDataPath).toLowerCase() === resolve(targetUserDataPath).toLowerCase()) return

  const legacyConfigPath = join(legacyUserDataPath, CONFIG_FILE)
  if (!existsSync(legacyConfigPath)) return

  const targetConfigPath = join(targetUserDataPath, CONFIG_FILE)
  const legacyConfig = readJsonRecord(legacyConfigPath)
  if (!legacyConfig || Object.keys(legacyConfig).length === 0) return

  const targetConfig = readJsonRecord(targetConfigPath) ?? {}
  let changed = false

  for (const [key, value] of Object.entries(legacyConfig)) {
    if (targetConfig[key] !== undefined) continue
    targetConfig[key] = value
    changed = true
  }

  if (!changed) return

  if (existsSync(targetConfigPath) && readJsonRecord(targetConfigPath) === null) {
    copyFileSync(targetConfigPath, `${targetConfigPath}.invalid-${Date.now()}`)
  }

  const tmpPath = `${targetConfigPath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(targetConfig, null, 2), "utf-8")
  renameSync(tmpPath, targetConfigPath)
}

function readJsonRecord(filePath: string): JsonRecord | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null
  } catch {
    return null
  }
}

configureAgentHubUserDataPath()
