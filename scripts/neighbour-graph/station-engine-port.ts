/**
 * A port of `c64commander`'s station engine, so the export side can measure what a listener
 * actually gets.
 *
 * ## Why this exists here
 *
 * The graph metrics in `graph-metrics.ts` say whether the exported graph is a good proximity
 * index. They do not say how many tunes a station plays, and the two came apart badly: the
 * 0.8.2 bundle raised the reachable stream from 17 tracks to 43,934 and the station it fed
 * still served about a thousand. Nothing in `sidflow` measured that, so the regression was
 * invisible from this side of the release.
 *
 * ## Fidelity, and where it stops
 *
 * This is a port, not a re-implementation: the constants, the traversal, the scoring, the
 * widening loop, the not-for-me penalty and the weighted permutation all follow
 * `src/lib/sidRadio/stationEngine.ts`. Where it deliberately differs:
 *
 * - Seeds and identities are track ordinals and file ordinals rather than `md5_48` strings.
 *   A file ordinal in the tiny bundle is one `.sid` file, which is exactly what an `md5_48`
 *   identifies, so `trackOrdinalsForMd548` becomes "the tracks of this file ordinal".
 * - There is no path resolution and no duration filter. Both need an HVSC checkout and the
 *   songlengths index; both only ever *remove* candidates, so omitting them measures the
 *   station's ceiling. A real station serves no more than this, and the numbers here are
 *   therefore an upper bound on what a listener gets, which is the safe direction for a
 *   measurement whose purpose is to show a station is too short.
 *
 * If the client engine changes, this port must change with it, and the station numbers in
 * `doc/neighbour-graph-design.md` must be re-measured. That coupling is the price of being
 * able to measure the product from the artefact side at all.
 */

export const NEIGHBORS_PER_TRACK = 3;
export const BASE_SEED_WEIGHT = 1;
export const LIKE_BOOST = 1.6;
export const REVERSE_EDGE_WEIGHT = 2;
export const HOP_DECAY = 0.7;
export const MAX_HOPS = 3;
export const EXTENDED_MAX_HOPS = 8;
export const SUFFICIENCY_FACTOR = 3;
export const FRONTIER_CAP = 256;
export const NOT_FOR_ME_PENALTY = 2.5;
export const STYLE_SEED_SAMPLE = 32;
export const TASTE_SEED_SAMPLE = 16;
export const REFILL_BATCH = 24;

export interface StationBundle {
  trackCount: number;
  neighborsPerTrack: number;
  /** `trackCount * neighborsPerTrack`, `-1` for an empty slot. */
  targets: Int32Array;
  fileOrdinalByTrack: Int32Array;
  styleMaskByTrack: Uint16Array;
  /** CSR reverse index: sources that point at a given track. */
  reverseOffsets: Int32Array;
  reverseSources: Int32Array;
  /** Track ordinals per file ordinal, for sibling lookup. */
  fileTrackStart: Int32Array;
  fileTrackCount: Int32Array;
}

