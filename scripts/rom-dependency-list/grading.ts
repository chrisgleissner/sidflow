/**
 * Reads ROM fidelity grading results (doc/rom-dependency-list.md section 3.2; methodology in
 * doc/research/hvsc-rom-fidelity-grading.md) and derives the SID ROM Dependency List content.
 * Shared by generate.ts and verify.ts so both interpret the input identically.
 *
 * Input: JSONL, UTF-8. Line 1 is the header record, every further line one grade record:
 *
 *   {"record":"header","schema":"sidflow-rom-grading-results-1","methodologyId":"<64 hex>","hvscRelease":85,
 *    "corpusId":"<64 hex>","songlengthsSha256":"<64 hex>","files":61157,"subtunes":87868,"profile":{...optional...}}
 *   {"record":"grade","md5":"<32 hex>","song":1,"methodologyId":"<64 hex, optional>",
 *    "grades":{"sidliteNone":254,"sidliteKernalBasic":255,"residfpNone":254,"residfpKernalBasic":255}}
 *
 * A grade is an integer 0..255, or null for a lane that is not measured (accepted only with --allow-incomplete).
 */
import { readFile } from "node:fs/promises";
import {
  ROM_DEP_LANE_NAMES,
  ROM_DEP_MAX_SUBTUNE,
  mustList,
  sha256Hex,
  type RomDepEntry,
  type RomDepGrades,
  type RomDepProvenance,
} from "../../packages/sidflow-common/src/rom-dependency-list.js";
import { REFERENCE_ROM_SHA256, romSetId } from "../../packages/sidflow-common/src/rom-eligibility.js";

export const GRADING_RESULTS_SCHEMA = "sidflow-rom-grading-results-1";

export interface GradingHeader {
  methodologyId: string;
  hvscRelease: number;
  corpusId: string;
  songlengthsSha256: string;
  files: number;
  subtunes: number;
  profile: Record<string, unknown> | null;
}

/** null = lane not measured. */
export type MaybeGrades = { [L in keyof RomDepGrades]: number | null };

export interface GradingInput {
  header: GradingHeader;
  /** SHA-256 of the results file bytes (header digest `source_sha256`). */
  sha256: string;
  /** md5 -> song -> grades. */
  rows: Map<string, Map<number, MaybeGrades>>;
  rowCount: number;
  /** Reasons the input is not a complete grading; empty when complete. */
  problems: string[];
  complete: boolean;
}

export const REFERENCE_ROMS = REFERENCE_ROM_SHA256;

const HEX64 = /^[a-f0-9]{64}$/;
const HEX32 = /^[a-f0-9]{32}$/;

function fail(message: string): never {
  throw new Error(`Invalid ROM grading results: ${message}`);
}

function parseLine(line: string, index: number): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    console.error(`Unparseable JSON on grading results line ${index + 1}`, error);
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`line ${index + 1} is not an object`);
  return value as Record<string, unknown>;
}

