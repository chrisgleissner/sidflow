/**
 * The structural measurements that decide whether an exported neighbour graph is a usable
 * proximity index.
 *
 * These are separated from the CLI in `analyse.ts` so that the alpha sweep and the release
 * gate can compute the same numbers from an in-memory graph without writing a bundle first.
 *
 * ## What each metric is for
 *
 * - **Degree** says whether the graph wastes its slot budget, and whether a few tracks have
 *   become everyone's neighbour. A track with no incoming edge can never be recommended by
 *   anything; a track with no outgoing edge is where a walk stops.
 * - **Connectivity** says whether the corpus is one navigable region or several. Measured
 *   undirected, because a station that can traverse reverse edges — `c64commander` does —
 *   moves in both directions.
 * - **Reciprocity** is the symptom of keeping the *k* nearest neighbours when *k* is small:
 *   A points at B and B points back at A, so the pair is a trap rather than a route.
 * - **Greedy routing recall** is the standard test of a proximity index and the one metric
 *   that directly answers "can this graph find things". A top-*k* graph fails it; a
 *   diversified graph passes it.
 * - **Same-file rate** is a listener-facing defect rather than a structural one: a neighbour
 *   that is another subsong of the same `.sid` file is the same tune again.
 */

import { similarityBetween, type WeightedVectors } from "./full-export.js";

export interface NeighbourGraph {
  trackCount: number;
  neighboursPerTrack: number;
  /** `trackCount * neighboursPerTrack` target ordinals in slot order, `-1` for an empty slot. */
  targets: Int32Array;
  /** Similarity per slot, `NaN` for an empty slot. */
  similarities: Float64Array;
  /** File ordinal per track, so same-file edges can be counted. */
  fileOrdinalByTrack: Int32Array;
}

export interface DegreeMetrics {
  outDegreeMean: number;
  outDegreeZero: number;
  slotsUsed: number;
  slotsTotal: number;
  inDegreeMean: number;
  inDegreeMedian: number;
  inDegreeMax: number;
  inDegreeP99: number;
  inDegreeZero: number;
  inDegreeZeroFraction: number;
  /** Largest in-degree as a multiple of the mean. The hubness headline. */
  inDegreeMaxOverMean: number;
}

export function measureDegrees(graph: NeighbourGraph): DegreeMetrics {
  const { trackCount, neighboursPerTrack, targets } = graph;
  const inDegree = new Int32Array(trackCount);
  const outDegree = new Int32Array(trackCount);
  let slotsUsed = 0;
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      slotsUsed += 1;
      outDegree[track]! += 1;
      inDegree[target]! += 1;
    }
  }
  const sortedInDegree = Int32Array.from(inDegree).sort();
  let inDegreeZero = 0;
  let outDegreeZero = 0;
  for (let track = 0; track < trackCount; track += 1) {
    if (inDegree[track] === 0) {
      inDegreeZero += 1;
    }
    if (outDegree[track] === 0) {
      outDegreeZero += 1;
    }
  }
  const inDegreeMean = slotsUsed / trackCount;
  return {
    outDegreeMean: slotsUsed / trackCount,
    outDegreeZero,
    slotsUsed,
    slotsTotal: trackCount * neighboursPerTrack,
    inDegreeMean,
    inDegreeMedian: sortedInDegree[Math.floor(trackCount / 2)]!,
    inDegreeMax: sortedInDegree[trackCount - 1]!,
    inDegreeP99: sortedInDegree[Math.floor(trackCount * 0.99)]!,
    inDegreeZero,
    inDegreeZeroFraction: inDegreeZero / trackCount,
    inDegreeMaxOverMean: inDegreeMean === 0 ? 0 : sortedInDegree[trackCount - 1]! / inDegreeMean,
  };
}

export interface ConnectivityMetrics {
  componentCount: number;
  largestComponent: number;
  largestComponentFraction: number;
  /** Tracks in a component of fewer than 100 tracks — pockets a station cannot escape. */
  tracksInSmallComponents: number;
}

