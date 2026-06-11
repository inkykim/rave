import { describe, expect, test } from "bun:test"
import { UniverseBuffer } from "./buffer"

describe("UniverseBuffer", () => {
  test("starts at all zeros, dirty=true", () => {
    const b = new UniverseBuffer([1])
    expect(b.dirty).toBe(true)
    const snap = b.peek(1)
    expect(snap.length).toBe(512)
    expect(snap.every((x) => x === 0)).toBe(true)
  })

  test("write flips dirty, snapshot clears it", () => {
    const b = new UniverseBuffer([1])
    b.snapshot(1)
    expect(b.dirty).toBe(false)
    b.write(1, 5, 200)
    expect(b.dirty).toBe(true)
    const { bytes } = b.snapshot(1)
    expect(b.dirty).toBe(false)
    expect(bytes[4]).toBe(200)
  })

  test("write with same value does not dirty", () => {
    const b = new UniverseBuffer([1])
    b.snapshot(1)
    b.write(1, 5, 0)
    expect(b.dirty).toBe(false)
  })

  test("snapshot increments tick", () => {
    const b = new UniverseBuffer([1])
    const a = b.snapshot(1)
    const c = b.snapshot(1)
    expect(c.tick).toBe(a.tick + 1)
  })

  test("writeRange writes contiguous bytes", () => {
    const b = new UniverseBuffer([1])
    b.writeRange(1, 10, [1, 2, 3, 4])
    const snap = b.peek(1)
    expect(snap[9]).toBe(1)
    expect(snap[10]).toBe(2)
    expect(snap[11]).toBe(3)
    expect(snap[12]).toBe(4)
  })

  test("replaceUniverse overwrites entire universe", () => {
    const b = new UniverseBuffer([1])
    const replacement = new Uint8Array(512).fill(42)
    b.replaceUniverse(1, replacement)
    expect(b.peek(1)[0]).toBe(42)
    expect(b.peek(1)[511]).toBe(42)
  })

  test("write rejects out-of-range channels", () => {
    const b = new UniverseBuffer([1])
    expect(() => b.write(1, 0, 5)).toThrow()
    expect(() => b.write(1, 513, 5)).toThrow()
  })

  test("supports multi-universe", () => {
    const b = new UniverseBuffer([1, 2])
    b.write(1, 1, 100)
    b.write(2, 1, 200)
    expect(b.peek(1)[0]).toBe(100)
    expect(b.peek(2)[0]).toBe(200)
  })

  test("unallocated universe throws", () => {
    const b = new UniverseBuffer([1])
    expect(() => b.write(2, 1, 0)).toThrow()
  })
})
