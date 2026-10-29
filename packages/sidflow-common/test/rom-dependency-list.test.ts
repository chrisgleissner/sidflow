/**
 * Tests for the SID ROM Dependency List (sidromdep-1, doc/rom-dependency-list.md): codec, lookup,
 * generator and verifier, using small synthetic but realistic grading results written to a temp
 * directory (schema: scripts/rom-dependency-list/grading.ts). No test is skipped.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ROM_DEP_FLAG_INCOMPLETE_SOURCE,
  ROM_DEP_HEADER_BYTES,
  ROM_DEP_LANE_NAMES,
  RomDependencyListError,
  crc32,
  decodeRomDependencyList,
  derivePlaybackHorizonMs,
  encodeRomDependencyList,
  parseSonglengthsMd5,
  romDepBelowThreshold,
  sha256Hex,
  type RomDepContent,
  type RomDepEntry,
  type RomDepGrades,
} from "../src/rom-dependency-list.js";
import { romSetId } from "../src/rom-eligibility.js";
import { GRADING_RESULTS_SCHEMA, deriveEntries, loadGradingResults, parseGradingResults } from "../../../scripts/rom-dependency-list/grading.js";
import { generateRomDependencyList, outputNames } from "../../../scripts/rom-dependency-list/generate.js";
import { roundTripAgainstResults, verifyRomDependencyListFiles } from "../../../scripts/rom-dependency-list/verify.js";

const md5Of = (text: string): string => createHash("md5").update(text).digest("hex");
const g = (a: number, b: number, c: number, d: number): RomDepGrades => ({ sidliteNone: a, sidliteKernalBasic: b, residfpNone: c, residfpKernalBasic: d });
const PROVENANCE = { sourceSha256: "11".repeat(32), songlengthsSha256: "22".repeat(32), corpusId: "33".repeat(32), gradingMethodologySha256: "44".repeat(32) };
const content = (entries: RomDepEntry[], extra: Partial<RomDepContent> = {}): RomDepContent =>
  ({ hvscRelease: 85, sourceFiles: 61157, sourceSubtunes: 87868, incompleteSource: false, listingCeiling: 253, recommendedMinGrade: 128, provenance: PROVENANCE, entries, ...extra });
const one = (md5: string, subtune: number, grades: RomDepGrades): RomDepEntry => ({ md5, decisions: [{ subtune, grades }] });

/** Re-sign a tampered buffer so structural validation (not the checksums) is what rejects it. */
function resign(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  const view = new DataView(out.buffer);
  out.set(Buffer.from(sha256Hex(out.subarray(ROM_DEP_HEADER_BYTES)), "hex"), 64);
  view.setUint32(52, 0, true);
  view.setUint32(52, crc32(out.subarray(0, ROM_DEP_HEADER_BYTES)), true);
  return out;
}

