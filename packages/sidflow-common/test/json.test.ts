import { describe, expect, it } from "bun:test";
import { normalizeForDeterministicSerialization, stringifyDeterministic } from "@sidflow/common";

describe("json", () => {
  it("sorts object keys recursively", () => {
    const value = {
      b: 2,
      a: {
        d: 4,
        c: 3
      }
    };

    const normalized = normalizeForDeterministicSerialization(value);
    expect(Object.keys(normalized)).toEqual(["a", "b"]);
    const nested = normalized as Record<string, unknown>;
    expect(Object.keys(nested.a as Record<string, unknown>)).toEqual(["c", "d"]);
  });

  it("serializes deterministically", () => {
    const value = { z: 1, a: 2 };
    const output = stringifyDeterministic(value);
    expect(output).toBe(`{
  "a": 2,
  "z": 1
}
`);
  });

  it("handles arrays within objects", () => {
    const value = { b: [3, 2, 1], a: [1, 2, 3] };
    const output = stringifyDeterministic(value);
    expect(output).toContain('"a"');
    expect(output).toContain('"b"');
    expect(Object.keys(JSON.parse(output))).toEqual(["a", "b"]);
  });

  it("handles nested arrays of objects", () => {
    const value = { items: [{ z: 1, a: 2 }, { y: 3, x: 4 }] };
    const output = stringifyDeterministic(value);
    const parsed = JSON.parse(output);
    expect(Object.keys(parsed.items[0])).toEqual(["a", "z"]);
    expect(Object.keys(parsed.items[1])).toEqual(["x", "y"]);
  });

  it("handles null and undefined values", () => {
    const value = { b: null, a: undefined, c: "value" };
    const normalized = normalizeForDeterministicSerialization(value);
    expect(normalized).toHaveProperty("b", null);
    expect(normalized).toHaveProperty("c", "value");
  });

  it("handles primitives", () => {
    expect(normalizeForDeterministicSerialization(42)).toBe(42);
    expect(normalizeForDeterministic Serialization("text")).toBe("text");
    expect(normalizeForDeterministicSerialization(true)).toBe(true);
    expect(normalizeForDeterministicSerialization(null)).toBe(null);
  });

  it("handles empty objects and arrays", () => {
    const value = { empty: {}, arr: [] };
    const output = stringifyDeterministic(value);
    const parsed = JSON.parse(output);
    expect(parsed.empty).toEqual({});
    expect(parsed.arr).toEqual([]);
  });

  it("handles dates by converting to ISO strings", () => {
    const date = new Date("2025-01-01T00:00:00.000Z");
    const value = { date };
    const output = stringifyDeterministic(value);
    expect(output).toContain("2025-01-01T00:00:00.000Z");
  });
});
