/**
 * Build a navigable 3-degree proximity graph by Vamana construction.
 *
 * ## Why the pruning rule is not enough on its own
 *
 * `similarity-neighbour-selection.ts` applies DiskANN's alpha-pruning to each track's candidate
 * list. Given a candidate list, that is the right rule. The problem is the list: the source
 * export publishes each track's **25 nearest** neighbours, and measured over 400 sampled tracks
 * on the HVSC corpus those 25 all sit within a very narrow shell —
 *
 *     distance to rank 1     0.02832
 *     distance to rank 25    0.05190
 *     distance to a random track 0.24294
 *
 * — so every edge the pool can offer is five to nine times shorter than a typical distance in
 * the corpus. Mutual distance between two candidates averages 0.05526, slightly *more* than the
 * distance from the seed to its 25th neighbour, so the relative-neighbourhood rule almost never
 * fires: only 23.41% of candidates are dominated by an earlier one, and since three slots are
 * filled from the nearest end, pruning the top-25 pool changes almost nothing. Measured: the
 * pruned graph reciprocates 46.80% of its edges and greedy routing finds the true nearest
 * neighbour 0.10% of the time, against 0.30% for a plain top-3 graph.
 *
 * A graph whose every edge is short cannot be searched, whatever rule chose the edges. Greedy
 * routing needs edges that cross the space, and no selection over a top-*k* pool can produce
 * one because the pool contains none. This is the part of the design that the pruning rule
 * alone was expected to fix and does not.
 *
 * ## What Vamana does differently
 *
 * DiskANN/Vamana does not prune a top-*k* list. It generates each point's candidate set by
 * running a **greedy search for that point over the graph being built**, starting from a fixed
 * entry point near the centre of the data. The visited set of such a search contains the points
 * the search passed through on its way in — which are far from the query — as well as the ones
 * it converged on. Pruning that set therefore has long edges available to keep, and the
 * alpha rule keeps exactly the ones that are not redundant.
 *
 * The construction here is the published algorithm with two deliberate settings:
 *
 * - **Two passes**, the first at `alpha = 1` and the second at the configured alpha, as in the
 *   paper. The first pass builds a graph good enough for the second pass's searches to be
 *   meaningful.
 * - **`searchListSize` well above the degree.** With three slots the search itself is weak, so
 *   the beam is what supplies candidate diversity. It costs construction time and nothing at
 *   read time: the shipped artefact is still three edges per track.
 *
 * Nothing here is a reclassification: every distance comes from `tracks.vector_json` in the
 * published full export under the published weights, which
 * `scripts/neighbour-graph/verify-rank1-reproduction.ts` proves reproduces the export's own
 * rank-1 neighbour for every seed it checks.
 */

import {
  pruneCandidates,
  type NeighbourCandidate,
  type SelectionDistance,
} from "./similarity-neighbour-selection.js";