/** Undirected connected components by union-find. */
export function measureConnectivity(graph: NeighbourGraph): ConnectivityMetrics {
  const { trackCount, neighboursPerTrack, targets } = graph;
  const parent = new Int32Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    parent[track] = track;
  }
  const find = (node: number): number => {
    let root = node;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    let walk = node;
    while (parent[walk] !== root) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      const left = find(track);
      const right = find(target);
      if (left !== right) {
        parent[left] = right;
      }
    }
  }
  const size = new Int32Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    size[find(track)]! += 1;
  }
  let componentCount = 0;
  let largestComponent = 0;
  let tracksInSmallComponents = 0;
  for (let track = 0; track < trackCount; track += 1) {
    const count = size[track]!;
    if (count === 0) {
      continue;
    }
    componentCount += 1;
    if (count > largestComponent) {
      largestComponent = count;
    }
    if (count < 100) {
      tracksInSmallComponents += count;
    }
  }
  return {
    componentCount,
    largestComponent,
    largestComponentFraction: largestComponent / trackCount,
    tracksInSmallComponents,
  };
}

/** Fraction of directed edges `(u,v)` for which `(v,u)` is also present. */
export function measureReciprocity(graph: NeighbourGraph): number {
  const { trackCount, neighboursPerTrack, targets } = graph;
  const keys: number[] = [];
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      keys.push((track * trackCount) + target);
    }
  }
  if (keys.length === 0) {
    return 0;
  }
  const sorted = Float64Array.from(keys).sort();
  const contains = (key: number): boolean => {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const value = sorted[middle]!;
      if (value === key) {
        return true;
      }
      if (value < key) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return false;
  };
  let reciprocated = 0;
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      if (contains((target * trackCount) + track)) {
        reciprocated += 1;
      }
    }
  }
  return reciprocated / keys.length;
}

export interface SameFileMetrics {
  /** Same-file rate for slot 0. */
  slot0: number;
  /** Same-file rate over every populated slot. */
  allSlots: number;
  /** Tracks whose every populated edge points into their own file. */
  tracksEntirelySameFile: number;
}

export function measureSameFile(graph: NeighbourGraph): SameFileMetrics {
  const { trackCount, neighboursPerTrack, targets, fileOrdinalByTrack } = graph;
  let slot0Same = 0;
  let slot0Total = 0;
  let allSame = 0;
  let allTotal = 0;
  let tracksEntirelySameFile = 0;
  for (let track = 0; track < trackCount; track += 1) {
    const file = fileOrdinalByTrack[track]!;
    let populated = 0;
    let same = 0;
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      populated += 1;
      const isSame = fileOrdinalByTrack[target] === file;
      if (isSame) {
        same += 1;
      }
      allTotal += 1;
      if (isSame) {
        allSame += 1;
      }
      if (slot === 0) {
        slot0Total += 1;
        if (isSame) {
          slot0Same += 1;
        }
      }
    }
    if (populated > 0 && same === populated) {
      tracksEntirelySameFile += 1;
    }
  }
  return {
    slot0: slot0Total === 0 ? 0 : slot0Same / slot0Total,
    allSlots: allTotal === 0 ? 0 : allSame / allTotal,
    tracksEntirelySameFile,
  };
}

export interface RoutingMetrics {
  queries: number;
  recallAt1: number;
  meanHops: number;
  maxHops: number;
  /** Queries whose greedy walk never left its entry point. */
  strandedAtEntry: number;
}

/**
 * Greedy routing recall: the test that says whether the graph can be searched.
 *
 * From a random entry point, repeatedly step to the neighbour closest to the query and stop
 * when no neighbour improves. Success means landing on the query's true nearest neighbour.
 *
 * The query is treated as absent from the index — it is skipped wherever it appears as a
 * neighbour — because the query is itself a corpus point and a walk that is allowed to land
 * on it would measure nothing. That is the ordinary leave-one-out form of this test.
 *
 * Both forward and reverse edges are followed, because that is what the consumer does and
 * because a directed-only walk on a 3-out-degree graph measures the out-degree rather than
 * the index.
 */
