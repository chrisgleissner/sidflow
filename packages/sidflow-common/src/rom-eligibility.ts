/** Offline listener-relevant ROM eligibility. Compatible means no material
 * audible difference against the pinned full-ROM reference through the stored
 * horizon. Consumers must zero absent banks, match engine/profile/model hashes,
 * and stop at the deadline. Unknown is reserved for inadequate evidence.
 * See doc/research/hvsc-rom-production.md for thresholds and limitations.
 */
import { createHash } from "node:crypto";
import { stringifyDeterministic, type JsonValue } from "./json.js";

export const ROM_ELIGIBILITY_METHODOLOGY = "rom-audit-4";
export const ROM_DENY_SCHEMA = "sidflow-rom-deny-4";
/** The reference system ROM images. Any other image denies. */
export const REFERENCE_ROM_SHA256 = {
  kernal: "83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721",
  basic: "89878cea0a268734696de11c4bae593eaaa506465d2029d619c0e0cbccdfa62d",
  chargen: "fd0d53b8480e86163ac98998976c72cc58d5dd8eb824ed7b829774e74213b420",
} as const;
/** Renderers the audit can qualify. Both are WASM builds in the same package. */
export const ROM_AUDIT_ENGINES = ["sidlite", "residfp"] as const;
export type RomAuditEngine = (typeof ROM_AUDIT_ENGINES)[number];
/** The machine a published decision describes, as C64 Commander configures it (read from its source). */
export function romConsumerProfile(engine: RomAuditEngine) {
  return {
    engine,
    package: "libsidplayfp-wasm@1.1.1",
    sampleRate: 48000,
    stereo: true,
    powerOnDelay: "engine default (8191)",
    pullCycles: 100000,
    sidModel: "from header; engine default where the header does not name one",
    subtuneSelection: "start-song header rewrite before load",
    romSets: { full: "KERNAL and BASIC supplied, CHARGEN null", none: "KERNAL, BASIC and CHARGEN all null" },
    nullBanks: "absent banks must be zeroed before each player; listener-v1",
  } as const;
}
export type RomConsumerProfile = ReturnType<typeof romConsumerProfile>;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => stringifyDeterministic(value as JsonValue, 0);
/** Identity of the engine build plus the consumer profile that evidence was produced under. */
export function romEngineId(engine: { sourceSha256: string; wasmSha256: string }, profile: RomConsumerProfile): string {
  return sha256(canonical({ source: engine.sourceSha256, wasm: engine.wasmSha256, profile }));
}
export const romSetId = (): string => sha256(canonical(REFERENCE_ROM_SHA256));

/**
 * [compatible mask bits, incompatible mask bits, maxPlaybackMs, documentedMs, modelFixed]. Bit M is ROM mask M.
 * `modelFixed` is 1 when the SID header names the model of every chip, so the decision holds whatever fallback
 * model the consumer forces; otherwise it was measured with the MOS8580 fallback and denies a MOS6581 consumer.
 */
export type RomDecision = [compatibleByte: number, incompatibleByte: number, maxPlaybackMs: number, documentedMs: number, modelFixed: number];
export type FallbackSidModel = "MOS6581" | "MOS8580";
export interface RomDenyList {
  schema: typeof ROM_DENY_SCHEMA;
  /** Every entry in this file describes this renderer. Older v4 files bind it through engineId. */
  engine?: RomAuditEngine;
  engineId: string;
  romSetId: string;
  methodology: string;
  /** Complete-file SHA-256 -> subtune at song-1 -> bounded decision. */
  entries: Record<string, RomDecision[]>;
}
/** SHA-256 of a present ROM image, or null for an absent ROM. KERNAL=1, BASIC=2, CHARGEN=4 in the mask. */
export interface RomSelection { kernal: string | null; basic: string | null; chargen: string | null }
export interface RomEligibility {
  eligible: boolean;
  state: "compatible" | "incompatible" | "unknown";
  reason: string;
  /** Hard stop in emulated seconds since reset; null when not eligible. */
  maxPlaybackSeconds: number | null;
  /** The documented musical duration; the remainder up to the deadline is an observation margin. */
  documentedSeconds: number | null;
}
/**
 * Mask of a Commander ROM set: 0 nothing supplied, 3 KERNAL+BASIC supplied with CHARGEN null.
 * `null` for anything else, including a non-reference image and the all-three set Commander never creates.
 */
