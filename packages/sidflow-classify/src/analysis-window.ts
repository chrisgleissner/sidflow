/**
 * Which part of a tune to analyse, as a function of how long the tune is.
 *
 * A fixed 15-second intro skip is right for a full-length tune and wrong for a jingle. It
 * skips the opening because a tune's first seconds are its least characteristic part —
 * fade-ins, a bare bass line, a title jingle — but applied to a 12-second subsong it skips
 * the whole thing. Measured on HVSC: **16,398 of 87,868 tracks (18.66%)** ended up
 * described by an analysis window that opened after the music had stopped, and 34 of the 58
 * similarity dimensions became a shared constant across a fifth of the corpus.
 *
 * The rule scales the skip with the tune instead:
 *
 *   duration < 10s     excluded from the corpus entirely
 *   duration = 10s     skip 0s,    analyse all 10s
 *   duration = 20s     skip 7.5s,  analyse 12.5s
 *   duration >= 30s    skip 15s,   analyse 15s   (unchanged from before)
 *
 * Linear between 10s and 30s, so there is no discontinuity where a one-second difference
 * in song length produces a completely different description of the same tune.
 *
 * Under ten seconds a tune is dropped rather than analysed on a shorter window. Fifteen
 * dimensions describe rates, regularities and entropies over frames, and below about ten
 * seconds there are too few frames for those to mean anything — the values would be real
 * numbers computed from too little evidence, which is worse than an absent track because
 * it looks the same as a measurement.
 */

/** Below this a tune is excluded from the corpus. */
export const MIN_ANALYSABLE_SECONDS = 10;
/** At and above this the full configured intro skip applies. */
export const FULL_SKIP_SECONDS = 30;

export interface AnalysisWindow {
  /** Seconds to skip before the analysis window opens. */
  skipSeconds: number;
  /** Length of the analysis window in seconds. */
  analysisSeconds: number;
  /** True when the tune is too short to describe and should not be classified. */
  excluded: boolean;
}

/**
 * @param durationSeconds Song length, from Songlengths where known. When unknown, pass the
 *   rendered duration; when neither is available pass `undefined` and the configured skip
 *   is used unchanged, because guessing "short" would drop real tunes.
 */
export function resolveAnalysisWindow(
  durationSeconds: number | undefined,
  introSkipSeconds: number,
  maxClassifySeconds: number,
): AnalysisWindow {
  const skipCeiling = Math.max(0, introSkipSeconds);
  const analysisCeiling = Math.max(1, maxClassifySeconds);

  // No duration to reason about: behave exactly as before rather than assume.
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { skipSeconds: skipCeiling, analysisSeconds: analysisCeiling, excluded: false };
  }

  if (durationSeconds < MIN_ANALYSABLE_SECONDS) {
    return { skipSeconds: 0, analysisSeconds: Math.max(1, durationSeconds), excluded: true };
  }

  if (durationSeconds >= FULL_SKIP_SECONDS) {
    return { skipSeconds: skipCeiling, analysisSeconds: analysisCeiling, excluded: false };
  }

  // Linear ramp: 0 at MIN_ANALYSABLE_SECONDS, the full skip at FULL_SKIP_SECONDS.
  const fraction = (durationSeconds - MIN_ANALYSABLE_SECONDS)
    / (FULL_SKIP_SECONDS - MIN_ANALYSABLE_SECONDS);
  const skipSeconds = Math.max(0, Math.min(skipCeiling, skipCeiling * fraction));
  // Whatever is left of the tune, never more than the configured window.
  const analysisSeconds = Math.max(1, Math.min(analysisCeiling, durationSeconds - skipSeconds));
  return { skipSeconds, analysisSeconds, excluded: false };
}
