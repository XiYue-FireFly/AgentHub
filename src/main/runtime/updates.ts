import { app, shell } from "electron"
import electronUpdater from "electron-updater"
import { store } from "../store"
import type { UpdateStatus } from "./types"

const STORAGE_KEY = "runtime.updates.v1"
const DOWNLOAD_URL = "https://github.com/XiYue-FireFly/AgentHub/releases"

type UpdateChannel = "stable" | "preview"

let initialized = false
let statusCache: UpdateStatus | null = null

function getAutoUpdater() {
  return electronUpdater.autoUpdater
}

export function updateStatus(): UpdateStatus {
  if (!statusCache) statusCache = normalizeStatus(store.get(STORAGE_KEY))
  return statusCache
}

export function setUpdateChannel(channel: UpdateChannel): UpdateStatus {
  const next = mergeStatus({ channel, error: undefined })
  if (initialized) getAutoUpdater().allowPrerelease = channel === "preview"
  return next
}

export async function checkUpdates(channel?: UpdateChannel): Promise<UpdateStatus> {
  if (channel) setUpdateChannel(channel)
  const dev = isDevUpdateMode()
  if (dev) {
    return mergeStatus({
      state: "not-available",
      checking: false,
      available: false,
      downloaded: false,
      latestVersion: app.getVersion(),
      checkedAt: Date.now(),
      error: undefined,
      devMode: true
    })
  }
  ensureUpdaterInitialized()
  mergeStatus({ state: "checking", checking: true, error: undefined, checkedAt: Date.now() })
  try {
    const result = await getAutoUpdater().checkForUpdates()
    if (!result) {
      return mergeStatus({ state: "not-available", checking: false, available: false, downloaded: false })
    }
    return updateStatus()
  } catch (error) {
    return mergeStatus({
      state: "error",
      checking: false,
      error: errorMessage(error)
    })
  }
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (isDevUpdateMode()) {
    return mergeStatus({ state: "not-available", checking: false, error: "Auto-update downloads are disabled in development mode.", devMode: true })
  }
  ensureUpdaterInitialized()
  if (!updateStatus().available) return mergeStatus({ error: "No update is available to download." })
  mergeStatus({ state: "downloading", downloadProgress: 0, error: undefined })
  try {
    await getAutoUpdater().downloadUpdate()
    return updateStatus()
  } catch (error) {
    return mergeStatus({ state: "error", error: errorMessage(error) })
  }
}

export async function installUpdate(): Promise<UpdateStatus> {
  if (isDevUpdateMode()) {
    return mergeStatus({ error: "Auto-update install is disabled in development mode.", devMode: true })
  }
  ensureUpdaterInitialized()
  if (!updateStatus().downloaded) return mergeStatus({ error: "No downloaded update is ready to install." })
  setTimeout(() => getAutoUpdater().quitAndInstall(false, true), 150)
  return mergeStatus({ state: "downloaded", canInstall: true })
}

export async function openUpdateDownload(): Promise<void> {
  await shell.openExternal(updateStatus().downloadUrl || DOWNLOAD_URL)
}

function ensureUpdaterInitialized(): void {
  if (initialized) return
  initialized = true
  const updater = getAutoUpdater()
  updater.autoDownload = false
  updater.allowPrerelease = updateStatus().channel === "preview"
  updater.logger = null

  updater.on("checking-for-update", () => {
    mergeStatus({ state: "checking", checking: true, error: undefined, checkedAt: Date.now() })
  })
  updater.on("update-available", info => {
    mergeStatus({
      state: "available",
      checking: false,
      available: true,
      downloaded: false,
      latestVersion: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseDate: info.releaseDate ?? undefined,
      downloadUrl: DOWNLOAD_URL,
      error: undefined
    })
  })
  updater.on("update-not-available", info => {
    mergeStatus({
      state: "not-available",
      checking: false,
      available: false,
      downloaded: false,
      latestVersion: info.version || app.getVersion(),
      releaseName: info.releaseName ?? undefined,
      releaseDate: info.releaseDate ?? undefined,
      error: undefined
    })
  })
  updater.on("download-progress", progress => {
    mergeStatus({
      state: "downloading",
      checking: false,
      available: true,
      downloaded: false,
      downloadProgress: Math.max(0, Math.min(100, Number(progress.percent || 0)))
    })
  })
  updater.on("update-downloaded", info => {
    mergeStatus({
      state: "downloaded",
      checking: false,
      available: true,
      downloaded: true,
      latestVersion: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseDate: info.releaseDate ?? undefined,
      downloadProgress: 100,
      error: undefined
    })
  })
  updater.on("error", error => {
    mergeStatus({ state: "error", checking: false, error: errorMessage(error) })
  })
}

function normalizeStatus(raw: any): UpdateStatus {
  const channel = raw?.channel === "preview" ? "preview" : "stable"
  const state = typeof raw?.state === "string" ? raw.state : "idle"
  const devMode = isDevUpdateMode()
  const available = Boolean(raw?.available)
  const downloaded = Boolean(raw?.downloaded)
  const checking = state === "checking" || Boolean(raw?.checking)
  return withCapabilities({
    version: app.getVersion(),
    channel,
    state,
    checking,
    available,
    downloaded,
    latestVersion: typeof raw?.latestVersion === "string" ? raw.latestVersion : undefined,
    downloadUrl: typeof raw?.downloadUrl === "string" ? raw.downloadUrl : DOWNLOAD_URL,
    downloadProgress: typeof raw?.downloadProgress === "number" ? raw.downloadProgress : undefined,
    releaseName: typeof raw?.releaseName === "string" ? raw.releaseName : undefined,
    releaseDate: typeof raw?.releaseDate === "string" ? raw.releaseDate : undefined,
    error: typeof raw?.error === "string" ? raw.error : undefined,
    checkedAt: typeof raw?.checkedAt === "number" ? raw.checkedAt : undefined,
    devMode
  })
}

function mergeStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  statusCache = withCapabilities({ ...updateStatus(), ...patch, version: app.getVersion() })
  store.set(STORAGE_KEY, statusCache)
  return statusCache
}

function withCapabilities(status: UpdateStatus): UpdateStatus {
  const state = status.state || "idle"
  const devMode = Boolean(status.devMode)
  return {
    ...status,
    checking: state === "checking" || status.checking,
    canCheck: !devMode && state !== "checking" && state !== "downloading",
    canDownload: !devMode && Boolean(status.available) && !status.downloaded && state !== "downloading",
    canInstall: !devMode && Boolean(status.downloaded),
    devMode
  }
}

function isDevUpdateMode(): boolean {
  return !app.isPackaged || process.env.NODE_ENV === "test" || process.env.AGENTHUB_MOCK_UPDATES === "1"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
