import type {
  ChannelDef,
  ChannelType,
  Capability,
  ColorSpec,
  Intent,
} from "@rave/shared"
import { DESTRUCTIVE_VERBS } from "@rave/shared"
import type { UniverseBuffer } from "./buffer"
import type { ResolvedFixture, ResolvedRig } from "./rig-loader"

export class DispatchError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "DispatchError"
  }
}

export type DispatchContext = {
  rig: ResolvedRig
  buffer: UniverseBuffer
  allowDestructive: boolean
}

/**
 * IntentDispatcher: handles buffer-mutating verbs. Profile-aware — every
 * verb resolves channel offsets and value buckets through the fixture's
 * Profile. PresetController (separate file) handles persistence verbs.
 */
export function dispatchIntent(intent: Intent, ctx: DispatchContext): void {
  if (DESTRUCTIVE_VERBS.has(intent.verb) && !ctx.allowDestructive) {
    throw new DispatchError(
      "destructive_disabled",
      `${intent.verb} is gated by RAVE_ALLOW_DESTRUCTIVE; enable only with v1.1 safety machine in place`,
    )
  }

  switch (intent.verb) {
    case "color":
      applyColor(intent.fixture, intent.spec, ctx)
      return
    case "gobo":
      applyGobo(intent.fixture, intent.name, ctx)
      return
    case "strike":
      applyLamp(intent.fixture, "on", ctx)
      return
    case "strike_all":
      for (const f of ctx.rig.fixtures) applyLamp(f.id, "on", ctx)
      return
    case "blackout":
      for (const f of ctx.rig.fixtures) applyBlackout(f, ctx)
      return
    case "home":
      applyHome(intent.fixture, ctx)
      return
    case "home_all":
      for (const f of ctx.rig.fixtures) applyHome(f.id, ctx)
      return
    case "reset":
      applyReset(intent.fixture, ctx)
      return
    case "panic":
      for (const f of ctx.rig.fixtures) applyPanic(f, ctx)
      return
    default:
      throw new DispatchError("unsupported_verb", `intent dispatcher does not handle ${intent.verb}`)
  }
}

function requireFixture(id: string, ctx: DispatchContext): ResolvedFixture {
  const fixture = ctx.rig.byId.get(id)
  if (!fixture) throw new DispatchError("unknown_fixture", `unknown fixture "${id}"`)
  return fixture
}

function modeChannels(fixture: ResolvedFixture): ChannelDef[] {
  const mode = fixture.profileRef.modes[fixture.modeName]
  if (!mode) throw new DispatchError("internal_error", `fixture ${fixture.id} mode ${fixture.modeName} missing`)
  return mode.channels
}

function universeOf(fixture: ResolvedFixture, ctx: DispatchContext): number {
  return fixture.universe ?? ctx.rig.config.universe
}

function findChannel(
  fixture: ResolvedFixture,
  type: ChannelType,
): { offset: number; def: ChannelDef } | null {
  const channels = modeChannels(fixture)
  for (let i = 0; i < channels.length; i++) {
    if (channels[i]!.type === type) return { offset: i, def: channels[i]! }
  }
  return null
}

function findCapabilityByLabel(channel: ChannelDef, label: string): Capability | null {
  return channel.capabilities.find((c) => c.label === label) ?? null
}

function rangeMidpoint(range: readonly [number, number]): number {
  return Math.floor((range[0] + range[1]) / 2)
}

function findCapabilityByEffect(channel: ChannelDef, effect: string): Capability | null {
  return channel.capabilities.find((c) => c.effect === effect) ?? null
}

// ───────── Color ─────────

