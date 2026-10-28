import { expect, test } from "bun:test";
import { adaptiveScreens, STATEFUL_READ, type ScreenMode } from "../../../scripts/rom-audit/adaptive-screen.js";
const result = (error = "", chargenReads = 0) => ({ error, chargenReads, traceComplete: true, writes: [] });
test("late SID read avoids redundant aborted variant runs, still executes variants", async () => {
  const run = async (_mask: number, mode: ScreenMode) => result(mode === "detailed" ? "" : STATEFUL_READ, 1);
  const baseline = await adaptiveScreens(run, false), adaptive = await adaptiveScreens(run, true);
  expect(baseline.length).toBe(9); expect(adaptive.length).toBe(5);
  expect(adaptive.filter(a => !a.result.error).map(a => a.mask)).toEqual([7, 0, 3]);
});
test("a variant can require more detailed execution than its reference", async () => {
  const attempts = await adaptiveScreens(async (mask, mode) => result(mask === 0 && mode !== "detailed" ? STATEFUL_READ : ""), true);
  expect(attempts.map(a => [a.mask, a.mode])).toEqual([[7,"bus"],[0,"bus"],[0,"warmup"],[0,"detailed"]]);
});
test("reference failures and truncation cannot authorize comparisons", async () => {
  for (const reference of [result("engine failed"), {...result(), traceComplete: false}]) {
    expect((await adaptiveScreens(async () => reference, true)).length).toBe(1);
  }
});
test("warmup is only a scheduling hint; failures propagate to evidence", async () => {
  const attempts = await adaptiveScreens(async (mask, mode) => result(mask === 7 && mode === "bus" ? STATEFUL_READ : mask === 0 ? "halt" : ""), true);
  expect(attempts.map(a => a.mode)).toEqual(["bus","warmup","warmup"]);
  expect(attempts.at(-1)!.result.error).toBe("halt");
});
