---
date: 2026-06-09
topic: rave-control-app
focus: minimal web app with rig preview and basic functions; Launchpad Mini end-state; maintain compatibility
---

# Ideation: Rave Lighting Control App (web + Launchpad-ready)

## Codebase Context

**Repo state:** Brand-new `rave` repo. Only files: a near-empty `README.md` and
`dmx-research.md` (439 lines of research compiled in the prior session). Zero
code yet.

**Hardware:**
- 2× **Martin MX-4** mirror scanners — 6 or 7 DMX channels each. 15 colors + 19
  gobos on snap-position wheels. 150 W discharge lamp with 5-second strike
  stagger and a ch2/ch3 > 252 + 5 s hold interlock on lamp-off.
- 2× **Chauvet Legend 5000X** moving heads — 13 or 15 DMX channels (8-bit vs
  16-bit pan/tilt personality). HMI-575 lamp with 3-second hold commands for
  lamp on/off and reset. CMY mix + color wheel + 31 color macros + zoom + frost.
- Both speak **USITT DMX512** over 3-pin XLR, 250 kbps 8N2.

**Existing research (`dmx-research.md`) already proposes:**
- Universe buffer (512-byte source of truth) + 40 Hz pump
- Fixture abstraction over the channel maps
- Recommended bridge: Enttec USB Pro
- Recommended stack: OLA + Python (alternatives: Node, Go, Rust)
- Operational gotchas baked into the manual (lamp interlocks, hold timings,
  strike stagger, hot restart cooldown)

**User signals from focus hint:**
- "web app" — browser-rendered UI is a v1 requirement
- "preview of the current lighting setup" — visual model of the 4-fixture rig
- "basic functions" — small command palette, not a full lighting console
- "very minimally" — keep complexity low; SVG over WebGL
- "Launchpad Mini" — Novation 8×8 RGB pad MIDI grid is the end-state controller
- "maintain compatibility" — interpreted as: portable wire format (DMX/Art-Net),
  swappable hardware bridge, future input surfaces beyond the Launchpad

## Ranked Ideas

### 1. Headless buffer-as-a-service core
**Description:** A tiny daemon owns the 512-byte universe + the 40 Hz DMX tick +
a WebSocket pub/sub surface. The web app, a future Launchpad bridge, MIDI clock,
and audio reactivity are all equal clients mutating the same buffer. Browser tab
can crash mid-show and the lights keep running.
**Rationale:** Load-bearing wall for every other survivor. Makes "preview" and
"control" the same data path by construction — what you see is what's on the wire.
**Downsides:** Slightly more upfront work than stuffing everything in the browser.
**Confidence:** 95%   **Complexity:** Low
**Status:** Explored (2026-06-09)

### 2. Pluggable output backends + virtual rig dev mode
**Description:** One interface `send(universe, buffer)` with implementations:
`NullSink` (preview only), `ArtNetSink`, `OLASink`, `EnttecProSink`. Choose via
env/config. Develop with no XLR cable; flip a flag for the real rig.
**Rationale:** Direct answer to "maintain compatibility." Also solves the
dev-loop problem — no need to strike a 575 W HMI to test a fade curve. Same code
path renders preview and drives the wire.
**Downsides:** Small interface to maintain; easy to overengineer if all sinks
are implemented day one.
**Confidence:** 90%   **Complexity:** Low
**Status:** Explored (2026-06-09)

### 3. Declarative fixture profiles + semantic intent layer
**Description:** Channel maps for MX-4 (6ch/7ch) and Legend (13ch/15ch) live in
JSON profiles with channel slots, value ranges, and named enums (colors, gobos,
macros). On top: `point(fixture, pan_deg, tilt_deg)`, `color(fixture, '#FF0080')`,
`intensity(fixture, 0.7)`, `strike(fixture)`. Adding an LED par later = adding
a JSON file.
**Rationale:** MX-4 has snap-to-position wheels; Legend has true CMY. Hiding
both behind one verb is the only way pads, scenes, and audio reactivity can
share code. Matches QLC+/OFL profile conventions.
**Downsides:** Slightly more abstraction than the absolute minimum.
**Confidence:** 90%   **Complexity:** Low–Medium
**Status:** Explored (2026-06-09)

