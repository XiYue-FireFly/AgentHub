import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { HubServer } from "../server"

class FakeSocket extends EventEmitter {
  readyState = 1
  send = vi.fn()
  close = vi.fn()
}

describe("HubServer client lifecycle", () => {
  it("uses the server-minted client ID as the trusted session ID and emits disconnect once", () => {
    const server = new HubServer({ getAll: () => [] } as any)
    const socket = new FakeSocket()
    const disconnected = vi.fn()
    const connectedHandler = vi.fn()
    server.on("client:connected", connectedHandler)
    server.on("client:disconnected", disconnected)

    ;(server as any).handleConnection(socket)
    const connectedMessage = JSON.parse(socket.send.mock.calls[0][0])
    expect(connectedMessage.clientId).toMatch(/^client-/)
    expect(connectedHandler).toHaveBeenCalledWith(expect.objectContaining({ id: connectedMessage.clientId }))
    expect(server.getClientCount()).toBe(1)

    socket.emit("close")
    socket.emit("close")

    expect(server.getClientCount()).toBe(0)
    expect(disconnected).toHaveBeenCalledOnce()
    expect(disconnected).toHaveBeenCalledWith({
      clientId: connectedMessage.clientId,
      sessionId: connectedMessage.clientId
    })
  })

  it("sends a decision frame only to the authenticated client session", () => {
    const server = new HubServer({ getAll: () => [] } as any)
    const first = new FakeSocket()
    const second = new FakeSocket()
    ;(server as any).handleConnection(first)
    ;(server as any).handleConnection(second)
    const firstId = JSON.parse(first.send.mock.calls[0][0]).clientId

    expect(server.sendToClient(firstId, {
      type: "prompt:decision_request",
      payload: { requestId: "request-1", sessionId: firstId }
    })).toBe(true)
    expect(first.send).toHaveBeenLastCalledWith(JSON.stringify({
      type: "prompt:decision_request",
      payload: { requestId: "request-1", sessionId: firstId }
    }))
    expect(second.send).toHaveBeenCalledOnce()
    expect(server.sendToClient("unknown", { type: "prompt:decision_request" })).toBe(false)
  })
})
