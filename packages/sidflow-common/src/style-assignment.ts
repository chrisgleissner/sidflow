/**
 * Corpus-relative persona assignment, and the gate that refuses to publish a broken one.
 *
 * ## What was wrong
 *
 * `computeSimilarityStyleMask` took the three highest-scoring personas
 * unconditionally, so every track carried exactly three labels whether or not any of
 * them fitted. Measured on the shipped 0.7.0 bundle over 87,868 tracks:
 *
 * | persona          | tracks |     % |
 * |------------------|-------:|------:|
 * | slow_ambient     | 46,652 | 53.1% |
 * | nostalgic        | 45,562 | 51.9% |
 * | melodic          | 45,496 | 51.8% |
 * | experimental     | 42,495 | 48.4% |
 * | fast_paced       | 41,648 | 47.4% |
 * | era_explorer     | 29,116 | 33.1% |
 * | deep_discovery   | 11,962 | 13.6% |
 * | composer_focus   |    673 |  0.8% |
 * | theme_hunter     |      0 |  0.0% |
 *
 * A 69x spread among the non-empty ones, one station that could never play anything,
 * and 10.8% of the corpus labelled both `fast_paced` and `slow_ambient` — two stations
 * a listener experiences as opposites. `c64commander` surfaces all nine as user-facing
 * tiles, so every one of those numbers was something a user could see.
 *
 * ## The principle
 *
 * The export already solves this problem once. Ratings are rank-uniform quintiles, so
 * every rating bucket holds exactly 20% of the corpus by construction. The same idea
 * applies here: a persona is **the top X% of tracks by that persona's own score**, so
 * every station has a known size before a single track is written, and the shipped
 * populations are a design decision rather than an accident.
 *
 * It also keeps the semantics honest. "The most fast-paced tracks in this corpus" is
 * what a radio station actually is, and it matches how the ratings and the similarity
 * vector are already normalised. The corollary is worth stating in the specs: a station
 * is corpus-relative, so `fast_paced` means "the fastest fifth of HVSC", not
 * "objectively fast".
 *
 * ## The known limit
 *
 * Persona scores derive from the three rating quintiles, so an audio-led persona takes
 * at most 125 distinct values over any corpus. Quantile assignment cannot invent
 * resolution that is not there — it can only distribute what exists, and the tie-fraction
 * check below is what makes that limit visible rather than silent. Deriving categories
 * from the 58-dimension vector is the fix, and it is 0.9.0 work: it needs design and
 * validation, not a patch release.
 */

import { PERSONA_IDS, PERSONAS, type PersonaId } from "./persona.js";
import { scoreTrackForPersona, type PersonaTrackContext } from "./persona-scorer.js";
import { buildPersonaMetricsFromRatings, type PersonaTrackMetadata } from "./persona-metadata.js";

/**
 * Persona pairs a track must never carry at once.
 *
 * These are format decisions, not claims about the music, and the distinction matters.
 * Declaring a pair exclusive does not say a tune is "not melodic"; it says that for
 * STATION purposes it is filed under whichever of the two it fits better — which is
 * what a music director does when assigning a track to a format, and what stops two
 * tiles from playing the same library.
 *
 * `fast_paced` / `slow_ambient` is the obvious one: a listener experiences "Fast-Paced"
 * and "Chill / Ambient" as opposites, and 10.8% of the corpus carried both in the
 * shipped bundle.
 *
 * `melodic` / `experimental` is the earned one. Plenty of the best SID music is both
 * harmonically rich and timbrally adventurous, so as a claim about a tune the pair is
 * not exclusive at all. As a pair of station tiles it has to be: measured at equal 20%
 * populations they came out at Jaccard 0.659, sharing 79% of their tracks, and a
 * listener switching between them would hear the same station twice. Filing each dual
 * tune under its stronger fit takes the worst pair across all nine stations from 0.659
 * to 0.488 and, as a side effect, raises corpus coverage from 82.2% to 85.9%.
 *
 * Everything else overlaps by design — a tune can be nostalgic and melodic, or a game
 * theme by a prolific composer — so declaring more pairs would encode taste rather than
 * fix a defect.
 */
