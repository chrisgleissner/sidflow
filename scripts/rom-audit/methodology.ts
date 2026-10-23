/** Versioned evidence policy (methodology 3): decisions come from lockstep renders on the shipping engine. */
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
export const METHODOLOGY = "rom-audit-3";
export const CENSUS_SCHEMA = "sidflow-rom-census-1";
export const ROM_MASKS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
/** The ROM sets C64 Commander can create (KERNAL=1, BASIC=2, CHARGEN=4): nothing, KERNAL+BASIC with CHARGEN null, everything. */
export const CONSUMER_MASKS = [0, 3, 7] as const;
export type Compatibility = "compatible" | "incompatible" | "unknown";
export interface Horizon {
  token: string | null;
  seconds: number;
  documentedSeconds: number | null;
  source: "Songlengths.md5";
  limitation: string;
}
/** Do not use parseSonglengthValue here: it drops invalid tokens and shifts subtunes. */
export function observationHorizon(token: string | undefined, minimum = 10): Horizon {
  if (!Number.isFinite(minimum) || minimum <= 0) throw new Error("Invalid minimum observation duration");
  const match = token?.match(/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/);
  // Keep the metadata's millisecond precision until the final division. Adding
  // fractional seconds twice produces 66.38499999999999 for 1:01.385 + 5s.
  const parsedMs = match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? "0").padEnd(3, "0")) : 0;
  const durationMs = Number.isSafeInteger(parsedMs) && parsedMs > 0 ? parsedMs : 0;
  const minimumMs = Math.ceil(minimum * 1000);
  if (!Number.isSafeInteger(minimumMs) || minimumMs > 3600000) throw new Error("Unsupported minimum observation duration");
  return {
    token: token ?? null, seconds: Math.max(minimumMs, durationMs > 0 ? durationMs + 5000 : 300000) / 1000,
    documentedSeconds: durationMs > 0 ? durationMs / 1000 : null, source: "Songlengths.md5",
    limitation: durationMs > 0 ? "Documented duration plus 5s ending margin; loop recurrence and interactivity unproven"
      : "Unknown/invalid duration: 300s fallback is exploratory; coverage unresolved",
  };
}

export type LaneOutcome = "identical" | "different" | "halt" | "error" | "reference-failed" | "trace-dropped";
export interface LaneResult {
  /** `full`: KERNAL and BASIC supplied, CHARGEN null. `none`: nothing supplied. `fill`: content of the null banks. */
  set: "full" | "none"; fill: "zero" | "ff";
  outcome: LaneOutcome; samples: number; writes: number; firstDifferenceSample: number | null; message: string;
  pcmSha256: string; traceSha256: string;
}
export interface ReferenceResult {
  outcome: "clean" | "failed" | "trace-dropped"; samples: number; writes: number; message: string;
  pcmSha256: string; traceSha256: string;
  /** A second fresh instance of the reference configuration: determinism of the engine for this subtune. */
  repeat: "identical" | "different" | "failed";
}
export interface EngineRun { engine: RomAuditEngine; reference: ReferenceResult; lanes: LaneResult[] }
/** One checkpoint line: everything measured for one subtune. */
export interface CensusRecord {
  schema: typeof CENSUS_SCHEMA; sha256: string; song: number; seconds: number; sampleRate: number; runs: EngineRun[];
  /** A job that timed out or threw is recorded, not retried forever: every decision for it is unknown. */
  failure?: { reason: "timeout" | "exception"; message: string };
}
export interface Assessment { state: Compatibility; reason: string }

const unknown = (reason: string): Assessment => ({ state: "unknown", reason });
/**
 * Decision for one ROM set of one engine run.
 * - mask 7 (all authentic ROMs): compatible when the reference is clean and reproducible.
 * - mask 3 / mask 0: compatible only if both fills of the null banks match the reference through
 *   the whole horizon; incompatible only if both fills end in an illegal opcode.
 * - every other mask is not a configuration the consumer can create: unknown.
 * Anything short of the documented duration plus margin, or without a documented duration, is unknown.
 */
