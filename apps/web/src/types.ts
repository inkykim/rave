import type { Intent, ErrorCode, PresetEntry, Profile, RigConfig, ControlSurfaceLayout } from "@rave/shared"

/**
 * Mirrors the ERROR_CODES `as const` pattern in @rave/shared/messages.ts —
 * string-literal exhaustiveness, no symbols (matches existing convention,
 * stays log-friendly, can flow into `data-conn-state` for CSS).
 */
export const CONNECTION_STATES = [
  "connecting",
  "awaiting_hello",
  "ready",
  "reconnecting",
  "dead",
] as const
export type ConnectionState = (typeof CONNECTION_STATES)[number]

/** Discriminated union of intent errors. Consumers narrow via `instanceof`. */
export abstract class IntentError extends Error {
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

export type AnyIntentError = IntentDisconnectedError | IntentNoAckError | IntentRejectedError

/** One entry in the pendingIntents map. */
export type PendingIntent = {
  intent: Intent
  resolve: () => void
  reject: (err: IntentError) => void
  sentAt: number
  timeoutId: ReturnType<typeof setTimeout>
}

/** App-scope error feed (bounded; FIFO eviction). */
export type ErrorEntry = {
  id: string
  message: string
  code: string
  at: number
}

// Re-export shared types frequently used at app scope
export type { Intent, ErrorCode, PresetEntry, Profile, RigConfig, ControlSurfaceLayout }

// globalThis declarations for HMR-surviving singletons (typed once; no per-call casts).
declare global {
  // eslint-disable-next-line no-var
  var __raveStores: object | undefined
  // eslint-disable-next-line no-var
  var __raveWS: object | undefined
}

export {}
