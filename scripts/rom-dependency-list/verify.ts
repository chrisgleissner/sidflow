#!/usr/bin/env bun
/**
 * Verify a SID ROM Dependency List against the grading results it was derived from.
 *
 *   bun scripts/rom-dependency-list/verify.ts \
 *     --bin out/hvsc85-sidromdep-1.bin --results workspace/rom-grading/grading-results.jsonl \
 *     [--songlengths .../Songlengths.md5]
 *
 * Checks: header CRC-32, payload SHA-256, structure and canonical ordering (decoder); manifest agreement
 * (digests, counts, sizes, flags, threshold); provenance digests against the results; and a round trip of EVERY
 * graded subtune: listed subtunes decode to exactly the graded values, every unlisted subtune has all four lanes
 * >= 254 in the results. Prints the bin and manifest SHA-256.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  ROM_DEP_LANE_NAMES,
  ROM_DEP_LISTING_CEILING,
  decodeRomDependencyList,
  minGradeOf,
  sha256Hex,
  type RomDependencyList,
} from "../../packages/sidflow-common/src/rom-dependency-list.js";
import { formatHelp, handleParseResult, parseArgs, type ArgDef } from "../../packages/sidflow-common/src/cli-parser.js";
import { expectedFor, loadGradingResults, provenanceOf, type GradingInput } from "./grading.js";
import { songlengthsPaths } from "./generate.js";

export interface VerifyOptions {
  binPath: string;
  resultsPath: string;
  manifestPath?: string;
  jsonPath?: string;
  songlengthsPath?: string;
  allowIncomplete?: boolean;
}

export interface VerifyReport {
  binSha256: string;
  manifestSha256: string;
  listedFiles: number;
  listedSubtunes: number;
  checkedSubtunes: number;
  unlistedAtLeast254: number;
  excludedUnmeasured: number;
  complete: boolean;
}

function check(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`ROM dependency list verification failed: ${message}`);
}

/**
 * Exhaustive round trip over every graded subtune, listed or not: a listed subtune decodes to exactly the graded
 * values; every unlisted subtune has all four lanes >= 254 in the input; an unmeasured subtune (developer output
 * only) is excluded. Every list record must exist in the input.
 */
export function roundTripAgainstResults(list: RomDependencyList, input: GradingInput): { checked: number; listed: number; unlistedAtLeast254: number; excluded: number } {
  for (const entry of list.entries()) {
    for (const d of entry.decisions) {
      const expected = expectedFor(input, entry.md5, d.subtune);
      check(expected.kind !== "absent", `listed ${entry.md5}#${d.subtune} is not in the grading results`);
    }
  }
  let checked = 0, listed = 0, unlistedAtLeast254 = 0, excluded = 0;
  for (const [md5, songs] of input.rows) {
    for (const subtune of songs.keys()) {
      const expected = expectedFor(input, md5, subtune);
      const got = list.lookup(md5, subtune);
      checked++;
      if (expected.kind === "listed") {
        check(got.listed && ROM_DEP_LANE_NAMES.every((lane) => got.grades[lane] === expected.grades[lane]), `${md5}#${subtune} differs from the grading results`);
        check(minGradeOf(got.grades) <= ROM_DEP_LISTING_CEILING, `${md5}#${subtune} listed above the ceiling`);
        listed++;
      } else if (expected.kind === "unlisted") {
        check(!got.listed, `${md5}#${subtune} has every lane >= 254 but is listed`);
        unlistedAtLeast254++;
      } else {
        check(!got.listed, `${md5}#${subtune} has an unmeasured lane but is listed`);
        excluded++;
      }
    }
  }
  return { checked, listed, unlistedAtLeast254, excluded };
}

