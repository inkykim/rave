import {
  WIRE_SCHEMA,
  type Intent,
  type ServerMsg,
  type ClientMsg,
} from "@rave/shared"
import {
  IntentDisconnectedError,
  IntentNoAckError,
  IntentRejectedError,
  type PendingIntent,
} from "../types"
import type { StoreBag } from "./store-bag"
import { VERB_CATALOG } from "@rave/shared"

const HELLO_TIMEOUT_MS = 3000
const LIVENESS_DEADLINE_MS = 5000
const INTENT_ACK_TIMEOUT_MS = 10000
const RECONNECT_BASE_MS = 1000
const RECONNECT_JITTER_MS = 250

const REQUIRES_ACK = new Map<string, boolean>(
  VERB_CATALOG.map((v) => [v.verb, v.requiresAck]),
)

function computeWsUrl(): string {
  if (typeof location === "undefined") return "ws://127.0.0.1:5173/ws"
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${location.host}/ws`
}

/**
 * WSClient: state machine for the daemon WebSocket. Built around the
 * reconnectGen capture-by-value pattern — every async continuation
 * compares its captured gen to `this.reconnectGen` and bails if stale.
 *
 * Race tests in ws-client.test.ts exercise: ghost-socket on reconnect,
 * hello/state ordering, HMR double-client.
 */
export class WSClient {
  private ws: WebSocket | null = null
  private reconnectGen = 0
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private livenessTimer: ReturnType<typeof setTimeout> | null = null
  private lastMessageAt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingIntents = new Map<string, PendingIntent>()
  private suppressReconnect = false
  private warnedPreHello = false
  private url: string

  // visibilitychange handler reference so we can detach it on HMR dispose
  private visibilityHandler: (() => void) | null = null

  constructor(private readonly stores: StoreBag, urlOverride?: string) {
    this.url = urlOverride ?? computeWsUrl()
  }

  connect(): void {
    if (this.ws) return // already connecting/connected for this gen
    this.stores.connection.url = this.url
    this.stores.connection.state = "connecting"
    this.openSocket(++this.reconnectGen)
    this.installVisibilityHandler()
  }

  /** Close the socket and stop reconnect. Used by HMR dispose. */
  close(): void {
    this.suppressReconnect = true
    ++this.reconnectGen
    this.clearReconnectTimer()
    this.clearHelloTimer()
    this.clearLivenessTimer()
    this.rejectAllPendingOnClose()
    try { this.ws?.close(1000, "client.close") } catch { /* ignore */ }
    this.ws = null
    if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler)
    this.visibilityHandler = null
  }

  /** Detach module-scoped listeners without closing the socket (HMR). */
  detachModuleListeners(): void {
    if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler)
    this.visibilityHandler = null
  }

  /** Send an intent. Returns a promise resolved on ack, rejected on error/timeout/disconnect. */
  sendIntent(intent: Intent): Promise<void> {
    const id = crypto.randomUUID()
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const entry = this.pendingIntents.get(id)
        if (!entry) return
        this.pendingIntents.delete(id)
        const err = new IntentNoAckError(intent, "no ack within 10s")
        const surface = REQUIRES_ACK.get(intent.verb) ?? false
        if (surface) {
          this.stores.errors.push({ id, message: err.message, code: err.code, at: Date.now() })
        }
        entry.reject(err)
      }, INTENT_ACK_TIMEOUT_MS)

      // Register FIRST so a synchronous-throwing send cleanly rejects.
      this.pendingIntents.set(id, { intent, resolve, reject, sentAt: Date.now(), timeoutId })
      try {
        const msg: ClientMsg = { type: "intent", id, intent }
        this.ws?.send(JSON.stringify(msg))
      } catch (err) {
        clearTimeout(timeoutId)
        this.pendingIntents.delete(id)
        reject(new IntentDisconnectedError(intent, String(err)))
      }
    })
  }

  // ───────── Internals ─────────

  private openSocket(gen: number): void {
    const ws = new WebSocket(this.url)
    ws.binaryType = "arraybuffer"
    this.ws = ws

    ws.onopen = () => {
      if (gen !== this.reconnectGen) { try { ws.close() } catch {} ; return }
      this.stores.connection.state = "awaiting_hello"
      this.warnedPreHello = false
      this.bumpLiveness()
      this.helloTimer = setTimeout(() => {
        if (gen !== this.reconnectGen) return
        try { ws.close(4000, "no-hello") } catch {}
      }, HELLO_TIMEOUT_MS)
    }
    ws.onmessage = (ev) => {
      if (gen !== this.reconnectGen) return
      this.onMessage(ev)
    }
    ws.onclose = () => {
      if (gen !== this.reconnectGen) return
      this.onClose()
    }
    ws.onerror = () => {
      if (gen !== this.reconnectGen) return
      // Let onclose handle the actual recovery; this is mostly for logging.
      console.debug("[ws-client] ws error event")
    }
  }

  private onMessage(ev: MessageEvent): void {
    this.bumpLiveness()
    let msg: ServerMsg
    try {
      const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)
      msg = JSON.parse(raw) as ServerMsg
    } catch (err) {
      console.warn("[ws-client] dropped malformed frame:", err)
      return
    }
    if (this.stores.connection.state === "awaiting_hello" && msg.type !== "hello") {
      if (!this.warnedPreHello) {
        console.debug("[ws-client] dropped pre-hello message:", msg.type)
        this.warnedPreHello = true
      }
      return
    }
    this.dispatch(msg)
  }

  private dispatch(msg: ServerMsg): void {
    switch (msg.type) {
      case "hello": {
        if (msg.schema !== WIRE_SCHEMA) {
          console.warn("[ws-client] hello with unexpected schema:", msg.schema)
        }
        this.clearHelloTimer()
        this.stores.rig.rig = msg.rig
        this.stores.rig.profiles = msg.profiles
        this.stores.rig.layout = msg.layout
        this.stores.rig.effectiveLayout = msg.effectiveLayout
        this.stores.rig.warnings = msg.warnings ?? null
        this.stores.presets.replace(msg.presets)
        this.stores.buffer.replace(decodeBase64(msg.buffer), msg.tick)
        this.stores.connection.state = "ready"
        return
      }
      case "state": {
        this.stores.buffer.replace(decodeBase64(msg.buffer), msg.tick)
        return
      }
      case "presets": {
        this.stores.presets.replace(msg.presets)
        return
      }
      case "ack": {
        const entry = this.pendingIntents.get(msg.id)
        if (!entry) return
        clearTimeout(entry.timeoutId)
        this.pendingIntents.delete(msg.id)
        entry.resolve()
        return
      }
      case "error": {
        if (msg.id != null) {
          const entry = this.pendingIntents.get(msg.id)
          if (entry) {
            clearTimeout(entry.timeoutId)
            this.pendingIntents.delete(msg.id)
            const err = new IntentRejectedError(entry.intent, msg.code, msg.message)
            entry.reject(err)
            this.stores.errors.push({ id: msg.id, message: msg.message, code: msg.code, at: Date.now() })
            return
          }
        }
        this.stores.errors.push({ id: msg.id ?? crypto.randomUUID(), message: msg.message, code: msg.code, at: Date.now() })
        return
      }
      case "describe":
      case "state_response":
      case "presets_response":
      case "rig_response":
      case "audit_tail_response": {
        // Read responses surface to whatever invoked them; for v1 we just log.
        console.debug("[ws-client] read response:", msg.type)
        return
      }
      default: {
        const _exhaustive: never = msg
        void _exhaustive
        return
      }
    }
  }

  private onClose(): void {
    this.clearHelloTimer()
    this.clearLivenessTimer()
    this.rejectAllPendingOnClose()
    this.ws = null
    if (this.suppressReconnect) {
      this.stores.connection.state = "dead"
      return
    }
    this.stores.connection.state = "reconnecting"
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    const gen = ++this.reconnectGen
    const jitter = (Math.random() - 0.5) * 2 * RECONNECT_JITTER_MS
    this.reconnectTimer = setTimeout(() => {
      if (gen !== this.reconnectGen) return
      this.stores.connection.state = "connecting"
      this.openSocket(gen)
    }, RECONNECT_BASE_MS + jitter)
  }

  private bumpLiveness(): void {
    this.lastMessageAt = performance.now()
    this.armLiveness()
  }

  private armLiveness(): void {
    if (this.livenessTimer != null) clearTimeout(this.livenessTimer)
    const dueIn = (this.lastMessageAt + LIVENESS_DEADLINE_MS) - performance.now()
    this.livenessTimer = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      if (performance.now() - this.lastMessageAt < LIVENESS_DEADLINE_MS) {
        this.armLiveness()
        return
      }
      try { this.ws?.close(4001, "silent") } catch {}
    }, Math.max(dueIn, 100))
  }

  private installVisibilityHandler(): void {
    if (typeof document === "undefined") return
    if (this.visibilityHandler) return
    const handler = (): void => {
      if (document.visibilityState === "hidden") {
        this.suppressReconnect = true
        ++this.reconnectGen
        try { this.ws?.close(1000, "background") } catch {}
      } else {
        this.suppressReconnect = false
        if (!this.ws) this.connect()
      }
    }
    this.visibilityHandler = handler
    document.addEventListener("visibilitychange", handler)
  }

  private rejectAllPendingOnClose(): void {
    const orphans = [...this.pendingIntents.values()]
    this.pendingIntents.clear()
    for (const p of orphans) {
      clearTimeout(p.timeoutId)
      const surface = REQUIRES_ACK.get(p.intent.verb) ?? false
      const err = new IntentDisconnectedError(p.intent, "ws closed")
      if (surface) {
        this.stores.errors.push({ id: crypto.randomUUID(), message: err.message, code: err.code, at: Date.now() })
      }
      p.reject(err)
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
  }
  private clearHelloTimer(): void {
    if (this.helloTimer != null) { clearTimeout(this.helloTimer); this.helloTimer = null }
  }
  private clearLivenessTimer(): void {
    if (this.livenessTimer != null) { clearTimeout(this.livenessTimer); this.livenessTimer = null }
  }
}

function decodeBase64(b64: string): Uint8Array {
  // Browser-side base64 decode. `atob` -> binary string -> Uint8Array.
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Note: the HMR-surviving singleton is wired up in apps/web/src/main.ts
// (it needs the runes-backed stores from .svelte.ts, which would force
// every importer of WSClient — including bun tests — to evaluate Svelte
// compile-time runes).