export function buildStationBundle(input: {
  trackCount: number;
  neighborsPerTrack: number;
  targets: Int32Array;
  fileOrdinalByTrack: Int32Array;
  styleMaskByTrack: Uint16Array;
}): StationBundle {
  const { trackCount, neighborsPerTrack, targets, fileOrdinalByTrack, styleMaskByTrack } = input;

  const inDegree = new Int32Array(trackCount);
  for (let slot = 0; slot < targets.length; slot += 1) {
    const target = targets[slot]!;
    if (target >= 0) {
      inDegree[target]! += 1;
    }
  }
  const reverseOffsets = new Int32Array(trackCount + 1);
  for (let track = 0; track < trackCount; track += 1) {
    reverseOffsets[track + 1] = reverseOffsets[track]! + inDegree[track]!;
  }
  const reverseSources = new Int32Array(reverseOffsets[trackCount]!);
  const cursor = Int32Array.from(reverseOffsets.subarray(0, trackCount));
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighborsPerTrack; slot += 1) {
      const target = targets[(track * neighborsPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      reverseSources[cursor[target]!] = track;
      cursor[target]! += 1;
    }
  }

  let fileCount = 0;
  for (let track = 0; track < trackCount; track += 1) {
    const fileOrdinal = fileOrdinalByTrack[track]!;
    if (fileOrdinal + 1 > fileCount) {
      fileCount = fileOrdinal + 1;
    }
  }
  const fileTrackCount = new Int32Array(fileCount);
  for (let track = 0; track < trackCount; track += 1) {
    fileTrackCount[fileOrdinalByTrack[track]!]! += 1;
  }
  const fileTrackStart = new Int32Array(fileCount);
  let running = 0;
  for (let fileOrdinal = 0; fileOrdinal < fileCount; fileOrdinal += 1) {
    fileTrackStart[fileOrdinal] = running;
    running += fileTrackCount[fileOrdinal]!;
  }

  return {
    trackCount,
    neighborsPerTrack,
    targets,
    fileOrdinalByTrack,
    styleMaskByTrack,
    reverseOffsets,
    reverseSources,
    fileTrackStart,
    fileTrackCount,
  };
}

/** Every track ordinal belonging to the same `.sid` file — the `md5_48` siblings. */
export function siblingsOf(bundle: StationBundle, trackOrdinal: number): number[] {
  const fileOrdinal = bundle.fileOrdinalByTrack[trackOrdinal]!;
  const start = bundle.fileTrackStart[fileOrdinal]!;
  const count = bundle.fileTrackCount[fileOrdinal]!;
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(start + index);
  }
  return out;
}

const hashSeed = (a: number, b: number): number => {
  let h = (2_166_136_261 ^ (a >>> 0)) >>> 0;
  h = Math.imul(h, 16_777_619) >>> 0;
  h = (h ^ (b >>> 0)) >>> 0;
  h = Math.imul(h, 16_777_619) >>> 0;
  return h >>> 0;
};

