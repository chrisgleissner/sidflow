/**
 * SID ROM Dependency List, format id `sidromdep-1`.
 *
 * A tiny, allow-by-default list of the HVSC subtunes whose playback fidelity without (some of) the
 * C64 ROMs was graded 0..253 in at least one engine/ROM lane. Normative specification:
 * doc/rom-dependency-list.md.
 *
 * This module is dependency-free apart from node:crypto so other projects can lift it verbatim.
 * It encodes, decodes (with full structural and checksum validation) and looks up; it does not
 * read grading results (see scripts/rom-dependency-list/).
 */
import { createHash } from "node:crypto";

export const ROM_DEP_FORMAT_ID = "sidromdep-1";
export const ROM_DEP_MAGIC = "SIDROMDP";
export const ROM_DEP_VERSION = 1;
export const ROM_DEP_HEADER_BYTES = 224;
export const ROM_DEP_FILE_RECORD_BYTES = 17;
export const ROM_DEP_DECISION_RECORD_BYTES = 5;
/**
 * Header flag bit 0: the grading input was incomplete (unmeasured lanes). Subtunes with an unmeasured lane are
 * excluded from the list, so for them "unlisted" says nothing. A developer artefact, never a release.
 */
export const ROM_DEP_FLAG_INCOMPLETE_SOURCE = 0x1;
export const ROM_DEP_KNOWN_FLAGS = ROM_DEP_FLAG_INCOMPLETE_SOURCE;
export const ROM_DEP_MAX_SUBTUNE = 256;

/** Lane order of the four grade bytes of a DECISION record. */
export const ROM_DEP_LANE_NAMES = ["sidliteNone", "sidliteKernalBasic", "residfpNone", "residfpKernalBasic"] as const;
export type RomDepLaneName = (typeof ROM_DEP_LANE_NAMES)[number];

/** Grade meanings (doc/research/hvsc-rom-fidelity-grading.md). 1..253 are graded; there is no "unknown" grade. */
export const ROM_DEP_GRADE_NO_PLAYBACK = 0;
export const ROM_DEP_GRADE_RETIMED = 254;
export const ROM_DEP_GRADE_BIT_EXACT = 255;
/** A subtune is listed iff some lane grade is <= this. Unlisted therefore means every lane >= 254. */
export const ROM_DEP_LISTING_CEILING = 253;

export type RomDepGrades = Record<RomDepLaneName, number>;

export interface RomDepDecision {
  /** One-based subtune number, 1..256. */
  subtune: number;
  /** Grade 0..255 per lane; at least one lane must be <= the listing ceiling (253). */
  grades: RomDepGrades;
}

export interface RomDepEntry {
  /** Full-file MD5 as 32 lowercase hex characters. */
  md5: string;
  decisions: RomDepDecision[];
}

export interface RomDepProvenance {
  /** SHA-256 (64 hex) of the grading results file the list was derived from. */
  sourceSha256: string;
  /** SHA-256 (64 hex) of the HVSC Songlengths.md5 the grading used. */
  songlengthsSha256: string;
  /** Corpus id (64 hex) of the graded HVSC release. */
  corpusId: string;
  /** Frozen grading methodology identity (64 hex). */
  gradingMethodologySha256: string;
}

export interface RomDepContent {
  hvscRelease: number;
  /** Number of files graded in the source (informational). */
  sourceFiles: number;
  /** Number of subtunes graded in the source (informational). */
  sourceSubtunes: number;
  incompleteSource: boolean;
  /** Consumer default skip threshold, 1..254: skip when the lane grade is below it. Consumers may choose their own. */
  recommendedMinGrade: number;
  provenance: RomDepProvenance;
  entries: readonly RomDepEntry[];
}

