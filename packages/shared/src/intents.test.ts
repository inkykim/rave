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
    const allVerbs = new Set([
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
    ])
    const catalogVerbs = new Set(VERB_CATALOG.map((v) => v.verb))
    expect(catalogVerbs).toEqual(allVerbs)
  })

  test("DESTRUCTIVE_VERBS is exactly {strike, strike_all, reset}", () => {
    expect(DESTRUCTIVE_VERBS).toEqual(new Set(["strike", "strike_all", "reset"]))
  })
})
