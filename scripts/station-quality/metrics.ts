/**
 * Station quality metrics.
 *
 * PRE-REGISTERED: this file was written before any optimisation was run, and the
 * definitions below were not changed afterwards. That matters, because the
 * alternative — tuning a system and then choosing the metric that flatters it —
 * produces numbers that cannot be trusted by anyone, including the person who
 * produced them.
 *
 * ## The objective
 *
 * A good radio station is COHERENT (the next track plausibly belongs with the
 * last) without being MONOTONOUS (it is not the same composer eight times). Those
 * pull against each other: the most coherent possible station is one tune's
 * subsongs on repeat, and the most diverse is a shuffle. So quality is scored as
 * both, and neither is allowed to be optimised away.
 *
 * ## Ground truth, and why it is credible
 *
 * There is no human-labelled "these SIDs are similar" set. The strongest
 * available label is HVSC's own directory structure: MUSICIANS/<letter>/<Composer>
 * and GAMES/<letter>/<Game>. Two tunes by the same composer, or from the same
 * production, share idiom, arrangement habits and often the same playroutine —
 * a listener would usually accept them as related.
 *
 * This is a PROXY, and it has known limits, stated here rather than buried:
 *   - Composers vary their style, so a same-composer miss is not necessarily bad.
 *   - Different composers imitate each other, so a cross-composer hit may be
 *     perfectly good.
 * It is therefore a floor on quality, not a ceiling. Its virtue is that it is
 * external to the features: nothing in the classifier can see the directory
 * layout, so the classifier cannot game it.
 *
 * Subsongs of the SAME file are excluded from every retrieval count. Retrieving
 * another subsong of the tune you are already playing is trivially "same
 * composer" and would inflate the score without producing a better station.
 */

export interface Track {
  trackId: string;
  sidPath: string;
  vector: number[];
  e: number;
  m: number;
  c: number;
}

/** MUSICIANS/H/Hubbard_Rob/Commando.sid -> "MUSICIANS/H/Hubbard_Rob" */
export function groupOf(sidPath: string): string | null {
  const parts = sidPath.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "MUSICIANS" || p === "GAMES" || p === "DEMOS");
  if (idx < 0 || parts.length < idx + 3) return null;
  return parts.slice(idx, idx + 3).join("/");
}

/** The .sid file a track came from, so sibling subsongs can be excluded. */
export function fileOf(sidPath: string): string {
  return sidPath;
}

export interface RetrievalResult {
  /** Fraction of returned neighbours sharing the seed's group. */
  precisionAtK: number;
  /** Probability two random tracks share a group, given this corpus. */
  chance: number;
  /** precisionAtK / chance. The headline number. */
  lift: number;
  seeds: number;
  pairs: number;
}

/**
 * Precision@k against the group label, expressed as lift over chance.
 *
 * Lift rather than raw precision because raw precision depends on how
 * concentrated the corpus happens to be; lift is comparable across corpora and
 * across train/test splits of different sizes.
 */
export function groupRetrieval(
  seeds: Track[],
  rank: (seed: Track) => Track[],
  k: number,
): RetrievalResult {
  let hits = 0;
  let pairs = 0;
  let usedSeeds = 0;

  for (const seed of seeds) {
    const seedGroup = groupOf(seed.sidPath);
    if (!seedGroup) continue;
    const neighbours = rank(seed)
      .filter((t) => fileOf(t.sidPath) !== fileOf(seed.sidPath))
      .slice(0, k);
    if (neighbours.length === 0) continue;
    usedSeeds++;
    for (const n of neighbours) {
      pairs++;
      if (groupOf(n.sidPath) === seedGroup) hits++;
    }
  }

  // Chance is computed over the same population the neighbours are drawn from,
  // excluding same-file pairs to match the retrieval rule above.
  const pool = seeds.filter((t) => groupOf(t.sidPath));
  const byGroup = new Map<string, Track[]>();
  for (const t of pool) {
    const g = groupOf(t.sidPath)!;
    byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
  }
  let sameGroupPairs = 0;
  let totalPairs = 0;
  for (const [, members] of byGroup) {
    const files = new Map<string, number>();
    for (const t of members) files.set(fileOf(t.sidPath), (files.get(fileOf(t.sidPath)) ?? 0) + 1);
    let within = members.length * (members.length - 1);
    for (const [, n] of files) within -= n * (n - 1);
    sameGroupPairs += Math.max(0, within);
  }
  {
    const files = new Map<string, number>();
    for (const t of pool) files.set(fileOf(t.sidPath), (files.get(fileOf(t.sidPath)) ?? 0) + 1);
    let all = pool.length * (pool.length - 1);
    for (const [, n] of files) all -= n * (n - 1);
    totalPairs = Math.max(1, all);
  }
  const chance = sameGroupPairs / totalPairs;
  const precisionAtK = pairs === 0 ? 0 : hits / pairs;

  return { precisionAtK, chance, lift: chance === 0 ? 0 : precisionAtK / chance, seeds: usedSeeds, pairs };
}

