/**
 * Reads a ROM audit "Commander bundle" (scripts/rom-audit/, `<out>/published/`) and derives the
 * SID ROM Dependency List content from it. Read-only with respect to scripts/rom-audit/.
 * Shared by generate.ts and verify.ts so both interpret the bundle identically.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ROM_DEP_ALL_LANES,
  ROM_DEP_LANE_BITS,
  ROM_DEP_LANE_NAMES,
  ROM_DEP_MAX_SUBTUNE,
  derivePlaybackHorizonMs,
  parseSonglengthsMd5,
  sha256Hex,
  type RomDepEntry,
  type RomDepProvenance,
} from "../../packages/sidflow-common/src/rom-dependency-list.js";
import { REFERENCE_ROM_SHA256, romSetId } from "../../packages/sidflow-common/src/rom-eligibility.js";

export interface SourceManifest {
  schema: string;
  methodology: string;
  complete: boolean;
  releaseReady: boolean;
  corpus: string;
  files: number;
  subtunes: number;
  measuredSubtunes: number;
  pendingSubtunes: number;
  failedSubtunes: number;
  unknownSubtunes: number;
  exceptionSubtunes: number;
  engineIds: Record<string, string>;
  engines: Record<string, Record<string, string>>;
  nativeHashes: Record<string, string>;
  romSetId: string;
  sourceIdentity: string;
  documents: Record<string, string>;
  artifacts: Record<string, string>;
  counts: unknown;
  scope: string;
}

/** Returns the SHA-256 of the verified manifest.json, or throws. The default is the ROM audit's own verifier. */
export type VerifyBundle = (directory: string) => string | Promise<string>;

export const defaultVerifyBundle: VerifyBundle = async (directory) => {
  const module = await import("../rom-audit/verify-publication.js");
  return module.verifyPublication(directory);
};

export interface SourceBundle {
  directory: string;
  manifest: SourceManifest;
  manifestSha256: string;
  /** md5 -> published per-subtune horizon (milliseconds); its length is the subtune count. */
  horizonsMs: Map<string, number[]>;
  /** md5 -> subtune -> incompatible lane mask (published commander-exceptions.json). */
  incompatible: Map<string, Map<number, number>>;
  /** md5 -> subtunes with any pending/failed/unresolved lane (published unknown.json). */
  unknown: Map<string, Set<number>>;
}

const HEX64 = /^[a-f0-9]{64}$/;
const HEX32 = /^[a-f0-9]{32}$/;
const REQUIRED_ARTIFACTS = ["commander-exceptions.json", "unknown.json", "sha256-to-md5.json", "playback-horizons.json"] as const;
/** The measured profile is read from the source manifest's own scope text; refuse a bundle that does not state it. */
const REQUIRED_SCOPE_FRAGMENTS = ["48kHz stereo", "default delay 8191", "256-event pulls", "header SID model/MOS8580 fallback"] as const;

function require(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`Cannot build ROM dependency list: ${message}`);
}

function parseJson<T>(bytes: Buffer, name: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch (error) {
    console.error(`Unparseable JSON in ${name}`, error);
    throw error;
  }
}

export interface LoadOptions {
  allowIncomplete: boolean;
  verifyBundle?: VerifyBundle;
}

