#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { Database } from "bun:sqlite";

import {
  PERSONA_IDS,
  formatHelp,
  handleParseResult,
  loadConfig,
  parseArgs,
  pathExists,
  scoreTrackForPersona,
  type ArgDef,
  type PersonaId,
  type PersonaMetrics,
  type SidFileMetadata,
} from "../packages/sidflow-common/src/index.js";
import {
  buildStationQueue,
  openStationSimilarityDataset,
  type StationRuntime,
  type StationTrackDetails,
} from "../packages/sidflow-play/src/station/index.js";

type ConvergenceCliOptions = {
  config?: string;
  outputRoot?: string;
  profile?: string;
  corpusVersion?: string;
  maxSongs?: number;
  fullRerun?: boolean;
  skipLocalExport?: boolean;
  localSqlite?: string;
  localLite?: string;
  localTiny?: string;
  releaseRepo?: string;
  stationSize?: number;
  seedCount?: number;
  strictOverlap?: boolean;
};

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubRelease = {
  tag_name?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
};

type ExportTrackRow = {
  track_id: string;
  sid_path: string;
  song_index: number;
  e: number;
  m: number;
  c: number;
  p: number | null;
};

type PersonaSeed = {
  trackId: string;
  sidPath: string;
  score: number;
  rating: number;
};

type PersonaComparison = {
  personaId: PersonaId;
  overlapRatio: number;
  sharedTrackCount: number;
  comparedTrackCount: number;
  rankCorrelation: number;
  styleDistributionSimilarity: number;
  maxStyleDistributionDelta: number;
  seeds: PersonaSeed[];
  fullTrackIds: string[];
  tinyTrackIds: string[];
};

const ARG_DEFS: ArgDef[] = [
  { name: "--config", type: "string", description: "Load an alternate .sidflow.json" },
  { name: "--output-root", type: "string", description: "Artifact root", defaultValue: "tmp/similarity-convergence" },
  { name: "--profile", type: "string", description: "Export profile: full or mobile", defaultValue: "full" },
  { name: "--corpus-version", type: "string", description: "Corpus label embedded in export filenames", defaultValue: "hvsc" },
  { name: "--max-songs", type: "integer", description: "Optional partial local-export limit for validation" },
  { name: "--full-rerun", type: "boolean", description: "Pass --full-rerun through to the local export wrapper", defaultValue: false },
  { name: "--skip-local-export", type: "boolean", description: "Reuse existing local sqlite/lite/tiny outputs instead of invoking the wrapper", defaultValue: false },
  { name: "--local-sqlite", type: "string", description: "Override local full sidcorr-1 SQLite path" },
  { name: "--local-lite", type: "string", description: "Override local sidcorr-lite-1 bundle path" },
  { name: "--local-tiny", type: "string", description: "Override local sidcorr-tiny-1 bundle path" },
  { name: "--release-repo", type: "string", description: "GitHub release source repo", defaultValue: "chrisgleissner/sidflow-data" },
  { name: "--station-size", type: "integer", description: "Tracks per persona station", defaultValue: 50 },
  { name: "--seed-count", type: "integer", description: "Rated seed tracks per persona", defaultValue: 5 },
  { name: "--strict-overlap", type: "boolean", description: "Exit nonzero when any persona falls below the overlap threshold", defaultValue: false },
];

const HELP_TEXT = formatHelp(
  "bun run validate:similarity-convergence -- [options]",
  "Run the sidcorr convergence workflow: local full export, release-based lite derivation, release asset verification, and full-vs-tiny persona-station comparison.",
  ARG_DEFS,
  [
    "bun run validate:similarity-convergence -- --max-songs 200",
    "bun run validate:similarity-convergence -- --skip-local-export --local-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite --local-lite data/exports/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr --local-tiny data/exports/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr",
    "bun run validate:similarity-convergence -- --skip-local-export --strict-overlap",
  ],
);

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function deriveMetricsFromRatings(row: Pick<ExportTrackRow, "e" | "m" | "c">): PersonaMetrics {
  const energy = (row.e - 1) / 4;
  const mood = (row.m - 1) / 4;
  const complexity = (row.c - 1) / 4;
  return {
    rhythmicDensity: Math.max(0, Math.min(1, energy)),
    melodicComplexity: Math.max(0, Math.min(1, (mood + complexity) / 2)),
    timbralRichness: Math.max(0, Math.min(1, complexity * 0.7 + energy * 0.3)),
    nostalgiaBias: Math.max(0, Math.min(1, mood * 0.6 + (1 - energy) * 0.4)),
    experimentalTolerance: Math.max(0, Math.min(1, complexity * 0.6 + (1 - mood) * 0.4)),
  };
}

