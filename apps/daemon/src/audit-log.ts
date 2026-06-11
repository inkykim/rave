import { appendFile } from "node:fs/promises"
import type { Intent } from "@rave/shared"

export type AuditEntry = {
  ts: string
  clientId: string
  intent: Intent
  result: "ack" | "error"
  errorCode?: string
}

export class AuditLog {
  private writeQueue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string) {}

  append(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n"
    const next = this.writeQueue.then(() => appendFile(this.path, line, "utf8"))
    this.writeQueue = next.catch((err: Error) => {
      console.error(`[audit] append failed: ${err.message}`)
    })
    return next
  }
}