export function romMask(roms: RomSelection): number | null {
  const slots = [roms?.kernal, roms?.basic, roms?.chargen];
  if (slots.some(v => v !== null && typeof v !== "string")) return null;
  for (const [index, key] of (["kernal", "basic", "chargen"] as const).entries())
    if (slots[index] !== null && slots[index] !== REFERENCE_ROM_SHA256[key]) return null;
  const [kernal, basic, chargen] = slots.map(v => v !== null);
  if (!kernal && !basic && !chargen) return 0;
  if (kernal && basic && !chargen) return 3;
  return null;
}
export function createRomEligibilityLookup(data: RomDenyList,
  expected: { sourceSha256: string; wasmSha256: string; profile: RomConsumerProfile; methodology: string; fallbackSidModel: FallbackSidModel }):
  (sha256: string, song: number, roms: RomSelection, elapsedSeconds?: number) => RomEligibility {
  const deny = (reason: string): RomEligibility => ({ eligible: false, state: "unknown", reason, maxPlaybackSeconds: null, documentedSeconds: null });
  const hash = (v: unknown): boolean => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const engineId = romEngineId(expected, expected.profile);
  const matches = (expected.fallbackSidModel === "MOS6581" || expected.fallbackSidModel === "MOS8580") && data?.schema === ROM_DENY_SCHEMA && hash(data.engineId) && hash(data.romSetId) &&
    data.engineId === engineId && (data.engine === undefined || data.engine === expected.profile.engine) && data.romSetId === romSetId() &&
    data.methodology === ROM_ELIGIBILITY_METHODOLOGY && data.methodology === expected.methodology;
  const valid = matches && data.entries !== null && typeof data.entries === "object" && !Array.isArray(data.entries) &&
    Object.entries(data.entries).every(([identity, songs]) => hash(identity) && Array.isArray(songs) && songs.length > 0 &&
      songs.every(pair => Array.isArray(pair) && pair.length === 5 && ((pair[0] | pair[1]) & ~0b00001001) === 0 && (pair[4] === 0 || (pair[4] === 1 && (pair[0] | pair[1]) !== 0)) &&
        pair.slice(0, 2).every(n => Number.isInteger(n) && n >= 0 && n <= 255) && !(pair[0] & pair[1]) &&
        Number.isSafeInteger(pair[2]) && Number.isSafeInteger(pair[3]) && pair[3] >= 0 &&
        (pair[0] ? pair[2] > 0 && pair[2] <= 3600000 && pair[3] > 0 && pair[3] < pair[2] : pair[2] === 0 && pair[3] === 0)));
  // Snapshot to prevent later caller mutation from changing validated decisions.
  const entries = new Map(valid ? Object.entries(data.entries).map(([identity, songs]) =>
    [identity, songs.map(pair => [...pair] as RomDecision)] as const) : []);
  return (sha, song, roms, elapsedSeconds = 0) => {
    if (!valid) return deny("catalogue-provenance-or-schema-mismatch");
    const mask = romMask(roms);
    if (mask === null) return deny("not-a-supported-rom-set");
    if (!Number.isInteger(song) || song < 1 || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return deny("invalid-lookup");
    const pair = entries.get(sha)?.[song - 1];
    if (!pair) return deny("missing-entry");
    // Positive and negative measurements both describe the measured model.
    if (((pair[0] | pair[1]) & (1 << mask)) && expected.fallbackSidModel !== "MOS8580" && pair[4] !== 1)
      return deny("depends-on-fallback-sid-model");
    if (pair[0] & (1 << mask)) {
      if (elapsedSeconds * 1000 >= pair[2]) return deny("observation-horizon-exhausted");
      return { eligible: true, state: "compatible", reason: "listener-equivalent-through-documented-horizon", maxPlaybackSeconds: pair[2] / 1000, documentedSeconds: pair[3] / 1000 };
    }
    if (pair[1] & (1 << mask)) return { eligible: false, state: "incompatible", reason: "audible-output-difference", maxPlaybackSeconds: null, documentedSeconds: null };
    return deny("compatibility-unresolved");
  };
}
