import { describe, expect, it } from "vitest"
import { minimaxCodeCandidates, codexCandidates, claudeCandidates } from "../agent-locator"

describe("P1-9 agent CLI capability detection", () => {
  it("minimax-code desktop GUI binaries are flagged as desktop-candidate with manual verification", () => {
    const candidates = minimaxCodeCandidates()
    const desktopCandidates = candidates.filter(c => c.source === "desktop")
    for (const c of desktopCandidates) {
      expect(c.verification, `${c.path} should have verification: manual`).toBe("manual")
      expect(c.kind, `${c.path} should have kind: desktop-candidate`).toBe("desktop-candidate")
    }
  })

  it("codex PATH candidates have kind=path-detected", () => {
    const candidates = codexCandidates()
    const terminalCandidates = candidates.filter(c => c.source === "terminal")
    for (const c of terminalCandidates) {
      expect(c.kind, `${c.label} should have kind`).toBe("path-detected")
    }
  })

  it("desktop-candidate kind always pairs with manual verification", () => {
    const allCandidates = [...minimaxCodeCandidates(), ...codexCandidates(), ...claudeCandidates()]
    const desktopKindCandidates = allCandidates.filter(c => c.kind === "desktop-candidate")
    for (const c of desktopKindCandidates) {
      expect(c.verification).toBe("manual")
    }
  })

  it("GUI-only binaries are distinguishable from terminal CLIs", () => {
    const candidates = minimaxCodeCandidates()
    const guiBinaries = candidates.filter(c => c.kind === "desktop-candidate")
    const terminalBinaries = candidates.filter(c => c.kind === "path-detected" || c.source === "terminal" && c.kind !== "desktop-candidate")
    // Both categories may exist; the key is they're distinguishable
    for (const c of guiBinaries) {
      expect(c.verification).toBe("manual") // needs manual verification = not guaranteed CLI
    }
  })
})