function buildRuntime(seed: number, cwd: string): StationRuntime {
  return {
    loadConfig: async () => ({
      sidPath: cwd,
      audioCachePath: cwd,
      tagsPath: cwd,
      classifiedPath: cwd,
      sidplayPath: "/usr/bin/sidplayfp",
      threads: 1,
      classificationDepth: 1,
    }),
    parseSidFile: async (filePath: string): Promise<SidFileMetadata> => ({
      type: "PSID",
      version: 2,
      title: path.basename(filePath),
      author: "Convergence Validation",
      released: "1991 Validation",
      songs: 1,
      startSong: 1,
      clock: "PAL",
      sidModel1: "MOS6581",
      loadAddress: 0,
      initAddress: 0,
      playAddress: 0,
    }),
    lookupSongDurationMs: async () => 120_000,
    fetchImpl: globalThis.fetch,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    cwd: () => cwd,
    now: () => new Date("2026-04-08T07:30:00.000Z"),
    random: createDeterministicRandom(seed),
    onSignal: () => undefined,
    offSignal: () => undefined,
  };
}

function sha256Buffer(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await readFile(filePath));
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function runLoggedCommand(
  command: string,
  args: string[],
  cwd: string,
  logPath: string,
): Promise<void> {
  await ensureDir(path.dirname(logPath));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("exit", async (code) => {
      const payload = Buffer.concat(chunks);
      await writeFile(logPath, payload);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit ${code ?? "unknown"}. See ${logPath}`));
    });
  });
}

async function fetchLatestRelease(repo: string): Promise<GitHubRelease> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "sidflow-similarity-convergence",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch latest release for ${repo}: HTTP ${response.status}`);
  }
  return await response.json() as GitHubRelease;
}

function requireReleaseAsset(release: GitHubRelease, matcher: (asset: ReleaseAsset) => boolean, description: string): ReleaseAsset {
  const asset = (release.assets ?? []).find((candidate) => matcher(candidate));
  if (!asset?.name || !asset.browser_download_url) {
    throw new Error(`Latest release ${release.tag_name ?? "unknown"} is missing ${description}`);
  }
  return asset;
}

function findReleaseAsset(release: GitHubRelease, matcher: (asset: ReleaseAsset) => boolean): ReleaseAsset | undefined {
  return (release.assets ?? []).find((candidate) => matcher(candidate) && !!candidate.name && !!candidate.browser_download_url);
}

async function downloadAsset(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "sidflow-similarity-convergence",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await ensureDir(path.dirname(destinationPath));
  await writeFile(destinationPath, Buffer.from(await response.arrayBuffer()));
}

function readTracksFromSqlite(dbPath: string): ExportTrackRow[] {
  const database = new Database(dbPath, { readonly: true, strict: true });
  try {
    return database.query(`
      SELECT track_id, sid_path, song_index, e, m, c, p
      FROM tracks
      ORDER BY sid_path ASC, song_index ASC
    `).all() as ExportTrackRow[];
  } finally {
    database.close();
  }
}

function sqliteHasPrecomputedFullNeighbors(dbPath: string): boolean {
  const database = new Database(dbPath, { readonly: true, strict: true });
  try {
    const row = database.query(`
      SELECT COUNT(*) AS count
      FROM neighbors
      WHERE profile = 'full'
    `).get() as { count: number } | null;
    return (row?.count ?? 0) > 0;
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("no such table")) {
      return false;
    }
    throw error;
  } finally {
    database.close();
  }
}

