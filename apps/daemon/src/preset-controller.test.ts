import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UniverseBuffer } from "./buffer"
import { PresetController, PresetError } from "./preset-controller"

let tmpDir: string
let presetsPath: string
let buffer: UniverseBuffer
let presets: PresetController

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "rave-presets-"))
  presetsPath = join(tmpDir, "presets.json")
  buffer = new UniverseBuffer([1])
  presets = new PresetController(presetsPath, buffer, 1)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe("PresetController.load", () => {
  test("creates an empty file on cold start (file missing)", async () => {
    await presets.load()
    const text = await readFile(presetsPath, "utf8")
    expect(JSON.parse(text)).toEqual({ schema: "rave.presets/v1", presets: [] })
  })

  test("rejects malformed JSON", async () => {
    await writeFile(presetsPath, "{ not json", "utf8")
    await expect(presets.load()).rejects.toThrow(/not valid JSON/)
  })

  test("rejects unknown schema version", async () => {
    await writeFile(presetsPath, JSON.stringify({ schema: "rave.presets/v99", presets: [] }), "utf8")
    await expect(presets.load()).rejects.toThrow(/failed validation/)
  })

  test("loads an existing file", async () => {
    const fixture = {
      schema: "rave.presets/v1",
      presets: [
        {
          name: "warm-jam",
          buffer: Buffer.alloc(512, 42).toString("base64"),
          capturedAt: "2026-06-09T18:00:00.000Z",
          capturingTick: 1234,
        },
      ],
    }
    await writeFile(presetsPath, JSON.stringify(fixture), "utf8")
    await presets.load()
    expect(presets.list().length).toBe(1)
    expect(presets.list()[0]!.name).toBe("warm-jam")
  })
})

describe("PresetController.save", () => {
  beforeEach(async () => {
    await presets.load()
  })

  test("saves current buffer as a named preset", async () => {
    buffer.write(1, 1, 42)
    buffer.write(1, 5, 200)
    const list = await presets.save("first-look", 100)
    expect(list.length).toBe(1)
    expect(list[0]!.name).toBe("first-look")
    expect(list[0]!.capturingTick).toBe(100)
  })

  test("rejects duplicate name with code=duplicate_name", async () => {
    await presets.save("dup", 1)
    try {
      await presets.save("dup", 2)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as PresetError).code).toBe("duplicate_name")
    }
  })

  test("survives daemon restart (round-trip)", async () => {
    buffer.write(1, 10, 77)
    await presets.save("survivor", 1)

    const fresh = new PresetController(presetsPath, new UniverseBuffer([1]), 1)
    await fresh.load()
    expect(fresh.list().length).toBe(1)
    expect(fresh.list()[0]!.name).toBe("survivor")
  })
})

describe("PresetController.recall", () => {
  beforeEach(async () => {
    await presets.load()
  })

  test("overwrites the buffer with stored bytes", async () => {
    buffer.write(1, 5, 200)
    await presets.save("a", 1)

    buffer.write(1, 5, 0) // clear the byte
    expect(buffer.peek(1)[4]).toBe(0)

    await presets.recall("a")
    expect(buffer.peek(1)[4]).toBe(200)
  })

  test("missing preset returns preset_not_found", async () => {
    try {
      await presets.recall("ghost")
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as PresetError).code).toBe("preset_not_found")
    }
  })
})

describe("PresetController.delete", () => {
  beforeEach(async () => {
    await presets.load()
  })

  test("removes named preset", async () => {
    await presets.save("a", 1)
    await presets.save("b", 2)
    const list = await presets.delete("a")
    expect(list.length).toBe(1)
    expect(list[0]!.name).toBe("b")
  })

  test("missing preset returns preset_not_found", async () => {
    try {
      await presets.delete("ghost")
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as PresetError).code).toBe("preset_not_found")
    }
  })
})

describe("PresetController concurrency", () => {
  beforeEach(async () => {
    await presets.load()
  })

  test("two same-tick saves serialize without data loss", async () => {
    buffer.write(1, 1, 10)
    const [list1, list2] = await Promise.all([
      presets.save("first", 1),
      presets.save("second", 2),
    ])
    // Either order is fine, but the LAST broadcast value reflects both saves
    const final = list2.length > list1.length ? list2 : list1
    expect(final.length).toBe(2)
    expect(final.map((p) => p.name).sort()).toEqual(["first", "second"])
  })

  test("a failing mutation does not poison the queue", async () => {
    await presets.save("a", 1)
    // Try to save a duplicate (will throw)
    try {
      await presets.save("a", 2)
      expect("should not get here").toBe("but did")
    } catch (e) {
      expect((e as PresetError).code).toBe("duplicate_name")
    }
    // Subsequent operations still work
    const list = await presets.save("b", 3)
    expect(list.map((p) => p.name).sort()).toEqual(["a", "b"])
  })
})