export interface VamanaBuildOptions {
  trackCount: number;
  neighboursPerTrack: number;
  /** Weighted cosine between two track ordinals. */
  similarityBetween: (left: number, right: number) => number;
  /**
   * Each track's nearest neighbours from the source export, used to initialise the graph so
   * the first pass's searches start from something better than random.
   */
  candidates: ReadonlyArray<ReadonlyArray<NeighbourCandidate>>;
  /** Diversification strength for the second pass. The first pass always runs at 1. */
  alpha: number;
  /** Beam width of the candidate-generating search. */
  searchListSize?: number;
  /** Selection distance, so a hubness correction can change which edges are chosen. */
  selectionDistance?: SelectionDistance;
  /** Construction passes. The paper uses 2; 1 is available for measurement. */
  passes?: number;
  /**
   * Give every track at least one incoming edge after construction.
   *
   * Vamana's reverse-insertion pass bounds in-degree and preserves reachability for tracks that
   * something already points at; it cannot create reachability for a track nothing chose, because
   * an unchosen track is offered no reverse edge. On the HVSC corpus the construction leaves
   * 22.98% of tracks with no incoming edge for that reason.
   *
   * The repair donates one edge to each such track from its own nearest neighbour, displacing
   * that donor's least similar edge — and only ever an edge whose target still has another
   * incoming edge, so the repair cannot create the problem it is fixing. Defaults to on.
   */
  repairUnreachable?: boolean;
  /**
   * Cap on how many other tracks may point at one track, as a multiple of the mean in-degree.
   *
   * Vamana bounds out-degree by construction — a row has `neighboursPerTrack` slots — and does
   * not bound in-degree at all. At the degrees DiskANN is normally run at that is harmless. At
   * three slots it is not: the construction's searches all start from one entry point and
   * converge through the same well-placed tracks, so those tracks end up in a large share of
   * everyone's three. Measured on the HVSC corpus at alpha 1.2, in-degree reaches 1,030 against
   * a mean of 3, which a listener experiences as the same handful of tunes in every station.
   *
   * The trim moves an over-subscribed track's weakest incoming edges onto the donor's next
   * acceptable neighbour. Set to 0 to disable it and measure without.
   */
  inDegreeCapMultiple?: number;
  /**
   * How many entry points the candidate-generating searches rotate over. Defaults to 1.
   *
   * **The default is 1, which is the published algorithm, and it is what every measurement in
   * `doc/neighbour-graph-design.md` was made with.** Rotation is implemented but not shipped.
   *
   * The hypothesis it exists to test is that a single entry point is the direct cause of the
   * in-degree concentration described above — every search enters the graph at the same place, so
   * the tracks on the way in from that place are passed through by all 87,868 searches — and that
   * rotating over spread entry points would spread the resulting in-degree over that many regions.
   * That is plausible and untested at corpus scale, so it is not the default. Sweep it with
   * `scripts/neighbour-graph/sweep-selection.ts --entry-points` before relying on it.
   *
   * The entry points are chosen by farthest-point traversal over a fixed sample, so they cover the
   * corpus rather than clustering.
   */
  entryPointCount?: number;
  /**
   * Slots reserved for the seed's own nearest neighbours, before diversification chooses the rest.
   *
   * Diversification is what makes the graph navigable and it is also what costs retrieval quality.
   * Measured on the HVSC corpus at alpha 1.5 with every slot diversified: nDCG@10 rises 14.35% over
   * the withdrawn 0.8.2 — slot 0 becomes a genuinely closer match than 0.8.2's flow successor was —
   * while composer lift falls 21.12%, because the remaining slots go to long edges that rarely share
   * a composer. A release guardrail of 5% relative makes that unshippable.
   *
   * Reserving the nearest slots is the standard answer, and the same one HNSW reaches for with
   * `keepPrunedConnections`: guarantee the near matches a neighbour table exists to provide, and
   * spend only the remainder on reach.
   */
  forcedNearestSlots?: number;
  /** Progress callback, called with a fraction in [0,1]. */
  onProgress?: (fraction: number, label: string) => void;
}

export interface VamanaBuildResult {
  /** Per-track rows in descending published similarity. */
  rows: Array<Array<NeighbourCandidate>>;
  /** The entry point the construction used, which is also the best entry for a reader. */
  medoid: number;
  stats: {
    /** Mean number of distinct points a candidate-generating search visited. */
    meanVisited: number;
    /** Mean distance of a kept edge, as `1 - similarity`. */
    meanEdgeDistance: number;
    /** Longest kept edge, as `1 - similarity`. */
    maxEdgeDistance: number;
    distanceEvaluations: number;
    /** Tracks with no incoming edge when construction finished, before the repair. */
    unreachableBeforeRepair: number;
    /** Tracks the repair gave an incoming edge. */
    repaired: number;
    /** Tracks the repair could not help, so they still have no incoming edge. */
    unreachableAfterRepair: number;
    /** Largest in-degree before hub trimming. */
    inDegreeMaxBeforeTrim: number;
    /** Largest in-degree after hub trimming. */
    inDegreeMaxAfterTrim: number;
    /** Edges the trim moved off an over-subscribed track. */
    trimmedEdges: number;
    /** How many entry points the searches rotated over. */
    entryPoints: number;
  };
}

