import { createHash } from "node:crypto";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { PERSONA_IDS, PERSONAS } from "./persona.js";
import { writeCanonicalJsonFile } from "./canonical-writer.js";
import { ensureDir, pathExists } from "./fs.js";
import type { JsonValue } from "./json.js";
import { loadSonglengthsData } from "./songlengths.js";
import { decodeLiteSimilarityExport } from "./similarity-export-lite.js";
import {
  computePortableManifestPath,
  readPortableBundlePayload,
  writePortableBundlePayload,
  type SimilarityBundleContentEncoding,
} from "./similarity-bundle-file.js";
import {
  buildSimilarityTrackId,
  type SimilarityExportRecommendation,
} from "./similarity-export.js";
import { compareUtf8Bytewise } from "./utf8-byte-order.js";
import {
  selectDiversifiedNeighbours,
  type HubnessCorrection,
  type NeighbourCandidate,
  type NeighbourSelectionSettings,
  type SelectionDistance,
} from "./similarity-neighbour-selection.js";
import { buildNavigableNeighbourGraph } from "./similarity-graph-build.js";
import {
  buildLocalScalingDistance,
  buildMutualProximityModel,
} from "./similarity-hubness.js";
import { cosineSimilarity, weightsForDimensions } from "./vector-similarity.js";
import {
  packCompactRatings,
  pickRandomRows,
  unpackCompactRatings,
  type SimilarityDataset,
  type SimilarityTrackRow,
} from "./similarity-portable.js";
import { HVSC_VERSION_UNKNOWN } from "./hvsc-version.js";
import {
  assignSimilarityStyleMasks,
  type StylePopulationPolicy,
} from "./style-assignment.js";
import {
  buildDirectoryOccupancy,
  buildPersonaCorpusContext,
  computeComposerProminence,
  computeDirectoryRarity,
  computeYearPosition,
  createSidHeaderFallbackReport,
  derivePersonaMetadataFromSidBuffer,
  summariseSidHeaderFallbacks,
  type PersonaTrackMetadata,
} from "./persona-metadata.js";

export const TINY_SIMILARITY_EXPORT_SCHEMA_VERSION = "sidcorr-tiny-1";

const MAGIC = "SIDTINY1";
const HEADER_BYTES = 64;
const EMPTY_NEIGHBOR = 0xffffff;
const STYLE_MASK_WIDTH_BYTES = 2;
const COMPACT_RATING_BYTES = 2;
const NEIGHBORS_PER_TRACK = 3;
const NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY = 4;
const STYLE_TABLE_VERSION = 1;
const APPROXIMATE_NEIGHBOR_CANDIDATE_LIMIT = 256;

/**
 * graph_flags bit 0: the exported edges form a directed acyclic graph.
 *
 * **No longer set.** Through 0.8.0 and 0.8.2 the builder guaranteed acyclicity, and the
 * specification said the bit was "always 1". That guarantee was a mistake, not a feature: it
 * encoded a playback policy — "never play the same tune twice" — as a structural constraint on
 * the artefact, and satisfying it meant discarding 50.76% of the source graph's edges. Cycles
 * in a similarity graph are not a defect; if A's nearest neighbour is B and B's is A, that is
 * true and useful. Not revisiting a track is the player's job, and every player already keeps a
 * set of what it has played.
 *
 * The bit is kept as a named constant rather than deleted so that the withdrawal is visible
 * here rather than only in a changelog.
 */
export const GRAPH_FLAG_ACYCLIC = 1 << 0;
/**
 * graph_flags bits 1 and 2: written since the format's first release and never assigned a
 * meaning in the specification. They are preserved rather than cleared, because a consumer
 * may have come to depend on the literal value even though §5.2 tells it not to.
 */
const GRAPH_FLAG_RESERVED_LEGACY = (1 << 1) | (1 << 2);
/**
 * graph_flags bit 3: slot 0 of every populated row is the track's flow successor.
 *
 * **Retired.** It was introduced in 0.8.2 to declare a Hamiltonian path through the exported
 * edges, and 0.8.2 has been withdrawn. No bundle that sets it was ever published for longer
 * than a few days, and none is published now.
 */
export const GRAPH_FLAG_FLOW_SUCCESSOR_FIRST = 1 << 3;
/** What the builder writes to `graph_flags`: the two legacy reserved bits and nothing else. */
export const GRAPH_FLAGS = GRAPH_FLAG_RESERVED_LEGACY;

interface SourceTrackRow {
  track_id: string;
  sid_path: string;
  song_index: number;
  vector_json: string | null;
  e: number;
  m: number;
  c: number;
  p: number | null;
}

interface TinyTrackRecord extends SimilarityTrackRow {
  neighbors: Array<{ trackOrdinal: number; similarity: number }>;
  styleMask: number;
}

interface Md548Context {
  hvscRoot: string;
  /**
   * `hvscRoot` with every symlinked path component resolved.
   *
   * Containment has to be judged against this, and only against paths that have been
   * resolved the same way. Comparing an unresolved candidate against a resolved root
   * rejects ordinary installations: on macOS `os.tmpdir()` is under `/var`, which is a
   * symlink to `/private/var`, so every SID path under a temporary HVSC root would look
   * as though it escaped.
   */
  resolvedHvscRoot: string;
  musicRoot: string;
  musicRootPrefix: string;
}

export interface TinySimilarityExportManifest {
  schema_version: typeof TINY_SIMILARITY_EXPORT_SCHEMA_VERSION;
  binary_format_version: number;
  generated_at: string;
  corpus_version: string;
  /**
   * Which HVSC release the bundle's file identities were computed from, or "unknown".
   *
   * Load-bearing for tiny in a way it is not for the other profiles: tiny stores a
   * 48-bit MD5 prefix of each .sid file's bytes and nothing else, so a consumer whose
   * collection differs resolves nothing at all and has no diagnostic to work from.
   */
  hvsc_version?: string;
  track_count: number;
  file_count: number;
  style_count: number;
  /**
   * Persona key to member count, for all nine styles.
   *
   * Published so populations are verifiable at download time without a full pass over
   * the mask table, so `c64commander` can render a track count on each station tile,
   * and so the release gate has a machine-readable source to recount against. A station
   * with 100 tracks next to one with 30,000 reads as a defect, and until 0.8.0 nothing
   * in the export had any notion of how big a station was.
   */
  style_populations?: Record<string, number>;
  /** The thresholds the population gate ran with, so a consumer can see what "passed" meant. */
  style_population_policy?: StylePopulationPolicy;
  /**
   * Present ONLY when `--allow-sparse-styles` bypassed a failing gate, listing what it
   * bypassed. A bundle produced under a waiver must never be mistakable for one that
   * passed, so the waiver travels with the artefact rather than living in a build log.
   */
  style_population_waiver?: string[];
  file_id_kind: "md5_48";
  neighbors_per_track: 3;
  content_encoding: SimilarityBundleContentEncoding;
  bundle_bytes: number;
  bundle_bytes_uncompressed: number;
  paths: {
    bundle: string;
    manifest: string;
  };
  source: {
    lite: string;
    hvsc_root: string;
    sqlite_neighbor_hint?: string;
  };
  source_checksums: {
    lite_sha256: string;
    sqlite_neighbor_hint_sha256?: string;
  };
  file_checksums: {
    bundle_sha256: string;
  };
}

export interface BuildTinySimilarityExportOptions {
  sourceLitePath: string;
  hvscRoot: string;
  outputPath: string;
  manifestPath?: string;
  corpusVersion?: string;
  /**
   * Recorded as `hvsc_version`. Omit to inherit it from the source lite bundle's
   * manifest, which is the corpus the identities actually describe.
   */
  hvscVersion?: string;
  neighborSqlitePath?: string;
  /** Overrides for the station population gate; see DEFAULT_STYLE_POPULATION_POLICY. */
  stylePopulationPolicy?: Partial<StylePopulationPolicy>;
  /**
   * Bypass a failing population gate. Intended for small or unusual private corpora
   * that genuinely cannot support nine stations. The bypass is recorded in the manifest.
   */
  allowSparseStyles?: boolean;
  /**
   * Overrides for how the neighbour graph is built. Omit for the shipped settings; see
   * DEFAULT_NEIGHBOUR_SELECTION. Intended for the parameter sweep and for tests, which need to
   * build a cheap graph over a small corpus without the navigable builder's two search passes.
   */
  neighbourSelection?: NeighbourSelectionSettings;
}

export interface BuildTinySimilarityExportResult {
  durationMs: number;
  outputPath: string;
  manifestPath: string;
  manifest: TinySimilarityExportManifest;
}

export interface OpenTinySimilarityDatasetOptions {
  hvscRoot?: string;
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.hypot(...values);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    throw new Error("Encountered invalid similarity vector while building sidcorr-tiny-1 export.");
  }
  return values.map((value) => value / magnitude);
}

function cosine(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return total;
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const payload = await readFile(filePath);
  return createHash("sha256").update(payload).digest("hex");
}

