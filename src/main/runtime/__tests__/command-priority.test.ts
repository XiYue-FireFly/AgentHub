import { describe, expect, it } from "vitest"
import { runWorkbenchCommand } from "../commands"

describe("workbench command priority", () => {
  it("prefers ECC commands when a slash label also exists as a builtin", () => {
    expect(runWorkbenchCommand({ text: "/review current changes" })?.source).toBe("ecc")
  })
})
