/**
 * Middleware that sits between the operator-intent buffer and the wire buffer.
 *
 * v1 ships an identity transform — NullSink means there's nothing physical to
 * protect. v1.1 plugs in the lamp-and-hold safety state machine here:
 * strike-stagger, 3s/5s holds, lamp-off interlocks, hot-restart cooldown.
 */
export interface BufferTransform {
  transform(universe: number, intent: Uint8Array): Uint8Array
}

export class IdentityTransform implements BufferTransform {
  transform(_universe: number, intent: Uint8Array): Uint8Array {
    return intent
  }
}