const DEFAULT_SEARCH_LIST_SIZE = 96;

/** Deterministic 32-bit PRNG. Construction must be reproducible from the source export. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A fixed-capacity list of the closest points seen, kept sorted by distance.
 *
 * The visited set of the search is what the pruning rule consumes, so the beam has to retain
 * the points it passed through rather than only the winners. This keeps the best `capacity` of
 * them, which is the paper's `L`.
 */
class SearchBeam {
  private readonly ordinals: Int32Array;
  private readonly distances: Float64Array;
  private readonly expanded: Uint8Array;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.ordinals = new Int32Array(capacity);
    this.distances = new Float64Array(capacity);
    this.expanded = new Uint8Array(capacity);
  }

  insert(ordinal: number, distance: number): void {
    if (this.size === this.capacity && distance >= this.distances[this.size - 1]!) {
      return;
    }
    let position = this.size < this.capacity ? this.size : this.capacity - 1;
    while (position > 0 && this.distances[position - 1]! > distance) {
      this.ordinals[position] = this.ordinals[position - 1]!;
      this.distances[position] = this.distances[position - 1]!;
      this.expanded[position] = this.expanded[position - 1]!;
      position -= 1;
    }
    this.ordinals[position] = ordinal;
    this.distances[position] = distance;
    this.expanded[position] = 0;
    if (this.size < this.capacity) {
      this.size += 1;
    }
  }

  /** The closest entry not yet expanded, or -1. */
  nextUnexpanded(): number {
    for (let index = 0; index < this.size; index += 1) {
      if (this.expanded[index] === 0) {
        this.expanded[index] = 1;
        return this.ordinals[index]!;
      }
    }
    return -1;
  }

  /** Empty the beam without reallocating it. One search per track, 87,868 tracks per pass. */
  reset(): void {
    this.size = 0;
  }
}

/**
 * Pick the medoid by sampling.
 *
 * The entry point should sit near the middle of the data so a search from it crosses the space.
 * The exact medoid needs every pairwise distance; a sampled one is indistinguishable for this
 * purpose and deterministic.
 */
function findApproximateMedoid(
  trackCount: number,
  similarityBetween: (left: number, right: number) => number,
  sampleSize: number,
): number {
  const random = createRandom(20_260_730);
  const sample: number[] = [];
  for (let index = 0; index < Math.min(sampleSize, trackCount); index += 1) {
    sample.push(Math.floor(random() * trackCount));
  }
  let best = 0;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const candidate of sample) {
    let total = 0;
    for (const other of sample) {
      if (other !== candidate) {
        total += 1 - similarityBetween(candidate, other);
      }
    }
    if (total < bestTotal) {
      bestTotal = total;
      best = candidate;
    }
  }
  return best;
}

/**
 * Choose entry points that cover the corpus, by farthest-point traversal.
 *
 * Starting from the sampled medoid, each subsequent entry point is the sampled track furthest from
 * every entry point already chosen. That is the standard k-center greedy heuristic and it gives
 * spread rather than the clustering a random sample would.
 */
function chooseEntryPoints(
  trackCount: number,
  similarityBetween: (left: number, right: number) => number,
  count: number,
  medoid: number,
): Int32Array {
  if (count <= 1) {
    return Int32Array.of(medoid);
  }
  const random = createRandom(0x1d_5f_2c_9b);
  const pool: number[] = [];
  const seen = new Set<number>();
  const poolSize = Math.min(4_096, trackCount);
  while (pool.length < poolSize) {
    const candidate = Math.floor(random() * trackCount);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      pool.push(candidate);
    }
  }
  const chosen: number[] = [medoid];
  // Distance from each pool member to its nearest chosen entry point, updated incrementally.
  const nearest = pool.map((candidate) => 1 - similarityBetween(candidate, medoid));
  while (chosen.length < Math.min(count, poolSize)) {
    let best = -1;
    let bestDistance = -1;
    for (let index = 0; index < pool.length; index += 1) {
      if (nearest[index]! > bestDistance) {
        bestDistance = nearest[index]!;
        best = index;
      }
    }
    if (best < 0) {
      break;
    }
    const picked = pool[best]!;
    chosen.push(picked);
    nearest[best] = -1;
    for (let index = 0; index < pool.length; index += 1) {
      if (nearest[index]! < 0) {
        continue;
      }
      const distance = 1 - similarityBetween(pool[index]!, picked);
      if (distance < nearest[index]!) {
        nearest[index] = distance;
      }
    }
  }
  return Int32Array.from(chosen);
}

