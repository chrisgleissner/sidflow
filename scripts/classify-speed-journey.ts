#!/usr/bin/env bun
/**
 * Classification speed journey runner (DEMO/G-L)
 *
 * Produces a series of classification runs with progressively "faster" settings,
 * rebuilds stations from the run JSONL using a fixed seed list, and compares
 * station membership overlap against the baseline stations.
 */

import { parseArgs } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig, resetConfigCache, stringifyDeterministic } from "../packages/sidflow-common/src/index.js";
import {
  destroyFeatureExtractionPool,
  disposeModel,
  generateAutoTags,
  type AudioCacheProgress,
  type AutoTagProgress,
  type ClassificationPlan,
  type ThreadActivityUpdate,
} from "../packages/sidflow-classify/src/index.js";

const DEFAULT_BASE_CONFIG = "tmp/demos-gl/.sidflow.json";
const DEFAULT_BASELINE_STATIONS = "tmp/demos-gl/stations";
const DEFAULT_OUT_DIR = "tmp/demos-gl/journey";
const DEFAULT_DOC_PATH = "doc/perf/classification-speed-journey-demos-gl.md";
const DEFAULT_SID_PATH_PREFIX = "C64Music/DEMOS/G-L";
const DEFAULT_REPEATS = 2;

type StationManifest = {
  seed?: { key?: string; sid_path?: string; song_index?: number | null };
  tracks?: Array<{ sid_path?: string; song_index?: number | null }>;
};

function createJourneyProgressLogger() {
  const lastByThread = new Map<number, string>();
  let lastSummaryAt = 0;

  const summarizeAudioCache = (progress: AudioCacheProgress): string => {
    const percent = progress.percentComplete.toFixed(1);
    if (progress.phase === "analyzing") {
      return `[Analyzing] ${progress.processedFiles}/${progress.totalFiles} (${percent}%)`;
    }
    const remaining = progress.totalFiles - progress.processedFiles;
    const file = progress.currentFile ? ` - ${progress.currentFile}` : "";
    return `[Converting] ${progress.renderedFiles} rendered, ${progress.skippedFiles} cached, ${remaining} remaining (${percent}%)${file}`;
  };

  const summarizeAutoTag = (progress: AutoTagProgress): string => {
    const percent = progress.percentComplete.toFixed(1);
    const file = progress.currentFile ? ` - ${progress.currentFile}` : "";
    return `[${progress.phase}] ${progress.processedFiles}/${progress.totalFiles} (${percent}%)${file}`;
  };

  const onThreadUpdate = (update: ThreadActivityUpdate): void => {
    if (update.status !== "working" || !update.file) return;
    const key = `${update.phase}|${update.file}`;
    const prev = lastByThread.get(update.threadId);
    if (prev === key) return;
    lastByThread.set(update.threadId, key);
    // Newline log so it remains visible even with other stdout chatter.
    // This is the "which song are we on" signal.
    // Example: [T2 building] C64Music/DEMOS/G-L/Foo.sid
    process.stdout.write(`[T${update.threadId} ${update.phase}] ${update.file}\n`);
  };

  const onAudioCacheProgress = (progress: AudioCacheProgress): void => {
    const now = Date.now();
    if (now - lastSummaryAt < 1000 && progress.processedFiles < progress.totalFiles) return;
    lastSummaryAt = now;
    process.stdout.write(`${summarizeAudioCache(progress)}\n`);
  };

  const onAutoTagProgress = (progress: AutoTagProgress): void => {
    const now = Date.now();
    if (now - lastSummaryAt < 1000 && progress.processedFiles < progress.totalFiles) return;
    lastSummaryAt = now;
    process.stdout.write(`${summarizeAutoTag(progress)}\n`);
  };

  return { onThreadUpdate, onAudioCacheProgress, onAutoTagProgress };
}

