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
 *   duration <= 10s    skip 0s,    analyse the whole tune
 *   duration = 20s     skip 7.5s,  analyse 12.5s
 *   duration >= 30s    skip 15s,   analyse 15s   (unchanged from before)
 *
 * Linear between 10s and 30s, so there is no discontinuity where a one-second difference
 * in song length produces a completely different description of the same tune. Clamping
 * the skip at zero makes tunes under ten seconds fall out of the same formula rather than
 * needing a special case: the window simply becomes the whole tune.
 *
 * **Every song is classified, including very short ones.** An earlier version of this
 * excluded anything under ten seconds, on the argument that fifteen dimensions describe
 * rates, regularities and entropies over frames and a handful of frames cannot support
 * them. That reasoning still holds, but it is the consumer's call to make, not this
 * function's: dropping 16% of HVSC from the published corpus would surprise anyone
 * comparing it against the collection. The features are computed from real data in every
 * case, and `sidTraceFrameCount` reports how many frames each one was measured over, so a
 * consumer that wants to filter on evidence has the number to filter on.
 */

/** Below this the skip is zero and the whole tune is analysed. */
export const MIN_ANALYSABLE_SECONDS = 10;
/** At and above this the full configured intro skip applies. */
export const FULL_SKIP_SECONDS = 30;

export interface AnalysisWindow {
  /** Seconds to skip before the analysis window opens. */
  skipSeconds: number;
  /** Length of the analysis window in seconds. */
  analysisSeconds: number;
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
    return { skipSeconds: skipCeiling, analysisSeconds: analysisCeiling };
  }

  if (durationSeconds >= FULL_SKIP_SECONDS) {
    return { skipSeconds: skipCeiling, analysisSeconds: analysisCeiling };
  }

  // Linear ramp: zero at MIN_ANALYSABLE_SECONDS, the full skip at FULL_SKIP_SECONDS. The
  // lower clamp is what handles tunes shorter than MIN_ANALYSABLE_SECONDS -- the fraction
  // goes negative and the skip becomes zero, so the window is the whole tune.
  const fraction = (durationSeconds - MIN_ANALYSABLE_SECONDS)
    / (FULL_SKIP_SECONDS - MIN_ANALYSABLE_SECONDS);
  const skipSeconds = Math.max(0, Math.min(skipCeiling, skipCeiling * fraction));
  // Whatever is left of the tune, never more than the configured window.
  const analysisSeconds = Math.max(0.1, Math.min(analysisCeiling, durationSeconds - skipSeconds));
  return { skipSeconds, analysisSeconds };
}
