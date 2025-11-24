import { describe, expect, it, spyOn } from "bun:test";

import { retry } from "@sidflow/common";

describe("retry", () => {
  it("resolves on the first attempt", async () => {
    const result = await retry(async () => "ok");
    expect(result).toBe("ok");
  });

  it("retries until success within the limit", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("fail");
      }
      return "done";
    }, { retries: 3 });

    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });

  it("propagates error after exhausting retries", async () => {
    let attempts = 0;
    await expect(retry(async () => {
      attempts += 1;
      throw new Error("nope");
    }, { retries: 2 })).rejects.toThrow("nope");
    expect(attempts).toBe(3);
  });

  it("awaits onRetry hooks", async () => {
    const calls: number[] = [];
    await expect(retry(async () => {
      calls.push(calls.length + 1);
      throw new Error("boom");
    }, {
      retries: 1,
      onRetry: async (_error: unknown, attempt: number) => {
        calls.push(attempt + 100);
      }
    })).rejects.toThrow("boom");

    expect(calls).toEqual([1, 101, 3]);
  });

  it("delays between retries when requested", async () => {
    const spy = spyOn(globalThis, "setTimeout");

    await expect(retry(async () => {
      throw new Error("delayed");
    }, { retries: 1, delayMs: 5 })).rejects.toThrow("delayed");

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not delay when delayMs is 0", async () => {
    const spy = spyOn(globalThis, "setTimeout");

    await expect(retry(async () => {
      throw new Error("no delay");
    }, { retries: 1, delayMs: 0 })).rejects.toThrow("no delay");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("succeeds immediately without retries if function succeeds", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts++;
      return 42;
    }, { retries: 5 });
    expect(result).toBe(42);
    expect(attempts).toBe(1);
  });

  it("handles retries with default options", async () => {
    let attempts = 0;
    await expect(retry(async () => {
      attempts++;
      throw new Error("fail");
    })).rejects.toThrow("fail");
    expect(attempts).toBeGreaterThan(1);
  });

  it("handles async onRetry callback errors gracefully", async () => {
    let retryCallbackCalled = false;
    await expect(retry(async () => {
      throw new Error("main");
    }, {
      retries: 1,
      onRetry: async () => {
        retryCallbackCalled = true;
        throw new Error("callback error");
      }
    })).rejects.toThrow("main");
    expect(retryCallbackCalled).toBe(true);
  });
});
