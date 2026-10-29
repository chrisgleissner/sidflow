import { describe, expect, test } from "bun:test";
import { requestUnlessStopped } from "../../../scripts/rom-audit/screen-cancellation.js";

describe("census cancellation", () => {
  test("a watchdog-closing worker leaves its interrupted job pending", async () => {
    let stopped = false;
    const result = await requestUnlessStopped(async () => {
      await Promise.resolve();
      stopped = true;
      throw new Error("Screen worker closed");
    }, () => stopped);
    expect(result).toBeUndefined();
  });
  test("genuine worker errors still propagate", async () => {
    await expect(requestUnlessStopped(async () => { throw new Error("engine failed"); }, () => false)).rejects.toThrow("engine failed");
  });
  test("a completed measurement survives a concurrent stop", async () => {
    let stopped = false;
    expect(await requestUnlessStopped(async () => { stopped = true; return 42; }, () => stopped)).toBe(42);
  });
  test("stopped queues do not start another job", async () => {
    let calls = 0;
    expect(await requestUnlessStopped(async () => ++calls, () => true)).toBeUndefined();
    expect(calls).toBe(0);
  });
});