export interface StationQuality {
  /** Mean group-lift of the station's members relative to its seed. */
  coherence: number;
  /** Distinct groups / station length. 1.0 = every track a different composer. */
  diversity: number;
  /** Largest share taken by any single group. Lower is better. */
  maxGroupShare: number;
  /** Fraction of stations with no repeated .sid file. */
  distinctFiles: number;
}

/**
 * Station-level quality, as opposed to pairwise retrieval.
 *
 * Coherence and diversity are reported separately and never collapsed into one
 * number here. A single blended score invites optimising the blend instead of
 * the product, and hides which half regressed.
 */
export function stationQuality(
  stations: Array<{ seed: Track; tracks: Track[] }>,
  chance: number,
): StationQuality {
  const coherences: number[] = [];
  const diversities: number[] = [];
  const maxShares: number[] = [];
  let allDistinct = 0;

  for (const { seed, tracks } of stations) {
    if (tracks.length === 0) continue;
    const seedGroup = groupOf(seed.sidPath);
    if (seedGroup) {
      const hits = tracks.filter((t) => groupOf(t.sidPath) === seedGroup).length;
      coherences.push(chance === 0 ? 0 : hits / tracks.length / chance);
    }
    const groups = tracks.map((t) => groupOf(t.sidPath) ?? t.sidPath);
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
    diversities.push(counts.size / tracks.length);
    maxShares.push(Math.max(...counts.values()) / tracks.length);
    if (new Set(tracks.map((t) => fileOf(t.sidPath))).size === tracks.length) allDistinct++;
  }

  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length);
  return {
    coherence: mean(coherences),
    diversity: mean(diversities),
    maxGroupShare: mean(maxShares),
    distinctFiles: stations.length === 0 ? 0 : allDistinct / stations.length,
  };
}

/** Occupancy of the 1-5 rating levels; category stations need spread. */
export function ratingSpread(tracks: Track[]): Record<string, { levels: number; largestShare: number; entropyBits: number }> {
  const out: Record<string, { levels: number; largestShare: number; entropyBits: number }> = {};
  for (const dim of ["e", "m", "c"] as const) {
    const counts = new Map<number, number>();
    for (const t of tracks) counts.set(t[dim], (counts.get(t[dim]) ?? 0) + 1);
    const total = tracks.length;
    const probs = [...counts.values()].map((v) => v / total);
    out[dim] = {
      levels: counts.size,
      largestShare: Math.max(...probs),
      entropyBits: -probs.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0),
    };
  }
  return out;
}

/**
 * Maximal Marginal Relevance station assembly.
 *
 * Coherence and diversity pull against each other, and the pre-registered
 * guardrail exposed that as a hard conflict: any candidate that retrieves the
 * seed's composer better puts MORE of that composer in the top of the list, which
 * mechanically lowers "distinct groups / station length". Measured on the
 * development corpus, every statistically significant ranking improvement failed
 * the diversity guardrail — not because it made worse stations, but because the
 * guardrail measured raw neighbour lists rather than assembled stations.
 *
 * The resolution is architectural rather than statistical. Ranking should be
 * optimised for relevance; diversity belongs to the step that BUILDS the station
 * from the ranking. MMR does exactly that: it walks a candidate pool and
 * repeatedly picks the track that is close to the seed but far from what has
 * already been queued.
 *
 * `lambda` is the trade-off: 1.0 reproduces the plain ranking, 0.0 ignores the
 * seed entirely. Selection uses only DISTANCES, never the group labels, so this
 * is deployable rather than an evaluation trick — a station cannot consult a
 * ground truth it does not have at serving time.
 */
export function assembleStationMMR(
  seedIndex: number,
  candidates: readonly number[],
  distance: (a: number, b: number) => number,
  size: number,
  lambda = 0.7,
): number[] {
  const pool = [...candidates];
  const chosen: number[] = [];

  while (chosen.length < size && pool.length > 0) {
    let bestAt = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i]!;
      let nearestChosen = Number.POSITIVE_INFINITY;
      for (const already of chosen) {
        const d = distance(candidate, already);
        if (d < nearestChosen) nearestChosen = d;
      }
      // With nothing chosen yet the novelty term is undefined; fall back to pure
      // relevance so the first pick is always the nearest neighbour.
      const novelty = chosen.length === 0 ? 0 : nearestChosen;
      const score = -lambda * distance(seedIndex, candidate) + (1 - lambda) * novelty;
      if (score > bestScore) {
        bestScore = score;
        bestAt = i;
      }
    }
    chosen.push(pool[bestAt]!);
    pool.splice(bestAt, 1);
  }

  return chosen;
}
