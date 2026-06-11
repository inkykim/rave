import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { loadProfiles } from "./profile-loader"

const PROFILES_DIR = resolve(import.meta.dir, "../../..", "profiles")

describe("loadProfiles", () => {
  test("loads the v1 ship profiles", async () => {
    const profiles = await loadProfiles(PROFILES_DIR)
    expect(profiles["martin-mx-4"]).toBeDefined()
    expect(profiles["chauvet-legend-5000x"]).toBeDefined()
  })

  test("MX-4 7-channel mode has exactly 7 channels", async () => {
    const profiles = await loadProfiles(PROFILES_DIR)
    const mx4 = profiles["martin-mx-4"]
    expect(mx4?.modes["7-channel"]?.channels.length).toBe(7)
  })

  test("Legend 15-channel mode has exactly 15 channels", async () => {
    const profiles = await loadProfiles(PROFILES_DIR)
    const legend = profiles["chauvet-legend-5000x"]
    expect(legend?.modes["15-channel"]?.channels.length).toBe(15)
  })

  test("MX-4 gobo wheel has 20 capabilities (open + 19 gobos)", async () => {
    const profiles = await loadProfiles(PROFILES_DIR)
    const mx4 = profiles["martin-mx-4"]
    const gobo = mx4?.modes["7-channel"]?.channels.find((c) => c.type === "Gobo")
    expect(gobo?.capabilities.length).toBe(20)
  })

  test("rejects a directory that does not exist", async () => {
    await expect(loadProfiles("/nonexistent/path")).rejects.toThrow(/cannot read profiles dir/)
  })
})
