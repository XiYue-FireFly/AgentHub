import { app, shell } from "electron"
import { store } from "../store"
import type { UpdateStatus } from "./types"

const STORAGE_KEY = "runtime.updates.v1"
const DOWNLOAD_URL = "https://github.com/XiYue-FireFly/AgengHub/releases"

export function updateStatus(): UpdateStatus {
  const raw = store.get(STORAGE_KEY)
  return {
    version: app.getVersion(),
    channel: raw?.channel === "preview" ? "preview" : "stable",
    checking: false,
    latestVersion: typeof raw?.latestVersion === "string" ? raw.latestVersion : undefined,
    downloadUrl: typeof raw?.downloadUrl === "string" ? raw.downloadUrl : DOWNLOAD_URL,
    error: typeof raw?.error === "string" ? raw.error : undefined,
    checkedAt: typeof raw?.checkedAt === "number" ? raw.checkedAt : undefined
  }
}

export function setUpdateChannel(channel: "stable" | "preview"): UpdateStatus {
  const next = { ...updateStatus(), channel }
  store.set(STORAGE_KEY, next)
  return next
}

export async function checkUpdates(channel?: "stable" | "preview"): Promise<UpdateStatus> {
  const next: UpdateStatus = {
    ...updateStatus(),
    channel: channel || updateStatus().channel,
    checking: false,
    latestVersion: app.getVersion(),
    downloadUrl: DOWNLOAD_URL,
    checkedAt: Date.now()
  }
  store.set(STORAGE_KEY, next)
  return next
}

export async function openUpdateDownload(): Promise<void> {
  await shell.openExternal(updateStatus().downloadUrl || DOWNLOAD_URL)
}
