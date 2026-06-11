---
title: Rave v1 — Lighting Control App (Daemon + Web Preview)
type: feat
status: active
date: 2026-06-10
origin: docs/brainstorms/2026-06-09-rave-control-app-requirements.md
---

# Rave v1 — Lighting Control App (Daemon + Web Preview)

## Enhancement Summary

**Deepened on:** 2026-06-10
**Sections enhanced:** Wire Schemas, Architecture, Phases 1–9, Risk Analysis, Future Considerations
**Review agents used:** kieran-typescript-reviewer, architecture-strategist, code-simplicity-reviewer, performance-oracle, julik-frontend-races-reviewer, security-sentinel, agent-native-reviewer, data-integrity-guardian, pattern-recognition-specialist, best-practices-researcher, framework-docs-researcher

### Key Improvements (blocking corrections)
1. **Svelte 5: `$state.raw` not `$state` for the `Uint8Array` buffer.** Typed arrays are not proxied — in-place mutation silently fails to trigger reactivity. Every WS `state` message must assign a *fresh* `Uint8Array` reference. Without this fix, Phase 6 would ship broken.
2. **Discriminated `Intent` union, not `Verb` + `VerbArgs`.** The original `args: VerbArgs` reference defaults to `any`. Replaced with a per-verb discriminated union. Validated at runtime via Zod.
3. **Explicit `127.0.0.1` bind on `Bun.serve`.** Bun's default is `0.0.0.0` — a misconfiguration would expose the rig to the LAN. Added an Origin allow-list and a per-session token to prevent cross-origin WS hijacking from malicious web pages (real risk once v1.1 ships real DMX).
4. **Promise-queue serialization of preset mutations.** Bun is single-threaded but `await Bun.write` yields; two `preset.save` intents in the same tick could lose data.
5. **`PresetEntry` and `Intent` types fully defined** (both were referenced-but-missing in the original plan).
6. **Bun native pub/sub + binary WS frames + `sendPings:true`.** Replaces ad-hoc broadcast loop and app-level heartbeat. Drops payload from ~2 KB JSON to 512 B binary; eliminates one timer and a class of multi-tab edge cases.

### New Considerations Discovered
- Neither the Martin MX-4 nor the Chauvet Legend 5000X exists in the Open Fixture Library (researched). The custom-minimal schema decision is validated — there are no community profiles to import.
- Web MIDI for the v2 Launchpad path requires `{ sysex: true }` and is Chrome/Edge-only (no Safari). v2 documentation should call this out.
- Verb naming was inconsistent (mix of `strike_all` snake_case and `preset.save` dot-namespace). Standardized on flat snake_case across all verbs.

### Architectural Refinements
- **Split `IntentDispatcher` (profile-aware) from `PresetController` (buffer-aware).** Preset verbs aren't profile resolutions — keeping them in a separate module makes the v1.1 safety state machine's insertion point obvious.
- **Reserve a `BufferTransform` middleware slot** between intents and the wire buffer. v1 ships an identity transform; v1.1 plugs in the lamp-and-hold safety state machine.
- **Add `universe?: number` to `FixtureInstance` now.** Costs nothing in v1; removes a future schema break when multi-universe arrives.
- **Add `RAVE_ALLOW_DESTRUCTIVE=false` default.** WS handler rejects `strike`, `strike_all`, `reset` unless explicitly enabled. Combined with the bind hardening, v1.1 is safe-by-default.

### Cuts (YAGNI — no conflict with refinements above)
- App-level `ping`/`pong` heartbeat — Bun's `sendPings: true` handles it natively.
- 30 Hz broadcast rate cap — re-add when audio reactivity (v3) creates continuous changes.
- `RAVE_PORT` / `RAVE_PRESETS` env overrides — hardcode `4101` and `./presets.json` for v1; re-add when deployment becomes real.
- Dedicated dynamic "presets" layout page — `PresetList.svelte` is a hand-written component, not layout-driven, in v1.

### Agent-Native Parity (small additions for MCP-readiness)
- Verb catalog (`VERBS`) with Zod schema + description + examples for each verb.
- `describe`, `get_state`, `get_presets`, `get_rig` read verbs.
- Append-only audit log at `~/.rave/audit.log`.

> The rest of the document below incorporates these refinements inline. Original
> structure preserved; corrections applied to Wire Schemas, Phase 4, Phase 5,
> Phase 6, Risk Analysis, and Future Considerations.

## Overview

Build the first end-to-end slice of a custom lighting control app for a
4-fixture DMX rig (2× Martin MX-4 scanners, 2× Chauvet Legend 5000X moving
heads). v1 is **virtual-only**: a TypeScript daemon (Bun) owns the 512-byte
universe buffer and runs a 40 Hz tick; a Svelte web app subscribes over
WebSocket for a minimal SVG preview and a button palette that fires semantic
intents. No real DMX hardware in v1 — the daemon writes the buffer into a
`NullSink`. Architecture is shaped so v1.1 (real DMX bridge) and v2 (physical
Launchpad Mini) drop in without touching v1 code.

Carried forward from origin: R1–R10 verbatim, all six key decisions, all v1
non-goals. (see origin: docs/brainstorms/2026-06-09-rave-control-app-requirements.md)

## Problem Statement

The user owns the rig and wants to drive it with custom software, with the
Launchpad Mini as the eventual control surface. Today there is nothing — only
the research doc (`dmx-research.md`) and the requirements doc. v1 must produce
a runnable, demonstrable, minimal control app that proves the architecture
without depending on hardware acquisition, lamp safety, or MIDI integration.

## Proposed Solution

A small monorepo with two apps and one shared types package:

```text
rave/
├── package.json                          # bun workspaces root
├── apps/
│   ├── daemon/                           # Bun + TypeScript long-running process
│   │   ├── src/
│   │   │   ├── main.ts                   # bootstrap
│   │   │   ├── config.ts                 # env + CLI flags
│   │   │   ├── buffer.ts                 # 512-byte universe + change tracker
│   │   │   ├── tick.ts                   # 40 Hz tick loop
│   │   │   ├── sinks/
│   │   │   │   ├── sink.ts               # Sink interface
│   │   │   │   └── null-sink.ts          # the only v1 implementation
│   │   │   ├── profile-loader.ts         # loads profiles from JSON
│   │   │   ├── rig-loader.ts             # loads rig.json + validates
│   │   │   ├── intents.ts                # semantic verbs (R5)
│   │   │   ├── presets.ts                # save/recall/delete + JSON persistence
│   │   │   └── ws-server.ts              # WebSocket protocol handler
│   │   └── package.json
│   └── web/                              # Vite + Svelte 5 single-page app
│       ├── src/
│       │   ├── main.ts
│       │   ├── App.svelte
│       │   ├── lib/
│       │   │   ├── ws-client.ts          # auto-reconnecting client
│       │   │   ├── stores.ts             # buffer, presets, rig stores
│       │   │   └── components/
│       │   │       ├── RigPreview.svelte # SVG (R6)
│       │   │       ├── Palette.svelte    # layout-driven (R7, R9)
│       │   │       ├── PresetList.svelte # (R8)
│       │   │       └── ErrorToast.svelte
│       │   └── layouts/
│       │       └── default-v1.json       # control-surface layout (R9)
│       └── vite.config.ts
├── packages/
│   └── shared/                           # types used by both apps
│       └── src/
│           ├── profile.ts
│           ├── rig.ts
│           ├── intents.ts
│           ├── messages.ts               # WebSocket wire types
│           ├── layout.ts
│           └── presets.ts
├── profiles/
│   ├── martin-mx-4.json                  # 7-channel personality
│   └── chauvet-legend-5000x.json         # 15-channel personality
├── config/
│   └── rig.example.json                  # 4 fixtures per dmx-research §7
└── docs/
```

