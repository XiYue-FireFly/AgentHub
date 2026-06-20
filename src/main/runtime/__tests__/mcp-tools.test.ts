import { describe, expect, it, vi, beforeEach } from "vitest"

const memory: Record<string, any> = {}
vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

vi.mock("../../hub/workspace", () => ({
  getWorkspaceManager: () => ({ getById: () => null })
}))

describe("MCP tool listing", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("validateInitializeResult rejects error responses", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const errorResponse = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid" } })
    const result = validateInitializeResult(errorResponse)
    expect(result.ok).toBe(false)
  })

  it("validateInitializeResult accepts valid initialize result", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const validResponse = JSON.stringify({
      jsonrpc: "2.0", id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "test", version: "1.0" } }
    })
    const result = validateInitializeResult(validResponse)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.result.serverInfo.name).toBe("test")
  })

  it("listMcpServerTools returns error for unknown server", async () => {
    const { listMcpServerTools } = await import("../mcp")
    const result = await listMcpServerTools("nonexistent-id")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("listMcpServerTools returns error for non-stdio server", async () => {
    // Set up an HTTP server in the store
    memory["runtime.mcp.v1"] = {
      version: 1,
      servers: [{
        id: "http-server",
        name: "HTTP MCP",
        source: "user",
        enabled: true,
        transport: "http",
        url: "http://localhost:3000"
      }],
      overrides: {}
    }
    const { listMcpServerTools } = await import("../mcp")
    const result = await listMcpServerTools("http-server")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("stdio")
  })
})