export const STYLE_CONFLICT_PAIRS: ReadonlyArray<readonly [PersonaId, PersonaId]> = [
  ["fast_paced", "slow_ambient"],
  ["melodic", "experimental"],
];

export interface StylePopulationPolicy {
  /** Share of the corpus each persona is assigned, as a fraction of track count. */
  targetShare: number;
  /** Absolute lower bound on a persona's population. */
  minimumAbsolute: number;
  /** Lower bound as a fraction of the corpus; the effective floor is the larger. */
  minimumShare: number;
  /** Upper bound as a fraction of the corpus. */
  maximumShare: number;
  /** Largest persona divided by smallest may not exceed this. */
  maximumSpreadRatio: number;
  /**
   * Largest share of the corpus that may be tied at the score where a persona's cut
   * falls. Above this the membership is arbitrary among the tied set and the ranking
   * cannot support a station.
   */
  maximumTieShareAtCut: number;
  /**
   * Largest Jaccard similarity permitted between two personas' member sets. Above it
   * they are the same station under two names.
   */
  maximumPairwiseJaccard: number;
  /**
   * Corpus size below which the two SEMANTIC checks — tie fraction at the cut, and
   * pairwise distinctness — are not applied.
   *
   * Both measure distributional properties, and on a handful of tracks they measure
   * discreteness instead. Nine stations drawn from a 6-track fixture are one track each
   * and any two that pick the same track score Jaccard 1.0, which says nothing about
   * whether the personas are distinct. The population checks still apply at every size.
   */
  minimumCorpusForSemanticChecks: number;
}

/**
 * Defaults, calibrated against HVSC and reported in the release notes.
 *
 * `targetShare` 0.2 mirrors the rating quintiles: nine stations of 17,573 tracks each
 * on an 87,868-track corpus, comfortably inside the floor and ceiling with a spread of
 * exactly 1.0 by construction.
 *
 * The floor is `max(minimumAbsolute, minimumShare * corpus)` so it scales down: someone
 * exporting a private 500-track collection cannot satisfy "at least 1,000 tracks" and
 * must not be blocked by a rule written for HVSC.
 *
 * `maximumTieShareAtCut` is the one number that is a compromise rather than a target,
 * and it is documented as such. An audio-led persona's score has at most 125 distinct
 * values corpus-wide, so its average tie group is already ~0.8% of the corpus before
 * anything goes wrong; a threshold tight enough to call that a defect would fail every
 * export, and a threshold loose enough to pass it still catches the case this check
 * exists for — a persona with no distinguishing signal at all, whose entire membership
 * is decided inside one tie. Worst observed on HVSC is 7.03% (`fast_paced`), against
 * 15.76% for `era_explorer` before its metadata signal was made content-based.
 *
 * `maximumPairwiseJaccard` is set with the same discipline. Worst observed on HVSC is
 * 0.488 (`melodic` / `deep_discovery`), against 0.838 before the hybrid blend was
 * rebalanced. 0.55 leaves headroom over what the corpus actually produces while still
 * failing anything approaching the duplicate-station case this check was added for.
 */
export const DEFAULT_STYLE_POPULATION_POLICY: StylePopulationPolicy = {
  targetShare: 0.2,
  minimumAbsolute: 1000,
  minimumShare: 0.05,
  maximumShare: 0.4,
  maximumSpreadRatio: 4,
  maximumTieShareAtCut: 0.12,
  maximumPairwiseJaccard: 0.55,
  minimumCorpusForSemanticChecks: 1000,
};

export interface StyleAssignmentTrack {
  track_id: string;
  sid_path: string;
  e: number;
  m: number;
  c: number;
  p?: number | null;
  /** Absent for callers with no local collection; the hybrids then score on audio alone. */
  metadata?: PersonaTrackMetadata;
  /** Only `deep_discovery` reads this. */
  rarity?: number;
  /** Corpus-relative; see `buildPersonaCorpusContext`. Only `composer_focus` reads it. */
  composerProminence?: number;
  /** Corpus-relative; read by `era_explorer` and `theme_hunter`. */
  yearPosition?: number;
}