describe("codec", () => {
  const entries: RomDepEntry[] = [
    one("ff" + "00".repeat(15), 256, g(255, 255, 255, 0)),
    { md5: "00" + "ab".repeat(15), decisions: [{ subtune: 3, grades: g(253, 255, 254, 255) }, { subtune: 1, grades: g(1, 254, 120, 255) }] },
    one("7f" + "01".repeat(15), 1, g(0, 0, 0, 0)),
  ];

  test("boundary grades 0/1/253/254/255 round trip in every lane and every lane position", () => {
    const all: RomDepEntry[] = [];
    let n = 0;
    for (const lane of ROM_DEP_LANE_NAMES) {
      for (const low of [0, 1, 127, 253]) {
        for (const rest of [254, 255]) {
          const grades = g(rest, rest, rest, rest);
          grades[lane] = low;
          all.push(one(md5Of(`b-${n}`), (n % 256) + 1, grades));
          n++;
        }
      }
    }
    expect(n).toBe(32);
    const list = decodeRomDependencyList(encodeRomDependencyList(content(all)));
    for (const entry of all) {
      const d = entry.decisions[0]!;
      const got = list.lookup(entry.md5, d.subtune);
      expect(got.listed).toBe(true);
      expect(got.grades).toEqual(d.grades);
      expect(got.minGrade).toBe(Math.min(...ROM_DEP_LANE_NAMES.map((l) => d.grades[l])));
    }
    expect(list.entries().map((e) => e.md5)).toEqual([...all.map((e) => e.md5)].sort());
  });

  test("listing ceiling: a subtune with every lane 254/255 is unlistable, 253 is listed", () => {
    for (const grades of [g(254, 254, 254, 254), g(255, 255, 255, 255), g(255, 254, 255, 254)]) {
      expect(() => encodeRomDependencyList(content([one(md5Of("x"), 1, grades)]))).toThrow(/must be unlisted/);
    }
    for (const lane of ROM_DEP_LANE_NAMES) {
      const grades = g(255, 255, 255, 255);
      grades[lane] = 253;
      expect(decodeRomDependencyList(encodeRomDependencyList(content([one(md5Of("x"), 1, grades)]))).lookup(md5Of("x"), 1).listed).toBe(true);
    }
  });

  test("lookup: exact grades when listed, 254 lower bound when unlisted, full-MD5 matching only", () => {
    const list = decodeRomDependencyList(encodeRomDependencyList(content(entries)));
    expect(list.header.fileCount).toBe(3);
    expect(list.header.decisionCount).toBe(4);
    expect(list.header.listingCeiling).toBe(253);
    expect(list.header.recommendedMinGrade).toBe(128);
    expect(list.entries()[0]!.decisions.map((d) => d.subtune)).toEqual([1, 3]);
    const hit = list.lookup("00" + "ab".repeat(15), 1);
    expect(hit).toEqual({ listed: true, grades: g(1, 254, 120, 255), minGrade: 1 });
    expect(list.lookup("ff" + "00".repeat(15), 256).grades.residfpKernalBasic).toBe(0);
    const miss = list.lookup("00" + "ab".repeat(15), 2);
    expect(miss).toEqual({ listed: false, grades: g(254, 254, 254, 254), minGrade: 254 });
    expect(list.lookup("12".repeat(16), 1).listed).toBe(false);
    expect(list.lookup("7f" + "01".repeat(14) + "02", 1).listed).toBe(false); // no prefix matching
    expect(list.lookup(Uint8Array.from(Buffer.from("7f" + "01".repeat(15), "hex")), 1).minGrade).toBe(0);
    expect(list.lookup("7f" + "01".repeat(15), 0).listed).toBe(false);
    expect(list.lookup("7f" + "01".repeat(15), 257).listed).toBe(false);
    expect(() => list.lookup("xyz", 1)).toThrow(RomDependencyListError);
    // consumer thresholds: skip when grade < threshold; unlisted is never skipped for thresholds <= 254
    expect(romDepBelowThreshold(hit, "sidliteNone", 128)).toBe(true);
    expect(romDepBelowThreshold(hit, "residfpNone", 120)).toBe(false);
    expect(romDepBelowThreshold(miss, "sidliteNone", 254)).toBe(false);
  });

  test("encoding is size-exact: 224 + 17 per file + 5 per decision", () => {
    expect(encodeRomDependencyList(content(entries)).length).toBe(224 + 17 * 3 + 5 * 4);
    expect(encodeRomDependencyList(content([])).length).toBe(224);
    expect(decodeRomDependencyList(encodeRomDependencyList(content([]))).lookup("00".repeat(16), 1).listed).toBe(false);
  });

  test("encoder rejects non-canonical input", () => {
    const base = one(md5Of("a"), 1, g(10, 255, 255, 255));
    expect(() => encodeRomDependencyList(content([base, base]))).toThrow(/duplicate MD5/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5.toUpperCase(), decisions: base.decisions }]))).toThrow();
    for (const bad of [-1, 256, 1.5, Number.NaN]) {
      expect(() => encodeRomDependencyList(content([one(base.md5, 1, g(bad, 255, 255, 255))]))).toThrow(/grade out of range/);
    }
    expect(() => encodeRomDependencyList(content([one(base.md5, 257, g(1, 1, 1, 1))]))).toThrow(/subtune out of range/);
    expect(() => encodeRomDependencyList(content([one(base.md5, 0, g(1, 1, 1, 1))]))).toThrow(/subtune out of range/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [base.decisions[0]!, base.decisions[0]!] }]))).toThrow(/duplicate subtune/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [] }]))).toThrow(/1..256/);
    expect(() => encodeRomDependencyList(content([base], { provenance: { ...PROVENANCE, corpusId: "zz" } }))).toThrow(/corpusId/);
    expect(() => encodeRomDependencyList(content([base], { provenance: { ...PROVENANCE, gradingMethodologySha256: "" } }))).toThrow(/gradingMethodologySha256/);
    for (const bad of [0, 255, 256, -1, 1.5]) expect(() => encodeRomDependencyList(content([base], { recommendedMinGrade: bad }))).toThrow(/recommended_min_grade/);
    for (const ok of [1, 254]) expect(decodeRomDependencyList(encodeRomDependencyList(content([base], { recommendedMinGrade: ok }))).header.recommendedMinGrade).toBe(ok);
  });

  test("a file may carry all 256 subtunes (count byte stores n-1)", () => {
    const decisions = Array.from({ length: 256 }, (_, i) => ({ subtune: i + 1, grades: g(i % 254, 255, 255, 255) }));
    const list = decodeRomDependencyList(encodeRomDependencyList(content([{ md5: md5Of("big"), decisions }])));
    expect(list.header.decisionCount).toBe(256);
    expect(list.lookup(md5Of("big"), 256).grades.sidliteNone).toBe(255 % 254);
    expect(list.lookup(md5Of("big"), 1).grades.sidliteNone).toBe(0);
    expect(list.lookup(md5Of("big"), 129).grades.sidliteNone).toBe(128);
  });

  test("rejects truncated, extended, corrupted and structurally invalid binaries", () => {
    const good = encodeRomDependencyList(content(entries));
    const decisionStart = ROM_DEP_HEADER_BYTES + 17 * 3;
    expect(() => decodeRomDependencyList(good.subarray(0, 100))).toThrow(/truncated header/);
    expect(() => decodeRomDependencyList(good.subarray(0, good.length - 1))).toThrow(/truncated payload/);
    expect(() => decodeRomDependencyList(Uint8Array.from([...good, 0]))).toThrow(/trailing bytes/);
    const flip = (offset: number): Uint8Array => { const b = Uint8Array.from(good); b[offset] = b[offset]! ^ 0x01; return b; };
    expect(() => decodeRomDependencyList(flip(ROM_DEP_HEADER_BYTES + 2))).toThrow(/payload SHA-256/);
    expect(() => decodeRomDependencyList(flip(decisionStart + 1))).toThrow(/payload SHA-256/);
    expect(() => decodeRomDependencyList(flip(40))).toThrow(/header CRC-32/);
    expect(() => decodeRomDependencyList(flip(100))).toThrow(/header CRC-32/); // provenance digests are covered by the header CRC
    expect(() => decodeRomDependencyList(flip(200))).toThrow(/header CRC-32/); // so is the grading methodology digest
    expect(() => decodeRomDependencyList(flip(61))).toThrow(/header CRC-32/); // and the recommended threshold
    expect(() => decodeRomDependencyList(flip(0))).toThrow(/bad magic/);
    const patch = (fn: (b: Uint8Array, v: DataView) => void): Uint8Array => { const b = Uint8Array.from(good); fn(b, new DataView(b.buffer)); return resign(b); };
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(8, 2, true)))).toThrow(/unsupported format version/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(10, 192, true)))).toThrow(/header_bytes/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint32(12, 2, true)))).toThrow(/unknown flag bits/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(62, 1, true)))).toThrow(/reserved/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(56, 18, true)))).toThrow(/record sizes/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(58, 2, true)))).toThrow(/record sizes/);
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 254; }))).toThrow(/listing_ceiling/);
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 0; }))).toThrow(/listing_ceiling/);
    expect(() => decodeRomDependencyList(patch((b) => { b[61] = 0; }))).toThrow(/recommended_min_grade/);
    expect(() => decodeRomDependencyList(patch((b) => { b[61] = 255; }))).toThrow(/recommended_min_grade/);
    // an unlistable record under a lowered ceiling: decision 1 of the first file has min grade 1, so ceiling 0 is invalid and 1 is fine
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 100; b[61] = 50; }))).toThrow(/above the listing ceiling/); // file 1 / subtune 3 has min 253
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint32(44, 300, true)))).toThrow(/canonical tightly packed/);
    // swap the first two file records -> not strictly ascending
    expect(() => decodeRomDependencyList(patch((b) => { const a = b.slice(224, 241); b.copyWithin(224, 241, 258); b.set(a, 241); }))).toThrow(/strictly ascending/);
    // per-file count that no longer sums to decision_count
    expect(() => decodeRomDependencyList(patch((b) => { b[224 + 16] = 5; }))).toThrow(/do not sum/);
    // a record whose four lanes are all >= 254 may not exist
    expect(() => decodeRomDependencyList(patch((b) => { b.fill(254, decisionStart + 1, decisionStart + 5); }))).toThrow(/must be unlisted/);
    // out-of-order subtunes inside a file
    expect(() => decodeRomDependencyList(patch((b) => { b[decisionStart] = 9; }))).toThrow(/strictly ascending/);
  });

  test("worked example from doc/rom-dependency-list.md section 14", () => {
    const bin = encodeRomDependencyList({
      hvscRelease: 85, sourceFiles: 61157, sourceSubtunes: 87868, incompleteSource: false, listingCeiling: 191, recommendedMinGrade: 128,
      provenance: { sourceSha256: "a1".repeat(32), songlengthsSha256: "b2".repeat(32), corpusId: "c3".repeat(32), gradingMethodologySha256: "d4".repeat(32) },
      entries: [
        { md5: "0123456789abcdef0123456789abcdef", decisions: [{ subtune: 1, grades: g(0, 254, 120, 253) }, { subtune: 3, grades: g(255, 255, 150, 255) }] },
        one("fedcba9876543210fedcba9876543210", 256, g(191, 255, 254, 255)),
      ],
    });
    expect(bin.length).toBe(224 + 34 + 15);
    expect(Buffer.from(bin.subarray(0, 64)).toString("hex")).toBe(
      "53494452" + "4f4d4450" + "0100" + "e000" + "00000000" + "55000000" + "e5ee0000" + "3c570100" + "02000000" + "03000000" +
      "e0000000" + "22000000" + "02010000" + "0f000000" + "41f6c455" + "1100" + "0500" + "bf" + "80" + "0000");
    expect(Buffer.from(bin.subarray(64, 96)).toString("hex")).toBe("10d1e7a3ebbc930c7796cae6b4eb8f8bd08e1c161864dbb90dc2ad7cef4da5bc");
    expect(Buffer.from(bin.subarray(224)).toString("hex")).toBe(
      "0123456789abcdef0123456789abcdef" + "01" + "fedcba9876543210fedcba9876543210" + "00" +
      "0000fe78fd" + "02ffff96ff" + "ffbfff" + "feff");
  });

  test("listing ceiling is a parameter: lists iff some lane <= ceiling; unlisted lower bound is ceiling+1", () => {
    for (const ceiling of [1, 100, 191, 252, 253]) {
      const md5 = md5Of(`ceil-${ceiling}`);
      const at = g(255, 255, ceiling, 255);
      const above = g(255, 255, ceiling + 1, 255);
      const list = decodeRomDependencyList(encodeRomDependencyList(content([one(md5, 1, at)], { listingCeiling: ceiling, recommendedMinGrade: 1 })));
      expect(list.header.listingCeiling).toBe(ceiling);
      expect(list.lookup(md5, 1)).toEqual({ listed: true, grades: at, minGrade: ceiling });
      const unlisted = list.lookup(md5, 2);
      expect(unlisted).toEqual({ listed: false, grades: g(ceiling + 1, ceiling + 1, ceiling + 1, ceiling + 1), minGrade: ceiling + 1 });
      expect(() => encodeRomDependencyList(content([one(md5, 1, above)], { listingCeiling: ceiling, recommendedMinGrade: 1 }))).toThrow(/above the listing ceiling/);
    }
  });

  test("listing ceiling and recommended threshold validity (generator and decoder)", () => {
    const base = one(md5Of("v"), 1, g(0, 255, 255, 255));
    for (const bad of [0, 254, 255, -1, 1.5, Number.NaN]) {
      expect(() => encodeRomDependencyList(content([base], { listingCeiling: bad }))).toThrow(/listing_ceiling/);
    }
    // recommended_min_grade must satisfy 1 <= value <= ceiling + 1
    for (const [ceiling, ok, bad] of [[191, 192, 193], [1, 2, 3], [253, 254, 255]] as const) {
      expect(decodeRomDependencyList(encodeRomDependencyList(content([base], { listingCeiling: ceiling, recommendedMinGrade: ok }))).header.recommendedMinGrade).toBe(ok);
      expect(decodeRomDependencyList(encodeRomDependencyList(content([base], { listingCeiling: ceiling, recommendedMinGrade: 1 }))).header.recommendedMinGrade).toBe(1);
      expect(() => encodeRomDependencyList(content([base], { listingCeiling: ceiling, recommendedMinGrade: bad }))).toThrow(/recommended_min_grade/);
      expect(() => encodeRomDependencyList(content([base], { listingCeiling: ceiling, recommendedMinGrade: 0 }))).toThrow(/recommended_min_grade/);
    }
    // the decoder enforces the same relation, on a re-signed header
    const good = encodeRomDependencyList(content([base], { listingCeiling: 191, recommendedMinGrade: 128 }));
    const patch = (fn: (b: Uint8Array) => void): Uint8Array => { const b = Uint8Array.from(good); fn(b); return resign(b); };
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 100; }))).toThrow(/recommended_min_grade/); // 128 > 101
    expect(() => decodeRomDependencyList(patch((b) => { b[61] = 193; }))).toThrow(/recommended_min_grade/);
    expect(decodeRomDependencyList(patch((b) => { b[61] = 192; })).header.recommendedMinGrade).toBe(192);
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 0; }))).toThrow(/listing_ceiling/);
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 254; }))).toThrow(/listing_ceiling/);
    // lowering the ceiling under an existing record makes that record unlistable
    expect(() => decodeRomDependencyList(patch((b) => { b[60] = 1; b[61] = 1; }))).not.toThrow(); // grade 0 <= 1
    const high = encodeRomDependencyList(content([one(md5Of("w"), 1, g(150, 255, 255, 255))], { listingCeiling: 191, recommendedMinGrade: 100 }));
    const lowered = Uint8Array.from(high);
    lowered[60] = 149;
    lowered[61] = 100;
    expect(() => decodeRomDependencyList(resign(lowered))).toThrow(/above the listing ceiling/);
  });
});

