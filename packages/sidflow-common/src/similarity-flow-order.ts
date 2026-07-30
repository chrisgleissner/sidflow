/**
 * A corpus-wide listening order, and the forward edge selection derived from it.
 *
 * ## The problem this solves
 *
 * `sidcorr-tiny-1` exports an acyclic 3-neighbour graph. Acyclicity is the right
 * property — a station that can revisit a track is a station that repeats itself — but
 * until 0.8.2 the orientation came from the track ordinal, which is alphabetical
 * `sid_path` position. Alphabetical order has nothing to do with what a tune sounds
 * like, so the resulting DAG was shallow: measured on the published 0.8.0 bundle, the
 * longest forward path from the median track was **17 tracks**, the longest anywhere in
 * the 87,868-track corpus was **79**, 28.08% of tracks had no incoming edge at all, and
 * a rank-greedy forward walk ran a median of 5 tracks before it had nowhere left to go.
 * The rule cost almost nothing in match quality — the first slot carried mean similarity
 * 0.9681 against a true rank-1 mean of 0.9729 — and almost everything in structure.
 *
 * ## What replaces it
 *
 * A **flow order**: a single ordering of the whole corpus in which consecutive tracks
 * are similar, built greedily as nearest-unvisited. Edges are then oriented by flow rank
 * instead of by track ordinal, so acyclicity still holds by construction, and slot 0 of
 * every track is reserved for its **flow successor** — the track that follows it in that
 * order.
 *
 * Reserving slot 0 is what turns a deeper graph into a guarantee. The flow order is a
 * permutation of the corpus, so the exported edges contain a Hamiltonian path; a forward
 * walk starting at flow rank *r* can always continue and reaches at least `n - r` distinct
 * tracks without repeating. That is the most any acyclic graph can offer, and it is
 * roughly 2,600x the median it replaces.
 *
 * ## Why greedy, and why the candidate lists make it cheap
 *
 * Greedy nearest-unvisited visits all 87,868 tracks at a mean consecutive weighted cosine
 * of 0.9582, against 0.9728 for the best possible single step. A stream across the whole
 * corpus costs about 0.015 of mean similarity against never leaving the closest match.
 *
 * The naive implementation is O(n^2 * d), which does not finish comfortably at corpus
 * scale. It is not needed: the caller already holds each track's k nearest neighbours, and
 * **if any of them is unvisited, the nearest unvisited track overall is the highest-ranked
 * unvisited one among them** — anything nearer would itself have been in the list. So the
 * full scan runs only when a track's whole list has been consumed, which happens for 11,832
 * of the HVSC corpus's 87,867 steps. This is an exact shortcut, not an approximation,
 * whenever the supplied lists are true top-k.
 *
 * Sibling handling follows the same argument. Subsongs of one `.sid` file are frequently
 * near-identical, so a stream that walks a file's subsongs back to back is the same defect
 * at its smallest scale; the selection therefore prefers a different file, and the shortcut
 * stays exact because a nearer non-sibling would also have been listed.
 */

export interface FlowOrderCandidate {
  trackOrdinal: number;
  similarity: number;
}

export interface ComputeFlowOrderOptions {
  trackCount: number;
  /**
   * Per-track candidate lists in descending similarity. Treated as true top-k, which is
   * what makes the full-scan shortcut exact; an approximate list yields an approximate
   * order, deterministically.
   */
  candidates: ReadonlyArray<ReadonlyArray<FlowOrderCandidate>>;
  /** Similarity between two track ordinals. Called only when a candidate list is exhausted. */
  similarityBetween: (left: number, right: number) => number;
  /** File ordinal per track, so the stream does not walk one file's subsongs back to back. */
  fileOrdinals: ReadonlyArray<number>;
}

