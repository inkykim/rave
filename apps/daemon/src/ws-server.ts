import { readFile } from "node:fs/promises"
import {
  IntentSchema,
  ControlSurfaceLayoutSchema,
  VERB_CATALOG,
  WIRE_SCHEMA,
  expandLayout,
  type ClientMsg,
  type ServerMsg,
  type ControlSurfaceLayout,
  type DaemonWarnings,
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

/**
 * Hardcoded minimal layout used when the on-disk layout fails to load. Master
 * controls only; per-fixture rows are appended by expandLayout regardless.
 */
const FALLBACK_LAYOUT: ControlSurfaceLayout = {
  schema: "rave.layout/v1",
  pages: [
    {
      name: "main",
      grid: { rows: 1, cols: 5 },
      pads: [
        { row: 0, col: 0, label: "Strike all", pressIntent: { verb: "strike_all" } },
        { row: 0, col: 1, label: "Blackout", pressIntent: { verb: "blackout" } },
        { row: 0, col: 2, label: "Home", pressIntent: { verb: "home_all" } },
        { row: 0, col: 3, label: "Reset all", pressIntent: { verb: "reset", fixture: "" } },
        { row: 0, col: 4, label: "Panic", pressIntent: { verb: "panic" } },
      ],
    },
  ],
}

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

  const { layout, warnings } = await loadLayoutWithFallback(opts.layoutPath)
  const effectiveLayout = expandLayout(layout, opts.rig.config, opts.profiles)

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
          effectiveLayout,
          presets: opts.presets.list(),
          buffer: Buffer.from(bytes).toString("base64"),
          tick: opts.buffer.tick,
          ...(warnings ? { warnings } : {}),
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
          await handleIntent(intent, id, ws, opts, layout, effectiveLayout, warnings)
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
          // For rejected preset_* mutations, broadcast the unchanged presets list
          // with the rejected intent's id so clients can reconcile optimistic state.
          if (intent.verb === "preset_save" || intent.verb === "preset_recall" || intent.verb === "preset_delete") {
            broadcast(ws, { type: "presets", presets: opts.presets.list(), causedBy: id })
          }
        }
      },
      close(ws) {
        ws.unsubscribe("rave:state")
        ws.unsubscribe("rave:presets")
      },
    },
  })

  console.log(`[ws] listening on ws://${hostname}:${port}/ws`)
  if (warnings?.layout_invalid) {
    console.warn(`[ws] layout fallback active; hello emits warnings.layout_invalid=true`)
  }
  return server
}

async function loadLayoutWithFallback(
  path: string,
): Promise<{ layout: ControlSurfaceLayout; warnings: DaemonWarnings | null }> {
  try {
    const text = await readFile(path, "utf8")
    const raw = JSON.parse(text)
    const parsed = ControlSurfaceLayoutSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn(`[layout] ${path}: ${parsed.error.message.slice(0, 256)} — using fallback`)
      return { layout: FALLBACK_LAYOUT, warnings: { layout_invalid: true } }
    }
    return { layout: parsed.data, warnings: null }
  } catch (err) {
    console.warn(`[layout] ${path}: ${(err as Error).message} — using fallback`)
    return { layout: FALLBACK_LAYOUT, warnings: { layout_invalid: true } }
  }
}

async function handleIntent(
  intent: Intent,
  id: string,
  ws: import("bun").ServerWebSocket<SocketData>,
  opts: WsServerOptions,
  layout: ControlSurfaceLayout,
  effectiveLayout: ControlSurfaceLayout,
  warnings: DaemonWarnings | null,
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
      const msg: ServerMsg = {
        type: "describe",
        verbs: VERB_CATALOG,
        rig: opts.rig.config,
        profiles: opts.profiles,
        layout,
        effectiveLayout,
        presets: opts.presets.list(),
        ...(warnings ? { warnings } : {}),
      }
      ws.send(JSON.stringify(msg))
      ws.send(JSON.stringify({ type: "ack", id } satisfies ServerMsg))
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
    case "get_audit_tail": {
      const entries = await opts.audit.tail(intent.limit)
      const msg: ServerMsg = { type: "audit_tail_response", id, entries }
      ws.send(JSON.stringify(msg))
      return
    }
    default: {
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
  ws.send(JSON.stringify(msg))
}

function broadcast(ws: import("bun").ServerWebSocket<SocketData>, msg: ServerMsg): void {
  const text = JSON.stringify(msg)
  const topic = msg.type === "presets" ? "rave:presets" : "rave:state"
  ws.publish(topic, text)
  ws.send(text)
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
