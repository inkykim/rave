import { readFile, writeFile, rename, unlink } from "node:fs/promises"
import { dirname, basename, join } from "node:path"
import {
  PresetsFileSchema,
  type PresetEntry,
  type PresetsFile,
} from "@rave/shared"
import type { UniverseBuffer } from "./buffer"

export class PresetError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "PresetError"
  }
}

const MAX_PRESETS = 500

/**
 * PresetController owns ./presets.json. All mutations are serialized through
 * a single-writer promise queue so concurrent saves from different WS clients
 * can't lose data even though Bun's event loop yields on every await.
 *
 * File envelope is versioned; on load, anything past v1 refuses to start
 * (forces an explicit migration in v2 rather than silent corruption).
 */
export class PresetController {
  private presets: PresetEntry[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly buffer: UniverseBuffer,
    private readonly universe: number,
  ) {}

  async load(): Promise<void> {
    let text: string | null = null
    try {
      text = await readFile(this.path, "utf8")
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === "ENOENT") {
        // Cold start: write the empty envelope and continue
        this.presets = []
        await this.persist()
        return
      }
      throw new PresetError("io_error", `cannot read ${this.path}: ${e.message}`)
    }

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (err) {
      throw new PresetError("io_error", `presets file is not valid JSON: ${(err as Error).message}`)
    }

    const parsed = PresetsFileSchema.safeParse(raw)
    if (!parsed.success) {
      throw new PresetError("io_error", `presets file failed validation: ${parsed.error.message}`)
    }
    this.presets = parsed.data.presets

    // Sweep orphan .tmp from a crashed prior write
    try {
      const tmp = `${this.path}.tmp`
      await unlink(tmp)
    } catch {
      /* nothing to clean */
    }
  }

  list(): PresetEntry[] {
    return [...this.presets]
  }

  /** Save the current buffer (universe 1) as a named preset. Rejects duplicates. */
  save(name: string, tick: number): Promise<PresetEntry[]> {
    return this.mutate(async () => {
      if (this.presets.some((p) => p.name === name)) {
        throw new PresetError("duplicate_name", `preset "${name}" already exists`)
      }
      if (this.presets.length >= MAX_PRESETS) {
        throw new PresetError("internal_error", `preset limit (${MAX_PRESETS}) reached`)
      }
      const bytes = this.buffer.peek(this.universe)
      const entry: PresetEntry = {
        name,
        buffer: bufferToBase64(bytes),
        capturedAt: new Date().toISOString(),
        capturingTick: tick,
      }
      this.presets.push(entry)
      await this.persist()
      return this.list()
    })
  }

  /** Overwrite the buffer with a named preset's bytes. */
  recall(name: string): Promise<void> {
    return this.mutate(async () => {
      const entry = this.presets.find((p) => p.name === name)
      if (!entry) throw new PresetError("preset_not_found", `preset "${name}" not found`)
      const bytes = base64ToBuffer(entry.buffer)
      this.buffer.replaceUniverse(this.universe, bytes)
    })
  }

  /** Delete a named preset. */
  delete(name: string): Promise<PresetEntry[]> {
    return this.mutate(async () => {
      const idx = this.presets.findIndex((p) => p.name === name)
      if (idx < 0) throw new PresetError("preset_not_found", `preset "${name}" not found`)
      this.presets.splice(idx, 1)
      await this.persist()
      return this.list()
    })
  }

  private async persist(): Promise<void> {
    const envelope: PresetsFile = { schema: "rave.presets/v1", presets: this.presets }
    const json = JSON.stringify(envelope, null, 2)
    const tmp = join(dirname(this.path), `${basename(this.path)}.tmp`)
    try {
      await writeFile(tmp, json, { encoding: "utf8", mode: 0o600 })
      await rename(tmp, this.path)
    } catch (err) {
      // Best effort cleanup of the .tmp file before surfacing the error
      try {
        await unlink(tmp)
      } catch {
        /* ignore */
      }
      throw new PresetError("io_error", `persist failed: ${(err as Error).message}`)
    }
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {
      /* swallow so one failed mutation doesn't poison subsequent ones */
    })
    return next
  }
}

function bufferToBase64(bytes: Uint8Array): string {
  // Bun supports Buffer.from(bytes).toString('base64')
  return Buffer.from(bytes).toString("base64")
}

function base64ToBuffer(b64: string): Uint8Array {
  const buf = Buffer.from(b64, "base64")
  if (buf.length !== 512) {
    throw new PresetError("io_error", `preset buffer must decode to 512 bytes, got ${buf.length}`)
  }
  return new Uint8Array(buf)
}
