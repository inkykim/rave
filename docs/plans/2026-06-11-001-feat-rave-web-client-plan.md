---
title: Rave Web Client (v1 Phases 6–9)
type: feat
status: active
date: 2026-06-11
origin: docs/brainstorms/2026-06-09-rave-control-app-requirements.md
---

# Rave Web Client (v1 Phases 6–9)

## Enhancement Summary

**Deepened on:** 2026-06-12
**Sections enhanced:** Connection State Machine, Wire Schemas (cross-file), Phases 6A–6D, Risk Analysis, References
**Review agents used:** kieran-typescript-reviewer, code-simplicity-reviewer, performance-oracle, security-sentinel, architecture-strategist, pattern-recognition-specialist, data-integrity-guardian, agent-native-reviewer, best-practices-researcher, framework-docs-researcher

### Key Bug Fixes (blocking — found before any code shipped)

1. **Path traversal in static-file handler.** Phase 6D pseudocode does `Bun.file(resolve(DIST_DIR, url.pathname.slice(1)))` — `resolve()` does NOT confine to `DIST_DIR`, so `GET /../../../etc/passwd` resolves to `/etc/passwd` and `file.exists()` returns true. URL-encoded `%2e%2e` also flows through `new URL()` decoded. Fix: `requested.startsWith(distWithSep)` confine check, NUL-byte reject. Without this, v1.1 (real DMX) ships a local-file disclosure bug.
2. **Vite dev server LAN exposure.** Vite v6 defaults vary across configs — must pin `server.host: "127.0.0.1"`. On coffee-shop wifi without this, the proxied `/ws` bypasses the daemon's 127.0.0.1 bind.
3. **`IntentError.code` type collision.** Plan had `code: symbol` but daemon uses `code: string` (and the wire's `ErrorCode` is a string union). One class can't carry both. Resolution: split `IntentError` into a discriminated union of three subclasses (`IntentDisconnectedError`, `IntentNoAckError`, `IntentRejectedError`) where only `Rejected` carries a wire `ErrorCode`. Eliminates the conflicting symbols entirely.
4. **Pending preset recall + delete collision.** Recall references name, not client-side intent id. A recall queued before the optimistic save persists hits a name the daemon doesn't have yet → error. Fix: `pending: true` rows are non-recallable / non-deletable in `PresetList.svelte`. Also: rejected `preset_*` intents must broadcast `causedBy` so optimistic state can roll back — extend daemon wire contract to broadcast on rejection.
5. **Daemon doesn't validate intents** is a misread of the existing code — it DOES (`IntentSchema.safeParse` on every message). Add an explicit assertion so future contributors don't break the symmetry.

### Architectural Refinements (cross-shared)

- **`requiresAck` belongs on `VerbDef` in `@rave/shared`**, not a web-only metadata table. Daemon, MCP wrapper, and future Launchpad daemon all need to agree on which intents are fire-and-forget. Co-locate with `VERB_CATALOG`.
- **`effectiveLayout` in `hello`/`describe`.** The per-fixture rows the Palette generates procedurally are invisible to a `describe`-only agent. Move the expansion into `@rave/shared/src/layout-expand.ts` so daemon + web app + agent all consume the same expanded `Pad[]`. Add `effectiveLayout: ControlSurfaceLayout` to `ServerMsg.hello` and `ServerMsg.describe`.
- **`warnings: { layout_invalid?, rig_degraded? }` on `hello`.** Phase 6D references a flag that doesn't exist in the schema yet. Make it an extensible bag rather than a bare field.
- **`get_audit_tail` read verb.** Browser/MCP clients have no FS access; symmetric read of the daemon's audit log keeps agent debugging on par with `tail -f audit.log`.
- **`FeedbackSpec` registry lives in `@rave/shared`** (not web app). v2 Launchpad daemon won't import `apps/web`; the registry must be importable from both sides.
- **v2 Launchpad correction.** The Launchpad is a **separate Bun process** at `apps/launchpad/` using a Node MIDI library, not a browser tab. Web MIDI in a tab can't survive sleep, can't headlessly autostart, and SysEx permission is a per-user-gesture prompt. The shared *schema* drives both renderers; the components do not.
- **`Symbol`-keyed `STATES` → string union.** Matches the existing `ERROR_CODES` `as const` pattern in `@rave/shared/messages.ts`. `as const` strings give the same exhaustiveness with cleaner DevTools + log-friendly stringification.
- **Tighten `PresetNameSchema` regex.** Current `[\p{L}\p{N}\p{P}\p{Zs}]+` admits `<`, `>`, `&` via Unicode Punctuation — safe today (Svelte auto-escapes) but stored XSS waits for any future `{@html}` slip. Move to `[\p{L}\p{N}\p{Zs}\-_.]+`. Breaking change for `@rave/shared`, but v1 ships with zero existing presets so the migration is free.

### Cuts (YAGNI — no conflict with above)

- **`Symbol`-keyed STATES** → string literal union.
- **Pre-ready `state` queue** → just drop non-hello messages during `AWAITING_HELLO` and log once. Next state broadcast arrives within 25 ms. Removes overflow logic + 1 race test.
- **Wall-clock liveness check** → simple `setInterval(1s)` + close after 5 s silent. The sleep/resume defense can land in v1.1 when the daemon becomes show-critical. Removes ~15 LOC and 1 race test.
- **`PresetModal.svelte`** → `window.prompt`. Single-user dev tool; modal is v1.5+. Removes 1 component (~80 LOC).
- **Side-by-side CMY swatches + subtractive tooltip** → native picker only. The preview *is* the feedback. Removes ~30 LOC.
- **`Header.svelte` and `ErrorRegion.svelte` separate components** → inline in `App.svelte` (connection chip + tick line + `<div role="alert" aria-live="polite">`).
- **Off-viewBox chevron glyph** → clamp position to viewBox edge + `console.warn`. User controls `rig.json`; bad position is a config error.
- **Race tests** → 3, not 5: ghost-socket-on-reconnect, hello+state-ordering, HMR-double-client. (Sleep-resume + disconnect-during-pending dropped along with the patterns they were testing.)

### TypeScript Tightenings (kieran)

- `declare global { var __raveBuffer: BufferStore | undefined }` — typed-once `globalThis` registry, no per-call `as` casts.
- Fast-path `state` frames with a typeguard; Zod-validate only `hello`/`presets`/`ack`/`error`/`describe`/`*_response`. At ~30 Hz the Zod parse cost (~3–5 ms/frame) is wasteful for a known-shape buffer message.
- `Promise` constructor pattern for `sendIntent`: register in `pendingIntents` BEFORE `ws.send` (so a throwing send can still cleanly reject + delete).
- Exhaustive `default: const _: never = msg` arms on the `ServerMsg` switch.
- Tighten `prereadyQueue` type to `Exclude<ServerMsg, { type: "hello" }>[]`.
- Use `ReturnType<typeof setTimeout>` for timer handles (DOM vs Node typing).
- Single self-rescheduling `setTimeout` for liveness; no 1 Hz `setInterval` churn.

### Performance Locks

- **`recentErrors` cap at 50 entries (FIFO)** to prevent unbounded growth during a long debug session.
- **Use `style:transform`** (CSS, compositor path) instead of SVG `transform` attr (layout/paint path) for beam rotation.
- **Acceptance target: ≤ 60 KB gzipped initial JS** (refined from 50 KB after measuring Svelte 5 (~11 KB gz) + Zod (~13 KB gz) + app code).
- **No `requestAnimationFrame` orchestration in components** — let Svelte 5's microtask batching coalesce. Only reach for rAF if profiled paint thrashing.

### Security Headers (daemon Phase 6D additions)

```ts
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:4101 ws://localhost:4101; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-cache",  // index.html only; hashed /assets/* get immutable
}
```

### New Considerations Discovered

- **Bun.serve static-file path safety** is non-trivial; the canonical pattern is `resolve` THEN explicit `startsWith` confine check + NUL reject.
- **`mock-socket` (3 KB dev dep)** is the idiomatic way to test `WSClient` in `bun test` without spinning a real server. Installs `globalThis.WebSocket = MockWebSocket` in a setup file.
- **`${proto}//${location.host}/ws` URL formula** — derive WS URL from `window.location` so dev (5173) and prod (4101) both Just Work without env config.
- **Svelte 5 SVG perf at 30 Hz** is well within budget for 4 fixtures (~1,200 derived recomputes/sec); breakpoint is ~64 fixtures. Use compositor-friendly `style:transform`.
- **`import.meta.hot.dispose` doesn't compose across re-imports** (Vite #603 still open). Pair it with `globalThis` registration — dispose teardown listeners on the old module without closing the live socket; new module finds the existing `globalThis.__raveWS` and re-attaches.

> The rest of the document below incorporates these refinements inline. Original
> structure preserved; targeted edits applied to the Connection State Machine
> section, Phase 6A's TS types, Phase 6D's static handler, the SVG Geometry
> notes, and the Risk Analysis.

## Overview

Build the browser half of rave v1: a Svelte 5 + Vite single-page app that
connects to the running daemon (already shipped, Phases 1–5) over WebSocket,
mirrors the universe buffer into a `$state.raw` store, renders a top-down
SVG preview of the 4-fixture rig, and drives the daemon via a layout-driven
button palette + preset list.

Carried forward from origin: R6 (SVG preview), R7 (basic-functions palette),
R8 (named presets), R9 (unified control-surface layout), R10 (open-browser-
see-the-rig flow). See origin: docs/brainstorms/2026-06-09-rave-control-app-requirements.md.
Carried forward from the master v1 plan: every decision in
docs/plans/2026-06-10-001-feat-rave-v1-control-app-plan.md (Enhancement
Summary). This document is the deeper, focused plan for the web client.

## Problem Statement

The daemon is live but headless. There is no way to see what's on the wire
or to fire intents without `wscat` and hand-typed JSON. v1 is "done" when
the user can `bun install`, run `bun --filter daemon dev` + `bun --filter
web dev`, open `http://localhost:5173`, see the 4-fixture preview, and
click buttons that move the (virtual) lights.

## Proposed Solution

A small Svelte 5 SPA in `apps/web/`. The web app:
- imports types and Zod schemas from `@rave/shared`
- opens one WebSocket to `ws://127.0.0.1:4101/ws` (Vite dev: proxied via `/ws`)
- maintains an app-scope `wsClient` singleton and `stores` (buffer, rig,
  profiles, layout, presets, connection, recentErrors, pendingIntents) —
  both registered on `globalThis` so Vite HMR doesn't double-instance them
- renders a single page with header, SVG preview, palette, presets, errors

Production: the daemon serves `apps/web/dist/` from `http://localhost:4101/`
(new — needs adding to the daemon's `fetch()` in Phase D).

## Technical Approach

### Architecture

```text
┌─── Browser (Chrome/Safari/Firefox) ────────────────────────────┐
│                                                                │
│  globalThis singletons:                                        │
│  ┌──────────────┐    ┌───────────────────────────────────────┐ │
│  │  wsClient    │◄──►│ stores.svelte.ts                      │ │
│  │  (state      │    │  - connection (state machine)         │ │
│  │   machine,   │    │  - buffer ($state.raw Uint8Array(512))│ │
│  │   pending    │    │  - tick                               │ │
│  │   intents,   │    │  - rig / profiles / layout            │ │
│  │   reconnect) │    │  - presets                            │ │
│  └──────────────┘    │  - recentErrors                       │ │
│         │            └───────────────────────────────────────┘ │
│         │                          │                           │
│         │                          ▼                           │
│         │       App.svelte ──► Header  RigPreview  Palette …  │
│         │                                                      │
│         │       Component reads stores via $derived            │
│         ▼                                                      │
│  WebSocket(127.0.0.1:4101/ws)                                  │
└────────────────────────────────────────────────────────────────┘
         ▲
         │ (Vite dev: proxy /ws → 127.0.0.1:4101)
         │
┌────────┴─── Daemon (already shipped) ──────────────────────────┐
│  hello / state / presets / ack / error / describe / *_response │
│  IntentSchema-validated client messages                        │
│  Origin allow-list (5173, 4101)                                │
└────────────────────────────────────────────────────────────────┘
```

### File Structure

```text
apps/web/
├── package.json                        # vite + svelte + @rave/shared
├── vite.config.ts                      # proxy /ws → 127.0.0.1:4101
├── tsconfig.json
├── index.html                          # single root <div id="app">
├── public/
│   └── favicon.svg
└── src/
    ├── main.ts                         # mounts App.svelte
    ├── app.css                         # dark theme + CSS custom properties
    ├── App.svelte                      # layout shell + connection gating
    ├── layouts/
    │   └── default-v1.json             # already exists (master controls)
    ├── lib/
    │   ├── ws-client.ts                # state machine, reconnect, pending
    │   ├── stores.svelte.ts            # all reactive state (singletons)
    │   ├── decoding.ts                 # pure helpers: panTilt, color, etc.
    │   ├── decoding.test.ts            # bun test on decoders
    │   └── components/
    │       ├── Header.svelte           # connection chip, tick, daemon URL
    │       ├── RigPreview.svelte       # SVG room frame, fixture glyphs
    │       ├── FixtureGlyph.svelte     # one fixture's beam + chrome
    │       ├── Palette.svelte          # layout-driven master + per-fixture
    │       ├── ColorPicker.svelte      # variant by fixture
    │       ├── GoboPicker.svelte       # MX-4 only
    │       ├── PresetList.svelte       # save / recall / delete
    │       ├── ErrorRegion.svelte      # aria-live polite
    │       └── PresetModal.svelte      # inline modal for save name
    └── types.ts                        # ConnectionState, PendingIntent, ...
```

### Stack Decisions

- **Svelte 5 with runes.** Class-based store singletons in `.svelte.ts`.
  `buffer` is `$state.raw(new Uint8Array(512))` and is **reassigned** on
  every `state` message — typed arrays aren't proxy-reactive, so a fresh
  reference is mandatory.
- **Vite + `@sveltejs/vite-plugin-svelte` v4.** Dev server on 5173.
  Production build outputs `apps/web/dist/`.
- **Vanilla CSS with custom properties.** No Tailwind, no preprocessor.
  Dark theme baseline; CSS variables expose `--bg`, `--fg`, `--accent`,
  `--connected`, `--reconnecting`, `--dead`.
- **No router.** Single page, no client-side routing.
- **`bun test`** for unit-testable helpers (`decoding.ts`, `ws-client.ts`
  state-machine tests with a fake WebSocket). No Playwright in v1.

### Connection State Machine (the high-risk component)

The pre-implementation review (Julik) flagged this as the single most
landmine-prone surface. Implementation discipline is documented here so
the implementer doesn't have to re-discover it.

#### States

```ts
// types.ts — mirrors the ERROR_CODES `as const` pattern in @rave/shared
export const CONNECTION_STATES = [
  "connecting",
  "awaiting_hello",
  "ready",
  "reconnecting",
  "dead",
] as const
export type ConnectionState = (typeof CONNECTION_STATES)[number]
```

String literals (not symbols): `as const` gives the same exhaustive
narrowing under `strict`, DevTools shows `"ready"` instead of
`Symbol(READY)`, the state is loggable to JSON and can flow into a
`data-conn-state` attribute for CSS targeting. Matches the codebase
convention used by `ERROR_CODES` in `packages/shared/src/messages.ts`.

#### `reconnectGen` discipline (capture-by-value)

Every async continuation that could mutate socket state captures a
generation token at scheduling time and checks it at execution time. Skip
this and ghost sockets sneak past.

```ts
class WSClient {
  private reconnectGen = 0
  private ws: WebSocket | null = null

  private scheduleReconnect(delayMs: number) {
    const gen = ++this.reconnectGen           // mint new generation
    setTimeout(() => {
      if (gen !== this.reconnectGen) return   // stale, do nothing
      this.openSocket(gen)
    }, delayMs + jitter(250))
  }

  private openSocket(gen: number) {
    const ws = new WebSocket(this.url)
    ws.onopen = () => {
      if (gen !== this.reconnectGen) { ws.close(); return }
      this.onOpen(gen, ws)
    }
    ws.onmessage = (ev) => {
      if (gen !== this.reconnectGen) return    // zombie socket may deliver one more
      this.onMessage(gen, ev)
    }
    ws.onclose = (ev) => {
      if (gen !== this.reconnectGen) return    // handler from a prior generation
      this.onClose(gen, ev)
    }
    ws.onerror = (ev) => {
      if (gen !== this.reconnectGen) return
      this.onError(gen, ev)
    }
    this.ws = ws
  }
}
```

Call sites that MUST gate on `gen`: reconnect setTimeout callback,
`onOpen`/`onMessage`/`onClose`/`onError`, `helloTimeout`, `livenessTimeout`,
`visibility:visible` re-armer.

Before reassigning `this.ws`, null out the old socket's handlers
(`this.ws.onopen = null` etc.) — browsers deliver one more event to detached
handlers if you don't.

#### Pre-hello message handling (simplified)

`state` messages arriving before `hello` are simply dropped with a
`console.debug` once. The next state broadcast arrives within 25 ms
(at 40 Hz tick) so first paint is at most one tick behind. The earlier
"queue + synchronous drain" design added an overflow-close path that
v1 has no production scenario for.

```ts
private onMessage(gen: number, ev: MessageEvent) {
  if (gen !== this.reconnectGen) return
  const msg = parse(ev.data)
  this.bumpLiveness()
  if (this.state === "awaiting_hello" && msg.type !== "hello") {
    if (!this.warnedPreHello) {
      console.debug("[ws-client] dropped pre-hello message:", msg.type)
      this.warnedPreHello = true
    }
    return
  }
  this.dispatch(msg)
}
```

#### Liveness check (simplified for v1)

Single self-rescheduling `setTimeout` based on `lastMessageAt`. No 1 Hz
`setInterval` churn; sleep/resume defense is deferred to v1.1 when the
daemon is real-show-critical.

```ts
private lastMessageAt = performance.now()
private livenessTimer: ReturnType<typeof setTimeout> | null = null

private bumpLiveness() {
  this.lastMessageAt = performance.now()
  this.armLiveness()
}

private armLiveness() {
  if (this.livenessTimer != null) clearTimeout(this.livenessTimer)
  const dueIn = (this.lastMessageAt + 5000) - performance.now()
  this.livenessTimer = setTimeout(() => {
    if (document.visibilityState !== "visible") return  // visibility handler owns hidden tabs
    if (performance.now() - this.lastMessageAt < 5000) { this.armLiveness(); return }
    this.ws?.close(4001, "silent")
  }, Math.max(dueIn, 100))
}
```

Wall-clock sleep/resume detection is a v1.1 add (~15 LOC); v1 ships the
simpler timer and accepts that a closed laptop lid will trigger one
spurious reconnect on resume.

#### Pending-intent reconcile policy

Discriminated union of error subclasses (not a single class with a symbol
code) so consumers narrow naturally via `instanceof`:

```ts
abstract class IntentError extends Error {
  abstract readonly code: "disconnected" | "no_ack" | "rejected"
  constructor(public readonly intent: Intent, message: string) {
    super(`[ws-client] ${message}`)
  }
}
export class IntentDisconnectedError extends IntentError {
  readonly code = "disconnected" as const
}
export class IntentNoAckError extends IntentError {
  readonly code = "no_ack" as const
}
export class IntentRejectedError extends IntentError {
  readonly code = "rejected" as const
  constructor(intent: Intent, public readonly wireCode: ErrorCode, message: string) {
    super(intent, message)
  }
}
export type AnyIntentError =
  | IntentDisconnectedError | IntentNoAckError | IntentRejectedError
```

- **`requiresAck` lives in `@rave/shared` on `VerbDef`**, not a web-only
  table. Both daemon (acks emitter) and an MCP wrapper need to agree.
  For v1 the rule is "all `preset_*` verbs require ack; everything else
  is fire-and-forget" — encoded in the verb catalog at build time.
- On `onClose`: iterate `pendingIntents`, reject every `requiresAck:true`
  entry with `new IntentDisconnectedError(intent, "ws closed")`, AND
  invoke any registered rollback callback (e.g., remove the optimistic
  preset entry from the `presets` store). Silently drop `requiresAck:false`
  entries (color knob nudges are fire-and-forget).
- On `ack {id}`: resolve and `delete` from map.
- On `error {id, code, message}`: reject with `new IntentRejectedError(intent, code, message)` and `delete`.
- 10 s after send: reject with `IntentNoAckError` and `delete`.
- `recentErrors` store (capped at 50 entries FIFO) gets a push only when
  the reject is user-surfaceable: every `IntentRejectedError`, every
  `IntentDisconnectedError` on a `requiresAck` intent. `IntentNoAckError`
  on fire-and-forget is silently dropped to debug log.

#### `sendIntent` ordering (register before send)

```ts
sendIntent(intent: Intent): Promise<void> {
  const id = crypto.randomUUID()
  return new Promise<void>((resolve, reject) => {
    // Register FIRST so a synchronous-throwing send cleanly fails this promise.
    this.pendingIntents.set(id, { intent, resolve, reject, ... })
    try {
      this.ws?.send(JSON.stringify({ type: "intent", id, intent }))
    } catch (err) {
      this.pendingIntents.delete(id)
      reject(new IntentDisconnectedError(intent, String(err)))
    }
  })
}
```

#### visibility-aware reconnect

```ts
// in WSClient constructor
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    this.suppressReconnect = true
    ++this.reconnectGen                   // cancels any scheduled reconnect
    this.ws?.close(1000, "background")
  } else {
    this.suppressReconnect = false
    this.connect()                        // immediate (no backoff after foreground)
  }
})
```

#### Vite HMR survival

Use TypeScript `declare global { var ... }` for type-clean singletons (no
per-call `as any` casts), pair `globalThis` registration with
`import.meta.hot.dispose` to clean up the old module's listeners without
closing the live socket. New module re-eval finds the existing
`globalThis.__raveWS` and re-attaches.

```ts
// apps/web/src/types.ts (or globals.d.ts)
declare global {
  // eslint-disable-next-line no-var
  var __raveBuffer: BufferStore | undefined
  // eslint-disable-next-line no-var
  var __raveWS: WSClient | undefined
}
export {}

// apps/web/src/lib/stores.svelte.ts
export const buffer = (globalThis.__raveBuffer ??= new BufferStore())

// apps/web/src/lib/ws-client.ts
export const wsClient = (globalThis.__raveWS ??= new WSClient())
if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose(() => {
    // Detach old module's listeners; DO NOT close — new module reuses the socket
    wsClient.detachModuleListeners()
  })
}
```

Per Vite #603, `dispose` doesn't compose across re-imports, so pair it
with `globalThis` for survival. `dispose` handles per-module listener
cleanup; `globalThis` handles instance identity preservation.

### SVG Preview Geometry

```text
viewBox  = (-5, -5, 10, 10)         // 10m × 10m room, origin at center
SVG-Y is downward; rig.json position.y is "depth" — flip on render
beam vector length = 1.8m (visual constant; not physical)
beam alpha multiplied by dimmer/255 (Legend) or shutter open/closed (MX-4)
fixture chrome (outline circle) ALWAYS drawn even when dimmer=0 / lamp off,
so "fixture exists, just dark" is visible
```

Decoders (pure functions in `decoding.ts`, unit-testable):

```ts
decodePan(fixture, buffer): number          // returns degrees, clamped
decodeTilt(fixture, buffer): number
decodeBeamColor(fixture, buffer): string    // CSS color
decodeGoboLabel(fixture, buffer): string | null
decodeDimmer(fixture, buffer): number       // 0..1
decodeLampOn(fixture, buffer): boolean
```

Beam-color precedence rule (resolves SpecFlow blocker):
- MX-4: wheel byte → capability lookup → `colorHex` if defined, else `#fff`
  (white) if the byte sits in a gap range (e.g., 6–11 split slot).
- Legend: if a wheel capability with `colorHex` is the current selection
  (byte in 0–127 range) → that color; otherwise CMY mix (`R=255-C, G=255-M,
  B=255-Y`). Macro byte non-zero is currently undefined → render the macro
  index as a small overlay number, beam color = CMY mix anyway.

Out-of-viewBox fixture handling: SpecFlow flagged `x=99`. Validate at
hello-time; clamp glyph to viewBox edge and render a "→" chevron indicating
it's offscreen. Don't silently hide. Log a console warning.

Pan/tilt boundary clamp:
```ts
function decodePan(f, buffer) {
  const range = f.profileRef.modes[f.modeName].channels[panIdx].capabilities[0].dmxRange
  const byte = buffer[f.start + panIdx - 1]
  const deg = clamp((byte / 255) * panMaxDeg(f), 0, panMaxDeg(f))
  return deg - panMaxDeg(f) / 2      // center on 0 (forward)
}
```

### Palette Composition

The layout JSON declares the master row (Strike all / Blackout / Home /
Reset / Panic). Per-fixture rows are **generated procedurally** from
`rig.fixtures` — adding a fixture doesn't require editing the layout.

```
+──────────────────────────────────────────────+
| Master:  [Strike all][Blackout][Home][Reset] |
|          [Panic]                             |
+──────────────────────────────────────────────+
| mx4-1:   [color picker ▾]  [gobo picker ▾]   |
| mx4-2:   [color picker ▾]  [gobo picker ▾]   |
| legend-1:[<color hex>]                       |
| legend-2:[<color hex>]                       |
+──────────────────────────────────────────────+
```

`ColorPicker.svelte` is a discriminated component:
- MX-4: button grid of 18 swatch buttons (the wheel positions); 1px outline
  for contrast on white/pastel gels; "named" intent.
- Legend: native `<input type="color">` + side-by-side swatches: "you
  picked" (sRGB) and "fixture will emit" (RGB derived back from CMY bytes
  after dispatch). The CMY subtractive expectation is set via a small tooltip.
- Color drags debounce 50 ms; coalesced by `(fixture, channel)` so a
  rapid drag doesn't flood the pending-intent map.

`GoboPicker.svelte`: 4×5 grid of small labeled buttons (Open + 19 gobos);
"Open" gets a distinct empty-circle glyph.

`PresetList.svelte`: list of named presets with recall (click) + delete (X
button). Save flow uses an **inline modal** (`PresetModal.svelte`), not
`window.prompt`. Modal validates client-side (length 1–64, NFC
normalization, character class) before sending. Reuses the same Zod schema
from `@rave/shared`. Optimistic insert with `pending: true` flag;
reconciled against the next `presets` broadcast (uses `causedBy` from the
wire to detect "another tab took my name").

### Daemon Static-File Serving (new — adds to existing daemon)

Production: user runs `bun run daemon`, opens `http://localhost:4101/`,
gets the SPA. Today the daemon only handles `/ws` and returns plain text
for other paths. Phase D adds a static handler with **path-traversal
defense** and **security headers**.

```ts
// apps/daemon/src/ws-server.ts (Phase D extension)
const DIST_DIR = resolve(import.meta.dir, "../../web/dist")
const DIST_PREFIX = DIST_DIR.endsWith("/") ? DIST_DIR : DIST_DIR + "/"
const indexHtmlFile = Bun.file(resolve(DIST_DIR, "index.html"))
const indexHtmlExists = await indexHtmlFile.exists()

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:4101 ws://localhost:4101; " +
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
}

async function serveStatic(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname

  if (!indexHtmlExists) {
    return new Response(
      "Daemon running. Run `bun --filter web dev` (Vite, port 5173) for development,\n" +
      "or build the web app: `bun --filter web build`.",
      { status: 200, headers: { "content-type": "text/plain", ...SECURITY_HEADERS } },
    )
  }

  // Path-traversal defense: resolve relative to DIST_DIR, then confine.
  // `resolve()` normalizes `..` but does NOT confine — explicit check required.
  // NUL bytes are rejected (some filesystems treat them as truncation).
  if (pathname.includes("\0") || !pathname.startsWith("/")) {
    return new Response("bad request", { status: 400, headers: SECURITY_HEADERS })
  }
  const requested = resolve(DIST_DIR, "." + pathname)
  if (requested !== DIST_DIR && !requested.startsWith(DIST_PREFIX)) {
    // Escapes DIST_DIR — SPA fallback (don't leak file existence)
    return new Response(indexHtmlFile, {
      headers: { "content-type": "text/html;charset=utf-8", ...SECURITY_HEADERS, "cache-control": "no-cache" },
    })
  }
  const file = Bun.file(requested)
  if (await file.exists()) {
    const isAsset = pathname.startsWith("/assets/")
    return new Response(file, {
      headers: {
        ...SECURITY_HEADERS,
        "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
      },
    })
  }
  // SPA fallback
  return new Response(indexHtmlFile, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      ...SECURITY_HEADERS,
      "cache-control": "no-cache",
    },
  })
}
```

**Vite dev server hardening** (`vite.config.ts`):

```ts
server: {
  host: "127.0.0.1",        // NEVER 0.0.0.0 — defeats the daemon's loopback bind
  strictPort: true,
  port: 5173,
  proxy: {
    "/ws": {
      target: "ws://127.0.0.1:4101",
      ws: true,
      changeOrigin: true,
      // NOT `rewriteWsOrigin: true` — that opens CSRF
    },
  },
}
```

**WS URL formula (client)** — derives from `window.location` so dev and
prod both Just Work without env config:

```ts
// ws-client.ts
const proto = location.protocol === "https:" ? "wss:" : "ws:"
const WS_URL = `${proto}//${location.host}/ws`
```

Layout JSON fallback: SpecFlow blocker. Today `loadLayout()` throws and
daemon refuses to start. Change to catch + fall back to a hardcoded
minimal layout (`{ schema:"rave.layout/v1", pages: [{ name:"main", grid:
{rows:1, cols:5}, pads: [strike_all, blackout, home, reset, panic] }] }`)
and surface `layout_invalid` warning in the next `hello`. Per-fixture
rows still render from `rig.fixtures` regardless.

### Implementation Phases

#### Phase 6A: Skeleton + WS client + buffer store *(~1 day)*

**Pre-work (cross-package schema additions in `@rave/shared`):**
- Add `requiresAck: boolean` to `VerbDef` and populate `VERB_CATALOG`.
- Add `effectiveLayout: ControlSurfaceLayout` and `warnings?: { layout_invalid?: boolean; rig_degraded?: boolean }` to `ServerMsg.hello` and `ServerMsg.describe`.
- Add `get_audit_tail` verb to `IntentSchema` (returns last N audit entries).
- New module `@rave/shared/src/layout-expand.ts` — pure function that takes `(layout, rig)` and returns a `ControlSurfaceLayout` with procedurally-generated per-fixture rows appended. Used by daemon (`hello`) and web (`Palette` rendering).
- New module `@rave/shared/src/feedback.ts` — `FeedbackSpec` registry (named functions). Used by `Palette` in v1, by future Launchpad daemon in v2.
- Tighten `PresetNameSchema` regex to `^[\p{L}\p{N}\p{Zs}\-_.]+$` (drops Unicode Punctuation — stored-XSS hedge).
- Daemon `ws-server.ts` updates: emit `effectiveLayout` and `warnings`, broadcast `presets` with `causedBy` on **rejected** mutations too (not just successful ones), handle `get_audit_tail`.

**Deliverables (web side):**
- `apps/web/package.json` (svelte, vite, `@sveltejs/vite-plugin-svelte` v7+, `@rave/shared`, **`mock-socket`** dev dep)
- `vite.config.ts` per the "Daemon Static-File Serving" section (`host: "127.0.0.1"`, `/ws` proxy with `ws: true, changeOrigin: true`)
- `apps/web/tsconfig.json` (include `**/*.svelte.ts`)
- `apps/web/index.html` + `apps/web/src/main.ts` + `apps/web/src/app.css`
- `apps/web/src/types.ts` — `CONNECTION_STATES` (string const tuple), `ConnectionState`, `PendingIntent`, `IntentError` discriminated subclasses, and the `declare global { var __raveBuffer ... }` block
- `apps/web/src/lib/ws-client.ts` — state machine per "Connection State Machine" section above. Fast-path `state` frames via typeguard; Zod-validate everything else.
- `apps/web/src/lib/stores.svelte.ts` — `BufferStore`, `ConnectionStore`, `RigStore`, `PresetsStore`, `ErrorsStore` (cap 50 FIFO), all `globalThis`-registered via the typed declare-global pattern.
- `apps/web/src/App.svelte` — minimal shell: connection chip + tick line inline (no separate `Header.svelte`), aria-live `<div role="alert">` inline (no separate `ErrorRegion.svelte`), raw buffer hex dump (proves end-to-end works).
- `apps/web/src/lib/ws-client.test.ts` — 3 race tests using `mock-socket`: ghost-socket on reconnect, hello+state ordering, HMR double-client.

**Success criteria:**
- `bun --filter daemon dev` + `bun --filter web dev`, open `http://localhost:5173`
- Shows "Connecting…", then "Connected (tick 1)" within 500 ms
- Kill daemon → shows "Reconnecting", restart → reconnects without doubled WS
- 5 race tests pass
- Manual: open Chrome DevTools → only 1 WebSocket entry at any time

#### Phase 6B: SVG rig preview *(~1.5 days)*

**Deliverables:**
- `apps/web/src/lib/decoding.ts` — pure decoders (decodePan/Tilt/BeamColor/
  GoboLabel/Dimmer/LampOn)
- `apps/web/src/lib/decoding.test.ts` — boundary cases (byte 0, 127, 255,
  gap ranges, MX-4 vs Legend differences, color precedence rule)
- `apps/web/src/lib/components/RigPreview.svelte` — viewBox, room frame,
  background grid (1m squares), centered origin
- `apps/web/src/lib/components/FixtureGlyph.svelte` — circle (chrome,
  always drawn), beam vector (rotated by pan, opacity = dimmer × shutter),
  beam-color swatch at tip, gobo label text (MX-4), lamp badge (small dot
  in top-right of glyph when lamp byte is set)
- Off-viewBox chevron rendering when `position.x` or `position.y` outside
  viewBox bounds

**Success criteria:**
- 4 fixtures render at their `rig.json` positions
- `wscat` send `{type:"intent", id:"t", intent:{verb:"color", fixture:
  "mx4-1", spec:{kind:"named", name:"Red 304"}}}` → preview's mx4-1 beam
  turns red within 50 ms
- `home_all` → all 4 beams point straight forward (up in top-down view)
- `blackout` → all beams go transparent but chrome remains
- 12+ decoder unit tests pass

#### Phase 6C: Palette + presets + errors *(~1.5 days)*

**Deliverables:**
- `apps/web/src/lib/components/Palette.svelte` — renders the master row
  from the layout JSON (parsed via shared Zod) + per-fixture rows
  procedurally from rig.fixtures
- `apps/web/src/lib/components/ColorPicker.svelte` — variant by fixture
  type (MX-4 swatch grid / Legend `<input type="color">` with both swatches)
- `apps/web/src/lib/components/GoboPicker.svelte` — 4×5 grid (MX-4 only)
- `apps/web/src/lib/components/PresetList.svelte` — list + Save button
- `apps/web/src/lib/components/PresetModal.svelte` — inline modal for
  name input with client-side Zod validation
- `apps/web/src/lib/components/ErrorRegion.svelte` — aria-live="polite";
  reads from `errors` store; 4 s auto-dismiss
- `apps/web/src/lib/components/Header.svelte` — connection chip (color-coded
  by state), tick rate indicator, daemon URL

**Success criteria:**
- Click "Strike all" → all 4 fixtures' lamp badges light up (or destructive
  gate error appears if `RAVE_ALLOW_DESTRUCTIVE` is off)
- Click an MX-4 color swatch → fixture beam color updates
- Drag the Legend color input → CMY values send, side-by-side swatches
  agree, preview beam reflects, no event-flood
- Save a preset named "warm-jam" → appears in list; recall it → preview
  jumps to that state; delete it → vanishes from list
- Try saving with empty name → modal validation rejects; the WS never
  sees the malformed intent
- Try saving a duplicate → daemon error code surfaces in ErrorRegion

#### Phase 6D: Daemon static serve + polish + README *(~½ day)*

**Deliverables:**
- Daemon `fetch()` extension to serve `apps/web/dist/` (with the fallback
  message when no build exists)
- Layout-fallback in daemon: if `loadLayout()` fails, log + use a
  hardcoded minimal layout, set `layout_invalid: true` flag in hello
- README.md at repo root with: quickstart, single-command-dev story
  (`bun dev`), screenshot, architecture diagram, list of v1.1/v2 follow-ups
- `apps/web/src/lib/components/RigPreview.svelte` cosmetic polish (a
  little dark-theme glow on active beams)

**Success criteria:**
- `bun --filter web build` succeeds; `bun run daemon` (no Vite needed)
  serves the SPA at `http://localhost:4101/`
- Cold start (daemon → browser open → fully painted preview): ≤ 2 s
- Bundle size: ≤ 50 KB gzipped (per the master plan's non-functional req)
- README has working `bun install && bun dev` instructions

**Total estimated effort: 4.5 days of solo work.**

## Alternative Approaches Considered

### Bun build instead of Vite

Bun has its own bundler (`bun build`) with Svelte support via plugins.
Eliminates one dev dependency.

Rejected: Vite's Svelte HMR is significantly more polished in 2026.
`@sveltejs/vite-plugin-svelte` is the official path. Bun build can be
swapped in later for production (it's compatible with the same Svelte
source) without disturbing the dev loop. The cost of Vite at this scale
is one config file.

### Server-rendered (SvelteKit)

SvelteKit would handle routing, SSR, and asset pipelining out of the box.

Rejected: a single-page app with WebSocket-driven state has no SSR upside
and SvelteKit's routing/loaders add complexity v1 doesn't need. Plain
Svelte 5 + Vite is the minimum honest choice.

### Browser-only (no daemon)

Web Serial API + Web MIDI API could drive Enttec USB Pro and Launchpad
Mini directly from the browser tab. Lose the daemon entirely.

Rejected (already): origin R1 requires the daemon explicitly ("browser tab
can crash mid-show and lights keep running"). The architecture is now
shipped — re-litigating would discard 5 phases of work.

### Tailwind CSS

Idiomatic for many Svelte projects; speeds up styling.

Rejected: For ~6 components and a 1-page app, adding a build dependency
and ~30 KB of utility CSS exceeds the "very minimally" framing. Vanilla
CSS with custom properties is 100 lines.

## System-Wide Impact

### Interaction Graph

- User click → `Palette.svelte` calls `wsClient.sendIntent(intent)` →
  generates UUID, pushes to `pendingIntents`, sends WS frame.
- Daemon receives → Zod validates → dispatches → mutates buffer → next
  tick broadcasts `state` to all subscribers (including this client).
- Client `onMessage(state)` → `BufferStore.applyState(b64, tick)` →
  reassigns `buffer = new Uint8Array(decoded)` → all `$derived`
  consumers in `FixtureGlyph` and visible UI recompute.
- Daemon `ack {id}` → `pendingIntents.get(id).resolve()` → entry deleted.

### Error & Failure Propagation

- WS connect failure → state=RECONNECTING → backoff timer (with jitter
  + gen token).
- Hello timeout → `ws.close(4000, "no-hello")` → onClose → reconnect path.
- WS message parse failure (malformed daemon output) → console.error,
  ignore the frame (don't disconnect; daemon may be at fault but the
  user shouldn't see the rig go offline for one bad frame).
- Intent rejected by daemon → `error` message → `IntentError` rejects
  the pending promise → pushed to `errors` store → `ErrorRegion`
  surfaces with 4 s auto-dismiss.
- Pending intent timeout (10 s) → `IntentError(INTENT_NO_ACK)` →
  surfaced only for `requiresAck:true` intents (presets); silently
  dropped for fire-and-forget.
- WS close mid-pending → reject `requiresAck` entries with
  `INTENT_DISCONNECTED`; drop the rest.

### State Lifecycle Risks

- **Buffer divergence between tabs:** none. Daemon is single source of
  truth; tabs subscribe read-mostly. Each tab's `BufferStore` reflects
  the last `state` broadcast.
- **Pending intent leaks:** prevented by `onClose` cleanup path. Map
  must be empty after `RECONNECTING` transitions.
- **Stale singletons across HMR:** prevented by `globalThis` registry +
  `import.meta.hot.dispose()`.
- **Optimistic preset state vs server truth:** save flow optimistically
  inserts `{ pending: true }`. Reconcile on next `presets` broadcast.
  If the broadcast's `causedBy` matches our intent id → confirm. If
  another id wins → roll back optimistic entry; surface "another session
  saved this name" toast.

### API Surface Parity

- Every UI button maps to exactly one intent verb. The verb catalog
  (`VERB_CATALOG` in `@rave/shared`) is the canonical surface. An
  MCP-wrapped agent has parity by construction.
- The layout JSON is loaded by both the daemon (for `hello`) and the
  web (for rendering). Same Zod schema, same source of truth.

### Integration Test Scenarios

Cross-layer scenarios unit tests with mocks would miss:

1. **Cold start, daemon then browser** — daemon boots → browser opens →
   sees `hello` snapshot → preview renders within 500 ms.
2. **Daemon restart mid-session** — UI is connected, user kills daemon,
   restarts. UI auto-reconnects with no doubled WebSocket, no duplicate
   `pendingIntents`, no doubled fixture chrome.
3. **Two tabs, racing color clicks** — both end at the same final buffer
   state (last-write-wins server-side).
4. **Save preset, hand-edit presets.json, restart daemon** — daemon
   refuses to start with structured error → UI shows "Daemon offline".
   Fix the file, restart → reconnect is clean.
5. **Save preset in Tab A while Tab B deletes the same name** —
   surviving tab sees `causedBy` mismatch, surfaces toast, removes
   optimistic entry.

## Acceptance Criteria

### Functional (mapped to origin requirements)

- [ ] **AC-R6** SVG top-down preview renders 4 fixtures with beam vector,
  color, gobo label (MX-4), opacity (dimmer/shutter), lamp badge.
- [ ] **AC-R7** Palette renders: 5 master buttons + per-fixture color
  picker + MX-4 gobo picker. No per-fixture pan/tilt/intensity/strobe
  controls (deferred).
- [ ] **AC-R8** Save / recall / delete preset; client-side name
  validation; survives daemon restart.
- [ ] **AC-R9** Palette renders from `layouts/default-v1.json`. Layout
  schema is the same Zod schema as the daemon parses (in `@rave/shared`).
- [ ] **AC-R10** `bun install && bun dev` boots both apps; opening
  `http://localhost:5173` shows the connected preview within 2 s.
  Production: `bun --filter web build && bun run daemon` serves the app
  at `http://localhost:4101/`.

### Non-Functional

- [ ] State-push round trip (click → preview update) ≤ 50 ms on loopback.
- [ ] First paint ≤ 500 ms (skeleton chrome + "Connecting…")
- [ ] Cold start to connected preview ≤ 2 s on a mid-laptop.
- [ ] Production bundle ≤ 50 KB gzipped.
- [ ] All TypeScript: `strict: true` typecheck passes.
- [ ] Zero console errors during normal flow (kill-daemon recovery
  excepted).

### Quality Gates

- [ ] Unit tests on `decoding.ts` (≥ 12 tests covering MX-4/Legend +
  boundaries + color precedence).
- [ ] Unit tests on `ws-client.ts` with a fake WebSocket (≥ 5 tests:
  ghost socket, hello+state same task, sleep-resume false silence,
  disconnect-during-pending, HMR double-client).
- [ ] Zod schemas for the wire format are imported from `@rave/shared`
  (no duplicated schemas).
- [ ] aria-live error region announces every surfaced error.
- [ ] No mutable-in-place writes to the buffer store anywhere in client
  code (ESLint rule or grep-based CI check).

## Success Metrics

- A 4-fixture rig is fully demonstrable in the browser without any DMX
  hardware connected.
- Adding a 3rd fixture model = adding a JSON profile + rig entry;
  per-fixture row appears automatically; no component changes.
- Cold start (no warm cache) to fully-painted preview is ≤ 2 s on a 2024
  laptop. State changes feel instant.
- When v1.1 (real DMX sink) ships, the web client is unchanged.

## Dependencies & Prerequisites

- Daemon must be running on `127.0.0.1:4101/ws`.
- Browser with WebSocket support (any from the last 5 years).
- Modern Svelte 5 toolchain: `svelte@^5`, `vite@^6`,
  `@sveltejs/vite-plugin-svelte@^4`.
- Filesystem read of `apps/web/src/layouts/default-v1.json` at daemon
  startup (today this is hardcoded as a fatal load — Phase D makes it
  graceful).

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `$state(Uint8Array)` silently fails | High if forgotten | High | Explicit `$state.raw` + reassignment; ESLint rule forbidding `buffer[...] =`; explicit unit test that mutation-in-place doesn't update derived values |
| Ghost-socket bug on reconnect | High without `reconnectGen` discipline | High | Capture-by-value pattern documented above; race test 1 targets this |
| Vite HMR double-instances stores | Medium | Medium | `declare global { var __raveBuffer }` typed singleton + `import.meta.hot.dispose` listener cleanup |
| **Path traversal in static handler** | High without confine check | High (file disclosure) | `requested.startsWith(DIST_PREFIX)` confine + NUL reject; SPA fallback on escape (no existence leak) |
| **Vite dev binds 0.0.0.0** | High default behavior | High (LAN exposure) | Pin `server.host: "127.0.0.1"` |
| **Stored XSS via preset name** | Low (Svelte escapes) | Medium (compounds with future {@html}) | Tighten regex to `[\p{L}\p{N}\p{Zs}\-_.]+` in `PresetNameSchema` |
| **`causedBy` orphan on rejected mutation** | Medium | Medium (visible UX glitch) | Extend daemon contract: broadcast `presets` with `causedBy` on rejection too; explicit rollback callback in `pendingIntents` for preset intents |
| Color contrast on swatches (white gel invisible) | High | Low | 1px outline on every swatch |
| Many fixtures overflow the palette | Low (v1=4) | Low | `max-height + overflow-y: auto`; revisit if v1.1 brings >12 fixtures |
| Daemon refuses to start on malformed layout JSON | Medium | High (no UI) | Graceful fallback in Phase D + `warnings.layout_invalid: true` in `hello` |
| Browser disagrees with CMY output color | High (subtractive expectation) | Low | Preview is the feedback (no side-by-side swatches in v1) |
| Sleep/resume false "silent" disconnect | Low (v1 demo context) | Low | Accept one spurious reconnect on lid-open; add wall-clock check in v1.1 |

## Future Considerations

### v1.1 (real DMX sink)
Web client unchanged. The daemon swaps `NullSink` for `EnttecProSink` /
`ArtNetSink` / `OLASink`. The destructive-verb gate
(`RAVE_ALLOW_DESTRUCTIVE`) is enabled only after the lamp-and-hold
safety state machine ships.

### v2 (Launchpad Mini)
The Launchpad daemon is a **separate Bun process** at `apps/launchpad/`
using a Node MIDI library (e.g. `@julusian/midi`), NOT a browser tab. Web
MIDI in a tab can't survive sleep, can't headlessly autostart, and SysEx
permission is a per-user-gesture prompt — none of which fit a "always-on
control surface" model.

What's actually shared between the web app and the Launchpad daemon:
- The `ControlSurfaceLayout` *schema* (and the `effectiveLayout` expansion
  via `@rave/shared/src/layout-expand.ts`).
- The `FeedbackSpec` registry in `@rave/shared` — both renderers read the
  same `feedback.fn` library to derive pad colors from buffer state.
- The `Intent` discriminated union and `VerbDef` catalog (incl.
  `requiresAck`).
- The WS connection state machine semantics (the Launchpad daemon
  re-implements `WSClient` with the same shape — Bun-target, not
  browser-target).

What's NOT shared: `Palette.svelte`. DOM components don't translate to
MIDI Note On + RGB SysEx. The Launchpad daemon's renderer is a separate
implementation that consumes the same layout data.

### v3+ (effects, audio, cues)
- **Per-fixture pan/tilt sliders + intensity + strobe**: rerun the brainstorm.
- **Chases / ramps**: time-based effects from the daemon's `BufferTransform`
  middleware slot, not the client. The client just renders the resulting
  buffer at the broadcast rate.
- **Audio reactivity**: Web Audio FFT in the browser, FFT bins streamed
  to the daemon via a new `audio` verb. Daemon's intent layer applies
  them as buffer mutations.
- **MIDI clock sync**: Web MIDI in the browser, clock ticks sent to
  daemon as intents.

### Accessibility / keyboard shortcuts
v1 ships clickable buttons; keyboard shortcuts (B=blackout, H=home,
1-9=recall presets 1-9) are deferred to v1.5.

### Mobile / touch
v1 is desktop browser. Mobile/touch support is deferred; the responsive
layout (SVG scales to viewport) means it'll degrade gracefully, but no
explicit touch testing in v1.

## Documentation Plan

- Repo `README.md`: quickstart (3 commands), screenshot of the connected
  preview, architecture diagram, links to research/brainstorm/plan docs.
- `apps/web/README.md` (small): dev workflow, build, where the layout
  JSON lives, how to add a fixture profile.
- Inline JSDoc on the `WSClient` public surface (the state machine is
  load-bearing).
- The daemon's new static-serve handler gets a comment block explaining
  the dev vs prod resolution.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-06-09-rave-control-app-requirements.md](../brainstorms/2026-06-09-rave-control-app-requirements.md)
  Key decisions carried forward: virtual-only v1 (NullSink), daemon-not-
  browser-only, click→set + named presets (no chases), JSON file
  persistence, DOM-only renderer for the layout schema, master controls
  + per-fixture color/gobo only.

### Master plan (parent)

- **Master plan:** [docs/plans/2026-06-10-001-feat-rave-v1-control-app-plan.md](2026-06-10-001-feat-rave-v1-control-app-plan.md)
  Phases 1–5 already shipped (commits `f68a130`, `d160d1b`, `c2417d2`,
  `9b0373a` on `main`). This plan implements Phases 6–9 with additional
  depth on race patterns and SVG geometry.

### Internal References

- `apps/daemon/src/ws-server.ts` — wire-protocol target (line ranges:
  open=80–95, message dispatch=104–135, broadcast=170–185).
- `packages/shared/src/intents.ts` — Intent discriminated union and
  VERB_CATALOG; the web app imports both verbatim.
- `packages/shared/src/layout.ts` — ControlSurfaceLayout schema, parsed
  on both ends.
- `apps/web/src/layouts/default-v1.json` — master controls layout (already
  exists in the repo).
- `profiles/*.json` — channel maps used by `decoding.ts`.
- `dmx-research.md` §2 (MX-4 channel byte ranges), §3 (Legend 16-bit math),
  §6 (architecture sketch).

### External References

- Svelte 5 `$state` and `$state.raw`: <https://svelte.dev/docs/svelte/$state>
  (typed arrays not proxied — load-bearing for the buffer store).
- Svelte 5 `.svelte.ts` modules: <https://svelte.dev/docs/svelte/svelte-js-files>
- Svelte universal reactivity tutorial:
  <https://svelte.dev/tutorial/svelte/universal-reactivity>
- `@sveltejs/vite-plugin-svelte`: <https://github.com/sveltejs/vite-plugin-svelte>
- Vite server.proxy: <https://vite.dev/config/server-options#server-proxy>
- Vite HMR API (`dispose`): <https://vite.dev/guide/api-hmr#hot-dispose-cb>
- Vite #603 — stateful singleton HMR limitations:
  <https://github.com/vitejs/vite/issues/603>
- Bun.serve docs: <https://bun.sh/docs/api/http>
- Bun.file docs: <https://bun.sh/docs/api/file-io>
- mock-socket (WebSocket test double): <https://github.com/thoov/mock-socket>
- pladaria/reconnecting-websocket (jitter formula reference):
  <https://github.com/pladaria/reconnecting-websocket/blob/master/reconnecting-websocket.ts>
- WebSocket reconnect patterns (jitter, backoff):
  <https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection/view>
- Svelte 5 SVG perf #11405 (high-frequency reactive SVG):
  <https://github.com/sveltejs/svelte/issues/11405>
- Charlie Marsh — SVG layout invalidation:
  <https://www.crmarsh.com/svg-performance/>

### Pre-Implementation Gap Resolution

The SpecFlow Analyzer flagged 15 web-specific gaps before this plan was
written. Each is resolved by a specific section above:

| SpecFlow gap | Resolved in |
|-------------|-------------|
| Hello-before-paint UX | Phase 6A skeleton, Connection State Machine |
| Layout JSON load is fatal | Phase 6D graceful fallback |
| Pending intent reconcile on reconnect | Pending-intent reconcile policy |
| Daemon doesn't serve built bundle | Phase 6D static-file handler |
| Save-preset uses window.prompt | PresetModal.svelte |
| Beam color precedence undefined | SVG Preview Geometry → "Beam-color precedence rule" |
| Pan/tilt boundary off-by-one | SVG Preview Geometry → clamp + decode pattern |
| SVG out-of-viewBox fixtures | Off-viewBox chevron handling |
| Color picker visuals (white invisible) | 1px outline, side-by-side swatches |
| Mid-color-drag disconnect | 50 ms debounce + coalesce by (fixture, channel) |
| Many fixtures overflow | `max-height + overflow-y: auto` |
| Gobo picker layout | 4×5 grid with distinct "Open" glyph |
| Multi-tab last-write-wins | Header tooltip + `causedBy` reconcile |
| Browser support | Vite es2022 target; Svelte 5 requires Safari 17+/FF 121+/Chrome 120+ |
| Vite HMR singleton race | `globalThis` registry + `import.meta.hot.dispose` |

The Frontend-Races reviewer (Julik) flagged 7 race patterns; each is
encoded in the Connection State Machine section:

| Race pattern | Resolved in |
|-------------|-------------|
| Stale-closure / `reconnectGen` checked at every callback | `reconnectGen` discipline section |
| Hello/state ordering — queue + synchronous drain | Hello queue section |
| `bumpLiveness` on sleeping laptop | Liveness check section |
| Pending-intent leak on disconnect | Pending-intent reconcile policy |
| visibilitychange during AWAITING_HELLO | visibility-aware reconnect |
| Vite HMR + singleton | HMR survival section |
| Multi-tab pendingIntents semantics | Optimistic preset reconcile via `causedBy` |