function applyColor(id: string, spec: ColorSpec, ctx: DispatchContext): void {
  const fixture = requireFixture(id, ctx)
  const universe = universeOf(fixture, ctx)

  // CMY first (Legend) — wheel intentionally cleared, macro intentionally cleared
  const cyan = findChannel(fixture, "ColorCMY")
  if (spec.kind === "rgb" && cyan) {
    const { r, g, b } = parseHex(spec.hex)
    const cmyChannels = findCMYChannels(fixture)
    if (!cmyChannels) throw new DispatchError("internal_error", `fixture ${id} has CMY but couldn't resolve C/M/Y`)
    ctx.buffer.write(universe, fixture.start + cmyChannels.c, 255 - r)
    ctx.buffer.write(universe, fixture.start + cmyChannels.m, 255 - g)
    ctx.buffer.write(universe, fixture.start + cmyChannels.y, 255 - b)
    // Reset wheel to white if present, and macro to None
    const wheel = findChannel(fixture, "ColorWheel")
    if (wheel) {
      const open = wheel.def.capabilities.find((c) => /white|open/i.test(c.label)) ?? wheel.def.capabilities[0]!
      ctx.buffer.write(universe, fixture.start + wheel.offset, rangeMidpoint(open.dmxRange))
    }
    const macro = findChannel(fixture, "ColorMacro")
    if (macro) {
      const none = macro.def.capabilities.find((c) => /none/i.test(c.label)) ?? macro.def.capabilities[0]!
      ctx.buffer.write(universe, fixture.start + macro.offset, rangeMidpoint(none.dmxRange))
    }
    return
  }

  // Named color → ColorWheel
  if (spec.kind === "named") {
    const wheel = findChannel(fixture, "ColorWheel")
    if (!wheel) throw new DispatchError("unknown_value", `fixture ${id} has no color wheel; use {kind:"rgb"} or a CMY fixture`)
    const cap = findCapabilityByLabel(wheel.def, spec.name)
    if (!cap) {
      throw new DispatchError(
        "unknown_value",
        `color "${spec.name}" not found on ${id}'s wheel (have: ${wheel.def.capabilities.map((c) => c.label).join(", ")})`,
      )
    }
    ctx.buffer.write(universe, fixture.start + wheel.offset, rangeMidpoint(cap.dmxRange))
    return
  }

  throw new DispatchError("unknown_value", `fixture ${id} cannot resolve color spec`)
}

