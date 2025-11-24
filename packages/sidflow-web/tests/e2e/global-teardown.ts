import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export default async function globalTeardown() {
  console.log('[E2E Coverage] Processing coverage files...');

  if (process.env.E2E_COVERAGE !== 'true') {
    return;
  }

  try {
    await generateLcov();
    console.log('[E2E Coverage] ✓ Coverage processing complete');
  } catch (error) {
    console.error('[E2E Coverage] ✗ Error processing coverage:', error);
  }
}

async function generateLcov() {
  const nycOutputDir = join(process.cwd(), '.nyc_output');
  const coverageE2eDir = join(process.cwd(), 'coverage-e2e');

  if (!existsSync(nycOutputDir)) {
    console.log('[E2E Coverage] No .nyc_output directory found');
    return;
  }

  // Read all coverage JSON files from .nyc_output
  const files = readdirSync(nycOutputDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('[E2E Coverage] No coverage files found in .nyc_output');
    return;
  }

  console.log(`[E2E Coverage] Merging ${files.length} coverage files...`);

  // Create output directory
  mkdirSync(coverageE2eDir, { recursive: true });

  // Use nyc CLI to merge and convert to lcov
  // First merge all individual coverage files
  execSync(
    `npx nyc merge .nyc_output coverage-e2e/coverage-final.json`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );

  console.log(`[E2E Coverage] ✓ Merged coverage files`);

  // Then generate lcov report
  execSync(
    `npx nyc report --reporter=lcovonly --report-dir=coverage-e2e --temp-dir=.nyc_output`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );

  const lcovPath = join(coverageE2eDir, 'lcov.info');
  if (existsSync(lcovPath)) {
    // Fix relative paths to be absolute from repo root
    let lcovContent = readFileSync(lcovPath, 'utf-8');
    const lines = lcovContent.split('\n');
    const fixedLines = lines.map(line => {
      if (line.startsWith('SF:') && !line.startsWith('SF:packages/')) {
        // Convert relative path to absolute from repo root
        const relativePath = line.substring(3);
        return `SF:packages/sidflow-web/${relativePath}`;
      }
      return line;
    });
    writeFileSync(lcovPath, fixedLines.join('\n'));

    const fileCount = fixedLines.filter(l => l.startsWith('SF:')).length;
    console.log(`[E2E Coverage] ✓ Generated lcov.info covering ${fileCount} files: ${lcovPath}`);
  } else {
    console.warn(`[E2E Coverage] Warning: lcov.info was not generated`);
  }
}