async function resolveMd548Context(hvscRoot: string): Promise<Md548Context> {
  const nestedMusicRoot = path.join(hvscRoot, "C64Music");
  const musicRoot = await pathExists(nestedMusicRoot) ? nestedMusicRoot : hvscRoot;
  return {
    hvscRoot,
    // Resolved once. Doing it per file would add a full path resolution to each of the
    // corpus's 61,000 reads for a value that cannot change during a build.
    resolvedHvscRoot: await realpath(hvscRoot).catch(() => path.resolve(hvscRoot)),
    musicRoot,
    musicRootPrefix: `${path.basename(musicRoot).toLowerCase()}/`,
  };
}

/** True when `candidate` is `root` itself or sits underneath it. */
function isContainedIn(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function computeManifestPath(outputPath: string, explicitPath?: string): string {
  return computePortableManifestPath(outputPath, explicitPath);
}

function writeUInt24LE(target: Buffer, value: number, offset: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
}

function readUInt24LE(source: Buffer, offset: number): number {
  return source[offset]! | (source[offset + 1]! << 8) | (source[offset + 2]! << 16);
}

function writeUInt48LE(target: Buffer, value: Buffer, offset: number): void {
  value.copy(target, offset, 0, 6);
}

function parseVector(row: SourceTrackRow): number[] {
  if (row.vector_json) {
    const parsed = JSON.parse(row.vector_json) as number[];
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return normalizeVector(parsed.slice(0, parsed.length >= 4 ? 4 : 3));
    }
  }
  const values = [row.e, row.m, row.c];
  if (typeof row.p === "number" && Number.isFinite(row.p)) {
    values.push(row.p);
  }
  return normalizeVector(values);
}

/**
 * Resolve a SID path, hash it, and hand back the bytes.
 *
 * One read serves two purposes: the md5_48 file identity the bundle stores, and the
 * header the hybrid personas need. Reading twice over 61,157 files to get both would be
 * the obvious shape and the wrong one.
 */
async function readMd548AndPayload(
  context: Md548Context,
  sidPath: string,
): Promise<{ digest: Buffer; payload: Buffer }> {
  const payload = await readResolvedSidFile(context, sidPath);
  return { digest: createHash("md5").update(payload).digest().subarray(0, 6), payload };
}

async function readResolvedSidFile(context: Md548Context, sidPath: string): Promise<Buffer> {
  // A leading slash is stripped rather than rejected: HVSC's own indexes write music-root
  // paths as "/DEMOS/x.sid", earlier releases accepted that form, and it cannot escape the
  // root once it is relative. A drive letter or UNC prefix can escape on Windows, and a
  // ".." segment can escape anywhere, so those are refused.
  const normalizedSidPath = sidPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalizedSidPath.length === 0
    || normalizedSidPath.includes("\0")
    || path.win32.isAbsolute(normalizedSidPath)
    || normalizedSidPath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`SID path ${sidPath} must be a non-empty relative path within ${context.hvscRoot}`);
  }

  const candidatePaths = [
    path.resolve(context.musicRoot, normalizedSidPath),
    path.resolve(context.hvscRoot, normalizedSidPath),
  ];

  if (normalizedSidPath.toLowerCase().startsWith(context.musicRootPrefix)) {
    candidatePaths.push(path.resolve(context.musicRoot, normalizedSidPath.slice(context.musicRootPrefix.length)));
  }

  for (const candidatePath of candidatePaths) {
    // `realpath` both tests existence and follows symlinks, so one call replaces a
    // separate existence probe. A missing candidate is not an error: the loop exists
    // because the same record can be written relative to the HVSC root or the music root.
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
        continue;
      }
      throw error;
    }
    // Judged after resolution, against the resolved root, so a symlink inside HVSC that
    // points elsewhere is rejected while a symlinked HVSC root itself still works.
    if (!isContainedIn(context.resolvedHvscRoot, resolvedPath)) {
      throw new Error(`SID path ${sidPath} resolves outside ${context.hvscRoot}`);
    }
    return readFile(resolvedPath);
  }

  throw new Error(`Unable to resolve SID path ${sidPath} within ${context.hvscRoot}`);
}

/**
 * Two different local SID files sharing a truncated hash cannot resolve safely.
 *
 * The tiny profile identifies files by the first 48 bits of their MD5 to keep the
 * bundle small. Across HVSC's ~62,000 files the birthday probability of at least one
 * collision is around 0.7% -- unlikely per release, but this is a published artifact.
 * The matching rule requires an ambiguous local identity to remain unresolved; choosing
 * whichever path the scanner saw last would make a listener play a different SID from
 * the one the station identifies.
 *
 * The key is removed rather than overwritten, so a colliding identity resolves to
 * nothing instead of to one of the two candidates. The builder treats the same condition
 * as fatal (section 4.1 of the format specification requires an export to reject
 * duplicate prefixes); a reader cannot refuse to open a bundle somebody already
 * published, so it warns and leaves the affected entries unresolved.
 */
function recordMd548(
  result: Map<string, string>,
  ambiguousKeys: Set<string>,
  collisions: Array<[string, string, string]>,
  key: string,
  relativePath: string,
): void {
  if (ambiguousKeys.has(key)) {
    return;
  }
  const existing = result.get(key);
  if (existing !== undefined && existing !== relativePath) {
    collisions.push([key, existing, relativePath]);
    result.delete(key);
    ambiguousKeys.add(key);
    return;
  }
  result.set(key, relativePath);
}

function warnAboutMd548Collisions(collisions: Array<[string, string, string]>): void {
  if (collisions.length === 0) {
    return;
  }
  const detail = collisions
    .slice(0, 5)
    .map(([key, first, second]) => `  ${key}: ${first} <-> ${second}`)
    .join("\n");
  process.stderr.write(
    `[similarity-export-tiny] WARNING: ${collisions.length} ambiguous local md5_48 identity/identities. `
    + `Matching bundle entries remain unresolved:\n${detail}\n`,
  );
}

/**
 * Map every local md5_48 prefix to the SID path that carries it.
 *
 * HVSC ships `DOCUMENTS/Songlengths.md5`, whose keys are the plain MD5 of each SID
 * file -- verified against the shipped corpus, not assumed -- so when it is present the
 * whole map is one text file read. The alternative is reading and hashing every SID:
 * measured at 11.7 s for 59,886 files with a warm page cache, on a path that runs every
 * time a station opens a tiny bundle.
 *
 * The directory walk is the fallback for a corpus without that index. It is also the
 * only mode that sees a local file HVSC does not list, which is why the walk, not the
 * index, is what detects a duplicate somebody added themselves.
 */
async function buildMd548PathMap(hvscRoot: string): Promise<Map<string, string>> {
  const md548Context = await resolveMd548Context(hvscRoot);
  const songlengths = await loadSonglengthsData(hvscRoot);
  const collisions: Array<[string, string, string]> = [];
  const result = new Map<string, string>();
  const ambiguousKeys = new Set<string>();

  if (songlengths.sourcePath && songlengths.pathByMd5.size > 0) {
    for (const [md5, relativePath] of songlengths.pathByMd5) {
      recordMd548(result, ambiguousKeys, collisions, md5.slice(0, 12), relativePath);
    }
    warnAboutMd548Collisions(collisions);
    return result;
  }

  const queue = [md548Context.musicRoot];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8Bytewise(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sid")) {
        continue;
      }
      const relativePath = path.relative(md548Context.musicRoot, absolutePath).replace(/\\/g, "/");
      const { digest } = await readMd548AndPayload(md548Context, relativePath);
      recordMd548(result, ambiguousKeys, collisions, digest.toString("hex"), relativePath);
    }
  }
  warnAboutMd548Collisions(collisions);
  return result;
}

function encodeSimilarity(similarity: number): number {
  return Math.max(0, Math.min(255, Math.round(((similarity + 1) / 2) * 255)));
}

function decodeSimilarity(value: number): number {
  return ((value / 255) * 2) - 1;
}

function buildStyleTable(): Buffer {
  const records: Buffer[] = [];
  const payloads: Buffer[] = [];
  let payloadOffset = 0;
  for (let index = 0; index < PERSONA_IDS.length; index += 1) {
    const persona = PERSONAS[PERSONA_IDS[index]!];
    const keyBuffer = Buffer.from(persona.id, "utf8");
    const labelBuffer = Buffer.from(persona.label, "utf8");
    const configBuffer = Buffer.from(JSON.stringify({ ratingTargets: persona.ratingTargets, kind: persona.kind }), "utf8");
    const record = Buffer.alloc(28);
    record.writeUInt8(index, 0);
    record.writeUInt8(index, 1);
    record.writeUInt8(persona.kind === "audio" ? 0 : 2, 2);
    record.writeUInt8(persona.kind === "audio" ? 0 : 3, 3);
    record.writeUInt32LE(0, 4);
    record.writeUInt32LE(payloadOffset, 8);
    record.writeUInt16LE(keyBuffer.length, 12);
    payloadOffset += keyBuffer.length;
    record.writeUInt32LE(payloadOffset, 14);
    record.writeUInt16LE(labelBuffer.length, 18);
    payloadOffset += labelBuffer.length;
    record.writeUInt32LE(payloadOffset, 20);
    record.writeUInt16LE(configBuffer.length, 24);
    record.writeUInt16LE(0, 26);
    payloadOffset += configBuffer.length;
    records.push(record);
    payloads.push(keyBuffer, labelBuffer, configBuffer);
  }

  const sectionHeader = Buffer.alloc(12);
  sectionHeader.writeUInt16LE(STYLE_TABLE_VERSION, 0);
  sectionHeader.writeUInt16LE(PERSONA_IDS.length, 2);
  sectionHeader.writeUInt16LE(28, 4);
  sectionHeader.writeUInt16LE(0, 6);
  sectionHeader.writeUInt32LE(payloadOffset, 8);
  return Buffer.concat([sectionHeader, ...records, ...payloads]);
}