export interface StyleAssignmentDiagnostics {
  /** Per-persona member count, in PERSONA_IDS order. */
  populations: Record<PersonaId, number>;
  /** Share of the corpus tied at the score where each persona's cut fell. */
  tieShareAtCut: Record<PersonaId, number>;
  /** Distinct score values each persona's ranking took across the corpus. */
  distinctScores: Record<PersonaId, number>;
  /** Highest Jaccard similarity between any two personas' member sets. */
  maximumPairwiseJaccard: number;
  /** Which pair reached it. */
  maximumPairwiseJaccardPersonas: [PersonaId, PersonaId] | null;
  /** Members shared by each declared conflicting pair. Must be zero. */
  conflictOverlaps: Array<{ personas: [PersonaId, PersonaId]; tracks: number }>;
}

export interface StyleAssignmentResult {
  /** One u16 mask per input track, in input order. Bit i is PERSONA_IDS[i]. */
  masks: Uint16Array;
  diagnostics: StyleAssignmentDiagnostics;
  policy: StylePopulationPolicy;
  /** True when the gate was bypassed by an explicit waiver. */
  waived: boolean;
  /** Gate violations, recorded even when waived so a bundle can never hide them. */
  violations: string[];
}

export interface AssignStyleMasksOptions {
  policy?: Partial<StylePopulationPolicy>;
  /**
   * Bypass the hard gate. The waiver is written into the manifest, so a bundle
   * produced under it can never be mistaken for one that passed.
   */
  allowSparseStyles?: boolean;
}

export class StylePopulationGateError extends Error {
  readonly violations: string[];
  readonly diagnostics: StyleAssignmentDiagnostics;

  constructor(violations: string[], diagnostics: StyleAssignmentDiagnostics) {
    super(
      `Station population gate failed:\n${violations.map((line) => `  - ${line}`).join("\n")}\n`
      + "Re-run with --allow-sparse-styles only if this corpus genuinely cannot support "
      + "nine stations; the waiver is recorded in the manifest.",
    );
    this.name = "StylePopulationGateError";
    this.violations = violations;
    this.diagnostics = diagnostics;
  }
}

/**
 * A stable, corpus-position-independent tie-breaker.
 *
 * Ties at the cut have to be broken somehow, and the obvious choices are both wrong.
 * Corpus order hands every tie to the same low-ordinal tracks — the exact pathology
 * that made tiny's favourites ranking return the same handful of tunes to every
 * listener. Alphabetical order does the same thing with a different bias. Hashing the
 * track id is still arbitrary, but it is arbitrary UNIFORMLY: the slice of a tied group
 * that gets in is spread across the collection rather than concentrated at its start,
 * which for a station is the difference between a representative sample and the
 * beginning of the alphabet.
 */