function selectPersonaSeeds(rows: ExportTrackRow[], personaId: PersonaId, seedCount: number): PersonaSeed[] {
  const scored = rows.map((row) => ({
    row,
    score: scoreTrackForPersona({
      metrics: deriveMetricsFromRatings(row),
      ratings: { e: row.e, m: row.m, c: row.c },
    }, personaId).score,
  }));

  scored.sort((left, right) => right.score - left.score || left.row.track_id.localeCompare(right.row.track_id));

  const ratingsPattern = [5, 5, 4, 4, 4, 3, 3, 3];
  return scored.slice(0, seedCount).map(({ row, score }, index) => ({
    trackId: row.track_id,
    sidPath: row.sid_path,
    score,
    rating: ratingsPattern[index] ?? 3,
  }));
}

function buildRatingsMap(seeds: PersonaSeed[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const seed of seeds) {
    result.set(seed.trackId, seed.rating);
  }
  return result;
}

function overlapRatio(left: string[], right: string[]): { ratio: number; shared: number; compared: number } {
  const compared = Math.min(left.length, right.length);
  const leftSet = new Set(left.slice(0, compared));
  const shared = right.slice(0, compared).filter((trackId) => leftSet.has(trackId)).length;
  return {
    ratio: compared === 0 ? 0 : shared / compared,
    shared,
    compared,
  };
}

function spearmanRankCorrelation(left: string[], right: string[]): number {
  const leftRanks = new Map(left.map((trackId, index) => [trackId, index + 1]));
  const rightRanks = new Map(right.map((trackId, index) => [trackId, index + 1]));
  const common = [...leftRanks.keys()].filter((trackId) => rightRanks.has(trackId));
  if (common.length < 2) {
    return 0;
  }
  const sumSquared = common.reduce((total, trackId) => {
    const delta = leftRanks.get(trackId)! - rightRanks.get(trackId)!;
    return total + (delta * delta);
  }, 0);
  const count = common.length;
  return 1 - ((6 * sumSquared) / (count * ((count * count) - 1)));
}

function styleDistribution(
  handle: Awaited<ReturnType<typeof openStationSimilarityDataset>>,
  queue: StationTrackDetails[],
): number[] {
  const counts = new Array(PERSONA_IDS.length).fill(0);
  for (const track of queue) {
    const mask = handle.getStyleMask(track.track_id) ?? 0;
    for (let bit = 0; bit < PERSONA_IDS.length; bit += 1) {
      if ((mask & (1 << bit)) !== 0) {
        counts[bit] += 1;
      }
    }
  }
  return counts.map((count) => count / Math.max(1, queue.length));
}

function styleDistributionSimilarity(left: number[], right: number[]): { similarity: number; maxDelta: number } {
  let totalDelta = 0;
  let maxDelta = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = Math.abs((left[index] ?? 0) - (right[index] ?? 0));
    totalDelta += delta;
    maxDelta = Math.max(maxDelta, delta);
  }
  const meanDelta = totalDelta / Math.max(1, Math.max(left.length, right.length));
  return {
    similarity: 1 - meanDelta,
    maxDelta,
  };
}

