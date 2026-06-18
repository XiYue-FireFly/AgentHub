import { describe, expect, it } from "vitest"
import { appendDecodedProcessChunk, decodeProcessChunk } from "../process-decoder"

describe("process output decoder", () => {
  it("keeps utf8 output unchanged", () => {
    expect(decodeProcessChunk(Buffer.from("中文输出", "utf8"))).toBe("中文输出")
  })

  it("falls back to gb18030 for Windows Chinese command output", () => {
    const encoded = new TextEncoder().encode("placeholder")
    const bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xca, 0xe4, 0xb3, 0xf6])
    expect(encoded.length).toBeGreaterThan(0)
    expect(decodeProcessChunk(bytes)).toBe("中文输出")
  })

  it("appends decoded chunks with truncation", () => {
    expect(appendDecodedProcessChunk("a", Buffer.from("bc"), 2)).toContain("[AgentHub: output truncated]")
  })
})
