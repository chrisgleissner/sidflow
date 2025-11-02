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
});
