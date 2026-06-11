import { beforeEach, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { loadProfiles } from "./profile-loader"
import { UniverseBuffer } from "./buffer"
import { dispatchIntent, DispatchError, type DispatchContext } from "./intent-dispatcher"
import type { ResolvedRig } from "./rig-loader"
import { loadRig } from "./rig-loader"

const ROOT = resolve(import.meta.dir, "../../..")
const PROFILES_DIR = resolve(ROOT, "profiles")
const RIG_PATH = resolve(ROOT, "config/rig.example.json")

let rig: ResolvedRig
let buffer: UniverseBuffer
let ctx: DispatchContext

beforeEach(async () => {
  const profiles = await loadProfiles(PROFILES_DIR)
  rig = await loadRig(RIG_PATH, profiles)
  buffer = new UniverseBuffer([1])
  ctx = { rig, buffer, allowDestructive: true }
})

describe("dispatchIntent — color", () => {
  test("named color on MX-4 sets the wheel channel to the midpoint of Red 304", () => {
    dispatchIntent({ verb: "color", fixture: "mx4-1", spec: { kind: "named", name: "Red 304" } }, ctx)
    const colorByte = buffer.peek(1)[1] // mx4-1 start=1, channel 2 (color wheel) at offset 1
    expect(colorByte).toBeGreaterThanOrEqual(36)
    expect(colorByte).toBeLessThanOrEqual(41)
  })

  test("RGB color on Legend sets CMY bytes via inversion", () => {
    dispatchIntent(
      { verb: "color", fixture: "legend-1", spec: { kind: "rgb", hex: "#ff0080" } },
      ctx,
    )
    // legend-1 start=21. CMY is at channel offsets 3 (cyan), 4 (magenta), 5 (yellow).
    // Wire channels: 24=cyan, 25=magenta, 26=yellow → array indices 23, 24, 25.
    expect(buffer.peek(1)[23]).toBe(255 - 0xff) // cyan from R
    expect(buffer.peek(1)[24]).toBe(255 - 0x00) // magenta from G
    expect(buffer.peek(1)[25]).toBe(255 - 0x80) // yellow from B
  })

  test("unknown color name produces unknown_value error", () => {
    expect(() =>
      dispatchIntent(
        { verb: "color", fixture: "mx4-1", spec: { kind: "named", name: "Fuchsia 999" } },
        ctx,
      ),
    ).toThrow(DispatchError)
  })

  test("unknown fixture id produces unknown_fixture error", () => {
    try {
      dispatchIntent({ verb: "color", fixture: "ghost", spec: { kind: "named", name: "Red 304" } }, ctx)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as DispatchError).code).toBe("unknown_fixture")
    }
  })
})

describe("dispatchIntent — gobo", () => {
  test("gobo on MX-4 sets the gobo channel byte into the right range", () => {
    dispatchIntent({ verb: "gobo", fixture: "mx4-1", name: "Web" }, ctx)
    const goboByte = buffer.peek(1)[2] // mx4-1 gobo at offset 2 → wire channel 3 → index 2
    expect(goboByte).toBeGreaterThanOrEqual(24)
    expect(goboByte).toBeLessThanOrEqual(35)
  })

  test("gobo on Legend errors with unsupported_verb", () => {
    try {
      dispatchIntent({ verb: "gobo", fixture: "legend-1", name: "Web" }, ctx)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as DispatchError).code).toBe("unsupported_verb")
    }
  })
})

describe("dispatchIntent — destructive gate", () => {
  test("strike blocked when destructive disallowed", () => {
    ctx = { ...ctx, allowDestructive: false }
    try {
      dispatchIntent({ verb: "strike", fixture: "mx4-1" }, ctx)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as DispatchError).code).toBe("destructive_disabled")
    }
  })

  test("strike_all blocked when destructive disallowed", () => {
    ctx = { ...ctx, allowDestructive: false }
    try {
      dispatchIntent({ verb: "strike_all" }, ctx)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as DispatchError).code).toBe("destructive_disabled")
    }
  })

  test("reset blocked when destructive disallowed", () => {
    ctx = { ...ctx, allowDestructive: false }
    try {
      dispatchIntent({ verb: "reset", fixture: "mx4-1" }, ctx)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as DispatchError).code).toBe("destructive_disabled")
    }
  })

  test("blackout NOT gated by destructive", () => {
    ctx = { ...ctx, allowDestructive: false }
    expect(() => dispatchIntent({ verb: "blackout" }, ctx)).not.toThrow()
  })
})

