import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * ApprovalConfig 单测 — 覆盖：默认全 allow（零回归）、setDefault、per-agent 覆盖优先 +
 * null 清除回落、guardedToolFor 只读工具不门禁、坏数据兜底。store 以内存对象替身。
 */

let store: Record<string, any>

vi.mock('../../store', () => ({
  store: {
    get: (k: string) => store[k],
    set: (k: string, v: any) => { store[k] = v },
    commit: async (k: string, v: any) => {
      if (typeof store.__commit === 'function') return store.__commit(k, v)
      if (store.__commitError) throw store.__commitError
      store[k] = v
      return v
    }
  }
}))

beforeEach(() => { store = {}; vi.resetModules() })

describe('ApprovalConfig', () => {
  it('persists policy configuration without retaining legacy pending approvals', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/agentic/approval.ts'), 'utf8')

    expect(source).not.toContain('PersistedPendingApproval')
    expect(source).not.toContain('savePendingApproval')
    expect(source).not.toContain('removePendingApproval')
    expect(source).not.toContain('resolvePendingApproval')
    expect(source).not.toContain('loadPendingApprovals')
    expect(source).not.toContain('expireStalePendingApprovals')
  })

  it('默认全 allow（与 0.3.0 行为一致）', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    expect(cfg.policyFor('claude', 'write')).toBe('allow')
    expect(cfg.policyFor('codex', 'exec')).toBe('allow')
    expect(cfg.getConfig().default).toEqual({ write: 'allow', exec: 'allow' })
    expect(cfg.getConfig().overrides).toEqual({})
  })

  it('rejects atomic remembered overrides without mutating the cached policy', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    store.__commitError = new Error('disk unavailable')

    await expect(cfg.setOverrideAndFlush('claude', 'exec', 'allow')).rejects.toThrow('disk unavailable')
    expect(cfg.getConfig().overrides.claude).toBeUndefined()
  })

  it('serializes concurrent remembered overrides without losing either policy', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()

    await Promise.all([
      cfg.setOverrideAndFlush('codex', 'exec', 'allow'),
      cfg.setOverrideAndFlush('claude', 'write', 'deny')
    ])

    expect(cfg.getConfig().overrides).toMatchObject({
      codex: { exec: 'allow' },
      claude: { write: 'deny' }
    })
  })

  it('keeps ask-all authoritative while retaining a remembered override for a later auto preset', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setPreset('ask-all')
    await cfg.setOverrideAndFlush('codex', 'exec', 'allow')
    expect(cfg.policyFor('codex', 'exec')).toBe('ask')
    expect(cfg.policyForWithRisk('codex', 'exec', 'medium')).toBe('ask')
    expect(cfg.policyForWithRisk('claude', 'exec', 'medium')).toBe('ask')

    cfg.setPreset('auto')
    expect(cfg.policyForWithRisk('codex', 'exec', 'high')).toBe('allow')
  })

  it('keeps a read-only preset restrictive when it interleaves with a remembered override commit', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    let started = false
    let releaseCommit!: () => void
    store.__commit = (_key: string, value: any) => new Promise(resolve => {
      started = true
      releaseCommit = () => {
        store['agentic.approval.v1'] = structuredClone(value)
        resolve(structuredClone(value))
      }
    })

    const remembering = cfg.setOverrideAndFlush('codex', 'exec', 'allow')
    await vi.waitFor(() => expect(started).toBe(true))
    cfg.setPreset('read-only')
    expect(cfg.policyForWithRisk('codex', 'exec', 'high')).toBe('deny')
    releaseCommit()
    await remembering

    expect(cfg.getConfig().preset).toBe('read-only')
    expect(cfg.policyForWithRisk('codex', 'exec', 'high')).toBe('deny')
  })

  it('rebases a successful remembered override through read-only for a later auto preset', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    let started = false
    let releaseCommit!: () => void
    store.__commit = (_key: string, value: any) => new Promise(resolve => {
      started = true
      releaseCommit = () => {
        store['agentic.approval.v1'] = structuredClone(value)
        resolve(structuredClone(value))
      }
    })

    const remembering = cfg.setOverrideAndFlush('codex', 'exec', 'allow')
    await vi.waitFor(() => expect(started).toBe(true))
    cfg.setPreset('read-only')
    releaseCommit()
    await remembering

    expect(cfg.getConfig()).toMatchObject({
      preset: 'read-only',
      overrides: { codex: { exec: 'allow' } }
    })
    expect(cfg.policyForWithRisk('codex', 'exec', 'high')).toBe('deny')
    cfg.setPreset('auto')
    expect(cfg.policyForWithRisk('codex', 'exec', 'high')).toBe('allow')
  })

  it('keeps a newer explicit deny when a delayed remembered allow targets the same key', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    let started = false
    let releaseCommit!: () => void
    store.__commit = (_key: string, value: any) => new Promise(resolve => {
      started = true
      releaseCommit = () => {
        store['agentic.approval.v1'] = structuredClone(value)
        resolve(structuredClone(value))
      }
    })

    const remembering = cfg.setOverrideAndFlush('codex', 'exec', 'allow')
    await vi.waitFor(() => expect(started).toBe(true))
    cfg.setOverride('codex', 'exec', 'deny')
    releaseCommit()
    await remembering

    expect(cfg.getConfig().overrides.codex?.exec).toBe('deny')
    expect(cfg.policyForWithRisk('codex', 'exec', 'high')).toBe('deny')
  })

  it.each([
    ['deny', 'deny', 'read-only'],
    ['ask', 'ask', 'ask-all'],
    ['allow', 'allow', 'full-access'],
    ['allow', 'ask', 'custom'],
    ['allow', 'deny', 'custom'],
    ['ask', 'allow', 'custom'],
    ['ask', 'deny', 'custom'],
    ['deny', 'allow', 'custom'],
    ['deny', 'ask', 'custom']
  ] as const)('migrates legacy %s/%s defaults to the %s preset', async (write, exec, expectedPreset) => {
    store['agentic.approval.v1'] = { version: 1, default: { write, exec }, overrides: {} }
    const { getApprovalConfig } = await import('../approval')

    expect(getApprovalConfig().getConfig().preset).toBe(expectedPreset)
    expect(store['agentic.approval.v1']).toMatchObject({
      version: 1,
      preset: expectedPreset,
      default: { write, exec },
      overrides: {}
    })
  })

  it('migrates any legacy config with meaningful overrides to custom', async () => {
    store['agentic.approval.v1'] = {
      version: 1,
      default: { write: 'deny', exec: 'deny' },
      overrides: { claude: { write: 'allow' } }
    }
    const { getApprovalConfig } = await import('../approval')

    expect(getApprovalConfig().getConfig().preset).toBe('custom')
    expect(store['agentic.approval.v1'].preset).toBe('custom')
  })

  it('setDefault 改全局默认（不影响另一工具）', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setDefault('exec', 'ask')
    expect(cfg.policyFor('anyone', 'exec')).toBe('ask')
    expect(cfg.policyFor('anyone', 'write')).toBe('allow')
  })

  it('per-agent 覆盖优先；null 清除后回落默认', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setDefault('write', 'ask')
    cfg.setOverride('claude', 'write', 'deny')
    expect(cfg.policyFor('claude', 'write')).toBe('deny')  // 覆盖生效
    expect(cfg.policyFor('codex', 'write')).toBe('ask')    // 他者回落默认
    cfg.setOverride('claude', 'write', null)
    expect(cfg.policyFor('claude', 'write')).toBe('ask')   // 清除后回落
    expect(cfg.getConfig().overrides.claude).toBeUndefined() // 空覆盖条目被删除
  })

  // 修正后的审批规则（参照 codex builtin_approval_presets）
  it('preset=full-access：永不弹窗，全部放行（等价 codex Never）', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setOverride('claude', 'write', 'deny') // 即使有 deny 覆盖
    cfg.setPreset('full-access')
    // full-access 下覆盖被忽略，全部放行
    expect(cfg.policyFor('claude', 'write')).toBe('allow')
    expect(cfg.policyFor('any', 'exec')).toBe('allow')
  })

  it('preset=read-only：写/执行全部拒绝', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setPreset('read-only')
    expect(cfg.policyFor('claude', 'write')).toBe('deny')
    expect(cfg.policyFor('codex', 'exec')).toBe('deny')
  })

  it('preset=ask-all：每次写/执行都问', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setPreset('ask-all')
    expect(cfg.policyFor('claude', 'write')).toBe('ask')
    expect(cfg.policyFor('codex', 'exec')).toBe('ask')
  })

  it('手动改 default 自动切到 custom 模式', async () => {
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    cfg.setPreset('full-access')
    expect(cfg.getConfig().preset).toBe('full-access')
    cfg.setDefault('write', 'ask')
    expect(cfg.getConfig().preset).toBe('custom')
  })

  it('presetToPolicies 映射正确（参考 codex builtin_approval_presets）', async () => {
    const { presetToPolicies } = await import('../approval')
    expect(presetToPolicies('read-only')).toEqual({ write: 'deny', exec: 'deny' })
    expect(presetToPolicies('full-access')).toEqual({ write: 'allow', exec: 'allow' })
    expect(presetToPolicies('ask-all')).toEqual({ write: 'ask', exec: 'ask' })
    expect(presetToPolicies('auto')).toEqual({ write: 'allow', exec: 'allow' })
  })

  it('guardedToolFor：只读工具（fs_read/fs_list）不门禁', async () => {
    const { guardedToolFor } = await import('../approval')
    expect(guardedToolFor('fs_write')).toBe('write')
    expect(guardedToolFor('exec')).toBe('exec')
    expect(guardedToolFor('fs_read')).toBeNull()
    expect(guardedToolFor('fs_list')).toBeNull()
    expect(guardedToolFor('unknown')).toBeNull()
  })

  it('坏数据兜底为默认 allow', async () => {
    store['agentic.approval.v1'] = { default: { write: 'nonsense' }, overrides: { x: 'bad' } }
    const { getApprovalConfig } = await import('../approval')
    const cfg = getApprovalConfig()
    expect(cfg.policyFor('x', 'write')).toBe('allow')
    expect(cfg.policyFor('x', 'exec')).toBe('allow')
  })

  // ——— policyForWithRisk：auto 预设风险升级 ———
  describe('policyForWithRisk', () => {
    it('auto + low/medium risk → 保持 allow', async () => {
      const { getApprovalConfig } = await import('../approval')
      const cfg = getApprovalConfig()
      cfg.setPreset('auto')
      expect(cfg.policyForWithRisk('claude', 'write', 'low')).toBe('allow')
      expect(cfg.policyForWithRisk('claude', 'write', 'medium')).toBe('allow')
      expect(cfg.policyForWithRisk('claude', 'exec', 'low')).toBe('allow')
    })

    it('auto + high/critical risk → 升级为 ask', async () => {
      const { getApprovalConfig } = await import('../approval')
      const cfg = getApprovalConfig()
      cfg.setPreset('auto')
      expect(cfg.policyForWithRisk('claude', 'write', 'high')).toBe('ask')
      expect(cfg.policyForWithRisk('claude', 'write', 'critical')).toBe('ask')
      expect(cfg.policyForWithRisk('claude', 'exec', 'critical')).toBe('ask')
    })

    it('full-access + high risk → 仍为 allow（不受 risk 影响）', async () => {
      const { getApprovalConfig } = await import('../approval')
      const cfg = getApprovalConfig()
      cfg.setPreset('full-access')
      expect(cfg.policyForWithRisk('claude', 'write', 'critical')).toBe('allow')
      expect(cfg.policyForWithRisk('claude', 'exec', 'high')).toBe('allow')
    })

    it('read-only + low risk → deny（不受 risk 影响）', async () => {
      const { getApprovalConfig } = await import('../approval')
      const cfg = getApprovalConfig()
      cfg.setPreset('read-only')
      expect(cfg.policyForWithRisk('claude', 'write', 'low')).toBe('deny')
    })

    it('ask-all + low risk → ask（不受 risk 影响）', async () => {
      const { getApprovalConfig } = await import('../approval')
      const cfg = getApprovalConfig()
      cfg.setPreset('ask-all')
      expect(cfg.policyForWithRisk('claude', 'exec', 'low')).toBe('ask')
    })

    it('custom 模式尊重显式配置，不按 risk 升级', async () => {
      const { getApprovalConfig } = await import('../approval')
      const cfg = getApprovalConfig()
      cfg.setPreset('custom')
      cfg.setDefault('write', 'allow')
      cfg.setDefault('exec', 'deny')
      // custom 下即使 high risk，显式 allow 不升级
      expect(cfg.policyForWithRisk('claude', 'write', 'high')).toBe('allow')
      // custom 下显式 deny 也不因 low risk 降级
      expect(cfg.policyForWithRisk('claude', 'exec', 'low')).toBe('deny')
    })
  })
})
