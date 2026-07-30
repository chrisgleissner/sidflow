import path from "node:path";
import process from "node:process";
import {
  buildLiteSimilarityExport,
  formatHelp,
  handleParseResult,
  buildFeaturesSidecarExport,
  buildSimilarityExport,
  buildTinySimilarityExport,
  formatStylePopulations,
  loadConfig,
  parseArgs,
  resolveHvscVersionLabel,
  rewriteSimilarityExportManifest,
  type ArgDef,
} from "@sidflow/common";

interface SimilarityExportCliOptions {
  config?: string;
  output?: string;
  profile?: string;
  corpusVersion?: string;
  neighbors?: number;
  dims?: string;
  includeVectors?: boolean;
  format?: string;
  sourceSqlite?: string;
  sourceLite?: string;
  neighborSourceSqlite?: string;
  rewriteManifest?: boolean;
  hvscVersion?: string;
  allowSparseStyles?: boolean;
  styleTargetShare?: string;
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
    type: "string",
    description:
      "Vector dimensions to export: auto (default, use the full stored vector), or 3 / 4 for the legacy rating-only vector",
    defaultValue: "auto",
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
    description: "Export format: sqlite, lite, tiny, features",
    defaultValue: "sqlite",
  },
  {
    name: "--source-sqlite",
    type: "string",
    description: "Source sidcorr-1 SQLite export, for --format lite and --format features",
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
  {
    name: "--rewrite-manifest",
    type: "boolean",
    description:
      "Recompute an existing sidcorr-1 export's manifest from the database's own contents and rewrite it in place, without reclassifying. Idempotent.",
    defaultValue: false,
  },
  {
    name: "--hvsc-version",
    type: "string",
    description:
      "HVSC release the corpus was built from, e.g. \"HVSC 85 + Update 85\". Defaults to reading hvsc-version.json beside the configured sidPath.",
  },
  {
    name: "--allow-sparse-styles",
    type: "boolean",
    description:
      "Build a tiny bundle whose station populations fail the gate. The waiver and the violations it bypassed are recorded in the manifest.",
    defaultValue: false,
  },
  {
    name: "--style-target-share",
    type: "string",
    description:
      "Share of the corpus assigned to each of the nine stations (default: 0.2). Lower makes stations more distinct and leaves more tracks unstationed.",
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
    "sidflow-play export-similarity --format sqlite --rewrite-manifest --output data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
    "sidflow-play export-similarity --format features --source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
  ],
);

function inferCorpusLabel(sidPath: string): string {
  const normalized = sidPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.endsWith("/hvsc") || normalized === "hvsc") {
    return "hvsc";
  }
  return path.basename(normalized) || "custom";
}

