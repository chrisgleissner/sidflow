/**
 * Coverage collection helpers for E2E tests
 */
import type { Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let allCoverage: any[] = [];

/**
 * Start coverage collection for a page
 */
export async function startCoverage(page: Page) {
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    reportAnonymousScripts: true,
  });
}

/**
 * Stop coverage collection and store results
 */
export async function stopCoverage(page: Page) {
  const coverage = await page.coverage.stopJSCoverage();
  allCoverage.push(...coverage);
}

/**
 * Save all collected coverage data
 */
export async function saveCoverage() {
  if (allCoverage.length === 0) {
    console.log('[coverage] No coverage data to save');
    return;
  }

  const coverageDir = join(process.cwd(), 'coverage-e2e');
  mkdirSync(coverageDir, { recursive: true });

  // Save raw V8 coverage
  const rawPath = join(coverageDir, 'coverage-raw.json');
  writeFileSync(rawPath, JSON.stringify(allCoverage, null, 2));

  console.log(`[coverage] Saved ${allCoverage.length} coverage entries to ${rawPath}`);

  // Convert to Istanbul/lcov format
  await convertToLcov(allCoverage, coverageDir);
}

/**
 * Convert V8 coverage to lcov format
 */
async function convertToLcov(coverage: any[], outputDir: string) {
  const v8toIstanbul = (await import('v8-to-istanbul')).default;
  const istanbulCoverage: Record<string, any> = {};

  for (const entry of coverage) {
    try {
      // Filter relevant files
      if (!entry.url || entry.url.startsWith('data:') || 
          entry.url.includes('node_modules') ||
          entry.url.includes('webpack') ||
          !entry.url.includes('localhost')) {
        continue;
      }

      // Extract file path from URL
      const url = new URL(entry.url);
      const pathname = url.pathname;
      
      // Skip if no source
      if (!entry.source) {
        continue;
      }

      const converter = v8toIstanbul(pathname, 0, { source: entry.source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      
      const result = converter.toIstanbul();
      Object.assign(istanbulCoverage, result);
    } catch (error) {
      // Skip entries that fail to convert
    }
  }

  // Save Istanbul format
  const istanbulPath = join(outputDir, 'coverage-final.json');
  writeFileSync(istanbulPath, JSON.stringify(istanbulCoverage, null, 2));

  console.log(`[coverage] Converted to Istanbul format: ${Object.keys(istanbulCoverage).length} files`);

  // Convert Istanbul format to lcov format
  await convertIstanbulToLcov(istanbulCoverage, outputDir);

  return istanbulCoverage;
}

/**
 * Convert Istanbul coverage to lcov format
 */
async function convertIstanbulToLcov(coverage: Record<string, any>, outputDir: string) {
  const istanbulLibCoverage = await import('istanbul-lib-coverage');
  const istanbulLibReport = await import('istanbul-lib-report');
  const istanbulReports = await import('istanbul-reports');

  const coverageMap = istanbulLibCoverage.createCoverageMap(coverage);
  const context = istanbulLibReport.createContext({
    dir: outputDir,
    coverageMap,
  });

  const lcovReport = istanbulReports.create('lcovonly');
  lcovReport.execute(context);

  console.log(`[coverage] ✓ Generated lcov.info in ${outputDir}`);
}

/**
 * Get all collected coverage
 */
export function getAllCoverage() {
  return allCoverage;
}

/**
 * Clear collected coverage
 */
export function clearCoverage() {
  allCoverage = [];
}