export interface FlowOrder {
  /** Track ordinals in stream order. `order[0]` is always track ordinal 0. */
  order: Int32Array;
  /** Stream position of each track ordinal. */
  rankByTrackOrdinal: Int32Array;
  /** Similarity of the step from `order[i]` to `order[i + 1]`. */
  stepSimilarity: Float64Array;
  /** Steps whose candidate list was exhausted and needed a full scan. */
  fullScanSteps: number;
  /** Steps that had to accept a same-file sibling because nothing else was left. */
  siblingSteps: number;
}

/**
 * Build the flow order.
 *
 * Deterministic: the walk starts at track ordinal 0 and every tie breaks on the lower
 * track ordinal, so the same input always produces the same order. There is no RNG here,
 * for the same reason the lite codebook has none — a derived artefact that cannot be
 * reproduced cannot be verified.
 */
export function computeFlowOrder(options: ComputeFlowOrderOptions): FlowOrder {
  const { trackCount, candidates, similarityBetween, fileOrdinals } = options;
  if (trackCount <= 0) {
    return {
      order: new Int32Array(0),
      rankByTrackOrdinal: new Int32Array(0),
      stepSimilarity: new Float64Array(0),
      fullScanSteps: 0,
      siblingSteps: 0,
    };
  }

  const visited = new Uint8Array(trackCount);
  const order = new Int32Array(trackCount);
  const rankByTrackOrdinal = new Int32Array(trackCount);
  const stepSimilarity = new Float64Array(Math.max(trackCount - 1, 0));
  let fullScanSteps = 0;
  let siblingSteps = 0;

  let current = 0;
  visited[0] = 1;
  order[0] = 0;
  rankByTrackOrdinal[0] = 0;

  for (let step = 1; step < trackCount; step += 1) {
    const currentFile = fileOrdinals[current];
    let chosen = -1;
    let chosenSimilarity = 0;

    // 1. The exact shortcut: the best unvisited non-sibling already in the candidate list.
    for (const candidate of candidates[current] ?? []) {
      const target = candidate.trackOrdinal;
      if (visited[target] === 1 || fileOrdinals[target] === currentFile) {
        continue;
      }
      chosen = target;
      chosenSimilarity = candidate.similarity;
      break;
    }

    // 2. The list is used up. Scan for the nearest unvisited track in another file.
    if (chosen < 0) {
      fullScanSteps += 1;
      for (let target = 0; target < trackCount; target += 1) {
        if (visited[target] === 1 || fileOrdinals[target] === currentFile) {
          continue;
        }
        const similarity = similarityBetween(current, target);
        if (chosen < 0 || similarity > chosenSimilarity) {
          chosen = target;
          chosenSimilarity = similarity;
        }
      }
    }

    // 3. Only siblings of the current file are left. Take the nearest of them rather than
    //    stopping short of the corpus: an incomplete order would leave tracks with no
    //    forward edge, which is the defect this whole module exists to remove.
    if (chosen < 0) {
      siblingSteps += 1;
      for (let target = 0; target < trackCount; target += 1) {
        if (visited[target] === 1) {
          continue;
        }
        const similarity = similarityBetween(current, target);
        if (chosen < 0 || similarity > chosenSimilarity) {
          chosen = target;
          chosenSimilarity = similarity;
        }
      }
    }

    if (chosen < 0) {
      throw new Error(
        `Flow order stalled at step ${step} of ${trackCount} with unvisited tracks remaining.`,
      );
    }

    visited[chosen] = 1;
    order[step] = chosen;
    rankByTrackOrdinal[chosen] = step;
    stepSimilarity[step - 1] = chosenSimilarity;
    current = chosen;
  }

  return { order, rankByTrackOrdinal, stepSimilarity, fullScanSteps, siblingSteps };
}

export interface SelectForwardNeighborsOptions {
  trackCount: number;
  flow: FlowOrder;
  candidates: ReadonlyArray<ReadonlyArray<FlowOrderCandidate>>;
  /** Similarity between two track ordinals, for a successor missing from the candidate list. */
  similarityBetween: (left: number, right: number) => number;
  /** Slots per track. */
  neighborsPerTrack: number;
}

