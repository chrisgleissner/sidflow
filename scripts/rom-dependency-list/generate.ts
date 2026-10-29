#!/usr/bin/env bun
/**
 * Generate the SID ROM Dependency List (format `sidromdep-1`, doc/rom-dependency-list.md) from ROM fidelity
 * grading results (JSONL; schema in scripts/rom-dependency-list/grading.ts and spec section 3.2).
 *
 *   bun scripts/rom-dependency-list/generate.ts \
 *     --results workspace/rom-grading/grading-results.jsonl \
 *     --recommended-min-grade 128 \
 *     --songlengths workspace/hvsc/C64Music/DOCUMENTS/Songlengths.md5 \
 *     --out workspace/rom-dependency-list
 *
 * Writes hvsc<N>-sidromdep-1.bin, .manifest.json and the optional human-readable .json.
 * Refuses results in which any subtune/lane is unmeasured. `--allow-incomplete` is a developer flag: subtunes
 * with an unmeasured lane are excluded from the list, header flag bit 0 and manifest complete:false mark the
 * output, and it must never be released.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  ROM_DEP_DECISION_RECORD_BYTES,
  ROM_DEP_FILE_RECORD_BYTES,
  ROM_DEP_FORMAT_ID,
  ROM_DEP_HEADER_BYTES,
  ROM_DEP_HORIZON_RULE,
  ROM_DEP_LANE_NAMES,
  ROM_DEP_LISTING_CEILING,
  decodeRomDependencyList,
  encodeRomDependencyList,
  minGradeOf,
  parseSonglengthsMd5,
  sha256Hex,
  type RomDepEntry,
} from "../../packages/sidflow-common/src/rom-dependency-list.js";
import { romSetId } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { formatHelp, handleParseResult, parseArgs, type ArgDef } from "../../packages/sidflow-common/src/cli-parser.js";
import { REFERENCE_ROMS, deriveEntries, loadGradingResults, measuredGrades, provenanceOf, type GradingInput } from "./grading.js";

export interface GenerateOptions {
  resultsPath: string;
  outDir: string;
  /** Consumer default skip threshold, 1..254. Required: it is calibrated, not guessed. */
  recommendedMinGrade: number;
  songlengthsPath?: string;
  allowIncomplete?: boolean;
}

export interface GenerateResult {
  binPath: string;
  manifestPath: string;
  jsonPath: string;
  bytes: number;
  binSha256: string;
  manifestSha256: string;
  listedFiles: number;
  listedSubtunes: number;
  complete: boolean;
}

export function outputNames(hvscRelease: number): { bin: string; manifest: string; json: string } {
  const base = `hvsc${hvscRelease}-${ROM_DEP_FORMAT_ID}`;
  return { bin: `${base}.bin`, manifest: `${base}.manifest.json`, json: `${base}.json` };
}

const asJson = (value: unknown): string => stringifyDeterministic(value as JsonValue);

/** Check the supplied Songlengths.md5 against the digest the grading pinned; return md5 -> HVSC path. */
export function songlengthsPaths(input: GradingInput, text: string): Map<string, string> {
  if (sha256Hex(text) !== input.header.songlengthsSha256) throw new Error("Songlengths.md5 does not match the digest pinned in the grading results");
  return new Map([...parseSonglengthsMd5(text)].map(([md5, record]) => [md5, record.path]));
}

/** Deterministic human-readable view: release asset only, never consumed by the runtime. */
export function humanReadableList(entries: readonly RomDepEntry[], input: GradingInput, paths: ReadonlyMap<string, string> | undefined, recommendedMinGrade: number, complete: boolean): string {
  const records = entries.flatMap((entry) => entry.decisions.map((d) => ({
    md5: entry.md5,
    hvscPath: paths?.get(entry.md5) ?? null,
    subtune: d.subtune,
    minGrade: minGradeOf(d.grades),
    belowRecommended: minGradeOf(d.grades) < recommendedMinGrade,
    grades: d.grades,
  })));
  return asJson({
    format: ROM_DEP_FORMAT_ID,
    hvscRelease: input.header.hvscRelease,
    complete,
    recommendedMinGrade,
    listingCeiling: ROM_DEP_LISTING_CEILING,
    note: "Unlisted subtunes have every lane >= 254 (no restriction). Grades: 255 bit-exact, 254 same music re-timed, 1-253 graded, 0 no playback.",
    lanes: ROM_DEP_LANE_NAMES,
    records,
  });
}