function findCMYChannels(fixture: ResolvedFixture): { c: number; m: number; y: number } | null {
  const channels = modeChannels(fixture)
  let c = -1
  let m = -1
  let y = -1
  for (let i = 0; i < channels.length; i++) {
    if (channels[i]!.type !== "ColorCMY") continue
    if (/cyan/i.test(channels[i]!.name)) c = i
    else if (/magenta/i.test(channels[i]!.name)) m = i
    else if (/yellow/i.test(channels[i]!.name)) y = i
  }
  if (c < 0 || m < 0 || y < 0) return null
  return { c, m, y }
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

// ───────── Gobo ─────────

function applyGobo(id: string, name: string, ctx: DispatchContext): void {
  const fixture = requireFixture(id, ctx)
  const gobo = findChannel(fixture, "Gobo")
  if (!gobo) throw new DispatchError("unsupported_verb", `fixture ${id} has no gobo wheel`)

  // Match by gobo enum first, then label
  const cap =
    gobo.def.capabilities.find((c) => c.gobo === name) ??
    gobo.def.capabilities.find((c) => c.label.toLowerCase() === name.toLowerCase())

  if (!cap) {
    const available = gobo.def.capabilities.map((c) => c.gobo ?? c.label).join(", ")
    throw new DispatchError("unknown_value", `gobo "${name}" not found on ${id} (have: ${available})`)
  }
  ctx.buffer.write(universeOf(fixture, ctx), fixture.start + gobo.offset, rangeMidpoint(cap.dmxRange))
}

// ───────── Lamp on/off ─────────

function applyLamp(id: string, mode: "on" | "off", ctx: DispatchContext): void {
  const fixture = requireFixture(id, ctx)
  const universe = universeOf(fixture, ctx)
  const effectName = mode === "on" ? "lamp_on" : "lamp_off"

  // Try ShutterStrobe (MX-4) first
  const shutter = findChannel(fixture, "ShutterStrobe")
  if (shutter) {
    const cap = findCapabilityByEffect(shutter.def, effectName)
    if (cap) {
      ctx.buffer.write(universe, fixture.start + shutter.offset, rangeMidpoint(cap.dmxRange))
      return
    }
  }

  // Fall back to dedicated Lamp channel (Legend)
  const lamp = findChannel(fixture, "Lamp")
  if (lamp) {
    const cap = findCapabilityByEffect(lamp.def, effectName)
    if (cap) {
      ctx.buffer.write(universe, fixture.start + lamp.offset, rangeMidpoint(cap.dmxRange))
      return
    }
  }

  throw new DispatchError("unsupported_verb", `fixture ${id} has no lamp ${mode} capability`)
}

// ───────── Blackout / Panic ─────────

/**
 * Blackout = shutter closed + dimmer 0. Panic = shutter closed only (lamps
 * stay on). In v1 NullSink both just write bytes; v1.1's safety transform
 * handles the actual physical implications.
 */
function applyBlackout(fixture: ResolvedFixture, ctx: DispatchContext): void {
  applyPanic(fixture, ctx)
  const dimmer = findChannel(fixture, "Dimmer")
  if (dimmer) {
    ctx.buffer.write(universeOf(fixture, ctx), fixture.start + dimmer.offset, 0)
  }
}

function applyPanic(fixture: ResolvedFixture, ctx: DispatchContext): void {
  const shutter = findChannel(fixture, "ShutterStrobe")
  if (!shutter) return
  const cap =
    shutter.def.capabilities.find((c) => /blackout/i.test(c.label)) ??
    shutter.def.capabilities.find((c) => /closed/i.test(c.label))
  if (!cap) return
  ctx.buffer.write(universeOf(fixture, ctx), fixture.start + shutter.offset, rangeMidpoint(cap.dmxRange))
}

// ───────── Home ─────────

function applyHome(id: string, ctx: DispatchContext): void {
  const fixture = requireFixture(id, ctx)
  const universe = universeOf(fixture, ctx)
  const pan = findChannel(fixture, "Pan")
  const tilt = findChannel(fixture, "Tilt")
  if (pan) ctx.buffer.write(universe, fixture.start + pan.offset, 127)
  if (tilt) ctx.buffer.write(universe, fixture.start + tilt.offset, 127)
  const panFine = findChannel(fixture, "PanFine")
  const tiltFine = findChannel(fixture, "TiltFine")
  if (panFine) ctx.buffer.write(universe, fixture.start + panFine.offset, 0)
  if (tiltFine) ctx.buffer.write(universe, fixture.start + tiltFine.offset, 0)
}

// ───────── Reset ─────────

function applyReset(id: string, ctx: DispatchContext): void {
  const fixture = requireFixture(id, ctx)
  const universe = universeOf(fixture, ctx)

  // MX-4 reset is on the ShutterStrobe channel (effect=reset, range 240–249)
  const shutter = findChannel(fixture, "ShutterStrobe")
  if (shutter) {
    const cap = findCapabilityByEffect(shutter.def, "reset")
    if (cap) {
      ctx.buffer.write(universe, fixture.start + shutter.offset, rangeMidpoint(cap.dmxRange))
      return
    }
  }
  // Legend reset is on Control channel (effect=reset, range 192–255)
  const control = findChannel(fixture, "Control")
  if (control) {
    const cap = findCapabilityByEffect(control.def, "reset")
    if (cap) {
      ctx.buffer.write(universe, fixture.start + control.offset, rangeMidpoint(cap.dmxRange))
      return
    }
  }
  throw new DispatchError("unsupported_verb", `fixture ${id} has no reset capability`)
}

/** Re-export for callers that want to discriminate verb→handler. */
export function isBufferMutatingVerb(verb: Intent["verb"]): boolean {
  return ![
    "preset_save",
    "preset_recall",
    "preset_delete",
    "describe",
    "get_state",
    "get_presets",
    "get_rig",
  ].includes(verb)
}