export function assessMask(run: EngineRun | undefined, horizon: Horizon, observedSeconds: number, sampleRate: number, mask: number): Assessment {
  const canonical = observationHorizon(typeof horizon?.token === "string" ? horizon.token : undefined, 0.001);
  if (!horizon || !Number.isFinite(horizon.seconds) || horizon.seconds <= 0 || horizon.seconds > 3600 || horizon.documentedSeconds !== canonical.documentedSeconds ||
      horizon.source !== "Songlengths.md5" || horizon.seconds < canonical.seconds || Math.round(horizon.seconds * 1000) / 1000 !== horizon.seconds)
    return unknown("invalid-observation-horizon");
  if (!run) return unknown("experiment-pending");
  if (!(CONSUMER_MASKS as readonly number[]).includes(mask)) return unknown("not-a-consumer-rom-set");
  if (!Number.isFinite(observedSeconds) || observedSeconds <= 0) return unknown("invalid-observation");
  const wanted = Math.round(observedSeconds * sampleRate) * 2;
  const ref = run.reference;
  if (ref.outcome !== "clean" || ref.samples !== wanted) return unknown("reference-failed");
  if (ref.repeat !== "identical") return unknown("reference-unstable");
  if (horizon.documentedSeconds === null) return unknown("observation-horizon-incomplete");
  if (observedSeconds < horizon.seconds) return unknown("observation-horizon-incomplete");
  if (mask === 7) return { state: "compatible", reason: "reference-reproducible-through-documented-horizon" };
  const set = mask === 3 ? "full" : "none";
  const lanes = run.lanes.filter(l => l.set === set);
  if (lanes.length !== 2 || new Set(lanes.map(l => l.fill)).size !== 2) return unknown("experiment-pending");
  if (lanes.every(l => l.outcome === "identical" && l.samples === wanted)) return { state: "compatible", reason: "identical-for-both-null-bank-fills-through-documented-horizon" };
  if (lanes.every(l => l.outcome === "halt")) return { state: "incompatible", reason: "cpu-halt-for-both-null-bank-fills" };
  if (lanes.some(l => l.outcome === "error" || l.outcome === "reference-failed" || l.outcome === "trace-dropped")) return unknown("non-tune-error");
  if (lanes.some(l => l.outcome === "identical")) return unknown("depends-on-null-bank-content");
  return unknown("output-diverges");
}

/** Reject corrupt checkpoint structures rather than interpreting them as evidence. */
export function validateRecord(record: CensusRecord, engines: readonly RomAuditEngine[]): void {
  const hex = (v: unknown): boolean => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (record?.schema !== CENSUS_SCHEMA || !hex(record.sha256) || !Number.isSafeInteger(record.song) || record.song < 1 || record.song > 256 ||
      !Number.isFinite(record.seconds) || record.seconds <= 0 || record.seconds > 3600 || Math.round(record.seconds * 1000) / 1000 !== record.seconds ||
      !Number.isSafeInteger(record.sampleRate) || !Array.isArray(record.runs))
    throw new Error("Invalid census record header");
  if (record.failure !== undefined) {
    if (!["timeout", "exception"].includes(record.failure.reason) || typeof record.failure.message !== "string" || record.runs.length !== 0)
      throw new Error("Invalid census failure record");
    return;
  }
  if (record.runs.length !== engines.length) throw new Error("Invalid census record header");
  const wanted = Math.round(record.seconds * record.sampleRate) * 2;
  record.runs.forEach((run, index) => {
    if (run?.engine !== engines[index]) throw new Error("Census record engine order mismatch");
    const ref = run.reference;
    if (!ref || !["clean", "failed", "trace-dropped"].includes(ref.outcome) || !Number.isSafeInteger(ref.samples) || ref.samples < 0 || !Number.isSafeInteger(ref.writes) ||
        ref.writes < 0 || !hex(ref.pcmSha256) || !hex(ref.traceSha256) || !["identical", "different", "failed"].includes(ref.repeat) ||
        (ref.outcome === "clean" && ref.samples !== wanted))
      throw new Error("Invalid census reference");
    if (!Array.isArray(run.lanes) || run.lanes.length !== 4) throw new Error("Invalid census lanes");
    const seen = new Set<string>();
    for (const lane of run.lanes) {
      const key = `${lane.set}/${lane.fill}`;
      if (!["full", "none"].includes(lane.set) || !["zero", "ff"].includes(lane.fill) || seen.has(key) ||
          !["identical", "different", "halt", "error", "reference-failed", "trace-dropped"].includes(lane.outcome) ||
          !Number.isSafeInteger(lane.samples) || lane.samples < 0 || !Number.isSafeInteger(lane.writes) || lane.writes < 0 || !hex(lane.pcmSha256) || !hex(lane.traceSha256) ||
          (lane.outcome === "identical" && (ref.outcome !== "clean" || lane.samples !== wanted || lane.pcmSha256 !== ref.pcmSha256 || lane.traceSha256 !== ref.traceSha256 || lane.writes !== ref.writes)) ||
          (lane.outcome === "halt" && !lane.message.startsWith("Illegal instruction $")) ||
          (lane.firstDifferenceSample !== null && (!Number.isSafeInteger(lane.firstDifferenceSample) || lane.firstDifferenceSample < 0)))
        throw new Error(`Invalid census lane ${key}`);
      seen.add(key);
    }
    if (ref.repeat === "identical" && ref.outcome !== "clean") throw new Error("Contradictory reference repeat");
  });
}