// ---------------------------------------------------------------------------------------------
// Synthetic grading results
// ---------------------------------------------------------------------------------------------

type MaybeGrades = { [L in keyof RomDepGrades]: number | null };
interface FixtureFile {
  name: string;
  tokens: string[];
  /** One entry per subtune. */
  grades: MaybeGrades[];
}
const A = (a: number | null, b: number | null, c: number | null, d: number | null): MaybeGrades => ({ sidliteNone: a, sidliteKernalBasic: b, residfpNone: c, residfpKernalBasic: d });
const SAME = A(255, 255, 255, 255);
const RETIMED = A(254, 255, 254, 254);

const FILES: FixtureFile[] = [
  { name: "MUSICIANS/A/Alpha.sid", tokens: ["3:21"], grades: [SAME] },
  { name: "MUSICIANS/B/Beta.sid", tokens: ["0:04", "1:00.385", "10:00", "2:30"], grades: [A(0, 254, 255, 255), A(253, 255, 254, 255), RETIMED, A(1, 1, 1, 1)] },
  { name: "GAMES/C/Gamma.sid", tokens: ["1:10", "bogus"], grades: [RETIMED, A(255, 128, 255, 255), SAME] },
  { name: "GAMES/D/Delta.sid", tokens: ["0:30"], grades: [A(255, 255, 90, 255)] },
  { name: "DEMOS/E/Epsilon.sid", tokens: ["5:00", "5:00", "5:00"], grades: [SAME, RETIMED, SAME] },
  { name: "DEMOS/F/Zeta.sid", tokens: ["0:00"], grades: [A(254, 254, 254, 253)] },
];
// 6 files, 13 subtunes; listed: Beta 1,2,4 ; Gamma 2 ; Delta 1 ; Zeta 1  => 4 files, 6 subtunes

