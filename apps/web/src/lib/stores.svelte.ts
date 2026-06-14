import type {
  Profile,
  RigConfig,
  PresetEntry,
  ControlSurfaceLayout,
  DaemonWarnings,
} from "@rave/shared"
import type { ConnectionState, ErrorEntry } from "../types"

const MAX_RECENT_ERRORS = 50

/**
 * BufferStore wraps a $state.raw Uint8Array. CRITICAL: typed arrays are NOT
 * proxied — in-place mutation (`bytes[i] = x` or `bytes.set(...)` without
 * reassignment) silently fails to trigger reactivity.
 *
 * The only mutator is replace(). Callers must construct a NEW Uint8Array
 * (never mutate the existing one and reassign the same reference, since
 * Svelte compares by identity).
 */
export class BufferStore {
  bytes = $state.raw<Uint8Array>(new Uint8Array(512))
  tick = $state<number>(0)

  replace(next: Uint8Array, tick: number): void {
    if (next.length !== 512) throw new Error(`buffer must be 512 bytes, got ${next.length}`)
    this.bytes = next
    this.tick = tick
  }
}

/** Connection state machine, stored as a plain string union. */
export class ConnectionStore {
  state = $state<ConnectionState>("connecting")
  url = $state<string>("")
}

/** Rig snapshot (hydrated from `hello`). */
export class RigStore {
  rig = $state<RigConfig | null>(null)
  profiles = $state<Record<string, Profile>>({})
  layout = $state<ControlSurfaceLayout | null>(null)
  effectiveLayout = $state<ControlSurfaceLayout | null>(null)
  warnings = $state<DaemonWarnings | null>(null)
}

/** Preset list (broadcast-driven). Includes optimistic pending entries. */
export class PresetsStore {
  presets = $state<ReadonlyArray<PresetEntry & { pending?: boolean }>>([])

  replace(next: ReadonlyArray<PresetEntry>): void {
    this.presets = next
  }
}

/** Bounded FIFO list of user-surfaceable errors. */
export class ErrorsStore {
  entries = $state<ReadonlyArray<ErrorEntry>>([])

  push(entry: ErrorEntry): void {
    const next = [...this.entries, entry]
    if (next.length > MAX_RECENT_ERRORS) next.splice(0, next.length - MAX_RECENT_ERRORS)
    this.entries = next
  }
}

type StoreBag = {
  buffer: BufferStore
  connection: ConnectionStore
  rig: RigStore
  presets: PresetsStore
  errors: ErrorsStore
}

/**
 * globalThis-registered singleton bag of stores. Survives Vite HMR — the new
 * module re-eval finds the existing bag and re-attaches. import.meta.hot is
 * handled in main.ts to clean up listeners without disposing the bag.
 */
function createStores(): StoreBag {
  return {
    buffer: new BufferStore(),
    connection: new ConnectionStore(),
    rig: new RigStore(),
    presets: new PresetsStore(),
    errors: new ErrorsStore(),
  }
}

export const stores = (globalThis.__raveStores as StoreBag | undefined) ?? createStores()
;(globalThis as unknown as { __raveStores: StoreBag }).__raveStores = stores
