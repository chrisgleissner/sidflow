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

export function getPhysicalCpuCount(): number {
  try {
    const cpuInfo = readFileSync("/proc/cpuinfo", "utf8");
    const cores = new Set<string>();
    let physicalId = "0";
    let coreId = "0";

    for (const line of cpuInfo.split(/\r?\n/)) {
      if (line.startsWith("physical id")) {
        physicalId = line.split(":")[1]?.trim() ?? "0";
      } else if (line.startsWith("core id")) {
        coreId = line.split(":")[1]?.trim() ?? "0";
      } else if (line.trim() === "") {
        cores.add(`${physicalId}:${coreId}`);
        physicalId = "0";
        coreId = "0";
      }
    }

    if (cores.size > 0) {
      return cores.size;
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