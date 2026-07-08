import { app, safeStorage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { randomBytes } from 'crypto'
import { createLogger } from './logger'

const log = createLogger('Store')

const ENC_PREFIX = 'enc:v1:'

export interface DecryptSecretResult {
  ok: boolean
  value: string
  encrypted: boolean
  error?: string
}

/**
 * 用 OS 级 safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）加密密钥后落盘。
 * 幂等：已加密的值原样返回，避免重复加密。safeStorage 不可时抛错（拒绝明文存储密钥）。
 * 注意：safeStorage 须在 app ready 后调用。
 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (plain.startsWith(ENC_PREFIX)) return plain
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('SafeStorage is not available; cannot encrypt secrets securely')
  }
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
}

/** 解密 encryptSecret 的产物；旧明文（无前缀）原样返回；解密失败返回空串（视为未配置，提示重填）。 */
export function decryptSecret(stored: string): string {
  const result = decryptSecretDetailed(stored)
  return result.ok ? result.value : ''
}

export function decryptSecretDetailed(stored: string): DecryptSecretResult {
  if (!stored) return { ok: true, value: '', encrypted: false }
  if (!stored.startsWith(ENC_PREFIX)) return { ok: true, value: stored, encrypted: false }
  try {
    return {
      ok: true,
      value: safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')),
      encrypted: true
    }
  } catch (error: any) {
    return {
      ok: false,
      value: stored,
      encrypted: true,
      error: error?.message || String(error)
    }
  }
}

class AppStore {
  private data: Record<string, any> = {}
  private filePath: string = ''
  private initialized: boolean = false
  private initFailed: boolean = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  init(): void {
    if (this.initialized || this.initFailed) return
    try {
      const userDataPath = app.getPath('userData')
      this.filePath = join(userDataPath, 'config.json')
      this.load()
      this.initialized = true
    } catch (e) {
      log.error(' Init failed:', e)
      this.initFailed = true
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch (e: any) {
      log.error(`[Store] Load failed (${this.filePath}):`, e?.message || String(e))
    }
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(async () => {
      try {
        const tmp = this.filePath + '.tmp'
        // Use async fs operations to avoid blocking the main thread
        await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2))
        await fs.promises.rename(tmp, this.filePath)
      } catch (e: any) {
        log.error(`[Store] Save failed (${this.filePath}):`, e?.message || String(e))
      }
      this.saveTimer = null
    }, 200)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      try {
        const tmp = this.filePath + '.tmp'
        // Use async fs operations to avoid blocking the main thread
        await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2))
        await fs.promises.rename(tmp, this.filePath)
      } catch (e: any) {
        log.error(`[Store] Flush failed (${this.filePath}):`, e?.message || String(e))
      }
    }
  }

  get(key: string, defaultValue?: any): any {
    this.init()
    return this.data[key] !== undefined ? this.data[key] : defaultValue
  }

  set(key: string, value: any): void {
    this.init()
    this.data[key] = value
    this.save()
  }

  getAll(): Record<string, any> {
    this.init()
    // LOW-06: Return deep copy to prevent callers from mutating internal state
    try {
      return JSON.parse(JSON.stringify(this.data))
    } catch {
      return { ...this.data }
    }
  }
}

const appStore = new AppStore()
export { appStore as store }

const TOKEN_KEY = 'local.token'

/**
 * 每安装一份的本机令牌：用于 Hub WebSocket(9527) 连接鉴权等本机内部场景。
 * 首次调用时生成并持久化。仅本机使用，不外发。
 */
export function getLocalToken(): string {
  let t = appStore.get(TOKEN_KEY)
  if (!t || typeof t !== 'string') {
    t = randomBytes(24).toString('hex')
    appStore.set(TOKEN_KEY, t)
    appStore.flush()
  }
  return t
}