function renderMarkdownReport(
  comparisons: PersonaComparison[],
  releaseTag: string,
  outputRoot: string,
): string {
  const failingComparisons = comparisons.filter((comparison) => comparison.overlapRatio < 0.8);
  const lines = [
    "# Similarity Convergence Report",
    "",
    `- Release tag checked: ${releaseTag}`,
    `- Artifact root: ${outputRoot}`,
    `- Overlap threshold: 0.80`,
    "",
    "## Threshold Summary",
    "",
    failingComparisons.length === 0
      ? "- All personas met the overlap threshold."
      : `- Personas below threshold: ${failingComparisons.map((comparison) => `${comparison.personaId} (${comparison.overlapRatio.toFixed(4)})`).join(", ")}`,
    "",
    "## Persona Results",
    "",
  ];

  for (const comparison of comparisons) {
    lines.push(`### ${comparison.personaId}`);
    lines.push(`- overlapRatio: ${comparison.overlapRatio.toFixed(4)} (${comparison.sharedTrackCount}/${comparison.comparedTrackCount})`);
    lines.push(`- rankCorrelation: ${comparison.rankCorrelation.toFixed(4)}`);
    lines.push(`- styleDistributionSimilarity: ${comparison.styleDistributionSimilarity.toFixed(4)}`);
    lines.push(`- maxStyleDistributionDelta: ${comparison.maxStyleDistributionDelta.toFixed(4)}`);
    lines.push(`- seeds: ${comparison.seeds.map((seed) => seed.trackId).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function copyArtifacts(files: string[], destinationDir: string): Promise<void> {
  await ensureDir(destinationDir);
  for (const sourcePath of files) {
    if (!(await pathExists(sourcePath))) {
      throw new Error(`Expected artifact does not exist: ${sourcePath}`);
    }
    await copyFile(sourcePath, path.join(destinationDir, path.basename(sourcePath)));
  }
}

async function writeChecksums(filePaths: string[], outputPath: string): Promise<void> {
  const lines: string[] = [];
  for (const filePath of filePaths) {
    lines.push(`${await sha256File(filePath)}  ${path.basename(filePath)}`);
  }
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const result = parseArgs<ConvergenceCliOptions>(process.argv.slice(2), ARG_DEFS);
  const exitCode = handleParseResult(result, HELP_TEXT, process.stdout, process.stderr);
  if (exitCode !== undefined) {
    process.exit(exitCode);
  }

  const { options } = result;
  const repoRoot = process.cwd();
  const config = await loadConfig(options.config);
  const outputRoot = path.resolve(repoRoot, options.outputRoot ?? "tmp/similarity-convergence");
  const logsDir = path.join(outputRoot, "logs");
  const localDir = path.join(outputRoot, "local");
  const releaseDir = path.join(outputRoot, "release");
  const radioDir = path.join(outputRoot, "radio");
  const reportDir = path.join(outputRoot, "reports");
  await ensureDir(logsDir);
  await ensureDir(localDir);
  await ensureDir(releaseDir);
  await ensureDir(radioDir);
  await ensureDir(reportDir);

  const profile = options.profile ?? "full";
  const corpusVersion = options.corpusVersion ?? "hvsc";
  const localSqlite = path.resolve(repoRoot, options.localSqlite ?? `data/exports/sidcorr-${corpusVersion}-${profile}-sidcorr-1.sqlite`);
  const localLite = path.resolve(repoRoot, options.localLite ?? `data/exports/sidcorr-${corpusVersion}-${profile}-sidcorr-lite-1.sidcorr`);
  const localTiny = path.resolve(repoRoot, options.localTiny ?? `data/exports/sidcorr-${corpusVersion}-${profile}-sidcorr-tiny-1.sidcorr`);
  const localFiles = [
    localSqlite,
    localSqlite.replace(/\.sqlite$/, ".manifest.json"),
    localLite,
    localLite.replace(/\.sidcorr$/, ".manifest.json"),
    localTiny,
    localTiny.replace(/\.sidcorr$/, ".manifest.json"),
  ];

  if (!options.skipLocalExport) {
    const args = ["scripts/run-similarity-export.sh", "--mode", "local", "--runtime", "bun", "--config", options.config ?? ".sidflow.json", "--profile", profile, "--corpus-version", corpusVersion];
    if (options.maxSongs) {
      args.push("--max-songs", String(options.maxSongs));
    }
    if (options.fullRerun) {
      args.push("--full-rerun", "true");
    }
    await runLoggedCommand("bash", args, repoRoot, path.join(logsDir, "local-export.log"));
  }

  await copyArtifacts(localFiles, localDir);

  const releaseRepo = options.releaseRepo ?? "chrisgleissner/sidflow-data";
  const latestRelease = await fetchLatestRelease(releaseRepo);
  const fullSqliteAsset = requireReleaseAsset(
    latestRelease,
    (asset) => typeof asset.name === "string" && asset.name.endsWith("-sidcorr-1.sqlite"),
    "full sidcorr-1 sqlite asset",
  );
  const liteAsset = findReleaseAsset(
    latestRelease,
    (asset) => typeof asset.name === "string" && asset.name.includes("sidcorr-lite-1") && asset.name.endsWith(".sidcorr"),
  );
  const tinyAsset = findReleaseAsset(
    latestRelease,
    (asset) => typeof asset.name === "string" && asset.name.includes("sidcorr-tiny-1") && asset.name.endsWith(".sidcorr"),
  );
  await writeFile(path.join(releaseDir, "latest-release.json"), JSON.stringify(latestRelease, null, 2), "utf8");

  const downloadedFullSqlite = path.join(releaseDir, fullSqliteAsset.name!);
  await downloadAsset(fullSqliteAsset.browser_download_url!, downloadedFullSqlite);
  const releaseLitePath = path.join(releaseDir, fullSqliteAsset.name!.replace(/-sidcorr-1\.sqlite$/, "-sidcorr-lite-1.sidcorr"));
  const releaseTinyPath = path.join(releaseDir, fullSqliteAsset.name!.replace(/-sidcorr-1\.sqlite$/, "-sidcorr-tiny-1.sidcorr"));
  const releaseHasPrecomputedNeighbors = sqliteHasPrecomputedFullNeighbors(downloadedFullSqlite);
  await runLoggedCommand(
    "bun",
    [
      "run",
      "export:similarity",
      "--",
      "--config",
      options.config ?? ".sidflow.json",
      "--format",
      "lite",
      "--source-sqlite",
      downloadedFullSqlite,
      "--profile",
      profile,
      "--corpus-version",
      corpusVersion,
      "--output",
      releaseLitePath,
    ],
    repoRoot,
    path.join(logsDir, "release-lite.log"),
  );
  if (releaseHasPrecomputedNeighbors) {
    await runLoggedCommand(
      "bun",
      [
        "run",
        "export:similarity",
        "--",
        "--config",
        options.config ?? ".sidflow.json",
        "--format",
        "tiny",
        "--source-lite",
        releaseLitePath,
        "--neighbor-source-sqlite",
        downloadedFullSqlite,
        "--profile",
        profile,
        "--corpus-version",
        corpusVersion,
        "--output",
        releaseTinyPath,
      ],
      repoRoot,
      path.join(logsDir, "release-tiny.log"),
    );
  }

  const releaseFiles = [
    downloadedFullSqlite,
    releaseLitePath,
    releaseLitePath.replace(/\.sidcorr$/, ".manifest.json"),
  ];
  if (releaseHasPrecomputedNeighbors) {
    releaseFiles.push(
      releaseTinyPath,
      releaseTinyPath.replace(/\.sidcorr$/, ".manifest.json"),
    );
  }

  const tracks = readTracksFromSqlite(localSqlite);
  const hvscRoot = path.resolve(repoRoot, config.sidPath);
  const fullHandle = await openStationSimilarityDataset(localSqlite, "sqlite", hvscRoot);
  const tinyHandle = await openStationSimilarityDataset(localTiny, "tiny", hvscRoot);
  const stationSize = options.stationSize ?? 50;
  const seedCount = options.seedCount ?? 5;
  const comparisons: PersonaComparison[] = [];

  for (let index = 0; index < PERSONA_IDS.length; index += 1) {
    const personaId = PERSONA_IDS[index]!;
    const seeds = selectPersonaSeeds(tracks, personaId, seedCount);
    const ratings = buildRatingsMap(seeds);
    const fullQueue = await buildStationQueue(
      fullHandle,
      hvscRoot,
      ratings,
      stationSize,
      5,
      15,
      buildRuntime(1000 + index, repoRoot),
      new Map(),
    );
    const tinyQueue = await buildStationQueue(
      tinyHandle,
      hvscRoot,
      ratings,
      stationSize,
      5,
      15,
      buildRuntime(1000 + index, repoRoot),
      new Map(),
    );
    const fullTrackIds = fullQueue.map((track) => track.track_id);
    const tinyTrackIds = tinyQueue.map((track) => track.track_id);
    const overlap = overlapRatio(fullTrackIds, tinyTrackIds);
    const rankCorrelation = spearmanRankCorrelation(fullTrackIds, tinyTrackIds);
    const styleSimilarity = styleDistributionSimilarity(
      styleDistribution(fullHandle, fullQueue),
      styleDistribution(tinyHandle, tinyQueue),
    );

    await writeFile(path.join(radioDir, `full-${personaId}.json`), JSON.stringify(fullQueue, null, 2), "utf8");
    await writeFile(path.join(radioDir, `tiny-${personaId}.json`), JSON.stringify(tinyQueue, null, 2), "utf8");

    comparisons.push({
      personaId,
      overlapRatio: overlap.ratio,
      sharedTrackCount: overlap.shared,
      comparedTrackCount: overlap.compared,
      rankCorrelation,
      styleDistributionSimilarity: styleSimilarity.similarity,
      maxStyleDistributionDelta: styleSimilarity.maxDelta,
      seeds,
      fullTrackIds,
      tinyTrackIds,
    });
  }

  const comparisonReport = {
    generatedAt: new Date().toISOString(),
    overlapThreshold: 0.8,
    local: {
      sqlite: localSqlite,
      lite: localLite,
      tiny: localTiny,
    },
    release: {
      repo: releaseRepo,
      tag: latestRelease.tag_name ?? "unknown",
      fullSqliteAsset: fullSqliteAsset.name,
      liteAsset: liteAsset?.name ?? null,
      tinyAsset: tinyAsset?.name ?? null,
      downloadedFullSqlite,
      hasPrecomputedFullNeighbors: releaseHasPrecomputedNeighbors,
      derivedLite: releaseLitePath,
      derivedTiny: releaseHasPrecomputedNeighbors ? releaseTinyPath : null,
      derivedTinySkippedReason: releaseHasPrecomputedNeighbors
        ? null
        : "Downloaded full release sqlite does not contain precomputed full-profile neighbors required for large sidcorr-tiny-1 generation.",
    },
    personas: comparisons,
    failingPersonas: comparisons
      .filter((comparison) => comparison.overlapRatio < 0.8)
      .map((comparison) => ({
        personaId: comparison.personaId,
        overlapRatio: comparison.overlapRatio,
        sharedTrackCount: comparison.sharedTrackCount,
        comparedTrackCount: comparison.comparedTrackCount,
        rankCorrelation: comparison.rankCorrelation,
        styleDistributionSimilarity: comparison.styleDistributionSimilarity,
        maxStyleDistributionDelta: comparison.maxStyleDistributionDelta,
      })),
    allPersonasMeetOverlapThreshold: comparisons.every((comparison) => comparison.overlapRatio >= 0.8),
  };

  const jsonReportPath = path.join(reportDir, "persona-radio-equivalence.json");
  const markdownReportPath = path.join(reportDir, "persona-radio-equivalence.md");
  await writeFile(jsonReportPath, JSON.stringify(comparisonReport, null, 2), "utf8");
  await writeFile(markdownReportPath, renderMarkdownReport(comparisons, latestRelease.tag_name ?? "unknown", outputRoot), "utf8");

  const checksumTargets = [
    ...localFiles.map((filePath) => path.join(localDir, path.basename(filePath))),
    ...releaseFiles,
    jsonReportPath,
    markdownReportPath,
    ...comparisons.flatMap((comparison) => [
      path.join(radioDir, `full-${comparison.personaId}.json`),
      path.join(radioDir, `tiny-${comparison.personaId}.json`),
    ]),
  ];
  await writeChecksums(checksumTargets, path.join(outputRoot, "SHA256SUMS"));

  await writeFile(
    path.join(reportDir, "commands.json"),
    JSON.stringify([
      {
        label: "local-export",
        command: options.skipLocalExport
          ? null
          : ["bash", "scripts/run-similarity-export.sh", "--mode", "local", "--runtime", "bun", "--config", options.config ?? ".sidflow.json", "--profile", profile, "--corpus-version", corpusVersion, ...(options.maxSongs ? ["--max-songs", String(options.maxSongs)] : []), ...(options.fullRerun ? ["--full-rerun", "true"] : [])],
      },
      {
        label: "release-lite-transform",
        command: ["bun", "run", "export:similarity", "--", "--config", options.config ?? ".sidflow.json", "--format", "lite", "--source-sqlite", downloadedFullSqlite, "--profile", profile, "--corpus-version", corpusVersion, "--output", releaseLitePath],
      },
      ...(releaseHasPrecomputedNeighbors ? [{
        label: "release-tiny-transform",
        command: ["bun", "run", "export:similarity", "--", "--config", options.config ?? ".sidflow.json", "--format", "tiny", "--source-lite", releaseLitePath, "--neighbor-source-sqlite", downloadedFullSqlite, "--profile", profile, "--corpus-version", corpusVersion, "--output", releaseTinyPath],
      }] : []),
    ], null, 2),
    "utf8",
  );

  if (options.strictOverlap && !comparisonReport.allPersonasMeetOverlapThreshold) {
    throw new Error(`One or more personas fell below the 0.80 overlap threshold. See ${jsonReportPath}`);
  }

  process.stdout.write(`${outputRoot}\n`);
}

await main();