export interface RomDepHeader {
  formatVersion: number;
  headerBytes: number;
  flags: number;
  incompleteSource: boolean;
  hvscRelease: number;
  sourceFiles: number;
  sourceSubtunes: number;
  fileCount: number;
  decisionCount: number;
  fileSectionOffset: number;
  fileSectionBytes: number;
  decisionSectionOffset: number;
  decisionSectionBytes: number;
  fileRecordBytes: number;
  decisionRecordBytes: number;
  listingCeiling: number;
  recommendedMinGrade: number;
  headerCrc32: number;
  payloadSha256: string;
  provenance: RomDepProvenance;
}

export interface RomDepLookup {
  /** True when the subtune has a DECISION record (some lane graded <= 253). */
  listed: boolean;
  /**
   * Exact grades when listed. When unlisted every lane is 254, which is a LOWER BOUND: the true grade is 254 or 255
   * (the list does not distinguish them) and never a restriction.
   */
  grades: RomDepGrades;
  /** Lowest lane grade (254 when unlisted). */
  minGrade: number;
}

export interface RomDependencyList {
  header: RomDepHeader;
  /** The exact bytes that were decoded. */
  bytes: Uint8Array;
  /** Binary search on the full MD5 (hex string or 16 raw bytes), then scan of that file's decisions. */
  lookup(md5: string | Uint8Array, subtune: number): RomDepLookup;
  /** Materialise every record, in file order. */
  entries(): RomDepEntry[];
}

export class RomDependencyListError extends Error {
  constructor(message: string) {
    super(`Invalid SID ROM dependency list: ${message}`);
    this.name = "RomDependencyListError";
  }
}

const HEX_MD5 = /^[0-9a-f]{32}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE 802.3, as in zlib/PNG). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** True when some lane is below the listing ceiling, i.e. the subtune must be listed. */
export function mustList(grades: RomDepGrades): boolean {
  return ROM_DEP_LANE_NAMES.some((lane) => grades[lane] <= ROM_DEP_LISTING_CEILING);
}

/** Lowest grade across lanes. */
export function minGradeOf(grades: RomDepGrades): number {
  return Math.min(...ROM_DEP_LANE_NAMES.map((lane) => grades[lane]));
}

const UNLISTED_GRADES: Readonly<RomDepGrades> = Object.freeze({
  sidliteNone: ROM_DEP_GRADE_RETIMED,
  sidliteKernalBasic: ROM_DEP_GRADE_RETIMED,
  residfpNone: ROM_DEP_GRADE_RETIMED,
  residfpKernalBasic: ROM_DEP_GRADE_RETIMED,
});

export function md5ToBytes(md5: string | Uint8Array): Uint8Array {
  if (typeof md5 !== "string") {
    if (md5.length !== 16) throw new RomDependencyListError("MD5 must be 16 bytes");
    return md5;
  }
  if (!HEX_MD5.test(md5)) throw new RomDependencyListError(`MD5 must be 32 lowercase hex characters: ${md5}`);
  return Uint8Array.from(Buffer.from(md5, "hex"));
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
}

function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RomDependencyListError(`${name} is not a uint32`);
}

function assertHex256(value: string, name: string): void {
  if (!HEX_SHA256.test(value)) throw new RomDependencyListError(`${name} must be 64 lowercase hex characters`);
}

function assertRecommended(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > ROM_DEP_GRADE_RETIMED) {
    throw new RomDependencyListError("recommended_min_grade must be 1..254 (the list cannot express thresholds above its unlisted floor)");
  }
}

/** Validate one decision. Shared by encoder and decoder so both enforce the same canonical form. */
function assertDecision(decision: RomDepDecision, context: string): void {
  const { subtune, grades } = decision;
  if (!Number.isInteger(subtune) || subtune < 1 || subtune > ROM_DEP_MAX_SUBTUNE) throw new RomDependencyListError(`${context}: subtune out of range 1..256`);
  for (const lane of ROM_DEP_LANE_NAMES) {
    const grade = grades[lane];
    if (!Number.isInteger(grade) || grade < 0 || grade > 255) throw new RomDependencyListError(`${context}: ${lane} grade out of range 0..255`);
  }
  if (!mustList(grades)) throw new RomDependencyListError(`${context}: every lane is >= 254, so the subtune must be unlisted`);
}