const BANDS: readonly [string, number, number][] = [["0", 0, 0], ["1-63", 1, 63], ["64-127", 64, 127], ["128-191", 128, 191], ["192-253", 192, 253]];

export function buildManifest(args: { input: GradingInput; entries: readonly RomDepEntry[]; bin: Uint8Array; names: ReturnType<typeof outputNames>; jsonSha256: string; recommendedMinGrade: number; songlengthsVerified: boolean }): Record<string, unknown> {
  const { input, entries, bin, names, recommendedMinGrade } = args;
  const list = decodeRomDependencyList(bin);
  const decisions = entries.flatMap((e) => e.decisions);
  const perLane = Object.fromEntries(ROM_DEP_LANE_NAMES.map((lane) => [lane, {
    belowRecommended: decisions.filter((d) => d.grades[lane] < recommendedMinGrade).length,
    bands: Object.fromEntries(BANDS.map(([name, lo, hi]) => [name, decisions.filter((d) => d.grades[lane] >= lo && d.grades[lane] <= hi).length])),
  }]));
  let excluded = 0;
  for (const songs of input.rows.values()) for (const g of songs.values()) if (!measuredGrades(g)) excluded++;
  const complete = !list.header.incompleteSource;
  return {
    format: { id: ROM_DEP_FORMAT_ID, version: list.header.formatVersion, specification: "doc/rom-dependency-list.md" },
    hvscRelease: list.header.hvscRelease,
    complete,
    releasable: complete,
    status: complete ? "release" : "developer-incomplete-source-NOT-RELEASABLE",
    semantics: "allow-by-default: only listed file/subtune records (some lane graded <= 253) are recorded; unlisted means every lane >= 254",
    lanes: ROM_DEP_LANE_NAMES,
    listingCeiling: ROM_DEP_LISTING_CEILING,
    recommendedMinGrade,
    counts: {
      listedFiles: list.header.fileCount,
      listedSubtunes: list.header.decisionCount,
      subtunesBelowRecommended: decisions.filter((d) => minGradeOf(d.grades) < recommendedMinGrade).length,
      excludedUnmeasuredSubtunes: excluded,
      sourceFiles: list.header.sourceFiles,
      sourceSubtunes: list.header.sourceSubtunes,
      perLane,
    },
    binary: {
      file: names.bin,
      bytes: bin.length,
      sha256: sha256Hex(bin),
      payloadSha256: list.header.payloadSha256,
      headerBytes: ROM_DEP_HEADER_BYTES,
      fileRecordBytes: ROM_DEP_FILE_RECORD_BYTES,
      decisionRecordBytes: ROM_DEP_DECISION_RECORD_BYTES,
      sections: {
        file: { offset: list.header.fileSectionOffset, bytes: list.header.fileSectionBytes },
        decision: { offset: list.header.decisionSectionOffset, bytes: list.header.decisionSectionBytes },
      },
    },
    humanReadable: { file: names.json, sha256: args.jsonSha256 },
    provenance: { ...list.header.provenance },
    measuredProfile: {
      gradingDesign: "doc/research/hvsc-rom-fidelity-grading.md",
      reference: "the same engine with the authentic KERNAL, BASIC and CHARGEN",
      configurations: { none: "no ROMs supplied", kernalBasic: "KERNAL + BASIC supplied, CHARGEN not supplied" },
      referenceRoms: REFERENCE_ROMS,
      romSetId: romSetId(),
      observationHorizon: {
        rule: "max(10 s, Songlengths.md5 duration + 5 s); 300 s when the subtune has no valid Songlengths entry",
        minimumMs: ROM_DEP_HORIZON_RULE.minimumMs,
        marginMs: ROM_DEP_HORIZON_RULE.marginMs,
        fallbackMs: ROM_DEP_HORIZON_RULE.fallbackMs,
        source: ROM_DEP_HORIZON_RULE.source,
      },
      songlengthsFileVerified: args.songlengthsVerified,
      sourceProfile: input.header.profile,
    },
  };
}

async function writeAtomic(target: string, bytes: Uint8Array | string): Promise<void> {
  await writeFile(`${target}.tmp`, bytes);
  await rename(`${target}.tmp`, target);
}

