import os from "node:os";
import { readFileSync } from "node:fs";

export function getLogicalCpuCount(): number {
  try {
    const cores = os.cpus().length;
    if (Number.isInteger(cores) && cores > 0) {
      return cores;
    }
  } catch {
    // Bun can route node:os CPU discovery through browser-like globals in some test runs.
    // Falling back to one worker preserves correct behavior without crashing classification.
  }

  return 1;
}

export function parsePhysicalCpuCountFromCpuInfo(cpuInfo: string): number | null {
  const cores = new Set<string>();
  let physicalId = "0";
  let coreId = "0";
  let sawPhysicalOrCore = false;
  let currentHasPhysicalOrCore = false;
  let hasDataForCurrent = false;

  for (const line of cpuInfo.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === "") {
      if (hasDataForCurrent && currentHasPhysicalOrCore) {
        cores.add(`${physicalId}:${coreId}`);
      }
      physicalId = "0";
      coreId = "0";
      currentHasPhysicalOrCore = false;
      hasDataForCurrent = false;
      continue;
    }

    hasDataForCurrent = true;
    if (line.startsWith("physical id")) {
      physicalId = line.split(":")[1]?.trim() ?? "0";
      sawPhysicalOrCore = true;
      currentHasPhysicalOrCore = true;
    } else if (line.startsWith("core id")) {
      coreId = line.split(":")[1]?.trim() ?? "0";
      sawPhysicalOrCore = true;
      currentHasPhysicalOrCore = true;
    }
  }

  if (hasDataForCurrent && currentHasPhysicalOrCore) {
    cores.add(`${physicalId}:${coreId}`);
  }

  return sawPhysicalOrCore && cores.size > 0 ? cores.size : null;
}

export function getPhysicalCpuCount(): number {
  try {
    const cpuInfo = readFileSync("/proc/cpuinfo", "utf8");
    const physicalCount = parsePhysicalCpuCountFromCpuInfo(cpuInfo);
    if (physicalCount !== null) {
      return physicalCount;
    }
  } catch {
    // Fall through to heuristic fallback on non-Linux or restricted environments.
  }

  const logical = getLogicalCpuCount();
  return Math.max(1, Math.floor(logical / 2));
}

export function getRecommendedWorkerCount(requested?: number): number {
  const physical = getPhysicalCpuCount();
  const heuristicCeiling = Math.max(1, Math.min(6, Math.floor(physical / 2) || 1));
  const envMax = Number.parseInt(process.env.SIDFLOW_MAX_THREADS ?? "", 10);
  const effectiveCeiling = Number.isInteger(envMax) && envMax > 0
    ? Math.max(1, Math.min(heuristicCeiling, envMax))
    : heuristicCeiling;

  if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) {
    return Math.max(1, Math.min(Math.floor(requested), effectiveCeiling));
  }

  return effectiveCeiling;
}