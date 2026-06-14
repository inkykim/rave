import { describe, expect, test } from "bun:test"
import { expandLayout } from "./layout-expand"
import type { ControlSurfaceLayout } from "./layout"
import type { RigConfig } from "./rig"
import type { Profile } from "./profile"

const authored: ControlSurfaceLayout = {
  schema: "rave.layout/v1",
  pages: [
    {
      name: "main",
      grid: { rows: 1, cols: 8 },
      pads: [
        { row: 0, col: 0, label: "Blackout", pressIntent: { verb: "blackout" } },
        { row: 0, col: 1, label: "Home", pressIntent: { verb: "home_all" } },
      ],
    },
  ],
}

const mx4Profile: Profile = {
  schema: "rave.profile/v1",
  manufacturer: "Martin",
  model: "MX-4",
  modes: {
    "7-channel": {
      channels: [
        { name: "ColorWheel", type: "ColorWheel", capabilities: [{ dmxRange: [0, 5], label: "White" }] },
        { name: "Gobo", type: "Gobo", capabilities: [{ dmxRange: [0, 11], label: "Open", gobo: "open" }] },
      ],
    },
  },
}

const legendProfile: Profile = {
  schema: "rave.profile/v1",
  manufacturer: "Chauvet",
  model: "Legend 5000X",
  modes: {
    "15-channel": {
      channels: [
        { name: "Cyan", type: "ColorCMY", capabilities: [{ dmxRange: [0, 255], label: "any" }] },
      ],
    },
  },
}

const rig: RigConfig = {
  schema: "rave.rig/v1",
  universe: 1,
  fixtures: [
    { id: "mx4-1", profile: "martin-mx-4", mode: "7-channel", start: 1, position: { x: 0, y: 0 } },
    { id: "legend-1", profile: "chauvet-legend-5000x", mode: "15-channel", start: 11, position: { x: 1, y: 0 } },
  ],
}

const profiles = { "martin-mx-4": mx4Profile, "chauvet-legend-5000x": legendProfile }

describe("expandLayout", () => {
  test("appends per-fixture rows after master controls", () => {
    const expanded = expandLayout(authored, rig, profiles)
    const main = expanded.pages.find((p) => p.name === "main")!
    expect(main.pads.length).toBeGreaterThan(authored.pages[0]!.pads.length)
  })

  test("MX-4 gets color + gobo pads; Legend gets color only", () => {
    const expanded = expandLayout(authored, rig, profiles)
    const main = expanded.pages.find((p) => p.name === "main")!
    const mx4Pads = main.pads.filter((p) => p.label.startsWith("mx4-1:"))
    const legendPads = main.pads.filter((p) => p.label.startsWith("legend-1:"))
    expect(mx4Pads.length).toBe(2)
    expect(legendPads.length).toBe(1)
  })

  test("color pad for CMY fixture uses rgb intent", () => {
    const expanded = expandLayout(authored, rig, profiles)
    const main = expanded.pages.find((p) => p.name === "main")!
    const legendColor = main.pads.find((p) => p.label === "legend-1: color")
    expect(legendColor?.pressIntent).toMatchObject({ verb: "color", fixture: "legend-1" })
    expect((legendColor!.pressIntent as { spec: { kind: string } }).spec.kind).toBe("rgb")
  })

  test("color pad for wheel-only fixture uses named intent", () => {
    const expanded = expandLayout(authored, rig, profiles)
    const main = expanded.pages.find((p) => p.name === "main")!
    const mx4Color = main.pads.find((p) => p.label === "mx4-1: color")
    expect((mx4Color!.pressIntent as { spec: { kind: string } }).spec.kind).toBe("named")
  })

  test("master pads preserved verbatim", () => {
    const expanded = expandLayout(authored, rig, profiles)
    const main = expanded.pages.find((p) => p.name === "main")!
    expect(main.pads.find((p) => p.label === "Blackout")).toBeDefined()
    expect(main.pads.find((p) => p.label === "Home")).toBeDefined()
  })

  test("grid rows expands to fit fixture rows", () => {
    const expanded = expandLayout(authored, rig, profiles)
    const main = expanded.pages.find((p) => p.name === "main")!
    expect(main.grid.rows).toBeGreaterThanOrEqual(3)
  })
})