/** Deterministic per-(shuffleSeed, ordinal) uniform in (0,1). Matches the client exactly. */
export const perOrdinalRandom = (shuffleSeed: number, ordinal: number): number => {
  const t = (hashSeed(shuffleSeed, ordinal) + 0x6d_2b_79_f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
};

export type StationSeedKind = "song" | "style" | "taste";

export interface StationSeed {
  kind: StationSeedKind;
  /** Song seed: the file ordinal to start from (the `md5_48` stand-in). */
  fileOrdinal?: number;
  /** Style seed: the style-mask bit to draw the broad seed pool from. */
  styleBit?: number;
}

export interface StationEngineOptions {
  bundle: StationBundle;
  seed: StationSeed;
  styleFilter?: number | null;
  /** Track ordinals the listener liked. */
  likes?: readonly number[];
  /** Track ordinals the listener rejected. */
  notForMe?: readonly number[];
  shuffleSeed: number;
  exclude?: Iterable<number>;
  limit?: number;
  /**
   * Extra seeds with explicit weights — the drifting query.
   *
   * The client engine has no such parameter today; it is modelled here so the policy can be
   * measured before it is written. Everything else in this port matches the shipped engine.
   */
  extraSeeds?: ReadonlyArray<{ trackOrdinal: number; weight: number }>;
  /** Cap on hops. Defaults to the client's EXTENDED_MAX_HOPS. */
  maxHops?: number;
}

export interface StationResult {
  candidates: number[];
  empty?: "no-neighbours" | "exhausted";
}

const sampleStyleOrdinals = (
  bundle: StationBundle,
  styleBit: number,
  shuffleSeed: number,
  count: number,
): number[] => {
  const mask = 1 << styleBit;
  const keyed: Array<{ ordinal: number; key: number }> = [];
  for (let ordinal = 0; ordinal < bundle.trackCount; ordinal += 1) {
    if ((bundle.styleMaskByTrack[ordinal]! & mask) === 0) {
      continue;
    }
    keyed.push({ ordinal, key: perOrdinalRandom(shuffleSeed, ordinal) });
  }
  keyed.sort((left, right) => left.key - right.key || left.ordinal - right.ordinal);
  return keyed.slice(0, count).map((entry) => entry.ordinal);
};

const diversitySample = (ordinals: readonly number[], shuffleSeed: number, count: number): number[] => {
  if (ordinals.length <= count) {
    return [...ordinals];
  }
  return ordinals
    .map((ordinal) => ({ ordinal, key: perOrdinalRandom(shuffleSeed, ordinal) }))
    .sort((left, right) => left.key - right.key || left.ordinal - right.ordinal)
    .slice(0, count)
    .map((entry) => entry.ordinal);
};

const capFrontier = (frontier: Map<number, number>, cap: number): Map<number, number> => {
  if (frontier.size <= cap) {
    return frontier;
  }
  const top = [...frontier.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, cap);
  return new Map(top);
};

export function computeStation(options: StationEngineOptions): StationResult {
  const { bundle, seed, shuffleSeed } = options;
  const neighborsPerTrack = bundle.neighborsPerTrack;
  const styleFilter = options.styleFilter ?? null;
  const limit = options.limit ?? 200;
  const exclude = new Set<number>(options.exclude ?? []);
  const likeOrdinals = [...(options.likes ?? [])];
  const notForMeOrdinals = [...(options.notForMe ?? [])];
  const maxHops = options.maxHops ?? EXTENDED_MAX_HOPS;

  const seedStrength = new Map<number, number>();
  const primaryExclude = new Set<number>();
  const addSeed = (ordinal: number, weight: number): void => {
    seedStrength.set(ordinal, (seedStrength.get(ordinal) ?? 0) + weight);
  };

  if (seed.kind === "song") {
    if (seed.fileOrdinal === undefined) {
      return { candidates: [], empty: "no-neighbours" };
    }
    const start = bundle.fileTrackStart[seed.fileOrdinal];
    const count = bundle.fileTrackCount[seed.fileOrdinal];
    if (start === undefined || count === undefined || count === 0) {
      return { candidates: [], empty: "no-neighbours" };
    }
    for (let index = 0; index < count; index += 1) {
      addSeed(start + index, BASE_SEED_WEIGHT);
      primaryExclude.add(start + index);
    }
  } else if (seed.kind === "taste") {
    if (likeOrdinals.length === 0) {
      return { candidates: [], empty: "no-neighbours" };
    }
    for (const ordinal of diversitySample(likeOrdinals, shuffleSeed, TASTE_SEED_SAMPLE)) {
      addSeed(ordinal, BASE_SEED_WEIGHT);
      primaryExclude.add(ordinal);
    }
  } else {
    const styleBit = seed.styleBit ?? styleFilter ?? 0;
    const sample = sampleStyleOrdinals(bundle, styleBit, shuffleSeed, STYLE_SEED_SAMPLE);
    if (sample.length === 0 && likeOrdinals.length === 0) {
      return { candidates: [], empty: "no-neighbours" };
    }
    for (const ordinal of sample) {
      addSeed(ordinal, BASE_SEED_WEIGHT);
    }
  }

  if (seed.kind !== "taste") {
    const steerWeight = BASE_SEED_WEIGHT * (LIKE_BOOST - 1);
    for (const ordinal of likeOrdinals) {
      addSeed(ordinal, steerWeight);
    }
  }

  for (const extra of options.extraSeeds ?? []) {
    addSeed(extra.trackOrdinal, extra.weight);
  }

  const scores = new Map<number, number>();
  let frontier = new Map(seedStrength);
  const excludeForCount = new Set<number>(exclude);
  for (const ordinal of primaryExclude) {
    excludeForCount.add(ordinal);
  }
  for (const ordinal of notForMeOrdinals) {
    excludeForCount.add(ordinal);
  }
  const styleMaskBitForCount = styleFilter !== null ? 1 << styleFilter : 0;
  const admissible = (ordinal: number, score: number): boolean => {
    if (score <= 0 || excludeForCount.has(ordinal)) {
      return false;
    }
    if (styleFilter !== null && (bundle.styleMaskByTrack[ordinal]! & styleMaskBitForCount) === 0) {
      return false;
    }
    return true;
  };
  const enough = Math.max(limit, 1) * SUFFICIENCY_FACTOR;
  let hop = 0;
  while (hop < maxHops && frontier.size > 0) {
    const decay = Math.pow(HOP_DECAY, hop);
    const next = new Map<number, number>();
    const bump = (ordinal: number, weight: number): void => {
      scores.set(ordinal, (scores.get(ordinal) ?? 0) + weight);
      next.set(ordinal, (next.get(ordinal) ?? 0) + weight);
    };
    for (const [ordinal, strength] of frontier) {
      for (let slot = 0; slot < neighborsPerTrack; slot += 1) {
        const target = bundle.targets[(ordinal * neighborsPerTrack) + slot]!;
        if (target < 0) {
          continue;
        }
        bump(target, strength * (neighborsPerTrack - slot) * decay);
      }
      const start = bundle.reverseOffsets[ordinal]!;
      const end = bundle.reverseOffsets[ordinal + 1]!;
      for (let edge = start; edge < end; edge += 1) {
        bump(bundle.reverseSources[edge]!, strength * REVERSE_EDGE_WEIGHT * decay);
      }
    }
    frontier = capFrontier(next, FRONTIER_CAP);
    hop += 1;
    if (hop >= MAX_HOPS) {
      let admissibleCount = 0;
      for (const [ordinal, score] of scores) {
        if (admissible(ordinal, score)) {
          admissibleCount += 1;
          if (admissibleCount >= enough) {
            break;
          }
        }
      }
      if (admissibleCount >= enough) {
        break;
      }
    }
  }

  for (const ordinal of notForMeOrdinals) {
    for (let slot = 0; slot < neighborsPerTrack; slot += 1) {
      const target = bundle.targets[(ordinal * neighborsPerTrack) + slot]!;
      if (target >= 0 && scores.has(target)) {
        scores.set(target, (scores.get(target) ?? 0) - NOT_FOR_ME_PENALTY);
      }
    }
    const start = bundle.reverseOffsets[ordinal]!;
    const end = bundle.reverseOffsets[ordinal + 1]!;
    for (let edge = start; edge < end; edge += 1) {
      const source = bundle.reverseSources[edge]!;
      if (scores.has(source)) {
        scores.set(source, (scores.get(source) ?? 0) - NOT_FOR_ME_PENALTY);
      }
    }
  }

  const excludeAll = new Set<number>(exclude);
  for (const ordinal of primaryExclude) {
    excludeAll.add(ordinal);
  }
  for (const ordinal of notForMeOrdinals) {
    excludeAll.add(ordinal);
  }
  const styleMaskBit = styleFilter !== null ? 1 << styleFilter : 0;

  const admitted: Array<{ ordinal: number; score: number }> = [];
  for (const [ordinal, score] of scores) {
    if (score <= 0 || excludeAll.has(ordinal)) {
      continue;
    }
    if (styleFilter !== null && (bundle.styleMaskByTrack[ordinal]! & styleMaskBit) === 0) {
      continue;
    }
    admitted.push({ ordinal, score });
  }
  if (admitted.length === 0) {
    return { candidates: [], empty: "exhausted" };
  }

  const keyed = admitted.map(({ ordinal, score }) => ({
    ordinal,
    key: -Math.log(perOrdinalRandom(shuffleSeed, ordinal) + 1e-12) / Math.max(score, 1e-6),
  }));
  keyed.sort((left, right) => left.key - right.key || left.ordinal - right.ordinal);

  return { candidates: keyed.slice(0, limit).map((entry) => entry.ordinal) };
}
