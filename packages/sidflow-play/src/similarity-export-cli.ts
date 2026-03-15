import path from "node:path";
import process from "node:process";
import {
  buildSimilarityExport,
  formatHelp,
  handleParseResult,
  loadConfig,
  parseArgs,
  type ArgDef,
} from "@sidflow/common";

interface SimilarityExportCliOptions {
  config?: string;
  output?: string;
  profile?: string;
  corpusVersion?: string;
  neighbors?: number;
  dims?: number;
  includeVectors?: boolean;
  format?: string;
}

const ARG_DEFS: ArgDef[] = [
  {
    name: "--config",
    type: "string",
    description: "Load an alternate .sidflow.json",
  },
  {
    name: "--output",
    type: "string",
    description: "SQLite output path (default: data/exports/sidcorr-<corpus>-<profile>-sidcorr-1.sqlite)",
  },
  {
    name: "--profile",
    type: "string",
    description: "Export profile: full or mobile",
    defaultValue: "full",
  },
  {
    name: "--corpus-version",
    type: "string",
    description: "Corpus label embedded in the manifest",
  },
  {
    name: "--neighbors",
    type: "integer",
    description: "Optional precomputed neighbors per track (default: 0)",
    defaultValue: 0,
    constraints: { min: 0 },
  },
  {
    name: "--dims",
    type: "integer",
    description: "Vector dimensions to export: 3 or 4",
    defaultValue: 4,
  },
  {
    name: "--include-vectors",
    type: "boolean",
    description: "Persist rating vectors for offline centroid queries",
    defaultValue: true,
  },
  {
    name: "--format",
    type: "string",
    description: "Export format (currently sqlite only)",
    defaultValue: "sqlite",
  },
];

const HELP_TEXT = formatHelp(
  "sidflow-play export-similarity [options]",
  "Build a portable offline SID similarity bundle for consumers such as c64commander.",
  ARG_DEFS,
  [
    "sidflow-play export-similarity",
    "sidflow-play export-similarity --profile full --output data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
    "sidflow-play export-similarity --neighbors 25 --corpus-version HVSC-82",
  ],
);

function inferCorpusLabel(sidPath: string): string {
  const normalized = sidPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.endsWith("/hvsc") || normalized === "hvsc") {
    return "hvsc";
  }
  return path.basename(normalized) || "custom";
}

function defaultOutputPath(corpusLabel: string, profile: "full" | "mobile"): string {
  return path.join("data", "exports", `sidcorr-${corpusLabel}-${profile}-sidcorr-1.sqlite`);
}

export async function runSimilarityExportCli(argv: string[]): Promise<number> {
  const result = parseArgs<SimilarityExportCliOptions>(argv, ARG_DEFS);
  const exitCode = handleParseResult(result, HELP_TEXT, process.stdout, process.stderr);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;
  if (options.format !== "sqlite") {
    process.stderr.write("Error: only --format sqlite is currently supported\n");
    return 1;
  }
  if (options.profile !== "full" && options.profile !== "mobile") {
    process.stderr.write("Error: --profile must be full or mobile\n");
    return 1;
  }
  if (options.dims !== 3 && options.dims !== 4) {
    process.stderr.write("Error: --dims must be 3 or 4\n");
    return 1;
  }

  const config = await loadConfig(options.config);
  const corpusLabel = options.corpusVersion ?? inferCorpusLabel(config.sidPath);
  const outputPath = options.output ?? defaultOutputPath(corpusLabel, options.profile);
  const classifiedPath = config.classifiedPath ?? "./data/classified";
  const feedbackPath = "./data/feedback";

  process.stdout.write(`Building similarity export from ${classifiedPath}\n`);
  process.stdout.write(`Writing SQLite bundle to ${outputPath}\n`);

  const resultBundle = await buildSimilarityExport({
    classifiedPath,
    feedbackPath,
    outputPath,
    profile: options.profile,
    corpusVersion: corpusLabel,
    dims: options.dims,
    includeVectors: options.includeVectors,
    neighbors: options.neighbors,
  });

  process.stdout.write(`Export complete in ${resultBundle.durationMs}ms\n`);
  process.stdout.write(`Tracks: ${resultBundle.manifest.track_count}\n`);
  process.stdout.write(`Manifest: ${resultBundle.manifestPath}\n`);
  return 0;
}