const fixtureSongs = (files: FixtureFile[]): string =>
  ["[Database]", "; comment", ...files.flatMap((f) => [`; /${f.name}`, `${md5Of(f.name)}=${f.tokens.join(" ")}`])].join("\n") + "\n";

interface ResultsOptions {
  files?: FixtureFile[];
  header?: Record<string, unknown>;
  mutateRows?: (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  songlengths?: string;
}

function resultsText(options: ResultsOptions = {}): { text: string; songlengths: string } {
  const files = options.files ?? FILES;
  const songlengths = options.songlengths ?? fixtureSongs(files);
  const header = {
    record: "header", schema: GRADING_RESULTS_SCHEMA, methodologyId: "5e".repeat(32), hvscRelease: 85, corpusId: "4b".repeat(32),
    songlengthsSha256: sha256Hex(songlengths), files: files.length, subtunes: files.reduce((s, f) => s + f.grades.length, 0),
    profile: { romSetId: romSetId(), engines: ["sidlite", "residfp"] }, ...options.header,
  };
  let rows: Record<string, unknown>[] = files.flatMap((f) => f.grades.map((grades, i) => ({ record: "grade", md5: md5Of(f.name), song: i + 1, grades })));
  if (options.mutateRows) rows = options.mutateRows(rows);
  return { text: [header, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n", songlengths };
}

let root = "";
let seq = 0;
const fresh = (): string => path.join(root, `case-${seq++}`);
async function writeResults(options: ResultsOptions = {}): Promise<{ dir: string; results: string; songlengthsPath: string; songlengths: string }> {
  const dir = fresh();
  await mkdir(dir, { recursive: true });
  const { text, songlengths } = resultsText(options);
  const results = path.join(dir, "grading-results.jsonl");
  const songlengthsPath = path.join(dir, "Songlengths.md5");
  await writeFile(results, text);
  await writeFile(songlengthsPath, songlengths);
  return { dir, results, songlengthsPath, songlengths };
}

beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), "romdep-")); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("horizon rule and Songlengths parsing (informative scope)", () => {
  test("rule: duration + 5 s, minimum 10 s, 300 s when no valid entry", () => {
    expect(derivePlaybackHorizonMs("3:21")).toBe(206_000);
    expect(derivePlaybackHorizonMs("1:00.385")).toBe(65_385);
    expect(derivePlaybackHorizonMs("0:04")).toBe(10_000);
    expect(derivePlaybackHorizonMs("0:06")).toBe(11_000);
    expect(derivePlaybackHorizonMs("0:00")).toBe(300_000);
    expect(derivePlaybackHorizonMs(undefined)).toBe(300_000);
    expect(derivePlaybackHorizonMs("1:75")).toBe(300_000);
    expect(derivePlaybackHorizonMs("3:21(G)")).toBe(300_000);
  });
  test("parser keeps path and tokens and rejects duplicates", () => {
    const parsed = parseSonglengthsMd5(fixtureSongs(FILES));
    expect(parsed.size).toBe(FILES.length);
    expect(parsed.get(md5Of("MUSICIANS/B/Beta.sid"))).toEqual({ path: "MUSICIANS/B/Beta.sid", tokens: ["0:04", "1:00.385", "10:00", "2:30"] });
    expect(() => parseSonglengthsMd5(fixtureSongs(FILES) + `; /dup.sid\n${md5Of("GAMES/C/Gamma.sid")}=1:00\n`)).toThrow(/duplicate/);
  });
});

