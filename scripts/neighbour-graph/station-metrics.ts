/**
 * Drive the ported station engine the way the client's queue provider drives it, and summarise
 * what a listener would hear.
 *
 * Kept separate from `station-engine-port.ts` so that file can stay a line-by-line mirror of
 * `c64commander/src/lib/sidRadio/stationEngine.ts`. Everything here is the harness around it:
 * the refill loop, the exclusion policy, and the statistics.
 */

import {
  computeStation,
  REFILL_BATCH,
  siblingsOf,
  type StationBundle,
  type StationSeed,
} from "./station-engine-port.js";

export interface StationPolicy {
  /**
   * `fixed` reproduces the shipped client: the same seed every refill, with the exclusion set
   * growing. `drift` adds the recently played tracks as extra seeds so the retrieval centre
   * moves with the listener.
   */
  policy: "fixed" | "drift";
  /** Drift window, in consumed tracks. */
  recent: number;
  /** Weight of the most recently consumed track. */
  recentWeight: number;
  /** Geometric decay applied per step back through the window. */
  recentDecay: number;
  /** Weight the original seed retains under drift. */
  originWeight: number;
  /** Exclude every subsong of a consumed file, not just the consumed subsong. */
  dedupeTune: boolean;
  maxHops?: number;
  /** Stop a station after this many distinct tracks, so a healthy station terminates. */
  cap: number;
  styleFilter?: number | null;
}

export interface StationRun {
  /** Distinct tracks served before the station reported nothing left. */
  distinctServed: number;
  /** Consecutive pairs in the served order that came from the same `.sid` file. */
  sameFileAdjacent: number;
  /** Any track served twice. Must always be zero. */
  duplicates: number;
  /** Distinct `.sid` files served. */
  distinctFiles: number;
  /** Whether the run hit the cap rather than exhausting. */
  cappedOut: boolean;
  /** Refill calls the station needed. */
  refills: number;
}

/**
 * One station, run to exhaustion.
 *
 * The loop mirrors `StationQueueProvider.refill`: ask for `REFILL_BATCH` candidates excluding
 * everything consumed so far, consume them one at a time, and ask again when the buffer empties.
 * It stops when a call returns nothing, which is the point at which the client reports the
 * station exhausted.
 */
export function runStation(
  bundle: StationBundle,
  seed: StationSeed,
  shuffleSeed: number,
  policy: StationPolicy,
): StationRun {
  const excluded = new Set<number>();
  const served: number[] = [];
  // Separate from `excluded`, which under tune-level dedupe also holds siblings that were never
  // served. Without this, "did we serve this twice" cannot be asked.
  const servedSet = new Set<number>();
  let duplicates = 0;
  let cappedOut = false;
  let refills = 0;

  for (;;) {
    refills += 1;
    const extraSeeds: Array<{ trackOrdinal: number; weight: number }> = [];
    if (policy.policy === "drift" && served.length > 0) {
      // The tail of the served order is the recent window: most recent at full weight, each
      // step back multiplied by the decay.
      const window = served.slice(-policy.recent);
      for (let index = window.length - 1; index >= 0; index -= 1) {
        const stepsBack = window.length - 1 - index;
        extraSeeds.push({
          trackOrdinal: window[index]!,
          weight: policy.recentWeight * Math.pow(policy.recentDecay, stepsBack),
        });
      }
      // The original seed stays at reduced weight so the station remembers where it began. It
      // is added as an extra seed rather than left as the primary seed, because the primary
      // seed always carries the engine's full BASE_SEED_WEIGHT and cannot be attenuated.
      if (seed.kind === "song" && seed.fileOrdinal !== undefined) {
        const start = bundle.fileTrackStart[seed.fileOrdinal] ?? 0;
        const count = bundle.fileTrackCount[seed.fileOrdinal] ?? 0;
        for (let index = 0; index < count; index += 1) {
          extraSeeds.push({ trackOrdinal: start + index, weight: policy.originWeight });
        }
      }
    }

    const result = computeStation({
      bundle,
      seed,
      shuffleSeed,
      exclude: excluded,
      limit: REFILL_BATCH,
      extraSeeds,
      maxHops: policy.maxHops,
      styleFilter: policy.styleFilter ?? null,
    });
    if (result.candidates.length === 0) {
      break;
    }
    let consumedThisBatch = 0;
    for (const ordinal of result.candidates) {
      if (excluded.has(ordinal)) {
        continue;
      }
      if (servedSet.has(ordinal)) {
        duplicates += 1;
      }
      served.push(ordinal);
      servedSet.add(ordinal);
      excluded.add(ordinal);
      consumedThisBatch += 1;
      if (policy.dedupeTune) {
        for (const sibling of siblingsOf(bundle, ordinal)) {
          excluded.add(sibling);
        }
      }
      if (served.length >= policy.cap) {
        break;
      }
    }
    if (served.length >= policy.cap) {
      cappedOut = true;
      break;
    }
    if (consumedThisBatch === 0) {
      break;
    }
  }

  let sameFileAdjacent = 0;
  for (let index = 1; index < served.length; index += 1) {
    if (bundle.fileOrdinalByTrack[served[index]!] === bundle.fileOrdinalByTrack[served[index - 1]!]) {
      sameFileAdjacent += 1;
    }
  }
  const files = new Set<number>();
  for (const ordinal of served) {
    files.add(bundle.fileOrdinalByTrack[ordinal]!);
  }

  return {
    distinctServed: served.length,
    sameFileAdjacent,
    duplicates,
    distinctFiles: files.size,
    cappedOut,
    refills,
  };
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index]!;
}

