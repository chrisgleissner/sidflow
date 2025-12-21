#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type StationSeed = {
  seedKey: string;
};

type BaselineSeedManifest = {
  stationId: string;
  seed: {
    key?: string;
    sid_path: string;
    song_index: number | null;
  };
};

function stationKeyFromSid(sid_path: string, song_index: number | null | undefined): string {
  return song_index !== null && song_index !== undefined ? `${sid_path}:${song_index}` : sid_path;
}

function getSeedKey(manifest: BaselineSeedManifest): string {
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

async function readJson<T>(filePathAbs: string): Promise<T> {
  const raw = await fs.readFile(filePathAbs, "utf8");
  return JSON.parse(raw) as T;
}

async function loadBaselineSeeds(baselineStationsDirAbs: string): Promise<StationSeed[]> {
  const dirs = await listStationDirs(baselineStationsDirAbs);
  const seeds: StationSeed[] = [];
  for (const d of dirs) {
    const m = await readJson<BaselineSeedManifest>(path.join(d, "manifest.json"));
    seeds.push({ seedKey: getSeedKey(m) });
  }
  // De-dupe, keep stable.
  const unique = Array.from(new Set(seeds.map((s) => s.seedKey))).sort((a, b) => a.localeCompare(b));
  return unique.map((seedKey) => ({ seedKey }));
}

function nowMs(): number {
  return Date.now();
}

async function runCommand(
  cmd: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; label: string }
): Promise<{ exitCode: number; elapsedMs: number }>
{
  const start = nowMs();
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      const elapsedMs = nowMs() - start;
      resolve({ exitCode: code ?? 1, elapsedMs });
    });
  });
}