function tieBreakHash(trackId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < trackId.length; index += 1) {
    hash ^= trackId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function scoreContext(track: StyleAssignmentTrack): PersonaTrackContext {
  return {
    metrics: buildPersonaMetricsFromRatings(track),
    ratings: { e: track.e, m: track.m, c: track.c },
    ...(track.metadata ? { metadata: track.metadata } : {}),
    ...(track.rarity != null ? { rarity: track.rarity } : {}),
    ...(track.composerProminence != null ? { composerProminence: track.composerProminence } : {}),
    ...(track.yearPosition != null ? { yearPosition: track.yearPosition } : {}),
  };
}

function conflictsFor(personaId: PersonaId): PersonaId[] {
  const result: PersonaId[] = [];
  for (const [left, right] of STYLE_CONFLICT_PAIRS) {
    if (left === personaId) result.push(right);
    if (right === personaId) result.push(left);
  }
  return result;
}

/**
 * Assign every track its personas, corpus-relative, and gate the result.
 *
 * The algorithm in four steps:
 *
 *  1. score every track for every persona;
 *  2. rank each persona's scores descending, ties broken by `tieBreakHash`;
 *  3. walk each persona's ranking taking members until the target share is met,
 *     skipping any track already committed to a conflicting persona;
 *  4. measure, then refuse to return if the result would embarrass a station tile.
 *
 * Step 3 processes personas in a fixed order and commits as it goes, so a track
 * contested by `fast_paced` and `slow_ambient` goes to whichever ranks it better
 * relative to that persona's own distribution — and the loser simply reaches one place
 * further down its own list. That is why exclusivity costs nothing in population.
 */
export function assignSimilarityStyleMasks(
  tracks: readonly StyleAssignmentTrack[],
  options: AssignStyleMasksOptions = {},
): StyleAssignmentResult {
  const policy: StylePopulationPolicy = { ...DEFAULT_STYLE_POPULATION_POLICY, ...options.policy };
  const trackCount = tracks.length;
  const masks = new Uint16Array(trackCount);

  const populations = {} as Record<PersonaId, number>;
  const tieShareAtCut = {} as Record<PersonaId, number>;
  const distinctScores = {} as Record<PersonaId, number>;
  const memberSets = new Map<PersonaId, Set<number>>();

  if (trackCount === 0) {
    for (const personaId of PERSONA_IDS) {
      populations[personaId] = 0;
      tieShareAtCut[personaId] = 0;
      distinctScores[personaId] = 0;
      memberSets.set(personaId, new Set());
    }
    const emptyDiagnostics: StyleAssignmentDiagnostics = {
      populations,
      tieShareAtCut,
      distinctScores,
      maximumPairwiseJaccard: 0,
      maximumPairwiseJaccardPersonas: null,
      conflictOverlaps: STYLE_CONFLICT_PAIRS.map((pair) => ({ personas: [pair[0], pair[1]], tracks: 0 })),
    };
    return { masks, diagnostics: emptyDiagnostics, policy, waived: true, violations: [] };
  }

  // Score once per (track, persona). scoreTrackForPersona rebuilds the metric vector
  // internally, so the context is built once per track and reused across the nine.
  const contexts = tracks.map(scoreContext);
  const hashes = tracks.map((track) => tieBreakHash(track.track_id));
  const scoresByPersona = new Map<PersonaId, Float64Array>();
  for (const personaId of PERSONA_IDS) {
    const scores = new Float64Array(trackCount);
    for (let index = 0; index < trackCount; index += 1) {
      scores[index] = scoreTrackForPersona(contexts[index]!, personaId).score;
    }
    scoresByPersona.set(personaId, scores);
  }

  const target = Math.max(1, Math.round(policy.targetShare * trackCount));
  const committed = new Map<PersonaId, Set<number>>(PERSONA_IDS.map((id) => [id, new Set<number>()]));

  for (const personaId of PERSONA_IDS) {
    const scores = scoresByPersona.get(personaId)!;
    const order = Array.from({ length: trackCount }, (_, index) => index).sort(
      (left, right) => scores[right]! - scores[left]! || hashes[left]! - hashes[right]!,
    );
    const conflicting = conflictsFor(personaId);
    const members = committed.get(personaId)!;

    let cutScore = Number.NaN;
    for (const index of order) {
      if (members.size >= target) {
        break;
      }
      if (conflicting.some((other) => committed.get(other)!.has(index))) {
        continue;
      }
      members.add(index);
      cutScore = scores[index]!;
    }

    // How much of the corpus sits at exactly the score where the cut landed. A large
    // number means membership at the boundary was decided by the hash rather than by
    // anything about the music.
    let tiedAtCut = 0;
    if (Number.isFinite(cutScore)) {
      for (let index = 0; index < trackCount; index += 1) {
        if (scores[index] === cutScore) {
          tiedAtCut += 1;
        }
      }
    }
    tieShareAtCut[personaId] = tiedAtCut / trackCount;
    distinctScores[personaId] = new Set(scores).size;
    populations[personaId] = members.size;
    memberSets.set(personaId, members);
  }

  for (let bit = 0; bit < PERSONA_IDS.length; bit += 1) {
    const personaId = PERSONA_IDS[bit]!;
    for (const index of memberSets.get(personaId)!) {
      masks[index] = (masks[index]! | (1 << bit)) & 0xffff;
    }
  }

  let maximumPairwiseJaccard = 0;
  let maximumPairwiseJaccardPersonas: [PersonaId, PersonaId] | null = null;
  for (let left = 0; left < PERSONA_IDS.length; left += 1) {
    for (let right = left + 1; right < PERSONA_IDS.length; right += 1) {
      const leftSet = memberSets.get(PERSONA_IDS[left]!)!;
      const rightSet = memberSets.get(PERSONA_IDS[right]!)!;
      let intersection = 0;
      for (const index of leftSet) {
        if (rightSet.has(index)) {
          intersection += 1;
        }
      }
      const union = leftSet.size + rightSet.size - intersection;
      const jaccard = union === 0 ? 0 : intersection / union;
      if (jaccard > maximumPairwiseJaccard) {
        maximumPairwiseJaccard = jaccard;
        maximumPairwiseJaccardPersonas = [PERSONA_IDS[left]!, PERSONA_IDS[right]!];
      }
    }
  }

  const conflictOverlaps = STYLE_CONFLICT_PAIRS.map(([left, right]) => {
    const leftSet = memberSets.get(left)!;
    const rightSet = memberSets.get(right)!;
    let shared = 0;
    for (const index of leftSet) {
      if (rightSet.has(index)) {
        shared += 1;
      }
    }
    return { personas: [left, right] as [PersonaId, PersonaId], tracks: shared };
  });

  const diagnostics: StyleAssignmentDiagnostics = {
    populations,
    tieShareAtCut,
    distinctScores,
    maximumPairwiseJaccard,
    maximumPairwiseJaccardPersonas,
    conflictOverlaps,
  };

  const violations = evaluateStylePopulationGate(diagnostics, policy, trackCount);
  if (violations.length > 0 && !options.allowSparseStyles) {
    throw new StylePopulationGateError(violations, diagnostics);
  }

  return {
    masks,
    diagnostics,
    policy,
    waived: violations.length > 0 && options.allowSparseStyles === true,
    violations,
  };
}

/**
 * The gate itself, separated so a finished artefact can be checked against it too.
 *
 * The export runs it, and so does the release verifier — which is what catches a bundle
 * built under `--allow-sparse-styles` and published by mistake.
 */
export function evaluateStylePopulationGate(
  diagnostics: StyleAssignmentDiagnostics,
  policy: StylePopulationPolicy,
  trackCount: number,
): string[] {
  const violations: string[] = [];
  if (trackCount === 0) {
    return violations;
  }

  // The floor is capped by what the corpus can actually supply.
  //
  // `max(1000, 5%)` is the rule written for HVSC, where it lands at 4,393. Applied
  // literally to a private 500-track collection it demands 1,000 tracks per station out
  // of 500 in total — unsatisfiable, and blocking a legitimate export with a rule that
  // was never about it. Capping at the target share makes the floor a real constraint
  // wherever it can be met and a no-op where it cannot.
  //
  // Under quantile assignment the cap makes the floor largely decorative, since the
  // strategy already guarantees the share. It stays because it is what would catch a
  // future change to that strategy, which is precisely how the 0.7.0 export shipped a
  // station with zero members.
  const targetPopulation = Math.max(1, Math.round(policy.targetShare * trackCount));
  const floor = Math.min(
    Math.max(policy.minimumAbsolute, Math.ceil(policy.minimumShare * trackCount)),
    targetPopulation,
  );
  // Floored at the target for the mirror-image reason: on a 2-track corpus
  // `floor(40% of 2)` is 0, so a station of the one track the strategy assigned would be
  // "above the ceiling". Both bounds have to admit what the assignment can produce.
  const ceiling = Math.max(targetPopulation, Math.floor(policy.maximumShare * trackCount));

  const counts = PERSONA_IDS.map((personaId) => diagnostics.populations[personaId] ?? 0);
  for (const [index, personaId] of PERSONA_IDS.entries()) {
    const count = counts[index]!;
    if (count === 0) {
      violations.push(`${personaId} matches 0 tracks — a station tile that can never play anything`);
      continue;
    }
    if (count < floor) {
      violations.push(
        `${personaId} has ${count} tracks, below the floor of ${floor} `
        + `(max(${policy.minimumAbsolute}, ${(policy.minimumShare * 100).toFixed(0)}% of ${trackCount}))`,
      );
    }
    if (count > ceiling) {
      violations.push(
        `${personaId} has ${count} tracks, above the ceiling of ${ceiling} `
        + `(${(policy.maximumShare * 100).toFixed(0)}% of ${trackCount}) — a filter that admits that much is not a filter`,
      );
    }
  }

  const populated = counts.filter((count) => count > 0);
  if (populated.length > 1) {
    const spread = Math.max(...populated) / Math.min(...populated);
    if (spread > policy.maximumSpreadRatio) {
      violations.push(
        `largest station is ${spread.toFixed(1)}x the smallest, above the permitted ${policy.maximumSpreadRatio}x`,
      );
    }
  }

  for (const overlap of diagnostics.conflictOverlaps) {
    if (overlap.tracks > 0) {
      violations.push(
        `${overlap.personas[0]} and ${overlap.personas[1]} share ${overlap.tracks} tracks; `
        + "they are declared mutually exclusive",
      );
    }
  }

  // Below this the two checks below measure discreteness rather than distribution; see
  // minimumCorpusForSemanticChecks.
  if (trackCount < policy.minimumCorpusForSemanticChecks) {
    return violations;
  }

  for (const personaId of PERSONA_IDS) {
    const tieShare = diagnostics.tieShareAtCut[personaId] ?? 0;
    if (tieShare > policy.maximumTieShareAtCut) {
      violations.push(
        `${personaId} decides ${(tieShare * 100).toFixed(1)}% of the corpus inside a single tie at its cut, `
        + `above the permitted ${(policy.maximumTieShareAtCut * 100).toFixed(0)}% — its ranking cannot support a station`,
      );
    }
  }

  if (diagnostics.maximumPairwiseJaccard > policy.maximumPairwiseJaccard) {
    const pair = diagnostics.maximumPairwiseJaccardPersonas;
    violations.push(
      `${pair ? `${pair[0]} and ${pair[1]}` : "two personas"} overlap at Jaccard `
      + `${diagnostics.maximumPairwiseJaccard.toFixed(2)}, above the permitted `
      + `${policy.maximumPairwiseJaccard.toFixed(2)} — they are the same station under two names`,
    );
  }

  return violations;
}

/** Recount populations from a finished mask table, for verifying a published bundle. */
export function countStylePopulations(masks: Iterable<number>): Record<PersonaId, number> {
  const populations = {} as Record<PersonaId, number>;
  for (const personaId of PERSONA_IDS) {
    populations[personaId] = 0;
  }
  for (const mask of masks) {
    for (const [bit, personaId] of PERSONA_IDS.entries()) {
      if ((mask & (1 << bit)) !== 0) {
        populations[personaId] += 1;
      }
    }
  }
  return populations;
}

/** Human-readable coverage table, for release notes and gate failures. */
export function formatStylePopulations(
  populations: Record<PersonaId, number>,
  trackCount: number,
): string {
  return PERSONA_IDS
    .map((personaId) => {
      const count = populations[personaId] ?? 0;
      const share = trackCount > 0 ? (count / trackCount) * 100 : 0;
      return `  ${personaId.padEnd(16)} ${String(count).padStart(7)}  ${share.toFixed(1)}%  ${PERSONAS[personaId].label}`;
    })
    .join("\n");
}
