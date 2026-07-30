/**
 * How `sidcorr-tiny-1` chooses which three of a track's neighbours to export.
 *
 * ## The problem
 *
 * A track's 25 nearest neighbours are known; three slots are available. Keeping the three
 * nearest is the obvious answer and it is the wrong one, because all three land inside one
 * tight cluster. Measured on the published full export: at k=3, **43.92%** of directed edges
 * are reciprocated, following the nearest neighbour repeatedly reaches a two-track cycle after
 * a median of **3 distinct tracks** (all 16,700 attractors have length exactly 2), and greedy
 * routing — the standard test of whether a proximity index can be searched — finds the query's
 * true nearest neighbour **0.30%** of the time. Three near-duplicates that mostly point back
 * at each other are not three edges.
 *
 * ## The rule
 *
 * Diversifying pruning, as used by HNSW's neighbour-selection heuristic and by
 * DiskANN/Vamana's alpha-pruning. With distance `d = 1 - s`:
 *
 *     kept = []
 *     for v in candidates, nearest first:
 *         if |kept| == k: stop
 *         if for every w in kept:  alpha * d(w, v) > d(u, v):
 *             keep v
 *
 * In words: **drop a candidate you could already reach just as well via one you have kept.**
 * `alpha = 1` is the relative-neighbourhood-graph rule and diversifies hardest; `alpha > 1`
 * retains more short edges and raises degree pressure.
 *
 * Two details that are easy to omit and that the graph is unusable without:
 *
 * - **Backfill.** If pruning yields fewer than *k*, the remaining slots are filled from the
 *   unpruned candidates in similarity order. A sentinel where a real edge was available is a
 *   slot the consumer paid for and did not get; 0.8.0 shipped 6.69% of its capacity empty and
 *   0.8.2 shipped 14.76% empty.
 * - **Reverse insertion.** After selecting *u*'s edges, the reverse edge is offered to each
 *   target, whose list is re-pruned if it overflows. This is Vamana's second pass, and it is
 *   what bounds in-degree and removes tracks that nothing can reach. Without it 0.8.0's
 *   outcome — 28.08% of the corpus with no incoming edge — recurs under a different cause.
 *
 * ## What this module does not decide
 *
 * It does not decide what plays next. The exported graph is a proximity index; "never play
 * the same tune twice" is a playback policy and belongs to the client, which already keeps a
 * set of what it has played. 0.8.0 and 0.8.2 both encoded that policy as a structural
 * constraint on the artefact — "the exported edges must form a directed acyclic graph" — and
 * paid for it by discarding half the source graph's edges. `doc/neighbour-graph-design.md`
 * records both attempts and what they measured.
 */

/**
 * How the exported graph is built.
 *
 * `navigable` runs the Vamana construction in `similarity-graph-build.ts`, whose candidate pool
 * comes from a search over the graph being built. `prune` applies the diversifying rule to the
 * source export's 25 nearest neighbours and nothing else. The difference is not a tuning knob:
 * the top-25 pool contains no long edges, so `prune` cannot produce a searchable graph however
 * its alpha is set. It is kept because it is much cheaper and because the measurement that
 * establishes the difference has to be reproducible.
 */
export type NeighbourGraphBuilder = "navigable" | "prune";

/** Which hubness correction, if any, the selection distance applies. */
export type HubnessCorrection = "none" | "mutual-proximity" | "local-scaling";

export interface NeighbourSelectionSettings {
  builder?: NeighbourGraphBuilder;
  alpha?: number;
  /** Beam width of the candidate-generating search. Ignored by the `prune` builder. */
  searchListSize?: number;
  hubnessCorrection?: HubnessCorrection;
  /**
   * Bound on in-degree, as a multiple of the mean. Ignored by the `prune` builder, whose in-degree
   * is bounded by the candidate pool anyway. 0 disables the bound.
   */
  inDegreeCapMultiple?: number;
  /** Entry points the candidate-generating searches rotate over. 1 is the published algorithm. */
  entryPointCount?: number;
  /**
   * Slots reserved for the seed's nearest neighbours before diversification picks the rest.
   * Ignored by the `prune` builder, which selects from the nearest neighbours anyway.
   */
  forcedNearestSlots?: number;
}

export interface NeighbourCandidate {
  trackOrdinal: number;
  /**
   * The similarity the source export published for this edge. Carried through selection
   * unchanged and written to the bundle, so the exported similarity byte always means the
   * weighted cosine between the two tracks — never a selection score.
   */
  similarity: number;
}

