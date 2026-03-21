/**
 * Tests for packages/sidflow-web/lib/feedback/recorder.ts
 *
 * Integration-style: calls the real worker and reads from storage (fake-indexeddb)
 * to verify that recorder builds the correct payload. No mock.module() is used
 * here to avoid polluting the module registry for feedback-worker.test.ts.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import {
  __resetFeedbackStorageForTests,
  listImplicitEventsByStatus,
  listRatingEventsByStatus,
} from '@/lib/feedback/storage';
import { __flushFeedbackWorkerForTests } from '@/lib/feedback/worker';
import { recordExplicitRating, recordImplicitAction } from '@/lib/feedback/recorder';
import type { RecordRatingOptions, RecordImplicitOptions } from '@/lib/feedback/recorder';
import type { RateTrackInfo } from '@/lib/types/rate-track';

// ─── IndexedDB setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
  if (!globalThis.window.indexedDB) {
    (globalThis.window as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  }
  if (!globalThis.IDBKeyRange) {
    (globalThis.window as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  }
});

beforeEach(async () => {
  await __flushFeedbackWorkerForTests();
  await __resetFeedbackStorageForTests();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTrack(): RateTrackInfo {
  return {
    sidPath: '/hvsc/Test/Song.sid',
    relativePath: 'Test/Song.sid',
    filename: 'Song.sid',
    selectedSong: 1,
    durationSeconds: 180,
    metadata: {},
  } as RateTrackInfo;
}

async function flushAndGetRatings() {
  await __flushFeedbackWorkerForTests();
  return listRatingEventsByStatus(['pending']);
}

async function flushAndGetImplicit() {
  await __flushFeedbackWorkerForTests();
  return listImplicitEventsByStatus(['pending']);
}

// ─── recordExplicitRating ────────────────────────────────────────────────────

describe('recordExplicitRating', () => {
  it('stores correct sidPath and ratings', async () => {
    const options: RecordRatingOptions = {
      track: makeTrack(),
      ratings: { e: 5, m: 3, c: 4 },
    };
    recordExplicitRating(options);
    const events = await flushAndGetRatings();
    expect(events).toHaveLength(1);
    expect(events[0]?.sidPath).toBe('/hvsc/Test/Song.sid');
    expect(events[0]?.ratings).toEqual({ e: 5, m: 3, c: 4 });
  });

  it('does nothing when track is null', async () => {
    const options: RecordRatingOptions = {
      track: null,
      ratings: { e: 5, m: 3, c: 4 },
    };
    recordExplicitRating(options);
    const events = await flushAndGetRatings();
    expect(events).toHaveLength(0);
  });

  it('defaults source to "explicit"', async () => {
    recordExplicitRating({ track: makeTrack(), ratings: { e: 3 } });
    const events = await flushAndGetRatings();
    expect(events[0]?.source).toBe('explicit');
  });

  it('passes custom source override', async () => {
    recordExplicitRating({ track: makeTrack(), ratings: { e: 3 }, source: 'implicit' });
    const events = await flushAndGetRatings();
    expect(events[0]?.source).toBe('implicit');
  });

  it('forwards sessionId via metadata', async () => {
    recordExplicitRating({ track: makeTrack(), ratings: { e: 3 }, sessionId: 'sess-42' });
    const events = await flushAndGetRatings();
    const metadata = events[0]?.metadata as Record<string, unknown>;
    expect(metadata.sessionId).toBe('sess-42');
  });

  it('merges caller-supplied metadata with base metadata', async () => {
    recordExplicitRating({
      track: makeTrack(),
      ratings: { e: 3 },
      metadata: { custom: 'value' },
    });
    const events = await flushAndGetRatings();
    const metadata = events[0]?.metadata as Record<string, unknown>;
    expect(metadata.custom).toBe('value');
    expect(metadata.track).toBeDefined();
  });

  it('forwards songIndex from selectedSong', async () => {
    const track = makeTrack();
    track.selectedSong = 3;
    recordExplicitRating({ track, ratings: { e: 3 } });
    const events = await flushAndGetRatings();
    expect(events[0]?.songIndex).toBe(3);
  });

  it('forwards modelVersion when provided', async () => {
    recordExplicitRating({
      track: makeTrack(),
      ratings: { e: 3 },
      modelVersion: 'v1.2.3',
    });
    const events = await flushAndGetRatings();
    expect(events[0]?.modelVersion).toBe('v1.2.3');
  });

  it('defaults modelVersion to null when not provided', async () => {
    recordExplicitRating({ track: makeTrack(), ratings: { e: 3 } });
    const events = await flushAndGetRatings();
    expect(events[0]?.modelVersion).toBeNull();
  });
});

// ─── recordImplicitAction ─────────────────────────────────────────────────────

describe('recordImplicitAction', () => {
  it('stores correct sidPath and action', async () => {
    const options: RecordImplicitOptions = {
      track: makeTrack(),
      action: 'play',
    };
    recordImplicitAction(options);
    const events = await flushAndGetImplicit();
    expect(events).toHaveLength(1);
    expect(events[0]?.sidPath).toBe('/hvsc/Test/Song.sid');
    expect(events[0]?.action).toBe('play');
  });

  it('does nothing when track is null', async () => {
    const options: RecordImplicitOptions = {
      track: null,
      action: 'skip',
    };
    recordImplicitAction(options);
    const events = await flushAndGetImplicit();
    expect(events).toHaveLength(0);
  });

  it('passes pipeline context via metadata', async () => {
    recordImplicitAction({
      track: makeTrack(),
      action: 'skip',
      pipeline: 'station-v2',
    });
    const events = await flushAndGetImplicit();
    const metadata = events[0]?.metadata as Record<string, unknown>;
    expect(metadata.pipeline).toBe('station-v2');
  });

  it('merges caller-supplied metadata', async () => {
    recordImplicitAction({
      track: makeTrack(),
      action: 'like',
      metadata: { extra: 'data' },
    });
    const events = await flushAndGetImplicit();
    const metadata = events[0]?.metadata as Record<string, unknown>;
    expect(metadata.extra).toBe('data');
  });

  it('forwards timestamp when provided', async () => {
    const ts = 1711000000000;
    recordImplicitAction({ track: makeTrack(), action: 'play', timestamp: ts });
    const events = await flushAndGetImplicit();
    expect(events[0]?.timestamp).toBe(ts);
  });
});