function buildCompactRatingSignature(row: Pick<SourceTrackRow, "e" | "m" | "c" | "p">): string {
  return `${row.e}|${row.m}|${row.c}|${row.p ?? 3}`;
}

function compactRatingDistance(
  left: Pick<SourceTrackRow, "e" | "m" | "c" | "p">,
  right: Pick<SourceTrackRow, "e" | "m" | "c" | "p">,
): number {
  return Math.abs(left.e - right.e)
    + Math.abs(left.m - right.m)
    + Math.abs(left.c - right.c)
    + Math.abs((left.p ?? 3) - (right.p ?? 3));
}

/**
 * Candidate lists for the flow order and the forward edge selection.
 *
 * These are *candidates*, not exported edges: unrestricted by direction and longer than
 * the three slots a bundle carries. Both the flow order and the edge selection need to see
 * more than three options per track, and neither can be given a direction before the flow
 * order exists. Restricting the list here is what produced the shallow graph that 0.8.2
 * fixes — see `similarity-flow-order.ts`.
 */
function computeApproximateNeighborCandidates(
  rows: SourceTrackRow[],
  vectors: number[][],
): Array<Array<NeighbourCandidate>> {
  const ordinalsBySignature = new Map<string, number[]>();
  const rowsBySignature = new Map<string, SourceTrackRow>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const signature = buildCompactRatingSignature(row);
    const ordinals = ordinalsBySignature.get(signature);
    if (ordinals) {
      ordinals.push(index);
    } else {
      ordinalsBySignature.set(signature, [index]);
      rowsBySignature.set(signature, row);
    }
  }

  const signatures = [...ordinalsBySignature.keys()];
  const orderedSignaturesBySignature = new Map<string, string[]>();
  for (const signature of signatures) {
    const seedRow = rowsBySignature.get(signature)!;
    orderedSignaturesBySignature.set(
      signature,
      [...signatures].sort((left, right) => {
        const leftDistance = compactRatingDistance(seedRow, rowsBySignature.get(left)!);
        const rightDistance = compactRatingDistance(seedRow, rowsBySignature.get(right)!);
        return leftDistance - rightDistance || compareUtf8Bytewise(left, right);
      }),
    );
  }

  return rows.map((row, seedOrdinal) => {
    const candidateOrdinals: number[] = [];
    const seedSignature = buildCompactRatingSignature(row);
    const orderedSignatures = orderedSignaturesBySignature.get(seedSignature) ?? signatures;

    for (const signature of orderedSignatures) {
      const ordinals = ordinalsBySignature.get(signature) ?? [];
      for (let index = ordinals.length - 1; index >= 0; index -= 1) {
        const candidateOrdinal = ordinals[index]!;
        if (candidateOrdinal === seedOrdinal) {
          continue;
        }
        candidateOrdinals.push(candidateOrdinal);
        if (candidateOrdinals.length >= APPROXIMATE_NEIGHBOR_CANDIDATE_LIMIT) {
          break;
        }
      }
      if (candidateOrdinals.length >= APPROXIMATE_NEIGHBOR_CANDIDATE_LIMIT) {
        break;
      }
    }

    return candidateOrdinals
      .map((candidateOrdinal) => ({
        trackOrdinal: candidateOrdinal,
        similarity: cosine(vectors[seedOrdinal]!, vectors[candidateOrdinal]!),
      }))
      .sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal);
  });
}

