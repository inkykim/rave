---
date: 2026-06-09
topic: rave-control-app
---

# Rave Lighting Control App — v1 Requirements

## Problem Frame

The user owns a 4-fixture DMX lighting rig (2× Martin MX-4 scanners, 2× Chauvet
Legend 5000X moving heads, documented in `dmx-research.md`). They want custom
software to drive it. The ultimate control surface is a Novation Launchpad Mini,
but the immediate need is a minimal **web app** that:

- visualizes the current state of the rig, and
- exposes a small set of basic functions to manipulate it,

while laying foundations that don't have to be thrown away when the Launchpad,
the real hardware bridge, and richer effects arrive later.

This requirements doc defines **v1**: the smallest end-to-end slice that proves
the architecture and produces something the user can open in a browser and
play with. The real DMX bridge, the physical Launchpad, and time-based effects
all live in later versions.

## Requirements

### R1 — Headless daemon owns the universe

A single long-running process holds the authoritative 512-byte DMX universe
buffer and runs a 40 Hz tick. All clients (the web UI, and later the Launchpad
bridge) connect to it over WebSocket and read/write the buffer through a
documented intent protocol. Closing the browser tab does not affect the
daemon's state.

### R2 — Pluggable output sink interface (NullSink only in v1)

The daemon writes its buffer to a `Sink` interface. v1 ships exactly one
implementation: `NullSink`, which accepts the buffer and does nothing (no
hardware output). The interface is shaped so `ArtNetSink`, `OLASink`, and
`EnttecProSink` can be added later as drop-in implementations without
changes elsewhere.

### R3 — Declarative fixture profiles in JSON

Each fixture model has a versioned JSON profile that describes its DMX channel
layout, value ranges, and named enums (colors, gobos, color macros). v1 ships
profiles for:

- Martin MX-4 (7-channel personality)
- Chauvet Legend 5000X (15-channel / 16-bit pan-tilt personality)

A profile is a data file, not code. Adding a new fixture model later is a
JSON file plus a fixture-instance entry in the rig config — no daemon code
change.

### R4 — Rig configuration as a single file

A `rig.json` (or equivalent) file lists the fixture instances: name, profile
ID, DMX universe + start address, and a position hint (room coordinates for
the preview). The daemon loads this at startup. v1 contains 4 instances
matching the addressing plan in `dmx-research.md` §7.

### R5 — Semantic intent layer

The daemon exposes verbs that hide raw byte values:

- `color(fixture, color_spec)` — for MX-4: a named gel from the 15-color list;
  for Legend: a CSS color string mixed via CMY (and snapped onto the wheel only
  when a wheel color is named explicitly).
- `gobo(fixture, name)` — MX-4 only; one of the 19 named gobos or `"open"`.
- `strike(fixture)` / `strike_all()` — sets lamp-on bytes (simulated in v1).
- `blackout()` — closes all shutters / sets all dimmers to 0.
- `home(fixture)` / `home_all()` — pan/tilt to neutral (127/128 per the channel
  maps).
- `reset(fixture)` — sets reset bytes (simulated in v1).
- `panic()` — closes all shutters but leaves lamp state untouched.

All values come from the fixture profile lookup tables. Verbs are the only way
the web UI mutates the buffer.

### R6 — Minimal 2D SVG rig preview

The web app shows the rig as an SVG diagram (top-down room view in v1). Each
fixture is a glyph at its configured position. The glyph reflects the live
buffer state:

- a beam vector showing current pan/tilt direction
- the beam color (from the wheel or CMY mix)
- the gobo name (text label in the beam tip, MX-4 only)
- opacity proportional to dimmer (Legend) or shutter state (MX-4)
- a small "LAMP" badge when the lamp-on bytes are set

The preview updates at the daemon tick rate (or whatever WebSocket delivers).

### R7 — Basic-functions palette

Below the preview, the web app shows a button palette:

- **Master controls:** Strike (strike all), Blackout, Home (all pan/tilt to
  neutral), Reset (all motors), Panic (all shutters closed).