## Technical Approach

### Architecture

```text
┌─────────────────────────── Bun daemon ─────────────────────────┐
│                                                                │
│  rig.json + profiles/  ──► ProfileLoader + RigLoader           │
│                                  │                             │
│                                  ▼                             │
│                          ┌──── Rig ──────┐                     │
│                          │  Fixture refs │                     │
│                          └───────────────┘                     │
│                                  │                             │
│  WebSocket  ──►  Zod parse ──►  ┌──────────────────────┐       │
│  clients                        │ IntentDispatcher     │       │
│  (browser                       │ (profile-aware verbs)│──┐    │
│   tabs +                        └──────────────────────┘  │    │
│   MCP)                          ┌──────────────────────┐  │    │
│                                 │ PresetController     │  │    │
│  presets.json ◄──► Presets ◄────│ (buffer-aware verbs) │──┤    │
│                                 └──────────────────────┘  │    │
│                                                           ▼    │
│                                            ┌──────────────────┐│
│                                            │ Intent buffer    ││
│                                            │ (operator intent)││
│                                            └──────────────────┘│
│                                                       │        │
│                              ┌──── BufferTransform ───┘        │
│                              │ (v1: identity; v1.1: lamp-      │
│                              │  and-hold safety state machine) │
│                              ▼                                 │
│                       ┌──────────────────┐                     │
│                       │ Wire buffer 512B │  (multi-universe-   │
│                       │ universe → bytes │   ready container)  │
│                       └──────────────────┘                     │
│                             │                                  │
│           40 Hz tick ───────┤                                  │
│                             ▼                                  │
│                       ┌────────┐                               │
│  ◄── state push       │  Sink  │                               │
│  ◄── presets push     │ (Null) │                               │
│  ◄── ack / error      └────────┘                               │
└────────────────────────────────────────────────────────────────┘
                              ▲ WebSocket (loopback)
                              │
┌─────────────────────── Svelte web app ─────────────────────────┐
│  ws-client ──► stores  ──► RigPreview (SVG)                    │
│                       \─── Palette (layout-driven)             │
│                       \─── PresetList                          │
└────────────────────────────────────────────────────────────────┘
```

### Stack Decisions (Resolves the Three Deferred Questions)

#### 1. Daemon runtime: **TypeScript on Bun**

**Why:**
- Single language across daemon and web app. The same `shared/src/intents.ts`
  defines both the verb the daemon dispatches and the message the web client
  emits — a typo can't drift between layers.
- Bun ships a built-in WebSocket server (`Bun.serve({ websocket })`), native
  TypeScript execution (no build step in dev), file watcher (`--watch`), and
  ~50 ms cold start. What would be Express + ts-node + nodemon + `ws` in
  classic Node becomes one binary, one config.
- v1.1's DMX sink is a single file. Solid Node libraries exist for every
  bridge in `dmx-research.md` §4: `enttec-usb-dmx-pro` (Pro), `dmxnet`
  (Art-Net), `ola` (OLA client). Bun's Node-compat works for all three.
- v2's Launchpad Mini integration goes through the **browser's Web MIDI API**
  rather than a server-side MIDI library. The Launchpad becomes another
  WebSocket client (a browser tab or headless page) — no server-side MIDI
  dependency, same TypeScript code.

**Trade-off vs Python (the option the research doc recommended):**
Python's DMX ecosystem (`DMXEnttecPro`, `pyOLA`, `sACN`) is more battle-tested
than Node's. The trade-off lands on TS because v1 needs zero DMX libraries
(NullSink), v1.1 needs exactly one well-maintained Node library, and the
single-language win compounds across daemon + web + Launchpad + future audio.

**Trade-off vs Go:** Go would give a single static binary, but the user's
deployment is "run on my laptop" — binary size doesn't matter, iteration
speed does. Go also forces a TS/JS web app anyway, defeating the single-
language story.

#### 2. Web framework: **Svelte 5 + Vite**

**Why:**
- Buffer-as-store maps 1:1 to Svelte's reactivity model. A `Uint8Array`
  delivered by WebSocket is exposed as a `$state` rune; every SVG attribute
  derives from it via `$derived`. No virtual DOM, no manual `useEffect`
  bookkeeping.
- SVG bindings are first-class in Svelte — no JSX awkwardness around
  `viewBox`, `transform`, etc.
- Bundle is ~10 KB minified for a v1-sized app. Matches "very minimally."
- Vite gives <100 ms HMR; "edit `.svelte` file → see in browser" is the
  inner loop.

**Trade-off vs React:** Better docs, larger community, more AI assistance —
but for a 4-fixture SVG + button-grid app, the boilerplate and bundle cost
outweigh those wins.

#### 3. Profile schema: **Custom-minimal, OFL-friendly field naming**

**Why:**
- v1's semantic intent layer needs only: channels list, channel type tags,
  value range buckets with labels. A custom schema fits in ~80 lines of
  TypeScript types.
- Adopting full Open Fixture Library (OFL) schema would force modeling
  matrix templates, RDM metadata, physical specs, and 30+ capability
  variants — none of which v1's intent layer touches.
- Custom schema uses OFL-aligned field names (`channels`, `capabilities`,
  `dmxRange`, `type`, `modes`) so a one-way OFL → rave converter can be
  written later in <100 LOC if community profile import becomes valuable.
- Both v1 fixtures convert directly from `dmx-research.md` §2 and §3 channel
  tables — no judgment calls.

### Wire Schemas

These are the contracts that make the layers replaceable. They live in
`packages/shared/src/`.

#### Fixture profile (`packages/shared/src/profile.ts`)

