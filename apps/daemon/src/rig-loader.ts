import { readFile } from "node:fs/promises"
import { RigConfigSchema, type RigConfig, type Profile, type FixtureInstance } from "@rave/shared"

export class RigLoadError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`[rig-loader] ${path}: ${message}`)
    this.name = "RigLoadError"
  }
}

export type ResolvedFixture = FixtureInstance & {
  width: number // channel count consumed by this fixture
  profileRef: Profile
  modeName: string
}

export type ResolvedRig = {
  config: RigConfig
  fixtures: ResolvedFixture[]
  byId: Map<string, ResolvedFixture>
}

export async function loadRig(
  path: string,
  profiles: Record<string, Profile>,
): Promise<ResolvedRig> {
  let raw: unknown
  try {
    const text = await readFile(path, "utf8")
    raw = JSON.parse(text)
  } catch (err) {
    throw new RigLoadError(path, `parse failed: ${(err as Error).message}`)
  }

  const parsed = RigConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new RigLoadError(path, `schema validation failed: ${parsed.error.message}`)
  }
  const config = parsed.data

  // Resolve profile + mode references; compute channel widths.
  const fixtures: ResolvedFixture[] = []
  const idSet = new Set<string>()
  for (const f of config.fixtures) {
    if (idSet.has(f.id)) {
      throw new RigLoadError(path, `duplicate fixture id "${f.id}"`)
    }
    idSet.add(f.id)

    const profile = profiles[f.profile]
    if (!profile) {
      throw new RigLoadError(path, `fixture "${f.id}" references unknown profile "${f.profile}"`)
    }
    const mode = profile.modes[f.mode]
    if (!mode) {
      throw new RigLoadError(
        path,
        `fixture "${f.id}" references unknown mode "${f.mode}" on profile "${f.profile}" (have: ${Object.keys(profile.modes).join(", ")})`,
      )
    }
    fixtures.push({ ...f, width: mode.channels.length, profileRef: profile, modeName: f.mode })
  }

  // Validate DMX address overlap (per universe).
  const occupants = new Map<number, Map<number, string>>() // universe -> channel -> fixtureId
  for (const f of fixtures) {
    const universe = f.universe ?? config.universe
    if (!occupants.has(universe)) occupants.set(universe, new Map())
    const universeMap = occupants.get(universe)!
    for (let ch = f.start; ch < f.start + f.width; ch++) {
      if (ch > 512) {
        throw new RigLoadError(
          path,
          `fixture "${f.id}" oversubscribes universe ${universe} (channels ${f.start}..${f.start + f.width - 1}, max 512)`,
        )
      }
      const prior = universeMap.get(ch)
      if (prior) {
        throw new RigLoadError(
          path,
          `address overlap on universe ${universe} channel ${ch}: "${prior}" and "${f.id}"`,
        )
      }
      universeMap.set(ch, f.id)
    }
  }

  return {
    config,
    fixtures,
    byId: new Map(fixtures.map((f) => [f.id, f])),
  }
}
