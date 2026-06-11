import type { Intent, VerbDef } from "./intents"
import type { Profile } from "./profile"
import type { RigConfig } from "./rig"
import type { PresetEntry } from "./presets"
import type { ControlSurfaceLayout } from "./layout"

export const WIRE_SCHEMA = "rave.wire/v1" as const

/** Client → Server */
export type ClientMsg = { type: "intent"; id: string; intent: Intent }

/** Server → Client */
export type ServerMsg =
  | {
      type: "hello"
      schema: typeof WIRE_SCHEMA
      rig: RigConfig
      profiles: Record<string, Profile>
      layout: ControlSurfaceLayout
      presets: PresetEntry[]
      buffer: string // base64-encoded 512 bytes
      tick: number
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
      presets: PresetEntry[]
    }
  | { type: "state_response"; id: string; buffer: string; tick: number }
  | { type: "presets_response"; id: string; presets: PresetEntry[] }
  | { type: "rig_response"; id: string; rig: RigConfig; profiles: Record<string, Profile> }

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