```ts
export type Profile = {
  schema: "rave.profile/v1"
  manufacturer: string
  model: string
  modes: Record<string, Mode>     // keyed by mode name, e.g. "7-channel"
}

export type Mode = {
  channels: ChannelDef[]
}

export type ChannelType =
  | "ShutterStrobe" | "Dimmer" | "ColorWheel" | "ColorCMY"
  | "Gobo" | "ColorMacro" | "Pan" | "Tilt" | "PanFine" | "TiltFine"
  | "Beam" | "Zoom" | "Control" | "Lamp" | "Speed" | "Other"

export type ChannelDef = {
  name: string                   // human label, e.g. "Color Wheel"
  type: ChannelType
  capabilities: Capability[]
}

export type Capability = {
  dmxRange: [number, number]     // inclusive 0..255
  label: string                  // "Red 304", "Strobe fast→slow", etc.
  colorHex?: string              // for color buckets
  gobo?: string                  // for gobo enums
  effect?: string                // for strobe modes / macros
}
```

#### Rig config (`packages/shared/src/rig.ts`)

```ts
export type RigConfig = {
  schema: "rave.rig/v1"
  universe: number               // v1 = 1
  fixtures: FixtureInstance[]
}

export type FixtureInstance = {
  id: string                     // "mx4-1"
  profile: string                // "martin-mx-4"
  mode: string                   // "7-channel"
  universe?: number              // defaults to RigConfig.universe; reserved for multi-universe v2
  start: number                  // 1-based DMX address
  position: { x: number; y: number; z?: number }  // meters; z unused in v1 top-down preview
  facing?: { panDeg: number; tiltDeg: number }    // initial preview orientation
}
```

#### Intent / WebSocket envelope (`packages/shared/src/messages.ts`)

Verbs are a **discriminated union** (the original `Verb` enum + `VerbArgs` bag has
been replaced — that shape forced `args: any` and prevented exhaustive switch
narrowing). Buffers are sent as **base64-encoded binary**, consistent with how
presets are stored.

```ts
import { z } from "zod"

// Shared scalar helpers
export const FixtureIdSchema = z.string().min(1).max(64)
export const ColorSpecSchema = z.union([
  z.object({ kind: z.literal("named"), name: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("rgb"),   hex:  z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
])
export const PresetNameSchema = z.string().min(1).max(64)
  .regex(/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u)
  .transform((s) => s.normalize("NFC").trim())

// Intent: one discriminated union, no separate VerbArgs bag.
export const IntentSchema = z.discriminatedUnion("verb", [
  // Buffer-mutating verbs (handled by IntentDispatcher)
  z.object({ verb: z.literal("color"),     fixture: FixtureIdSchema, spec: ColorSpecSchema }),
  z.object({ verb: z.literal("gobo"),      fixture: FixtureIdSchema, name: z.string().min(1).max(64) }),
  z.object({ verb: z.literal("strike"),    fixture: FixtureIdSchema }),
  z.object({ verb: z.literal("strike_all") }),
  z.object({ verb: z.literal("blackout") }),
  z.object({ verb: z.literal("home"),      fixture: FixtureIdSchema }),
  z.object({ verb: z.literal("home_all") }),
  z.object({ verb: z.literal("reset"),     fixture: FixtureIdSchema }),
  z.object({ verb: z.literal("panic") }),

  // Preset verbs (handled by PresetController; separate dispatcher from above)
  z.object({ verb: z.literal("preset_save"),   name: PresetNameSchema }),
  z.object({ verb: z.literal("preset_recall"), name: PresetNameSchema }),
  z.object({ verb: z.literal("preset_delete"), name: PresetNameSchema }),

  // Read verbs (agent-native parity; no buffer mutation)
  z.object({ verb: z.literal("describe") }),
  z.object({ verb: z.literal("get_state") }),
  z.object({ verb: z.literal("get_presets") }),
  z.object({ verb: z.literal("get_rig") }),
])
export type Intent = z.infer<typeof IntentSchema>

// PresetEntry — now defined (was referenced-but-missing in the original draft).
export const PresetEntrySchema = z.object({
  name: PresetNameSchema,
  buffer: z.string(),                          // base64-encoded 512 bytes
  capturedAt: z.string().datetime(),           // ISO 8601 UTC, display-only
  capturingTick: z.number().int().nonnegative(),
})
export type PresetEntry = z.infer<typeof PresetEntrySchema>

// Wire envelope
export type ClientMsg =
  | { type: "intent"; id: string; intent: Intent }

export type ServerMsg =
  | { type: "hello"; schema: "rave.wire/v1";
      rig: RigConfig; profiles: Record<string, Profile>;
      layout: ControlSurfaceLayout;            // exposes the layout to agents
      presets: PresetEntry[];
      buffer: string;                          // base64-encoded 512 bytes
      tick: number }
  | { type: "state"; buffer: string; tick: number }       // base64 over text frame; OR a binary frame (preferred)
  | { type: "presets"; presets: PresetEntry[]; causedBy: string | null }  // intent id that caused the change
  | { type: "ack"; id: string }
  | { type: "error"; id: string | null; code: ErrorCode; message: string }
  | { type: "describe"; verbs: VerbDef[]; rig: RigConfig; profiles: Record<string, Profile>; layout: ControlSurfaceLayout; presets: PresetEntry[] }

export type VerbDef = {
  verb: Intent["verb"]
  description: string                          // for MCP / discoverability
  argsSchema: unknown                          // serialized Zod schema (z.toJSONSchema)
  examples: unknown[]
}

export type ErrorCode =
  | "unknown_fixture" | "unknown_value" | "unsupported_verb"
  | "malformed" | "duplicate_name" | "preset_not_found"
  | "rig_load_failed" | "profile_load_failed"
  | "destructive_disabled"                     // v1.1 safety gate
  | "internal_error" | "io_error"              // catch-all + persistence failures
```

**Binary state frames (preferred for performance):** the `state` message is the
hot path. Bun's `ws.sendBinary(uint8Array)` ships the 512-byte buffer in 512
bytes flat with zero JSON cost. The text-frame form (base64 string) is provided
as a fallback. The web client decodes via `new Uint8Array(event.data)` when the
WebSocket `binaryType === "arraybuffer"`. Use a single byte (`0x00`) prefix on
binary frames to distinguish from a future framed protocol.

**Bun.serve configuration (Phase 4):**

```ts
Bun.serve({
  hostname: "127.0.0.1",                       // NEVER 0.0.0.0 — single most important hardening
  port: 4101,
  fetch(req, server) {
    // Origin allow-list — block cross-origin WS hijacking from arbitrary web pages
    const origin = req.headers.get("origin") ?? ""
    if (!/^https?:\/\/(localhost|127\.0\.0\.1):(5173|4101)$/.test(origin)) {
      return new Response("origin not allowed", { status: 403 })
    }
    if (server.upgrade(req, { data: { id: crypto.randomUUID(), bootstrapped: false } })) return
    return new Response("rave daemon", { status: 200 })
  },
  websocket: {
    maxPayloadLength: 64 * 1024,                // cap inbound; default 16 MB is a DoS surface
    idleTimeout: 30,                            // seconds
    sendPings: true,                            // Bun handles ping/pong frames — drop app-level heartbeat
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    open(ws) { ws.subscribe("rave:state"); ws.subscribe("rave:presets"); /* send hello */ },
    message(ws, msg) { /* parse via IntentSchema.safeParse; dispatch; ack or error */ },
    drain(ws) { /* set lagging flag; resume on next clean send */ },
  },
})
```

