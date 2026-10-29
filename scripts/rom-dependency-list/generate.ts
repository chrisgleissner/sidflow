#!/usr/bin/env bun
/**
 * Generate the SID ROM Dependency List (format `sidromdep-1`, doc/rom-dependency-list.md) from a
 * complete, verified ROM audit Commander bundle.
 *
 *   bun scripts/rom-dependency-list/generate.ts \
 *     --bundle workspace/rom-audit-dual/published \
 *     --songlengths workspace/hvsc/C64Music/DOCUMENTS/Songlengths.md5 \
 *     --out workspace/rom-dependency-list
 *
 * Writes hvsc<N>-sidromdep-1.bin, .manifest.json and the optional human-readable .json.
 * Refuses bundles that are not `complete && releaseReady` and verified by
 * scripts/rom-audit/verify-publication.ts. `--allow-incomplete` is a developer flag: the output is marked
 * complete:false in the manifest and carries header flag bit 0; it must never be released.
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
  ROM_DEP_LANE_BITS,
  ROM_DEP_LANE_NAMES,
  decodeRomDependencyList,
  encodeRomDependencyList,
  laneStates,
  sha256Hex,
  type RomDepEntry,
} from "../../packages/sidflow-common/src/rom-dependency-list.js";
import { REFERENCE_ROMS, deriveEntries, loadSourceBundle, provenanceOf, verifyHorizonRule, type SourceBundle, type VerifyBundle } from "./bundle.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { formatHelp, handleParseResult, parseArgs, type ArgDef } from "../../packages/sidflow-common/src/cli-parser.js";

export interface GenerateOptions {
  bundleDir: string;
  outDir: string;
  songlengthsPath?: string;
  allowIncomplete?: boolean;
  hvscRelease?: number;
  /** Test seam: defaults to scripts/rom-audit/verify-publication.ts. */
  verifyBundle?: VerifyBundle;
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

/** Deterministic human-readable view: release asset only, never consumed by the runtime. */
export function humanReadableList(entries: readonly RomDepEntry[], bundle: SourceBundle, hvscRelease: number, paths: ReadonlyMap<string, string> | undefined): string {
  const records = entries.flatMap((entry) => entry.decisions.map((d) => ({
    md5: entry.md5,
    hvscPath: paths?.get(entry.md5) ?? null,
    subtune: d.subtune,
    incompatible: ROM_DEP_LANE_NAMES.filter((n) => d.incompatible & ROM_DEP_LANE_BITS[n]),
    unknown: ROM_DEP_LANE_NAMES.filter((n) => d.unknown & ROM_DEP_LANE_BITS[n]),
    lanes: laneStates(d.incompatible, d.unknown),
  })));
  return asJson({
    format: ROM_DEP_FORMAT_ID,
    hvscRelease,
    complete: bundle.manifest.complete,
    note: "Unlisted files and subtunes are allowed by default. Lanes marked allowed on a listed subtune are measured compatible. Unknown is never incompatible.",
    laneBits: ROM_DEP_LANE_BITS,
    records,
  });
}

