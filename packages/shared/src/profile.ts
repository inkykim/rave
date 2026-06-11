import { z } from "zod"

/**
 * Channel types are PascalCase to align with Open Fixture Library naming.
 * The MX-4 and Legend 5000X aren't in OFL today, but a converter stays cheap.
 */
export const ChannelTypeSchema = z.enum([
  "ShutterStrobe",
  "Dimmer",
  "ColorWheel",
  "ColorCMY",
  "Gobo",
  "ColorMacro",
  "Pan",
  "Tilt",
  "PanFine",
  "TiltFine",
  "Beam",
  "Zoom",
  "Control",
  "Lamp",
  "Speed",
  "Other",
])
export type ChannelType = z.infer<typeof ChannelTypeSchema>

export const DmxRangeSchema = z
  .tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255)])
  .refine(([lo, hi]) => lo <= hi, "dmxRange: lo must be <= hi")

export type DmxRange = z.infer<typeof DmxRangeSchema>

export const CapabilitySchema = z.object({
  dmxRange: DmxRangeSchema,
  label: z.string().min(1).max(64),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  gobo: z.string().max(64).optional(),
  effect: z.string().max(64).optional(),
})
export type Capability = z.infer<typeof CapabilitySchema>

export const ChannelDefSchema = z.object({
  name: z.string().min(1).max(64),
  type: ChannelTypeSchema,
  capabilities: z.array(CapabilitySchema).min(1),
})
export type ChannelDef = z.infer<typeof ChannelDefSchema>

export const ModeSchema = z.object({
  channels: z.array(ChannelDefSchema).min(1).max(512),
})
export type Mode = z.infer<typeof ModeSchema>

export const ProfileSchema = z.object({
  schema: z.literal("rave.profile/v1"),
  manufacturer: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  modes: z.record(z.string(), ModeSchema),
})
export type Profile = z.infer<typeof ProfileSchema>