export function measureGreedyRouting(
  graph: NeighbourGraph,
  vectors: WeightedVectors,
  queries: Int32Array,
  trueNearest: Int32Array,
  options: { followReverseEdges?: boolean } = {},
): RoutingMetrics {
  const { trackCount, neighboursPerTrack, targets } = graph;
  const adjacency = options.followReverseEdges === false
    ? null
    : buildUndirectedAdjacency(graph);

  let hits = 0;
  let totalHops = 0;
  let maxHops = 0;
  let strandedAtEntry = 0;

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!;
    // A deterministic entry point per query, derived from the query itself so the sample is
    // reproducible without threading a PRNG through the walk.
    let current = (Math.imul(query ^ 0x9e_37_79_b9, 0x85_eb_ca_6b) >>> 0) % trackCount;
    if (current === query) {
      current = (current + 1) % trackCount;
    }
    let best = similarityBetween(vectors, query, current);
    let hops = 0;
    for (;;) {
      let bestNext = -1;
      let bestNextSimilarity = best;
      if (adjacency) {
        const start = adjacency.offsets[current]!;
        const end = adjacency.offsets[current + 1]!;
        for (let edge = start; edge < end; edge += 1) {
          const candidate = adjacency.targets[edge]!;
          if (candidate === query) {
            continue;
          }
          const similarity = similarityBetween(vectors, query, candidate);
          if (similarity > bestNextSimilarity) {
            bestNextSimilarity = similarity;
            bestNext = candidate;
          }
        }
      } else {
        for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
          const candidate = targets[(current * neighboursPerTrack) + slot]!;
          if (candidate < 0 || candidate === query) {
            continue;
          }
          const similarity = similarityBetween(vectors, query, candidate);
          if (similarity > bestNextSimilarity) {
            bestNextSimilarity = similarity;
            bestNext = candidate;
          }
        }
      }
      if (bestNext < 0) {
        break;
      }
      current = bestNext;
      best = bestNextSimilarity;
      hops += 1;
    }
    if (hops === 0) {
      strandedAtEntry += 1;
    }
    totalHops += hops;
    if (hops > maxHops) {
      maxHops = hops;
    }
    if (current === trueNearest[index]) {
      hits += 1;
    }
  }

  return {
    queries: queries.length,
    recallAt1: queries.length === 0 ? 0 : hits / queries.length,
    meanHops: queries.length === 0 ? 0 : totalHops / queries.length,
    maxHops,
    strandedAtEntry,
  };
}

interface UndirectedAdjacency {
  offsets: Int32Array;
  targets: Int32Array;
}

/** CSR adjacency over forward and reverse edges, deduplicated. */
export function buildUndirectedAdjacency(graph: NeighbourGraph): UndirectedAdjacency {
  const { trackCount, neighboursPerTrack, targets } = graph;
  const counts = new Int32Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      counts[track]! += 1;
      counts[target]! += 1;
    }
  }
  const offsets = new Int32Array(trackCount + 1);
  for (let track = 0; track < trackCount; track += 1) {
    offsets[track + 1] = offsets[track]! + counts[track]!;
  }
  const flat = new Int32Array(offsets[trackCount]!);
  const cursor = Int32Array.from(offsets.subarray(0, trackCount));
  for (let track = 0; track < trackCount; track += 1) {
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = targets[(track * neighboursPerTrack) + slot]!;
      if (target < 0) {
        continue;
      }
      flat[cursor[track]!] = target;
      cursor[track]! += 1;
      flat[cursor[target]!] = track;
      cursor[target]! += 1;
    }
  }
  return { offsets, targets: flat };
}

export interface Slot0WalkMetrics {
  /** Attractor cycles found by following slot 0 as a function. */
  attractorCount: number;
  attractorLengthHistogram: Record<number, number>;
  /** Distinct tracks a slot-0 walk hears before its first repeat, median over the corpus. */
  distinctBeforeRepeatMedian: number;
  distinctBeforeRepeatMean: number;
}

/**
 * Treat slot 0 as a function and find where a "always play the closest match" walk ends up.
 *
 * This is the measurement behind the claim that a top-*k* graph traps a listener: on the
 * published full export every attractor has length 2, so the walk reaches a pair of tracks
 * that point at each other and stays there.
 */
