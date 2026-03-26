#!/usr/bin/env bun
/**
 * Validation script for the full HVSC similarity export.
 * Phase 13.3 (Classification completeness) + Phase 13.4 (SQLite export validation).
 *
 * Usage:
 *   bun run scripts/validate-similarity-export.ts
 *   bun run scripts/validate-similarity-export.ts --classified-dir data/classified --exports-dir data/exports
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// ────────────────────────────────────────────────────────────
// CLI args
// ────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let classifiedDir = "data/classified";
  let exportsDir = "data/exports";
  let hvscSidPath = "workspace/hvsc/C64Music";
  let sampleSize = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--classified-dir") classifiedDir = args[++i];
    else if (args[i] === "--exports-dir") exportsDir = args[++i];
    else if (args[i] === "--hvsc-path") hvscSidPath = args[++i];
    else if (args[i] === "--sample-size") sampleSize = parseInt(args[++i], 10);
  }
  return { classifiedDir, exportsDir, hvscSidPath, sampleSize };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function pass(msg: string) {
  console.log(`  ✅  ${msg}`);
}
function fail(msg: string) {
  console.error(`  ❌  ${msg}`);
  process.exitCode = 1;
}
function info(msg: string) {
  console.log(`  ℹ️   ${msg}`);
}
function section(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

async function countLinesInFile(filePath: string): Promise<number> {
  const content = await readFile(filePath, "utf-8");
  return content.split("\n").filter((l) => l.trim().length > 0).length;
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

// ────────────────────────────────────────────────────────────
// Phase 13.3 — Classification completeness
// ────────────────────────────────────────────────────────────
async function validateClassification(classifiedDir: string): Promise<{
  totalLines: number;
  uniqueSidPaths: number;
  duplicates: number;
  truncatedLines: number;
  featureFiles: string[];
  eventsFiles: string[];
}> {
  section("Phase 13.3 — Classification Completeness");

  const files = await readdir(classifiedDir);
  const featureFiles = files
    .filter((f) => f.startsWith("features_") && f.endsWith(".jsonl"))
    .map((f) => path.join(classifiedDir, f));
  const eventsFiles = files
    .filter((f) => f.startsWith("classification_") && f.endsWith(".events.jsonl"))
    .map((f) => path.join(classifiedDir, f));

  info(`Feature files: ${featureFiles.length}`);
  for (const f of featureFiles) {
    const st = await stat(f);
    info(`  ${path.basename(f)} — ${(st.size / 1024 / 1024).toFixed(1)} MB`);
  }

  if (featureFiles.length === 0) {
    fail("No features_*.jsonl files found in classified dir");
    return { totalLines: 0, uniqueSidPaths: 0, duplicates: 0, truncatedLines: 0, featureFiles: [], eventsFiles };
  }

  let totalLines = 0;
  let truncatedLines = 0;
  const sidPathSet = new Set<string>();
  const sidPathCount = new Map<string, number>();

  for (const featureFile of featureFiles) {
    const content = await readFile(featureFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    totalLines += lines.length;

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as { sid_path?: string; features?: Record<string, unknown> };
        const key = record.sid_path ?? "";
        if (!key) continue;
        sidPathSet.add(key);
        sidPathCount.set(key, (sidPathCount.get(key) ?? 0) + 1);

        // Check for obviously truncated records (no features or empty features)
        if (!record.features || Object.keys(record.features).length < 5) {
          truncatedLines++;
        }
      } catch {
        truncatedLines++;
      }
    }
  }

  const duplicates = [...sidPathCount.values()].filter((c) => c > 1).length;

  info(`Total classified entries: ${totalLines.toLocaleString()}`);
  info(`Unique SID paths: ${sidPathSet.size.toLocaleString()}`);

  if (totalLines >= 60572) {
    pass(`totalLines (${totalLines.toLocaleString()}) ≥ 60,572 expected HVSC SIDs`);
  } else {
    fail(
      `Insufficient classified entries: ${totalLines.toLocaleString()} < 60,572. ` +
        `Classification may be incomplete.`
    );
  }

  if (duplicates === 0) {
    pass("No duplicate sid_path entries");
  } else {
    fail(`${duplicates} duplicate sid_path entries found`);
  }

  if (truncatedLines === 0) {
    pass("No truncated or malformed records");
  } else {
    fail(`${truncatedLines} truncated/malformed records found`);
  }

  return { totalLines, uniqueSidPaths: sidPathSet.size, duplicates, truncatedLines, featureFiles, eventsFiles };
}

// ────────────────────────────────────────────────────────────
// Phase 13.4 — SQLite Export Validation
// ────────────────────────────────────────────────────────────
async function validateSqliteExport(
  exportsDir: string,
  expectedMinRows: number,
  sampleSize: number
): Promise<{ rowCount: number; passed: boolean }> {
  section("Phase 13.4 — SQLite Export Validation");

  const files = await readdir(exportsDir).catch(() => [] as string[]);
  const sqliteFiles = files.filter((f) => f.endsWith(".sqlite"));
  const manifestFiles = files.filter((f) => f.endsWith(".manifest.json"));

  if (sqliteFiles.length === 0) {
    fail("No .sqlite file found in exports dir");
    return { rowCount: 0, passed: false };
  }

  const sqliteFile = path.join(exportsDir, sqliteFiles[0]);
  const manifestFile = manifestFiles.length > 0 ? path.join(exportsDir, manifestFiles[0]) : null;

  const sqliteStat = await stat(sqliteFile);
  info(`SQLite file: ${sqliteFiles[0]} (${(sqliteStat.size / 1024 / 1024).toFixed(1)} MB)`);

  if (sqliteStat.size < 1024 * 1024) {
    fail(`SQLite file is suspiciously small: ${sqliteStat.size} bytes — expected >> 1 MB for full HVSC`);
    return { rowCount: 0, passed: false };
  }

  // Use bun SQLite (built-in)
  let rowCount = 0;
  let schemaOk = false;
  let vectorDims = 0;
  let nullVectors = 0;
  let samplesPassed = 0;
  let samplesTotal = 0;

  try {
    // Dynamic import to avoid top-level error if bun:sqlite unavailable
    const { Database } = await import("bun:sqlite");
    const db = new Database(sqliteFile, { readonly: true });

    // 1. Schema check
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    info(`Tables: ${tableNames.join(", ")}`);
    const requiredTables = ["meta", "tracks"];
    const missingTables = requiredTables.filter((t) => !tableNames.includes(t));
    if (missingTables.length === 0) {
      schemaOk = true;
      pass(`Required tables present: ${requiredTables.join(", ")}`);
    } else {
      fail(`Missing tables: ${missingTables.join(", ")}`);
    }

    // 2. Row count
    const countRow = db.query("SELECT COUNT(*) as n FROM tracks").get() as { n: number };
    rowCount = countRow.n;
    if (rowCount >= expectedMinRows) {
      pass(`tracks row count: ${rowCount.toLocaleString()} ≥ ${expectedMinRows.toLocaleString()} expected`);
    } else {
      fail(`tracks row count: ${rowCount.toLocaleString()} < ${expectedMinRows.toLocaleString()} expected`);
    }

    // 3. Check vector dimensions (sample a few rows)
    const trackCols = db.query("PRAGMA table_info(tracks)").all() as { name: string }[];
    const colNames = trackCols.map((c) => c.name);
    info(`Tracks columns (${colNames.length}): ${colNames.slice(0, 10).join(", ")}...`);

    // Check vector columns: the 24 similarity vector fields  
    const vectorCols = colNames.filter(
      (c) =>
        c.endsWith("Fused") ||
        c.endsWith("Sid") ||
        c.endsWith("Wav") ||
        c.endsWith("Rate") ||
        c.startsWith("mfcc") ||
        c.startsWith("tempo") ||
        c.startsWith("bass") ||
        c.startsWith("melodic")
    );
    vectorDims = vectorCols.length;
    info(`Detected vector-like columns: ${vectorDims}`);
    if (vectorDims >= 15) {
      pass(`Vector columns count (${vectorDims}) looks complete`);
    } else {
      fail(`Only ${vectorDims} vector columns found — expected ~24`);
    }

    // 4. NULL vector check (sample)
    const nullCheckCols = vectorCols.slice(0, 5).map((c) => `${c} IS NULL`).join(" OR ");
    if (nullCheckCols) {
      const nullRow = db.query(`SELECT COUNT(*) as n FROM tracks WHERE ${nullCheckCols}`).get() as { n: number };
      nullVectors = nullRow.n;
      if (nullVectors === 0) {
        pass("No NULL vector values in sampled columns");
      } else {
        fail(`${nullVectors} rows have NULL values in vector columns`);
      }
    }

    // 5. Spot validation: sample records
    if (rowCount > 0) {
      samplesTotal = Math.min(sampleSize, rowCount);
      const offset = Math.max(0, Math.floor(rowCount / 2) - Math.floor(samplesTotal / 2));
      const samples = db
        .query(`SELECT * FROM tracks LIMIT ${samplesTotal} OFFSET ${offset}`)
        .all() as Record<string, unknown>[];

      for (const sample of samples) {
        // Check that it has a sid_path or track identifier
        const hasIdentifier = sample.sid_path || sample.path || sample.id;
        // Check that at least some vector values are non-zero
        const vectorValues = vectorCols.slice(0, 8).map((c) => sample[c] as number | null);
        const hasNonZeroVector = vectorValues.some((v) => v !== null && v !== 0);
        if (hasIdentifier && hasNonZeroVector) {
          samplesPassed++;
        }
      }
      if (samplesPassed === samplesTotal) {
        pass(`Spot validation: ${samplesPassed}/${samplesTotal} sampled tracks have valid identifiers and non-zero vectors`);
      } else {
        fail(`Spot validation: ${samplesPassed}/${samplesTotal} sampled tracks passed — ${samplesTotal - samplesPassed} failures`);
      }
    }

    db.close();
  } catch (err) {
    fail(`SQLite validation error: ${(err as Error).message}`);
    return { rowCount, passed: false };
  }

  // 6. Manifest validation
  if (manifestFile) {
    try {
      const manifestContent = await readFile(manifestFile, "utf-8");
      const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
      const manifestTrackCount = (manifest as { track_count?: number }).track_count ?? 0;
      info(`Manifest track_count: ${manifestTrackCount}`);
      if (manifestTrackCount === rowCount) {
        pass(`Manifest track_count (${manifestTrackCount}) matches SQLite row count (${rowCount})`);
      } else {
        fail(`Manifest track_count (${manifestTrackCount}) ≠ SQLite row count (${rowCount})`);
      }
      // Checksum validation
      const fileChecksums = (manifest as { file_checksums?: { sqlite_sha256?: string } }).file_checksums;
      if (fileChecksums?.sqlite_sha256) {
        const actualChecksum = await sha256File(sqliteFile);
        if (actualChecksum === fileChecksums.sqlite_sha256) {
          pass(`SQLite SHA-256 checksum matches manifest`);
        } else {
          fail(`SQLite SHA-256 mismatch: manifest=${fileChecksums.sqlite_sha256}, actual=${actualChecksum}`);
        }
      }
      // Vector dimensions check
      const vectorDimsManifest = (manifest as { vector_dimensions?: number }).vector_dimensions ?? 0;
      if (vectorDimsManifest > 0) {
        info(`Manifest vector_dimensions: ${vectorDimsManifest}`);
        if (vectorDimsManifest === 24) {
          pass(`Vector dimensions = 24 (expected)`);
        } else {
          fail(`Vector dimensions = ${vectorDimsManifest} (expected 24)`);
        }
      }
    } catch (err) {
      fail(`Manifest validation error: ${(err as Error).message}`);
    }
  } else {
    fail("No .manifest.json file found in exports dir");
  }

  const passed = schemaOk && rowCount >= expectedMinRows && samplesPassed === samplesTotal;
  return { rowCount, passed };
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  const { classifiedDir, exportsDir, sampleSize } = parseArgs();

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   SIDFlow HVSC Similarity Export Validation              ║");
  console.log("║   Phase 13.3 (Classification) + Phase 13.4 (SQLite)     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Classified dir: ${classifiedDir}`);
  console.log(`  Exports dir:    ${exportsDir}`);
  console.log(`  Sample size:    ${sampleSize}`);

  const classResult = await validateClassification(classifiedDir);
  const sqliteResult = await validateSqliteExport(exportsDir, classResult.uniqueSidPaths || 60572, sampleSize);

  section("Summary");
  const allPassed = (process.exitCode ?? 0) === 0;
  if (allPassed) {
    pass("All validation checks PASSED");
  } else {
    fail("One or more validation checks FAILED — see details above");
  }
  info(`Classified entries: ${classResult.totalLines.toLocaleString()}`);
  info(`Unique SIDs classified: ${classResult.uniqueSidPaths.toLocaleString()}`);
  info(`SQLite rows: ${sqliteResult.rowCount.toLocaleString()}`);
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
