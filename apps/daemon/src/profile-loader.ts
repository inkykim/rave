import { readdir, readFile } from "node:fs/promises"
import { join, extname, basename } from "node:path"
import { ProfileSchema, type Profile } from "@rave/shared"

export class ProfileLoadError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`[profile-loader] ${path}: ${message}`)
    this.name = "ProfileLoadError"
  }
}

export async function loadProfiles(profilesDir: string): Promise<Record<string, Profile>> {
  let entries: string[]
  try {
    entries = await readdir(profilesDir)
  } catch (err) {
    throw new ProfileLoadError(profilesDir, `cannot read profiles dir: ${(err as Error).message}`)
  }

  const profiles: Record<string, Profile> = {}
  for (const entry of entries) {
    if (extname(entry) !== ".json") continue
    const path = join(profilesDir, entry)
    const id = basename(entry, ".json")

    let raw: unknown
    try {
      const text = await readFile(path, "utf8")
      raw = JSON.parse(text)
    } catch (err) {
      throw new ProfileLoadError(path, `parse failed: ${(err as Error).message}`)
    }

    const parsed = ProfileSchema.safeParse(raw)
    if (!parsed.success) {
      throw new ProfileLoadError(path, `schema validation failed: ${parsed.error.message}`)
    }
    profiles[id] = parsed.data
  }

  return profiles
}
