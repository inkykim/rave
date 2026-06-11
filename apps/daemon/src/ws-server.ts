import { readFile } from "node:fs/promises"
import {
  IntentSchema,
  ControlSurfaceLayoutSchema,
  VERB_CATALOG,
  WIRE_SCHEMA,
  type ClientMsg,
  type ServerMsg,
  type ControlSurfaceLayout,
  type ErrorCode,
  type Intent,
  type Profile,
} from "@rave/shared"
import type { UniverseBuffer } from "./buffer"
import type { ResolvedRig } from "./rig-loader"
import { dispatchIntent, DispatchError } from "./intent-dispatcher"
import { PresetController, PresetError } from "./preset-controller"
import { AuditLog } from "./audit-log"

type SocketData = {
  clientId: string
}

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4101",
  "http://127.0.0.1:4101",
])

export type WsServerOptions = {
  hostname?: string
  port?: number
  rig: ResolvedRig
  profiles: Record<string, Profile>
  buffer: UniverseBuffer
  presets: PresetController
  layoutPath: string
  audit: AuditLog
  allowDestructive: boolean
}

export async function startWsServer(opts: WsServerOptions) {
  const hostname = opts.hostname ?? "127.0.0.1"
  const port = opts.port ?? 4101

  // Load the layout JSON once at startup
  const layout = await loadLayout(opts.layoutPath)

  const server = Bun.serve<SocketData, never>({
    hostname,
    port,
    fetch(req, server) {
      const origin = req.headers.get("origin") ?? ""
      const url = new URL(req.url)
      if (url.pathname !== "/ws") return new Response("rave daemon", { status: 200 })

      if (origin !== "" && !ALLOWED_ORIGINS.has(origin)) {
        return new Response("origin not allowed", { status: 403 })
      }
      const upgraded = server.upgrade(req, {
        data: { clientId: crypto.randomUUID() } satisfies SocketData,
      })
      if (upgraded) return
      return new Response("websocket upgrade required", { status: 400 })
    },
    websocket: {
      maxPayloadLength: 64 * 1024,
      idleTimeout: 30,
      sendPings: true,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(ws) {
        ws.subscribe("rave:state")
        ws.subscribe("rave:presets")
        const universe = opts.rig.config.universe
        const bytes = opts.buffer.peek(universe)
        const hello: ServerMsg = {
          type: "hello",
          schema: WIRE_SCHEMA,
          rig: opts.rig.config,
          profiles: opts.profiles,
          layout,
          presets: opts.presets.list(),
          buffer: Buffer.from(bytes).toString("base64"),
          tick: opts.buffer.tick,
        }
        ws.send(JSON.stringify(hello))
      },
      async message(ws, raw) {
        let parsed: ClientMsg | null = null
        try {
          const obj = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw))
          if (obj?.type !== "intent" || typeof obj.id !== "string") {
            sendError(ws, null, "malformed", "expected { type: 'intent', id, intent }")
            return
          }
          const intentParse = IntentSchema.safeParse(obj.intent)
          if (!intentParse.success) {
            sendError(ws, obj.id, "malformed", intentParse.error.message.slice(0, 256))
            return
          }
          parsed = { type: "intent", id: obj.id, intent: intentParse.data }
        } catch (err) {
          sendError(ws, null, "malformed", `bad JSON: ${(err as Error).message}`)
          return
        }

        const { id, intent } = parsed
        try {
          await handleIntent(intent, id, ws, opts, layout)
          opts.audit.append({ ts: new Date().toISOString(), clientId: ws.data.clientId, intent, result: "ack" })
        } catch (err) {
          const { code, message } = normalizeError(err)
          sendError(ws, id, code, message)
          opts.audit.append({
            ts: new Date().toISOString(),
            clientId: ws.data.clientId,
            intent,
            result: "error",
            errorCode: code,
          })
        }
      },
      close(ws) {
        ws.unsubscribe("rave:state")
        ws.unsubscribe("rave:presets")
      },
    },
  })

  console.log(`[ws] listening on ws://${hostname}:${port}/ws`)
  return server
}

