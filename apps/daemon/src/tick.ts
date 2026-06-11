import type { UniverseBuffer } from "./buffer"
import type { BufferTransform } from "./buffer-transform"
import type { Sink } from "./sinks/sink"

export type TickCallback = (snapshot: { universe: number; bytes: Uint8Array; tick: number }) => void

export type TickOptions = {
  buffer: UniverseBuffer
  transform: BufferTransform
  sink: Sink
  universes: number[]
  /** Target tick interval in ms; default 25 (= 40 Hz). */
  intervalMs?: number
  /** Called after each tick where the buffer changed. */
  onBroadcast?: TickCallback
}

/**
 * Drift-correcting 40 Hz tick. Schedules from a stable epoch rather than
 * compounding setInterval drift.
 */
export class TickLoop {
  private timer: ReturnType<typeof setTimeout> | null = null
  private startedAt = 0
  private tickCount = 0
  private readonly intervalMs: number

  constructor(private readonly opts: TickOptions) {
    this.intervalMs = opts.intervalMs ?? 25
  }

  start(): void {
    if (this.timer) return
    this.startedAt = performance.now()
    this.tickCount = 0
    this.scheduleNext()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(): void {
    this.tickCount += 1
    const target = this.startedAt + this.tickCount * this.intervalMs
    const delay = Math.max(0, target - performance.now())
    this.timer = setTimeout(() => this.runTick(), delay)
  }

  private async runTick(): Promise<void> {
    try {
      for (const universe of this.opts.universes) {
        if (!this.opts.buffer.dirty) continue
        const { bytes, tick } = this.opts.buffer.snapshot(universe)
        const wire = this.opts.transform.transform(universe, bytes)
        await this.opts.sink.send(universe, wire)
        this.opts.onBroadcast?.({ universe, bytes: wire, tick })
      }
    } catch (err) {
      console.error("[tick] error:", err)
    } finally {
      if (this.timer !== null) this.scheduleNext()
    }
  }
}