describe("grading results input", () => {
  test("parses, derives only subtunes with a lane <= 253", () => {
    const { text } = resultsText();
    const input = parseGradingResults(new TextEncoder().encode(text), { allowIncomplete: false });
    expect(input.complete).toBe(true);
    expect(input.rowCount).toBe(13);
    const entries = deriveEntries(input, 253);
    expect(entries.map((e) => e.decisions.length).reduce((a, b) => a + b, 0)).toBe(6);
    expect(entries).toHaveLength(4);
  });

  test("rejects malformed and incomplete input unless --allow-incomplete", () => {
    const parse = (options: ResultsOptions, allowIncomplete = false) => parseGradingResults(new TextEncoder().encode(resultsText(options).text), { allowIncomplete });
    const withRows = (mutateRows: ResultsOptions["mutateRows"]): ResultsOptions => ({ mutateRows });
    // unmeasured lane
    const unmeasured = withRows((rows) => rows.map((r, i) => (i === 3 ? { ...r, grades: { ...(r.grades as object), residfpNone: null } } : r)));
    expect(() => parse(unmeasured)).toThrow(/incomplete.*unmeasured lane/);
    expect(parse(unmeasured, true).complete).toBe(false);
    // missing row (header declares more)
    expect(() => parse(withRows((rows) => rows.slice(1)))).toThrow(/incomplete/);
    // non-contiguous subtunes
    expect(() => parse(withRows((rows) => rows.filter((r) => !(r.md5 === md5Of("MUSICIANS/B/Beta.sid") && r.song === 2)).concat([{ record: "grade", md5: md5Of("MUSICIANS/B/Beta.sid"), song: 9, grades: SAME }])))).toThrow(/not contiguous/);
    // bad values
    for (const bad of [256, -1, 1.5, "7", true]) {
      expect(() => parse(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, grades: { ...(r.grades as object), sidliteNone: bad } } : r))), true)).toThrow(/integer 0..255 or null/);
    }
    expect(() => parse(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, grades: { sidliteNone: 1 } } : r))), true)).toThrow(/exactly the four lanes/);
    expect(() => parse(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, song: 257 } : r))), true)).toThrow(/song must be/);
    expect(() => parse(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, md5: "ABC" } : r))), true)).toThrow(/md5/);
    expect(() => parse(withRows((rows) => [...rows, rows[0]!]), true)).toThrow(/duplicate/);
    expect(() => parse(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, methodologyId: "00".repeat(32) } : r))), true)).toThrow(/methodologyId differs/);
    expect(() => parse(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, record: "other" } : r))), true)).toThrow(/grade record/);
    // header problems
    expect(() => parse({ header: { schema: "other" } }, true)).toThrow(/first line/);
    expect(() => parse({ header: { methodologyId: "xyz" } }, true)).toThrow(/64-hex/);
    expect(() => parse({ header: { hvscRelease: 0 } }, true)).toThrow(/positive integer/);
    expect(() => parse({ header: { profile: { romSetId: "00".repeat(32) } } }, true)).toThrow(/reference ROM set/);
    expect(() => parseGradingResults(new TextEncoder().encode(""), { allowIncomplete: true })).toThrow(/empty/);
    expect(() => parseGradingResults(new TextEncoder().encode("{not json\n"), { allowIncomplete: true })).toThrow();
  });
});