/**
 * Distance used to make selection decisions.
 *
 * Separate from the published similarity so that a hubness correction can change which edges
 * are chosen without changing what the exported similarity byte means. `similarity` is passed
 * when the caller already knows it, which lets the default implementation avoid recomputing a
 * dot product for a pair that came straight out of a candidate list.
 */
export type SelectionDistance = (left: number, right: number, similarity?: number) => number;

export interface NeighbourSelectionOptions {
  trackCount: number;
  /**
   * Per-track candidate lists in descending published similarity. Treated as the track's true
   * top-k; an approximate list yields an approximate graph, deterministically.
   */
  candidates: ReadonlyArray<ReadonlyArray<NeighbourCandidate>>;
  neighboursPerTrack: number;
  /**
   * The diversification strength. 1 is the relative-neighbourhood-graph rule; above 1 keeps
   * more short edges. See `doc/neighbour-graph-design.md` for the sweep that chose the
   * shipped value.
   */
  alpha: number;
  /** Selection distance. Defaults to `1 - similarity` over `similarityBetween`. */
  selectionDistance?: SelectionDistance;
  /** Weighted cosine between two track ordinals, for pairs absent from a candidate list. */
  similarityBetween: (left: number, right: number) => number;
  /** Run Vamana's reverse-insertion pass. Defaults to true; off only for measurement. */
  reverseInsertion?: boolean;
}

export interface NeighbourSelectionStats {
  /** Slots filled by the diversifying rule. */
  prunedSlots: number;
  /** Slots the rule left empty and backfill filled from the unpruned candidates. */
  backfilledSlots: number;
  /** Slots no candidate could fill, so they ship as sentinels. */
  emptySlots: number;
  reverseEdgesOffered: number;
  reverseEdgesAccepted: number;
  /** Targets whose list overflowed and had to be re-pruned. */
  reverseRePrunes: number;
  /** Edges a re-prune dropped to make room for a reverse edge. */
  reverseDisplacedEdges: number;
}

export interface NeighbourSelection {
  /** Per-track rows, each in descending published similarity, at most `neighboursPerTrack`. */
  rows: Array<Array<NeighbourCandidate>>;
  stats: NeighbourSelectionStats;
}

/**
 * Apply the diversifying rule to one candidate list.
 *
 * Exported so the alpha sweep and the unit tests can exercise the rule in isolation: it is
 * the one piece of this module whose behaviour is a design decision rather than bookkeeping.
 */
export function pruneCandidates(
  seed: number,
  candidates: ReadonlyArray<NeighbourCandidate>,
  neighboursPerTrack: number,
  alpha: number,
  distance: SelectionDistance,
  /**
   * Edges to keep before the rule runs, and to let the rule prune against.
   *
   * Used to reserve slots for the seed's nearest neighbours. Diversification is what makes the
   * graph navigable, and it is also what costs retrieval quality: measured on the HVSC corpus, a
   * fully diversified 3-edge graph raises nDCG@10 by 14.35% and drops composer lift by 21.12%,
   * because the third slot goes to a long edge that is much less likely to share a composer.
   * Reserving the nearest slots keeps the near matches a consumer reads a neighbour table for and
   * spends only the remainder on reach.
   */
  preKept: ReadonlyArray<NeighbourCandidate> = [],
): NeighbourCandidate[] {
  const kept: NeighbourCandidate[] = [...preKept].slice(0, neighboursPerTrack);
  const already = new Set(kept.map((candidate) => candidate.trackOrdinal));
  for (const candidate of candidates) {
    if (already.has(candidate.trackOrdinal)) {
      continue;
    }
    if (kept.length >= neighboursPerTrack) {
      break;
    }
    if (candidate.trackOrdinal === seed) {
      continue;
    }
    const seedDistance = distance(seed, candidate.trackOrdinal, candidate.similarity);
    let dominated = false;
    for (const alreadyKept of kept) {
      // `alpha * d(w, v) > d(u, v)` keeps v. The negation drops it: v is close enough to a
      // neighbour already kept that the kept one reaches it, so the edge is redundant.
      if (alpha * distance(alreadyKept.trackOrdinal, candidate.trackOrdinal) <= seedDistance) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      kept.push(candidate);
    }
  }
  return kept;
}

/**
 * Choose every track's exported edges.
 *
 * Deterministic: no RNG, and every tie resolves on the candidate list's order, which is the
 * source export's rank order with the lower track ordinal breaking equal similarities. A
 * derived artefact that cannot be reproduced cannot be verified.
 */
