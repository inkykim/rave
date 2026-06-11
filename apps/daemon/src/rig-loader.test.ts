import { describe, expect, test } from "bun:test"
import { writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadRig } from "./rig-loader"
import type { Profile } from "@rave/shared"

const mx4: Profile = {
  schema: "rave.profile/v1",
  manufacturer: "Martin",
  model: "MX-4",
  modes: {
    "7-channel": {
      channels: [
        { name: "Shutter", type: "ShutterStrobe", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
        { name: "Color", type: "ColorWheel", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
        { name: "Gobo", type: "Gobo", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
        { name: "Pan", type: "Pan", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
        { name: "Tilt", type: "Tilt", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
        { name: "Speed", type: "Speed", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
        { name: "CSpeed", type: "Speed", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
      ],
    },
  },
}

const profiles = { "martin-mx-4": mx4 }

async function withTmp<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "rave-test-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function writeRig(dir: string, json: unknown): Promise<string> {
  const path = join(dir, "rig.json")
  await writeFile(path, JSON.stringify(json), "utf8")
  return path
}

describe("loadRig", () => {
  test("loads a valid 2-fixture rig", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v1",
        universe: 1,
        fixtures: [
          { id: "mx4-1", profile: "martin-mx-4", mode: "7-channel", start: 1, position: { x: 0, y: 0 } },
          { id: "mx4-2", profile: "martin-mx-4", mode: "7-channel", start: 11, position: { x: 1, y: 0 } },
        ],
      })
      const rig = await loadRig(path, profiles)
      expect(rig.fixtures.length).toBe(2)
      expect(rig.fixtures[0]!.width).toBe(7)
      expect(rig.byId.get("mx4-1")?.start).toBe(1)
    })
  })

  test("rejects DMX address overlap", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v1",
        universe: 1,
        fixtures: [
          { id: "a", profile: "martin-mx-4", mode: "7-channel", start: 1, position: { x: 0, y: 0 } },
          { id: "b", profile: "martin-mx-4", mode: "7-channel", start: 5, position: { x: 1, y: 0 } },
        ],
      })
      await expect(loadRig(path, profiles)).rejects.toThrow(/address overlap/)
    })
  })

  test("rejects oversubscription past channel 512", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v1",
        universe: 1,
        fixtures: [{ id: "a", profile: "martin-mx-4", mode: "7-channel", start: 510, position: { x: 0, y: 0 } }],
      })
      await expect(loadRig(path, profiles)).rejects.toThrow(/oversubscribes/)
    })
  })

  test("rejects unknown profile reference", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v1",
        universe: 1,
        fixtures: [{ id: "a", profile: "nonexistent", mode: "7-channel", start: 1, position: { x: 0, y: 0 } }],
      })
      await expect(loadRig(path, profiles)).rejects.toThrow(/unknown profile/)
    })
  })

  test("rejects unknown mode reference", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v1",
        universe: 1,
        fixtures: [{ id: "a", profile: "martin-mx-4", mode: "wrong-mode", start: 1, position: { x: 0, y: 0 } }],
      })
      await expect(loadRig(path, profiles)).rejects.toThrow(/unknown mode/)
    })
  })

  test("rejects duplicate fixture ids", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v1",
        universe: 1,
        fixtures: [
          { id: "a", profile: "martin-mx-4", mode: "7-channel", start: 1, position: { x: 0, y: 0 } },
          { id: "a", profile: "martin-mx-4", mode: "7-channel", start: 11, position: { x: 1, y: 0 } },
        ],
      })
      await expect(loadRig(path, profiles)).rejects.toThrow(/duplicate fixture id/)
    })
  })

  test("rejects malformed JSON", async () => {
    await withTmp(async (dir) => {
      const path = join(dir, "rig.json")
      await writeFile(path, "{ not json", "utf8")
      await expect(loadRig(path, profiles)).rejects.toThrow(/parse failed/)
    })
  })

  test("rejects bad schema (e.g., wrong schema string)", async () => {
    await withTmp(async (dir) => {
      const path = await writeRig(dir, {
        schema: "rave.rig/v99",
        universe: 1,
        fixtures: [{ id: "a", profile: "martin-mx-4", mode: "7-channel", start: 1, position: { x: 0, y: 0 } }],
      })
      await expect(loadRig(path, profiles)).rejects.toThrow(/schema validation failed/)
    })
  })
})
