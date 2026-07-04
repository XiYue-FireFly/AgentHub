/* ============================================================
   Electron stub —— 仅供 vitest 单测使用（见 vitest.config.ts 的 resolve.alias）。
   主进程单测（如 dispatcher/orchestrator/manager）经 store.ts 间接 `import { app, safeStorage } from 'electron'`，
   但真实 electron 模块在 require 时会校验本机 ~190MB 二进制是否安装；CI 上该二进制偶发下载失败 →
   require('electron') 抛 "Electron failed to install correctly" → 套件加载崩。
   单测并不需要真实 electron 行为，故用此轻量 stub 替换，让测试与二进制解耦、确定性通过。
   注意：仅覆盖在 import/eval 期会被触达的导出；store.ts 只在函数内用 app/safeStorage，eval 期不调用。
   ============================================================ */

export const app = {
  paths: { appData: '', userData: '' } as Record<string, string>,
  getPath: (name?: string) => app.paths[name || ''] || '',
  setPath: (name: string, value: string) => { app.paths[name] = value },
  setName: (_name: string) => {},
  getName: () => 'agenthub',
  getVersion: () => '0.0.0-test',
  on: () => app,
  whenReady: () => Promise.resolve(),
  quit: () => {},
  requestSingleInstanceLock: () => true
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer) => b.toString('utf-8')
}

export const ipcMain = { handle: () => {}, on: () => {}, removeHandler: () => {} }
export const ipcRenderer = { invoke: () => Promise.resolve(), on: () => {}, send: () => {} }
export const shell = { openExternal: () => Promise.resolve(), openPath: () => Promise.resolve('') }
export const dialog = { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) }
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: () => {} }
export const nativeImage = { createFromPath: () => ({}) }
export class BrowserWindow {}
export class Tray {
  constructor() {}
  setToolTip() {}
  setIcon() {}
  setContextMenu() {}
  on() { return this }
  destroy() {}
}
export class Notification {
  static isSupported() { return false }
  show() {}
  on() { return this }
}
export class WebContents {
  send() {}
  on() { return this }
  once() { return this }
  removeAllListeners() {}
}
export const session = {
  defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }
}
export const powerSaveBlocker = {
  start() { return 0 },
  stop() {}
}
export const systemPreferences = {
  getMediaAccessStatus: () => 'granted',
  askForMediaAccess: () => Promise.resolve(true)
}
export const contextBridge = { exposeInMainWorld: () => {} }

export default { app, safeStorage, ipcMain, ipcRenderer, shell, dialog, Menu, nativeImage, BrowserWindow, Tray, Notification, WebContents, session, powerSaveBlocker, systemPreferences, contextBridge }
