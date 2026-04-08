import path from "node:path";
import process from "node:process";
import {
  buildLiteSimilarityExport,
  formatHelp,
  handleParseResult,
  buildSimilarityExport,
  buildTinySimilarityExport,
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
  sourceSqlite?: string;
  sourceLite?: string;
  neighborSourceSqlite?: string;
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
    description: "Output path (default depends on --format)",
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
    description: "Export format: sqlite, lite, tiny",
    defaultValue: "sqlite",
  },
  {
    name: "--source-sqlite",
    type: "string",
    description: "Convert an existing sidcorr-1 SQLite export into lite format",
  },
  {
    name: "--source-lite",
    type: "string",
    description: "Convert an existing sidcorr-lite-1 bundle into tiny format",
  },
  {
    name: "--neighbor-source-sqlite",
    type: "string",
    description: "Optional sidcorr-1 SQLite export used only as a precomputed neighbor hint when building tiny from lite",
  },
];

const HELP_TEXT = formatHelp(
  "sidflow-play export-similarity [options]",
  "Build a portable offline SID similarity bundle for consumers such as c64commander.",
  ARG_DEFS,
  [
    "sidflow-play export-similarity",
    "sidflow-play export-similarity --profile full --output data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
    "sidflow-play export-similarity --format lite --source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
    "sidflow-play export-similarity --format tiny --source-lite data/exports/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr --neighbor-source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
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

function defaultOutputPath(corpusLabel: string, profile: "full" | "mobile", format: "sqlite" | "lite" | "tiny"): string {
  const base = `sidcorr-${corpusLabel}-${profile}`;
  if (format === "sqlite") {
    return path.join("data", "exports", `${base}-sidcorr-1.sqlite`);
  }
  if (format === "tiny") {
    return path.join("data", "exports", `${base}-sidcorr-tiny-1.sidcorr`);
  }
  return path.join("data", "exports", `${base}-sidcorr-lite-1.sidcorr`);
}

export async function runSimilarityExportCli(argv: string[]): Promise<number> {
  const result = parseArgs<SimilarityExportCliOptions>(argv, ARG_DEFS);
  const exitCode = handleParseResult(result, HELP_TEXT, process.stdout, process.stderr);
  if (exitCode !== undefined) {
    return exitCode;
  }

  const { options } = result;
  if (options.format !== "sqlite" && options.format !== "lite" && options.format !== "tiny") {
    process.stderr.write("Error: --format must be sqlite, lite, or tiny\n");
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
  const outputPath = options.output ?? defaultOutputPath(corpusLabel, options.profile, options.format);
  const classifiedPath = config.classifiedPath ?? "./data/classified";
  const feedbackPath = "./data/feedback";

  if (options.sourceSqlite && options.format !== "lite") {
    process.stderr.write("Error: --source-sqlite is only used with --format lite\n");
    return 1;
  }

  if (options.sourceLite && options.format !== "tiny") {
    process.stderr.write("Error: --source-lite is only used with --format tiny\n");
    return 1;
  }

  if (options.neighborSourceSqlite && options.format !== "tiny") {
    process.stderr.write("Error: --neighbor-source-sqlite is only used with --format tiny\n");
    return 1;
  }

  if (options.format === "lite" && !options.sourceSqlite) {
    process.stderr.write("Error: --source-sqlite is required for --format lite\n");
    return 1;
  }

  if (options.format === "tiny" && !options.sourceLite) {
    process.stderr.write("Error: --source-lite is required for --format tiny\n");
    return 1;
  }

  if (options.format === "lite") {
    process.stdout.write(`Converting ${options.sourceSqlite} into sidcorr-lite-1\n`);
    process.stdout.write(`Writing lite bundle to ${outputPath}\n`);
    const resultBundle = await buildLiteSimilarityExport({
      sourceSqlitePath: path.resolve(process.cwd(), options.sourceSqlite!),
      outputPath,
      corpusVersion: corpusLabel,
    });
    process.stdout.write(`Export complete in ${resultBundle.durationMs}ms\n`);
    process.stdout.write(`Tracks: ${resultBundle.manifest.track_count}\n`);
    process.stdout.write(`Manifest: ${resultBundle.manifestPath}\n`);
    return 0;
  }

  if (options.format === "tiny") {
    process.stdout.write(`Converting ${options.sourceLite} into sidcorr-tiny-1\n`);
    process.stdout.write(`Writing tiny bundle to ${outputPath}\n`);
    const resultBundle = await buildTinySimilarityExport({
      sourceLitePath: path.resolve(process.cwd(), options.sourceLite!),
      hvscRoot: path.resolve(process.cwd(), config.sidPath),
      outputPath,
      corpusVersion: corpusLabel,
      neighborSqlitePath: options.neighborSourceSqlite
        ? path.resolve(process.cwd(), options.neighborSourceSqlite)
        : undefined,
    });
    process.stdout.write(`Export complete in ${resultBundle.durationMs}ms\n`);
    process.stdout.write(`Tracks: ${resultBundle.manifest.track_count}\n`);
    process.stdout.write(`Manifest: ${resultBundle.manifestPath}\n`);
    return 0;
  }

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
