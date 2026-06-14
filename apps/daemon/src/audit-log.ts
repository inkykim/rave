import { appendFile, readFile } from "node:fs/promises"
import { IntentSchema, type AuditEntrySerialized } from "@rave/shared"
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
  private recentEntries: AuditEntry[] = []
  /** In-memory ring buffer cap; on-disk log is unbounded. */
  private readonly maxRecent = 1000

  constructor(private readonly path: string) {}

  append(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n"
    this.recentEntries.push(entry)
    if (this.recentEntries.length > this.maxRecent) {
      this.recentEntries.splice(0, this.recentEntries.length - this.maxRecent)
    }
    const next = this.writeQueue.then(() => appendFile(this.path, line, "utf8"))
    this.writeQueue = next.catch((err: Error) => {
      console.error(`[audit] append failed: ${err.message}`)
    })
    return next
  }

  /**
   * Returns the most recent N entries (default 100). Prefers the in-memory
   * ring buffer; falls back to reading the file for entries older than the
   * current daemon process.
   */
  async tail(limit = 100): Promise<AuditEntrySerialized[]> {
    const cap = Math.max(1, Math.min(limit, 1000))
    if (this.recentEntries.length >= cap) {
      return this.recentEntries.slice(-cap)
    }
    // Pad with on-disk entries if the in-memory buffer is shy of `cap`.
    try {
      const text = await readFile(this.path, "utf8")
      const lines = text.split("\n").filter((l) => l.length > 0)
      const fromDisk: AuditEntrySerialized[] = []
      for (const line of lines.slice(-cap)) {
        try {
          const obj = JSON.parse(line)
          if (typeof obj?.ts === "string" && typeof obj?.clientId === "string" && obj?.intent) {
            const intent = IntentSchema.safeParse(obj.intent)
            if (intent.success) {
              fromDisk.push({
                ts: obj.ts,
                clientId: obj.clientId,
                intent: intent.data,
                result: obj.result === "error" ? "error" : "ack",
                errorCode: typeof obj.errorCode === "string" ? obj.errorCode : undefined,
              })
            }
          }
        } catch {
          // Skip malformed line
        }
      }
      return fromDisk.slice(-cap)
    } catch {
      return [...this.recentEntries]
    }
  }
}