**Connect/ready state machine (client):**
Client tracks state as a Symbol-keyed union: `CONNECTING → AWAITING_HELLO →
READY → RECONNECTING → DEAD`. UI controls are `disabled={state !== READY}` via
`$derived`. Intents fired during pre-ready windows surface a "not connected"
toast — they are **not queued**.

**Hello timeout:** on socket open, arm `setTimeout(3000, () => ws.close(4000,
'no-hello'))`. Cleared by the `hello` handler. Prevents zombie sockets where
TCP is open but the daemon never replied.

**Reconnect (client):** linear 1 s retry with ±250 ms jitter is sufficient for
single-user loopback — the original exponential ladder is overkill. Every
async continuation checks a `reconnectGen` token so stale timers can't open a
second socket. Auto-pause on `visibilitychange: hidden`; re-arm on `visible`.

**Heartbeat / liveness:** Bun's `sendPings: true` handles low-level pings.
Client uses a sliding deadline (`bumpLiveness` on every message; close with
code 4001 if no message for 5 s). No app-level `ping`/`pong` needed.

**Multi-tab contract:** Each tab is an independent WS. Intents processed in
arrival order (last-write-wins on buffer state). `presets` broadcasts include
`causedBy: <intent-id>` so a tab can correlate "the broadcast that displaced
my just-saved preset was caused by another session" and surface a clear
toast rather than silent disappearance.

**Startup buffer:** `new Uint8Array(512)` — all zeros. This is "shutter
closed, lamp standby, motors at zero (not neutral)" per the channel maps.
Home is not applied automatically; the user must press it.

**Error envelope:** every failed intent gets `{ type: "error", id, code,
message }`. Malformed JSON or unknown verb gets `{ id: null, ... }`. The
web app maintains a **pending-intents map at app scope** (not per-component);
errors render in a single `aria-live="polite"` region so they survive component
unmount during a route or page switch. Pending entries are garbage-collected
on ack or after a 10 s timeout.

**Destructive-verb gate (v1.1 prep):** the daemon reads
`process.env.RAVE_ALLOW_DESTRUCTIVE` once at startup. When `false` (default),
the WS handler rejects `strike`, `strike_all`, and `reset` with
`{ code: "destructive_disabled" }`. The v1.1 hardware-bringup checklist
enables it — and only after the lamp-safety state machine exists. v1 ships
the gate even though NullSink makes the verbs harmless; this guarantees
v1.1 is safe-by-default.

### Sink interface (`apps/daemon/src/sinks/sink.ts`)

```ts
export interface Sink {
  send(universe: number, buffer: Uint8Array): void
  close?(): void | Promise<void>
}

export class NullSink implements Sink {
  send(_universe: number, _buffer: Uint8Array): void { /* noop */ }
}
```

v1 ships only `NullSink`. v1.1 adds `EnttecProSink` / `ArtNetSink` / `OLASink`
in the same directory; the daemon picks one via env (`RAVE_SINK=null|artnet|
enttec`). No changes elsewhere.

### Control-surface layout (`apps/web/src/layouts/default-v1.json`)

```ts
export type ControlSurfaceLayout = {
  schema: "rave.layout/v1"
  pages: LayoutPage[]
}

export type LayoutPage = {
  name: string                   // "main", "presets", etc.
  grid: { rows: number; cols: number }
  pads: PadDef[]
}

export type PadDef = {
  row: number
  col: number
  label: string
  pressIntent: Intent                          // a complete Intent — no separate args bag
  feedback?: FeedbackSpec                      // optional; executed renderer-side
  style?: Record<string, unknown>              // v2 hook: per-renderer styling (e.g., Launchpad RGB)
  kind?: "grid" | "scene" | "control"          // v2 hook: distinguishes Launchpad grid from scene/launch buttons
}

export type FeedbackSpec =
  | { fn: "constant"; color: string }
  | { fn: "lampState"; fixture: string }
  | { fn: "fixtureColor"; fixture: string }
  | { fn: "presetActive"; name: string }

// Feedback functions execute RENDERER-SIDE (not on the daemon). The renderer
// holds a registry of named functions; the layout JSON only carries names +
// args. This keeps the layout pure data and the daemon ignorant of layout.
```

In v1 the **DOM renderer** in `Palette.svelte` walks `pads[]` and renders each
as a button. In v2 a Launchpad renderer walks the same `pads[]` and sends
MIDI Note On + RGB SysEx for each pad position, calling `feedback.fn` on
state change to drive the LED.

### Implementation Phases

#### Phase 1: Repo skeleton + shared schemas  *(~½ day)*

**Deliverables:**
- `package.json` at root with `workspaces: ["apps/*", "packages/*"]`
- `apps/daemon/package.json`, `apps/web/package.json`, `packages/shared/package.json`
  — each with `"type": "module"` and the workspace-protocol cross-reference
  `"@rave/shared": "workspace:*"`.
- `packages/shared/package.json` exports point at source directly:
  ```json
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }
  ```
  (no `dist/` build step — Bun runs TS natively and Vite resolves source via
  bundler conditions).
- Single root `tsconfig.json` with `"moduleResolution": "bundler"`. **No
  project references in v1** — they add HMR latency without buying anything
  at this scale.
- `.gitignore`, `bun.lockb`
- Zod added to `packages/shared` dependencies.
- All schema files in `packages/shared/src/` populated (profile, rig,
  messages, layout, presets) — Zod schemas + `z.infer` for types. The
  schemas ARE the source of truth for both compile-time types and runtime
  validation.
- `bun install` succeeds, `bun --filter '*' run typecheck` passes with
  `strict: true`.

**Success criteria:** `bun --filter daemon run start` runs a daemon that
prints "rave daemon ready" and exits. `bun --filter web run dev` opens a Vite
dev server with an empty page. `IntentSchema.safeParse({...})` round-trips
in a smoke test.

#### Phase 2: Profile + rig loading + buffer + tick  *(~1 day)*

**Deliverables:**
- `profiles/martin-mx-4.json` — translated from `dmx-research.md` §2 (7-ch mode)
- `profiles/chauvet-legend-5000x.json` — translated from §3 (15-ch mode)
- `config/rig.example.json` — 4 fixtures, addresses per §7 of the research doc
- `apps/daemon/src/profile-loader.ts` — reads profiles dir, validates schema,
  errors with file path on malformed JSON
- `apps/daemon/src/rig-loader.ts` — reads rig.json, resolves profile refs,
  **validates DMX address overlap**, **validates universe over-subscription**,
  fails fast with structured error
- `apps/daemon/src/buffer.ts` — `Uint8Array(512)` + change tracker
  (dirty flag + monotonic tick counter)
