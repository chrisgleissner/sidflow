#!/usr/bin/env bun
/**
 * Verify that WAV files in the cache have the correct duration
 * by comparing against HVSC Songlengths.md5 database
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, basename, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';

interface SongLength {
  md5: string;
  path: string;
  lengths: number[]; // in seconds
}

function parseSonglengthsFile(filePath: string): Map<string, SongLength> {
  const content = readFileSync(filePath, 'utf-8');
  const map = new Map<string, SongLength>();
  let currentPath = '';

  // Handle both Unix (\n) and Windows (\r\n) line endings
  for (let line of content.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;

    // Comment line with path: ; /path/to/file.sid
    if (line.startsWith(';')) {
      const pathMatch = line.match(/;\s*(.+\.sid)\s*$/i);
      if (pathMatch) {
        currentPath = pathMatch[1];
      }
      continue;
    }

    // Data line: MD5=time1 time2 ...
    const match = line.match(/^([0-9a-f]{32})=(.+)$/i);
    if (!match) continue;

    const [, md5, rest] = match;
    const lengths = rest.trim().split(/\s+/).map(parseTimeToSeconds);

    map.set(md5.toLowerCase(), {
      md5: md5.toLowerCase(),
      path: currentPath,
      lengths,
    });
  }

  return map;
}

function parseTimeToSeconds(timeStr: string): number {
  // Format: MM:SS or M:SS or MM:SS.mmm (with milliseconds)
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]); // Handles fractional seconds
    return minutes * 60 + seconds;
  }
  return 0;
}

function getWavDuration(wavPath: string): number {
  try {
    // Use ffprobe to get duration
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${wavPath}"`,
      { encoding: 'utf-8' }
    );
    return parseFloat(output.trim());
  } catch (error) {
    console.error(`Failed to get duration for ${wavPath}:`, error);
    return 0;
  }
}

function getMd5FromWavPath(wavPath: string, hvscRoot: string): string | null {
  // WAV filename pattern: path_to_sid_file.wav
  // Need to find corresponding SID file and calculate its MD5
  const wavName = basename(wavPath, '.wav');
  const wavDir = dirname(wavPath);

  // Try to find corresponding SID file
  // WAV cache structure mirrors HVSC structure
  const relativePath = relative(join(hvscRoot, '..', 'wav-cache'), wavDir);
  const sidDir = join(hvscRoot, 'C64Music', relativePath);

  // Look for SID files matching the wav name pattern
  const possibleSidFiles = [
    join(sidDir, `${wavName}.sid`),
    join(sidDir, `${wavName.replace(/_/g, ' ')}.sid`),
  ];

  for (const sidFile of possibleSidFiles) {
    if (existsSync(sidFile)) {
      try {
        const content = readFileSync(sidFile);
        const md5 = createHash('md5').update(content).digest('hex');
        return md5.toLowerCase();
      } catch (error) {
        console.error(`Failed to calculate MD5 for ${sidFile}:`, error);
      }
    }
  }

  return null;
}

function findWavFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath);
          } else if (entry.endsWith('.wav')) {
            results.push(fullPath);
          }
        } catch (err) {
          // Skip files we can't access
        }
      }
    } catch (err) {
      // Skip directories we can't access
    }
  }

  walk(dir);
  return results;
}

async function main() {
  const hvscRoot = process.argv[2] || '/sidflow/workspace/hvsc';
  const wavCacheRoot = process.argv[3] || '/sidflow/workspace/wav-cache';
  const minTimestamp = process.argv[4]; // Optional: ISO timestamp filter
  const songlengthsPath = join(hvscRoot, 'C64Music', 'DOCUMENTS', 'Songlengths.md5');

  if (!existsSync(songlengthsPath)) {
    console.error(`Songlengths.md5 not found at ${songlengthsPath}`);
    process.exit(1);
  }

  console.log('Loading Songlengths.md5 database...');
  const songlengths = parseSonglengthsFile(songlengthsPath);
  console.log(`Loaded ${songlengths.size} entries from Songlengths.md5`);

  console.log('\nFinding WAV files...');
  let wavFiles = findWavFiles(wavCacheRoot);
  
  // Filter by timestamp if provided
  if (minTimestamp) {
    const minDate = new Date(minTimestamp);
    const { statSync } = await import('node:fs');
    wavFiles = wavFiles.filter((file) => {
      try {
        const stats = statSync(file);
        return stats.mtime >= minDate;
      } catch {
        return false;
      }
    });
    console.log(`Found ${wavFiles.length} WAV files created after ${minTimestamp}`);
  } else {
    console.log(`Found ${wavFiles.length} WAV files`);
  }

  if (wavFiles.length === 0) {
    console.log('No WAV files to verify. Run classification first.');
    process.exit(0);
  }

  // Sample a subset for verification (full scan can take a while)
  // Use all files if 5th arg is 'all', otherwise sample 20
  const checkAll = process.argv[5] === 'all';
  const sampleSize = checkAll ? wavFiles.length : Math.min(20, wavFiles.length);
  const sample = wavFiles.slice(0, sampleSize);

  console.log(`\nVerifying ${sample.length} WAV files${checkAll ? ' (full scan)' : ''}...\n`);

  let verified = 0;
  let notInDb = 0;
  let lengthMismatch = 0;
  let errors = 0;

  for (const wavPath of sample) {
    const wavName = basename(wavPath);
    const actualDuration = getWavDuration(wavPath);

    if (actualDuration === 0) {
      console.log(`❌ ${wavName}: ERROR - Could not read duration`);
      errors++;
      continue;
    }

    const md5 = getMd5FromWavPath(wavPath, hvscRoot);

    if (!md5) {
      console.log(`⚠️  ${wavName}: NOT FOUND - Could not locate source SID file`);
      notInDb++;
      continue;
    }

    const songInfo = songlengths.get(md5);

    if (!songInfo) {
      console.log(
        `⚠️  ${wavName}: NOT IN DB - MD5 ${md5} not found in Songlengths.md5`
      );
      notInDb++;
      continue;
    }

    // For single subtune, compare with first length
    // For multi-subtune, would need to parse filename to get subtune number
    const expectedDuration = songInfo.lengths[0] || 0;
    const tolerance = 2.5; // 2.5 second tolerance (HVSC times may not include final fade/silence)

    if (Math.abs(actualDuration - expectedDuration) <= tolerance) {
      console.log(
        `✅ ${wavName}: OK - ${actualDuration.toFixed(1)}s (expected ${expectedDuration}s)`
      );
      verified++;
    } else {
      console.log(
        `❌ ${wavName}: MISMATCH - ${actualDuration.toFixed(1)}s (expected ${expectedDuration}s, diff: ${(actualDuration - expectedDuration).toFixed(1)}s)`
      );
      lengthMismatch++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total checked: ${sample.length}`);
  console.log(`✅ Verified correct: ${verified}`);
  console.log(`❌ Length mismatch: ${lengthMismatch}`);
  console.log(`⚠️  Not in database: ${notInDb}`);
  console.log(`❌ Errors: ${errors}`);

  if (lengthMismatch > 0 || errors > 0) {
    console.log('\n⚠️  Some WAV files have incorrect lengths!');
    process.exit(1);
  }

  console.log('\n✅ All checked WAV files have correct lengths!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