async function spawnAndWait(cmd: string, args: string[], cwd = process.cwd()): Promise<void> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit"
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${cmd} ${args.join(" ")}`);
  }
}

async function readStationKeyAndSet(stationDir: string): Promise<{ seedKey: string; members: Set<string> }> {
  const manifestPath = path.join(stationDir, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as StationManifest;

  const seedKey = parsed.seed?.key;
  if (!seedKey) {
    throw new Error(`Missing seed.key in manifest: ${manifestPath}`);
  }

  const tracks = parsed.tracks ?? [];
  const members = new Set<string>();

  // Include the seed itself in the membership set.
  if (parsed.seed?.sid_path) {
    const idx = parsed.seed.song_index;
    members.add(idx !== null && idx !== undefined ? `${parsed.seed.sid_path}:${idx}` : parsed.seed.sid_path);
  }

  for (const t of tracks) {
    if (!t?.sid_path) continue;
    const idx = t.song_index;
    members.add(idx !== null && idx !== undefined ? `${t.sid_path}:${idx}` : t.sid_path);
  }
  if (members.size <= 0) {
    throw new Error(`No tracks in manifest: ${manifestPath}`);
  }

  return { seedKey, members };
}

async function readStationsMap(stationsDir: string): Promise<Map<string, Set<string>>> {
  const entries = (await readdir(stationsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => n.startsWith("station-"))
    .sort((a, b) => a.localeCompare(b));

  const map = new Map<string, Set<string>>();
  for (const name of entries) {
    const { seedKey, members } = await readStationKeyAndSet(path.join(stationsDir, name));
    map.set(seedKey, members);
  }
  return map;
}

function mean(xs: number[]): number {
  if (xs.length <= 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function overlapRatio(baseline: Set<string>, run: Set<string>): number {
  let intersection = 0;
  for (const k of baseline) {
    if (run.has(k)) intersection += 1;
  }
  return intersection / baseline.size;
}

function jaccardRatio(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  let union = a.size;
  for (const v of a) {
    if (b.has(v)) intersection += 1;
  }
  for (const v of b) {
    if (!a.has(v)) union += 1;
  }
  return union > 0 ? intersection / union : 0;
}

async function ensureSeedListFile(baselineStationsDir: string, outDir: string): Promise<string> {
  const seedFile = path.join(outDir, "baseline-seeds.txt");
  const baseline = await readStationsMap(baselineStationsDir);
  const seeds = [...baseline.keys()].sort((a, b) => a.localeCompare(b));
  await writeFile(seedFile, `${seeds.join("\n")}\n`);
  return seedFile;
}

async function appendResultRow(docPath: string, row: string): Promise<void> {
  const content = await readFile(docPath, "utf8");
  if (!content.includes("| Run | introSkipSec")) {
    throw new Error(`Doc does not look like expected template: ${docPath}`);
  }
  await writeFile(docPath, `${content.trimEnd()}\n${row}\n`);
}

type JourneyRunParams = {
  id: string;
  introSkipSec: number;
  maxClassifySec: number;
  analysisSampleRate: number;
};

function resolveBaselineParams(baseRaw: Record<string, unknown>): Omit<JourneyRunParams, "id"> {
  const introSkipSec = typeof baseRaw.introSkipSec === "number" ? baseRaw.introSkipSec : 30;
  const maxClassifySec = typeof baseRaw.maxClassifySec === "number" ? baseRaw.maxClassifySec : 15;
  const analysisSampleRate = typeof baseRaw.analysisSampleRate === "number" ? baseRaw.analysisSampleRate : 11025;
  return {
    introSkipSec,
    maxClassifySec,
    analysisSampleRate,
  };
}

function buildRunMatrix(baseline: Omit<JourneyRunParams, "id">, includeRender: boolean): JourneyRunParams[] {
  // Keep this small and deterministic; the goal is to find the fastest settings
  // that stay within the station-deviation budget.
  //
  // IMPORTANT: introSkipSec affects WAV post-processing (slicing) and therefore
  // requires re-rendering to take effect. With the current WAV cache strategy,
  // maxClassifySec is also part of the cached excerpt identity. When includeRender
  // is false, we therefore keep BOTH introSkipSec and maxClassifySec constant so
  // we don't accidentally trigger expensive re-renders (and we isolate pure
  // extraction cost, e.g. analysisSampleRate).

  if (!includeRender) {
    return [
      { id: "baseline", ...baseline },
      // Try closest-to-baseline first so the stop-on-deviation rule is meaningful.
      // (Once we cross the 0.90 overlap budget, lower sample rates are unlikely to recover.)
      { id: "r1", introSkipSec: baseline.introSkipSec, maxClassifySec: baseline.maxClassifySec, analysisSampleRate: 10000 },
      { id: "r2", introSkipSec: baseline.introSkipSec, maxClassifySec: baseline.maxClassifySec, analysisSampleRate: 9000 },
      { id: "r3", introSkipSec: baseline.introSkipSec, maxClassifySec: baseline.maxClassifySec, analysisSampleRate: 8000 },
      { id: "r4", introSkipSec: baseline.introSkipSec, maxClassifySec: baseline.maxClassifySec, analysisSampleRate: 5512 },
    ];
  }

  const skipMinus5 = Math.max(0, baseline.introSkipSec - 5);
  const skipMinus10 = Math.max(0, baseline.introSkipSec - 10);
  const classifyMinus3 = Math.max(5, baseline.maxClassifySec - 3);
  const classifyMinus5 = Math.max(5, baseline.maxClassifySec - 5);

  return [
    { id: "baseline", ...baseline },
    { id: "r1", introSkipSec: skipMinus5, maxClassifySec: baseline.maxClassifySec, analysisSampleRate: baseline.analysisSampleRate },
    { id: "r2", introSkipSec: skipMinus5, maxClassifySec: classifyMinus3, analysisSampleRate: baseline.analysisSampleRate },
    { id: "r3", introSkipSec: skipMinus10, maxClassifySec: classifyMinus5, analysisSampleRate: baseline.analysisSampleRate },
    { id: "r4", introSkipSec: skipMinus10, maxClassifySec: classifyMinus5, analysisSampleRate: 8000 },
  ];
}

type OverlapSummary = {
  meanJaccard: number;
  minJaccard: number;
  meanRecall: number;
  minRecall: number;
};

function computeOverlap(baselineMap: Map<string, Set<string>>, runMap: Map<string, Set<string>>): OverlapSummary {
  const recalls: number[] = [];
  const jaccards: number[] = [];

  for (const [seedKey, baselineMembers] of baselineMap.entries()) {
    const runMembers = runMap.get(seedKey);
    if (!runMembers) {
      recalls.push(0);
      jaccards.push(0);
      continue;
    }
    recalls.push(overlapRatio(baselineMembers, runMembers));
    jaccards.push(jaccardRatio(baselineMembers, runMembers));
  }

  return {
    meanRecall: mean(recalls),
    minRecall: recalls.length ? Math.min(...recalls) : 0,
    meanJaccard: mean(jaccards),
    minJaccard: jaccards.length ? Math.min(...jaccards) : 0,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: DEFAULT_BASE_CONFIG },
      "baseline-stations": { type: "string", default: DEFAULT_BASELINE_STATIONS },
      out: { type: "string", default: DEFAULT_OUT_DIR },
      doc: { type: "string", default: DEFAULT_DOC_PATH },
      "sid-path-prefix": { type: "string", default: DEFAULT_SID_PATH_PREFIX },
      "include-render": { type: "boolean", default: false },
      repeats: { type: "string", default: String(DEFAULT_REPEATS) },
      "timeout-sec": { type: "string", default: "0" },
      help: { type: "boolean", default: false }
    },
    strict: true,
    allowPositionals: false
  });

  if (values.help) {
    console.log(
      `Usage: bun run scripts/classify-speed-journey.ts [--config <path>] [--baseline-stations <dir>] [--out <dir>] [--doc <path>] [--sid-path-prefix <prefix>] [--include-render] [--repeats <n>]\n`
    );
    process.exit(0);
  }

  const baseConfigPath = values.config!;
  const baselineStationsDir = values["baseline-stations"]!;
  const outDir = values.out!;
  const docPath = values.doc!;
  const sidPathPrefix = values["sid-path-prefix"]!;
  const includeRender = values["include-render"]!;
  const repeats = Math.max(1, Number(values.repeats ?? DEFAULT_REPEATS));
  const timeoutSec = Math.max(0, Number(values["timeout-sec"] ?? 0));

  await mkdir(outDir, { recursive: true });
  const seedFile = await ensureSeedListFile(baselineStationsDir, outDir);

  const baseRaw = JSON.parse(await readFile(baseConfigPath, "utf8")) as Record<string, unknown>;

  const baselineParams = resolveBaselineParams(baseRaw);
  const runs = buildRunMatrix(baselineParams, includeRender);

  // NOTE: We deliberately keep the baseline "known good" stations from the sandbox.
  // If the sandbox baseline was built under different settings than --config,
  // overlaps will be low. In that case, rebuild baseline stations to match the
  // config or use the separate scripts/classification-speed-journey.ts runner.
  let baselineMap = await readStationsMap(baselineStationsDir);

  const journeyLogger = createJourneyProgressLogger();

  const stopThreshold = 0.9;

  // If the configured baseline does not match the existing stations, we will
  // automatically switch to a captured baseline reference built from the
  // current config (so optimization iterations are comparable).
  let baselineReferenceDir: string | null = null;

  try {
    for (const run of runs) {
      for (let attempt = 1; attempt <= repeats; attempt++) {
      const runId = repeats > 1 ? `${run.id}.${attempt}` : run.id;
      const runDir = path.join(outDir, runId);
      const runStationsDir = path.join(runDir, "stations");

      await mkdir(runDir, { recursive: true });

      const maxRenderSec = Math.max(1, Math.ceil(run.introSkipSec + run.maxClassifySec));

      const runAudioCachePath = includeRender
        ? `./${path.posix.join(path.relative(process.cwd(), runDir), "audio-cache")}`
        : (baseRaw.audioCachePath as string);
      const runTagsPath = `./${path.posix.join(path.relative(process.cwd(), runDir), "tags")}`;
      const runClassifiedPath = `./${path.posix.join(path.relative(process.cwd(), runDir), "classified")}`;
      const runRendersPath = `./${path.posix.join(path.relative(process.cwd(), runDir), "renders")}`;
      const runAvailabilityPath = `./${path.posix.join(path.relative(process.cwd(), runDir), "availability", "streams.json")}`;

    const runConfigRaw = {
      ...baseRaw,
      introSkipSec: run.introSkipSec,
      maxClassifySec: run.maxClassifySec,
      analysisSampleRate: run.analysisSampleRate,
      maxRenderSec,
      audioCachePath: runAudioCachePath,
      tagsPath: runTagsPath,
      classifiedPath: runClassifiedPath,
      availability: {
        assetRoot: runRendersPath,
        manifestPath: runAvailabilityPath
      },
      render: {
        ...(baseRaw.render as Record<string, unknown>),
        outputPath: runRendersPath
      }
    };

      await mkdir(path.resolve(runAudioCachePath), { recursive: true });
      await mkdir(path.resolve(runTagsPath), { recursive: true });
      await mkdir(path.resolve(runClassifiedPath), { recursive: true });

      const runConfigPath = path.join(runDir, ".sidflow.json");
      await writeFile(runConfigPath, stringifyDeterministic(runConfigRaw) + "\n");

    // Ensure worker threads read the correct config per run.
      process.env.SIDFLOW_CONFIG = runConfigPath;
      resetConfigCache();

      const config = await loadConfig(runConfigPath);

      const plan: ClassificationPlan = {
        config,
        audioCachePath: config.audioCachePath,
        tagsPath: config.tagsPath,
        forceRebuild: includeRender,
        classificationDepth: config.classificationDepth ?? 3,
        sidPath: config.sidPath,
      };

      const start = performance.now();
      const watchdog = timeoutSec > 0
        ? setTimeout(() => {
            // Hard-kill safeguard: if something stalls (worker pool / native code),
            // exit with a non-zero code so callers don't hang indefinitely.
            console.error(`Timeout exceeded (${timeoutSec}s) for run ${runId}; exiting.`);
            // eslint-disable-next-line no-process-exit
            process.exit(124);
          }, timeoutSec * 1000)
        : null;
      if (watchdog && typeof (watchdog as unknown as { unref?: () => void }).unref === "function") {
        (watchdog as unknown as { unref: () => void }).unref();
      }
      try {
        const result = await generateAutoTags(plan, {
          threads: config.threads,
          sidPathPrefix,
          onProgress: journeyLogger.onAutoTagProgress,
          onThreadUpdate: journeyLogger.onThreadUpdate,
        });
        const elapsedSec = (performance.now() - start) / 1000;

      // Build stations for this run using baseline seeds.
      await mkdir(runStationsDir, { recursive: true });
      await spawnAndWait("bun", [
        "scripts/build-stations-from-jsonl.mjs",
        "--jsonl",
        result.jsonlFile,
        "--wav-cache",
        config.audioCachePath,
        "--out",
        runStationsDir,
        "--stations",
        String(baselineMap.size),
        "--size",
        "20",
        "--seed",
        "42",
        "--seed-keys-file",
        seedFile,
        "--seed-mode",
        "extremes"
      ]);

      const runMap = await readStationsMap(runStationsDir);
      let summary = computeOverlap(baselineMap, runMap);

      let suppressStopForThisAttempt = false;

      // Baseline sanity: if the "baseline" run with the current config does not
      // overlap with the existing baseline stations, switch baseline reference
      // to a captured baseline for this journey so subsequent optimization steps
      // are comparable.
      if (run.id === "baseline" && attempt === 1 && (summary.meanJaccard < stopThreshold || summary.minJaccard < stopThreshold)) {
        baselineReferenceDir = path.join(outDir, "baseline-reference");
        await mkdir(baselineReferenceDir, { recursive: true });
        // Copy only manifests into the baseline reference dir.
        const stationDirs = (await readdir(runStationsDir, { withFileTypes: true }))
          .filter((d) => d.isDirectory() && d.name.startsWith("station-"))
          .map((d) => d.name);
        for (const name of stationDirs) {
          const src = path.join(runStationsDir, name, "manifest.json");
          const dstDir = path.join(baselineReferenceDir, name);
          await mkdir(dstDir, { recursive: true });
          await Bun.write(path.join(dstDir, "manifest.json"), await Bun.file(src).text());
        }
        baselineMap = await readStationsMap(baselineReferenceDir);

        // After switching the baseline reference, re-compute overlap so the
        // baseline row reflects the new reference (should be 100%), and don't
        // stop the journey on this first calibration step.
        summary = computeOverlap(baselineMap, runMap);
        suppressStopForThisAttempt = true;
      }

    // Write result row.
      const row = `| ${runId} | ${run.introSkipSec} | ${run.maxClassifySec} | ${run.analysisSampleRate} | ${maxRenderSec} | ${includeRender} | ${elapsedSec.toFixed(
        2
      )} | ${(summary.meanJaccard * 100).toFixed(1)} | ${(summary.minJaccard * 100).toFixed(1)} | ${(summary.meanRecall * 100).toFixed(
        1
      )} | ${(summary.minRecall * 100).toFixed(1)} |`;

      console.log(row);
      await appendResultRow(docPath, row);

      const effectiveThreshold = stopThreshold;
      if (!suppressStopForThisAttempt && (summary.meanJaccard < effectiveThreshold || summary.minJaccard < effectiveThreshold)) {
        console.log(
          `Stopping: station overlap below threshold (meanJaccard=${summary.meanJaccard.toFixed(3)} minJaccard=${summary.minJaccard.toFixed(
            3
          )} < ${effectiveThreshold.toFixed(3)})`
        );
        // Stop the whole journey on the first failing attempt.
        return;
      }
      } finally {
        if (watchdog) {
          clearTimeout(watchdog);
        }
      }
    }
  }
  } finally {
    // Ensure the process can exit cleanly even if we stop early.
    try {
      await destroyFeatureExtractionPool();
    } catch {
      // ignore cleanup errors
    }
    try {
      disposeModel();
    } catch {
      // ignore cleanup errors
    }
  }
}

await main();