function computeFallbackNeighborCandidates(
  rows: SourceTrackRow[],
  vectors: number[][],
): Array<Array<NeighbourCandidate>> {
  if (rows.length > 5000) {
    return computeApproximateNeighborCandidates(rows, vectors);
  }

  return rows.map((_, seedOrdinal) => {
    const scores: NeighbourCandidate[] = [];
    for (let candidateOrdinal = 0; candidateOrdinal < rows.length; candidateOrdinal += 1) {
      if (candidateOrdinal === seedOrdinal) {
        continue;
      }
      scores.push({
        trackOrdinal: candidateOrdinal,
        similarity: cosine(vectors[seedOrdinal]!, vectors[candidateOrdinal]!),
      });
    }
    return scores.sort(
      (left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal,
    );
  });
}

/**
 * Inherit the HVSC release from the lite bundle this tiny export is derived from.
 *
 * Read from lite's sidecar manifest rather than from the local workspace, for the same
 * reason lite reads it from the SQLite: the derived bundle describes the source's
 * corpus, and if the deriving machine's collection has since moved on, the source is
 * the one telling the truth about these identities.
 */
async function readLiteManifestHvscVersion(sourceLitePath: string): Promise<string | null> {
  const liteManifestPath = computePortableManifestPath(sourceLitePath);
  try {
    const parsed = JSON.parse(await readFile(liteManifestPath, "utf8")) as { hvsc_version?: unknown };
    return typeof parsed.hvsc_version === "string" ? parsed.hvsc_version : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      console.debug(
        `Could not read hvsc_version from ${liteManifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
}

function describeHvscRootForManifest(hvscRoot: string): string {
  const normalized = hvscRoot.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized) {
    return "hvsc";
  }
  if (normalized.toLowerCase().endsWith("/c64music")) {
    return path.basename(path.dirname(normalized)) || "hvsc";
  }
  return path.basename(normalized) || "hvsc";
}

/**
 * Candidate lists taken from the source export's own `neighbors` table.
 *
 * The whole ranked list is read, not the first three and not only the edges pointing at a
 * lower track ordinal. Both restrictions were applied here before 0.8.2, and between them
 * they discarded 50.76% of the source graph and fixed the orientation to alphabetical
 * `sid_path` order.
 */
function buildNeighborCandidatesFromSqliteHint(
  rows: SourceTrackRow[],
  database: Database,
): Array<Array<NeighbourCandidate>> | null {
  const ordinalByTrackId = new Map(rows.map((row, index) => [row.track_id, index]));
  const candidatesBySeed = rows.map(() => [] as NeighbourCandidate[]);
  let hasPrecomputedNeighbors = false;
  try {
    const existingNeighbors = database.query(`
      SELECT seed_track_id, neighbor_track_id, rank, similarity
      FROM neighbors
      WHERE profile = 'full'
      ORDER BY seed_track_id ASC, rank ASC
    `).all() as Array<{ seed_track_id: string; neighbor_track_id: string; rank: number; similarity: number }>;
    if (existingNeighbors.length > 0) {
      hasPrecomputedNeighbors = true;
      for (const neighbor of existingNeighbors) {
        const seedOrdinal = ordinalByTrackId.get(neighbor.seed_track_id);
        const targetOrdinal = ordinalByTrackId.get(neighbor.neighbor_track_id);
        if (seedOrdinal === undefined || targetOrdinal === undefined || targetOrdinal === seedOrdinal) {
          continue;
        }
        candidatesBySeed[seedOrdinal]!.push({
          trackOrdinal: targetOrdinal,
          similarity: neighbor.similarity,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (!error.message.toLowerCase().includes("no such table")) {
      throw error;
    }
  }

  return hasPrecomputedNeighbors ? candidatesBySeed : null;
}

/**
 * The similarity function neighbour selection scores pairs with.
 *
 * It reads the source export's own `vector_json` and applies the published weighted cosine, so
 * every selection decision is made on the same metric that produced the candidate lists. Lite's
 * decoded vectors are the fallback: they are quantised and, worse, `parseVector` truncates them
 * to four dimensions, which is fine for the small-corpus paths that have no better source but
 * would silently change the metric here.
 *
 * ## Why the vectors are pre-scaled
 *
 * Weighted cosine is `sum(w*l*r) / (sqrt(sum(w*l^2)) * sqrt(sum(w*r^2)))`, which is the ordinary
 * cosine of the vectors scaled by `sqrt(w)`. Scaling once and L2-normalising once turns every
 * subsequent evaluation into a plain dot product with no square roots and no per-call norm
 * recomputation. Graph construction evaluates this tens of millions of times, so the difference
 * is between a build that finishes and one that does not. The values are identical to
 * `cosineSimilarity`'s to within floating-point reassociation, and the exported byte quantises
 * `[-1, 1]` into 255 steps, so nothing observable depends on which route is taken.
 */
function buildSourceVectorSimilarity(
  rows: SourceTrackRow[],
  database: Database,
  fallbackVectors: number[][],
): (left: number, right: number) => number {
  const ordinalByTrackId = new Map(rows.map((row, index) => [row.track_id, index]));
  let dimensions = 0;
  const rawByOrdinal: Array<number[] | null> = rows.map(() => null);
  try {
    const stored = database.query(
      "SELECT track_id, vector_json FROM tracks WHERE vector_json IS NOT NULL AND vector_json != ''",
    ).all() as Array<{ track_id: string; vector_json: string }>;
    for (const entry of stored) {
      const ordinal = ordinalByTrackId.get(entry.track_id);
      if (ordinal === undefined) {
        continue;
      }
      const parsed = JSON.parse(entry.vector_json) as number[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        rawByOrdinal[ordinal] = parsed;
        if (parsed.length > dimensions) {
          dimensions = parsed.length;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("no such")) {
      throw error;
    }
  }

  const complete = dimensions > 0 && rawByOrdinal.every((vector) => vector?.length === dimensions);
  if (!complete) {
    // A mixed-width or partial vector set cannot be packed, and silently comparing vectors of
    // different widths is worse than being slow. Fall back to the per-call implementation, which
    // handles the ragged case the same way the rest of the codebase does.
    return (left: number, right: number): number => {
      const leftVector = rawByOrdinal[left];
      const rightVector = rawByOrdinal[right];
      if (leftVector && rightVector && leftVector.length === rightVector.length) {
        return cosineSimilarity(leftVector, rightVector);
      }
      return cosine(fallbackVectors[left] ?? [], fallbackVectors[right] ?? []);
    };
  }

  const weights = weightsForDimensions(dimensions);
  const scale = Array.from({ length: dimensions }, (_, index) => Math.sqrt(weights?.[index] ?? 1));
  const packed = new Float64Array(rows.length * dimensions);
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    const vector = rawByOrdinal[ordinal]!;
    const base = ordinal * dimensions;
    let norm = 0;
    for (let index = 0; index < dimensions; index += 1) {
      const value = (vector[index] ?? 0) * scale[index]!;
      packed[base + index] = value;
      norm += value * value;
    }
    if (norm > 0) {
      const inverse = 1 / Math.sqrt(norm);
      for (let index = 0; index < dimensions; index += 1) {
        packed[base + index]! *= inverse;
      }
    }
  }

  return (left: number, right: number): number => {
    const leftBase = left * dimensions;
    const rightBase = right * dimensions;
    let total = 0;
    for (let index = 0; index < dimensions; index += 1) {
      total += packed[leftBase + index]! * packed[rightBase + index]!;
    }
    return total;
  };
}

/**
 * The diversification strength the release ships.
 *
 * Chosen by the sweep in `doc/neighbour-graph-design.md` §5. Higher values diversify the exported
 * edges more, which raises greedy routing recall and lengthens the reachable region, and concentrates
 * in-degree further. The value is a constant here rather than a build flag because a bundle built
 * with a different one is a different artefact.
 */
const SHIPPED_ALPHA = 1.5;

/**
 * The in-degree bound the release ships, as a multiple of the mean.
 *
 * Larger than the 8x the plan's acceptance table names, and deliberately so: measured on the HVSC
 * corpus, a cap at 8x takes the largest undirected component to 99.885%, below the 99.9% the same
 * table requires. The edges that hold the corpus together are the same edges that make a few tracks
 * over-subscribed, so at three slots the two bounds are in direct tension and only one can be met.
 * This is the looser of the two, set where connectivity passes with margin. §5 of the design
 * document carries the sweep.
 */
const SHIPPED_IN_DEGREE_CAP_MULTIPLE = 64;

/**
 * Slots reserved for the seed's own nearest neighbours, before diversification chooses the rest.
 *
 * Two of three. Chosen by the guardrail rather than by preference: diversifying every slot drops
 * composer lift 21.12% against the withdrawn 0.8.2, and the release refuses more than 5%. Reserving
 * one slot leaves it at -14.4%; reserving two brings it to **-1.44%** while raising nDCG@10 33.0%.
 * The cost is measured and accepted — greedy routing recall falls from 1.00% to 0.80% and the
 * fixed-seed station median from 6,332 to 2,364 — because station length comes from the client's
 * drifting query, not from the graph, and retrieval quality has no other source. §5 of the design
 * document carries the sweep.
 */
const SHIPPED_FORCED_NEAREST_SLOTS = 2;

/**
 * The shipped neighbour-selection settings.
 *
 * These are the values `doc/neighbour-graph-design.md` records the sweep choosing. They are
 * constants rather than configuration because the exported graph is a published contract: a
 * bundle built with different settings is a different artefact, and a caller that can vary them
 * silently can ship one without saying so. `BuildTinySimilarityExportOptions.neighbourSelection`
 * exists so the sweep and the tests can vary them deliberately.
 */
export const DEFAULT_NEIGHBOUR_SELECTION: Required<NeighbourSelectionSettings> = {
  builder: "navigable",
  alpha: SHIPPED_ALPHA,
  searchListSize: 96,
  hubnessCorrection: "none",
  inDegreeCapMultiple: SHIPPED_IN_DEGREE_CAP_MULTIPLE,
  entryPointCount: 1,
  forcedNearestSlots: SHIPPED_FORCED_NEAREST_SLOTS,
};

function resolveNeighbourSelectionSettings(
  overrides: NeighbourSelectionSettings | undefined,
): Required<NeighbourSelectionSettings> {
  return { ...DEFAULT_NEIGHBOUR_SELECTION, ...overrides };
}

function buildSelectionDistance(
  correction: HubnessCorrection,
  trackCount: number,
  candidates: ReadonlyArray<ReadonlyArray<NeighbourCandidate>>,
  similarityBetween: (left: number, right: number) => number,
): SelectionDistance {
  if (correction === "mutual-proximity") {
    return buildMutualProximityModel({ trackCount, similarityBetween }).distance;
  }
  if (correction === "local-scaling") {
    return buildLocalScalingDistance({ trackCount, candidates, similarityBetween }).distance;
  }
  return (left, right, similarity) => 1 - (similarity ?? similarityBetween(left, right));
}

export async function buildTinySimilarityExport(
  options: BuildTinySimilarityExportOptions,
): Promise<BuildTinySimilarityExportResult> {
  const startedAt = Date.now();
  const decodedLite = await decodeLiteSimilarityExport(options.sourceLitePath);
  const rows = decodedLite.rows
    .map((row) => ({
      track_id: row.track_id,
      sid_path: row.sid_path,
      song_index: row.song_index,
      vector_json: JSON.stringify(row.vector),
      e: row.e,
      m: row.m,
      c: row.c,
      p: row.p,
    } satisfies SourceTrackRow))
    .sort((left, right) => compareUtf8Bytewise(left.sid_path, right.sid_path) || left.song_index - right.song_index);
  if (rows.length === 0) {
    throw new Error("Cannot build sidcorr-tiny-1 export from an empty sidcorr-lite-1 export.");
  }

  const filePaths = [...new Set(rows.map((row) => row.sid_path))];
  const filePathCounts = new Map<string, number>();
  for (const row of rows) {
    filePathCounts.set(row.sid_path, (filePathCounts.get(row.sid_path) ?? 0) + 1);
  }
  const vectors = rows.map(parseVector);
  const styleTable = buildStyleTable();
  const md548Context = await resolveMd548Context(options.hvscRoot);
  const fileIdentityTable = Buffer.alloc(filePaths.length * 6);
  // Detected HERE, at build time, rather than only when a consumer opens the bundle.
  // These are the identities that actually get published, and a collision among them
  // means two files are indistinguishable to every consumer forever -- something to
  // learn before the release, not after.
  const identitySeen = new Map<string, string>();
  const identityCollisions: Array<[string, string, string]> = [];
  // The SID header is parsed from the SAME buffer the md5_48 identity is computed from,
  // so feeding the hybrid personas real metadata costs no extra I/O over a 61,157-file
  // pass. That matters: it is the difference between the four metadata-led stations
  // having a defining signal and being scored on the same three quintiles as everything
  // else. It is also not reclassification -- composer, title and year come from file
  // headers and paths, never from rendered audio.
  const metadataByPath = new Map<string, PersonaTrackMetadata>();
  const headerFallbacks = createSidHeaderFallbackReport();
  for (let index = 0; index < filePaths.length; index += 1) {
    const { digest, payload } = await readMd548AndPayload(md548Context, filePaths[index]!);
    const key = digest.toString("hex");
    const previous = identitySeen.get(key);
    if (previous !== undefined && previous !== filePaths[index]) {
      identityCollisions.push([key, previous, filePaths[index]!]);
    } else {
      identitySeen.set(key, filePaths[index]!);
    }
    writeUInt48LE(fileIdentityTable, digest, index * 6);
    metadataByPath.set(
      filePaths[index]!,
      derivePersonaMetadataFromSidBuffer(filePaths[index]!, payload, headerFallbacks),
    );
  }
  if (identityCollisions.length > 0) {
    const detail = identityCollisions
      .slice(0, 5)
      .map(([key, first, second]) => `  ${key}: ${first} <-> ${second}`)
      .join("\n");
    throw new Error(
      `Cannot build sidcorr-tiny-1 export: ${identityCollisions.length} duplicate md5_48 identity/identities `
      + `violate the format's unambiguous file-identity requirement:\n${detail}`,
    );
  }
  summariseSidHeaderFallbacks(headerFallbacks, filePaths.length);

  const fileTrackCountTable = Buffer.alloc(filePaths.length);
  for (let fileIndex = 0; fileIndex < filePaths.length; fileIndex += 1) {
    const count = filePathCounts.get(filePaths[fileIndex]!) ?? 0;
    fileTrackCountTable.writeUInt8(Math.max(0, count - 1), fileIndex);
  }

  // Station membership, corpus-relative and gated. See style-assignment.ts for what was
  // wrong with taking each track's top three personas and why populations are assigned
  // by quantile instead.
  const occupancy = buildDirectoryOccupancy(rows.map((row) => row.sid_path));
  const corpusContext = buildPersonaCorpusContext(
    rows.map((row) => ({ sid_path: row.sid_path, metadata: metadataByPath.get(row.sid_path) })),
  );
  const styleAssignment = assignSimilarityStyleMasks(
    rows.map((row) => {
      const metadata = metadataByPath.get(row.sid_path);
      return {
        track_id: row.track_id,
        sid_path: row.sid_path,
        e: row.e,
        m: row.m,
        c: row.c,
        p: row.p,
        metadata,
        rarity: computeDirectoryRarity(
          row.sid_path,
          occupancy.tracksPerDirectory,
          occupancy.minimum,
          occupancy.maximum,
        ),
        composerProminence: computeComposerProminence(metadata?.composer, corpusContext),
        yearPosition: computeYearPosition(metadata?.year, corpusContext),
      };
    }),
    {
      policy: options.stylePopulationPolicy,
      allowSparseStyles: options.allowSparseStyles,
    },
  );

  const styleMaskTable = Buffer.alloc(rows.length * STYLE_MASK_WIDTH_BYTES);
  for (let index = 0; index < rows.length; index += 1) {
    styleMaskTable.writeUInt16LE(styleAssignment.masks[index] ?? 0, index * STYLE_MASK_WIDTH_BYTES);
  }

  const ratingTable = Buffer.alloc(rows.length * COMPACT_RATING_BYTES);
  for (let index = 0; index < rows.length; index += 1) {
    ratingTable.writeUInt16LE(packCompactRatings(rows[index]!), index * COMPACT_RATING_BYTES);
  }

  // The exported graph is a proximity index: three diversified edges per track, chosen so the
  // graph can be navigated rather than only read one hop at a time. It carries no traversal
  // order and makes no acyclicity promise. See `doc/neighbour-graph-design.md` for the rule, the
  // parameter sweep that chose its settings, and the two earlier designs it replaces.
  let candidates: Array<Array<NeighbourCandidate>> | null = null;
  let similarityBetween: (left: number, right: number) => number = (left, right) =>
    cosine(vectors[left] ?? [], vectors[right] ?? []);
  if (options.neighborSqlitePath) {
    const neighborDatabase = new Database(options.neighborSqlitePath, { readonly: true, strict: true });
    try {
      candidates = buildNeighborCandidatesFromSqliteHint(rows, neighborDatabase);
      if (candidates) {
        similarityBetween = buildSourceVectorSimilarity(rows, neighborDatabase, vectors);
      }
    } finally {
      neighborDatabase.close();
    }
  }
  if (!candidates) {
    candidates = computeFallbackNeighborCandidates(rows, vectors);
  }

  const selection = resolveNeighbourSelectionSettings(options.neighbourSelection);
  const selectionDistance = buildSelectionDistance(
    selection.hubnessCorrection,
    rows.length,
    candidates,
    similarityBetween,
  );
  const neighbors = selection.builder === "navigable"
    ? buildNavigableNeighbourGraph({
      trackCount: rows.length,
      neighboursPerTrack: NEIGHBORS_PER_TRACK,
      similarityBetween,
      candidates,
      alpha: selection.alpha,
      searchListSize: selection.searchListSize,
      inDegreeCapMultiple: selection.inDegreeCapMultiple,
      entryPointCount: selection.entryPointCount,
      forcedNearestSlots: selection.forcedNearestSlots,
      selectionDistance,
    }).rows
    : selectDiversifiedNeighbours({
      trackCount: rows.length,
      candidates,
      neighboursPerTrack: NEIGHBORS_PER_TRACK,
      alpha: selection.alpha,
      selectionDistance,
      similarityBetween,
    }).rows;
  const neighborTable = Buffer.alloc(rows.length * NEIGHBORS_PER_TRACK * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY);
  for (let index = 0; index < rows.length; index += 1) {
    const rowNeighbors = neighbors[index] ?? [];
    for (let neighborIndex = 0; neighborIndex < NEIGHBORS_PER_TRACK; neighborIndex += 1) {
      const encoded = rowNeighbors[neighborIndex]?.trackOrdinal ?? EMPTY_NEIGHBOR;
      const recordOffset = (index * NEIGHBORS_PER_TRACK * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY)
        + (neighborIndex * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY);
      writeUInt24LE(neighborTable, encoded, recordOffset);
      neighborTable.writeUInt8(encodeSimilarity(rowNeighbors[neighborIndex]?.similarity ?? -1), recordOffset + 3);
    }
  }

  const styleTableOffset = HEADER_BYTES;
  const fileIdentityOffset = styleTableOffset + styleTable.length;
  const fileTrackCountOffset = fileIdentityOffset + fileIdentityTable.length;
  const styleMaskOffset = fileTrackCountOffset + fileTrackCountTable.length;
  const neighborsOffset = styleMaskOffset + styleMaskTable.length + ratingTable.length;

  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC, 0, "ascii");
  header.writeUInt16LE(2, 8);
  header.writeUInt16LE(HEADER_BYTES, 10);
  header.writeUInt32LE(rows.length, 12);
  header.writeUInt32LE(filePaths.length, 16);
  header.writeUInt16LE(PERSONA_IDS.length, 20);
  header.writeUInt16LE(NEIGHBORS_PER_TRACK, 22);
  header.writeUInt8(1, 24);
  header.writeUInt8(3, 25);
  header.writeUInt8(1, 26);
  header.writeUInt8(STYLE_MASK_WIDTH_BYTES, 27);
  header.writeUInt16LE(STYLE_TABLE_VERSION, 28);
  header.writeUInt16LE(GRAPH_FLAGS, 30);
  header.writeUInt32LE(styleTableOffset, 32);
  header.writeUInt32LE(fileIdentityOffset, 36);
  header.writeUInt32LE(fileTrackCountOffset, 40);
  header.writeUInt32LE(styleMaskOffset, 44);
  header.writeUInt32LE(neighborsOffset, 48);
  header.writeUInt32LE(styleTable.length, 52);
  header.writeUInt32LE(fileIdentityTable.length, 56);
  header.writeUInt32LE(neighborTable.length, 60);

  const rawPayload = Buffer.concat([
    header,
    styleTable,
    fileIdentityTable,
    fileTrackCountTable,
    styleMaskTable,
    ratingTable,
    neighborTable,
  ]);
  const writeResult = await writePortableBundlePayload(options.outputPath, rawPayload);

  const manifestPath = computeManifestPath(options.outputPath, options.manifestPath);
  const sourceChecksum = await computeFileChecksum(options.sourceLitePath);
  const neighborChecksum = options.neighborSqlitePath
    ? await computeFileChecksum(options.neighborSqlitePath)
    : undefined;
  const bundleChecksum = await computeFileChecksum(options.outputPath);
  const manifest: TinySimilarityExportManifest = {
    schema_version: TINY_SIMILARITY_EXPORT_SCHEMA_VERSION,
    binary_format_version: 2,
    generated_at: new Date().toISOString(),
    corpus_version: options.corpusVersion ?? path.basename(options.sourceLitePath, path.extname(options.sourceLitePath)),
    hvsc_version: options.hvscVersion ?? (await readLiteManifestHvscVersion(options.sourceLitePath)) ?? HVSC_VERSION_UNKNOWN,
    track_count: rows.length,
    file_count: filePaths.length,
    style_count: PERSONA_IDS.length,
    style_populations: styleAssignment.diagnostics.populations,
    style_population_policy: styleAssignment.policy,
    ...(styleAssignment.waived ? { style_population_waiver: styleAssignment.violations } : {}),
    file_id_kind: "md5_48",
    neighbors_per_track: 3,
    content_encoding: writeResult.contentEncoding,
    bundle_bytes: writeResult.bytesWritten,
    bundle_bytes_uncompressed: writeResult.bytesUncompressed,
    paths: {
      bundle: path.basename(options.outputPath),
      manifest: path.basename(manifestPath),
    },
    source: {
      lite: path.basename(options.sourceLitePath),
      hvsc_root: describeHvscRootForManifest(options.hvscRoot),
      sqlite_neighbor_hint: options.neighborSqlitePath ? path.basename(options.neighborSqlitePath) : undefined,
    },
    source_checksums: {
      lite_sha256: sourceChecksum,
      sqlite_neighbor_hint_sha256: neighborChecksum,
    },
    file_checksums: {
      bundle_sha256: bundleChecksum,
    },
  };
  await writeCanonicalJsonFile(manifestPath, manifest as unknown as JsonValue, {
    action: "data:modify",
  });

  return {
    durationMs: Date.now() - startedAt,
    outputPath: options.outputPath,
    manifestPath,
    manifest,
  };
}

