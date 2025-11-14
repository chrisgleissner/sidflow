/**
 * Bun-only coverage runner enforcing ≥90% line coverage on source files.
 * - Runs `bun test` with lcov reporter
 * - Filters LCOV to include only source paths we unit-test in this repo (core packages' src/)
 * - Excludes dist/, build artifacts, .next/, tmp/, data/
 * - Fails the process if coverage < 90%
 */

const INCLUDE_PATTERNS = ["/packages/"]; // repo root anchor

function includePath(p: string): boolean {
  // Normalize path separators
  const path = p.replaceAll("\\", "/");
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
  // Strict source coverage: include core libraries' src only, exclude sidflow-web entirely
  if (!INCLUDE_PATTERNS.some((prefix) => path.includes(prefix))) return false;

  // Exclude the Next.js web package from the strict unit coverage gate; it's covered via E2E
  if (path.includes("/packages/sidflow-web/")) return false;

  // Only count TypeScript/JavaScript source files under src/ for other packages
  if (!path.includes("/src/")) return false;
  if (!(/\.(ts|tsx|js|jsx)$/.test(path))) return false;
  return true;
}

async function run() {
  // 1) Run tests with lcov output
  const test = Bun.spawn([
    "bun",
    "test",
    "--coverage",
    "--coverage-reporter=lcov",
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
