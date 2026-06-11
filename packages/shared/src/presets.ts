import { z } from "zod"

export const PresetNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u, "preset name contains invalid characters")
  .transform((s) => s.normalize("NFC").trim())
  .refine((s) => s.length > 0, "preset name must not be empty after normalization")
  .refine((s) => !s.includes("/") && !s.includes("\\") && !s.includes(".."), "preset name must not contain path separators")

export type PresetName = z.infer<typeof PresetNameSchema>

export const PresetEntrySchema = z.object({
  name: PresetNameSchema,
  buffer: z
    .string()
    .regex(/^[A-Za-z0-9+/=]+$/, "buffer must be base64")
    .max(2048),
  capturedAt: z.string().datetime(),
  capturingTick: z.number().int().nonnegative(),
})
export type PresetEntry = z.infer<typeof PresetEntrySchema>

export const PresetsFileSchema = z.object({
  schema: z.literal("rave.presets/v1"),
  presets: z.array(PresetEntrySchema),
})
export type PresetsFile = z.infer<typeof PresetsFileSchema>