export function measureSlot0Walk(graph: NeighbourGraph): Slot0WalkMetrics {
  const { trackCount, neighboursPerTrack, targets } = graph;
  const next = new Int32Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    next[track] = targets[track * neighboursPerTrack]!;
  }

  const colour = new Uint8Array(trackCount); // 0 unseen, 1 on the current path, 2 settled
  const cycleIdByTrack = new Int32Array(trackCount).fill(-1);
  const cycleLengths: number[] = [];
  const onCycle = new Uint8Array(trackCount);

  for (let start = 0; start < trackCount; start += 1) {
    if (colour[start] !== 0) {
      continue;
    }
    const path: number[] = [];
    let node = start;
    while (node >= 0 && colour[node] === 0) {
      colour[node] = 1;
      path.push(node);
      node = next[node]!;
    }
    if (node >= 0 && colour[node] === 1) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart);
      const cycleId = cycleLengths.length;
      cycleLengths.push(cycle.length);
      for (const member of cycle) {
        onCycle[member] = 1;
        cycleIdByTrack[member] = cycleId;
      }
    }
    for (const member of path) {
      colour[member] = 2;
    }
  }

  // Tail length: how many distinct tracks precede the attractor.
  const tail = new Int32Array(trackCount).fill(-1);
  const cycleIdOfWalk = Int32Array.from(cycleIdByTrack);
  for (let start = 0; start < trackCount; start += 1) {
    if (tail[start] >= 0) {
      continue;
    }
    const stack: number[] = [];
    let node = start;
    while (node >= 0 && tail[node] < 0 && onCycle[node] === 0) {
      stack.push(node);
      node = next[node]!;
    }
    let base: number;
    let cycleId: number;
    if (node < 0) {
      base = 0;
      cycleId = -1;
    } else if (onCycle[node] === 1) {
      base = 0;
      cycleId = cycleIdByTrack[node]!;
    } else {
      base = tail[node]!;
      cycleId = cycleIdOfWalk[node]!;
    }
    while (stack.length > 0) {
      const member = stack.pop()!;
      base += 1;
      tail[member] = base;
      cycleIdOfWalk[member] = cycleId;
    }
    if (onCycle[start] === 1) {
      tail[start] = 0;
    }
  }

  const distinct = new Int32Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    const cycleId = cycleIdOfWalk[track]!;
    const cycleLength = cycleId >= 0 ? cycleLengths[cycleId]! : 0;
    distinct[track] = Math.max(tail[track]!, 0) + cycleLength;
  }
  const sorted = Int32Array.from(distinct).sort();
  let total = 0;
  for (const value of distinct) {
    total += value;
  }
  const histogram: Record<number, number> = {};
  for (const length of cycleLengths) {
    histogram[length] = (histogram[length] ?? 0) + 1;
  }

  return {
    attractorCount: cycleLengths.length,
    attractorLengthHistogram: histogram,
    distinctBeforeRepeatMedian: sorted[Math.floor(trackCount / 2)]!,
    distinctBeforeRepeatMean: total / trackCount,
  };
}

export interface SlotSimilarityMetrics {
  /** Mean similarity per slot, over populated slots only. */
  meanBySlot: number[];
  /** Fraction of rows whose similarities are not in descending order. */
  rowsNotDescending: number;
}

export function measureSlotSimilarity(graph: NeighbourGraph): SlotSimilarityMetrics {
  const { trackCount, neighboursPerTrack, targets, similarities } = graph;
  const totals = new Float64Array(neighboursPerTrack);
  const counts = new Int32Array(neighboursPerTrack);
  let rowsNotDescending = 0;
  for (let track = 0; track < trackCount; track += 1) {
    let previous = Number.POSITIVE_INFINITY;
    let descending = true;
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const index = (track * neighboursPerTrack) + slot;
      if (targets[index]! < 0) {
        continue;
      }
      const similarity = similarities[index]!;
      if (Number.isFinite(similarity)) {
        totals[slot]! += similarity;
        counts[slot]! += 1;
        if (similarity > previous) {
          descending = false;
        }
        previous = similarity;
      }
    }
    if (!descending) {
      rowsNotDescending += 1;
    }
  }
  return {
    meanBySlot: Array.from({ length: neighboursPerTrack }, (_, slot) =>
      (counts[slot] === 0 ? Number.NaN : totals[slot]! / counts[slot]!)),
    rowsNotDescending: rowsNotDescending / trackCount,
  };
}

export interface GraphAnalysis {
  label: string;
  trackCount: number;
  neighboursPerTrack: number;
  graphFlags?: number;
  degrees: DegreeMetrics;
  connectivity: ConnectivityMetrics;
  reciprocity: number;
  sameFile: SameFileMetrics;
  slot0Walk: Slot0WalkMetrics;
  slotSimilarity: SlotSimilarityMetrics;
  routing?: RoutingMetrics;
}