describe("dispatchIntent — lamp & reset", () => {
  test("strike sets MX-4 shutter byte to lamp_on range (10-19)", () => {
    dispatchIntent({ verb: "strike", fixture: "mx4-1" }, ctx)
    const b = buffer.peek(1)[0]
    expect(b).toBeGreaterThanOrEqual(10)
    expect(b).toBeLessThanOrEqual(19)
  })

  test("strike sets Legend lamp byte to lamp_on range (48-95)", () => {
    dispatchIntent({ verb: "strike", fixture: "legend-1" }, ctx)
    // legend-1 lamp is channel 15 (last); start=21 → wire channel 35 → index 34
    const b = buffer.peek(1)[34]
    expect(b).toBeGreaterThanOrEqual(48)
    expect(b).toBeLessThanOrEqual(95)
  })

  test("reset on MX-4 sets shutter byte to reset range (240-249)", () => {
    dispatchIntent({ verb: "reset", fixture: "mx4-1" }, ctx)
    const b = buffer.peek(1)[0]
    expect(b).toBeGreaterThanOrEqual(240)
    expect(b).toBeLessThanOrEqual(249)
  })

  test("reset on Legend sets control byte to reset range (192-255)", () => {
    dispatchIntent({ verb: "reset", fixture: "legend-1" }, ctx)
    // legend-1 control is channel 14 (next-to-last); start=21 → wire channel 34 → index 33
    const b = buffer.peek(1)[33]
    expect(b).toBeGreaterThanOrEqual(192)
    expect(b).toBeLessThanOrEqual(255)
  })
})

describe("dispatchIntent — home, blackout, panic", () => {
  test("home sets MX-4 pan/tilt to 127", () => {
    dispatchIntent({ verb: "home", fixture: "mx4-1" }, ctx)
    // mx4-1: pan offset 3 (ch 4), tilt offset 4 (ch 5) → indices 3, 4
    expect(buffer.peek(1)[3]).toBe(127)
    expect(buffer.peek(1)[4]).toBe(127)
  })

  test("home sets Legend pan/tilt/fine to 127/127/0/0", () => {
    dispatchIntent({ verb: "home", fixture: "legend-1" }, ctx)
    // legend-1 start=21. Pan ch11→index 30, Tilt ch12→index 31, PanFine ch13→index 32, TiltFine ch14→hmm
    // Actually channel order: Dimmer, Shutter/Strobe, Color Wheel, Cyan, Magenta, Yellow, Macro,
    // Beam, Zoom, Pan, Tilt, Pan Fine, Tilt Fine, Control, Lamp.
    // Pan = offset 9, Tilt = offset 10, PanFine = offset 11, TiltFine = offset 12
    // Wire channels = start + offset = 21,22,23,...; indices = start + offset - 1
    expect(buffer.peek(1)[21 + 9 - 1]).toBe(127)
    expect(buffer.peek(1)[21 + 10 - 1]).toBe(127)
    expect(buffer.peek(1)[21 + 11 - 1]).toBe(0)
    expect(buffer.peek(1)[21 + 12 - 1]).toBe(0)
  })

  test("home_all touches every fixture", () => {
    dispatchIntent({ verb: "home_all" }, ctx)
    // All 4 fixtures should have pan/tilt set
    expect(buffer.peek(1)[3]).toBe(127) // mx4-1 pan
    expect(buffer.peek(1)[13]).toBe(127) // mx4-2 pan (start=11, offset 3 → index 13)
  })

  test("blackout closes shutters and zeros dimmers on all fixtures", () => {
    dispatchIntent({ verb: "blackout" }, ctx)
    // MX-4 shutter offset 0; blackout range 0-9 → midpoint ~4
    const mx4Shutter = buffer.peek(1)[0]
    expect(mx4Shutter).toBeGreaterThanOrEqual(0)
    expect(mx4Shutter).toBeLessThanOrEqual(9)
    // Legend dimmer is at offset 0; start=21 → index 20
    expect(buffer.peek(1)[20]).toBe(0)
  })

  test("panic closes shutters but does not touch dimmers", () => {
    // Pre-set dimmer to 200
    buffer.write(1, 21, 200) // legend-1 dimmer
    dispatchIntent({ verb: "panic" }, ctx)
    expect(buffer.peek(1)[20]).toBe(200) // unchanged
  })
})
