import type {
  Profile,
  RigConfig,
  PresetEntry,
  ControlSurfaceLayout,
  DaemonWarnings,
} from "@rave/shared"
import type { ConnectionState, ErrorEntry } from "../types"

/**
 * StoreBag interface — the contract WSClient depends on. The real
 * implementation lives in stores.svelte.ts (uses $state runes). A plain-TS
 * fake (TestStoreBag) is used by ws-client.test.ts so the unit tests don't
 * need Svelte's compile pipeline.
 */
export interface StoreBag {
  buffer: { bytes: Uint8Array; tick: number; replace(next: Uint8Array, tick: number): void }
  connection: { state: ConnectionState; url: string }
  rig: {
    rig: RigConfig | null
    profiles: Record<string, Profile>
    layout: ControlSurfaceLayout | null
    effectiveLayout: ControlSurfaceLayout | null
    warnings: DaemonWarnings | null
  }
  presets: {
    presets: ReadonlyArray<PresetEntry & { pending?: boolean }>
    replace(next: ReadonlyArray<PresetEntry>): void
  }
  errors: {
    entries: ReadonlyArray<ErrorEntry>
    push(entry: ErrorEntry): void
  }
}

/** Plain-TS fake used by ws-client.test.ts. No runes, no reactivity. */
export class TestStoreBag implements StoreBag {
  buffer: { bytes: Uint8Array; tick: number; replace(next: Uint8Array, tick: number): void } = {
    bytes: new Uint8Array(512),
    tick: 0,
    replace(next: Uint8Array, tick: number): void {
      this.bytes = next
      this.tick = tick
    },
  }
  connection = { state: "connecting" as ConnectionState, url: "" }
  rig = {
    rig: null as RigConfig | null,
    profiles: {} as Record<string, Profile>,
    layout: null as ControlSurfaceLayout | null,
    effectiveLayout: null as ControlSurfaceLayout | null,
    warnings: null as DaemonWarnings | null,
  }
  presets = {
    presets: [] as ReadonlyArray<PresetEntry & { pending?: boolean }>,
    replace(next: ReadonlyArray<PresetEntry>): void {
      this.presets = next
    },
  }
  errors = {
    entries: [] as ReadonlyArray<ErrorEntry>,
    push(entry: ErrorEntry): void {
      this.entries = [...this.entries, entry]
    },
  }
}
