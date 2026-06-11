/**
 * A multi-universe-capable buffer container. v1 only uses universe 1 but the
 * shape doesn't paint v2 into a corner.
 *
 * Tracks a monotonic tick counter and a dirty bit. `snapshot()` clears dirty
 * and returns the current bytes; the tick loop uses this for change-only
 * broadcasts.
 */
export class UniverseBuffer {
  private readonly buffers = new Map<number, Uint8Array>()
  private _tick = 0
  private _dirty = true // dirty on first read so initial broadcast happens

  constructor(universes: number[] = [1]) {
    for (const u of universes) this.buffers.set(u, new Uint8Array(512))
  }

  get tick(): number {
    return this._tick
  }

  get dirty(): boolean {
    return this._dirty
  }

  /** Read a single byte (1-based channel). */
  read(universe: number, channel: number): number {
    const buf = this.buffers.get(universe)
    if (!buf) throw new Error(`universe ${universe} not allocated`)
    if (channel < 1 || channel > 512) throw new Error(`channel ${channel} out of range`)
    return buf[channel - 1]!
  }

  /** Write a single byte (1-based channel). Marks dirty. */
  write(universe: number, channel: number, value: number): void {
    const buf = this.buffers.get(universe)
    if (!buf) throw new Error(`universe ${universe} not allocated`)
    if (channel < 1 || channel > 512) throw new Error(`channel ${channel} out of range`)
    const v = value & 0xff
    if (buf[channel - 1] !== v) {
      buf[channel - 1] = v
      this._dirty = true
    }
  }

  /** Overwrite a contiguous range starting at channel (1-based). Marks dirty. */
  writeRange(universe: number, startChannel: number, bytes: ArrayLike<number>): void {
    const buf = this.buffers.get(universe)
    if (!buf) throw new Error(`universe ${universe} not allocated`)
    if (startChannel < 1 || startChannel + bytes.length - 1 > 512) {
      throw new Error(`writeRange out of range`)
    }
    for (let i = 0; i < bytes.length; i++) buf[startChannel - 1 + i] = bytes[i]! & 0xff
    this._dirty = true
  }

  /** Replace the entire buffer for one universe (used by preset recall). */
  replaceUniverse(universe: number, bytes: Uint8Array): void {
    const buf = this.buffers.get(universe)
    if (!buf) throw new Error(`universe ${universe} not allocated`)
    if (bytes.length !== 512) throw new Error(`expected 512 bytes, got ${bytes.length}`)
    buf.set(bytes)
    this._dirty = true
  }

  /** Snapshot the buffer for a universe; advances tick and clears dirty. */
  snapshot(universe: number): { bytes: Uint8Array; tick: number } {
    const buf = this.buffers.get(universe)
    if (!buf) throw new Error(`universe ${universe} not allocated`)
    // Return a copy so callers can JSON-stringify without racing with mutations.
    const copy = new Uint8Array(buf)
    this._tick += 1
    this._dirty = false
    return { bytes: copy, tick: this._tick }
  }

  /** Read-only snapshot without advancing tick or clearing dirty (for tests). */
  peek(universe: number): Uint8Array {
    const buf = this.buffers.get(universe)
    if (!buf) throw new Error(`universe ${universe} not allocated`)
    return new Uint8Array(buf)
  }
}
