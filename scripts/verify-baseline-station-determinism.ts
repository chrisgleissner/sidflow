#!/usr/bin/env bun

/**
 * Baseline determinism check (DEMOS/G-L)
 *
 * Runs two identical end-to-end classifications (including WAV rendering) into
 * isolated output dirs, rebuilds stations from each run using a fixed baseline
 * seed list, and compares run1 vs run2 station overlap.
 */

import { parseArgs } from "node:util";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type StationManifest = {
  seed?: { key?: string; sid_path?: string; song_index?: number | null };
};

function stationKeyFromSid(sid_path: string, song_index: number | null | undefined): string {
  return song_index !== null && song_index !== undefined ? `${sid_path}:${song_index}` : sid_path;
}

function getSeedKeyFromManifest(manifest: StationManifest, manifestPath: string): string {
  const key = manifest.seed?.key;
  if (typeof key === "string" && key.length > 0) return key;
  const sid = manifest.seed?.sid_path;
  if (!sid) throw new Error(`Missing seed.sid_path in ${manifestPath}`);
  return stationKeyFromSid(sid, manifest.seed?.song_index);
}

async function listStationDirs(stationsDirAbs: string): Promise<string[]> {
  const entries = await readdir(stationsDirAbs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("station-"))
    .map((e) => path.join(stationsDirAbs, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function newestJsonlIn(dirAbs: string): Promise<string> {
  const entries = await readdir(dirAbs, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => e.name);
  if (files.length === 0) throw new Error(`No .jsonl files found in: ${dirAbs}`);

  const withStats = await Promise.all(
    files.map(async (name) => {
      const p = path.join(dirAbs, name);
      const st = await stat(p);
      return { path: p, mtimeMs: st.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].path;
}

async function ensureSeedListFile(baselineStationsDir: string, outDir: string): Promise<string> {
  const stationDirs = await listStationDirs(path.resolve(baselineStationsDir));
  const seeds: string[] = [];
  for (const d of stationDirs) {
    const manifestPath = path.join(d, "manifest.json");
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as StationManifest;
    seeds.push(getSeedKeyFromManifest(parsed, manifestPath));
  }
  const unique = Array.from(new Set(seeds)).sort((a, b) => a.localeCompare(b));
  const seedFile = path.join(outDir, "baseline-seeds.txt");
  await writeFile(seedFile, `${unique.join("\n")}\n`);
  return seedFile;
}

async function spawnAndWait(cmd: string, args: string[], cwd = process.cwd()): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${cmd} ${args.join(" ")}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: "tmp/demos-gl/.sidflow.json" },
      "baseline-stations": { type: "string", default: "tmp/demos-gl/stations" },
      out: { type: "string", default: "tmp/demos-gl/determinism" },
      "sid-path-prefix": { type: "string", default: "C64Music/DEMOS/G-L" },
      size: { type: "string", default: "20" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      "Usage: bun scripts/verify-baseline-station-determinism.ts [--config <path>] [--baseline-stations <dir>] [--out <dir>] [--sid-path-prefix <prefix>] [--size <n>]\n"
    );
    process.exit(0);
  }

  const baseConfigPath = path.resolve(values.config!);
  const baselineStationsDir = path.resolve(values["baseline-stations"]!);
  const outDir = path.resolve(values.out!);
  const sidPathPrefix = values["sid-path-prefix"]!;
  const stationSize = Math.max(1, Number(values.size ?? 20));

  await mkdir(outDir, { recursive: true });
  const seedFile = await ensureSeedListFile(baselineStationsDir, outDir);

  const baseRaw = JSON.parse(await readFile(baseConfigPath, "utf8")) as Record<string, unknown>;
  const introSkipSec = typeof baseRaw.introSkipSec === "number" ? baseRaw.introSkipSec : 30;
  const maxClassifySec = typeof baseRaw.maxClassifySec === "number" ? baseRaw.maxClassifySec : 15;
  const analysisSampleRate = typeof baseRaw.analysisSampleRate === "number" ? baseRaw.analysisSampleRate : 11025;
  const maxRenderSec = typeof baseRaw.maxRenderSec === "number" ? baseRaw.maxRenderSec : Math.max(1, Math.ceil(introSkipSec + maxClassifySec));

  const runs = ["run1", "run2"] as const;

  for (const runId of runs) {
    const runRoot = path.join(outDir, runId);
    const runAudioCachePath = `./${path.posix.join(path.relative(process.cwd(), runRoot), "audio-cache")}`;
    const runTagsPath = `./${path.posix.join(path.relative(process.cwd(), runRoot), "tags")}`;
    const runClassifiedPath = `./${path.posix.join(path.relative(process.cwd(), runRoot), "classified")}`;
    const runStationsDir = path.join(runRoot, "stations");

    await mkdir(path.resolve(runAudioCachePath), { recursive: true });
    await mkdir(path.resolve(runTagsPath), { recursive: true });
    await mkdir(path.resolve(runClassifiedPath), { recursive: true });
    await mkdir(runStationsDir, { recursive: true });

    const runConfig = {
      ...baseRaw,
      introSkipSec,
      maxClassifySec,
      maxRenderSec,
      analysisSampleRate,
      audioCachePath: runAudioCachePath,
      tagsPath: runTagsPath,
      classifiedPath: runClassifiedPath,
    };

    const runConfigPath = path.join(runRoot, ".sidflow.json");
    await writeFile(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);

    console.log(`\n=== Baseline determinism ${runId} ===`);
    // `scripts/sidflow-classify` is a bash wrapper; run it via bash for portability.
    await spawnAndWait("bash", ["scripts/sidflow-classify", "--config", runConfigPath, "--sid-path-prefix", sidPathPrefix, "--force-rebuild"]);

    const jsonlPath = await newestJsonlIn(path.resolve(runClassifiedPath));

    await spawnAndWait("bun", [
      "scripts/build-stations-from-jsonl.mjs",
      "--jsonl",
      jsonlPath,
      "--wav-cache",
      path.resolve(runAudioCachePath),
      "--out",
      runStationsDir,
      "--stations",
      String((await readFile(seedFile, "utf8")).trim().split("\n").filter(Boolean).length),
      "--size",
      String(stationSize),
      "--seed",
      "42",
      "--seed-keys-file",
      seedFile,
      "--seed-mode",
      "extremes",
    ]);
  }

  const run1Stations = path.join(outDir, "run1", "stations");
  const run2Stations = path.join(outDir, "run2", "stations");

  const proc = Bun.spawn([
    "bun",
    "scripts/compare-stations-overlap.ts",
    "--baseline",
    run1Stations,
    "--candidate",
    run2Stations,
  ], { stdout: "pipe", stderr: "inherit" });

  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`compare-stations-overlap failed (${exitCode})`);
  }

  const summary = JSON.parse(text) as { meanJaccard: number; minJaccard: number; meanRecall: number; minRecall: number };
  const outPath = path.join(outDir, "summary.json");
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nDeterminism summary written: ${path.relative(process.cwd(), outPath)}`);
  console.log(`run1 vs run2 overlap: meanJaccard=${summary.meanJaccard.toFixed(4)} minJaccard=${summary.minJaccard.toFixed(4)}`);
}

await main();