async function loadLayout(path: string): Promise<ControlSurfaceLayout> {
  const text = await readFile(path, "utf8")
  const raw = JSON.parse(text)
  const parsed = ControlSurfaceLayoutSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`[layout] ${path}: ${parsed.error.message}`)
  }
  return parsed.data
}

async function handleIntent(
  intent: Intent,
  id: string,
  ws: import("bun").ServerWebSocket<SocketData>,
  opts: WsServerOptions,
  layout: ControlSurfaceLayout,
): Promise<void> {
  switch (intent.verb) {
    case "preset_save": {
      const presets = await opts.presets.save(intent.name, opts.buffer.tick)
      ws.send(JSON.stringify({ type: "ack", id } satisfies ServerMsg))
      broadcast(ws, { type: "presets", presets, causedBy: id } satisfies ServerMsg)
      return
    }
    case "preset_recall": {
      await opts.presets.recall(intent.name)
      ws.send(JSON.stringify({ type: "ack", id } satisfies ServerMsg))
      // Buffer was overwritten; broadcast new state
      broadcastState(ws, opts)
      return
    }
    case "preset_delete": {
      const presets = await opts.presets.delete(intent.name)
      ws.send(JSON.stringify({ type: "ack", id } satisfies ServerMsg))
      broadcast(ws, { type: "presets", presets, causedBy: id } satisfies ServerMsg)
      return
    }
    case "describe": {
      const universe = opts.rig.config.universe
      const msg: ServerMsg = {
        type: "describe",
        verbs: VERB_CATALOG,
        rig: opts.rig.config,
        profiles: opts.profiles,
        layout,
        presets: opts.presets.list(),
      }
      ws.send(JSON.stringify(msg))
      ws.send(JSON.stringify({ type: "ack", id } satisfies ServerMsg))
      void universe
      return
    }
    case "get_state": {
      const universe = opts.rig.config.universe
      const bytes = opts.buffer.peek(universe)
      const msg: ServerMsg = {
        type: "state_response",
        id,
        buffer: Buffer.from(bytes).toString("base64"),
        tick: opts.buffer.tick,
      }
      ws.send(JSON.stringify(msg))
      return
    }
    case "get_presets": {
      const msg: ServerMsg = { type: "presets_response", id, presets: opts.presets.list() }
      ws.send(JSON.stringify(msg))
      return
    }
    case "get_rig": {
      const msg: ServerMsg = { type: "rig_response", id, rig: opts.rig.config, profiles: opts.profiles }
      ws.send(JSON.stringify(msg))
      return
    }
    default: {
      // Buffer-mutating verb
      dispatchIntent(intent, { rig: opts.rig, buffer: opts.buffer, allowDestructive: opts.allowDestructive })
      ws.send(JSON.stringify({ type: "ack", id } satisfies ServerMsg))
      broadcastState(ws, opts)
      return
    }
  }
}

function broadcastState(
  ws: import("bun").ServerWebSocket<SocketData>,
  opts: WsServerOptions,
): void {
  const universe = opts.rig.config.universe
  const bytes = opts.buffer.peek(universe)
  const msg: ServerMsg = {
    type: "state",
    buffer: Buffer.from(bytes).toString("base64"),
    tick: opts.buffer.tick,
  }
  ws.publish("rave:state", JSON.stringify(msg))
  // Also send to self because publish doesn't echo by default
  ws.send(JSON.stringify(msg))
}

function broadcast(ws: import("bun").ServerWebSocket<SocketData>, msg: ServerMsg): void {
  const text = JSON.stringify(msg)
  const topic = msg.type === "presets" ? "rave:presets" : "rave:state"
  ws.publish(topic, text)
  ws.send(text) // echo to caller too
}

function sendError(
  ws: import("bun").ServerWebSocket<SocketData>,
  id: string | null,
  code: ErrorCode,
  message: string,
): void {
  const msg: ServerMsg = { type: "error", id, code, message }
  ws.send(JSON.stringify(msg))
}

function normalizeError(err: unknown): { code: ErrorCode; message: string } {
  if (err instanceof DispatchError) return { code: err.code as ErrorCode, message: err.message }
  if (err instanceof PresetError) return { code: err.code as ErrorCode, message: err.message }
  return { code: "internal_error", message: (err as Error).message ?? "unknown error" }
}