export function parseGradingResults(bytes: Uint8Array, options: { allowIncomplete: boolean }): GradingInput {
  const text = Buffer.from(bytes).toString("utf8");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) fail("empty file");
  const h = parseLine(lines[0]!, 0);
  if (h.record !== "header" || h.schema !== GRADING_RESULTS_SCHEMA) fail(`first line must be a header record with schema ${GRADING_RESULTS_SCHEMA}`);
  const isHex = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
  const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
  if (!isHex(h.methodologyId, HEX64) || !isHex(h.corpusId, HEX64) || !isHex(h.songlengthsSha256, HEX64)) fail("header needs 64-hex methodologyId, corpusId and songlengthsSha256");
  if (!isCount(h.hvscRelease) || !isCount(h.files) || !isCount(h.subtunes)) fail("header needs positive integer hvscRelease, files and subtunes");
  const profile = h.profile === undefined ? null : (h.profile as Record<string, unknown>);
  if (profile !== null && (typeof profile !== "object" || Array.isArray(profile))) fail("header profile must be an object");
  if (profile && typeof profile.romSetId === "string" && profile.romSetId !== romSetId()) fail(`profile.romSetId ${profile.romSetId} is not the reference ROM set ${romSetId()}`);
  const header: GradingHeader = { methodologyId: h.methodologyId, hvscRelease: h.hvscRelease, corpusId: h.corpusId, songlengthsSha256: h.songlengthsSha256, files: h.files, subtunes: h.subtunes, profile };

  const rows = new Map<string, Map<number, MaybeGrades>>();
  let rowCount = 0;
  let unmeasuredRows = 0;
  for (let i = 1; i < lines.length; i++) {
    const r = parseLine(lines[i]!, i);
    if (r.record !== "grade") fail(`line ${i + 1}: expected a grade record`);
    if (!isHex(r.md5, HEX32)) fail(`line ${i + 1}: md5 must be 32 lowercase hex characters`);
    if (typeof r.song !== "number" || !Number.isInteger(r.song) || r.song < 1 || r.song > ROM_DEP_MAX_SUBTUNE) fail(`line ${i + 1}: song must be an integer 1..256`);
    if (r.methodologyId !== undefined && r.methodologyId !== header.methodologyId) fail(`line ${i + 1}: methodologyId differs from the header`);
    const g = r.grades as Record<string, unknown> | undefined;
    if (!g || typeof g !== "object" || Object.keys(g).length !== ROM_DEP_LANE_NAMES.length) fail(`line ${i + 1}: grades must name exactly the four lanes`);
    const grades = {} as MaybeGrades;
    let measured = true;
    for (const lane of ROM_DEP_LANE_NAMES) {
      const v = g[lane];
      if (v === null) { grades[lane] = null; measured = false; continue; }
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) fail(`line ${i + 1}: ${lane} must be an integer 0..255 or null`);
      grades[lane] = v;
    }
    let songs = rows.get(r.md5);
    if (!songs) { songs = new Map(); rows.set(r.md5, songs); }
    if (songs.has(r.song)) fail(`line ${i + 1}: duplicate ${r.md5}#${r.song}`);
    songs.set(r.song, grades);
    rowCount++;
    if (!measured) unmeasuredRows++;
  }

  const problems: string[] = [];
  if (unmeasuredRows) problems.push(`${unmeasuredRows} subtunes have an unmeasured lane`);
  if (rows.size !== header.files) problems.push(`${rows.size} files graded, header declares ${header.files}`);
  if (rowCount !== header.subtunes) problems.push(`${rowCount} subtunes graded, header declares ${header.subtunes}`);
  for (const [md5, songs] of rows) {
    for (let s = 1; s <= songs.size; s++) {
      if (!songs.has(s)) { problems.push(`${md5}: subtunes are not contiguous from 1`); break; }
    }
  }
  const complete = problems.length === 0;
  if (!complete && !options.allowIncomplete) {
    fail(`input is incomplete (${problems.slice(0, 3).join("; ")}); use --allow-incomplete for a non-releasable developer output`);
  }
  return { header, sha256: sha256Hex(bytes), rows, rowCount, problems, complete };
}

export async function loadGradingResults(file: string, options: { allowIncomplete: boolean }): Promise<GradingInput> {
  return parseGradingResults(new Uint8Array(await readFile(file)), options);
}

/** Fully measured grades, or undefined when any lane is unmeasured. */
export function measuredGrades(grades: MaybeGrades): RomDepGrades | undefined {
  const out = {} as RomDepGrades;
  for (const lane of ROM_DEP_LANE_NAMES) {
    const v = grades[lane];
    if (v === null) return undefined;
    out[lane] = v;
  }
  return out;
}

/**
 * Expected treatment of one graded subtune. `excluded` = some lane is unmeasured (developer output only): the
 * subtune is neither listed nor claimed to be above the listing ceiling.
 */
export function expectedFor(input: GradingInput, md5: string, subtune: number, listingCeiling: number): { kind: "listed"; grades: RomDepGrades } | { kind: "unlisted" } | { kind: "excluded" } | { kind: "absent" } {
  const g = input.rows.get(md5)?.get(subtune);
  if (!g) return { kind: "absent" };
  const m = measuredGrades(g);
  if (!m) return { kind: "excluded" };
  return mustList(m, listingCeiling) ? { kind: "listed", grades: m } : { kind: "unlisted" };
}

/** Listed subtunes (any measured lane <= listingCeiling), sorted by MD5 then subtune. */
export function deriveEntries(input: GradingInput, listingCeiling: number): RomDepEntry[] {
  const entries: RomDepEntry[] = [];
  for (const [md5, songs] of [...input.rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const decisions = [];
    for (const [subtune, g] of [...songs.entries()].sort(([a], [b]) => a - b)) {
      const m = measuredGrades(g);
      if (m && mustList(m, listingCeiling)) decisions.push({ subtune, grades: m });
    }
    if (decisions.length) entries.push({ md5, decisions });
  }
  return entries;
}

export function provenanceOf(input: GradingInput): RomDepProvenance {
  return { sourceSha256: input.sha256, songlengthsSha256: input.header.songlengthsSha256, corpusId: input.header.corpusId, gradingMethodologySha256: input.header.methodologyId };
}
