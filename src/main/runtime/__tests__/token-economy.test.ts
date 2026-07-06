import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  normalizeTokenEconomyConfig,
  estimateTokens,
  compactChatMessages,
  compactTextByTokenBudget,
  estimateMessagesTokens,
  truncateToolResult,
  DEFAULT_TOKEN_ECONOMY_CONFIG,
  TOKEN_ECONOMY_INSTRUCTION
} from "../token-economy"

describe("token-economy", () => {
  describe("normalizeTokenEconomyConfig", () => {
    it("returns defaults when input is undefined", () => {
      const config = normalizeTokenEconomyConfig(undefined)
      expect(config).toEqual(DEFAULT_TOKEN_ECONOMY_CONFIG)
      expect(config.enabled).toBe(false)
      expect(config.compressToolDescriptions).toBe(true)
      expect(config.compressToolResults).toBe(true)
      expect(config.conciseResponses).toBe(true)
      expect(config.maxCumulativeToolResultTokens).toBe(120_000)
      expect(config.keepRecentToolResults).toBe(4)
    })

    it("merges partial config with defaults", () => {
      const config = normalizeTokenEconomyConfig({ enabled: true, keepRecentToolResults: 8 })
      expect(config.enabled).toBe(true)
      expect(config.keepRecentToolResults).toBe(8)
      expect(config.compressToolDescriptions).toBe(true) // default
    })
  })

  describe("estimateTokens", () => {
    it("returns 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0)
      expect(estimateTokens(null as any)).toBe(0)
    })

    it("estimates ASCII text at ~4 chars per token", () => {
      expect(estimateTokens("hello")).toBe(2) // 5 chars / 4 = 1.25 -> 2
      expect(estimateTokens("a".repeat(16))).toBe(4) // 16 / 4 = 4
    })

    it("estimates CJK text at ~1 token per character", () => {
      expect(estimateTokens("你好世界")).toBe(4) // 4 CJK chars
      expect(estimateTokens("テスト")).toBe(3) // 3 Japanese chars
    })

    it("handles mixed ASCII and CJK", () => {
      const text = "hello你好world世界"
      // "hello" = 5 chars -> 2 tokens, "你好" = 2 tokens, "world" = 5 chars -> 2 tokens, "世界" = 2 tokens
      expect(estimateTokens(text)).toBe(8)
    })
  })

  describe("truncateToolResult", () => {
    it("does not truncate short results", () => {
      const result = truncateToolResult("short result", 1000)
      expect(result.text).toBe("short result")
      expect(result.truncated).toBe(false)
    })

    it("truncates long results", () => {
      const longText = "x".repeat(100000)
      const result = truncateToolResult(longText, 100)
      expect(result.truncated).toBe(true)
      expect(result.text.length).toBeLessThan(longText.length)
      expect(result.text).toContain("[truncated by token economy]")
    })

    it("handles empty input", () => {
      const result = truncateToolResult("", 100)
      expect(result.text).toBe("")
      expect(result.truncated).toBe(false)
    })
  })

  describe("compactTextByTokenBudget", () => {
    it("keeps short text untouched", () => {
      const result = compactTextByTokenBudget("short context", 100)
      expect(result.truncated).toBe(false)
      expect(result.text).toBe("short context")
      expect(result.savedTokens).toBe(0)
    })

    it("keeps both head and tail for long text", () => {
      const text = `HEAD-${"a".repeat(4000)}\nMIDDLE-${"b".repeat(4000)}\nTAIL`
      const result = compactTextByTokenBudget(text, 400)
      expect(result.truncated).toBe(true)
      expect(result.text).toContain("HEAD-")
      expect(result.text).toContain("TAIL")
      expect(result.text).toContain("omitted by token economy")
      expect(result.savedTokens).toBeGreaterThan(0)
    })
  })

  describe("compactChatMessages", () => {
    it("keeps latest user request while compacting old history", () => {
      const messages = [
        { role: "user", content: "old user " + "x".repeat(8000) },
        { role: "assistant", content: "old answer " + "y".repeat(8000) },
        { role: "user", content: "current request with exact file path src/main/index.ts" }
      ]
      const compacted = compactChatMessages(messages, { maxTokens: 900, keepRecentMessages: 1, currentMessageTokens: 600 })
      expect(compacted.at(-1)?.content).toContain("current request")
      expect(compacted.at(-1)?.content).toContain("src/main/index.ts")
      expect(estimateMessagesTokens(compacted)).toBeLessThanOrEqual(900)
    })

    it("deduplicates repeated historical messages", () => {
      const repeated = "repeat " + "z".repeat(1200)
      const compacted = compactChatMessages([
        { role: "user", content: repeated },
        { role: "assistant", content: repeated },
        { role: "user", content: "final" }
      ], { maxTokens: 2000, keepRecentMessages: 1 })
      expect(compacted.some(message => message.content.includes("Duplicate assistant context omitted"))).toBe(true)
    })

    it("compacts a single oversized current message", () => {
      const compacted = compactChatMessages([
        { role: "user", content: `HEAD-${"a".repeat(9000)}\nTAIL-single-current` }
      ], { maxTokens: 800, currentMessageTokens: 700 })
      expect(compacted).toHaveLength(1)
      expect(compacted[0].content).toContain("HEAD-")
      expect(compacted[0].content).toContain("TAIL-single-current")
      expect(compacted[0].content).toContain("omitted by token economy")
      expect(estimateMessagesTokens(compacted)).toBeLessThanOrEqual(800)
    })
  })

  describe("TOKEN_ECONOMY_INSTRUCTION", () => {
    it("contains concise response directive", () => {
      expect(TOKEN_ECONOMY_INSTRUCTION).toContain("concisely")
      expect(TOKEN_ECONOMY_INSTRUCTION).toContain("Token economy")
    })
  })

  describe("attachment context integration", () => {
    it("preserves inline text attachments that have no readable path", () => {
      const mainIndex = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
      expect(mainIndex).toContain("const content = att.path")
      expect(mainIndex).toContain("? compactTextByTokenBudget(att.text, ATTACHMENT_TEXT_MAX_TOKENS")
      expect(mainIndex).toContain(": att.text")
      expect(mainIndex).toContain("function hasInlineTextAttachment")
      expect(mainIndex).toContain("const preserveCurrentMessage = hasInlineTextAttachment(attachments)")
      expect(mainIndex).toContain("return [...compactedHistory, current]")
      expect(mainIndex).toContain("preserveCurrentMessage")
    })

    it("carries inline attachment preservation through schedule and orchestrate dispatch", () => {
      const scheduleHelpers = readFileSync(join(process.cwd(), "src/main/runtime/schedule-helpers.ts"), "utf8")
      const dispatcher = readFileSync(join(process.cwd(), "src/main/hub/dispatcher.ts"), "utf8")

      expect(scheduleHelpers).toContain("preserveCurrentMessage?: boolean")
      expect(scheduleHelpers).toContain("preservePrompt ? prompt : compactTextByTokenBudget(prompt, 4_000).text")
      expect(scheduleHelpers).toContain("preserveCurrentMessage: input.preserveCurrentMessage")
      expect(dispatcher).toContain("if (opts.preserveCurrentMessage)")
      expect(dispatcher).toContain("const prompt = opts.preserveCurrentMessage ? rawPrompt : compactOrchestrateText(rawPrompt, 3_000)")
      expect(dispatcher).toContain("synthesisPrompt(opts.preserveCurrentMessage ? text : compactOrchestrateText(text, 4_000)")
    })
  })
})
