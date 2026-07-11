import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const memory: Record<string, any> = {}
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock("node:child_process", () => ({ spawn: spawnMock }))

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os")
  return { ...actual, homedir: () => "__agenthub_mcp_hardening_empty_home__" }
})

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

vi.mock("../../hub/workspace", () => ({
  getWorkspaceManager: () => ({ getById: () => null })
}))

function seedServer(server: Record<string, any>): void {
  memory["runtime.mcp.v1"] = {
    version: 1,
    servers: [{
      id: "hardening-server",
      name: "hardening-server",
      source: "user",
      enabled: true,
      ...server
    }],
    overrides: {}
  }
}

function createMockChild(): EventEmitter & Record<string, any> {
  const child = new EventEmitter() as EventEmitter & Record<string, any>
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn() }
  child.kill = vi.fn()
  return child
}

describe("MCP protocol hardening", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    spawnMock.mockReset()
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("persists every user-configurable field through upsert, list, and reload", async () => {
    const expected = {
      id: "complete-http-server",
      name: "complete-http-server",
      enabled: false,
      transport: "http" as const,
      command: "node",
      args: ["server.js", "--stdio"],
      env: { MCP_ENV: "test" },
      cwd: "C:\\work\\server",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer token", "X-Tenant": "docs" },
      timeoutMs: 12_345,
      trustScope: "workspace",
      trustedWorkspaceRoots: ["C:\\work\\one", "D:\\work\\two"]
    }

    const { listMcpServers, upsertMcpServer } = await import("../mcp")
    expect(upsertMcpServer(expected)).toMatchObject(expected)
    expect(listMcpServers().find(server => server.id === expected.id)).toMatchObject(expected)

    vi.resetModules()
    const reloaded = await import("../mcp")
    expect(reloaded.listMcpServers().find(server => server.id === expected.id)).toMatchObject(expected)
  })

  it("does not allow upsert callers to inject discovery or runtime-status fields", async () => {
    const { upsertMcpServer } = await import("../mcp")

    const server = upsertMcpServer({
      id: "injection-test",
      name: "injection-test",
      transport: "http",
      url: "https://example.test/mcp",
      source: "workspace",
      sourcePath: "C:\\untrusted\\mcp.json",
      status: "error",
      error: "injected error"
    })

    expect(server).toMatchObject({ source: "user", status: "unknown" })
    expect(server.sourcePath).toBeUndefined()
    expect(server.error).toBeUndefined()
    expect(memory["runtime.mcp.v1"].servers[0].sourcePath).toBeUndefined()
    expect(memory["runtime.mcp.v1"].servers[0].error).toBeUndefined()
  })

  it("parses a cross-line pretty initialize response whose strings contain braces, escaped quotes, and backslashes", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: {
          name: "closing } } } opening { { { quote \" slash \\\\ done",
          version: "1.0.0"
        }
      }
    }, null, 2)

    const parsed = validateInitializeResult(response)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.result.serverInfo.name).toBe("closing } } } opening { { { quote \" slash \\\\ done")
    }
  })

  it("skips JSON logs, notifications, and server requests before the target initialize response", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const response = [
      JSON.stringify({ level: "info", message: "server starting", context: { port: 3000 } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 0.5 } }),
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "sampling/createMessage", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 99, result: { protocolVersion: "2024-11-05" } }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "target", version: "1" } }
      })
    ].join("\n")

    const parsed = validateInitializeResult(response)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.result.serverInfo.name).toBe("target")
  })

  it("reports an id mismatch after scanning responses when no id=1 response exists", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const response = [
      JSON.stringify({ level: "info", message: "starting" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 99, result: { protocolVersion: "2024-11-05" } })
    ].join("\n")

    const parsed = validateInitializeResult(response)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("id=1")
  })

  it("does not classify an ordinary JSON log with a result field as a JSON-RPC response", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const response = JSON.stringify({ level: "info", result: "server started" })

    const parsed = validateInitializeResult(response)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("No JSON-RPC initialize response")
  })

  it("preserves source order when a pretty error response precedes a compact success response", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const first = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "pretty response failed first" }
    }, null, 2)
    const second = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05" }
    })

    const parsed = validateInitializeResult(`${first}\n${second}`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("pretty response failed first")
  })

  it("skips a compact wrong id but preserves a later pretty target error before success", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const wrongId = JSON.stringify({ jsonrpc: "2.0", id: 99, result: { protocolVersion: "2024-11-05" } })
    const targetError = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "ordered target error" }
    }, null, 2)
    const success = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } })

    const parsed = validateInitializeResult(`${wrongId}\n${targetError}\n${success}`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("ordered target error")
  })

  it.each(["", "2099-01-01"])("rejects unsupported protocolVersion %j", async protocolVersion => {
    const { validateInitializeResult } = await import("../mcp")
    const response = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion } })

    const parsed = validateInitializeResult(response)

    expect(parsed.ok).toBe(false)
  })

  it.each([65_535, 65_536])("accepts NDJSON and pretty JSON at the %i-code-unit boundary", async length => {
    const { validateInitializeResult } = await import("../mcp")
    const value = {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "boundary", version: "1" } }
    }
    const compact = JSON.stringify(value)
    const pretty = JSON.stringify(value, null, 2)
    const ndjson = `${"x".repeat(length - compact.length - 1)}\n${compact}`
    const fallback = `${"x".repeat(length - pretty.length - 1)}\n${pretty}`

    expect(ndjson).toHaveLength(length)
    expect(fallback).toHaveLength(length)
    expect(validateInitializeResult(ndjson).ok).toBe(true)
    expect(validateInitializeResult(fallback).ok).toBe(true)
  })

  it("rejects both NDJSON and pretty JSON above the 65,536-code-unit boundary", async () => {
    const { validateInitializeResult } = await import("../mcp")
    const value = {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "boundary", version: "1" } }
    }
    const compact = JSON.stringify(value)
    const pretty = JSON.stringify(value, null, 2)
    const ndjson = `${"x".repeat(65_537 - compact.length - 1)}\n${compact}`
    const fallback = `${"x".repeat(65_537 - pretty.length - 1)}\n${pretty}`

    expect(validateInitializeResult(ndjson).ok).toBe(false)
    expect(validateInitializeResult(fallback).ok).toBe(false)
  })

  it.each([
    ["HTML", "<html><body>result protocolVersion</body></html>", "text/html"],
    [
      "JSON-RPC error",
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "result protocolVersion failed" } }),
      "application/json"
    ],
    [
      "mismatched response id",
      JSON.stringify({ jsonrpc: "2.0", id: 99, result: { protocolVersion: "2024-11-05" } }),
      "application/json"
    ]
  ])("rejects HTTP 200 %s initialize responses", async (_label, body, contentType) => {
    seedServer({ transport: "http", url: "https://example.test/mcp" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": contentType }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("error")
  })

  it("accepts a valid HTTP JSON initialize response", async () => {
    seedServer({ transport: "http", url: "https://example.test/mcp" })
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "http", version: "1" } }
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("ok")
  })

  it("settles a running stdio probe immediately on a target JSON-RPC error", async () => {
    vi.useFakeTimers()
    seedServer({ transport: "stdio", command: "fake-mcp", timeoutMs: 10_000 })
    const child = createMockChild()
    spawnMock.mockReturnValue(child)
    const { testMcpServer } = await import("../mcp")
    let settled = false
    const resultPromise = testMcpServer("hardening-server").then(result => {
      settled = true
      return result
    })

    child.stdout.emit("data", `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "initialize rejected by service" }
    })}\n`)
    for (let i = 0; i < 6; i++) await Promise.resolve()
    const settledBeforeExit = settled
    if (!settledBeforeExit) child.emit("exit", 1)
    const result = await resultPromise

    expect(settledBeforeExit).toBe(true)
    expect(result.status).toBe("error")
    expect(result.error).toContain("initialize rejected by service")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("prefers a parsed target error over the process exit diagnostic", async () => {
    vi.useFakeTimers()
    seedServer({ transport: "stdio", command: "fake-mcp", timeoutMs: 10_000 })
    const child = createMockChild()
    spawnMock.mockReturnValue(child)
    const { testMcpServer } = await import("../mcp")
    const resultPromise = testMcpServer("hardening-server")

    child.stdout.emit("data", `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "terminal initialize error" }
    })}\n`)
    child.stderr.emit("data", "generic wrapper stderr")
    child.emit("exit", 17)
    const result = await resultPromise

    expect(result.status).toBe("error")
    expect(result.error).toContain("terminal initialize error")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps a stdio probe pending for logs and notifications until the target response arrives", async () => {
    vi.useFakeTimers()
    seedServer({ transport: "stdio", command: "fake-mcp", timeoutMs: 10_000 })
    const child = createMockChild()
    spawnMock.mockReturnValue(child)
    const { testMcpServer } = await import("../mcp")
    let settled = false
    const resultPromise = testMcpServer("hardening-server").then(result => {
      settled = true
      return result
    })

    child.stdout.emit("data", "server starting on stdio\n")
    child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n`)
    await Promise.resolve()
    expect(settled).toBe(false)

    child.stdout.emit("data", `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "stdio", version: "1" } }
    })}\n`)
    const result = await resultPromise

    expect(result.status).toBe("ok")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("uses a pending wrong-id response as the final protocol diagnostic after stdio exit", async () => {
    vi.useFakeTimers()
    seedServer({ transport: "stdio", command: "fake-mcp", timeoutMs: 10_000 })
    const child = createMockChild()
    spawnMock.mockReturnValue(child)
    const { testMcpServer } = await import("../mcp")
    let settled = false
    const resultPromise = testMcpServer("hardening-server").then(result => {
      settled = true
      return result
    })

    child.stdout.emit("data", `${JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      result: { protocolVersion: "2024-11-05" }
    })}\n`)
    await Promise.resolve()
    expect(settled).toBe(false)

    child.stderr.emit("data", "generic wrapper stderr")
    child.emit("exit", 0)
    const result = await resultPromise

    expect(result.status).toBe("error")
    expect(result.error).toContain("id=1")
    expect(result.error).toContain("99")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("accepts a valid SSE initialize response", async () => {
    seedServer({ transport: "sse", url: "https://example.test/mcp" })
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sse", version: "1" } }
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`event: message\ndata: ${message}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("ok")
  })

  it.each([
    ["empty event value", "event:\n"],
    ["bare event field", "event\n"]
  ])("treats an SSE %s as the default message event", async (_label, eventLine) => {
    seedServer({ transport: "sse", url: "https://example.test/mcp" })
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sse-default", version: "1" } }
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`${eventLine}data: ${message}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("ok")
  })

  it("scans mixed SSE frames and accepts a multiline target response across CRLF and bare CR separators", async () => {
    seedServer({ transport: "sse", url: "https://example.test/mcp" })
    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 0.5 } })
    const serverRequest = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "sampling/createMessage", params: {} })
    const target = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "sse-target", version: "1" } }
    }, null, 2).split("\n").map(line => `data: ${line}`).join("\r\n")
    const body = [
      ": keepalive\r\n\r\n",
      "event: endpoint\rdata: /messages/session-1\r\r",
      "event: keepalive\r\ndata: not-json\r\n\r\n",
      `data: ${notification}\r\n\r\n`,
      `data: ${serverRequest}\r\r`,
      `${target}\r\n\r\n`
    ].join("")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("ok")
  })

  it.each([
    ["explicit message", "event: message\n"],
    ["default message", ""]
  ])("rejects non-JSON data in an SSE %s event before a valid response", async (_label, eventLine) => {
    seedServer({ transport: "sse", url: "https://example.test/mcp" })
    const success = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } })
    const body = `${eventLine}data: not-json\n\nevent: message\ndata: ${success}\n\n`
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("error")
    expect(result.error).toContain("Invalid JSON")
  })

  it("preserves the first target SSE error before a later success", async () => {
    seedServer({ transport: "sse", url: "https://example.test/mcp" })
    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })
    const first = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "first SSE error" } })
    const second = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } })
    const body = `data: ${notification}\n\ndata: ${first}\n\ndata: ${second}\n\n`
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("error")
    expect(result.error).toContain("first SSE error")
  })

  it("reports an SSE id mismatch only after scanning all non-target frames", async () => {
    seedServer({ transport: "sse", url: "https://example.test/mcp" })
    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })
    const wrongId = JSON.stringify({ jsonrpc: "2.0", id: 99, result: { protocolVersion: "2024-11-05" } })
    const body = `: keepalive\n\ndata: ${notification}\n\ndata: ${wrongId}\n\n`
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })))
    const { testMcpServer } = await import("../mcp")

    const result = await testMcpServer("hardening-server")

    expect(result.status).toBe("error")
    expect(result.error).toContain("id=1")
  })

  it.each([
    ["spawn error", (child: EventEmitter & Record<string, any>) => child.emit("error", new Error("spawn failed"))],
    ["early exit", (child: EventEmitter & Record<string, any>) => child.emit("exit", 1)],
    ["protocol error", (child: EventEmitter & Record<string, any>) => child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32600, message: "bad request" } })}\n`)]
  ])("clears the tool-list timeout after an immediate %s", async (_label, terminate) => {
    vi.useFakeTimers()
    seedServer({ transport: "stdio", command: "fake-mcp", timeoutMs: 10_000 })
    const child = createMockChild()
    spawnMock.mockReturnValue(child)
    const { listMcpServerTools } = await import("../mcp")

    const resultPromise = listMcpServerTools("hardening-server")
    terminate(child)
    const result = await resultPromise

    expect(result.ok).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
