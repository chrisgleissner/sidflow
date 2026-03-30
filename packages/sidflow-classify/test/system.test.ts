import { afterEach, describe, expect, it } from "bun:test";

import { getRecommendedWorkerCount, parsePhysicalCpuCountFromCpuInfo } from "../src/system.js";

const originalMaxThreads = process.env.SIDFLOW_MAX_THREADS;

afterEach(() => {
  if (originalMaxThreads === undefined) {
    delete process.env.SIDFLOW_MAX_THREADS;
  } else {
    process.env.SIDFLOW_MAX_THREADS = originalMaxThreads;
  }
});

describe("parsePhysicalCpuCountFromCpuInfo", () => {
  it("captures the final processor entry even without a trailing blank line", () => {
    const cpuInfo = [
      "processor\t: 0",
      "physical id\t: 0",
      "core id\t\t: 0",
      "",
      "processor\t: 1",
      "physical id\t: 0",
      "core id\t\t: 1",
    ].join("\n");

    expect(parsePhysicalCpuCountFromCpuInfo(cpuInfo)).toBe(2);
  });

  it("falls back when physical and core identifiers are unavailable", () => {
    const cpuInfo = [
      "processor\t: 0",
      "model name\t: Test CPU",
      "",
      "processor\t: 1",
      "model name\t: Test CPU",
    ].join("\n");

    expect(parsePhysicalCpuCountFromCpuInfo(cpuInfo)).toBeNull();
  });

  it("respects the explicit SIDFLOW_MAX_THREADS ceiling", () => {
    process.env.SIDFLOW_MAX_THREADS = "3";

    expect(getRecommendedWorkerCount(99)).toBe(3);
    expect(getRecommendedWorkerCount()).toBe(3);
  });
});