function defaultOutputPath(
  corpusLabel: string,
  profile: "full" | "mobile",
  format: "sqlite" | "lite" | "tiny" | "features",
): string {
  const base = `sidcorr-${corpusLabel}-${profile}`;
  if (format === "sqlite") {
    return path.join("data", "exports", `${base}-sidcorr-1.sqlite`);
  }
  if (format === "tiny") {
    return path.join("data", "exports", `${base}-sidcorr-tiny-1.sidcorr`);
  }
  if (format === "features") {
    return path.join("data", "exports", `${base}-features-1.jsonl.gz`);
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
  if (
    options.format !== "sqlite"
    && options.format !== "lite"
    && options.format !== "tiny"
    && options.format !== "features"
  ) {
    process.stderr.write("Error: --format must be sqlite, lite, tiny, or features\n");
    return 1;
  }
  if (options.profile !== "full" && options.profile !== "mobile") {
    process.stderr.write("Error: --profile must be full or mobile\n");
    return 1;
  }
  // `auto` means "export the vector classification actually computed".
  //
  // This used to default to 4, which routed every track through the legacy
  // rating-only vector and discarded the 24-dimension perceptual vector stored
  // in each classification record. The result was a similarity space of four
  // integers in which ~90% of tracks were identical, so nearest-neighbour
  // search was mostly tie-breaking: measured against an independent timbre
  // fingerprint, neighbours came out FARTHER apart than random pairs
  // (separation 0.84, Cohen's d -0.43). With the stored vector the same corpus
  // gives 1.11 and +0.25 — neighbours genuinely closer than chance.
  let resolvedDims: number | undefined;
  if (options.dims !== undefined && options.dims !== "auto") {
    const parsed = Number.parseInt(String(options.dims), 10);
    if (parsed !== 3 && parsed !== 4) {
      process.stderr.write("Error: --dims must be auto, 3 or 4\n");
      return 1;
    }
    resolvedDims = parsed;
  }

  const config = await loadConfig(options.config);
  const corpusLabel = options.corpusVersion ?? inferCorpusLabel(config.sidPath);
  const outputPath = options.output ?? defaultOutputPath(corpusLabel, options.profile, options.format);
  const classifiedPath = config.classifiedPath ?? "./data/classified";
  const feedbackPath = "./data/feedback";
  // Read from the collection's own provenance file rather than asked for, so no future
  // release can ship without it the way every release up to 0.7.0 did.
  //
  // Only for the formats built FROM the local collection. `lite` and `tiny` are derived
  // from an existing export, and that export is the authority on which HVSC its `sid_path`
  // values belong to — the library builders already fall back to the source's own
  // `hvsc_version` when none is passed. Passing the local one here overrode that fallback
  // and stamped whatever the deriving machine happened to have on disk: rebuilding 0.8.0's
  // lite bundle on a machine holding HVSC 84 produced byte-identical bundle contents with a
  // manifest claiming "HVSC 84 + Update 84" against the source's "HVSC 85 + Update 85".
  // `--hvsc-version` still overrides, for the case where the source itself is unlabelled.
  const derivedFromAnotherExport = options.format === "lite" || options.format === "tiny";
  const hvscVersion = options.hvscVersion
    ?? (derivedFromAnotherExport ? undefined : await resolveHvscVersionLabel(config.sidPath));

  if (options.rewriteManifest) {
    if (options.format !== "sqlite") {
      process.stderr.write("Error: --rewrite-manifest is only used with --format sqlite\n");
      return 1;
    }
    process.stdout.write(`Rewriting the manifest of ${outputPath} from its own contents\n`);
    const rewritten = await rewriteSimilarityExportManifest({
      sqlitePath: path.resolve(process.cwd(), outputPath),
      hvscVersion,
    });
    process.stdout.write(
      rewritten.databaseRewritten
        ? "Embedded manifest updated and database vacuumed\n"
        : "Embedded manifest was already correct; database left untouched\n",
    );
    process.stdout.write(`Tracks: ${rewritten.manifest.track_count}\n`);
    process.stdout.write(`Neighbour rows: ${rewritten.manifest.neighbor_row_count}\n`);
    process.stdout.write(`SQLite sha256: ${rewritten.manifest.file_checksums.sqlite_sha256}\n`);
    process.stdout.write(`Manifest: ${rewritten.manifestPath}\n`);
    process.stdout.write(`Complete in ${rewritten.durationMs}ms\n`);
    return 0;
  }

  if (options.sourceSqlite && options.format !== "lite" && options.format !== "features") {
    process.stderr.write("Error: --source-sqlite is only used with --format lite or --format features\n");
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

  if (options.format === "features" && !options.sourceSqlite) {
    process.stderr.write("Error: --source-sqlite is required for --format features\n");
    return 1;
  }

  if (options.format === "features") {
    process.stdout.write(`Extracting feature records from ${options.sourceSqlite}\n`);
    process.stdout.write(`Writing features sidecar to ${outputPath}\n`);
    const sidecar = await buildFeaturesSidecarExport({
      sourceSqlitePath: path.resolve(process.cwd(), options.sourceSqlite!),
      outputPath,
      corpusVersion: corpusLabel,
      hvscVersion,
    });
    const ratio = sidecar.manifest.bundle_bytes_uncompressed / Math.max(1, sidecar.manifest.bundle_bytes);
    process.stdout.write(`Export complete in ${sidecar.durationMs}ms\n`);
    process.stdout.write(`Tracks: ${sidecar.manifest.track_count}`);
    if (sidecar.manifest.tracks_without_features > 0) {
      process.stdout.write(` (${sidecar.manifest.tracks_without_features} without feature records)`);
    }
    process.stdout.write("\n");
    process.stdout.write(
      `Bytes: ${sidecar.manifest.bundle_bytes} gzipped from ${sidecar.manifest.bundle_bytes_uncompressed} (${ratio.toFixed(2)}x)\n`,
    );
    process.stdout.write(`Manifest: ${sidecar.manifestPath}\n`);
    return 0;
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
      hvscVersion,
    });
    process.stdout.write(`Export complete in ${resultBundle.durationMs}ms\n`);
    process.stdout.write(`Tracks: ${resultBundle.manifest.track_count}\n`);
    process.stdout.write(`Manifest: ${resultBundle.manifestPath}\n`);
    return 0;
  }

  if (options.format === "tiny") {
    let stylePopulationPolicy: { targetShare: number } | undefined;
    if (options.styleTargetShare !== undefined) {
      const parsed = Number.parseFloat(String(options.styleTargetShare));
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
        process.stderr.write("Error: --style-target-share must be a fraction in (0, 1]\n");
        return 1;
      }
      stylePopulationPolicy = { targetShare: parsed };
    }

    process.stdout.write(`Converting ${options.sourceLite} into sidcorr-tiny-1\n`);
    process.stdout.write(`Writing tiny bundle to ${outputPath}\n`);
    const resultBundle = await buildTinySimilarityExport({
      stylePopulationPolicy,
      allowSparseStyles: options.allowSparseStyles,
      sourceLitePath: path.resolve(process.cwd(), options.sourceLite!),
      hvscRoot: path.resolve(process.cwd(), config.sidPath),
      outputPath,
      corpusVersion: corpusLabel,
      hvscVersion,
      neighborSqlitePath: options.neighborSourceSqlite
        ? path.resolve(process.cwd(), options.neighborSourceSqlite)
        : undefined,
    });
    process.stdout.write(`Export complete in ${resultBundle.durationMs}ms\n`);
    process.stdout.write(`Tracks: ${resultBundle.manifest.track_count}\n`);
    const populations = resultBundle.manifest.style_populations;
    if (populations) {
      process.stdout.write("Station populations:\n");
      process.stdout.write(`${formatStylePopulations(populations, resultBundle.manifest.track_count)}\n`);
    }
    if (resultBundle.manifest.style_population_waiver) {
      process.stdout.write("WARNING: built under --allow-sparse-styles; the manifest records:\n");
      for (const violation of resultBundle.manifest.style_population_waiver) {
        process.stdout.write(`  - ${violation}\n`);
      }
    }
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
    dims: resolvedDims,
    includeVectors: options.includeVectors,
    neighbors: options.neighbors,
    hvscVersion,
  });

  process.stdout.write(`Export complete in ${resultBundle.durationMs}ms\n`);
  process.stdout.write(`Tracks: ${resultBundle.manifest.track_count}\n`);
  process.stdout.write(`Manifest: ${resultBundle.manifestPath}\n`);
  return 0;
}