### 4. Minimal v1 web UI: 2D rig preview + basic-functions palette
**Description:** Top-down + front-elevation SVG of the room. Each fixture is a
glyph with a beam vector showing pan/tilt, color swatch from wheel/CMY, gobo
letter in the beam tip, opacity = dimmer. Below: big labeled buttons — Strike
(staggered), Blackout, Home, Reset, Panic, plus a color picker and gobo dropdown
per fixture.
**Rationale:** Literal deliverable from the prompt. SVG keeps it minimal, reads
the same buffer the wire reads (can't lie), palette codifies dangerous-to-type
commands.
**Downsides:** SVG won't show gobo bloom or HMI color temp realistically. Fine
for v1.
**Confidence:** 95%   **Complexity:** Low
**Status:** Explored (2026-06-09)

### 5. Unified control-surface layout — one spec, two renderers (DOM + Launchpad)
**Description:** Declare the control surface as data: an 8×8 (or paged) JSON
layout of pads, each with a `press_intent`, a `feedback_color(state)` function,
and a label. The web app renders it as `<div>`s; the future Launchpad daemon
renders it as MIDI Note On + RGB SysEx. Pressing in the browser and pressing on
the physical pad fire identical intents; both surfaces show identical state.
**Rationale:** Single most valuable thing to build *before* the Launchpad ships.
Without it, you rewrite half the UI when the device arrives. With it, Launchpad
is a swap-in.
**Downsides:** Requires committing to pad-grid semantics early; mitigated by
layout being data.
**Confidence:** 85%   **Complexity:** Medium
**Status:** Explored (2026-06-09)

### 6. Lamp-and-hold safety state machine
**Description:** Model each fixture's lamp lifecycle (cold → striking → hot →
cooling → off) and every multi-second command as explicit state machines. A
safety pass between the intent buffer and the wire buffer staggers strikes by
5 s, holds 3 s / 5 s commands, enforces interlocks, blocks hot restrikes during
cooldown.
**Rationale:** Discharge-lamp gotchas can trip breakers or kill lamps. Safety
as a buffer filter means no input surface can damage hardware.
**Downsides:** Adds intentional latency to specific commands.
**Confidence:** 85%   **Complexity:** Medium
**Status:** Unexplored

### 7. Snapshot-based cue capture with semantic diffs
**Description:** Jam live, press a pad to capture current universe buffer into
a named cue. Cues store 512 bytes + a human diff ("MX-4 #1 color: Red 304 →
Cyan 104"). Replay with optional crossfade.
**Rationale:** Inverts the "type values into a console" workflow. Diffs make
cue lists self-documenting.
**Downsides:** Crossfade requires a small interpolator.
**Confidence:** 80%   **Complexity:** Low–Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Live universe inspector (standalone byte grid) | Subsumed by #4 preview; works as a side panel |
| 2 | 3D WebGL preview (Three.js room) | Conflicts with "very minimally"; defer past v1 |
| 3 | Webcam preview overlay | Clever reframe but wrong for offline cue design |
| 4 | Pad grid IS the fixture map (Launchpad-as-preview) | Forces Launchpad as primary; user explicitly wants web app preview |
| 5 | Pre-Launchpad virtual MIDI event bus (standalone) | Subsumed by #5 unified layout |
| 6 | Constraint-aware command refusal layer (standalone) | Duplicate of #6 safety state machine |
| 7 | Launchpad-first, web app as config-only | Contradicts the explicit web-app-preview ask |
| 8 | Art-Net as the compatibility contract | Tactical choice for the `plan` phase, not a strategic idea |
| 9 | QLC+ show file compatibility | Pulls scope toward integration, away from "build this" |
| 10 | Ramp engine / time-first signal core | Right idea, premature for "very minimal" v1; fold into #1 tick loop later |
| 11 | Cue/scene compositor (HTP/LTP blend) | Premature; #7 covers basics, blend modes wait |

## Session Log
- 2026-06-09: Initial ideation — 32 raw candidates from 4 framed sub-agents, deduped to ~21, critiqued to 7 survivors. User selected #1–5 for combined brainstorm.
