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
})