/**
 * Build the graph.
 *
 * Deterministic: the insertion order is a fixed permutation, the medoid is sampled with a fixed
 * seed, and every tie in pruning resolves on the lower track ordinal.
 */
export function buildNavigableNeighbourGraph(options: VamanaBuildOptions): VamanaBuildResult {
  const {
    trackCount,
    neighboursPerTrack,
    similarityBetween,
    candidates,
    alpha,
    searchListSize = DEFAULT_SEARCH_LIST_SIZE,
    passes = 2,
    forcedNearestSlots = 0,
  } = options;
  const distance: SelectionDistance = options.selectionDistance
    ?? ((left, right, similarity) => 1 - (similarity ?? similarityBetween(left, right)));

  let distanceEvaluations = 0;
  const distanceTo = (left: number, right: number): number => {
    distanceEvaluations += 1;
    return distance(left, right);
  };

  // Adjacency as a flat array with a per-track count, so construction does no allocation.
  const adjacency = new Int32Array(trackCount * neighboursPerTrack).fill(-1);
  const degree = new Int32Array(trackCount);

  // Initialise from the source export's nearest neighbours. Vamana initialises randomly; using
  // the known nearest neighbours instead makes the first pass's searches immediately useful and
  // costs nothing, because the second pass replaces every edge anyway.
  for (let track = 0; track < trackCount; track += 1) {
    const list = candidates[track] ?? [];
    let filled = 0;
    for (const candidate of list) {
      if (filled >= neighboursPerTrack) {
        break;
      }
      if (candidate.trackOrdinal === track) {
        continue;
      }
      adjacency[(track * neighboursPerTrack) + filled] = candidate.trackOrdinal;
      filled += 1;
    }
    degree[track] = filled;
  }

  const medoid = findApproximateMedoid(trackCount, similarityBetween, 1_024);
  const entryPoints = chooseEntryPoints(
    trackCount,
    similarityBetween,
    options.entryPointCount ?? 1,
    medoid,
  );

  const beam = new SearchBeam(searchListSize);
  const visitedFlag = new Int32Array(trackCount).fill(-1);
  let visitedEpoch = 0;
  let totalVisited = 0;
  let searches = 0;

  /**
   * Greedy search for `query`, returning the points it visited.
   *
   * The visited set — not the beam's final contents — is what Vamana prunes, because it is the
   * visited set that contains the far-away points the search passed through on its way in.
   */
  const searchVisited = (query: number): number[] => {
    visitedEpoch += 1;
    const collected: number[] = [];
    // Rotate over the entry points rather than always entering at the medoid, so the tracks on the
    // way in from one place do not become everyone's neighbour.
    const entry = entryPoints[query % entryPoints.length]!;
    beam.insert(entry, distanceTo(query, entry));
    visitedFlag[entry] = visitedEpoch;
    collected.push(entry);
    for (;;) {
      const current = beam.nextUnexpanded();
      if (current < 0) {
        break;
      }
      const base = current * neighboursPerTrack;
      for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
        const target = adjacency[base + slot]!;
        if (target < 0 || target === query || visitedFlag[target] === visitedEpoch) {
          continue;
        }
        visitedFlag[target] = visitedEpoch;
        collected.push(target);
        beam.insert(target, distanceTo(query, target));
      }
    }
    searches += 1;
    totalVisited += collected.length;
    return collected;
  };

  /**
   * The similarity written to the bundle for an edge.
   *
   * Recomputed rather than looked up in the source export's candidate list, even for pairs the
   * list contains. The two agree: the export's own weighted cosine over its own `vector_json`
   * is what produced those values, and the reproduction check confirms it to six decimal
   * places. The exported byte quantises `[-1, 1]` into 255 steps of 0.0078 each, so no float
   * difference between the two routes can reach the wire. Recomputing keeps the construction
   * from scanning a 25-element list once per pool member, which at roughly 300 pool members per
   * track over two passes is 1.3 billion comparisons that buy nothing.
   */
  const toCandidates = (seed: number, ordinals: Iterable<number>): NeighbourCandidate[] => {
    const out: NeighbourCandidate[] = [];
    for (const ordinal of ordinals) {
      if (ordinal === seed || ordinal < 0) {
        continue;
      }
      out.push({ trackOrdinal: ordinal, similarity: similarityBetween(seed, ordinal) });
    }
    out.sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal);
    return out;
  };

  const writeRow = (track: number, kept: NeighbourCandidate[]): void => {
    const base = track * neighboursPerTrack;
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      adjacency[base + slot] = slot < kept.length ? kept[slot]!.trackOrdinal : -1;
    }
    degree[track] = Math.min(kept.length, neighboursPerTrack);
  };

  const rowOf = (track: number): number[] => {
    const out: number[] = [];
    const base = track * neighboursPerTrack;
    for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
      const target = adjacency[base + slot]!;
      if (target >= 0) {
        out.push(target);
      }
    }
    return out;
  };

  // A fixed permutation, so the graph does not depend on ordinal order — which is alphabetical
  // `sid_path` position and would otherwise bias construction towards one end of the corpus.
  const order = new Int32Array(trackCount);
  for (let index = 0; index < trackCount; index += 1) {
    order[index] = index;
  }
  const permutationRandom = createRandom(0x5f_37_59_df);
  for (let index = trackCount - 1; index > 0; index -= 1) {
    const swap = Math.floor(permutationRandom() * (index + 1));
    const temporary = order[index]!;
    order[index] = order[swap]!;
    order[swap] = temporary;
  }

  for (let pass = 0; pass < passes; pass += 1) {
    const passAlpha = pass === 0 ? 1 : alpha;
    for (let step = 0; step < trackCount; step += 1) {
      const track = order[step]!;
      beam.reset();
      const visited = searchVisited(track);
      const pool = toCandidates(track, visited);
      const forced: NeighbourCandidate[] = [];
      for (const candidate of candidates[track] ?? []) {
        if (forced.length >= forcedNearestSlots) {
          break;
        }
        if (candidate.trackOrdinal !== track) {
          forced.push(candidate);
        }
      }
      const kept = pruneCandidates(track, pool, neighboursPerTrack, passAlpha, distance, forced);
      if (kept.length < neighboursPerTrack) {
        // Backfill from the source export's nearest neighbours rather than from the visited set:
        // if the search found little, the known nearest neighbours are the best remaining edges.
        const taken = new Set(kept.map((candidate) => candidate.trackOrdinal));
        for (const candidate of candidates[track] ?? []) {
          if (kept.length >= neighboursPerTrack) {
            break;
          }
          if (candidate.trackOrdinal === track || taken.has(candidate.trackOrdinal)) {
            continue;
          }
          kept.push(candidate);
          taken.add(candidate.trackOrdinal);
        }
      }
      writeRow(track, kept);

      // Reverse insertion, applied immediately as the paper specifies: the target gains the
      // edge back, and re-prunes if that overflows its row.
      for (const edge of kept) {
        const target = edge.trackOrdinal;
        const existing = rowOf(target);
        if (existing.includes(track)) {
          continue;
        }
        if (existing.length < neighboursPerTrack) {
          adjacency[(target * neighboursPerTrack) + existing.length] = track;
          degree[target] = existing.length + 1;
          continue;
        }
        const union = toCandidates(target, [...existing, track]);
        const targetForced: NeighbourCandidate[] = [];
        for (const candidate of candidates[target] ?? []) {
          if (targetForced.length >= forcedNearestSlots) {
            break;
          }
          if (candidate.trackOrdinal !== target) {
            targetForced.push(candidate);
          }
        }
        const repruned = pruneCandidates(
          target, union, neighboursPerTrack, passAlpha, distance, targetForced,
        );
        if (repruned.length < neighboursPerTrack) {
          const taken = new Set(repruned.map((candidate) => candidate.trackOrdinal));
          for (const candidate of union) {
            if (repruned.length >= neighboursPerTrack) {
              break;
            }
            if (taken.has(candidate.trackOrdinal)) {
              continue;
            }
            repruned.push(candidate);
            taken.add(candidate.trackOrdinal);
          }
        }
        writeRow(target, repruned);
      }

      if (options.onProgress && step % 5_000 === 0) {
        options.onProgress(
          (pass + (step / trackCount)) / passes,
          `pass ${pass + 1}/${passes} alpha ${passAlpha}`,
        );
      }
    }
  }

  // Reachability repair. Runs on the adjacency rather than on the emitted rows, so the in-degree
  // bookkeeping stays exact while edges move.
  const inDegree = new Int32Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    for (const target of rowOf(track)) {
      inDegree[target]! += 1;
    }
  }
  let unreachableBeforeRepair = 0;
  for (let track = 0; track < trackCount; track += 1) {
    if (inDegree[track] === 0) {
      unreachableBeforeRepair += 1;
    }
  }
  /**
   * The edges the repair and the trim must not move: a track's reserved nearest neighbours.
   *
   * Without this the two later passes quietly undo the reservation — the repair displaces a donor's
   * least similar edge and the trim displaces a hub edge, and either can pick a reserved one.
   */
  const isForcedEdge = (source: number, target: number): boolean => {
    if (forcedNearestSlots <= 0) {
      return false;
    }
    let seen = 0;
    for (const candidate of candidates[source] ?? []) {
      if (candidate.trackOrdinal === source) {
        continue;
      }
      if (seen >= forcedNearestSlots) {
        return false;
      }
      if (candidate.trackOrdinal === target) {
        return true;
      }
      seen += 1;
    }
    return false;
  };

  let repaired = 0;
  if (options.repairUnreachable ?? true) {
    for (let track = 0; track < trackCount; track += 1) {
      if (inDegree[track] !== 0) {
        continue;
      }
      // Donors, nearest first: an edge from a near neighbour is a musically sensible edge, which
      // an edge from an arbitrary track would not be.
      for (const donorCandidate of candidates[track] ?? []) {
        const donor = donorCandidate.trackOrdinal;
        if (donor === track) {
          continue;
        }
        const donorRow = rowOf(donor);
        if (donorRow.includes(track)) {
          continue;
        }
        // Displace the donor's least similar edge, but never the last incoming edge of its target.
        let worstSlot = -1;
        let worstSimilarity = Number.POSITIVE_INFINITY;
        for (let slot = 0; slot < donorRow.length; slot += 1) {
          const target = donorRow[slot]!;
          if (inDegree[target]! < 2 || isForcedEdge(donor, target)) {
            continue;
          }
          const similarity = similarityBetween(donor, target);
          if (similarity < worstSimilarity) {
            worstSimilarity = similarity;
            worstSlot = slot;
          }
        }
        if (donorRow.length < neighboursPerTrack) {
          adjacency[(donor * neighboursPerTrack) + donorRow.length] = track;
          degree[donor] = donorRow.length + 1;
          inDegree[track]! += 1;
          repaired += 1;
          break;
        }
        if (worstSlot < 0) {
          continue;
        }
        const displaced = donorRow[worstSlot]!;
        // rowOf compacts sentinels out, so the slot index has to be found in the raw adjacency.
        const base = donor * neighboursPerTrack;
        for (let slot = 0; slot < neighboursPerTrack; slot += 1) {
          if (adjacency[base + slot] === displaced) {
            adjacency[base + slot] = track;
            break;
          }
        }
        inDegree[displaced]! -= 1;
        inDegree[track]! += 1;
        repaired += 1;
        break;
      }
    }
  }
  let unreachableAfterRepair = 0;
  for (let track = 0; track < trackCount; track += 1) {
    if (inDegree[track] === 0) {
      unreachableAfterRepair += 1;
    }
  }

  // Hub trimming. Runs after the repair so it can see the final in-degrees, and never takes a
  // track below one incoming edge, so it cannot undo the repair.
  const inDegreeMaxBeforeTrim = Math.max(...inDegree);
  let trimmedEdges = 0;
  const capMultiple = options.inDegreeCapMultiple ?? 8;
  if (capMultiple > 0) {
    let edgeTotal = 0;
    for (let track = 0; track < trackCount; track += 1) {
      edgeTotal += degree[track]!;
    }
    const cap = Math.max(
      neighboursPerTrack,
      Math.floor((edgeTotal / trackCount) * capMultiple),
    );
    // Sources per target, so an over-subscribed track's incoming edges can be found without
    // rescanning the whole adjacency once per hub.
    const sourcesOf = new Map<number, number[]>();
    for (let track = 0; track < trackCount; track += 1) {
      for (const target of rowOf(track)) {
        if (inDegree[target]! > cap) {
          const list = sourcesOf.get(target);
          if (list) {
            list.push(track);
          } else {
            sourcesOf.set(target, [track]);
          }
        }
      }
    }
    // Worst hubs first, so the budget freed by trimming the largest is available to the rest.
    const hubs = [...sourcesOf.keys()].sort((left, right) => inDegree[right]! - inDegree[left]!);
    for (const hub of hubs) {
      const sources = sourcesOf.get(hub) ?? [];
      // Weakest edges go first: the sources for which the hub is the least good match are the
      // ones with the least to lose.
      sources.sort((left, right) => similarityBetween(left, hub) - similarityBetween(right, hub));
      for (const source of sources) {
        if (inDegree[hub]! <= cap) {
          break;
        }
        const base = source * neighboursPerTrack;
        if (isForcedEdge(source, hub)) {
          continue;
        }
        let slot = -1;
        for (let index = 0; index < neighboursPerTrack; index += 1) {
          if (adjacency[base + index] === hub) {
            slot = index;
            break;
          }
        }
        if (slot < 0) {
          continue;
        }
        const present = new Set(rowOf(source));
        // The replacement comes from the source's own nearest neighbours, so the edge that
        // takes the hub's place is still a real musical match rather than an arbitrary one.
        let replacement = -1;
        for (const candidate of candidates[source] ?? []) {
          const target = candidate.trackOrdinal;
          if (target === source || target === hub || present.has(target) || inDegree[target]! >= cap) {
            continue;
          }
          replacement = target;
          break;
        }
        if (replacement < 0) {
          continue;
        }
        adjacency[base + slot] = replacement;
        inDegree[hub]! -= 1;
        inDegree[replacement]! += 1;
        trimmedEdges += 1;
      }
    }
  }
  const inDegreeMaxAfterTrim = Math.max(...inDegree);

  // Emit the finished adjacency as rows in descending published similarity.
  const rows: NeighbourCandidate[][] = new Array(trackCount);
  let totalEdgeDistance = 0;
  let maxEdgeDistance = 0;
  let edges = 0;
  for (let track = 0; track < trackCount; track += 1) {
    const row = toCandidates(track, rowOf(track));
    rows[track] = row;
    for (const edge of row) {
      const edgeDistance = 1 - edge.similarity;
      totalEdgeDistance += edgeDistance;
      if (edgeDistance > maxEdgeDistance) {
        maxEdgeDistance = edgeDistance;
      }
      edges += 1;
    }
  }

  return {
    rows,
    medoid,
    stats: {
      meanVisited: searches === 0 ? 0 : totalVisited / searches,
      meanEdgeDistance: edges === 0 ? 0 : totalEdgeDistance / edges,
      maxEdgeDistance,
      distanceEvaluations,
      unreachableBeforeRepair,
      repaired,
      unreachableAfterRepair,
      inDegreeMaxBeforeTrim,
      inDegreeMaxAfterTrim,
      trimmedEdges,
      entryPoints: entryPoints.length,
    },
  };
}
