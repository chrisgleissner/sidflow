/** Pure grade mapping (see doc/research/hvsc-rom-fidelity-grading.md).
 *   255  bit-exact trace
 *   254  identical value sequence and count, every write within T cycles after the constant start offset
 *   1-253 max(1, round(253 * Q')) with Q' = Q^gamma, Q = 1 - mean window severity
 *   0    Q' < 1/506 (no playback) */
export const GRADE_BIT_EXACT = 255;
export const GRADE_RETIMED = 254;
export const GRADE_AUDIO_MAX = 253;
export const NO_PLAYBACK_Q = 1 / 506;

export function gradeFromQuality(q: number): number {
  if (!Number.isFinite(q)) throw new Error("Quality must be finite");
  const clamped = Math.min(1, Math.max(0, q));
  if (clamped < NO_PLAYBACK_Q) return 0;
  return Math.max(1, Math.round(GRADE_AUDIO_MAX * clamped));
}

export type GradeBasis = "trace-bit-exact" | "chargen-unread" | "trace-retimed" | "trace-no-playback" | "audio" | "unmeasurable";

/** Perceptual exponent Q' = Q^gamma, frozen at 1 by the calibration (no evidence supported another value). */
export const DEFAULT_GAMMA = 1;
/** Consumer policy decided with the calibration: C64 Commander skips a lane graded below this ("plays acceptably" boundary). */
export const RECOMMENDED_MIN_GRADE = 128;
/** A subtune is listed in the consumer dependency list iff some lane grades at or below this. */
export const CONSUMER_LIST_CEILING = 191;
