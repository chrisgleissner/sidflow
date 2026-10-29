#!/usr/bin/env bun
/**
 * Verify a SID ROM Dependency List against the full ROM audit bundle it was derived from.
 *
 *   bun scripts/rom-dependency-list/verify.ts \
 *     --bin out/hvsc85-sidromdep-1.bin --bundle workspace/rom-audit-dual/published \
 *     [--songlengths .../Songlengths.md5]
 *
 * Checks: header CRC-32, payload SHA-256, structure and canonical ordering (decoder); manifest agreement
 * (digests, counts, sizes, flags); provenance digests against the source bundle; and a round trip of EVERY
 * source subtune: listed subtunes decode to exactly the source state, every unlisted subtune is measured
 * compatible in all four lanes in the source bundle. Prints the bin and manifest SHA-256.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ROM_DEP_LANE_BITS,
  ROM_DEP_LANE_NAMES,
  decodeRomDependencyList,
  type RomDependencyList,
  sha256Hex,
} from "../../packages/sidflow-common/src/rom-dependency-list.js";
import { formatHelp, handleParseResult, parseArgs, type ArgDef } from "../../packages/sidflow-common/src/cli-parser.js";
import { expectedDecision, loadSourceBundle, provenanceOf, verifyHorizonRule, type SourceBundle, type VerifyBundle } from "./bundle.js";

export interface VerifyOptions {
  binPath: string;
  bundleDir: string;
  manifestPath?: string;
  jsonPath?: string;
  songlengthsPath?: string;
  allowIncomplete?: boolean;
  verifyBundle?: VerifyBundle;
}

export interface VerifyReport {
  binSha256: string;
  manifestSha256: string;
  listedFiles: number;
  listedSubtunes: number;
  checkedSubtunes: number;
  unlistedCompatible: number;
  complete: boolean;
}

function check(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`ROM dependency list verification failed: ${message}`);
}

/**
 * Exhaustive round trip over every source subtune, listed or not: a listed subtune decodes to exactly the source
 * state; every unlisted subtune is measured compatible in all four lanes (no incompatible bit, not unknown).
 */