export interface TinyNeighbourGraph {
  binaryFormatVersion: number;
  trackCount: number;
  fileCount: number;
  neighborsPerTrack: number;
  graphFlags: number;
  /**
   * `trackCount * neighborsPerTrack` target ordinals in slot order, `-1` where the slot
   * holds the unused-slot sentinel.
   */
  targets: Int32Array;
  /** Decoded similarity per slot, `NaN` where the slot holds the sentinel. */
  similarities: Float64Array;
  /** File ordinal per track, recovered from FILE_TRACK_COUNT (§4.3). */
  fileOrdinalByTrack: Int32Array;
  /** Style mask per track, so a station simulation can apply the style filter. */
  styleMaskByTrack: Uint16Array;
}

/**
 * Read just the neighbour graph out of a tiny bundle, as flat typed arrays.
 *
 * `openTinySimilarityDataset` also decodes the graph, but it builds a row object per track
 * and needs an HVSC root to recover `sid_path`. Structural analysis needs neither and does
 * need to run over 87,868 tracks repeatedly, so it gets its own decode. The point of having
 * it here rather than in each caller is that the header offsets are stated once: the release
 * gate and the graph analyser previously each carried their own copy of them, which is how a
 * reader and a writer drift apart.
 */
export async function decodeTinyNeighbourGraph(filePath: string): Promise<TinyNeighbourGraph> {
  const { payload } = await readPortableBundlePayload(filePath);
  if (payload.subarray(0, 8).toString("ascii") !== MAGIC) {
    throw new Error(`${filePath} is not a sidcorr-tiny-1 export.`);
  }
  const binaryFormatVersion = payload.readUInt16LE(8);
  if (binaryFormatVersion !== 1 && binaryFormatVersion !== 2) {
    throw new Error(`Unsupported sidcorr-tiny-1 binary version ${binaryFormatVersion}.`);
  }

  const trackCount = payload.readUInt32LE(12);
  const fileCount = payload.readUInt32LE(16);
  const neighborsPerTrack = payload.readUInt16LE(22);
  const graphFlags = payload.readUInt16LE(30);
  const fileTrackCountOffset = payload.readUInt32LE(40);
  const styleMaskOffset = payload.readUInt32LE(44);
  const neighborsOffset = payload.readUInt32LE(48);
  const neighborsBytes = payload.readUInt32LE(60);

  const slots = trackCount * neighborsPerTrack;
  const recordBytes = neighborsBytes === slots * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY
    ? NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY
    : 3;
  const targets = new Int32Array(slots);
  const similarities = new Float64Array(slots);
  for (let slot = 0; slot < slots; slot += 1) {
    const recordOffset = neighborsOffset + (slot * recordBytes);
    const target = readUInt24LE(payload, recordOffset);
    if (target === EMPTY_NEIGHBOR || target >= trackCount) {
      targets[slot] = -1;
      similarities[slot] = Number.NaN;
      continue;
    }
    targets[slot] = target;
    similarities[slot] = recordBytes === NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY
      ? decodeSimilarity(payload.readUInt8(recordOffset + 3))
      : Number.NaN;
  }

  const fileOrdinalByTrack = new Int32Array(trackCount);
  let trackOrdinal = 0;
  for (let fileOrdinal = 0; fileOrdinal < fileCount; fileOrdinal += 1) {
    const tracksInFile = payload.readUInt8(fileTrackCountOffset + fileOrdinal) + 1;
    for (let index = 0; index < tracksInFile && trackOrdinal < trackCount; index += 1) {
      fileOrdinalByTrack[trackOrdinal] = fileOrdinal;
      trackOrdinal += 1;
    }
  }

  const styleMaskByTrack = new Uint16Array(trackCount);
  for (let track = 0; track < trackCount; track += 1) {
    styleMaskByTrack[track] = payload.readUInt16LE(styleMaskOffset + (track * STYLE_MASK_WIDTH_BYTES));
  }

  return {
    binaryFormatVersion,
    trackCount,
    fileCount,
    neighborsPerTrack,
    graphFlags,
    targets,
    similarities,
    fileOrdinalByTrack,
    styleMaskByTrack,
  };
}

