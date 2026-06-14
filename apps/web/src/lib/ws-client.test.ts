import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Server, WebSocket as MockWebSocket } from "mock-socket"
import { WIRE_SCHEMA } from "@rave/shared"
import { WSClient } from "./ws-client"
import { TestStoreBag } from "./store-bag"

const TEST_URL = "ws://127.0.0.1:5173/ws"

function makeHello(buffer = btoa("\0".repeat(512)), tick = 0): Record<string, unknown> {
  return {
    type: "hello",
    schema: WIRE_SCHEMA,
    rig: { schema: "rave.rig/v1", universe: 1, fixtures: [] },
    profiles: {},
    layout: { schema: "rave.layout/v1", pages: [{ name: "main", grid: { rows: 1, cols: 1 }, pads: [] }] },
    effectiveLayout: { schema: "rave.layout/v1", pages: [{ name: "main", grid: { rows: 1, cols: 1 }, pads: [] }] },
    presets: [],
    buffer,
    tick,
  }
}

// Install mock-socket's WebSocket on globalThis so `new WebSocket(...)` in WSClient hits it.
let testServer: Server | null = null
const originalWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket

beforeEach(() => {
  ;(globalThis as { WebSocket: unknown }).WebSocket = MockWebSocket
})

afterEach(() => {
  if (testServer) {
    testServer.stop()
    testServer = null
  }
  if (originalWebSocket) (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

describe("WSClient", () => {
  test("connects, receives hello, transitions to ready", async () => {
    testServer = new Server(TEST_URL)
    let helloSent = false
    testServer.on("connection", (socket) => {
      socket.send(JSON.stringify(makeHello()))
      helloSent = true
    })

    const stores = new TestStoreBag()
    const client = new WSClient(stores, TEST_URL)
    client.connect()

    await waitFor(() => stores.connection.state === "ready")

    expect(helloSent).toBe(true)
    expect(stores.connection.state).toBe("ready")
    expect(stores.buffer.bytes.length).toBe(512)
    client.close()
  })

  test("ghost socket from prior gen is ignored after reconnect", async () => {
    testServer = new Server(TEST_URL)
    let connectionCount = 0
    testServer.on("connection", (socket) => {
      connectionCount += 1
      socket.send(JSON.stringify(makeHello()))
    })

    const stores = new TestStoreBag()
    const client = new WSClient(stores, TEST_URL)
    client.connect()

    await waitFor(() => stores.connection.state === "ready")
    expect(connectionCount).toBe(1)

    // Force a server-side close → client should reconnect
    for (const s of testServer.clients()) s.close()
    await waitFor(() => stores.connection.state === "reconnecting" || stores.connection.state === "connecting")

    // Wait for second connection + ready
    await waitFor(() => stores.connection.state === "ready", 4000)
    expect(connectionCount).toBe(2)
    client.close()
  })

  test("hello+state in rapid succession applies state buffer after hello", async () => {
    testServer = new Server(TEST_URL)
    testServer.on("connection", (socket) => {
      socket.send(JSON.stringify(makeHello()))
      const stateBuf = new Uint8Array(512)
      stateBuf[0] = 0xab
      stateBuf[5] = 0x7f
      const stateB64 = btoa(String.fromCharCode(...stateBuf))
      // Send state immediately after hello — same tick
      socket.send(JSON.stringify({ type: "state", buffer: stateB64, tick: 42 }))
    })

    const stores = new TestStoreBag()
    const client = new WSClient(stores, TEST_URL)
    client.connect()

    await waitFor(() => stores.connection.state === "ready" && stores.buffer.tick === 42, 2000)

    expect(stores.buffer.bytes[0]).toBe(0xab)
    expect(stores.buffer.bytes[5]).toBe(0x7f)
    expect(stores.buffer.tick).toBe(42)
    client.close()
  })
})