export function roundTripAgainstBundle(list: RomDependencyList, bundle: SourceBundle): { checked: number; listed: number; unlistedCompatible: number } {
  for (const entry of list.entries()) {
    const count = bundle.horizonsMs.get(entry.md5)?.length;
    check(count !== undefined, `listed file ${entry.md5} is not in the source bundle`);
    for (const d of entry.decisions) check(d.subtune <= count, `${entry.md5}#${d.subtune} exceeds the source subtune count`);
  }
  let checked = 0;
  let listed = 0;
  let unlistedCompatible = 0;
  for (const [md5, horizons] of bundle.horizonsMs) {
    for (let subtune = 1; subtune <= horizons.length; subtune++) {
      const expected = expectedDecision(bundle, md5, subtune);
      const got = list.lookup(md5, subtune);
      checked++;
      if (expected.incompatible === 0 && expected.unknown === 0) {
        check(!got.listed && got.incompatibleMask === 0 && got.unknownMask === 0, `${md5}#${subtune} is measured compatible in all lanes but is listed`);
        unlistedCompatible++;
      } else {
        check(got.listed && got.incompatibleMask === expected.incompatible && got.unknownMask === expected.unknown, `${md5}#${subtune} differs from the source bundle`);
        listed++;
      }
    }
  }
  return { checked, listed, unlistedCompatible };
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
    counts: { listedFiles: number; listedSubtunes: number; sourceFiles: number; sourceSubtunes: number };
    binary: { bytes: number; sha256: string; payloadSha256: string; file: string };
    humanReadable?: { file: string; sha256: string };
    provenance: { sourceManifestSha256: string; songlengthsSha256: string; corpusId: string };
  };

  check(manifest.format.id === "sidromdep-1" && manifest.format.version === header.formatVersion, "format id/version");
  check(manifest.binary.sha256 === binSha256 && manifest.binary.bytes === bin.length && manifest.binary.payloadSha256 === header.payloadSha256, "manifest does not describe this binary");
  check(manifest.binary.file === path.basename(options.binPath), "manifest names a different binary file");
  check(manifest.complete === !header.incompleteSource && manifest.releasable === manifest.complete, "complete flag differs between header and manifest");
  check(manifest.hvscRelease === header.hvscRelease, "HVSC release differs");
  check(manifest.counts.listedFiles === header.fileCount && manifest.counts.listedSubtunes === header.decisionCount &&
    manifest.counts.sourceFiles === header.sourceFiles && manifest.counts.sourceSubtunes === header.sourceSubtunes, "counts differ between header and manifest");
  check(manifest.provenance.sourceManifestSha256 === header.provenance.sourceManifestSha256 &&
    manifest.provenance.songlengthsSha256 === header.provenance.songlengthsSha256 && manifest.provenance.corpusId === header.provenance.corpusId, "provenance differs");
  if (header.incompleteSource) check(options.allowIncomplete === true, "the binary is flagged as built from an incomplete source (developer output); pass --allow-incomplete to inspect it");

  const bundle = await loadSourceBundle(options.bundleDir, { allowIncomplete: options.allowIncomplete === true, verifyBundle: options.verifyBundle });
  const source = provenanceOf(bundle);
  check(source.sourceManifestSha256 === header.provenance.sourceManifestSha256, "source bundle manifest digest differs from the list's provenance");
  check(source.songlengthsSha256 === header.provenance.songlengthsSha256 && source.corpusId === header.provenance.corpusId, "source Songlengths/corpus digest differs");
  check(bundle.manifest.files === header.sourceFiles && bundle.manifest.subtunes === header.sourceSubtunes, "source population differs");
  check(bundle.manifest.complete === !header.incompleteSource, "source completeness differs from the list flag");

  let paths: Map<string, string> | undefined;
  if (options.songlengthsPath) paths = verifyHorizonRule(bundle, await readFile(options.songlengthsPath, "utf8"));

  const { checked, listed, unlistedCompatible } = roundTripAgainstBundle(list, bundle);
  check(listed === header.decisionCount && checked === bundle.manifest.subtunes, "listed/checked subtune totals");
  const entries = list.entries();

  // Optional human-readable companion.
  const jsonPath = options.jsonPath ?? (manifest.humanReadable ? path.join(path.dirname(options.binPath), manifest.humanReadable.file) : undefined);
  if (jsonPath && existsSync(jsonPath)) {
    const jsonBytes = await readFile(jsonPath);
    check(!manifest.humanReadable || sha256Hex(jsonBytes) === manifest.humanReadable.sha256, "human-readable JSON digest differs from the manifest");
    const records = (JSON.parse(jsonBytes.toString("utf8")) as { records: { md5: string; hvscPath: string | null; subtune: number; incompatible: string[]; unknown: string[] }[] }).records;
    const flat = entries.flatMap((e) => e.decisions.map((d) => ({ md5: e.md5, ...d })));
    check(records.length === flat.length, "human-readable record count");
    records.forEach((r, i) => {
      const d = flat[i]!;
      const names = (mask: number): string[] => ROM_DEP_LANE_NAMES.filter((n) => mask & ROM_DEP_LANE_BITS[n]);
      check(r.md5 === d.md5 && r.subtune === d.subtune && r.incompatible.join() === names(d.incompatible).join() && r.unknown.join() === names(d.unknown).join(), `human-readable record ${i}`);
      if (paths) check(r.hvscPath === (paths.get(r.md5) ?? null), `human-readable path for record ${i}`);
    });
  }
  return { binSha256, manifestSha256: sha256Hex(manifestBytes), listedFiles: header.fileCount, listedSubtunes: header.decisionCount, checkedSubtunes: checked, unlistedCompatible, complete: !header.incompleteSource };
}

interface CliOptions { bin?: string; manifest?: string; bundle?: string; songlengths?: string; json?: string; allowIncomplete: boolean }
const ARG_DEFS: ArgDef[] = [
  { name: "--bin", type: "string", description: "hvsc<N>-sidromdep-1.bin to verify", required: true },
  { name: "--bundle", type: "string", description: "ROM audit published/ directory the list was derived from", required: true },
  { name: "--manifest", type: "string", description: "Manifest path (default: next to the binary)" },
  { name: "--json", type: "string", description: "Human-readable JSON path (default: next to the binary, if present)" },
  { name: "--songlengths", type: "string", description: "Songlengths.md5; also re-verifies the horizon rule against every published horizon" },
  { name: "--allow-incomplete", type: "boolean", description: "DEVELOPER ONLY: accept a list flagged as built from an incomplete bundle" },
];
const HELP_TEXT = formatHelp(
  "bun scripts/rom-dependency-list/verify.ts --bin <file.bin> --bundle <published-dir> [--songlengths <Songlengths.md5>]",
  "Verify a sidromdep-1 list: checksums, manifest agreement and an exhaustive round trip against the source bundle.",
  ARG_DEFS,
);

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs<CliOptions>(argv, ARG_DEFS);
  const exit = handleParseResult(parsed, HELP_TEXT, process.stdout, process.stderr);
  if (exit !== undefined) return exit;
  const o = parsed.options;
  const report = await verifyRomDependencyListFiles({ binPath: o.bin!, bundleDir: o.bundle!, manifestPath: o.manifest, jsonPath: o.json, songlengthsPath: o.songlengths, allowIncomplete: o.allowIncomplete === true });
  console.log(`Verified ${report.complete ? "release" : "NON-RELEASABLE developer"} list: ${report.listedFiles} files, ${report.listedSubtunes} listed subtunes, ${report.checkedSubtunes} source subtunes round-tripped (${report.unlistedCompatible} unlisted = measured compatible).`);
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