export function buildManifest(args: { bundle: SourceBundle; entries: readonly RomDepEntry[]; bin: Uint8Array; hvscRelease: number; names: ReturnType<typeof outputNames>; jsonSha256: string; horizonRuleVerified: boolean }): Record<string, unknown> {
  const { bundle, entries, bin, hvscRelease, names } = args;
  const source = bundle.manifest;
  const list = decodeRomDependencyList(bin);
  const perLane = Object.fromEntries(ROM_DEP_LANE_NAMES.map((n) => [n, {
    incompatible: entries.reduce((s, e) => s + e.decisions.filter((d) => d.incompatible & ROM_DEP_LANE_BITS[n]).length, 0),
    unknown: entries.reduce((s, e) => s + e.decisions.filter((d) => d.unknown & ROM_DEP_LANE_BITS[n]).length, 0),
  }]));
  const complete = !list.header.incompleteSource;
  return {
    format: { id: ROM_DEP_FORMAT_ID, version: list.header.formatVersion, specification: "doc/rom-dependency-list.md" },
    hvscRelease,
    complete,
    releasable: complete,
    status: complete ? "release" : "developer-incomplete-source-NOT-RELEASABLE",
    semantics: "allow-by-default: only listed file/subtune records change behaviour; unknown is never incompatible",
    laneBits: ROM_DEP_LANE_BITS,
    counts: {
      listedFiles: list.header.fileCount,
      listedSubtunes: list.header.decisionCount,
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
    provenance: {
      ...list.header.provenance,
      sourceIdentity: source.sourceIdentity,
      sourceSchema: source.schema,
      sourceMethodology: source.methodology,
      sourceDocuments: source.documents,
    },
    measuredProfile: {
      scope: source.scope,
      referenceConfiguration: "KERNAL + BASIC + CHARGEN",
      configurations: { none: "no ROMs supplied", kernalBasic: "KERNAL + BASIC supplied, CHARGEN absent" },
      sampleRateHz: 48000,
      channels: 2,
      powerOnDelay: 8191,
      pullEvents: 256,
      sidModel: "from SID header; MOS8580 where the header names none",
      absentBanks: "BASIC and CHARGEN zero-filled; KERNAL shim when absent",
      engineIds: source.engineIds,
      engines: source.engines,
      nativeHashes: source.nativeHashes,
      romSetId: source.romSetId,
      referenceRoms: REFERENCE_ROMS,
      observationHorizon: {
        rule: "max(10 s, Songlengths.md5 duration + 5 s); 300 s when the subtune has no valid Songlengths entry",
        minimumMs: ROM_DEP_HORIZON_RULE.minimumMs,
        marginMs: ROM_DEP_HORIZON_RULE.marginMs,
        fallbackMs: ROM_DEP_HORIZON_RULE.fallbackMs,
        source: ROM_DEP_HORIZON_RULE.source,
        reproducedFromSonglengths: args.horizonRuleVerified,
      },
    },
  };
}

async function writeAtomic(target: string, bytes: Uint8Array | string): Promise<void> {
  await writeFile(`${target}.tmp`, bytes);
  await rename(`${target}.tmp`, target);
}

export async function generateRomDependencyList(options: GenerateOptions): Promise<GenerateResult> {
  const allowIncomplete = options.allowIncomplete === true;
  const hvscRelease = options.hvscRelease ?? 85;
  if (!allowIncomplete && !options.songlengthsPath) throw new Error("--songlengths is required for a release output (horizon rule must be reproduced)");
  const bundle = await loadSourceBundle(options.bundleDir, { allowIncomplete, verifyBundle: options.verifyBundle });
  const complete = bundle.manifest.complete === true && bundle.manifest.releaseReady === true;
  if (!allowIncomplete && !complete) throw new Error("Source bundle is not complete && releaseReady");
  let paths: Map<string, string> | undefined;
  if (options.songlengthsPath) paths = verifyHorizonRule(bundle, await readFile(options.songlengthsPath, "utf8"));

  const entries = deriveEntries(bundle);
  const bin = encodeRomDependencyList({
    hvscRelease,
    sourceFiles: bundle.manifest.files,
    sourceSubtunes: bundle.manifest.subtunes,
    incompleteSource: !complete,
    provenance: provenanceOf(bundle),
    entries,
  });
  const names = outputNames(hvscRelease);
  const json = humanReadableList(entries, bundle, hvscRelease, paths);
  const manifest = asJson(buildManifest({ bundle, entries, bin, hvscRelease, names, jsonSha256: sha256Hex(json), horizonRuleVerified: paths !== undefined }));
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
    complete,
  };
  await writeAtomic(result.binPath, bin);
  await writeAtomic(result.jsonPath, json);
  await writeAtomic(result.manifestPath, manifest);
  return result;
}

interface CliOptions {
  bundle?: string;
  songlengths?: string;
  out?: string;
  hvscRelease: number;
  allowIncomplete: boolean;
}

const ARG_DEFS: ArgDef[] = [
  { name: "--bundle", type: "string", description: "ROM audit published/ directory (manifest.json, commander-exceptions.json, ...)", required: true },
  { name: "--songlengths", type: "string", description: "HVSC Songlengths.md5 matching the bundle's pinned digest (required unless --allow-incomplete)" },
  { name: "--out", type: "string", description: "Output directory", defaultValue: "workspace/rom-dependency-list" },
  { name: "--hvsc-release", type: "integer", description: "HVSC release number recorded in the header", defaultValue: 85, constraints: { min: 1 } },
  { name: "--allow-incomplete", type: "boolean", description: "DEVELOPER ONLY: accept an incomplete/unqualified bundle; output is flagged non-releasable" },
];
const HELP_TEXT = formatHelp(
  "bun scripts/rom-dependency-list/generate.ts --bundle <published-dir> --songlengths <Songlengths.md5> [--out <dir>]",
  "Generate the sidromdep-1 ROM dependency list from a complete, verified ROM audit bundle.",
  ARG_DEFS,
  ["bun scripts/rom-dependency-list/generate.ts --bundle workspace/rom-audit-dual/published --songlengths workspace/hvsc/C64Music/DOCUMENTS/Songlengths.md5"],
);

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs<CliOptions>(argv, ARG_DEFS);
  const exit = handleParseResult(parsed, HELP_TEXT, process.stdout, process.stderr);
  if (exit !== undefined) return exit;
  const o = parsed.options;
  const result = await generateRomDependencyList({
    bundleDir: o.bundle!,
    outDir: o.out ?? "workspace/rom-dependency-list",
    songlengthsPath: o.songlengths,
    allowIncomplete: o.allowIncomplete === true,
    hvscRelease: o.hvscRelease,
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
