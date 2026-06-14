import { describe, expect, test } from "bun:test"
import { IntentSchema, VERB_CATALOG, DESTRUCTIVE_VERBS } from "./intents"

describe("IntentSchema", () => {
  test("accepts a well-formed color intent (named)", () => {
    const result = IntentSchema.safeParse({
      verb: "color",
      fixture: "mx4-1",
      spec: { kind: "named", name: "Red 304" },
    })
    expect(result.success).toBe(true)
  })

  test("accepts a well-formed color intent (rgb)", () => {
    const result = IntentSchema.safeParse({
      verb: "color",
      fixture: "legend-1",
      spec: { kind: "rgb", hex: "#ff0080" },
    })
    expect(result.success).toBe(true)
  })

  test("rejects a color intent with bad hex", () => {
    const result = IntentSchema.safeParse({
      verb: "color",
      fixture: "legend-1",
      spec: { kind: "rgb", hex: "not-a-color" },
    })
    expect(result.success).toBe(false)
  })

  test("rejects unknown verb", () => {
    const result = IntentSchema.safeParse({ verb: "nonexistent" })
    expect(result.success).toBe(false)
  })

  test("rejects strike without fixture", () => {
    const result = IntentSchema.safeParse({ verb: "strike" })
    expect(result.success).toBe(false)
  })

  test("strike_all takes no args", () => {
    const result = IntentSchema.safeParse({ verb: "strike_all" })
    expect(result.success).toBe(true)
  })

  test("rejects preset_save with invalid name", () => {
    const result = IntentSchema.safeParse({ verb: "preset_save", name: "../escape" })
    expect(result.success).toBe(false)
  })

  test("accepts preset_save with valid name", () => {
    const result = IntentSchema.safeParse({ verb: "preset_save", name: "warm-jam" })
    expect(result.success).toBe(true)
  })
})

describe("VERB_CATALOG", () => {
  test("covers every verb in the schema", () => {
    const expected = [
      "color",
      "gobo",
      "strike",
      "strike_all",
      "blackout",
      "home",
      "home_all",
      "reset",
      "panic",
      "preset_save",
      "preset_recall",
      "preset_delete",
      "describe",
      "get_state",
      "get_presets",
      "get_rig",
      "get_audit_tail",
    ].sort()
    const catalogVerbs = VERB_CATALOG.map((v) => v.verb).sort()
    expect(catalogVerbs).toEqual(expected as typeof catalogVerbs)
  })

  test("DESTRUCTIVE_VERBS is exactly {strike, strike_all, reset}", () => {
    expect(DESTRUCTIVE_VERBS).toEqual(new Set(["strike", "strike_all", "reset"]))
  })

  test("requiresAck is true only for preset_* and read verbs", () => {
    const fireAndForget = VERB_CATALOG.filter((v) => !v.requiresAck).map((v) => v.verb).sort()
    const ackRequired = VERB_CATALOG.filter((v) => v.requiresAck).map((v) => v.verb).sort()
    expect(fireAndForget).toEqual(
      ["color", "gobo", "strike", "strike_all", "blackout", "home", "home_all", "reset", "panic"].sort() as typeof fireAndForget,
    )
    expect(ackRequired).toEqual(
      [
        "preset_save",
        "preset_recall",
        "preset_delete",
        "describe",
        "get_state",
        "get_presets",
        "get_rig",
        "get_audit_tail",
      ].sort() as typeof ackRequired,
    )
  })

  test("get_audit_tail accepts optional limit", () => {
    expect(IntentSchema.safeParse({ verb: "get_audit_tail" }).success).toBe(true)
    expect(IntentSchema.safeParse({ verb: "get_audit_tail", limit: 50 }).success).toBe(true)
    expect(IntentSchema.safeParse({ verb: "get_audit_tail", limit: 9999 }).success).toBe(false)
  })
})
