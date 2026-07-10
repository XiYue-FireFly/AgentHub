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
  private setRevisions = new Map<string, number>()
  private legacyRevision = 0
  private persistedLegacyRevision = 0
  /** Serialize async write/rename so concurrent save/flush cannot interleave. */
  private saveChain: Promise<void> = Promise.resolve()

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
      throw e
    }
  }

  private isReady(): boolean {
    return this.initialized && !this.initFailed && Boolean(this.filePath)
  }

  private cloneJsonValue(value: any): any {
    const wrapped = JSON.parse(JSON.stringify({ value }))
    if (!Object.prototype.hasOwnProperty.call(wrapped, 'value')) {
      throw new TypeError('Commit value is not JSON-serializable')
    }
    return wrapped.value
  }

  private async persistSnapshot(snapshot: Record<string, any>): Promise<Record<string, any>> {
    const tmp = this.filePath + '.tmp'
    const serialized = JSON.stringify(snapshot, null, 2)
    const persistedSnapshot = JSON.parse(serialized)
    await fs.promises.writeFile(tmp, serialized)
    await fs.promises.rename(tmp, this.filePath)
    return persistedSnapshot
  }

  private async persistLatestLegacy(): Promise<void> {
    if (!this.isReady()) {
      log.error('[Store] Persist skipped: store is not initialized')
      return
    }

    const snapshot = { ...this.data }
    const revision = this.legacyRevision
    try {
      await this.persistSnapshot(snapshot)
      this.persistedLegacyRevision = Math.max(this.persistedLegacyRevision, revision)
    } catch (e: any) {
      log.error(`[Store] Persist failed (${this.filePath}):`, e?.message || String(e))
    }
  }

  /** Enqueue a persist of the current in-memory snapshot. Always serial. */
  private enqueuePersist(): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.persistLatestLegacy())
    return this.saveChain
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.enqueuePersist()
    }, 200)
  }

  async flush(): Promise<void> {
    this.init()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.isReady()) {
      log.error('[Store] Flush skipped: store is not initialized')
      return
    }
    // Always await the chain so in-flight writes finish; enqueue a fresh snapshot last
    await this.enqueuePersist()
  }

  async commit(key: string, value: any): Promise<void> {
    this.init()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    if (!this.isReady()) {
      throw new Error('Store is not initialized')
    }

    const setRevision = this.setRevisions.get(key) ?? 0
    const legacyRevisionAtCall = this.legacyRevision
    let isolatedValue: any
    let isolationError: unknown
    let isolationFailed = false
    try {
      isolatedValue = this.cloneJsonValue(value)
    } catch (e) {
      isolationError = e
      isolationFailed = true
    }

    const operation = this.saveChain.then(async () => {
      if (isolationFailed) throw isolationError

      const candidate = { ...this.data, [key]: isolatedValue }
      const candidateLegacyRevision = this.legacyRevision
      const persistedCandidate = await this.persistSnapshot(candidate)
      const targetSetChanged = (this.setRevisions.get(key) ?? 0) !== setRevision
      if (targetSetChanged) {
        this.persistedLegacyRevision = legacyRevisionAtCall
      } else {
        this.persistedLegacyRevision = Math.max(
          this.persistedLegacyRevision,
          candidateLegacyRevision
        )
      }

      if (!targetSetChanged) {
        this.data = { ...this.data, [key]: persistedCandidate[key] }
      }
    })

    // Keep the shared chain usable after a rejected commit while returning the
    // original operation (and its rejection) to this caller.
    this.saveChain = operation.catch(async (e: any) => {
      log.error(`[Store] Commit failed (${this.filePath}):`, e?.message || String(e))
      if (this.persistedLegacyRevision < this.legacyRevision) {
        await this.persistLatestLegacy()
      }
    })
    return operation
  }

  get(key: string, defaultValue?: any): any {
    this.init()
    return this.data[key] !== undefined ? this.data[key] : defaultValue
  }

  set(key: string, value: any): void {
    this.init()
    if (!this.isReady()) {
      log.error('[Store] Set skipped: store is not initialized')
      return
    }
    this.data = { ...this.data, [key]: value }
    this.setRevisions.set(key, (this.setRevisions.get(key) ?? 0) + 1)
    this.legacyRevision++
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