function writeDigest(target: Buffer, offset: number, hex: string, name: string): void {
  assertHex256(hex, name);
  Buffer.from(hex, "hex").copy(target, offset);
}

/** Encode to the canonical byte sequence. Entries may be in any order; they are sorted by MD5 and decisions by subtune. */
export function encodeRomDependencyList(content: RomDepContent): Uint8Array {
  assertUint32(content.hvscRelease, "hvscRelease");
  if (content.hvscRelease < 1) throw new RomDependencyListError("hvscRelease must be >= 1");
  assertUint32(content.sourceFiles, "sourceFiles");
  assertUint32(content.sourceSubtunes, "sourceSubtunes");
  assertRecommended(content.recommendedMinGrade);
  const entries = [...content.entries].sort((a, b) => (a.md5 < b.md5 ? -1 : a.md5 > b.md5 ? 1 : 0));
  let decisionCount = 0;
  entries.forEach((entry, index) => {
    if (!HEX_MD5.test(entry.md5)) throw new RomDependencyListError(`entry ${index}: MD5 must be 32 lowercase hex characters`);
    if (index > 0 && entries[index - 1]!.md5 === entry.md5) throw new RomDependencyListError(`duplicate MD5 ${entry.md5}`);
    if (entry.decisions.length < 1 || entry.decisions.length > ROM_DEP_MAX_SUBTUNE) throw new RomDependencyListError(`${entry.md5}: needs 1..256 decisions`);
    const seen = new Set<number>();
    for (const decision of entry.decisions) {
      assertDecision(decision, `${entry.md5}#${decision.subtune}`);
      if (seen.has(decision.subtune)) throw new RomDependencyListError(`${entry.md5}: duplicate subtune ${decision.subtune}`);
      seen.add(decision.subtune);
    }
    decisionCount += entry.decisions.length;
  });
  assertUint32(entries.length, "fileCount");
  assertUint32(decisionCount, "decisionCount");

  const fileBytes = entries.length * ROM_DEP_FILE_RECORD_BYTES;
  const decisionBytes = decisionCount * ROM_DEP_DECISION_RECORD_BYTES;
  const total = ROM_DEP_HEADER_BYTES + fileBytes + decisionBytes;
  const out = Buffer.alloc(total);
  let fileCursor = ROM_DEP_HEADER_BYTES;
  let decisionCursor = ROM_DEP_HEADER_BYTES + fileBytes;
  for (const entry of entries) {
    Buffer.from(entry.md5, "hex").copy(out, fileCursor);
    out[fileCursor + 16] = entry.decisions.length - 1;
    fileCursor += ROM_DEP_FILE_RECORD_BYTES;
    for (const decision of [...entry.decisions].sort((a, b) => a.subtune - b.subtune)) {
      out[decisionCursor] = decision.subtune - 1;
      ROM_DEP_LANE_NAMES.forEach((lane, i) => { out[decisionCursor + 1 + i] = decision.grades[lane]; });
      decisionCursor += ROM_DEP_DECISION_RECORD_BYTES;
    }
  }

  out.write(ROM_DEP_MAGIC, 0, "ascii");
  out.writeUInt16LE(ROM_DEP_VERSION, 8);
  out.writeUInt16LE(ROM_DEP_HEADER_BYTES, 10);
  out.writeUInt32LE(content.incompleteSource ? ROM_DEP_FLAG_INCOMPLETE_SOURCE : 0, 12);
  out.writeUInt32LE(content.hvscRelease, 16);
  out.writeUInt32LE(content.sourceFiles, 20);
  out.writeUInt32LE(content.sourceSubtunes, 24);
  out.writeUInt32LE(entries.length, 28);
  out.writeUInt32LE(decisionCount, 32);
  out.writeUInt32LE(ROM_DEP_HEADER_BYTES, 36);
  out.writeUInt32LE(fileBytes, 40);
  out.writeUInt32LE(ROM_DEP_HEADER_BYTES + fileBytes, 44);
  out.writeUInt32LE(decisionBytes, 48);
  // 52: header_crc32, filled in last
  out.writeUInt16LE(ROM_DEP_FILE_RECORD_BYTES, 56);
  out.writeUInt16LE(ROM_DEP_DECISION_RECORD_BYTES, 58);
  out[60] = ROM_DEP_LISTING_CEILING;
  out[61] = content.recommendedMinGrade;
  // 62..63 reserved, zero
  writeDigest(out, 64, sha256Hex(out.subarray(ROM_DEP_HEADER_BYTES)), "payloadSha256");
  writeDigest(out, 96, content.provenance.sourceSha256, "sourceSha256");
  writeDigest(out, 128, content.provenance.songlengthsSha256, "songlengthsSha256");
  writeDigest(out, 160, content.provenance.corpusId, "corpusId");
  writeDigest(out, 192, content.provenance.gradingMethodologySha256, "gradingMethodologySha256");
  out.writeUInt32LE(crc32(out.subarray(0, ROM_DEP_HEADER_BYTES)), 52);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function compareMd5(bytes: Uint8Array, offset: number, key: Uint8Array): number {
  for (let i = 0; i < 16; i++) {
    const delta = bytes[offset + i]! - key[i]!;
    if (delta !== 0) return delta;
  }
  return 0;
}

function readDecision(bytes: Uint8Array, at: number): RomDepDecision {
  const grades = {} as RomDepGrades;
  ROM_DEP_LANE_NAMES.forEach((lane, i) => { grades[lane] = bytes[at + 1 + i]!; });
  return { subtune: bytes[at]! + 1, grades };
}

/**
 * Decode and fully validate. Throws RomDependencyListError on any deviation: truncation, trailing bytes,
 * checksum mismatch, unknown version/flags/reserved bits, non-canonical ordering, unlistable records.
 */
export function decodeRomDependencyList(input: Uint8Array): RomDependencyList {
  const bytes = input;
  if (bytes.length < ROM_DEP_HEADER_BYTES) throw new RomDependencyListError("truncated header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== ROM_DEP_MAGIC) throw new RomDependencyListError("bad magic");
  const formatVersion = view.getUint16(8, true);
  if (formatVersion !== ROM_DEP_VERSION) throw new RomDependencyListError(`unsupported format version ${formatVersion}`);
  const headerBytes = view.getUint16(10, true);
  if (headerBytes !== ROM_DEP_HEADER_BYTES) throw new RomDependencyListError(`header_bytes must be ${ROM_DEP_HEADER_BYTES}`);
  const headerCopy = Uint8Array.from(bytes.subarray(0, ROM_DEP_HEADER_BYTES));
  const headerCrc32 = view.getUint32(52, true);
  new DataView(headerCopy.buffer).setUint32(52, 0, true);
  if (crc32(headerCopy) !== headerCrc32) throw new RomDependencyListError("header CRC-32 mismatch");
  const flags = view.getUint32(12, true);
  if (flags & ~ROM_DEP_KNOWN_FLAGS) throw new RomDependencyListError("unknown flag bits set");
  if (view.getUint16(62, true) !== 0) throw new RomDependencyListError("reserved field is not zero");
  const header: RomDepHeader = {
    formatVersion,
    headerBytes,
    flags,
    incompleteSource: (flags & ROM_DEP_FLAG_INCOMPLETE_SOURCE) !== 0,
    hvscRelease: view.getUint32(16, true),
    sourceFiles: view.getUint32(20, true),
    sourceSubtunes: view.getUint32(24, true),
    fileCount: view.getUint32(28, true),
    decisionCount: view.getUint32(32, true),
    fileSectionOffset: view.getUint32(36, true),
    fileSectionBytes: view.getUint32(40, true),
    decisionSectionOffset: view.getUint32(44, true),
    decisionSectionBytes: view.getUint32(48, true),
    fileRecordBytes: view.getUint16(56, true),
    decisionRecordBytes: view.getUint16(58, true),
    listingCeiling: bytes[60]!,
    recommendedMinGrade: bytes[61]!,
    headerCrc32,
    payloadSha256: bytesToHex(bytes.subarray(64, 96)),
    provenance: {
      sourceSha256: bytesToHex(bytes.subarray(96, 128)),
      songlengthsSha256: bytesToHex(bytes.subarray(128, 160)),
      corpusId: bytesToHex(bytes.subarray(160, 192)),
      gradingMethodologySha256: bytesToHex(bytes.subarray(192, 224)),
    },
  };
  if (header.hvscRelease < 1) throw new RomDependencyListError("hvsc_release must be >= 1");
  if (header.fileRecordBytes !== ROM_DEP_FILE_RECORD_BYTES || header.decisionRecordBytes !== ROM_DEP_DECISION_RECORD_BYTES) throw new RomDependencyListError("unsupported record sizes");
  if (header.listingCeiling !== ROM_DEP_LISTING_CEILING) throw new RomDependencyListError(`listing_ceiling must be ${ROM_DEP_LISTING_CEILING}`);
  assertRecommended(header.recommendedMinGrade);
  const fileBytes = header.fileCount * ROM_DEP_FILE_RECORD_BYTES;
  const decisionBytes = header.decisionCount * ROM_DEP_DECISION_RECORD_BYTES;
  if (header.fileSectionOffset !== ROM_DEP_HEADER_BYTES || header.fileSectionBytes !== fileBytes ||
      header.decisionSectionOffset !== ROM_DEP_HEADER_BYTES + fileBytes || header.decisionSectionBytes !== decisionBytes) {
    throw new RomDependencyListError("section offsets/lengths are not the canonical tightly packed layout");
  }
  if (bytes.length < ROM_DEP_HEADER_BYTES + fileBytes + decisionBytes) throw new RomDependencyListError("truncated payload");
  if (bytes.length > ROM_DEP_HEADER_BYTES + fileBytes + decisionBytes) throw new RomDependencyListError("trailing bytes after the last section");
  if (sha256Hex(bytes.subarray(ROM_DEP_HEADER_BYTES)) !== header.payloadSha256) throw new RomDependencyListError("payload SHA-256 mismatch");

  // Structure: strictly ascending MD5s, per-file counts summing to the decision count, ascending subtunes, listable records.
  const firstDecision = new Uint32Array(header.fileCount + 1);
  let running = 0;
  for (let i = 0; i < header.fileCount; i++) {
    const at = header.fileSectionOffset + i * ROM_DEP_FILE_RECORD_BYTES;
    if (i > 0 && compareMd5(bytes, at, bytes.subarray(at - ROM_DEP_FILE_RECORD_BYTES, at - ROM_DEP_FILE_RECORD_BYTES + 16)) <= 0) {
      throw new RomDependencyListError(`file records are not strictly ascending at index ${i}`);
    }
    firstDecision[i] = running;
    running += bytes[at + 16]! + 1;
  }
  firstDecision[header.fileCount] = running;
  if (running !== header.decisionCount) throw new RomDependencyListError("per-file decision counts do not sum to decision_count");
  for (let i = 0; i < header.fileCount; i++) {
    let previous = 0;
    for (let d = firstDecision[i]!; d < firstDecision[i + 1]!; d++) {
      const decision = readDecision(bytes, header.decisionSectionOffset + d * ROM_DEP_DECISION_RECORD_BYTES);
      assertDecision(decision, `file ${i}`);
      if (decision.subtune <= previous) throw new RomDependencyListError(`file ${i}: subtunes are not strictly ascending`);
      previous = decision.subtune;
    }
  }

  const find = (key: Uint8Array): number => {
    let low = 0;
    let high = header.fileCount - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = compareMd5(bytes, header.fileSectionOffset + mid * ROM_DEP_FILE_RECORD_BYTES, key);
      if (cmp === 0) return mid;
      if (cmp < 0) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  };

  return {
    header,
    bytes,
    lookup(md5, subtune) {
      const unlisted: RomDepLookup = { listed: false, grades: { ...UNLISTED_GRADES }, minGrade: ROM_DEP_GRADE_RETIMED };
      if (!Number.isInteger(subtune) || subtune < 1 || subtune > ROM_DEP_MAX_SUBTUNE) return unlisted;
      const index = find(md5ToBytes(md5));
      if (index < 0) return unlisted;
      for (let d = firstDecision[index]!; d < firstDecision[index + 1]!; d++) {
        const at = header.decisionSectionOffset + d * ROM_DEP_DECISION_RECORD_BYTES;
        if (bytes[at]! + 1 === subtune) {
          const decision = readDecision(bytes, at);
          return { listed: true, grades: decision.grades, minGrade: minGradeOf(decision.grades) };
        }
      }
      return unlisted;
    },
    entries() {
      const out: RomDepEntry[] = [];
      for (let i = 0; i < header.fileCount; i++) {
        const at = header.fileSectionOffset + i * ROM_DEP_FILE_RECORD_BYTES;
        const decisions: RomDepDecision[] = [];
        for (let d = firstDecision[i]!; d < firstDecision[i + 1]!; d++) {
          decisions.push(readDecision(bytes, header.decisionSectionOffset + d * ROM_DEP_DECISION_RECORD_BYTES));
        }
        out.push({ md5: bytesToHex(bytes.subarray(at, at + 16)), decisions });
      }
      return out;
    },
  };
}

/** Convenience wrapper around RomDependencyList.lookup. */
export function lookupRomDependency(list: RomDependencyList, md5: string | Uint8Array, subtune: number): RomDepLookup {
  return list.lookup(md5, subtune);
}

/** True when a consumer using `threshold` (1..254) should skip the subtune in the given lane: grade < threshold. */
export function romDepBelowThreshold(lookup: RomDepLookup, lane: RomDepLaneName, threshold: number): boolean {
  return lookup.grades[lane] < threshold;
}

// ---------------------------------------------------------------------------------------------
// Informative measured-scope helpers (spec section 9). The grading measures each subtune over an
// observation horizon derived from Songlengths.md5; the list itself carries no horizon.
// ---------------------------------------------------------------------------------------------

export const ROM_DEP_HORIZON_RULE = {
  minimumMs: 10_000,
  marginMs: 5_000,
  fallbackMs: 300_000,
  source: "Songlengths.md5",
} as const;

/**
 * Observation horizon of one subtune: the Songlengths.md5 token `m:ss` or `m:ss.mmm` plus 5 s, at least 10 s.
 * A missing, malformed or zero token yields the 300 s exploratory fallback. Tokens carrying anything beyond
 * the strict pattern are malformed (they are never partially parsed, which would shift subtunes).
 */
export function derivePlaybackHorizonMs(token: string | undefined): number {
  const match = token?.match(/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/);
  const durationMs = match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] ?? "0").padEnd(3, "0")) : 0;
  const usable = Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : 0;
  return Math.max(ROM_DEP_HORIZON_RULE.minimumMs, usable > 0 ? usable + ROM_DEP_HORIZON_RULE.marginMs : ROM_DEP_HORIZON_RULE.fallbackMs);
}

export interface SonglengthsRecord {
  path: string;
  tokens: string[];
}

/** Parse HVSC Songlengths.md5 into md5 -> {path, tokens}. Rejects duplicate or path-less records. */
export function parseSonglengthsMd5(text: string): Map<string, SonglengthsRecord> {
  const records = new Map<string, SonglengthsRecord>();
  let current = "";
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("; /")) {
      current = line.slice(3);
    } else if (/^[a-f0-9]{32}=/.test(line)) {
      const md5 = line.slice(0, 32);
      const tokens = line.slice(33).trim().split(/\s+/);
      if (!current || records.has(md5) || !tokens[0]) throw new RomDependencyListError(`invalid or duplicate Songlengths record for ${md5}`);
      records.set(md5, { path: current, tokens });
      current = "";
    }
  }
  return records;
}