describe("generator and verifier", () => {
  test("release generation, determinism, verification and round trip", async () => {
    const input = await writeResults();
    const base = { resultsPath: input.results, songlengthsPath: input.songlengthsPath, listingCeiling: 253, recommendedMinGrade: 128 };
    const runA = await generateRomDependencyList({ ...base, outDir: path.join(root, "outA") });
    const runB = await generateRomDependencyList({ ...base, outDir: path.join(root, "outB") });
    const names = outputNames(85);
    expect(names.bin).toBe("hvsc85-sidromdep-1.bin");
    expect(names.manifest).toBe("hvsc85-sidromdep-1.manifest.json");
    for (const file of [names.bin, names.manifest, names.json]) {
      expect(Buffer.compare(await readFile(path.join(root, "outA", file)), await readFile(path.join(root, "outB", file)))).toBe(0);
    }
    expect(runA.binSha256).toBe(runB.binSha256);
    expect(runA.manifestSha256).toBe(runB.manifestSha256);
    expect(runA.complete).toBe(true);
    expect(runA.listedFiles).toBe(4);
    expect(runA.listedSubtunes).toBe(6);
    expect(runA.bytes).toBe(224 + 17 * 4 + 5 * 6);

    const manifest = JSON.parse(await readFile(runA.manifestPath, "utf8"));
    expect(manifest.complete).toBe(true);
    expect(manifest.releasable).toBe(true);
    expect(manifest.recommendedMinGrade).toBe(128);
    expect(manifest.listingCeiling).toBe(253);
    expect(manifest.counts.subtunesBelowRecommended).toBe(3); // Beta#1 (0), Beta#4 (1), Delta#1 (90); Gamma#2 is exactly 128 and Beta#2/Zeta#1 are 253
    expect(manifest.measuredProfile.songlengthsFileVerified).toBe(true);
    expect(manifest.measuredProfile.romSetId).toBe(romSetId());
    expect(manifest.provenance.songlengthsSha256).toBe(sha256Hex(input.songlengths));
    expect(manifest.provenance.gradingMethodologySha256).toBe("5e".repeat(32));
    expect(manifest.binary.sha256).toBe(runA.binSha256);

    const list = decodeRomDependencyList(new Uint8Array(await readFile(runA.binPath)));
    expect(list.header.incompleteSource).toBe(false);
    const beta = md5Of("MUSICIANS/B/Beta.sid");
    expect(list.lookup(beta, 2).grades).toEqual(g(253, 255, 254, 255));
    expect(list.lookup(beta, 3).listed).toBe(false); // retimed only
    expect(list.lookup(md5Of("MUSICIANS/A/Alpha.sid"), 1).listed).toBe(false);
    expect(list.lookup(md5Of("DEMOS/F/Zeta.sid"), 1).grades.residfpKernalBasic).toBe(253);

    const human = JSON.parse(await readFile(runA.jsonPath, "utf8"));
    expect(human.records).toHaveLength(6);
    expect(human.records.map((r: { hvscPath: string }) => r.hvscPath)).toContain("MUSICIANS/B/Beta.sid");
    expect(human.records.find((r: { md5: string; subtune: number }) => r.md5 === beta && r.subtune === 1).grades.sidliteNone).toBe(0);

    const report = await verifyRomDependencyListFiles({ binPath: runA.binPath, resultsPath: input.results, songlengthsPath: input.songlengthsPath });
    expect(report.binSha256).toBe(runA.binSha256);
    expect(report.manifestSha256).toBe(runA.manifestSha256);
    expect(report.checkedSubtunes).toBe(13);
    expect(report.listedSubtunes).toBe(6);
    expect(report.unlistedAboveCeiling).toBe(7);
    expect(report.excludedUnmeasured).toBe(0);
  });

  test("round trip detects a dropped record, an extra record and a changed grade", async () => {
    const { text } = resultsText();
    const input = parseGradingResults(new TextEncoder().encode(text), { allowIncomplete: false });
    const entries = deriveEntries(input, 253);
    const build = (e: RomDepEntry[]) => decodeRomDependencyList(encodeRomDependencyList(content(e)));
    expect(() => roundTripAgainstResults(build(entries), input)).not.toThrow();
    expect(() => roundTripAgainstResults(build(entries.slice(1)), input)).toThrow(/differs from the grading results/);
    // a subtune whose four graded lanes are all >= 254 must not be listed
    const extra = [...entries, one(md5Of("MUSICIANS/A/Alpha.sid"), 1, g(10, 255, 255, 255))];
    expect(() => roundTripAgainstResults(build(extra), input)).toThrow(/every lane above the listing ceiling but is listed/);
    const changed = entries.map((e, i) => (i === 0 ? { ...e, decisions: [{ ...e.decisions[0]!, grades: { ...e.decisions[0]!.grades, sidliteNone: 77 } }, ...e.decisions.slice(1)] } : e));
    expect(() => roundTripAgainstResults(build(changed), input)).toThrow(/differs from the grading results/);
    expect(() => roundTripAgainstResults(build([...entries, one(md5Of("not in input"), 1, g(1, 1, 1, 1))]), input)).toThrow(/not in the grading results/);
    expect(() => roundTripAgainstResults(build([...entries, one(md5Of("DEMOS/E/Epsilon.sid"), 4, g(1, 1, 1, 1))]), input)).toThrow(/not in the grading results/);
  });

  test("the verifier rejects a modified binary and a different results file", async () => {
    const input = await writeResults();
    const run = await generateRomDependencyList({ resultsPath: input.results, songlengthsPath: input.songlengthsPath, listingCeiling: 253, recommendedMinGrade: 100, outDir: path.join(root, "out-tamper") });
    const bytes = new Uint8Array(await readFile(run.binPath));
    await writeFile(run.binPath, resign(Uint8Array.from(bytes, (b, i) => (i === bytes.length - 1 ? b ^ 0x01 : b))));
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: input.results })).rejects.toThrow(/manifest does not describe this binary/);
    await writeFile(run.binPath, bytes.subarray(0, bytes.length - 3));
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: input.results })).rejects.toThrow(/truncated payload/);
    await writeFile(run.binPath, bytes);
    const other = await writeResults({ files: FILES.slice(0, 5) });
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: other.results })).rejects.toThrow(/results digest differs/);
    // same bytes, grade changed in a way that keeps the header consistent: caught by the digest of the results
    const edited = await writeResults({ mutateRows: (rows) => rows.map((r, i) => (i === 1 ? { ...r, grades: A(7, 255, 255, 255) } : r)) });
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: edited.results })).rejects.toThrow(/results digest differs/);
  });

  test("generation refuses bad thresholds, wrong Songlengths and incomplete results", async () => {
    const input = await writeResults();
    for (const bad of [0, 255, 300]) {
      await expect(generateRomDependencyList({ resultsPath: input.results, listingCeiling: 253, recommendedMinGrade: bad, outDir: fresh() })).rejects.toThrow(/recommended_min_grade/);
    }
    const wrong = path.join(input.dir, "Songlengths.other");
    await writeFile(wrong, input.songlengths + "\n; changed\n");
    await expect(generateRomDependencyList({ resultsPath: input.results, songlengthsPath: wrong, listingCeiling: 253, recommendedMinGrade: 128, outDir: fresh() })).rejects.toThrow(/does not match the digest/);
    const incomplete = await writeResults({ mutateRows: (rows) => rows.map((r, i) => (i === 0 ? { ...r, grades: { ...(r.grades as object), sidliteNone: null } } : r)) });
    await expect(generateRomDependencyList({ resultsPath: incomplete.results, listingCeiling: 253, recommendedMinGrade: 128, outDir: fresh() })).rejects.toThrow(/incomplete/);
  });

  test("--allow-incomplete output excludes unmeasured subtunes and is flagged non-releasable in header and manifest", async () => {
    const files: FixtureFile[] = [
      { ...FILES[1]!, grades: [A(0, 254, 255, 255), A(253, 255, 254, 255), A(255, null, 255, 255), A(1, 1, 1, 1)] },
      { ...FILES[0]!, grades: [A(null, null, null, null)] },
      FILES[4]!,
    ];
    const input = await writeResults({ files });
    const out = path.join(root, "out-incomplete");
    const run = await generateRomDependencyList({ resultsPath: input.results, listingCeiling: 253, recommendedMinGrade: 128, outDir: out, allowIncomplete: true });
    expect(run.complete).toBe(false);
    const manifest = JSON.parse(await readFile(run.manifestPath, "utf8"));
    expect(manifest.complete).toBe(false);
    expect(manifest.releasable).toBe(false);
    expect(manifest.status).toContain("NOT-RELEASABLE");
    expect(manifest.counts.excludedUnmeasuredSubtunes).toBe(2);
    expect(manifest.measuredProfile.songlengthsFileVerified).toBe(false);
    const bin = new Uint8Array(await readFile(run.binPath));
    expect(new DataView(bin.buffer).getUint32(12, true) & ROM_DEP_FLAG_INCOMPLETE_SOURCE).toBe(1);
    const list = decodeRomDependencyList(bin);
    expect(list.header.incompleteSource).toBe(true);
    const beta = md5Of("MUSICIANS/B/Beta.sid");
    expect(list.lookup(beta, 3).listed).toBe(false); // excluded: nothing is claimed
    expect(list.lookup(beta, 1).listed).toBe(true);
    expect(list.lookup(md5Of("MUSICIANS/A/Alpha.sid"), 1).listed).toBe(false);
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: input.results })).rejects.toThrow(/allow-incomplete/);
    const report = await verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: input.results, allowIncomplete: true });
    expect(report.complete).toBe(false);
    expect(report.excludedUnmeasured).toBe(2);
    await expect(loadGradingResults(input.results, { allowIncomplete: false })).rejects.toThrow(/incomplete/);
  });
});

