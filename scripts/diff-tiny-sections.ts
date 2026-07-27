/**
 * Compare two sidcorr-tiny-1 bundles section by section, and assert which sections were
 * allowed to change.
 *
 * The 0.8.0 release changes station membership for a large share of the corpus, and the
 * only safe way to ship that is to prove the change is confined to the style-mask table.
 * Every `md5_48` file identity, every per-file subsong count, every packed rating and
 * every neighbour record has to come through untouched — a listener re-pinning to the
 * new bundle must get different stations, not different music.
 *
 * "Looks the same size" is not that proof, which is why this exists. The bundle is a
 * flat sequence of fixed-size tables whose offsets are in the header, so an exact
 * per-section byte comparison is cheap and total.
 *
 * Usage:
 *   bun run scripts/diff-tiny-sections.ts <baseline.sidcorr> <candidate.sidcorr> \
 *     [--allow styleMask] [--allow ...]
 *
 * Exits non-zero if any section outside `--allow` differs. With no `--allow`, any
 * difference at all fails.
 */

import { readFile } from "node:fs/promises";
import process from "node:process";

interface TinyHeader {
  tracks: number;
  files: number;
  styleTableOffset: number;
  fileIdentityOffset: number;
  fileTrackCountOffset: number;
  styleMaskOffset: number;
  neighborsOffset: number;
  styleTableLength: number;
  fileIdentityLength: number;
  neighborLength: number;
}

const MAGIC = "SIDTINY1";
const STYLE_MASK_WIDTH_BYTES = 2;

function parseHeader(payload: Buffer, label: string): TinyHeader {
  if (payload.subarray(0, 8).toString("ascii") !== MAGIC) {
    throw new Error(`${label} is not a sidcorr-tiny-1 bundle`);
  }
  return {
    tracks: payload.readUInt32LE(12),
    files: payload.readUInt32LE(16),
    styleTableOffset: payload.readUInt32LE(32),
    fileIdentityOffset: payload.readUInt32LE(36),
    fileTrackCountOffset: payload.readUInt32LE(40),
    styleMaskOffset: payload.readUInt32LE(44),
    neighborsOffset: payload.readUInt32LE(48),
    styleTableLength: payload.readUInt32LE(52),
    fileIdentityLength: payload.readUInt32LE(56),
    neighborLength: payload.readUInt32LE(60),
  };
}

function sectionsFor(header: TinyHeader, totalBytes: number): Array<[string, number, number]> {
  const styleMaskBytes = header.tracks * STYLE_MASK_WIDTH_BYTES;
  const sections: Array<[string, number, number]> = [
    ["header", 0, header.styleTableOffset],
    ["styleTable", header.styleTableOffset, header.fileIdentityOffset],
    ["fileIdentity", header.fileIdentityOffset, header.fileTrackCountOffset],
    ["fileTrackCount", header.fileTrackCountOffset, header.styleMaskOffset],
    ["styleMask", header.styleMaskOffset, header.styleMaskOffset + styleMaskBytes],
    ["ratings", header.styleMaskOffset + styleMaskBytes, header.neighborsOffset],
    ["neighbors", header.neighborsOffset, header.neighborsOffset + header.neighborLength],
  ];
  const tail = header.neighborsOffset + header.neighborLength;
  if (tail < totalBytes) {
    sections.push(["trailing", tail, totalBytes]);
  }
  return sections;
}

async function main(argv: string[]): Promise<number> {
  const positional: string[] = [];
  const allowed = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--allow") {
      const value = argv[index + 1];
      if (!value) {
        process.stderr.write("Error: --allow needs a section name\n");
        return 2;
      }
      allowed.add(value);
      index += 1;
      continue;
    }
    positional.push(argv[index]!);
  }

  if (positional.length !== 2) {
    process.stderr.write("Usage: diff-tiny-sections.ts <baseline> <candidate> [--allow <section>]...\n");
    return 2;
  }

  const [baselinePath, candidatePath] = positional as [string, string];
  const baseline = await readFile(baselinePath);
  const candidate = await readFile(candidatePath);

  process.stdout.write(`baseline  ${baselinePath} (${baseline.length} bytes)\n`);
  process.stdout.write(`candidate ${candidatePath} (${candidate.length} bytes)\n\n`);

  const baselineHeader = parseHeader(baseline, baselinePath);
  const candidateHeader = parseHeader(candidate, candidatePath);

  let failed = false;
  if (JSON.stringify(baselineHeader) !== JSON.stringify(candidateHeader)) {
    process.stdout.write("Header fields differ, so the layouts are not comparable:\n");
    process.stdout.write(`  baseline  ${JSON.stringify(baselineHeader)}\n`);
    process.stdout.write(`  candidate ${JSON.stringify(candidateHeader)}\n`);
    return 1;
  }

  process.stdout.write("section              bytes    differing  verdict\n");
  for (const [name, start, end] of sectionsFor(baselineHeader, baseline.length)) {
    const left = baseline.subarray(start, end);
    const right = candidate.subarray(start, end);
    let differing = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        differing += 1;
      }
    }
    let verdict: string;
    if (differing === 0) {
      verdict = "identical";
    } else if (allowed.has(name)) {
      verdict = "CHANGED (allowed)";
    } else {
      verdict = "CHANGED — NOT ALLOWED";
      failed = true;
    }
    process.stdout.write(
      `${name.padEnd(18)} ${String(end - start).padStart(9)} ${String(differing).padStart(12)}  ${verdict}\n`,
    );
  }

  process.stdout.write("\n");
  if (failed) {
    process.stdout.write("FAIL: a section changed that was not declared allowed.\n");
    return 1;
  }
  process.stdout.write("OK: every change is confined to the allowed sections.\n");
  return 0;
}

const exitCode = await main(process.argv.slice(2));
process.exit(exitCode);
