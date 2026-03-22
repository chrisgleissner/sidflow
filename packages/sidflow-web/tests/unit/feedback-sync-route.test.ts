import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { POST } from '@/app/api/feedback/sync/route';

describe('feedback sync route', () => {
  let workspace: string;
  let originalCwd: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'sidflow-feedback-sync-'));
    originalCwd = process.cwd();
    process.chdir(workspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(workspace, { recursive: true, force: true });
  });

  it('persists raw sync batches and aggregate-friendly implicit feedback events', async () => {
    const payload = {
      submittedAt: '2026-03-22T12:00:00.000Z',
      baseModelVersion: 'model-1',
      ratings: [
        {
          uuid: 'rating-1',
          sidPath: 'MUSICIANS/A/Artist/rated.sid',
          songIndex: 2,
          timestamp: Date.parse('2026-03-22T11:59:00.000Z'),
          ratings: { e: 5, m: 4, c: 4 },
          source: 'explicit',
        },
      ],
      implicit: [
        {
          uuid: 'implicit-1',
          sidPath: 'MUSICIANS/A/Artist/skip.sid',
          songIndex: 1,
          timestamp: Date.parse('2026-03-22T11:58:00.000Z'),
          action: 'skip_early',
        },
        {
          uuid: 'implicit-2',
          sidPath: 'MUSICIANS/A/Artist/replay.sid',
          songIndex: 1,
          timestamp: Date.parse('2026-03-22T11:57:00.000Z'),
          action: 'replay',
        },
      ],
    };

    const response = await POST(new Request('http://localhost/api/feedback/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }) as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.stored).toEqual({ ratings: 1, implicit: 2 });

    const rawLog = path.join(workspace, 'data', 'feedback-sync', '2026', '03', '22', 'events.jsonl');
    const feedbackLog = path.join(workspace, 'data', 'feedback', '2026', '03', '22', 'events.jsonl');
    const rawLines = (await readFile(rawLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const feedbackLines = (await readFile(feedbackLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    expect(rawLines).toHaveLength(3);
    expect(rawLines.map((line) => line.kind)).toEqual(['rating', 'implicit', 'implicit']);
    expect(feedbackLines).toHaveLength(2);
    expect(feedbackLines.map((line) => line.action)).toEqual(['skip_early', 'replay']);
  });
});