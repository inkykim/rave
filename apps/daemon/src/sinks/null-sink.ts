import type { Sink } from "./sink"

/** Accepts buffers; produces no output. Default sink for v1 (virtual-only). */
export class NullSink implements Sink {
  async send(_universe: number, _buffer: Uint8Array): Promise<void> {
    /* noop */
  }
}