- **Per-fixture color & gobo:** for each of the 4 fixtures, a control row with
  a color picker (constrained to the fixture's supported colors) and, for the
  MX-4s, a gobo picker.

Per-fixture pan/tilt, intensity, and strobe controls are explicitly out of v1
scope.

### R8 — Named presets, persisted to JSON

The user can:

- click **Save preset**, name it, and capture the current 512-byte buffer
- click a named preset to instantly recall it (no crossfade in v1)
- delete a preset

Presets persist to a single JSON file on disk (e.g., `~/.rave/presets.json` or
a config-defined path). The file is human-readable and hand-editable.

### R9 — Unified control-surface layout (DOM-only in v1)

The button palette and preset list in R7/R8 are declared as a JSON **layout**
data structure. v1 includes exactly one renderer for this layout: the web app
DOM. The layout schema is shaped so a second renderer (the Launchpad Mini, in
a later version) can read the same JSON and render each entry as a MIDI pad
with bidirectional state feedback. v1 does not implement the MIDI renderer.

### R10 — Open the browser, see the rig

The user can:

1. start the daemon from a single command
2. open the web app at a single URL
3. see the preview reflect the (empty/initial) buffer
4. press any button or recall any preset and watch the preview update

No login, no auth, no multi-user, no deployment — local dev workflow only.

## Success Criteria

- The user can demonstrate the v1 end-to-end without a single piece of DMX
  hardware connected.
- Adding a hypothetical 3rd fixture model (e.g., an RGB LED par) requires
  writing a JSON profile + adding a `rig.json` entry — no daemon code change.
- The preview state visibly matches every button press and preset recall
  within one tick (~25 ms).
- When the v1.1 real-rig work begins, "make the real lights move" reduces to
  implementing one new `Sink` and pointing the daemon at it. No changes to
  R1–R10.
- When the Launchpad Mini integration begins, "make the pads work" reduces to
  building a second renderer for the R9 layout. No changes to R1–R10.

## Scope Boundaries

The following are explicitly **out of v1**, deferred to later iterations:

- **Real DMX output** — no Enttec USB Pro, no Art-Net, no OLA. NullSink only.
- **Lamp-safety state machine** — the strike-stagger, 3 s / 5 s holds, and
  lamp-off interlock from `dmx-research.md` §2.4 and §3.3 are not needed when
  nothing is on the wire. They come in v1.1 alongside the real sink.
- **Physical Launchpad Mini** — no MIDI I/O, no SysEx, no pad LEDs. v1 ships
  the layout schema and the DOM renderer only.
- **Crossfades / ramps / chases** — preset recall is instant. No time-based
  effects in v1.
- **Per-fixture pan/tilt, intensity, strobe sliders** — deferred.
- **3D preview, gobo bloom, webcam overlay** — SVG only.
- **Multi-user, auth, deployment, packaging** — local single-user dev only.
- **Audio reactivity, MIDI clock, OSC, DAW sync** — none in v1.
- **Cue stacks, scene layering, HTP/LTP blend** — none in v1.

## Key Decisions

- **Virtual-only v1.** Ship the architecture first, prove it works against
  NullSink + preview, then add the real bridge as v1.1. *Why:* matches the
  "very minimally" framing, removes hardware-acquisition and lamp-safety from
  the critical path, lets the user demo on a plane.
- **Daemon, not browser-only.** The buffer + tick live in a long-running
  process, not in the browser tab. *Why:* matches survivor #1's "browser tab
  can crash mid-show and lights keep running" property; survivor was selected
  as-is.
- **Click → set + named presets (no chases yet).** Static state only in v1.
  *Why:* user-selected verb-set tier; presets cover 80% of "do something
  interesting" without requiring an interpolator.
- **JSON file persistence.** No SQLite. *Why:* 4 fixtures and a handful of
  presets do not justify a schema. Human-readable, git-friendly, trivial
  carrying cost.
- **DOM is the only v1 renderer of the unified layout.** *Why:* the layout-as-
  data abstraction (survivor #5) is valuable even before the Launchpad ships;
  building it for DOM-only first costs almost nothing and prevents the
  late-stage rewrite when MIDI shows up.
- **Master controls only, no per-fixture motion/intensity.** *Why:* explicit
  user choice in the palette question. Keeps the v1 surface honestly minimal.

## Dependencies / Assumptions

- Single-user local development is the deployment story. No remote access
  considered.
- Fixture instances are addressed per the plan in `dmx-research.md` §7. The
  rig config in R4 encodes this; the actual addresses on the physical
  fixtures will be set when real-rig work begins.
- The daemon and the web app run on the same machine; WebSocket is loopback.
- The user has Node.js / Python / Go / whatever the planner chooses already
  installed (runtime is a planning decision).

## Outstanding Questions

### Resolve Before Planning

*(none — all product-level decisions are made)*

### Deferred to Planning

- [Affects R1, R6, R8] [Technical] **Daemon runtime / language** —
  Python (matches `dmx-research.md` recommendation, OLA bindings ready for
  v1.1), TypeScript/Node (single language across daemon and web app, monorepo
  story), or Go (single static binary, simplest deploy). Pick during planning
  based on the user's environment and v1.1 sink plans.
- [Affects R6, R7, R10] [Technical] **Web app framework** — vanilla JS, React,
  Svelte, Vue, or similar. Defer to planning; SVG rendering and WebSocket
  consumption are non-controversial in any.
- [Affects R3] [Needs research] **Profile schema** — adopt or align with
  Open Fixture Library's JSON schema vs. invent a minimal in-house schema.
  Aligning costs more upfront and pays off the day someone wants to import a
  community profile.
- [Affects R9] [Technical, deferred to v2] **Launchpad Mini variant** — Mk2
  (limited colors) vs Mk3 (full RGB SysEx). Affects what `feedback_color(state)`
  can express. v1 doesn't ship the MIDI renderer, so this is genuinely a v2
  question.
- [Affects v1.1 scope] [Needs research] **Which physical sink for v1.1** —
  Enttec USB Pro (research-doc recommendation) vs Art-Net node (network-first)
  vs OLA daemon (abstracts both). Decide when v1 ships.

## Next Steps

→ `/ce:plan` for structured implementation planning.
