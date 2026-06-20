import { describe, expect, it } from "vitest"
import { explicitGuardVerdictFromText, guardShouldBlockExecutor, riskVerdictForText, structuredVerdictFromText } from "../guards"

describe("custom schedule guards", () => {
  it("blocks executor when reviewer or gatekeeper requires revision", () => {
    const verdict = riskVerdictForText("This answer should run terminal command: rm -rf ./dist", "reviewer")

    expect(verdict.status).toBe("block")
    expect(guardShouldBlockExecutor(verdict, "reviewer")).toBe(true)
  })

  it("treats medium reviewer findings as executor blockers but keeps executor no-op informational", () => {
    const reviewer = riskVerdictForText("The candidate wants to use browser click automation.", "reviewer")
    const executor = riskVerdictForText("No execution needed.", "executor")

    expect(reviewer.status).toBe("revise")
    expect(guardShouldBlockExecutor(reviewer, "reviewer")).toBe(true)
    expect(executor.status).toBe("pass")
    expect(guardShouldBlockExecutor(executor, "executor")).toBe(false)
  })

  it("detects Chinese destructive and sensitive-risk wording", () => {
    expect(riskVerdictForText("请删除所有临时文件并运行命令", "reviewer")).toMatchObject({ status: "revise", level: "medium" })
    expect(riskVerdictForText("不要泄露 API token 或私钥", "reviewer")).toMatchObject({ status: "block", level: "high" })
  })

  it("honors explicit reviewer and gatekeeper verdict tokens", () => {
    const block = explicitGuardVerdictFromText("BLOCK\nThe output violates the requested format.")
    const revise = explicitGuardVerdictFromText("REVISE: answer must be shorter.")

    expect(block).toMatchObject({ status: "block", level: "high" })
    expect(revise).toMatchObject({ status: "revise", level: "medium" })
    expect(guardShouldBlockExecutor(block!, "gatekeeper")).toBe(true)
    expect(guardShouldBlockExecutor(revise!, "reviewer")).toBe(true)
  })

  it("only parses explicit verdicts from the first nonempty verdict line", () => {
    expect(explicitGuardVerdictFromText("Return PASS, WARN, REVISE, or BLOCK.\nBLOCK\nUnsafe output.")).toBeNull()
    expect(explicitGuardVerdictFromText("The answer is BLOCK-worthy.")).toBeNull()
    expect(explicitGuardVerdictFromText("\n\nWARN\nNeeds one formatting fix.")).toMatchObject({ status: "warn", level: "low" })
  })

  it("does not treat executor no-op responses as risky", () => {
    expect(riskVerdictForText("No execution needed.", "executor")).toMatchObject({ status: "pass", level: "low" })
  })
})

describe("P1-7 structured verdict parsing", () => {
  it("extracts structured JSON verdict from model output", () => {
    const text = 'Some analysis text.\n{"guard":{"status":"block","level":"high","reasons":["contains rm -rf command"]}}\nMore text.'
    const verdict = structuredVerdictFromText(text)
    expect(verdict).not.toBeNull()
    expect(verdict!.status).toBe("block")
    expect(verdict!.level).toBe("high")
    expect(verdict!.reasons).toEqual(["contains rm -rf command"])
  })

  it("extracts verdict with 'verdict' key instead of 'guard'", () => {
    const text = 'Review complete.\n{"verdict":{"status":"warn","level":"low","reasons":["minor style issue"]}}'
    const verdict = structuredVerdictFromText(text)
    expect(verdict).toMatchObject({ status: "warn", level: "low", reasons: ["minor style issue"] })
  })

  it("extracts standalone {status,level,reasons} JSON", () => {
    const text = 'After review: {"status":"pass","level":"low","reasons":["all clear"]}'
    const verdict = structuredVerdictFromText(text)
    expect(verdict).toMatchObject({ status: "pass", level: "low" })
  })

  it("defaults level from status when level is missing", () => {
    const text = '{"status":"block"}'
    const verdict = structuredVerdictFromText(text)
    expect(verdict).not.toBeNull()
    expect(verdict!.status).toBe("block")
    expect(verdict!.level).toBe("high") // block → high
  })

  it("returns null for invalid status values", () => {
    expect(structuredVerdictFromText('{"status":"ok","level":"low"}')).toBeNull()
    expect(structuredVerdictFromText('{"status":"BLOCKED"}')).toBeNull() // case-sensitive after lowercase
  })

  it("structured JSON takes priority over regex in explicitGuardVerdictFromText", () => {
    const text = 'PASS\nSome text.\n{"guard":{"status":"revise","level":"medium","reasons":["structured override"]}}'
    const verdict = explicitGuardVerdictFromText(text)
    // The regex would match PASS from first line, but structured JSON should win
    // Actually: structuredVerdictFromText tries to find JSON first
    // explicitGuardVerdictFromText calls structuredVerdictFromText first
    expect(verdict).not.toBeNull()
    expect(verdict!.status).toBe("revise")
    expect(verdict!.level).toBe("medium")
  })

  it("falls back to regex when no structured JSON is present", () => {
    const text = "BLOCK\nThis is dangerous output."
    const verdict = explicitGuardVerdictFromText(text)
    expect(verdict).toMatchObject({ status: "block", level: "high" })
  })
})
