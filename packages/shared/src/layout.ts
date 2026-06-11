import { z } from "zod"
import { IntentSchema } from "./intents"

export const FeedbackSpecSchema = z.discriminatedUnion("fn", [
  z.object({ fn: z.literal("constant"), color: z.string() }),
  z.object({ fn: z.literal("lampState"), fixture: z.string() }),
  z.object({ fn: z.literal("fixtureColor"), fixture: z.string() }),
  z.object({ fn: z.literal("presetActive"), name: z.string() }),
])
export type FeedbackSpec = z.infer<typeof FeedbackSpecSchema>

export const PadDefSchema = z.object({
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  label: z.string().min(1).max(64),
  pressIntent: IntentSchema,
  feedback: FeedbackSpecSchema.optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  kind: z.enum(["grid", "scene", "control"]).optional(),
})
export type PadDef = z.infer<typeof PadDefSchema>

export const LayoutPageSchema = z.object({
  name: z.string().min(1).max(64),
  grid: z.object({
    rows: z.number().int().min(1).max(32),
    cols: z.number().int().min(1).max(32),
  }),
  pads: z.array(PadDefSchema),
})
export type LayoutPage = z.infer<typeof LayoutPageSchema>

export const ControlSurfaceLayoutSchema = z.object({
  schema: z.literal("rave.layout/v1"),
  pages: z.array(LayoutPageSchema).min(1),
})
export type ControlSurfaceLayout = z.infer<typeof ControlSurfaceLayoutSchema>