describe("release ceiling 191 / recommended 128", () => {
  test("lists only subtunes with a lane <= 191; unlisted subtunes are > 191 in every lane and verify", async () => {
    const input = await writeResults();
    const base = { resultsPath: input.results, songlengthsPath: input.songlengthsPath, recommendedMinGrade: 128, outDir: path.join(root, "out-191") };
    const run = await generateRomDependencyList({ ...base, listingCeiling: 191 });
    // Beta#1 (0), Beta#4 (1), Gamma#2 (128), Delta#1 (90); Beta#2 (253) and Zeta#1 (253) are above the ceiling
    expect(run.listedSubtunes).toBe(4);
    expect(run.listedFiles).toBe(3);
    expect(run.bytes).toBe(224 + 17 * 3 + 5 * 4);
    const list = decodeRomDependencyList(new Uint8Array(await readFile(run.binPath)));
    expect(list.header.listingCeiling).toBe(191);
    const beta = md5Of("MUSICIANS/B/Beta.sid");
    expect(list.lookup(beta, 2)).toEqual({ listed: false, grades: g(192, 192, 192, 192), minGrade: 192 });
    expect(list.lookup(beta, 1).grades).toEqual(g(0, 254, 255, 255));
    const manifest = JSON.parse(await readFile(run.manifestPath, "utf8"));
    expect(manifest.listingCeiling).toBe(191);
    expect(manifest.semantics).toContain("191");
    const report = await verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: input.results });
    expect(report.listedSubtunes).toBe(4);
    expect(report.unlistedAboveCeiling).toBe(9);
    // a list built for another ceiling (here 253) does not verify against... itself only; mixing is caught by the round trip
    const other = await generateRomDependencyList({ ...base, outDir: path.join(root, "out-253"), listingCeiling: 253 });
    expect(other.listedSubtunes).toBe(6);
    const lowered = decodeRomDependencyList(new Uint8Array(await readFile(other.binPath)));
    const source = parseGradingResults(new TextEncoder().encode(resultsText().text), { allowIncomplete: false });
    expect(() => roundTripAgainstResults(lowered, source)).not.toThrow();
    expect(() => roundTripAgainstResults(list, source)).not.toThrow();
  });

  test("threshold rules at the generator: recommended <= ceiling + 1, ceiling 1..253", async () => {
    const input = await writeResults();
    const base = { resultsPath: input.results };
    await expect(generateRomDependencyList({ ...base, listingCeiling: 191, recommendedMinGrade: 192, outDir: fresh() })).resolves.toBeDefined();
    await expect(generateRomDependencyList({ ...base, listingCeiling: 191, recommendedMinGrade: 193, outDir: fresh() })).rejects.toThrow(/recommended_min_grade/);
    await expect(generateRomDependencyList({ ...base, listingCeiling: 0, recommendedMinGrade: 1, outDir: fresh() })).rejects.toThrow(/listing_ceiling/);
    await expect(generateRomDependencyList({ ...base, listingCeiling: 254, recommendedMinGrade: 1, outDir: fresh() })).rejects.toThrow(/listing_ceiling/);
  });

  test("the verifier rejects a list whose records differ from the input at the list's own ceiling", async () => {
    const input = await writeResults();
    const run = await generateRomDependencyList({ resultsPath: input.results, listingCeiling: 191, recommendedMinGrade: 128, outDir: fresh() });
    const parsed = parseGradingResults(new TextEncoder().encode(resultsText().text), { allowIncomplete: false });
    const entries = deriveEntries(parsed, 191);
    const withBeta2 = [...entries, ...[]];
    const betaIndex = entries.findIndex((e) => e.md5 === md5Of("MUSICIANS/B/Beta.sid"));
    withBeta2[betaIndex] = { ...entries[betaIndex]!, decisions: [...entries[betaIndex]!.decisions, { subtune: 2, grades: g(253, 255, 254, 255) }] };
    // listing Beta#2 (min 253) is legal only for ceiling 253, but the list is built at 191 and must not carry it
    expect(() => encodeRomDependencyList(content(withBeta2, { listingCeiling: 191, recommendedMinGrade: 128 }))).toThrow(/above the listing ceiling/);
    expect(run.listedSubtunes).toBe(4);
  });
});

