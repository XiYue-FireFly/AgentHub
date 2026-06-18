import { describe, expect, it } from "vitest"
import { clampRunTimeout, RUN_TIMEOUT_DEFAULTS } from "../run-preferences"

describe("run preferences", () => {
  it("clamps agent run timeout to the supported 1-60 minute range", () => {
    expect(clampRunTimeout(0)).toBe(RUN_TIMEOUT_DEFAULTS.minMs)
    expect(clampRunTimeout(30 * 60 * 1000)).toBe(30 * 60 * 1000)
    expect(clampRunTimeout(90 * 60 * 1000)).toBe(RUN_TIMEOUT_DEFAULTS.maxMs)
  })

  it("falls back to the default timeout for invalid values", () => {
    expect(clampRunTimeout(Number.NaN)).toBe(RUN_TIMEOUT_DEFAULTS.defaultMs)
  })
})