- `apps/daemon/src/tick.ts` — `setInterval(25 ms)`; on each tick: read
  current buffer, hand to sink, broadcast if dirty (capped at 30 Hz)
- `apps/daemon/src/sinks/null-sink.ts`

**Success criteria:** Daemon loads profiles + rig, starts tick, calls
NullSink.send 40×/s. Malformed rig (overlap, missing profile, bad start
address) fails with a clear error and non-zero exit code.

**Tests:** Unit test on profile-loader (round-trip valid JSON, reject
malformed). Unit test on rig-loader (overlap detection, oversubscription).
Unit test on buffer (dirty flag flips on write, clears on read-and-broadcast).

#### Phase 3: Semantic intent layer + dispatcher split  *(~1 day)*

**Deliverables:**
- `apps/daemon/src/intent-dispatcher.ts` — handles buffer-mutating verbs
  (`color`, `gobo`, `strike`, `strike_all`, `blackout`, `home`, `home_all`,
  `reset`, `panic`). Profile-aware: looks up the fixture's channels and value
  buckets.
- `apps/daemon/src/preset-controller.ts` — handles persistence verbs
  (`preset_save`, `preset_recall`, `preset_delete`). Buffer-aware only;
  doesn't touch profiles.
- `apps/daemon/src/read-handlers.ts` — handles read verbs (`describe`,
  `get_state`, `get_presets`, `get_rig`); pure functions returning data
  to the client.
- `apps/daemon/src/buffer-transform.ts` — v1 identity middleware between the
  intent buffer and the wire buffer. Reserved slot for v1.1's lamp-and-hold
  safety state machine (ideation survivor #6). In v1, `transform(input) =
  input`.
- `apps/daemon/src/audit-log.ts` — appends one JSON line per dispatched
  intent to `./audit.log` (or `~/.rave/audit.log`); buys post-show debugging
  + multi-client provenance for free.

Each verb resolves its target by looking up the fixture in the rig, finding
the relevant channel(s) in the profile, and writing the right DMX byte(s): Each verb resolves its target by looking
  up the fixture in the rig, finding the relevant channel(s) in the profile,
  and writing the right DMX byte(s):
  - `color(fixtureId, colorSpec)`:
    - MX-4: find ColorWheel channel, look up named gel in capabilities, write
      midpoint of `dmxRange`
    - Legend: if `colorSpec` is a named wheel color → write to ColorWheel
      channel; if a `#rrggbb` string → compute CMY by RGB→CMY inversion
      (`C=255-R, M=255-G, Y=255-B`), write to ColorCMY channels
  - `gobo(fixtureId, name)`: MX-4 only; lookup gobo enum; error on Legend
  - `strike(fixtureId)`: write lamp-on bytes (MX-4: ch1=15; Legend: ch15=70)
  - `strike_all()`: iterate all fixtures
  - `blackout()`: write shutter-closed / dimmer-zero bytes for all fixtures
  - `home(fixtureId)`, `home_all()`: write pan=127, tilt=127 (MX-4); pan=128,
    tilt=128, fine=0,0 (Legend)
  - `reset(fixtureId)`: write reset bytes per profile (MX-4: ch1=245; Legend:
    ch14=224); does **not** apply hold-timing in v1 (NullSink, no real lamps)
  - `panic()`: shutter close only, lamp state untouched

**Success criteria:** Calling `dispatch({ verb: "color", fixture: "mx4-1",
spec: { kind: "named", name: "Red 304" } })` produces a buffer where bytes
at the MX-4 #1 color channel land in the 36–41 range (per `dmx-research.md`
§2). Calling `dispatch({ verb: "strike" })` with `RAVE_ALLOW_DESTRUCTIVE=false`
returns `{ code: "destructive_disabled" }`.

**Tests:** One unit test per verb covering both fixture types. Validates the
byte at the exact channel offset against the channel map. One test confirming
the destructive-verb gate blocks `strike`, `strike_all`, `reset` by default.

#### Phase 4: WebSocket server + protocol  *(~1 day)*

**Deliverables:**
- `apps/daemon/src/ws-server.ts` — `Bun.serve` with the hardened config in
  Wire Schemas (hostname `127.0.0.1`, Origin allow-list, `sendPings: true`,
  `maxPayloadLength: 64 KB`, `closeOnBackpressureLimit: true`).
- Use Bun's **native pub/sub** for broadcasts: `ws.subscribe("rave:state")`
  on open; `server.publish("rave:state", binaryFrame)` on dirty.
- **Binary state frames** via `ws.sendBinary(buffer)` — 512 bytes flat, no
  JSON cost. `hello`/`presets`/`error`/`ack` stay as text frames (JSON).
- Zod-parse every incoming `ClientMsg`. Reject malformed with `{ code:
  "malformed" }` and keep the connection open.
- Hardcoded port `4101`; fail fast on bind error with a clear message.
- No app-level heartbeat ticker — `sendPings: true` handles liveness.
- Graceful error envelope on every failure mode.

**Success criteria:** Open two terminal tabs, run `wscat -c
ws://localhost:4101`, both receive `hello`, both receive `state` after one
sends an intent. Send malformed JSON → receive `{ type: "error", code:
"malformed", ... }` and stay connected.

**Tests:** Integration test using Bun's test runner: start daemon, open WS,
send 5 intents, assert the resulting buffer state.

#### Phase 5: Preset persistence  *(~½ day)*

**Deliverables:**
- `apps/daemon/src/presets.ts` — load on startup, save on every mutation.
  Hardcoded path `./presets.json` in v1 (no env override; re-add when
  deployment becomes real).
- **File envelope is versioned** (was missing in the original plan):
  ```json
  { "schema": "rave.presets/v1", "presets": [...] }
  ```
  On load: if `schema > v1`, refuse to start. v2 migration is then a one-shot
  rewrite, not a guess.
- Cold start: if file missing, create the empty envelope; if unreadable, fail
  fast with a path-prefixed structured error.
- **Promise-queue serialization** (blocking — Bun is single-threaded but
  `await Bun.write` yields, so two saves in the same tick race):
  ```ts
  let mutationQueue: Promise<unknown> = Promise.resolve()
  function mutate<T>(fn: () => Promise<T>): Promise<T> {
    const next = mutationQueue.then(fn, fn)
    mutationQueue = next.catch(() => {})
    return next
  }
  ```
  Wrap every preset save/delete in `mutate()`.
- **Name validation** (blocking — defines the duplicate-name semantics):
  enforced by `PresetNameSchema` in messages.ts. NFC-normalize before compare;
  reject empty, length > 64, or pattern-violating names with `malformed`.
- `preset_save` intent: rejects duplicate name (post-normalization) with
  `duplicate_name`; captures current buffer as base64 + UTC ISO timestamp +
  tick.
- `preset_recall`: looks up by normalized name, overwrites buffer verbatim
  (no semantic re-resolution). Documented v1 limitation: a preset captured
  against an old rig may move "wrong" channels if the rig is re-addressed.
