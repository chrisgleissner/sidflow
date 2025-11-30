/**
 * Tests for isAlreadyClassified function
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import {
  isAlreadyClassified,
  type ClassificationPlan,
} from '@sidflow/classify';

describe('isAlreadyClassified', () => {
  let tempDir: string;
  let sidPath: string;
  let tagsPath: string;
  let wavCachePath: string;
  let plan: ClassificationPlan;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidflow-classify-test-'));
    sidPath = path.join(tempDir, 'sids');
    tagsPath = path.join(tempDir, 'tags');
    wavCachePath = path.join(tempDir, 'wav-cache');
    
    await fs.mkdir(sidPath, { recursive: true });
    await fs.mkdir(tagsPath, { recursive: true });
    await fs.mkdir(wavCachePath, { recursive: true });
    
    // Create test SID file structure
    const artistDir = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist');
    await fs.mkdir(artistDir, { recursive: true });
    
    // Create a simple SID-like file
    await fs.writeFile(path.join(artistDir, 'test_song.sid'), 'PSID');
    
    plan = {
      config: {
        sidPath,
        wavCachePath,
        tagsPath,
        threads: 1,
        classificationDepth: 3,
      },
      sidPath,
      wavCachePath,
      tagsPath,
      forceRebuild: false,
      classificationDepth: 3,
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should return false when no auto-tags.json exists', async () => {
    const sidFile = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist', 'test_song.sid');
    
    const result = await isAlreadyClassified(plan, sidFile);
    
    expect(result).toBe(false);
  });

  test('should return true when song has classification in auto-tags.json', async () => {
    const sidFile = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist', 'test_song.sid');
    
    // Create auto-tags.json with classification for the song
    const autoTagsDir = path.join(tagsPath, 'MUSICIANS', 'T', 'Test_Artist');
    await fs.mkdir(autoTagsDir, { recursive: true });
    
    const autoTags = {
      'test_song.sid': {
        e: 3,
        m: 4,
        c: 2,
        source: 'auto',
      },
    };
    
    await fs.writeFile(
      path.join(autoTagsDir, 'auto-tags.json'),
      JSON.stringify(autoTags)
    );
    
    const result = await isAlreadyClassified(plan, sidFile);
    
    expect(result).toBe(true);
  });

  test('should return false when song is not in auto-tags.json', async () => {
    const sidFile = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist', 'test_song.sid');
    
    // Create auto-tags.json with a different song
    const autoTagsDir = path.join(tagsPath, 'MUSICIANS', 'T', 'Test_Artist');
    await fs.mkdir(autoTagsDir, { recursive: true });
    
    const autoTags = {
      'other_song.sid': {
        e: 3,
        m: 4,
        c: 2,
        source: 'auto',
      },
    };
    
    await fs.writeFile(
      path.join(autoTagsDir, 'auto-tags.json'),
      JSON.stringify(autoTags)
    );
    
    const result = await isAlreadyClassified(plan, sidFile);
    
    expect(result).toBe(false);
  });

  test('should return true for multi-song SID with correct song index', async () => {
    const sidFile = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist', 'multi_song.sid');
    await fs.writeFile(sidFile, 'PSID');
    
    // Create auto-tags.json with multiple songs
    const autoTagsDir = path.join(tagsPath, 'MUSICIANS', 'T', 'Test_Artist');
    await fs.mkdir(autoTagsDir, { recursive: true });
    
    const autoTags = {
      'multi_song.sid:1': {
        e: 3,
        m: 4,
        c: 2,
        source: 'auto',
      },
      'multi_song.sid:2': {
        e: 4,
        m: 3,
        c: 3,
        source: 'auto',
      },
    };
    
    await fs.writeFile(
      path.join(autoTagsDir, 'auto-tags.json'),
      JSON.stringify(autoTags)
    );
    
    // Song 1 should be classified
    const result1 = await isAlreadyClassified(plan, sidFile, 1);
    expect(result1).toBe(true);
    
    // Song 2 should be classified
    const result2 = await isAlreadyClassified(plan, sidFile, 2);
    expect(result2).toBe(true);
    
    // Song 3 should not be classified
    const result3 = await isAlreadyClassified(plan, sidFile, 3);
    expect(result3).toBe(false);
  });

  test('should return false for malformed auto-tags.json', async () => {
    const sidFile = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist', 'test_song.sid');
    
    // Create malformed auto-tags.json
    const autoTagsDir = path.join(tagsPath, 'MUSICIANS', 'T', 'Test_Artist');
    await fs.mkdir(autoTagsDir, { recursive: true });
    
    await fs.writeFile(
      path.join(autoTagsDir, 'auto-tags.json'),
      'not valid json'
    );
    
    const result = await isAlreadyClassified(plan, sidFile);
    
    expect(result).toBe(false);
  });

  test('should return false when entry has no rating dimensions', async () => {
    const sidFile = path.join(sidPath, 'MUSICIANS', 'T', 'Test_Artist', 'test_song.sid');
    
    // Create auto-tags.json with entry but no ratings
    const autoTagsDir = path.join(tagsPath, 'MUSICIANS', 'T', 'Test_Artist');
    await fs.mkdir(autoTagsDir, { recursive: true });
    
    const autoTags = {
      'test_song.sid': {
        source: 'auto',
        // No e, m, c ratings
      },
    };
    
    await fs.writeFile(
      path.join(autoTagsDir, 'auto-tags.json'),
      JSON.stringify(autoTags)
    );
    
    const result = await isAlreadyClassified(plan, sidFile);
    
    expect(result).toBe(false);
  });
});
