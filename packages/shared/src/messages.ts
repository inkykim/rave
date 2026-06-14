import type { Intent, VerbDef } from "./intents"
import type { Profile } from "./profile"
import type { RigConfig } from "./rig"
import type { PresetEntry } from "./presets"
import type { ControlSurfaceLayout } from "./layout"

export const WIRE_SCHEMA = "rave.wire/v1" as const

/** Warnings the daemon surfaces on `hello` and `describe` without failing startup. */
export type DaemonWarnings = {
  layout_invalid?: boolean
  rig_degraded?: boolean
}

/** One entry in the daemon's audit log; returned by get_audit_tail. */
export type AuditEntrySerialized = {
  ts: string
  clientId: string
  intent: Intent
  result: "ack" | "error"
  errorCode?: string
}

/** Client → Server */
export type ClientMsg = { type: "intent"; id: string; intent: Intent }

/** Server → Client */
export type ServerMsg =
  | {
      type: "hello"
      schema: typeof WIRE_SCHEMA
      rig: RigConfig
      profiles: Record<string, Profile>
      /** The raw layout JSON the daemon loaded (may be the fallback if layout_invalid). */
      layout: ControlSurfaceLayout
      /** Layout with procedurally-generated per-fixture rows appended. */
      effectiveLayout: ControlSurfaceLayout
      presets: PresetEntry[]
      buffer: string // base64-encoded 512 bytes
      tick: number
      warnings?: DaemonWarnings
    }
  | { type: "state"; buffer: string; tick: number }
  | { type: "presets"; presets: PresetEntry[]; causedBy: string | null }
  | { type: "ack"; id: string }
  | { type: "error"; id: string | null; code: ErrorCode; message: string }
  | {
      type: "describe"
      verbs: ReadonlyArray<VerbDef>
      rig: RigConfig
      profiles: Record<string, Profile>
      layout: ControlSurfaceLayout
      effectiveLayout: ControlSurfaceLayout
      presets: PresetEntry[]
      warnings?: DaemonWarnings
    }
  | { type: "state_response"; id: string; buffer: string; tick: number }
  | { type: "presets_response"; id: string; presets: PresetEntry[] }
  | { type: "rig_response"; id: string; rig: RigConfig; profiles: Record<string, Profile> }
  | { type: "audit_tail_response"; id: string; entries: AuditEntrySerialized[] }

export const ERROR_CODES = [
  "unknown_fixture",
  "unknown_value",
  "unsupported_verb",
  "malformed",
  "duplicate_name",
  "preset_not_found",
  "rig_load_failed",
  "profile_load_failed",
  "destructive_disabled",
  "internal_error",
  "io_error",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Binary state frame prefix: makes future framed protocols possible. */
export const BINARY_STATE_PREFIX = 0x00