/**
 * Choose each track's exported edges: the flow successor, then the longest forward jump,
 * then the most similar remaining candidates that also move forward.
 *
 * Slot 0 is the successor rather than the most similar forward candidate, and that is
 * deliberate. `c64commander`'s station engine weights slot 0 highest (`neighbors - slot`),
 * so putting the successor there points the strongest pull along the stream. The cost is
 * small and was measured: the successor is already the track's rank-1 neighbour 31.65% of
 * the time and sits at a median rank of 2 in the 25-neighbour list. Every edge still
 * carries its own similarity byte, so a consumer that wants the closest match can sort.
 *
 * Nothing is fabricated to fill a row. A track whose ranking holds no further forward
 * candidate ships with sentinels rather than with an invented edge, which on the HVSC corpus
 * leaves the mean out-degree at 2.557 of 3. Every slot after the first is one of the source
 * export's nearest neighbours for that track, which is what a consumer reading a neighbour
 * table is entitled to assume.
 *
 * Measured per slot on the HVSC corpus, mean weighted cosine: slot 0 0.9582, slot 1 0.9476,
 * slot 2 0.9487, against 0.9728 for each track's unconstrained rank-1 neighbour.
 */
export function selectForwardNeighbors(
  options: SelectForwardNeighborsOptions,
): Array<Array<FlowOrderCandidate>> {
  const { trackCount, flow, candidates, similarityBetween, neighborsPerTrack } = options;
  const selected: Array<Array<FlowOrderCandidate>> = [];

  for (let trackOrdinal = 0; trackOrdinal < trackCount; trackOrdinal += 1) {
    const rank = flow.rankByTrackOrdinal[trackOrdinal]!;
    const successor = rank + 1 < trackCount ? flow.order[rank + 1]! : -1;
    const row: FlowOrderCandidate[] = [];

    if (successor >= 0) {
      const listed = (candidates[trackOrdinal] ?? []).find(
        (candidate) => candidate.trackOrdinal === successor,
      );
      row.push({
        trackOrdinal: successor,
        similarity: listed?.similarity ?? similarityBetween(trackOrdinal, successor),
      });
    }

    // Slot 1 is a shortcut: the forward candidate that jumps furthest along the stream. It
    // is still one of the track's k nearest neighbours, so it is a real musical match —
    // 73.0% of the corpus has one at least 1,000 steps ahead, and the median track's
    // furthest such edge is 11,958 steps ahead.
    //
    // Without it the exported graph is a long thin path, and a consumer that explores a
    // bounded neighbourhood rather than walking — `c64commander` expands at most 8 hops from
    // a fixed seed — reaches only what lies within 8 steps of where it started. The shortcut
    // is what makes the stream navigable in a few hops instead of only in sequence, and it
    // costs nothing structurally: it still moves forward, so the graph stays acyclic.
    let shortcut: FlowOrderCandidate | null = null;
    let shortcutDistance = 0;
    if (neighborsPerTrack >= 3) {
      for (const candidate of candidates[trackOrdinal] ?? []) {
        if (candidate.trackOrdinal === successor) {
          continue;
        }
        const distance = flow.rankByTrackOrdinal[candidate.trackOrdinal]! - rank;
        if (distance > shortcutDistance) {
          shortcut = candidate;
          shortcutDistance = distance;
        }
      }
    }

    if (shortcut) {
      row.push({ trackOrdinal: shortcut.trackOrdinal, similarity: shortcut.similarity });
    }
    for (const candidate of candidates[trackOrdinal] ?? []) {
      if (row.length >= neighborsPerTrack) {
        break;
      }
      if (candidate.trackOrdinal === successor || candidate.trackOrdinal === shortcut?.trackOrdinal) {
        continue;
      }
      if (flow.rankByTrackOrdinal[candidate.trackOrdinal]! <= rank) {
        continue;
      }
      row.push({ trackOrdinal: candidate.trackOrdinal, similarity: candidate.similarity });
    }

    selected.push(row);
  }

  return selected;
}
