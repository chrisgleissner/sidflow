import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface PlaywrightSuite {
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  tests?: PlaywrightTest[];
}

interface PlaywrightTest {
  title: string;
  projectName: string;
  location?: { file: string; line: number; column: number };
  results?: Array<{ status: string; duration: number }>;
}

interface TestSummary {
  title: string;
  file?: string;
  project: string;
  durationMs: number;
  status: string;
}

const DEFAULT_REPORT_PATH = path.resolve(
  'packages',
  'sidflow-web',
  'playwright-report',
  'report.json'
);

function readJsonReport(reportPath: string): any {
  if (!existsSync(reportPath)) {
    throw new Error(`Playwright report not found at ${reportPath}`);
  }
  const raw = readFileSync(reportPath, 'utf8');
  return JSON.parse(raw);
}

function collectTests(suites: PlaywrightSuite[] | undefined, parentTitles: string[] = []): TestSummary[] {
  if (!suites) {
    return [];
  }

  const summaries: TestSummary[] = [];

  for (const suite of suites) {
    const nextParents =
      suite.title && suite.title.length > 0
        ? [...parentTitles, suite.title]
        : parentTitles;

    summaries.push(...collectTests(suite.suites, nextParents));

    for (const spec of suite.specs ?? []) {
      const specParents =
        spec.title && spec.title.length > 0
          ? [...nextParents, spec.title]
          : nextParents;

      for (const test of spec.tests ?? []) {
        const titleParts = [...specParents, test.title].filter(Boolean);
        const fullTitle = titleParts.join(' › ');
        const lastResult = test.results?.[test.results.length - 1];
        summaries.push({
          title: fullTitle,
          file: test.location?.file ?? spec.file ?? suite.file,
          project: test.projectName ?? 'unknown',
          durationMs: lastResult?.duration ?? 0,
          status: lastResult?.status ?? 'unknown',
        });
      }
    }
  }

  return summaries;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function printSlowTests(tests: TestSummary[], limit = 10): void {
  const sorted = [...tests].sort(
    (a, b) => b.durationMs - a.durationMs
  );
  const top = sorted.slice(0, limit);

  console.log('');
  console.log('Top slow tests:');
  top.forEach((test, index) => {
    console.log(
      `${index + 1}. ${formatDuration(test.durationMs)} — ${test.title} [${test.status}] (${path.basename(
        test.file ?? 'unknown'
      )})`
    );
  });
}

function printSlowSpecs(tests: TestSummary[]): void {
  const byFile = new Map<
    string,
    { totalMs: number; count: number; longest: number }
  >();

  for (const test of tests) {
    const key = test.file ?? 'unknown';
    const stats = byFile.get(key) ?? { totalMs: 0, count: 0, longest: 0 };
    stats.totalMs += test.durationMs;
    stats.count += 1;
    stats.longest = Math.max(stats.longest, test.durationMs);
    byFile.set(key, stats);
  }

  const ranked = [...byFile.entries()].sort(
    (a, b) => b[1].totalMs - a[1].totalMs
  );

  console.log('');
  console.log('Slowest specs by file:');
  for (const [file, stats] of ranked.slice(0, 10)) {
    console.log(
      `${formatDuration(stats.totalMs)} total (${stats.count} tests, peak ${formatDuration(
        stats.longest
      )}) — ${file}`
    );
  }
}

function main(): void {
  const reportPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_REPORT_PATH;

  const data = readJsonReport(reportPath);
  const suites: PlaywrightSuite[] = data.suites ?? [];
  const tests = collectTests(suites);

  if (tests.length === 0) {
    console.warn(
      `No tests found inside report ${reportPath}. Did the Playwright run finish?`
    );
    return;
  }

  const totalDuration = tests.reduce((sum, test) => sum + test.durationMs, 0);
  const failed = tests.filter((t) => t.status !== 'passed');

  console.log(`[E2E Runtime] Loaded ${tests.length} tests from ${reportPath}`);
  console.log(
    `[E2E Runtime] Total recorded time: ${formatDuration(
      totalDuration
    )} (avg ${(totalDuration / tests.length / 1000).toFixed(2)}s)`
  );
  if (failed.length > 0) {
    console.log(
      `[E2E Runtime] ${failed.length} tests did not pass (statuses: ${failed
        .map((t) => t.status)
        .join(', ')})`
    );
  }

  printSlowTests(tests);
  printSlowSpecs(tests);
}

try {
  main();
} catch (error) {
  console.error('[E2E Runtime] Failed to analyze report:', error);
  process.exit(1);
}