export async function verifyRomDependencyListFiles(options: VerifyOptions): Promise<VerifyReport> {
  const bin = new Uint8Array(await readFile(options.binPath));
  const list = decodeRomDependencyList(bin); // throws on any checksum/structure defect
  const header = list.header;
  const binSha256 = sha256Hex(bin);
  const manifestPath = options.manifestPath ?? options.binPath.replace(/\.bin$/, ".manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    format: { id: string; version: number };
    complete: boolean;
    releasable: boolean;
    hvscRelease: number;
    recommendedMinGrade: number;
    listingCeiling: number;
    counts: { listedFiles: number; listedSubtunes: number; sourceFiles: number; sourceSubtunes: number };
    binary: { bytes: number; sha256: string; payloadSha256: string; file: string };
    humanReadable?: { file: string; sha256: string };
    provenance: { sourceSha256: string; songlengthsSha256: string; corpusId: string; gradingMethodologySha256: string };
  };

  check(manifest.format.id === "sidromdep-1" && manifest.format.version === header.formatVersion, "format id/version");
  check(manifest.binary.sha256 === binSha256 && manifest.binary.bytes === bin.length && manifest.binary.payloadSha256 === header.payloadSha256, "manifest does not describe this binary");
  check(manifest.binary.file === path.basename(options.binPath), "manifest names a different binary file");
  check(manifest.complete === !header.incompleteSource && manifest.releasable === manifest.complete, "complete flag differs between header and manifest");
  check(manifest.hvscRelease === header.hvscRelease, "HVSC release differs");
  check(manifest.recommendedMinGrade === header.recommendedMinGrade && manifest.listingCeiling === header.listingCeiling, "grade thresholds differ between header and manifest");
  check(manifest.counts.listedFiles === header.fileCount && manifest.counts.listedSubtunes === header.decisionCount &&
    manifest.counts.sourceFiles === header.sourceFiles && manifest.counts.sourceSubtunes === header.sourceSubtunes, "counts differ between header and manifest");
  const p = manifest.provenance;
  check(p.sourceSha256 === header.provenance.sourceSha256 && p.songlengthsSha256 === header.provenance.songlengthsSha256 &&
    p.corpusId === header.provenance.corpusId && p.gradingMethodologySha256 === header.provenance.gradingMethodologySha256, "provenance differs");
  if (header.incompleteSource) check(options.allowIncomplete === true, "the binary is flagged as built from incomplete grading (developer output); pass --allow-incomplete to inspect it");

  const input = await loadGradingResults(options.resultsPath, { allowIncomplete: options.allowIncomplete === true });
  const source = provenanceOf(input);
  check(source.sourceSha256 === header.provenance.sourceSha256, "grading results digest differs from the list's provenance");
  check(source.songlengthsSha256 === header.provenance.songlengthsSha256 && source.corpusId === header.provenance.corpusId &&
    source.gradingMethodologySha256 === header.provenance.gradingMethodologySha256, "grading header differs from the list's provenance");
  check(input.header.hvscRelease === header.hvscRelease && input.header.files === header.sourceFiles && input.header.subtunes === header.sourceSubtunes, "source population differs");
  check(input.complete === !header.incompleteSource, "source completeness differs from the list flag");

  let paths: Map<string, string> | undefined;
  if (options.songlengthsPath) paths = songlengthsPaths(input, await readFile(options.songlengthsPath, "utf8"));

  const round = roundTripAgainstResults(list, input);
  check(round.listed === header.decisionCount && round.checked === input.rowCount, "listed/checked subtune totals");
  const entries = list.entries();

  // Optional human-readable companion.
  const jsonPath = options.jsonPath ?? (manifest.humanReadable ? path.join(path.dirname(options.binPath), manifest.humanReadable.file) : undefined);
  if (jsonPath && existsSync(jsonPath)) {
    const jsonBytes = await readFile(jsonPath);
    check(!manifest.humanReadable || sha256Hex(jsonBytes) === manifest.humanReadable.sha256, "human-readable JSON digest differs from the manifest");
    const records = (JSON.parse(jsonBytes.toString("utf8")) as { records: { md5: string; hvscPath: string | null; subtune: number; grades: Record<string, number> }[] }).records;
    const flat = entries.flatMap((e) => e.decisions.map((d) => ({ md5: e.md5, ...d })));
    check(records.length === flat.length, "human-readable record count");
    records.forEach((r, i) => {
      const d = flat[i]!;
      check(r.md5 === d.md5 && r.subtune === d.subtune && ROM_DEP_LANE_NAMES.every((lane) => r.grades[lane] === d.grades[lane]), `human-readable record ${i}`);
      if (paths) check(r.hvscPath === (paths.get(r.md5) ?? null), `human-readable path for record ${i}`);
    });
  }
  return {
    binSha256,
    manifestSha256: sha256Hex(manifestBytes),
    listedFiles: header.fileCount,
    listedSubtunes: header.decisionCount,
    checkedSubtunes: round.checked,
    unlistedAtLeast254: round.unlistedAtLeast254,
    excludedUnmeasured: round.excluded,
    complete: !header.incompleteSource,
  };
}

interface CliOptions { bin?: string; manifest?: string; results?: string; songlengths?: string; json?: string; allowIncomplete: boolean }
const ARG_DEFS: ArgDef[] = [
  { name: "--bin", type: "string", description: "hvsc<N>-sidromdep-1.bin to verify", required: true },
  { name: "--results", type: "string", description: "Grading results JSONL the list was derived from", required: true },
  { name: "--manifest", type: "string", description: "Manifest path (default: next to the binary)" },
  { name: "--json", type: "string", description: "Human-readable JSON path (default: next to the binary, if present)" },
  { name: "--songlengths", type: "string", description: "Songlengths.md5; also checks its digest and the HVSC paths in the JSON view" },
  { name: "--allow-incomplete", type: "boolean", description: "DEVELOPER ONLY: accept a list flagged as built from incomplete grading" },
];
const HELP_TEXT = formatHelp(
  "bun scripts/rom-dependency-list/verify.ts --bin <file.bin> --results <grading-results.jsonl> [--songlengths <Songlengths.md5>]",
  "Verify a sidromdep-1 list: checksums, manifest agreement and an exhaustive round trip against the grading results.",
  ARG_DEFS,
);

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs<CliOptions>(argv, ARG_DEFS);
  const exit = handleParseResult(parsed, HELP_TEXT, process.stdout, process.stderr);
  if (exit !== undefined) return exit;
  const o = parsed.options;
  const report = await verifyRomDependencyListFiles({ binPath: o.bin!, resultsPath: o.results!, manifestPath: o.manifest, jsonPath: o.json, songlengthsPath: o.songlengths, allowIncomplete: o.allowIncomplete === true });
  console.log(`Verified ${report.complete ? "release" : "NON-RELEASABLE developer"} list: ${report.listedFiles} files, ${report.listedSubtunes} listed subtunes, ${report.checkedSubtunes} graded subtunes round-tripped (${report.unlistedAtLeast254} unlisted = all lanes >= 254, ${report.excludedUnmeasured} excluded unmeasured).`);
  console.log(`bin sha256:      ${report.binSha256}`);
  console.log(`manifest sha256: ${report.manifestSha256}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error("ROM dependency list verification failed", error); process.exitCode = 1; },
  );
}
