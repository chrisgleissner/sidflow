/**
 * Merge unit test coverage (from Bun) with E2E coverage (from Playwright)
 * Outputs merged lcov.info for Codecov upload
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface FileCoverage {
    path: string;
    lines: Map<number, number>; // line number -> hit count
}

function parseLcov(lcovContent: string): Map<string, FileCoverage> {
    const files = new Map<string, FileCoverage>();
    let current: FileCoverage | null = null;

    for (const rawLine of lcovContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith('SF:')) {
            const path = line.slice(3);
            current = { path, lines: new Map() };
        } else if (line.startsWith('DA:')) {
            if (!current) continue;
            const [lineNumStr, hitsStr] = line.slice(3).split(',');
            const lineNum = Number(lineNumStr);
            const hits = Number(hitsStr);
            current.lines.set(lineNum, hits);
        } else if (line === 'end_of_record') {
            if (current) {
                files.set(current.path, current);
            }
            current = null;
        }
    }

    return files;
}

function mergeCoverage(unit: Map<string, FileCoverage>, e2e: Map<string, FileCoverage>): Map<string, FileCoverage> {
    const merged = new Map<string, FileCoverage>();

    // Start with all unit test files
    for (const [path, coverage] of unit.entries()) {
        merged.set(path, {
            path,
            lines: new Map(coverage.lines)
        });
    }

    // Merge E2E coverage
    for (const [path, e2eCoverage] of e2e.entries()) {
        const existing = merged.get(path);
        if (existing) {
            // Merge lines (sum hit counts)
            for (const [lineNum, hits] of e2eCoverage.lines.entries()) {
                const currentHits = existing.lines.get(lineNum) ?? 0;
                existing.lines.set(lineNum, currentHits + hits);
            }
        } else {
            // New file from E2E
            merged.set(path, {
                path,
                lines: new Map(e2eCoverage.lines)
            });
        }
    }

    return merged;
}

function generateLcov(files: Map<string, FileCoverage>): string {
    const lines: string[] = [];

    for (const [, file] of files.entries()) {
        lines.push(`SF:${file.path}`);

        // Sort line numbers for consistent output
        const sortedLines = Array.from(file.lines.entries()).sort((a, b) => a[0] - b[0]);

        for (const [lineNum, hits] of sortedLines) {
            lines.push(`DA:${lineNum},${hits}`);
        }

        const linesFound = sortedLines.length;
        const linesHit = sortedLines.filter(([, hits]) => hits > 0).length;

        lines.push(`LF:${linesFound}`);
        lines.push(`LH:${linesHit}`);
        lines.push('end_of_record');
    }

    return lines.join('\n') + '\n';
}

async function main() {
    console.log('[merge-coverage] Merging unit + E2E coverage...');

    // Paths
    const repoRoot = process.cwd();
    const unitLcov = join(repoRoot, 'coverage', 'lcov.info');
    const e2eLcov = join(repoRoot, 'packages', 'sidflow-web', 'coverage-e2e', 'lcov.info');
    const mergedDir = join(repoRoot, 'coverage-merged');
    const mergedLcov = join(mergedDir, 'lcov.info');

    // Check unit coverage exists
    if (!existsSync(unitLcov)) {
        console.error('[merge-coverage] ERROR: Unit test coverage not found at:', unitLcov);
        console.error('[merge-coverage] Run "bun test --coverage" first');
        process.exit(1);
    }

    // Read unit coverage
    const unitContent = readFileSync(unitLcov, 'utf8');
    const unitFiles = parseLcov(unitContent);
    console.log(`[merge-coverage] Unit tests: ${unitFiles.size} files`);

    // Read E2E coverage if available
    let e2eFiles = new Map<string, FileCoverage>();
    if (existsSync(e2eLcov)) {
        const e2eContent = readFileSync(e2eLcov, 'utf8');
        e2eFiles = parseLcov(e2eContent);
        console.log(`[merge-coverage] E2E tests: ${e2eFiles.size} files`);
    } else {
        console.log('[merge-coverage] No E2E coverage found, using unit tests only');
    }

    // Merge
    const merged = mergeCoverage(unitFiles, e2eFiles);
    console.log(`[merge-coverage] Merged: ${merged.size} files`);

    // Calculate stats
    let totalLines = 0;
    let totalHit = 0;
    for (const [, file] of merged.entries()) {
        totalLines += file.lines.size;
        totalHit += Array.from(file.lines.values()).filter(hits => hits > 0).length;
    }
    const coverage = totalLines > 0 ? (totalHit / totalLines) * 100 : 0;

    console.log(`[merge-coverage] Total coverage: ${coverage.toFixed(2)}% (${totalHit}/${totalLines} lines)`);

    // Write merged lcov
    mkdirSync(mergedDir, { recursive: true });
    const lcovOutput = generateLcov(merged);
    writeFileSync(mergedLcov, lcovOutput, 'utf8');

    console.log(`[merge-coverage] Merged coverage written to: ${mergedLcov}`);
    console.log('[merge-coverage] ✅ Coverage merge complete');
}

main().catch((err) => {
    console.error('[merge-coverage] ERROR:', err);
    process.exit(1);
});