- `preset_delete`: removes from file.
- **Atomic write:** `Bun.write(tmp, json)` → fsync → rename. On startup, sweep
  orphan `*.tmp` files.
- File watch is **not** enabled in v1 (hand edits require restart; documented).

**Success criteria:** Save preset → kill daemon mid-session → restart →
preset is still there. Two concurrent `preset_save` intents → both succeed
serially or one fails cleanly; in-memory list never diverges from disk.
Save with `name: "../foo"` or `name: ""` → rejected with `malformed`.
Save 500 presets → soft cap surfaces `internal_error` (or specific
`preset_limit_reached` if added).

**Tests:** Round-trip preset through disk. Duplicate-name rejection
(case + Unicode normalization). Two `preset_save` in same tick — both
succeed without data loss.

#### Phase 6: Web app — WS client + buffer store  *(~½ day)*

**Deliverables:**
- `apps/web/src/lib/ws-client.ts` — Symbol-keyed state machine (CONNECTING,
  AWAITING_HELLO, READY, RECONNECTING, DEAD); reconnect generation token;
  hello timeout; visibility-aware pause/resume; pending-intents map exposed
  at app scope.
- `apps/web/src/lib/stores.svelte.ts` (note the `.svelte.ts` extension —
  runes are illegal in plain `.ts` files):

  ```ts
  // CRITICAL: $state does NOT proxy Uint8Array — in-place mutation will not
  // trigger reactivity. Use $state.raw and reassign a fresh reference on
  // every WS state message.
  let buffer = $state.raw(new Uint8Array(512))
  export function setBuffer(next: Uint8Array) { buffer = next }
  export function getBuffer() { return buffer }

  // Per-fixture slice derivations subscribe to whole-buffer reassignments.
  // For 4 fixtures × ~10 derived values × ~10 Hz user interaction, cost is
  // negligible. Revisit per-fixture slice stores when v3 audio reactivity
  // makes the buffer change every frame.
  ```
- `apps/web/src/App.svelte` — minimal shell. Renders one of: "Connecting…"
  placeholder (no default-values SVG — would lie about state), the connected
  view (preview + palette + presets), or "Reconnecting…" overlay.
- `vite.config.ts` — proxy `/ws` to `ws://127.0.0.1:4101` so the client URL is
  environment-agnostic; `optimizeDeps: { exclude: ['@rave/shared'] }` to keep
  shared-types HMR clean.

**Success criteria:** Open browser → shows "Connecting…" → receives `hello`
→ shows 4-fixture preview within 500 ms. Click a button before `hello` lands
→ "not connected" toast, no crash, no queued send. Kill daemon → shows
"Reconnecting…" → restart daemon → reconnects without doubled sockets.

**Critical pitfall to enforce in code review:** any handler that writes to
`buffer` MUST construct a new `Uint8Array`. Add an ESLint rule (or unit test)
forbidding `buffer[...] =` and `buffer.set(...)` in client code.

#### Phase 7: Web app — SVG rig preview  *(~1½ days)*

**Deliverables:**
- `apps/web/src/lib/components/RigPreview.svelte`
- Top-down SVG, room at fixed 10 m × 10 m (configurable later)
- Each fixture rendered at its `position.x/z` (top-down: y is "up")
- Per fixture, derive from buffer:
  - Beam vector from current pan/tilt — read the pan and tilt channels
    through the profile, decode 8-bit (MX-4) or 16-bit (Legend) to degrees
  - Beam color — for MX-4, look up the color-wheel byte → capability label →
    `colorHex`; for Legend, compute RGB from CMY bytes via inverse
    (R=255-C, G=255-M, B=255-Y) and fall back to color wheel if active
  - Gobo label (MX-4 only) — look up gobo byte → capability label
  - Opacity — Legend: dimmer / 255; MX-4: 0 if shutter closed, 1 if open,
    pulsing CSS animation if strobe range
  - "LAMP" badge — visible when lamp-on bytes are set

**Success criteria:** Press a color button → preview swatch updates within
one frame. Press Home → both fixtures' beam vectors point straight forward.
Press Blackout → all opacity goes to 0.

#### Phase 8: Web app — layout-driven palette + preset list  *(~1½ days)*

**Deliverables:**
- `apps/web/src/layouts/default-v1.json` — declares the v1 control surface:
  - Page "main": 8 cols × 4 rows
    - Row 0: Strike-all, Blackout, Home, Reset, Panic, (empty), Save preset (opens prompt), (empty)
    - Rows 1–4: one per fixture, with label + color picker pad + gobo picker pad (MX-4 only)
  - Page "presets": dynamically populated from current presets list
- `apps/web/src/lib/components/Palette.svelte` — walks `pads[]` from the
  layout JSON, renders each as a button; on click, sends `pressIntent` over
  WS
- `apps/web/src/lib/components/PresetList.svelte` — lists named presets;
  click to recall, X button to delete, prompt to save current state
- `apps/web/src/lib/components/ErrorToast.svelte` — surfaces error messages
  per failed intent

**Success criteria:** R7 acceptance (master controls + per-fixture color &
gobo) and R8 acceptance (save / recall / delete presets) both pass through
the layout-driven renderer. Layout JSON is the only thing that needs to
change to add a new pad.

#### Phase 9: Integration + polish  *(~½ day)*

**Deliverables:**
- README with run instructions: `bun install`, `bun --filter daemon dev`,
  `bun --filter web dev`, open `http://localhost:5173`
- One screenshot for the README
- `bun --filter '*' run typecheck` and `bun --filter '*' run test` both pass
- Single-command dev: `bun dev` in root spawns both apps (use `bun --filter
  '*' dev --parallel` or a tiny `concurrently`-equivalent)

**Total estimated effort: 7–8 days of solo work** (compresses with iteration
and AI assistance).

## Alternative Approaches Considered

### Python + FastAPI/aiohttp + React

**Why considered:** `dmx-research.md` recommended Python + OLA. Python's DMX
ecosystem is more mature. Audio reactivity is stronger in Python.

**Why rejected:** v1 needs no DMX library; v1.1's bridge needs one (Node has
adequate options); the cost of splitting daemon + web app across two
languages is paid every day of development, not just at v1.1. Single-language
end-to-end with shared types is the bigger compounding win for a solo
developer.

### Browser-only (no daemon)

**Why considered:** Web Serial API + Web MIDI API could drive Enttec USB Pro
and Launchpad Mini directly from the browser tab. Removes the daemon
entirely. Simpler v1.

