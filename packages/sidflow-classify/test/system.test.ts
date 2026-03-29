import { describe, expect, it } from "bun:test";

import { parsePhysicalCpuCountFromCpuInfo } from "../src/system.js";

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
});