async function newestJsonlIn(dirAbs: string): Promise<string> {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => e.name);
  if (files.length === 0) {
    throw new Error(`No .jsonl files found in: ${dirAbs}`);
  }
  const withStats = await Promise.all(
    files.map(async (name) => {
      const p = path.join(dirAbs, name);
      const st = await fs.stat(p);
      return { path: p, mtimeMs: st.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].path;
}

function computeMinRenderSec(introSkipSec: number, maxClassifySec: number): number {
  return Math.max(20, introSkipSec + maxClassifySec);
}

type JourneyIteration = {
  id: string;
  introSkipSec: number;
  maxClassifySec: number;
  analysisSampleRate: number;
};

type Args = {
  baselineStationsDir: string;
  sidPathPrefix: string;
  outRoot: string;
  maxDeviationPct: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baselineStationsDir: "tmp/demos-gl/stations",
    sidPathPrefix: "C64Music/DEMOS/G-L",
    outRoot: "tmp/demos-gl/journey",
    maxDeviationPct: 10,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline-stations") args.baselineStationsDir = argv[++i] ?? args.baselineStationsDir;
    else if (a === "--sid-path-prefix") args.sidPathPrefix = argv[++i] ?? args.sidPathPrefix;
    else if (a === "--out") args.outRoot = argv[++i] ?? args.outRoot;
    else if (a === "--max-deviation-pct") args.maxDeviationPct = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/classification-speed-journey.ts [options]",
          "",
          "Options:",
          "  --baseline-stations <dir>      Baseline stations dir (default: tmp/demos-gl/stations)",
          "  --sid-path-prefix <prefix>     Relative SID path filter (default: C64Music/DEMOS/G-L)",
          "  --out <dir>                    Output root (default: tmp/demos-gl/journey)",
          "  --max-deviation-pct <n>        Stop when overlap drops more than this (default: 10)",
        ].join("\n")
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }

  if (!Number.isFinite(args.maxDeviationPct) || args.maxDeviationPct <= 0) {
    console.error("--max-deviation-pct must be a positive number");
    process.exit(2);
  }

  return args;
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(value, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(process.cwd());

  const baselineStationsAbs = path.resolve(repoRoot, args.baselineStationsDir);
  const outRootAbs = path.resolve(repoRoot, args.outRoot);

  const baseConfig = await readJson<any>(path.resolve(repoRoot, "tmp/demos-gl/.sidflow.json"));

  // Snapshot baseline stations for reproducibility.
  const snapshotDir = path.join(outRootAbs, "baseline-stations");
  await ensureDir(snapshotDir);
  // Copy only manifests/index to keep it light.
  const baselineDirs = await listStationDirs(baselineStationsAbs);
  for (const d of baselineDirs) {
    const name = path.basename(d);
    const dstDir = path.join(snapshotDir, name);
    await ensureDir(dstDir);
    await fs.copyFile(path.join(d, "manifest.json"), path.join(dstDir, "manifest.json"));
  }

  const seeds = await loadBaselineSeeds(snapshotDir);
  if (seeds.length === 0) {
    throw new Error(`No baseline station seeds found under: ${snapshotDir}`);
  }

  const baselineParams = {
    introSkipSec: baseConfig.introSkipSec ?? 30,
    maxClassifySec: baseConfig.maxClassifySec ?? 15,
    maxRenderSec: baseConfig.maxRenderSec ?? 45,
    analysisSampleRate: baseConfig.analysisSampleRate ?? 11025,
  };

  const iterations: JourneyIteration[] = [
    { id: "A1", introSkipSec: 25, maxClassifySec: 12, analysisSampleRate: baselineParams.analysisSampleRate },
    { id: "A2", introSkipSec: 20, maxClassifySec: 10, analysisSampleRate: baselineParams.analysisSampleRate },
    { id: "A3", introSkipSec: 15, maxClassifySec: 8, analysisSampleRate: baselineParams.analysisSampleRate },
    { id: "B1", introSkipSec: 15, maxClassifySec: 8, analysisSampleRate: 8000 },
    { id: "B2", introSkipSec: 15, maxClassifySec: 8, analysisSampleRate: 5512 },
  ];

  const results: Array<{
    id: string;
    introSkipSec: number;
    maxClassifySec: number;
    maxRenderSec: number;
    analysisSampleRate: number;
    classifyElapsedMs: number;
    stationMeanJaccard: number;
    stationMinJaccard: number;
    stationMeanRecall: number;
    stationMinRecall: number;
    ok: boolean;
    jsonlPath: string;
    stationsDir: string;
  }> = [];

  const stopThreshold = 1 - args.maxDeviationPct / 100;

  for (const it of iterations) {
    const maxRenderSec = computeMinRenderSec(it.introSkipSec, it.maxClassifySec);

    const variantDir = path.join(outRootAbs, `run-${it.id}`);
    const configPath = path.join(variantDir, "sidflow.json");
    const audioCachePath = path.join(variantDir, "audio-cache");
    const tagsPath = path.join(variantDir, "tags");
    const classifiedPath = path.join(variantDir, "classified");
    const stationsOut = path.join(variantDir, "stations");

    const variantConfig = {
      ...baseConfig,
      audioCachePath,
      tagsPath,
      classifiedPath,
      introSkipSec: it.introSkipSec,
      maxClassifySec: it.maxClassifySec,
      maxRenderSec,
      analysisSampleRate: it.analysisSampleRate,
    };

    await writeJson(configPath, variantConfig);

    console.log(`\n=== Iteration ${it.id} ===`);
    console.log(
      JSON.stringify(
        {
          introSkipSec: it.introSkipSec,
          maxClassifySec: it.maxClassifySec,
          maxRenderSec,
          analysisSampleRate: it.analysisSampleRate,
        },
        null,
        2
      )
    );

    const classify = await runCommand(
      path.join(repoRoot, "scripts", "sidflow-classify"),
      [
        "--config",
        configPath,
        "--sid-path-prefix",
        args.sidPathPrefix,
        "--force-rebuild",
      ],
      { cwd: repoRoot, label: `classify-${it.id}` }
    );

    if (classify.exitCode !== 0) {
      throw new Error(`Classification failed for ${it.id} with exit code ${classify.exitCode}`);
    }

    const jsonlPath = await newestJsonlIn(classifiedPath);

    // Build stations: one per baseline seed key.
    await fs.rm(stationsOut, { recursive: true, force: true });
    await ensureDir(stationsOut);

    for (const s of seeds) {
      const outDir = path.join(stationsOut, s.seedKey.replace(/[^a-zA-Z0-9._:-]+/g, "-"));
      await ensureDir(outDir);
      const build = await runCommand(
        "node",
        [
          path.join(repoRoot, "scripts", "build-stations-from-jsonl.mjs"),
          "--jsonl",
          jsonlPath,
          "--wav-cache",
          audioCachePath,
          "--out",
          outDir,
          "--stations",
          "1",
          "--size",
          "20",
          "--seed",
          "42",
          "--seed-key",
          s.seedKey,
          "--seed-mode",
          "extremes",
        ],
        { cwd: repoRoot, label: `stations-${it.id}` }
      );
      if (build.exitCode !== 0) {
        throw new Error(`Station build failed for seed ${s.seedKey} in ${it.id}`);
      }
    }

    // Compare overlap using helper script.
    const compareOut = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const child = spawn(
        "bun",
        [
          path.join(repoRoot, "scripts", "compare-stations-overlap.ts"),
          "--baseline",
          snapshotDir,
          "--candidate",
          stationsOut,
        ],
        { cwd: repoRoot, env: process.env }
      );
      child.stdout.on("data", (d) => chunks.push(Buffer.from(d)));
      child.stderr.pipe(process.stderr);
      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`compare-stations-overlap failed with exit code ${code}`));
          return;
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });

    const summary = JSON.parse(compareOut) as {
      meanJaccard: number;
      minJaccard: number;
      meanRecall: number;
      minRecall: number;
    };

    const ok = summary.meanJaccard >= stopThreshold && summary.minJaccard >= stopThreshold;

    results.push({
      id: it.id,
      introSkipSec: it.introSkipSec,
      maxClassifySec: it.maxClassifySec,
      maxRenderSec,
      analysisSampleRate: it.analysisSampleRate,
      classifyElapsedMs: classify.elapsedMs,
      stationMeanJaccard: summary.meanJaccard,
      stationMinJaccard: summary.minJaccard,
      stationMeanRecall: summary.meanRecall,
      stationMinRecall: summary.minRecall,
      ok,
      jsonlPath,
      stationsDir: stationsOut,
    });

    console.log(
      `Overlap vs baseline: meanJaccard=${summary.meanJaccard.toFixed(3)} minJaccard=${summary.minJaccard.toFixed(
        3
      )} (threshold=${stopThreshold.toFixed(3)})`
    );

    if (!ok) {
      console.log(`Stopping journey: overlap below threshold in ${it.id}`);
      break;
    }
  }

  const docPath = path.join(repoRoot, "doc", "classification-speed-journey.md");
  const lines: string[] = [];
  lines.push("# Classification speed journey (DEMOS/G-L)");
  lines.push("");
  lines.push("Goal: speed up classification by reducing `introSkipSec`, `maxClassifySec`, and `analysisSampleRate`, stopping when station overlap vs baseline drops by more than 10% (mean/min Jaccard < 0.90).\n");
  lines.push("## Baseline");
  lines.push(`- Baseline stations: ${path.relative(repoRoot, snapshotDir)}`);
  lines.push(`- Baseline config source: tmp/demos-gl/.sidflow.json`);
  lines.push(`- Baseline params: introSkipSec=${baselineParams.introSkipSec}, maxClassifySec=${baselineParams.maxClassifySec}, maxRenderSec=${baselineParams.maxRenderSec}, analysisSampleRate=${baselineParams.analysisSampleRate}`);
  lines.push("");
  lines.push("## Iterations");
  lines.push("| id | introSkipSec | maxClassifySec | maxRenderSec | analysisSampleRate | classify time (s) | mean Jaccard | min Jaccard | mean recall | min recall | status |");
  lines.push("|---:|------------:|--------------:|------------:|-----------------:|-----------------:|------------:|-----------:|-----------:|----------:|:------|");
  for (const r of results) {
    const secs = (r.classifyElapsedMs / 1000).toFixed(1);
    lines.push(
      `| ${r.id} | ${r.introSkipSec} | ${r.maxClassifySec} | ${r.maxRenderSec} | ${r.analysisSampleRate} | ${secs} | ${r.stationMeanJaccard.toFixed(
        3
      )} | ${r.stationMinJaccard.toFixed(3)} | ${r.stationMeanRecall.toFixed(3)} | ${r.stationMinRecall.toFixed(
        3
      )} | ${r.ok ? "OK" : "STOP"} |`
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- Station overlap is computed by seed-key matching and membership Jaccard similarity (seed + neighbors).");
  lines.push("- This is a *relative* metric against the captured baseline station manifests; it is intentionally conservative.");
  lines.push("");

  await fs.writeFile(docPath, lines.join("\n"));
  console.log(`\nWrote journey report: ${path.relative(repoRoot, docPath)}`);
}

await main();