export async function openTinySimilarityDataset(
  filePath: string,
  options: OpenTinySimilarityDatasetOptions = {},
): Promise<SimilarityDataset> {
  const { payload } = await readPortableBundlePayload(filePath);
  if (payload.subarray(0, 8).toString("ascii") !== MAGIC) {
    throw new Error("Bundle is not a sidcorr-tiny-1 export.");
  }

  const version = payload.readUInt16LE(8);
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported sidcorr-tiny-1 binary version ${version}.`);
  }

  const trackCount = payload.readUInt32LE(12);
  const fileCount = payload.readUInt32LE(16);
  const styleCount = payload.readUInt16LE(20);
  const fileIdentityOffset = payload.readUInt32LE(36);
  const fileTrackCountOffset = payload.readUInt32LE(40);
  const styleMaskOffset = payload.readUInt32LE(44);
  const neighborsOffset = payload.readUInt32LE(48);
  const styleTableOffset = payload.readUInt32LE(32);
  const fileIdentityBytes = payload.readUInt32LE(56);
  const neighborsBytes = payload.readUInt32LE(60);
  const fileTrackCountBytes = fileCount;
  const styleMaskBytes = trackCount * STYLE_MASK_WIDTH_BYTES;
  const packedRatingBytes = trackCount * COMPACT_RATING_BYTES;
  const styleTableLength = fileIdentityOffset - styleTableOffset;
  const styleTable = payload.subarray(styleTableOffset, styleTableOffset + styleTableLength);
  const styleRecordBytes = styleTable.readUInt16LE(4);
  const payloadBytes = styleTable.readUInt32LE(8);
  const styleRecordStart = 12;
  const stylePayloadStart = styleRecordStart + (styleRecordBytes * styleCount);
  const stylePayload = styleTable.subarray(stylePayloadStart, stylePayloadStart + payloadBytes);
  const styleKeys: string[] = [];
  for (let index = 0; index < styleCount; index += 1) {
    const recordStart = styleRecordStart + (index * styleRecordBytes);
    const keyOffset = styleTable.readUInt32LE(recordStart + 8);
    const keyLength = styleTable.readUInt16LE(recordStart + 12);
    styleKeys.push(stylePayload.subarray(keyOffset, keyOffset + keyLength).toString("utf8"));
  }
  void styleKeys;

  const fileIdentities = payload.subarray(fileIdentityOffset, fileIdentityOffset + fileIdentityBytes);
  const fileTrackCountTable = payload.subarray(fileTrackCountOffset, fileTrackCountOffset + fileTrackCountBytes);
  const styleMaskTable = payload.subarray(styleMaskOffset, styleMaskOffset + styleMaskBytes);
  const hasPackedRatings = version >= 2 && neighborsOffset === styleMaskOffset + styleMaskBytes + packedRatingBytes;
  const ratingTable = hasPackedRatings
    ? payload.subarray(styleMaskOffset + styleMaskBytes, styleMaskOffset + styleMaskBytes + packedRatingBytes)
    : null;
  const neighborTable = payload.subarray(neighborsOffset, neighborsOffset + neighborsBytes);
  const hasNeighborSimilarity = version >= 2 && neighborsBytes === trackCount * NEIGHBORS_PER_TRACK * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY;

  const md548ByFileOrdinal: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    md548ByFileOrdinal.push(fileIdentities.subarray(index * 6, (index + 1) * 6).toString("hex"));
  }
  const pathByMd548 = options.hvscRoot ? await buildMd548PathMap(options.hvscRoot) : new Map<string, string>();

  const fileTrackStarts: number[] = [];
  let runningStart = 0;
  for (let index = 0; index < fileTrackCountTable.length; index += 1) {
    fileTrackStarts.push(runningStart);
    runningStart += fileTrackCountTable.readUInt8(index) + 1;
  }

  const rows: TinyTrackRecord[] = [];
  let fileOrdinal = 0;
  for (let trackOrdinal = 0; trackOrdinal < trackCount; trackOrdinal += 1) {
    while (
      fileOrdinal + 1 < fileTrackStarts.length
      && trackOrdinal >= (fileTrackStarts[fileOrdinal + 1] ?? Number.POSITIVE_INFINITY)
    ) {
      fileOrdinal += 1;
    }
    const start = fileTrackStarts[fileOrdinal] ?? 0;
    const songIndex = (trackOrdinal - start) + 1;
    const sidPath = pathByMd548.get(md548ByFileOrdinal[fileOrdinal] ?? "")
      ?? `md5_48:${md548ByFileOrdinal[fileOrdinal] ?? fileOrdinal.toString(16)}`;
    const ratings = ratingTable
      ? unpackCompactRatings(ratingTable.readUInt16LE(trackOrdinal * COMPACT_RATING_BYTES))
      : { e: 3, m: 3, c: 3, p: null };
    const styleMask = styleMaskTable.readUInt16LE(trackOrdinal * STYLE_MASK_WIDTH_BYTES);
    const neighbors: Array<{ trackOrdinal: number; similarity: number }> = [];
    for (let neighborIndex = 0; neighborIndex < NEIGHBORS_PER_TRACK; neighborIndex += 1) {
      const recordOffset = hasNeighborSimilarity
        ? (trackOrdinal * NEIGHBORS_PER_TRACK * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY)
          + (neighborIndex * NEIGHBOR_RECORD_BYTES_WITH_SIMILARITY)
        : (trackOrdinal * NEIGHBORS_PER_TRACK * 3) + (neighborIndex * 3);
      const value = readUInt24LE(neighborTable, recordOffset);
      if (value === EMPTY_NEIGHBOR || value >= trackCount) {
        continue;
      }
      const similarity = hasNeighborSimilarity
        ? decodeSimilarity(neighborTable.readUInt8(recordOffset + 3))
        : 0.8 - (neighborIndex * 0.05);
      neighbors.push({ trackOrdinal: value, similarity });
    }
    rows.push({
      track_id: buildSimilarityTrackId(sidPath, songIndex),
      sid_path: sidPath,
      song_index: songIndex,
      e: ratings.e,
      m: ratings.m,
      c: ratings.c,
      p: ratings.p,
      likes: 0,
      dislikes: 0,
      skips: 0,
      plays: 0,
      decayed_likes: 0,
      decayed_dislikes: 0,
      decayed_skips: 0,
      decayed_plays: 0,
      last_played: null,
      neighbors,
      styleMask,
    });
  }

  const reverseAdjacency = new Map<number, Array<{ trackOrdinal: number; similarity: number }>>();
  for (let sourceOrdinal = 0; sourceOrdinal < rows.length; sourceOrdinal += 1) {
    for (const edge of rows[sourceOrdinal]!.neighbors) {
      const arr = reverseAdjacency.get(edge.trackOrdinal) ?? [];
      arr.push({ trackOrdinal: sourceOrdinal, similarity: edge.similarity });
      reverseAdjacency.set(edge.trackOrdinal, arr);
    }
  }

  const rowsByTrackId = new Map(rows.map((row) => [row.track_id, row]));
  const trackOrdinalByTrackId = new Map(rows.map((row, index) => [row.track_id, index]));

  /**
   * Look a track id up, tolerating an extra leading path segment.
   *
   * The bundle stores files by a 48-bit MD5 prefix rather than by path, so the
   * reader reconstructs track ids by walking the HVSC tree — relative to the MUSIC
   * root, which yields "DEMOS/x.sid#1". Whether the SQLite and lite exports agree
   * depends on where the operator pointed `sidPath`: at the HVSC root they produce
   * "C64Music/DEMOS/x.sid#1" instead.
   *
   * When the two disagree, nothing fails loudly. The bundle builds, reports correct
   * track and file counts, and then resolves nothing at all: measured on an
   * 11,284-track corpus, every lookup returned null and every station came back
   * empty. The builder already accepts either form when hashing files, so accepting
   * either form here is what makes the three profiles genuinely interchangeable
   * instead of interchangeable-only-if-configured-identically.
   *
   * The fallback is tried only after an exact miss, and only for ids that have a
   * leading segment to drop, so it cannot shadow a real row.
   */
  /**
   * The row's own id for a caller-supplied id, so exclusion sets compare like with
   * like.
   *
   * Without this, tolerating an extra leading segment on LOOKUP would fix resolution
   * and leave exclusion broken: the caller passes "C64Music/x.sid#1" while the row
   * calls itself "x.sid#1", so `favoriteTrackIds.includes(row.track_id)` never
   * matches and a station recommends its own seed back at similarity 1.0.
   */
  function canonicalTrackId(trackId: string): string {
    return findRow(trackId).row?.track_id ?? trackId;
  }

  function findRow(trackId: string): { row: (typeof rows)[number] | undefined; ordinal: number | undefined } {
    const exact = rowsByTrackId.get(trackId);
    if (exact) {
      return { row: exact, ordinal: trackOrdinalByTrackId.get(trackId) };
    }
    const separator = trackId.indexOf("/");
    if (separator <= 0) {
      return { row: undefined, ordinal: undefined };
    }
    const withoutLeadingSegment = trackId.slice(separator + 1);
    return {
      row: rowsByTrackId.get(withoutLeadingSegment),
      ordinal: trackOrdinalByTrackId.get(withoutLeadingSegment),
    };
  }

  return {
    info: {
      format: "tiny",
      schemaVersion: TINY_SIMILARITY_EXPORT_SCHEMA_VERSION,
      sourcePath: filePath,
      trackCount,
      hasTrackIdentity: true,
      /**
       * Tiny carries no vectors. Its 1.8 MB is file identities, per-file subsong
       * counts, style masks, packed ratings and a 3-neighbour graph -- which is why
       * its size barely moved when the vector went from 4 to 58 dimensions.
       *
       * This used to report `true` while `getTrackVectors()` synthesised
       * [e, m, c, p ?? 3]: a 4-element rating vector with at most 125 distinct
       * positions across 87,868 tracks, sitting exactly at the legacy ratings width,
       * so it received no weighting either. A consumer that branched on this flag and
       * did centroid arithmetic silently reproduced the 0.5-era degeneracy this
       * release exists to have fixed.
       *
       * Tiny's retrieval model is a decayed walk over the neighbour graph, not vector
       * search. Saying so is the honest answer.
       */
      hasVectorData: false,
    },
    readRandomTracksExcluding(limit, excludedTrackIds, random) {
      return pickRandomRows(rows, limit, excludedTrackIds, random).map((row) => ({
        track_id: row.track_id,
        sid_path: row.sid_path,
        song_index: row.song_index,
        e: row.e,
        m: row.m,
        c: row.c,
        p: row.p,
        likes: row.likes,
        dislikes: row.dislikes,
        skips: row.skips,
        plays: row.plays,
        decayed_likes: row.decayed_likes,
        decayed_dislikes: row.decayed_dislikes,
        decayed_skips: row.decayed_skips,
        decayed_plays: row.decayed_plays,
        last_played: row.last_played,
      }));
    },
    resolveTracks(trackIds) {
      return new Map(trackIds.flatMap((trackId) => {
        const { row } = findRow(trackId);
        return row ? [[trackId, {
          track_id: row.track_id,
          sid_path: row.sid_path,
          song_index: row.song_index,
          e: row.e,
          m: row.m,
          c: row.c,
          p: row.p,
          likes: row.likes,
          dislikes: row.dislikes,
          skips: row.skips,
          plays: row.plays,
          decayed_likes: row.decayed_likes,
          decayed_dislikes: row.decayed_dislikes,
          decayed_skips: row.decayed_skips,
          decayed_plays: row.decayed_plays,
          last_played: row.last_played,
        } satisfies SimilarityTrackRow]] : [];
      }));
    },
    resolveTrack(trackId) {
      const { row } = findRow(trackId);
      return row ? {
        track_id: row.track_id,
        sid_path: row.sid_path,
        song_index: row.song_index,
        e: row.e,
        m: row.m,
        c: row.c,
        p: row.p,
        likes: row.likes,
        dislikes: row.dislikes,
        skips: row.skips,
        plays: row.plays,
        decayed_likes: row.decayed_likes,
        decayed_dislikes: row.decayed_dislikes,
        decayed_skips: row.decayed_skips,
        decayed_plays: row.decayed_plays,
        last_played: row.last_played,
      } : null;
    },
    getTrackVectors() {
      // Empty, always, and consistent with `hasVectorData: false`. Returning a
      // synthesised rating vector here was the mechanism by which the flag above lied:
      // a caller got four numbers that behaved like a vector, arithmetic on them
      // succeeded, and the result was noise.
      return new Map<string, number[]>();
    },
    getNeighbors(trackId, limit = 20, excludeTrackIds = []) {
      const exclude = new Set(excludeTrackIds);
      const { row, ordinal: trackOrdinal } = findRow(trackId);
      if (!row || trackOrdinal === undefined) {
        return [];
      }
      const neighborScores = new Map<number, number>();
      for (const edge of row.neighbors) {
        neighborScores.set(edge.trackOrdinal, Math.max(neighborScores.get(edge.trackOrdinal) ?? -1, edge.similarity));
      }
      for (const edge of reverseAdjacency.get(trackOrdinal) ?? []) {
        neighborScores.set(edge.trackOrdinal, Math.max(neighborScores.get(edge.trackOrdinal) ?? -1, edge.similarity));
      }
      return [...neighborScores.entries()]
        .filter(([neighborOrdinal]) => !exclude.has(rows[neighborOrdinal]!.track_id))
        .map(([neighborOrdinal, similarity]) => ({ trackOrdinal: neighborOrdinal, similarity }))
        .sort((left, right) => right.similarity - left.similarity || left.trackOrdinal - right.trackOrdinal)
        .slice(0, Math.max(1, limit))
        .map((edge, index) => {
          const neighbor = rows[edge.trackOrdinal]!;
          return {
            track_id: neighbor.track_id,
            sid_path: neighbor.sid_path,
            song_index: neighbor.song_index,
            score: edge.similarity,
            rank: index + 1,
            e: neighbor.e,
            m: neighbor.m,
            c: neighbor.c,
            p: neighbor.p ?? undefined,
            likes: neighbor.likes,
            dislikes: neighbor.dislikes,
            skips: neighbor.skips,
            plays: neighbor.plays,
            decayed_likes: neighbor.decayed_likes,
            decayed_dislikes: neighbor.decayed_dislikes,
            decayed_skips: neighbor.decayed_skips,
            decayed_plays: neighbor.decayed_plays,
            last_played: neighbor.last_played ?? undefined,
          } satisfies SimilarityExportRecommendation;
        });
    },
    getStyleMask(trackId) {
      const { row } = findRow(trackId);
      return row ? row.styleMask : null;
    },
    recommendFromFavorites(options) {
      const weightsByTrackId = options.weightsByTrackId ?? {};
      const excludeTrackIds = new Set((options.excludeTrackIds ?? []).map(canonicalTrackId));
      const favoriteCanonicalIds = new Set(options.favoriteTrackIds.map(canonicalTrackId));
      const scores = new Map<number, number>();
      // Ranking and reported similarity are tracked separately, because they answer
      // different questions and only one of them is on a scale anyone else shares.
      //
      // `scores` accumulates walk strength: a track reachable by several paths sums their
      // contributions, which is the right way to RANK "closest to this set of favourites".
      // It is not a similarity, it is unbounded, and reporting it as one is what broke the
      // station layer -- that layer applies an absolute minimum-similarity threshold
      // (0.73 at adventure 3), calibrated for cosine values where "similar" means ~0.9 up.
      //
      // `pathSimilarity` is the product of the stored edge similarities along the best
      // path that reached a track. It stays in [0, 1], it decays with graph distance the
      // way a similarity should, and a direct neighbour reports very nearly its stored
      // edge similarity -- so it is directly comparable to the cosine the other two
      // profiles report, and to that threshold.
      const pathSimilarity = new Map<number, number>();
      let frontier = new Map<number, number>();
      let frontierSimilarity = new Map<number, number>();
      for (const favoriteTrackId of options.favoriteTrackIds) {
        const { ordinal: favoriteOrdinal } = findRow(favoriteTrackId);
        if (favoriteOrdinal === undefined) {
          continue;
        }
        const favoriteWeight = weightsByTrackId[favoriteTrackId] ?? 1;
        frontier.set(favoriteOrdinal, (frontier.get(favoriteOrdinal) ?? 0) + favoriteWeight);
        // A favourite is perfectly similar to itself, so paths start at 1.
        frontierSimilarity.set(favoriteOrdinal, 1);
      }

      for (let depth = 0; depth < 5 && frontier.size > 0; depth += 1) {
        const nextFrontier = new Map<number, number>();
        const nextFrontierSimilarity = new Map<number, number>();
        const forwardDecay = Math.pow(0.76, depth);
        const reverseDecay = Math.pow(0.70, depth);

        const walk = (
          trackOrdinal: number,
          strength: number,
          edges: Array<{ trackOrdinal: number; similarity: number }>,
          decay: number,
          reverseFactor: number,
        ): void => {
          const parentSimilarity = frontierSimilarity.get(trackOrdinal) ?? 0;
          for (const edge of edges) {
            const contribution = strength * edge.similarity * reverseFactor * decay;
            scores.set(edge.trackOrdinal, (scores.get(edge.trackOrdinal) ?? 0) + contribution);
            nextFrontier.set(edge.trackOrdinal, (nextFrontier.get(edge.trackOrdinal) ?? 0) + contribution);

            // Best path wins, so a track reachable both directly and via a detour reports
            // the directer relationship rather than the weaker one.
            const chained = Math.max(0, Math.min(1, parentSimilarity * edge.similarity));
            if (chained > (pathSimilarity.get(edge.trackOrdinal) ?? 0)) {
              pathSimilarity.set(edge.trackOrdinal, chained);
            }
            if (chained > (nextFrontierSimilarity.get(edge.trackOrdinal) ?? 0)) {
              nextFrontierSimilarity.set(edge.trackOrdinal, chained);
            }
          }
        };

        for (const [trackOrdinal, strength] of frontier) {
          walk(trackOrdinal, strength, rows[trackOrdinal]?.neighbors ?? [], forwardDecay, 1);
          walk(trackOrdinal, strength, reverseAdjacency.get(trackOrdinal) ?? [], reverseDecay, 0.92);
        }

        frontier = new Map(
          [...nextFrontier.entries()]
            .sort((left, right) => right[1] - left[1] || left[0] - right[0])
            .slice(0, 256),
        );
        frontierSimilarity = nextFrontierSimilarity;
      }

      // The walk above IS the ranking. There used to be a block here that computed a
      // cosine over [e, m, c, p ?? 3] for every track in the corpus and `set` -- not
      // added -- the result into `scores`, guarded only on a favourite having
      // resolved. It read as a fallback and behaved as a replacement: whenever the
      // function returned anything at all, 100% of the ranking came from a 4-element
      // rating vector, and the neighbour graph that is 57% of this bundle's bytes
      // contributed nothing. Measured on a purpose-built corpus, a seed whose stored
      // neighbours were T6 @ 0.867 and T7 @ 0.725 got them back 5th and 7th, behind
      // two tracks that were not its neighbours at all.
      //
      // It is deleted rather than guarded on `scores.size === 0` because the same
      // change that fixed this declared that rating vector unfit as a retrieval key:
      // it takes at most 125 distinct values over 87,868 tracks, and ties break by
      // ordinal, so the same low-ordinal tracks win every tie for every listener.
      // Keeping it as a genuine fallback would mean reaching for a key we have just
      // established is degenerate, precisely when the good one has nothing to say.
      //
      // The consequence is deliberate and documented in the tiny specification: a
      // favourites call whose seeds have no neighbour edges returns nothing, rather
      // than returning noise that looks like a recommendation.

      const candidates = [...scores.entries()]
        .map(([trackOrdinal, score]) => ({ trackOrdinal, score }))
        .filter(({ trackOrdinal }) => !excludeTrackIds.has(rows[trackOrdinal]!.track_id) && !favoriteCanonicalIds.has(rows[trackOrdinal]!.track_id))
        .sort((left, right) => right.score - left.score || left.trackOrdinal - right.trackOrdinal);

      // Rank by walk strength, report path similarity.
      //
      // Reporting the raw walk score does not work: it accumulates, so it routinely
      // exceeds 1, and clamping it to [-1, 1] -- which is what this used to do -- made
      // every strongly-connected candidate report exactly 1.0. Measured on the shipped
      // bundle, a seed's top 100 came back with ONE distinct score between them while the
      // walk underneath had 973 distinct values across the 1,674 tracks it reached.
      //
      // Nor does normalising it against the strongest match. That reads as a sensible
      // [0, 1] value and is not a similarity: SIDFlow's own station layer applies an
      // absolute minimum-similarity threshold -- 0.73 at the default adventure setting,
      // calibrated for cosine values -- and a normalised rank collapses a full station to
      // three tracks against it. Measured, on the real corpus.
      //
      // `pathSimilarity` is the quantity that belongs in this field: bounded, decaying
      // with graph distance, and on the same scale as the cosine the sqlite and lite
      // profiles report.
      return candidates
        .slice(0, Math.max(1, options.limit ?? 100))
        .map(({ trackOrdinal }, index) => {
          const row = rows[trackOrdinal]!;
          return {
            track_id: row.track_id,
            sid_path: row.sid_path,
            song_index: row.song_index,
            score: pathSimilarity.get(trackOrdinal) ?? 0,
            rank: index + 1,
            e: row.e,
            m: row.m,
            c: row.c,
            likes: 0,
            dislikes: 0,
            skips: 0,
            plays: 0,
            decayed_likes: 0,
            decayed_dislikes: 0,
            decayed_skips: 0,
            decayed_plays: 0,
          } satisfies SimilarityExportRecommendation;
        });
    },
  };
}
