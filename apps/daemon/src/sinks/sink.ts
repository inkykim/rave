/**
 * Output sink for DMX universes. v1 only ships NullSink. v1.1 will add
 * EnttecProSink / ArtNetSink / OLASink without changes upstream.
 *
 * `send` is async because real sinks (Art-Net UDP, FTDI writes, OLA RPC) are
 * inherently async. v1's NullSink resolves immediately.
 */
export interface Sink {
  send(universe: number, buffer: Uint8Array): Promise<void>
  close?(): Promise<void> | void
}
