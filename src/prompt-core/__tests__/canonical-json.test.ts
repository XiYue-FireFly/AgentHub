import { describe, expect, it } from "vitest"
import {
  PROMPT_ORIGINS,
  type DispatchEnvelope,
  type PromptEnvelope
} from "../../shared/prompt-contract"
import { canonicalJson, hashPromptText, sha256Hex } from "../canonical-json"

describe("canonical Prompt hashing", () => {
  it("sorts object keys recursively while preserving array order and omitting undefined object values", () => {
    expect(canonicalJson({
      z: 1,
      nested: { b: 2, a: 1 },
      messages: [{ role: "user", content: "first" }, { role: "assistant", content: "second" }],
      ignored: undefined
    })).toBe('{"messages":[{"content":"first","role":"user"},{"content":"second","role":"assistant"}],"nested":{"a":1,"b":2},"z":1}')
  })

  it("normalizes undefined array values and rejects non-canonical values", () => {
    expect(canonicalJson([undefined, "kept"])).toBe('[null,"kept"]')
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow("non-finite")
    expect(() => canonicalJson({ invalid: () => undefined })).not.toThrow()
    expect(() => canonicalJson([() => undefined])).toThrow("unsupported")
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow("cycles")
  })

  it("produces the known SHA-256 for canonical JSON", () => {
    expect(sha256Hex(canonicalJson({ b: 2, a: 1 })))
      .toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777")
    expect(hashPromptText("Run tests")).toBe(sha256Hex("Run tests"))
  })

  it("publishes every supported origin and separate root and dispatch hashes", () => {
    expect(PROMPT_ORIGINS).toHaveLength(20)
    expect(PROMPT_ORIGINS).toContain("workbench:create")
    expect(PROMPT_ORIGINS).toContain("internal:schedule")
    expect(PROMPT_ORIGINS).toContain("internal:model-diagnostic")
    const root = {} as PromptEnvelope
    const dispatch = {} as DispatchEnvelope
    const rootHash: string = root.preparedTextHash
    const payloadHash: string = dispatch.canonicalPayloadHash
    expect(typeof rootHash).toBe("undefined")
    expect(typeof payloadHash).toBe("undefined")
  })
})