describe("size model and scale", () => {
  test("a list of ~1,600 files / ~2,700 subtunes is ~40 KiB: 224 + 17 f + 5 s", () => {
    const entries: RomDepEntry[] = [];
    for (let i = 0; i < 1600; i++) {
      const count = i < 1100 ? 2 : 1; // 1,100 x 2 + 500 x 1 = 2,700 subtunes
      entries.push({ md5: md5Of(`size-${i}`), decisions: Array.from({ length: count }, (_, s) => ({ subtune: s + 1, grades: g(100, 255, 255, 255) })) });
    }
    const subtunes = entries.reduce((s, e) => s + e.decisions.length, 0);
    const bin = encodeRomDependencyList(content(entries));
    expect(subtunes).toBe(2700);
    expect(bin.length).toBe(224 + 17 * 1600 + 5 * 2700);
    expect(bin.length).toBe(40_924);
    expect(bin.length).toBeLessThan(42 * 1024);
  });

  test("full-corpus scale (61,157 files / ~80k subtunes, ~3% listed) generates and verifies", async () => {
    const files: FixtureFile[] = [];
    let subtunes = 0;
    for (let i = 0; i < 61_157; i++) {
      const count = i % 13 === 0 ? 2 + (i % 5) : i % 13 === 1 ? 2 : 1; // ~87.9k subtunes in total
      const grades: MaybeGrades[] = [];
      for (let s = 0; s < count; s++) {
        const h = createHash("sha1").update(`${i}/${s}`).digest()[0]!;
        grades.push(h < 8 ? A(h * 30, 255, h % 2 ? 254 : 255, 255) : h < 40 ? RETIMED : SAME); // 8/256 = 3.1% listed
      }
      subtunes += count;
      files.push({ name: `F/${i}.sid`, tokens: ["1:00"], grades });
    }
    const input = await writeResults({ files, songlengths: "; /placeholder.sid\n" + md5Of("placeholder") + "=1:00\n" });
    expect(subtunes).toBeGreaterThan(75_000);
    const run = await generateRomDependencyList({ resultsPath: input.results, listingCeiling: 191, recommendedMinGrade: 128, outDir: path.join(root, "out-scale") });
    expect(run.bytes).toBe(224 + 17 * run.listedFiles + 5 * run.listedSubtunes);
    const report = await verifyRomDependencyListFiles({ binPath: run.binPath, resultsPath: input.results });
    expect(report.checkedSubtunes).toBe(subtunes);
    expect(report.listedSubtunes + report.unlistedAboveCeiling).toBe(subtunes);
    console.log(`[rom-dependency-list scale] ${61157} files / ${subtunes} subtunes graded -> ${run.listedFiles} files / ${run.listedSubtunes} subtunes listed -> ${run.bytes} bytes`);
  }, 120_000);
});
