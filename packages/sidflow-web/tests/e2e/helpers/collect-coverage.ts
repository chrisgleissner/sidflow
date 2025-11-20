import type { Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function collectCoverage(page: Page, testName: string) {
  const coverage = await page.evaluate(() => (window as any).__coverage__);
  
  if (!coverage) {
    console.log(`[collect-coverage] No coverage data for test: ${testName}`);
    return;
  }

  const nycOutput = join(process.cwd(), '.nyc_output');
  mkdirSync(nycOutput, { recursive: true });
  
  const filename = `coverage-${testName.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.json`;
  const filepath = join(nycOutput, filename);
  
  writeFileSync(filepath, JSON.stringify(coverage, null, 2));
  const fileCount = Object.keys(coverage).length;
  console.log(`[collect-coverage] Saved coverage for ${fileCount} files: ${filename}`);
}