export interface StationSummary {
  label: string;
  stations: number;
  distinctServedMedian: number;
  distinctServedP10: number;
  distinctServedP90: number;
  distinctServedMean: number;
  distinctServedMin: number;
  distinctServedMax: number;
  stationsUnder500: number;
  stationsUnder5000: number;
  stationsUnder20000: number;
  stationsAtCap: number;
  sameFileAdjacentTotal: number;
  sameFileAdjacentRate: number;
  duplicatesTotal: number;
}

export function summarise(label: string, runs: StationRun[]): StationSummary {
  const lengths = runs.map((run) => run.distinctServed).sort((left, right) => left - right);
  let total = 0;
  let sameFileAdjacentTotal = 0;
  let adjacentPairs = 0;
  let duplicatesTotal = 0;
  let stationsAtCap = 0;
  for (const run of runs) {
    total += run.distinctServed;
    sameFileAdjacentTotal += run.sameFileAdjacent;
    adjacentPairs += Math.max(0, run.distinctServed - 1);
    duplicatesTotal += run.duplicates;
    if (run.cappedOut) {
      stationsAtCap += 1;
    }
  }
  return {
    label,
    stations: runs.length,
    distinctServedMedian: quantile(lengths, 0.5),
    distinctServedP10: quantile(lengths, 0.1),
    distinctServedP90: quantile(lengths, 0.9),
    distinctServedMean: runs.length === 0 ? 0 : total / runs.length,
    distinctServedMin: lengths[0] ?? 0,
    distinctServedMax: lengths[lengths.length - 1] ?? 0,
    stationsUnder500: lengths.filter((length) => length < 500).length,
    stationsUnder5000: lengths.filter((length) => length < 5_000).length,
    stationsUnder20000: lengths.filter((length) => length < 20_000).length,
    stationsAtCap,
    sameFileAdjacentTotal,
    sameFileAdjacentRate: adjacentPairs === 0 ? 0 : sameFileAdjacentTotal / adjacentPairs,
    duplicatesTotal,
  };
}

export function formatSummary(summary: StationSummary): string {
  const share = (count: number): string =>
    `${((count / Math.max(summary.stations, 1)) * 100).toFixed(1)}%`;
  return [
    `=== ${summary.label} ===`,
    `stations sampled ${summary.stations}`,
    `distinct tracks served: median ${summary.distinctServedMedian},`
    + ` p10 ${summary.distinctServedP10}, p90 ${summary.distinctServedP90},`
    + ` mean ${summary.distinctServedMean.toFixed(0)},`
    + ` range ${summary.distinctServedMin}..${summary.distinctServedMax}`,
    `stations under 500 tracks ${summary.stationsUnder500} (${share(summary.stationsUnder500)}),`
    + ` under 5000 ${summary.stationsUnder5000} (${share(summary.stationsUnder5000)}),`
    + ` under 20000 ${summary.stationsUnder20000} (${share(summary.stationsUnder20000)}),`
    + ` reached the cap ${summary.stationsAtCap}`,
    `same-file adjacency ${summary.sameFileAdjacentTotal} pairs`
    + ` (${(summary.sameFileAdjacentRate * 100).toFixed(3)}% of consecutive pairs)`,
    `duplicate tracks within a station ${summary.duplicatesTotal}`,
  ].join("\n");
}
