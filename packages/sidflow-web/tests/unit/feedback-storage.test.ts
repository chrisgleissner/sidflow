import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';

import {
  __resetFeedbackStorageForTests,
  enqueueImplicitEvents,
  enqueueRatingEvents,
  listImplicitEventsByStatus,
  listRatingEventCountByStatus,
  listRatingEventsByStatus,
  listRatingEventsForTraining,
  readLatestModelSnapshot,
  storeModelSnapshot,
  updateImplicitEvent,
  updateRatingEvent,
} from '@/lib/feedback/storage';
import type { TagRatings } from '@sidflow/common';

const ratings: TagRatings = { e: 4, m: 3, c: 5 };

beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
});

beforeEach(async () => {
  await __resetFeedbackStorageForTests();
});

describe('feedback IndexedDB storage', () => {
  it('stores and retrieves rating events by status', async () => {
    const [pendingUuid, syncedUuid] = ['uuid-pending', 'uuid-synced'];
    await enqueueRatingEvents([
      { uuid: pendingUuid, sidPath: 'test.sid', ratings, timestamp: 1000, source: 'explicit' },
      { uuid: syncedUuid, sidPath: 'test.sid', ratings, timestamp: 2000, syncStatus: 'synced', source: 'explicit' },
    ]);

    const pending = await listRatingEventsByStatus(['pending']);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.uuid).toBe(pendingUuid);

    const synced = await listRatingEventsByStatus(['synced']);
    expect(synced).toHaveLength(1);
    expect(synced[0]?.uuid).toBe(syncedUuid);
  });

  it('updates rating event status and increments attempts', async () => {
  await enqueueRatingEvents([{ uuid: 'uuid-1', sidPath: 'song.sid', ratings, timestamp: 123, source: 'explicit' }]);
    const [event] = await listRatingEventsByStatus(['pending']);
    expect(event).toBeTruthy();
    if (!event) {
      throw new Error('expected rating event');
    }
    event.syncStatus = 'processing';
    event.attempts += 1;
    event.lastAttemptAt = 456;
    await updateRatingEvent(event);
    const [updated] = await listRatingEventsByStatus(['processing']);
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastAttemptAt).toBe(456);
  });

  it('lists rating events for training ordered by recency', async () => {
    await enqueueRatingEvents([
      { uuid: 'uuid-1', sidPath: 'song.sid', ratings, timestamp: 200, source: 'explicit' },
      { uuid: 'uuid-2', sidPath: 'song.sid', ratings, timestamp: 100, source: 'explicit' },
    ]);
    const events = await listRatingEventsForTraining('song.sid');
    const uuids = events.map((event) => event.uuid);
    expect(uuids).toEqual(['uuid-1', 'uuid-2']);
  });

  it('counts rating events grouped by status', async () => {
    await enqueueRatingEvents([
      { uuid: 'uuid-1', sidPath: 'song.sid', ratings, timestamp: 1, source: 'explicit' },
      { uuid: 'uuid-2', sidPath: 'song.sid', ratings, timestamp: 2, syncStatus: 'synced', source: 'explicit' },
      { uuid: 'uuid-3', sidPath: 'song.sid', ratings, timestamp: 3, syncStatus: 'synced', source: 'explicit' },
    ]);
    const counts = await listRatingEventCountByStatus();
    expect(counts).toEqual({ pending: 1, processing: 0, synced: 2, failed: 0 });
  });

  it('stores and updates implicit feedback events', async () => {
    await enqueueImplicitEvents([
      { uuid: 'implicit-1', sidPath: 'song.sid', action: 'play', timestamp: 10 },
    ]);
    const [event] = await listImplicitEventsByStatus(['pending']);
    expect(event?.action).toBe('play');
    if (!event) {
      throw new Error('expected implicit event');
    }
    event.syncStatus = 'synced';
    await updateImplicitEvent(event);
    const [synced] = await listImplicitEventsByStatus(['synced']);
    expect(synced?.uuid).toBe('implicit-1');
  });

  it('stores and reads latest model snapshot', async () => {
    await storeModelSnapshot({
      modelVersion: 'v1',
      metadata: { accuracy: 0.9 },
      createdAt: 100,
    });
    await storeModelSnapshot({ modelVersion: 'v2', createdAt: 200 });
    const latest = await readLatestModelSnapshot();
    expect(latest?.modelVersion).toBe('v2');
    expect(latest?.metadata).toEqual(null);
  });
});