**Why rejected:** Origin doc R1 explicitly requires the daemon ("browser tab
can crash mid-show and lights keep running"). Survivor #1 was selected
verbatim. The browser-only approach is incompatible with that invariant.

### Go + HTMX

**Why considered:** Single static binary, excellent concurrency, server-side
rendering avoids JS framework choice entirely.

**Why rejected:** Forces a TS/JS web app anyway for the SVG reactive
preview, defeating the single-language story. Static-binary deploy doesn't
matter for "run on my laptop" deployment.

## System-Wide Impact

### Interaction Graph

- **WS client → daemon → buffer → sink:** every UI button click sends a
  WebSocket message, which the daemon's protocol handler routes to
  `applyIntent()`. That writes to the buffer (marks dirty). On the next tick
  (≤25 ms later), if dirty, the daemon (a) calls `NullSink.send(buffer)`,
  (b) broadcasts `state` to all WS clients, (c) clears the dirty flag.
- **Preset save:** WS message → `applyIntent` with `preset.save` verb → reads
  current buffer + name → writes `~/.rave/presets.json` synchronously →
  broadcasts new `presets` list to all WS clients. Filesystem write happens
  on the daemon thread but is small (<10 KB), so blocking is acceptable.
- **Preset recall:** WS message → looks up by name → overwrites the entire
  512-byte buffer with the stored snapshot → marks dirty → next tick
  broadcasts `state`.

### Error & Failure Propagation

- **Profile/rig load failure** (Phase 2): daemon exits with non-zero code
  and prints `[rig-loader] address overlap: mx4-1 (ch 1–7) collides with
  legend-1 (ch 5–19)`. The web app shows "Daemon offline" until the user
  fixes the config and restarts.
- **Intent failure** (unknown fixture, unknown color name, gobo on Legend,
  duplicate preset name): daemon replies with `{ type: "error", id, code,
  message }`. The web app correlates by `id` and shows a transient toast
  next to the offending control. The buffer is untouched.
- **WebSocket parse failure**: replies with `{ type: "error", id: null,
  code: "malformed", ... }`; connection stays open.
- **Preset file write failure** (disk full, permissions): daemon errors the
  intent, keeps in-memory state consistent with disk (re-reads on next
  startup). v1 does not retry — user must resolve and reissue.
- **Sink errors**: NullSink can't fail. v1.1 wraps sink calls in try/catch
  and logs (the tick still runs).

### State Lifecycle Risks

- **Partial preset save (process killed mid-write):** `presets.ts` writes
  to `~/.rave/presets.json.tmp` then atomically renames to
  `~/.rave/presets.json`. No partial-state risk.
- **Buffer divergence between clients:** the daemon is the single source of
  truth. Clients are read-mostly with intent-driven mutations. There is no
  client-side state that the server doesn't know about.
- **Preset captured against a now-changed rig:** preset stores 512 raw
  bytes; recall applies them verbatim regardless of current rig config. If
  the user re-addresses a fixture, the preset may move the "wrong" channels
  on the new fixture. Documented as a known v1 limitation; v2 adds semantic
  preset storage.

### API Surface Parity

- The **layout schema** in R9 is the single API surface for control. v1
  ships one renderer (DOM). v2's Launchpad renderer must consume the same
  schema. The schema is versioned (`schema: "rave.layout/v1"`) so the
  Launchpad renderer can negotiate version.
- The **sink interface** is the single API surface for output. v1 ships
  one implementation (Null). v1.1's bridges (Enttec/Art-Net/OLA) plug in
  without changes upstream.
- The **profile schema** is the single API surface for fixture knowledge.
  Adding a new fixture model = adding a JSON file. No code change.

### Integration Test Scenarios

These are cross-layer scenarios unit tests with mocks would miss:

1. **Cold start, no presets file** → daemon creates empty file, starts
   normally, web app connects and shows zero presets.
2. **Daemon restart during browser session** → client reconnects, `hello`
   resyncs state including any presets created in a different tab while
   the daemon was off (there can't be any — daemon was off — but verifies
   the resync code path).
3. **Two browser tabs, racing color buttons** → both end up showing the
   same buffer state (last-write-wins on the daemon).
4. **Save preset, hand-edit `presets.json` to mangle JSON, restart daemon**
   → daemon fails fast with a clear error; web app shows "Daemon offline";
   user fixes file and restarts → recovery is clean.
5. **rig.json has an address overlap** → daemon refuses to start;
   non-zero exit; clear error message naming both fixtures.

## Acceptance Criteria

### Functional (mapped to origin requirements)

- [ ] **AC-R1** Daemon process holds a single 512-byte universe buffer + 40 Hz
  tick. Closing the browser tab does not affect the daemon's state.
- [ ] **AC-R2** Daemon writes to a `Sink` interface; v1 ships only `NullSink`.
  Adding `ArtNetSink` later requires only a new file in `apps/daemon/src/sinks/`
  and a config env var.
- [ ] **AC-R3** Both fixture profiles ship as JSON in `profiles/`. Adding a
  third profile = adding a JSON file, with no daemon code change.
- [ ] **AC-R4** Single `rig.json` lists 4 fixtures with positions. Daemon
  validates address overlap and over-subscription on load.
- [ ] **AC-R5** Daemon exposes 11 verbs (color, gobo, strike, strike_all,
  blackout, home, home_all, reset, panic, preset.save/recall/delete). Verbs
  read profile lookup tables; web app never writes raw bytes.
- [ ] **AC-R6** SVG top-down preview renders all 4 fixtures with live beam
  vector, color, gobo label, opacity, lamp badge, all derived from the buffer.
- [ ] **AC-R7** Palette renders 5 master buttons (Strike, Blackout, Home,
  Reset, Panic) + per-fixture color picker + per-MX-4 gobo picker.
- [ ] **AC-R8** Save / recall / delete preset; survives daemon restart.
- [ ] **AC-R9** Palette is rendered from `layouts/default-v1.json`; the
  layout schema is documented and versioned.
- [ ] **AC-R10** `bun install && bun dev` starts both apps; opening
  `http://localhost:5173` shows the connected preview within 2 seconds.

### Non-Functional

- [ ] State-push round trip (button click → preview update) ≤ 50 ms on
  loopback.
- [ ] Daemon cold start ≤ 500 ms.
- [ ] Web app initial bundle ≤ 50 KB gzipped.
- [ ] All TypeScript: `bun --filter '*' run typecheck` passes with strict
  mode on.

### Quality Gates

- [ ] Unit tests on profile-loader, rig-loader, buffer, intents, presets.
- [ ] One integration test that boots the daemon, opens a WS, sends an
  intent, and asserts the buffer state.
- [ ] Manual test plan exercises every gap from the SpecFlow analysis
  (cold-start no file, overlap rejection, multi-tab, daemon restart,
  malformed intent).

## Success Metrics

Carried verbatim from origin (see origin: docs/brainstorms/2026-06-09-rave-control-app-requirements.md#success-criteria):

- v1 demonstrable end-to-end without DMX hardware.
- Adding a 3rd fixture model = JSON file + rig entry, zero code.
- Preview matches button presses within one tick (~25 ms).
- v1.1 work reduces to one new Sink implementation.
- v2 Launchpad work reduces to one new layout renderer.

## Dependencies & Prerequisites

- **Bun ≥ 1.1** installed locally
- Modern browser with WebSocket support (any browser from the last 5 years)
- Filesystem write access to `~/.rave/` (or configurable alt path)
- No DMX hardware required
- No network access required (all loopback)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Bun WebSocket API changes between minor versions | Low | Low | Pin Bun version in `package.json` `engines` field |
| Profile JSON drift from research-doc channel tables | Medium | Medium | Generate profiles by hand from `dmx-research.md`; unit-test selected verb→byte mappings against the channel tables |
| Layout schema needs breaking changes for the Launchpad renderer | Medium | Medium | Version field (`rave.layout/v1`) from day one; layout JSON is hand-edited, easy to migrate |
| Svelte 5 runes still relatively new — bugs or doc gaps | Low | Low | Svelte 5 stable since 2024; fallback path is Svelte 4 stores (one-day port) |
| OFL convergence later forces schema change | Low | Medium | OFL-friendly field names from day one; one-way OFL → rave converter can be written if needed |
| Single developer iteration speed | Medium | Low | Phases sized at ½–1½ days; each phase produces a runnable artifact |

## Future Considerations (Trajectory After v1)

### v1.1 — Real DMX output
1. Pick the bridge (Enttec USB Pro recommended per `dmx-research.md` §4).
2. Implement `apps/daemon/src/sinks/enttec-pro-sink.ts` using
   `enttec-usb-dmx-pro` npm package (or `bun:ffi` to libftdi if Node compat
   wobbles).
3. Implement the **lamp-and-hold safety state machine** (ideation survivor
   #6) between intents and the wire — strike stagger, 3 s / 5 s holds,
   lamp-off interlock for MX-4, hot-restart cooldown for both fixtures.
4. Add an env-switchable sink selection.
5. Verify physically against the rig with a smoke test.

### v2 — Launchpad Mini integration
1. Build a second renderer for `layouts/default-v1.json` (or a successor
   layout) in a small headless browser page using the Web MIDI API.
2. Map pad row/col to MIDI Note numbers per the Launchpad Mini MK3 SysEx
   protocol.
3. Implement `feedback.fn` library — `lampState`, `fixtureColor`, etc. —
   that maps daemon state to RGB pad colors via SysEx.
4. The Launchpad page is just another WS client of the daemon — same
   intent surface as the DOM web app.

### v3+ — Effects, audio reactivity, cues
1. **Ramp engine** (ideation candidate, deferred) — time-first signal
   primitive on top of the 40 Hz tick.
2. **Cue/scene compositor** with HTP/LTP blend modes for layered effects.
3. **Audio reactivity** — Web Audio API in the browser, FFT bins shipped
   over WS to the daemon.
4. **MIDI clock sync** for beat-locked chases.

### Architectural escape hatches
- The daemon can scale to multiple universes by extending `Sink.send` and
  the buffer/intent layers; v1's single-universe assumption is a one-line
  config, not an architectural commitment.
- Persistence can move to SQLite if presets cross ~10,000 entries; the
  presets module is the only file that touches storage.

## Documentation Plan

- `README.md` — quickstart (install, run, open in browser), screenshot,
  architecture diagram
- `docs/architecture.md` — flow diagrams + the wire schemas (linked from
  README)
- Per-package READMEs only if useful (probably skip for v1)
- Inline JSDoc on the public surface of `intents.ts`, `presets.ts`,
  `Sink` interface, layout schema

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-06-09-rave-control-app-requirements.md](../brainstorms/2026-06-09-rave-control-app-requirements.md)
  Key decisions carried forward:
  1. Virtual-only v1 (NullSink, no hardware)
  2. Daemon-not-browser-only architecture (R1)
  3. Click → set + named presets (no chases)
  4. JSON file persistence
  5. DOM-only renderer for the layout schema in v1
  6. Master controls + per-fixture color/gobo only

### Internal References

- `dmx-research.md` §2 (Martin MX-4 channel map)
- `dmx-research.md` §3 (Chauvet Legend 5000X channel map + 16-bit pan/tilt math)
- `dmx-research.md` §4 (Hardware bridges — referenced for v1.1 only)
- `dmx-research.md` §6 (Software architecture sketch — v1 plan refines this)
- `dmx-research.md` §7 (Addressing plan — used for `config/rig.example.json`)
- `docs/ideation/2026-06-09-rave-control-app-ideation.md` (Survivors #1–5,
  marked Explored; #6–7 unexplored, slated for v1.1 / v2)

### External References

- Bun WebSocket API — <https://bun.sh/docs/api/websockets> (pub/sub, `sendPings`, `maxPayloadLength`, backpressure)
- Bun workspaces — <https://bun.sh/docs/install/workspaces>
- Svelte 5 `$state` and `$state.raw` — <https://svelte.dev/docs/svelte/$state> (critical: typed arrays not proxied)
- Svelte runes overview — <https://svelte.dev/docs/svelte/what-are-runes>
- Vite — <https://vite.dev/>
- `@sveltejs/vite-plugin-svelte` — <https://github.com/sveltejs/vite-plugin-svelte>
- Zod — <https://zod.dev/> (discriminated unions are first-class)
- USITT DMX512 standard — referenced via `dmx-research.md`
- Open Fixture Library schema — <https://open-fixture-library.org/> (field naming reference only; MX-4 and Legend 5000X are NOT in OFL as of June 2026)
- Web MIDI API — <https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API> (v2 Launchpad path; Chrome/Edge only, requires SysEx permission)
- Web Serial API — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API> (potential v1.1 browser-driven Enttec; Chrome/Edge)

### Pre-Planning Gap Resolution

The SpecFlow Analyzer flagged 21 gaps in the requirements doc before this
plan was written. Each is resolved by a specific section above:

| SpecFlow gap | Resolved in |
|-------------|-------------|
| Cold-start with missing presets file | Phase 5 |
| Malformed rig.json behavior | Phase 2 + Sink section |
| WebSocket port in use | Phase 4 |
| First-connect snapshot contract | Wire Schemas (hello message) |
| Multi-tab semantics | Wire Schemas (multi-tab contract) |
| Daemon restart / client reconnect | Wire Schemas (reconnect contract) |
| Intent error envelope | Wire Schemas (ServerMsg error variant) |
| Duplicate preset name | Phase 5 |
| Preset recall after rig change | System-Wide Impact (State Lifecycle Risks) |
| Hand-edit of presets.json | Phase 5 (file watch disabled) |
| DMX address overlap detection | Phase 2 |
| Over-subscription check | Phase 2 |
| Hot-reload vs restart | Documented as restart-only |
| Startup buffer state | Wire Schemas |
| Preview before first snapshot | Phase 6 ("Connecting…" placeholder) |
| Broadcast rate cap | Wire Schemas (≤30 Hz) |
| Intent protocol wire schema | Wire Schemas |
