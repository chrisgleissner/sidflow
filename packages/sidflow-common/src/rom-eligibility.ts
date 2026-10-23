/**
 * Offline, bounded ROM eligibility for HVSC subtunes, per SID renderer.
 *
 * A `compatible` bit means: on the pinned engine (`libsidplayfp-wasm` 1.1.0, the renderer
 * named by the profile), configured exactly as the consumer profile, a fresh playback
 * with that ROM set produced the same PCM and the same cycle-timed SID writes as the
 * full-ROM reference for the whole documented duration plus a 5 s margin. It is not a
 * statement about any other engine, version, sample rate, ROM image or about looping.
 *
 * The ROM sets are those C64 Commander can create: KERNAL and BASIC supplied together
 * (CHARGEN always `null`), or nothing supplied. A bank the consumer leaves `null` keeps
 * whatever the engine heap held, so a decision requires identical output with that bank
 * filled with zeros and with 0xFF, which shows the run does not depend on its content.
 *
 * Consumer obligations (the lookup can only verify the identities it is given):
 *  - build the lookup from your ACTUAL profile and engine hashes; a different profile
 *    derives a different engine id and every query denies;
 *  - pass the SHA-256 of each present ROM and `null` for an absent one;
 *  - each eligible playback starts from a new player with that ROM set; ROMs are never
 *    changed during a playback;
 *  - elapsed time is emulated time since reset; stop at `maxPlaybackSeconds`; repetition is
 *    only a fresh restart; never continue past the deadline.
 * Verify artifact checksums against a trusted manifest before loading.
 */
import { createHash } from "node:crypto";
import { stringifyDeterministic, type JsonValue } from "./json.js";

export const ROM_ELIGIBILITY_METHODOLOGY = "rom-audit-3";
export const ROM_DENY_SCHEMA = "sidflow-rom-deny-3";
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
    package: "libsidplayfp-wasm@1.1.0",
    sampleRate: 48000,
    stereo: true,
    powerOnDelay: "engine default (8191)",
    pullCycles: engine === "sidlite" ? 256 : 100000,
    sidModel: "from header; engine default where the header does not name one",
    subtuneSelection: "start-song header rewrite before load",
    romSets: { full: "KERNAL and BASIC supplied, CHARGEN null", none: "KERNAL, BASIC and CHARGEN all null" },
    nullBanks: "uninitialised in the consumer; decisions require identical output with zero and 0xFF fills",
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

/** [compatible mask bits, incompatible mask bits, maxPlaybackMs, documentedMs]. Bit M is ROM mask M. */
export type RomDecision = [compatibleByte: number, incompatibleByte: number, maxPlaybackMs: number, documentedMs: number];
export interface RomDenyList {
  schema: typeof ROM_DENY_SCHEMA;
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
 * Mask of a Commander ROM set: 0 nothing supplied, 3 KERNAL+BASIC supplied with CHARGEN null,
 * 7 all three reference images. `null` for anything else, including a non-reference image.
 */
export function romMask(roms: RomSelection): number | null {
  const slots = [roms?.kernal, roms?.basic, roms?.chargen];
  if (slots.some(v => v !== null && typeof v !== "string")) return null;
  for (const [index, key] of (["kernal", "basic", "chargen"] as const).entries())
    if (slots[index] !== null && slots[index] !== REFERENCE_ROM_SHA256[key]) return null;
  const [kernal, basic, chargen] = slots.map(v => v !== null);
  if (!kernal && !basic && !chargen) return 0;
  if (kernal && basic && !chargen) return 3;
  if (kernal && basic && chargen) return 7;
  return null;
}
export function createRomEligibilityLookup(data: RomDenyList,
  expected: { sourceSha256: string; wasmSha256: string; profile: RomConsumerProfile; methodology: string }):
  (sha256: string, song: number, roms: RomSelection, elapsedSeconds?: number) => RomEligibility {
  const deny = (reason: string): RomEligibility => ({ eligible: false, state: "unknown", reason, maxPlaybackSeconds: null, documentedSeconds: null });
  const hash = (v: unknown): boolean => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const engineId = romEngineId(expected, expected.profile);
  const matches = data?.schema === ROM_DENY_SCHEMA && hash(data.engineId) && hash(data.romSetId) &&
    data.engineId === engineId && data.romSetId === romSetId() &&
    data.methodology === ROM_ELIGIBILITY_METHODOLOGY && data.methodology === expected.methodology;
  const valid = matches && data.entries !== null && typeof data.entries === "object" && !Array.isArray(data.entries) &&
    Object.entries(data.entries).every(([identity, songs]) => hash(identity) && Array.isArray(songs) && songs.length > 0 &&
      songs.every(pair => Array.isArray(pair) && pair.length === 4 &&
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
    if (pair[0] & (1 << mask)) {
      if (elapsedSeconds * 1000 >= pair[2]) return deny("observation-horizon-exhausted");
      return { eligible: true, state: "compatible", reason: "bounded-documented-horizon-equality", maxPlaybackSeconds: pair[2] / 1000, documentedSeconds: pair[3] / 1000 };
    }
    if (pair[1] & (1 << mask)) return { eligible: false, state: "incompatible", reason: "confirmed-cpu-halt", maxPlaybackSeconds: null, documentedSeconds: null };
    return deny("compatibility-unresolved");
  };
}