export async function loadSourceBundle(directory: string, options: LoadOptions): Promise<SourceBundle> {
  const manifestBytes = await readFile(path.join(directory, "manifest.json"));
  const manifest = parseJson<SourceManifest>(manifestBytes, "manifest.json");
  const manifestSha256 = sha256Hex(manifestBytes);
  require(manifest.schema === "sidflow-dual-rom-manifest-1", "unsupported source manifest schema");
  if (!options.allowIncomplete) {
    require(manifest.complete === true && manifest.releaseReady === true, "source bundle is not complete && releaseReady (use --allow-incomplete for a non-releasable developer output)");
    const verified = await (options.verifyBundle ?? defaultVerifyBundle)(directory);
    require(verified === manifestSha256, "verification returned a different manifest digest");
  }
  require(HEX64.test(manifest.corpus ?? ""), "manifest corpus id missing");
  require(HEX64.test(manifest.documents?.["Songlengths.md5"] ?? ""), "manifest lacks the Songlengths.md5 digest");
  require(HEX64.test(manifest.sourceIdentity ?? ""), "manifest sourceIdentity missing");
  require(manifest.romSetId === romSetId(), `ROM set id ${manifest.romSetId} is not the reference set ${romSetId()}`);
  require(typeof manifest.scope === "string" && REQUIRED_SCOPE_FRAGMENTS.every((f) => manifest.scope.includes(f)), "manifest scope does not state the measured profile");

  const read = async (name: string): Promise<Buffer> => {
    const bytes = await readFile(path.join(directory, name));
    require(HEX64.test(manifest.artifacts?.[name] ?? "") && sha256Hex(bytes) === manifest.artifacts[name], `checksum mismatch for ${name}`);
    return bytes;
  };
  for (const name of REQUIRED_ARTIFACTS) require(Object.hasOwn(manifest.artifacts ?? {}, name), `artifact ${name} not listed`);
  const identities = parseJson<Record<string, string>>(await read("sha256-to-md5.json"), "sha256-to-md5.json");
  const horizons = parseJson<Record<string, { milliseconds: number[]; fallbackSidModel: string }>>(await read("playback-horizons.json"), "playback-horizons.json");
  const exceptions = parseJson<{ schema: string; complete: boolean; bits: Record<string, number>; entries: Record<string, Record<string, number>> }>(await read("commander-exceptions.json"), "commander-exceptions.json");
  const unknownRaw = parseJson<Record<string, number[]>>(await read("unknown.json"), "unknown.json");

  require(exceptions.schema === "sidflow-commander-rom-exceptions-1" && exceptions.complete === manifest.complete, "exceptions provenance");
  require(ROM_DEP_LANE_NAMES.every((n) => exceptions.bits?.[n] === ROM_DEP_LANE_BITS[n]) && Object.keys(exceptions.bits).length === ROM_DEP_LANE_NAMES.length, "exception bit meanings differ from sidromdep-1");
  const md5s = new Set(Object.values(identities));
  require(Object.keys(identities).length === manifest.files && md5s.size === manifest.files && Object.keys(horizons).length === manifest.files, "file inventory differs from manifest");
  const horizonsMs = new Map<string, number[]>();
  let subtunes = 0;
  for (const [md5, scope] of Object.entries(horizons)) {
    require(HEX32.test(md5) && md5s.has(md5), "horizon entry without identity");
    require(scope.fallbackSidModel === "MOS8580", "unexpected fallback SID model");
    require(Array.isArray(scope.milliseconds) && scope.milliseconds.length >= 1 && scope.milliseconds.length <= ROM_DEP_MAX_SUBTUNE, `${md5}: subtune count out of 1..256`);
    require(scope.milliseconds.every((ms) => Number.isSafeInteger(ms) && ms > 0), `${md5}: invalid horizon`);
    horizonsMs.set(md5, scope.milliseconds);
    subtunes += scope.milliseconds.length;
  }
  require(subtunes === manifest.subtunes, "subtune inventory differs from manifest");

  const incompatible = new Map<string, Map<number, number>>();
  for (const [md5, songs] of Object.entries(exceptions.entries)) {
    const count = horizonsMs.get(md5)?.length;
    require(count !== undefined, `exception for unknown file ${md5}`);
    const lanes = new Map<number, number>();
    for (const [song, bits] of Object.entries(songs)) {
      require(/^[1-9][0-9]*$/.test(song) && Number(song) <= count && Number.isInteger(bits) && bits > 0 && bits <= ROM_DEP_ALL_LANES, `${md5}#${song}: invalid exception`);
      lanes.set(Number(song), bits);
    }
    incompatible.set(md5, lanes);
  }
  const unknown = new Map<string, Set<number>>();
  let unknownCount = 0;
  for (const [md5, songs] of Object.entries(unknownRaw)) {
    const count = horizonsMs.get(md5)?.length;
    require(count !== undefined && Array.isArray(songs), `unknown entry for unknown file ${md5}`);
    for (const song of songs) require(Number.isInteger(song) && song >= 1 && song <= count, `${md5}#${song}: invalid unknown subtune`);
    unknown.set(md5, new Set(songs));
    unknownCount += songs.length;
  }
  require(unknownCount === manifest.unknownSubtunes, "unknown count differs from manifest");
  if (manifest.complete) require(unknownCount === 0, "a complete bundle cannot carry unknown subtunes");
  return { directory, manifest, manifestSha256, horizonsMs, incompatible, unknown };
}

/**
 * Decision of one source subtune. A subtune in unknown.json has at least one unresolved lane but the
 * bundle does not say which, so every lane not already known incompatible is conservatively unknown.
 * (A complete bundle has no unknown subtunes, so release outputs never depend on this.)
 */
export function expectedDecision(bundle: SourceBundle, md5: string, subtune: number): { incompatible: number; unknown: number } {
  const incompatible = bundle.incompatible.get(md5)?.get(subtune) ?? 0;
  const unknown = bundle.unknown.get(md5)?.has(subtune) ? ROM_DEP_ALL_LANES & ~incompatible : 0;
  return { incompatible, unknown };
}

export function deriveEntries(bundle: SourceBundle): RomDepEntry[] {
  const entries: RomDepEntry[] = [];
  for (const [md5, horizons] of [...bundle.horizonsMs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const decisions = [];
    for (let subtune = 1; subtune <= horizons.length; subtune++) {
      const decision = expectedDecision(bundle, md5, subtune);
      if (decision.incompatible || decision.unknown) decisions.push({ subtune, ...decision });
    }
    if (decisions.length) entries.push({ md5, decisions });
  }
  return entries;
}

export function provenanceOf(bundle: SourceBundle): RomDepProvenance {
  return { sourceManifestSha256: bundle.manifestSha256, songlengthsSha256: bundle.manifest.documents["Songlengths.md5"]!, corpusId: bundle.manifest.corpus };
}

/**
 * Check that the pinned Songlengths.md5 is the one the audit used and that the documented horizon rule
 * reproduces every published horizon exactly. Returns md5 -> HVSC path for the human-readable output.
 */
export function verifyHorizonRule(bundle: SourceBundle, songlengthsText: string): Map<string, string> {
  require(sha256Hex(songlengthsText) === bundle.manifest.documents["Songlengths.md5"], "Songlengths.md5 does not match the digest in the source manifest");
  const records = parseSonglengthsMd5(songlengthsText);
  const paths = new Map<string, string>();
  const failures: string[] = [];
  for (const [md5, published] of bundle.horizonsMs) {
    const record = records.get(md5);
    if (!record) {
      failures.push(`${md5}: not in Songlengths.md5`);
      continue;
    }
    paths.set(md5, record.path);
    published.forEach((ms, index) => {
      const derived = derivePlaybackHorizonMs(record.tokens[index]);
      if (derived !== ms) failures.push(`${md5}#${index + 1}: published ${ms} ms, rule gives ${derived} ms`);
    });
  }
  require(failures.length === 0, `published horizons are not reproducible from Songlengths.md5 (${failures.length}): ${failures.slice(0, 5).join("; ")}`);
  return paths;
}

export const REFERENCE_ROMS = REFERENCE_ROM_SHA256;
