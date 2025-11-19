/**
 * Bun-only coverage runner enforcing ≥90% line coverage on source files.
 * - Runs `bun test` with lcov reporter
 * - Filters LCOV to include only source paths we unit-test in this repo (core packages' src/)
 * - Excludes dist/, build artifacts, .next/, tmp/, data/
 * - Fails the process if coverage < 90%
 */

const INCLUDE_PATTERNS = ["/packages/"]; // repo root anchor (match with or without leading slash)
// Known integration-heavy or orchestration files we don't require in the strict unit coverage gate
const EXCLUDE_PATH_CONTAINS = [
  "/packages/sidflow-common/src/playback-harness.ts",
  "/packages/sidflow-common/src/audio-encoding.ts",
  "/packages/sidflow-common/src/job-runner.ts",
  "/packages/sidflow-classify/src/render/cli.ts",
  "/packages/sidflow-classify/src/render/render-orchestrator.ts",
  "/packages/sidflow-classify/src/render/engine-factory.ts",
  "/packages/sidflow-classify/src/render/wav-renderer.ts",
  "/packages/libsidplayfp-wasm/src/player.ts",
];

function includePath(p: string): boolean {
  // Normalize path separators and ensure a leading slash for consistent matching
  const raw = p.replaceAll("\\", "/");
  const path = raw.startsWith("/") ? raw : "/" + raw;
  if (EXCLUDE_PATH_CONTAINS.some((s) => path.includes(s))) return false;
  if (
    path.includes("/dist/") ||
    path.includes("/.next/") ||
    path.includes("/tmp/") ||
    path.includes("/coverage/") ||
    path.includes("/node_modules/")
  ) {
    return false;
  }
  if (path.includes("/test/") || path.endsWith(".test.ts") || path.endsWith(".spec.ts")) {
    return false;
  }
  // Strict source coverage: count core libraries under src/
  if (!INCLUDE_PATTERNS.some((prefix) => path.includes(prefix))) return false;

  // If file is in sidflow-web, only include a small set of unit-testable server modules and proxy
  if (path.includes("/packages/sidflow-web/")) {
    const WEB_ALLOW = new Set<string>([
      "/packages/sidflow-web/lib/server/anonymize.ts",
      "/packages/sidflow-web/lib/server/rate-limiter.ts",
      "/packages/sidflow-web/lib/server/admin-auth-core.ts",
      "/packages/sidflow-web/proxy.ts",
    ]);
    return WEB_ALLOW.has(path);
  }

  // For other packages, include only files under src/
  if (!path.includes("/src/")) return false;
  if (!(/\.(ts|tsx|js|jsx)$/.test(path))) return false;
  return true;
}

async function run() {
  // 1) Run tests with lcov output
  // Find all test files (same as package.json test script)
  const findProc = Bun.spawn([
    "find", 
    "packages/*/test", 
    "packages/sidflow-web/tests/unit", 
    "integration-tests",
    "-name", "*.test.ts", 
    "-type", "f"
  ], { stdout: "pipe", stderr: "inherit" });
  await findProc.exited;
  const testFilesRaw = await new Response(findProc.stdout).text();
  const testFiles = testFilesRaw.trim().split(/\r?\n/).filter(Boolean);
  
  const test = Bun.spawn([
    "bun",
    "test",
    ...testFiles,
    "--coverage",
    "--coverage-reporter=lcov",
    "--exclude=**/*.spec.ts",
  ], { stdout: "inherit", stderr: "inherit" });
  await test.exited;
  const testCode = test.exitCode ?? 1;
  if (testCode !== 0) {
    process.exit(testCode);
  }

  // 2) Read lcov
  const lcovPath = "coverage/lcov.info";
  let lcov: string;
  try {
    lcov = await Bun.file(lcovPath).text();
  } catch (_err) {
    console.error(`coverage: missing ${lcovPath}`);
    process.exit(1);
  }

  // 3) Parse LCOV
  type FileStats = { path: string; linesFound: number; linesHit: number };
  const files: FileStats[] = [];
  let current: FileStats | null = null;
  for (const rawLine of lcov.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const p = line.slice(3);
      current = { path: p, linesFound: 0, linesHit: 0 };
    } else if (line.startsWith("DA:")) {
      if (!current) continue;
      const [, hitsStr] = line.slice(3).split(",");
      const hits = Number(hitsStr);
      current.linesFound += 1;
      if (hits > 0) current.linesHit += 1;
    } else if (line === "end_of_record") {
      if (current) files.push(current);
      current = null;
    }
  }

  // 4) Filter files to source only
  const included = files.filter((f) => includePath(f.path));
  const totalFound = included.reduce((a, f) => a + f.linesFound, 0);
  const totalHit = included.reduce((a, f) => a + f.linesHit, 0);
  const pct = totalFound === 0 ? 0 : (totalHit / totalFound) * 100;

  const pctStr = pct.toFixed(2);
  console.log(`\nStrict source coverage: ${pctStr}% (${totalHit}/${totalFound} lines)`);

  // Helpful debugging: list the 15 least-covered files in the included set
  if (included.length > 0) {
    const worst = [...included]
      .map((f) => ({
        path: f.path.startsWith("/") ? f.path : "/" + f.path,
        pct: f.linesFound === 0 ? 100 : (f.linesHit / f.linesFound) * 100,
        linesHit: f.linesHit,
        linesFound: f.linesFound,
      }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 15);
    console.log("\nLowest-covered files (included):");
    for (const w of worst) {
      console.log(`- ${w.pct.toFixed(2).padStart(6)}% ${w.linesHit}/${w.linesFound} ${w.path}`);
    }
  }

  const MIN = 90.0;
  if (pct < MIN) {
    console.error(`Coverage FAIL: require >= ${MIN}% on source files`);
    process.exit(1);
  }
  console.log("Coverage PASS: threshold met.");
}

run().catch((err) => {
  console.error("coverage: unexpected error", err);
  process.exit(1);
});
