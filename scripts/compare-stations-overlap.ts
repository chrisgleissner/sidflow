#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";

type StationManifest = {
  stationId: string;
  seed: {
    key?: string;
    sid_path: string;
    song_index: number | null;
  };
  tracks: Array<{
    sid_path: string;
    song_index: number | null;
  }>;
};

function stationKeyFromSid(sid_path: string, song_index: number | null | undefined): string {
  return song_index !== null && song_index !== undefined ? `${sid_path}:${song_index}` : sid_path;
}

function getSeedKey(manifest: StationManifest): string {
  if (manifest.seed.key && typeof manifest.seed.key === "string" && manifest.seed.key.length > 0) {
    return manifest.seed.key;
  }
  return stationKeyFromSid(manifest.seed.sid_path, manifest.seed.song_index);
}

async function listStationDirs(stationsDirAbs: string): Promise<string[]> {
  const entries = await fs.readdir(stationsDirAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("station-"))
    .map((e) => path.join(stationsDirAbs, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readManifest(stationDirAbs: string): Promise<StationManifest> {
  const raw = await fs.readFile(path.join(stationDirAbs, "manifest.json"), "utf8");
  return JSON.parse(raw) as StationManifest;
}

function toTrackSet(manifest: StationManifest): Set<string> {
  const set = new Set<string>();
  set.add(stationKeyFromSid(manifest.seed.sid_path, manifest.seed.song_index));
  for (const t of manifest.tracks) {
    set.add(stationKeyFromSid(t.sid_path, t.song_index));
  }
  return set;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const v of a) if (b.has(v)) n += 1;
  return n;
}

function unionSize(a: Set<string>, b: Set<string>): number {
  let n = a.size;
  for (const v of b) if (!a.has(v)) n += 1;
  return n;
}

type Args = {
  baseline: string;
  candidate: string;
};

function parseArgs(argv: string[]): Args {
  let baseline = "";
  let candidate = "";

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") baseline = argv[++i] ?? baseline;
    else if (a === "--candidate") candidate = argv[++i] ?? candidate;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/compare-stations-overlap.ts --baseline <dir> --candidate <dir>",
          "",
          "Compares station membership overlap by seed key.",
        ].join("\n")
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }

  if (!baseline || !candidate) {
    console.error("Missing required --baseline and/or --candidate");
    process.exit(2);
  }

  return { baseline, candidate };
}

async function main() {
  const args = parseArgs(process.argv);

  const baselineAbs = path.resolve(args.baseline);
  const candidateAbs = path.resolve(args.candidate);

  const baselineDirs = await listStationDirs(baselineAbs);
  const candidateDirs = await listStationDirs(candidateAbs);

  const candidateBySeed = new Map<string, { dir: string; manifest: StationManifest; set: Set<string> }>();
  for (const dir of candidateDirs) {
    const m = await readManifest(dir);
    const seedKey = getSeedKey(m);
    candidateBySeed.set(seedKey, { dir, manifest: m, set: toTrackSet(m) });
  }

  type Row = {
    seedKey: string;
    baselineStationId: string;
    candidateStationId: string | null;
    overlapJaccard: number;
    overlapRecall: number;
  };

  const rows: Row[] = [];

  for (const dir of baselineDirs) {
    const m = await readManifest(dir);
    const seedKey = getSeedKey(m);
    const baseSet = toTrackSet(m);

    const cand = candidateBySeed.get(seedKey);
    if (!cand) {
      rows.push({
        seedKey,
        baselineStationId: m.stationId,
        candidateStationId: null,
        overlapJaccard: 0,
        overlapRecall: 0,
      });
      continue;
    }

    const inter = intersectionSize(baseSet, cand.set);
    const uni = unionSize(baseSet, cand.set);

    rows.push({
      seedKey,
      baselineStationId: m.stationId,
      candidateStationId: cand.manifest.stationId,
      overlapJaccard: uni > 0 ? inter / uni : 0,
      overlapRecall: baseSet.size > 0 ? inter / baseSet.size : 0,
    });
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const jaccards = rows.map((r) => r.overlapJaccard);
  const recalls = rows.map((r) => r.overlapRecall);

  const summary = {
    baseline: baselineAbs,
    candidate: candidateAbs,
    stationCount: rows.length,
    meanJaccard: mean(jaccards),
    meanRecall: mean(recalls),
    minJaccard: Math.min(...jaccards),
    minRecall: Math.min(...recalls),
    rows,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
