import { z } from "zod"
import { PresetNameSchema } from "./presets"

const FixtureIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/)

export const ColorSpecSchema = z.union([
  z.object({ kind: z.literal("named"), name: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("rgb"), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
])
export type ColorSpec = z.infer<typeof ColorSpecSchema>

/**
 * Intent: a single discriminated union. Each verb carries exactly the args
 * it needs and nothing more. Replaces the earlier `Verb + VerbArgs` shape
 * that defaulted to `any`.
 */
export const IntentSchema = z.discriminatedUnion("verb", [
  // Buffer-mutating verbs (IntentDispatcher)
  z.object({ verb: z.literal("color"), fixture: FixtureIdSchema, spec: ColorSpecSchema }),
  z.object({ verb: z.literal("gobo"), fixture: FixtureIdSchema, name: z.string().min(1).max(64) }),
  z.object({ verb: z.literal("strike"), fixture: FixtureIdSchema }),
  z.object({ verb: z.literal("strike_all") }),
  z.object({ verb: z.literal("blackout") }),
  z.object({ verb: z.literal("home"), fixture: FixtureIdSchema }),
  z.object({ verb: z.literal("home_all") }),
  z.object({ verb: z.literal("reset"), fixture: FixtureIdSchema }),
  z.object({ verb: z.literal("panic") }),

  // Persistence verbs (PresetController)
  z.object({ verb: z.literal("preset_save"), name: PresetNameSchema }),
  z.object({ verb: z.literal("preset_recall"), name: PresetNameSchema }),
  z.object({ verb: z.literal("preset_delete"), name: PresetNameSchema }),

  // Read verbs (ReadHandlers; agent-native parity)
  z.object({ verb: z.literal("describe") }),
  z.object({ verb: z.literal("get_state") }),
  z.object({ verb: z.literal("get_presets") }),
  z.object({ verb: z.literal("get_rig") }),
])
export type Intent = z.infer<typeof IntentSchema>

export type Verb = Intent["verb"]

export const DESTRUCTIVE_VERBS = new Set<Verb>(["strike", "strike_all", "reset"])

export type VerbDef = {
  verb: Verb
  description: string
  examples: ReadonlyArray<unknown>
}

export const VERB_CATALOG: ReadonlyArray<VerbDef> = [
  {
    verb: "color",
    description:
      "Set a fixture's color. For wheel fixtures, pass {kind:'named', name:'<color>'}. For CMY fixtures, pass {kind:'rgb', hex:'#rrggbb'}.",
    examples: [
      { verb: "color", fixture: "mx4-1", spec: { kind: "named", name: "Red 304" } },
      { verb: "color", fixture: "legend-1", spec: { kind: "rgb", hex: "#ff0080" } },
    ],
  },
  {
    verb: "gobo",
    description: "Set a fixture's gobo by name. Only fixtures with a Gobo channel accept this.",
    examples: [{ verb: "gobo", fixture: "mx4-1", name: "Web" }],
  },
  {
    verb: "strike",
    description: "Send the lamp-on byte sequence to a fixture. Destructive; gated by RAVE_ALLOW_DESTRUCTIVE in v1.1+.",
    examples: [{ verb: "strike", fixture: "mx4-1" }],
  },
  { verb: "strike_all", description: "Strike all fixtures' lamps. Destructive.", examples: [{ verb: "strike_all" }] },
  { verb: "blackout", description: "Close all shutters / set all dimmers to 0.", examples: [{ verb: "blackout" }] },
  { verb: "home", description: "Send pan/tilt to neutral on a fixture.", examples: [{ verb: "home", fixture: "mx4-1" }] },
  { verb: "home_all", description: "Send pan/tilt to neutral on all fixtures.", examples: [{ verb: "home_all" }] },
  { verb: "reset", description: "Issue motor reset to a fixture. Destructive in v1.1+.", examples: [{ verb: "reset", fixture: "mx4-1" }] },
  { verb: "panic", description: "Close all shutters; do not touch lamp state.", examples: [{ verb: "panic" }] },
  { verb: "preset_save", description: "Capture current buffer as a named preset.", examples: [{ verb: "preset_save", name: "warm-jam" }] },
  { verb: "preset_recall", description: "Recall a preset by name; overwrites buffer.", examples: [{ verb: "preset_recall", name: "warm-jam" }] },
  { verb: "preset_delete", description: "Delete a named preset.", examples: [{ verb: "preset_delete", name: "warm-jam" }] },
  { verb: "describe", description: "Return the full daemon snapshot: verb catalog, rig, profiles, layout, presets.", examples: [{ verb: "describe" }] },
  { verb: "get_state", description: "Return current buffer (base64) and tick.", examples: [{ verb: "get_state" }] },
  { verb: "get_presets", description: "Return preset list.", examples: [{ verb: "get_presets" }] },
  { verb: "get_rig", description: "Return rig config and resolved profiles.", examples: [{ verb: "get_rig" }] },
]