export function selectDiversifiedNeighbours(
  options: NeighbourSelectionOptions,
): NeighbourSelection {
  const {
    trackCount,
    candidates,
    neighboursPerTrack,
    alpha,
    similarityBetween,
    reverseInsertion = true,
  } = options;
  const distance: SelectionDistance = options.selectionDistance
    ?? ((left, right, similarity) => 1 - (similarity ?? similarityBetween(left, right)));

  const stats: NeighbourSelectionStats = {
    prunedSlots: 0,
    backfilledSlots: 0,
    emptySlots: 0,
    reverseEdgesOffered: 0,
    reverseEdgesAccepted: 0,
    reverseRePrunes: 0,
    reverseDisplacedEdges: 0,
  };

  // Pass 1: the diversifying rule, then backfill.
  const rows: NeighbourCandidate[][] = new Array(trackCount);
  for (let seed = 0; seed < trackCount; seed += 1) {
    const list = candidates[seed] ?? [];
    const kept = pruneCandidates(seed, list, neighboursPerTrack, alpha, distance);
    stats.prunedSlots += kept.length;
    if (kept.length < neighboursPerTrack) {
      const taken = new Set(kept.map((candidate) => candidate.trackOrdinal));
      for (const candidate of list) {
        if (kept.length >= neighboursPerTrack) {
          break;
        }
        if (candidate.trackOrdinal === seed || taken.has(candidate.trackOrdinal)) {
          continue;
        }
        kept.push(candidate);
        taken.add(candidate.trackOrdinal);
        stats.backfilledSlots += 1;
      }
    }
    rows[seed] = kept;
  }

  // Pass 2: offer each edge back the other way, re-pruning a target whose list overflows.
  //
  // The offers are collected first and applied per target, so the result does not depend on
  // the order tracks are visited in — an in-place pass would let an early target absorb
  // reverse edges that a later one then could not.
  if (reverseInsertion) {
    const offers: number[][] = Array.from({ length: trackCount }, () => []);
    for (let seed = 0; seed < trackCount; seed += 1) {
      for (const edge of rows[seed]!) {
        offers[edge.trackOrdinal]!.push(seed);
        stats.reverseEdgesOffered += 1;
      }
    }

    for (let target = 0; target < trackCount; target += 1) {
      const offered = offers[target]!;
      if (offered.length === 0) {
        continue;
      }
      const row = rows[target]!;
      const present = new Set(row.map((candidate) => candidate.trackOrdinal));
      const additions: NeighbourCandidate[] = [];
      for (const source of offered) {
        if (source === target || present.has(source)) {
          continue;
        }
        present.add(source);
        // Weighted cosine is symmetric, so the reverse edge carries the same published
        // similarity as the forward one. Looking it up in the source list first keeps the
        // exported byte identical to the one the source export published for the pair.
        const listed = (candidates[target] ?? []).find(
          (candidate) => candidate.trackOrdinal === source,
        );
        additions.push({
          trackOrdinal: source,
          similarity: listed?.similarity ?? similarityBetween(target, source),
        });
      }
      if (additions.length === 0) {
        continue;
      }

      if (row.length + additions.length <= neighboursPerTrack) {
        row.push(...additions);
        stats.reverseEdgesAccepted += additions.length;
        continue;
      }

      // Overflow: re-prune the union with the same rule, so the target keeps a diverse set
      // rather than whichever edges happened to arrive first.
      const union = [...row, ...additions].sort(
        (left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal,
      );
      const repruned = pruneCandidates(target, union, neighboursPerTrack, alpha, distance);
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
      const keptOrdinals = new Set(repruned.map((candidate) => candidate.trackOrdinal));
      for (const addition of additions) {
        if (keptOrdinals.has(addition.trackOrdinal)) {
          stats.reverseEdgesAccepted += 1;
        }
      }
      for (const original of row) {
        if (!keptOrdinals.has(original.trackOrdinal)) {
          stats.reverseDisplacedEdges += 1;
        }
      }
      stats.reverseRePrunes += 1;
      rows[target] = repruned;
    }
  }

  // Row order is descending published similarity. Slot 0 is the nearest kept neighbour, which
  // is what a consumer reading a neighbour table expects and what `c64commander`'s rank
  // weighting (`neighbors - slot`) assumes. 0.8.2 put a traversal successor there instead,
  // which left 46.09% of rows out of similarity order.
  for (let seed = 0; seed < trackCount; seed += 1) {
    rows[seed]!.sort(
      (left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal,
    );
    stats.emptySlots += neighboursPerTrack - rows[seed]!.length;
  }

  return { rows, stats };
}