/** Run every structural measurement over a graph. */
export function analyseGraph(
  label: string,
  graph: NeighbourGraph,
  options: {
    vectors?: WeightedVectors;
    queries?: Int32Array;
    trueNearest?: Int32Array;
    graphFlags?: number;
  } = {},
): GraphAnalysis {
  const analysis: GraphAnalysis = {
    label,
    trackCount: graph.trackCount,
    neighboursPerTrack: graph.neighboursPerTrack,
    graphFlags: options.graphFlags,
    degrees: measureDegrees(graph),
    connectivity: measureConnectivity(graph),
    reciprocity: measureReciprocity(graph),
    sameFile: measureSameFile(graph),
    slot0Walk: measureSlot0Walk(graph),
    slotSimilarity: measureSlotSimilarity(graph),
  };
  if (options.vectors && options.queries && options.trueNearest) {
    analysis.routing = measureGreedyRouting(graph, options.vectors, options.queries, options.trueNearest);
  }
  return analysis;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatAnalysis(analysis: GraphAnalysis): string {
  const lines: string[] = [];
  lines.push(`=== ${analysis.label} ===`);
  lines.push(`tracks ${analysis.trackCount}, slots per track ${analysis.neighboursPerTrack}`);
  if (analysis.graphFlags !== undefined) {
    lines.push(`graph_flags 0x${analysis.graphFlags.toString(16).padStart(4, "0")}`);
  }
  const { degrees, connectivity, sameFile, slot0Walk, slotSimilarity, routing } = analysis;
  lines.push("");
  lines.push("-- degree --");
  lines.push(
    `out-degree mean ${degrees.outDegreeMean.toFixed(3)} of ${analysis.neighboursPerTrack}`
    + ` (${degrees.slotsUsed} of ${degrees.slotsTotal} slots used)`,
  );
  lines.push(`tracks with no outgoing edge ${degrees.outDegreeZero}`);
  lines.push(
    `tracks with no incoming edge ${degrees.inDegreeZero} (${percent(degrees.inDegreeZeroFraction)})`,
  );
  lines.push(
    `in-degree mean ${degrees.inDegreeMean.toFixed(2)}, median ${degrees.inDegreeMedian},`
    + ` p99 ${degrees.inDegreeP99}, max ${degrees.inDegreeMax}`
    + ` (${degrees.inDegreeMaxOverMean.toFixed(1)}x mean)`,
  );
  lines.push("");
  lines.push("-- connectivity (undirected) --");
  lines.push(
    `${connectivity.componentCount} components, largest ${connectivity.largestComponent}`
    + ` (${percent(connectivity.largestComponentFraction)}),`
    + ` ${connectivity.tracksInSmallComponents} tracks in components under 100`,
  );
  lines.push("");
  lines.push("-- reciprocity --");
  lines.push(`${percent(analysis.reciprocity)} of directed edges are reciprocated`);
  lines.push("");
  lines.push("-- slot-0 walk (always play the first slot) --");
  lines.push(
    `${slot0Walk.attractorCount} attractors, lengths `
    + `${Object.entries(slot0Walk.attractorLengthHistogram)
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .slice(0, 8)
      .map(([length, count]) => `${length}x${count}`)
      .join(" ")}`,
  );
  lines.push(
    `distinct tracks before the first repeat: median ${slot0Walk.distinctBeforeRepeatMedian},`
    + ` mean ${slot0Walk.distinctBeforeRepeatMean.toFixed(1)}`,
  );
  lines.push("");
  lines.push("-- same .sid file --");
  lines.push(
    `slot 0 ${percent(sameFile.slot0)}, all slots ${percent(sameFile.allSlots)},`
    + ` ${sameFile.tracksEntirelySameFile} tracks whose every edge stays in their own file`,
  );
  lines.push("");
  lines.push("-- similarity per slot --");
  lines.push(
    slotSimilarity.meanBySlot
      .map((mean, slot) => `slot ${slot} ${Number.isNaN(mean) ? "n/a" : mean.toFixed(4)}`)
      .join(", "),
  );
  lines.push(`rows not in descending similarity order: ${percent(slotSimilarity.rowsNotDescending)}`);
  if (routing) {
    lines.push("");
    lines.push("-- greedy routing (leave-one-out, forward and reverse edges) --");
    lines.push(
      `recall@1 ${percent(routing.recallAt1)} over ${routing.queries} queries,`
      + ` mean ${routing.meanHops.toFixed(1)} hops, max ${routing.maxHops},`
      + ` ${routing.strandedAtEntry} stranded at the entry point`,
    );
  }
  return lines.join("\n");
}

/** Keep only the first `width` slots of each row. */
export function truncate(graph: NeighbourGraph, width: number): NeighbourGraph {
  if (width >= graph.neighboursPerTrack) {
    return graph;
  }
  const targets = new Int32Array(graph.trackCount * width);
  const similarities = new Float64Array(graph.trackCount * width);
  for (let track = 0; track < graph.trackCount; track += 1) {
    for (let slot = 0; slot < width; slot += 1) {
      targets[(track * width) + slot] = graph.targets[(track * graph.neighboursPerTrack) + slot]!;
      similarities[(track * width) + slot] = graph.similarities[(track * graph.neighboursPerTrack) + slot]!;
    }
  }
  return {
    trackCount: graph.trackCount,
    neighboursPerTrack: width,
    targets,
    similarities,
    fileOrdinalByTrack: graph.fileOrdinalByTrack,
  };
}
