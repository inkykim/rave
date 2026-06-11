import { z } from "zod"

export const FixtureInstanceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "fixture id must be [a-zA-Z0-9_-]"),
  profile: z.string().min(1).max(64),
  mode: z.string().min(1).max(64),
  universe: z.number().int().min(1).max(63999).optional(),
  start: z.number().int().min(1).max(512),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional(),
  }),
  facing: z
    .object({
      panDeg: z.number(),
      tiltDeg: z.number(),
    })
    .optional(),
})
export type FixtureInstance = z.infer<typeof FixtureInstanceSchema>

export const RigConfigSchema = z.object({
  schema: z.literal("rave.rig/v1"),
  universe: z.number().int().min(1).max(63999),
  fixtures: z.array(FixtureInstanceSchema).min(1),
})
export type RigConfig = z.infer<typeof RigConfigSchema>
