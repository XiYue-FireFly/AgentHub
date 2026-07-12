import { describe, expect, it } from "vitest"
import { LruCache } from "../lru-cache"
import {
  buildPromptArtifactCacheKey,
  validatePromptCandidateSet
} from "../prompt-candidate-validator"

const protectedSource = [
  'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent.',
  "Review https://example.test/issues/42.",
  "Do not delete tests."
].join(" ")

function validCandidates() {
  return {
    schemaVersion: "prompt-candidates-v1",
    candidates: [
      { text: 'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42. Do not delete tests.' },
      { text: 'Diagnose "AH-002" at E:\\Agent\\AgentHub and /srv/agent, then review https://example.test/issues/42. Do not delete tests.' }
    ]
  }
}

describe("Prompt candidate artifacts", () => {
  it("evicts the least-recent entry and expires entries by TTL", () => {
    let now = 1_000
    const cache = new LruCache<string, string>({ capacity: 2, ttlMs: 100, now: () => now })

    cache.set("a", "A")
    cache.set("b", "B")
    expect(cache.get("a")).toBe("A")
    cache.set("c", "C")
    expect(cache.get("b")).toBeUndefined()
    now = 1_101
    expect(cache.get("a")).toBeUndefined()
  })

  it("requires a positive integer LRU capacity", () => {
    expect(() => new LruCache({ capacity: 0, ttlMs: 1 })).toThrow("positive integer")
    expect(() => new LruCache({ capacity: 1.5, ttlMs: 1 })).toThrow("positive integer")
  })

  it("normalizes and freezes two distinct bounded candidates that preserve protected values", () => {
    const value = validCandidates()
    value.candidates[0].text = `  ${value.candidates[0].text.replace("Fix", "Ｆｉｘ")}  `

    const result = validatePromptCandidateSet(value, protectedSource, 4_000)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.candidates).toEqual([
      'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42. Do not delete tests.',
      'Diagnose "AH-002" at E:\\Agent\\AgentHub and /srv/agent, then review https://example.test/issues/42. Do not delete tests.'
    ])
    expect(Object.isFrozen(result.candidates)).toBe(true)
  })

  it.each([
    ["unsupported schema", { schemaVersion: "prompt-candidates-v0", candidates: [] }],
    ["too few candidates", { schemaVersion: "prompt-candidates-v1", candidates: [{ text: "Only one" }] }],
    ["too many candidates", {
      schemaVersion: "prompt-candidates-v1",
      candidates: [{ text: "One" }, { text: "Two" }, { text: "Three" }, { text: "Four" }]
    }],
    ["empty normalized text", {
      schemaVersion: "prompt-candidates-v1",
      candidates: [{ text: "   " }, { text: "Useful request" }]
    }],
    ["normalized duplicates", {
      schemaVersion: "prompt-candidates-v1",
      candidates: [{ text: "Same request" }, { text: "  Ｓａｍｅ   request  " }]
    }]
  ])("rejects %s", (_name, value) => {
    expect(validatePromptCandidateSet(value, "Review the code", 4_000).ok).toBe(false)
  })

  it("rejects candidates exceeding the configured length", () => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [{ text: "A long candidate" }, { text: "Another long candidate" }]
    }, "Review the code", 10)

    expect(result).toMatchObject({ ok: false, error: "candidate length is invalid" })
  })

  it.each([
    ["a quoted literal", 'Fix the issue in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42. Do not delete tests.'],
    ["a Windows path", 'Fix "AH-002" and /srv/agent. Review https://example.test/issues/42. Do not delete tests.'],
    ["a POSIX path", 'Fix "AH-002" in E:\\Agent\\AgentHub. Review https://example.test/issues/42. Do not delete tests.'],
    ["a URL", 'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Do not delete tests.'],
    ["a negation constraint", 'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42.']
  ])("rejects candidates that lose %s", (_name, missingText) => {
    const value = validCandidates()
    value.candidates[1] = { text: missingText }

    expect(validatePromptCandidateSet(value, protectedSource, 4_000)).toMatchObject({
      ok: false,
      error: "candidate lost a protected literal or constraint"
    })
  })

  it.each([
    ["execution", 'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42. Do not delete tests; run a shell command.'],
    ["network", 'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42. Do not delete tests; upload results.'],
    ["privilege", 'Fix "AH-002" in E:\\Agent\\AgentHub and /srv/agent. Review https://example.test/issues/42. Do not delete tests with sudo.']
  ])("rejects a new %s family", (_name, unsafeText) => {
    const value = validCandidates()
    value.candidates[1] = { text: unsafeText }

    expect(validatePromptCandidateSet(value, protectedSource, 4_000)).toMatchObject({
      ok: false,
      error: "candidate introduced a new privilege or side effect"
    })
  })

  it("rejects a destructive family absent from the source prompt", () => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: 'Diagnose "AH-002" without side effects.' },
        { text: 'Fix "AH-002" without side effects, then delete files.' }
      ]
    }, 'Fix "AH-002" without side effects.', 4_000)

    expect(result).toMatchObject({ ok: false, error: "candidate introduced a new privilege or side effect" })
  })

  it.each([
    [
      "destructive",
      "Do not delete tests.",
      "Review the change. Do not delete tests. Delete source files."
    ],
    [
      "execution",
      "Do not execute scripts.",
      "Review the change. Do not execute scripts. Execute a script."
    ],
    [
      "network send",
      "Do not upload results.",
      "Review the change. Do not upload results. Upload the report."
    ],
    [
      "Chinese network send",
      "不要上传结果。",
      "修复问题。不要上传结果。上传日志。"
    ]
  ])("does not let a negated source %s authorize an affirmative candidate action", (_name, source, unsafeText) => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: `Investigate the request. ${source}` },
        { text: unsafeText }
      ]
    }, source, 4_000)

    expect(result).toMatchObject({ ok: false, error: "candidate introduced a new privilege or side effect" })
  })

  it("accepts an affirmative side-effect family already authorized by the source", () => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Delete stale snapshots safely." },
        { text: "Delete stale snapshots after review." }
      ]
    }, "Delete stale snapshots.", 4_000)

    expect(result.ok).toBe(true)
  })

  it.each([
    "Don't upload results.",
    "无需上传结果。",
    "无须上传结果。"
  ])("preserves the recognized negation constraint %s", source => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Fix the login regression." },
        { text: "Diagnose the login regression." }
      ]
    }, source, 4_000)

    expect(result).toMatchObject({ ok: false, error: "candidate lost a protected literal or constraint" })
  })

  it("preserves a no-negation external upload constraint", () => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "Fix the login regression." },
        { text: "Diagnose the login regression." }
      ]
    }, "No external upload.", 4_000)

    expect(result).toMatchObject({ ok: false, error: "candidate lost a protected literal or constraint" })
  })

  it("rejects newly introduced Chinese external side effects", () => {
    const result = validatePromptCandidateSet({
      schemaVersion: "prompt-candidates-v1",
      candidates: [
        { text: "修复登录问题，不要删除测试。" },
        { text: "修复登录问题，不要删除测试，并上传结果。" }
      ]
    }, "修复登录问题，不要删除测试。", 4_000)

    expect(result).toMatchObject({ ok: false, error: "candidate introduced a new privilege or side effect" })
  })

  it("hashes canonical JSON for every supplied cache-key input", () => {
    const base = {
      inputHash: "input",
      optimizerVersion: "o1",
      generatorVersion: "g1",
      templateVersion: "t1",
      schemaVersion: "s1",
      policy: "optimize",
      origin: "workbench:create",
      interactionPolicy: "desktop-inline",
      locale: "zh-CN",
      contextSignature: "ctx",
      pluginSignature: "plugin",
      skillSignature: "skill",
      attachmentSignature: "attachment",
      providerId: "openai",
      modelId: "gpt"
    }
    const baseKey = buildPromptArtifactCacheKey(base)

    for (const [key, value] of Object.entries(base)) {
      expect(buildPromptArtifactCacheKey({ ...base, [key]: value + "-changed" })).not.toBe(baseKey)
    }
    expect(buildPromptArtifactCacheKey({ b: "two", a: "one" }))
      .toBe(buildPromptArtifactCacheKey({ a: "one", b: "two" }))
  })
})