export async function generateRomDependencyList(options: GenerateOptions): Promise<GenerateResult> {
  const input = await loadGradingResults(options.resultsPath, { allowIncomplete: options.allowIncomplete === true });
  const paths = options.songlengthsPath ? songlengthsPaths(input, await readFile(options.songlengthsPath, "utf8")) : undefined;
  const entries = deriveEntries(input);
  const bin = encodeRomDependencyList({
    hvscRelease: input.header.hvscRelease,
    sourceFiles: input.header.files,
    sourceSubtunes: input.header.subtunes,
    incompleteSource: !input.complete,
    recommendedMinGrade: options.recommendedMinGrade,
    provenance: provenanceOf(input),
    entries,
  });
  const names = outputNames(input.header.hvscRelease);
  const json = humanReadableList(entries, input, paths, options.recommendedMinGrade, input.complete);
  const manifest = asJson(buildManifest({ input, entries, bin, names, jsonSha256: sha256Hex(json), recommendedMinGrade: options.recommendedMinGrade, songlengthsVerified: paths !== undefined }));
  await mkdir(options.outDir, { recursive: true });
  const result: GenerateResult = {
    binPath: path.join(options.outDir, names.bin),
    manifestPath: path.join(options.outDir, names.manifest),
    jsonPath: path.join(options.outDir, names.json),
    bytes: bin.length,
    binSha256: sha256Hex(bin),
    manifestSha256: sha256Hex(manifest),
    listedFiles: entries.length,
    listedSubtunes: entries.reduce((s, e) => s + e.decisions.length, 0),
    complete: input.complete,
  };
  await writeAtomic(result.binPath, bin);
  await writeAtomic(result.jsonPath, json);
  await writeAtomic(result.manifestPath, manifest);
  return result;
}

interface CliOptions {
  results?: string;
  recommendedMinGrade?: number;
  songlengths?: string;
  out?: string;
  allowIncomplete: boolean;
}

const ARG_DEFS: ArgDef[] = [
  { name: "--results", type: "string", description: "ROM fidelity grading results (JSONL, sidflow-rom-grading-results-1)", required: true },
  { name: "--recommended-min-grade", type: "integer", description: "Consumer default skip threshold 1..254 (skip when a lane grade is below it); calibrated, so required", required: true, constraints: { min: 1, max: 254 } },
  { name: "--songlengths", type: "string", description: "HVSC Songlengths.md5 matching the digest pinned in the results; adds HVSC paths to the JSON view" },
  { name: "--out", type: "string", description: "Output directory", defaultValue: "workspace/rom-dependency-list" },
  { name: "--allow-incomplete", type: "boolean", description: "DEVELOPER ONLY: accept results with unmeasured lanes; those subtunes are excluded and the output is flagged non-releasable" },
];
const HELP_TEXT = formatHelp(
  "bun scripts/rom-dependency-list/generate.ts --results <grading-results.jsonl> --recommended-min-grade <1..254> [--songlengths <Songlengths.md5>] [--out <dir>]",
  "Generate the sidromdep-1 ROM dependency list from complete ROM fidelity grading results.",
  ARG_DEFS,
  ["bun scripts/rom-dependency-list/generate.ts --results workspace/rom-grading/grading-results.jsonl --recommended-min-grade 128"],
);

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs<CliOptions>(argv, ARG_DEFS);
  const exit = handleParseResult(parsed, HELP_TEXT, process.stdout, process.stderr);
  if (exit !== undefined) return exit;
  const o = parsed.options;
  const result = await generateRomDependencyList({
    resultsPath: o.results!,
    outDir: o.out ?? "workspace/rom-dependency-list",
    recommendedMinGrade: o.recommendedMinGrade!,
    songlengthsPath: o.songlengths,
    allowIncomplete: o.allowIncomplete === true,
  });
  console.log(`${result.complete ? "Generated" : "Generated NON-RELEASABLE developer output"}: ${result.listedFiles} files, ${result.listedSubtunes} subtunes, ${result.bytes} bytes`);
  console.log(`bin sha256:      ${result.binSha256}`);
  console.log(`manifest sha256: ${result.manifestSha256}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error("ROM dependency list generation failed", error); process.exitCode = 1; },
  );
}
