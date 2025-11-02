import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createLogger } from "@sidflow/common";

type MethodName = "debug" | "info" | "warn" | "error";

describe("logger", () => {
  const original: Partial<Record<MethodName, (...args: unknown[]) => void>> = {};
  const captured: Array<{ method: MethodName; message: string; args: unknown[] }> = [];

  beforeEach(() => {
    captured.length = 0;
    (Object.keys(console) as MethodName[]).forEach((key) => {
      if (typeof console[key] === "function") {
        original[key] = console[key];
        console[key] = ((message: string, ...args: unknown[]) => {
          captured.push({ method: key, message, args });
        }) as typeof console[MethodName];
      }
    });
  });

  afterEach(() => {
    (Object.entries(original) as Array<[MethodName, (...args: unknown[]) => void]>).forEach(
      ([key, fn]) => {
        console[key] = fn as typeof console[MethodName];
      }
    );
  });

  it("prefixes messages", () => {
    const logger = createLogger("test");
    logger.info("ready", { payload: true });
    logger.error("boom");

    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual({
      method: "info",
      message: "[test] ready",
      args: [{ payload: true }]
    });
    expect(captured[1].message.startsWith("[test] ")).toBeTrue();
  });
});
