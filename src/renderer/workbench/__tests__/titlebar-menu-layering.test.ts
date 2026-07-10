import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("workbench titlebar menu layering", () => {
  it("keeps desktop menus above normal workbench panels", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(css).toMatch(/\.wb-titlebar\s*\{[\s\S]*?z-index:\s*5200/)
    expect(css).toMatch(/\.wb-titlebar\s*\{[\s\S]*?overflow:\s*visible/)
    expect(css).toMatch(/\.wb-menu-wrap\s*\{[\s\S]*?z-index:\s*5210/)
    expect(css).toMatch(/\.wb-menu-wrap\s*\{[\s\S]*?overflow:\s*visible/)
    expect(css).toMatch(/\.wb-menu-dropdown\s*\{[\s\S]*?z-index:\s*5220/)
  })

  it("forces Windows titlebar menus and window actions visible above shell content", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(css).toContain(".wb-titlebar.platform-win32 .wb-menu-wrap")
    expect(css).toContain(".wb-titlebar.platform-win32 .wb-window-actions")
    expect(css).toContain("visibility: visible !important")
    expect(css).toContain("opacity: 1 !important")
    expect(css).toContain("display: flex !important")
    expect(css).toContain(".wb-shell")
    expect(css).toContain("z-index: 1")
  })

  it("keeps the first-run announcement backdrop below the desktop titlebar", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(css).toMatch(/\.wb-announcement-backdrop\s*\{[\s\S]*?top:\s*var\(--wb-titlebar-height,\s*40px\)/)
  })
})
