import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  __resetFeedbackStorageForTests,
  enqueueImplicitEvents,
  enqueueRatingEvents,
  listImplicitEventsByStatus,
  listImplicitEventCountByStatus,
  listRatingEventCountByStatus,
  listRatingEventsByStatus,
  listRatingEventsForTraining,
  readLatestModelSnapshot,
  storeModelSnapshot,
  updateImplicitEvent,
  updateRatingEvent,
  deleteRatingEvent,
  deleteImplicitEvent,
} from '@/lib/feedback/storage';
import type { TagRatings } from '@sidflow/common';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const ratings: TagRatings = { e: 4, m: 3, c: 5 };

beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  }
  if (!globalThis.window.indexedDB) {
    (globalThis.window as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  }
  if (!globalThis.IDBKeyRange) {
    (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
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

// ─── additional coverage ──────────────────────────────────────────────────────

describe('feedback storage — additional paths', () => {
  it('returns empty array when no rating events are stored', async () => {
    const events = await listRatingEventsByStatus(['pending']);
    expect(events).toHaveLength(0);
  });

  it('returns empty array when no implicit events are stored', async () => {
    const events = await listImplicitEventsByStatus(['pending']);
    expect(events).toHaveLength(0);
  });

  it('returns null from readLatestModelSnapshot when no snapshot stored', async () => {
    const snapshot = await readLatestModelSnapshot();
    expect(snapshot).toBeNull();
  });

  it('listRatingEventsForTraining returns all for any sidPath when none specified', async () => {
    await enqueueRatingEvents([
      { uuid: 'a-1', sidPath: 'a.sid', ratings, timestamp: 10, source: 'explicit' },
      { uuid: 'b-1', sidPath: 'b.sid', ratings, timestamp: 20, source: 'explicit' },
    ]);
    const events = await listRatingEventsForTraining();
    expect(events).toHaveLength(2);
  });

  it('listRatingEventsForTraining filters by sidPath', async () => {
    await enqueueRatingEvents([
      { uuid: 'a-1', sidPath: 'a.sid', ratings, timestamp: 10, source: 'explicit' },
      { uuid: 'b-1', sidPath: 'b.sid', ratings, timestamp: 20, source: 'explicit' },
    ]);
    const events = await listRatingEventsForTraining('a.sid');
    expect(events).toHaveLength(1);
    expect(events[0]?.sidPath).toBe('a.sid');
  });

  it('listRatingEventsByStatus accepts multiple statuses', async () => {
    await enqueueRatingEvents([
      { uuid: 'p-1', sidPath: 's.sid', ratings, timestamp: 1, source: 'explicit' },
      { uuid: 's-1', sidPath: 's.sid', ratings, timestamp: 2, syncStatus: 'synced', source: 'explicit' },
      { uuid: 'f-1', sidPath: 's.sid', ratings, timestamp: 3, syncStatus: 'failed', source: 'explicit' },
    ]);
    const results = await listRatingEventsByStatus(['pending', 'failed']);
    expect(results).toHaveLength(2);
  });

  it('listRatingEventsByStatus respects limit', async () => {
    await enqueueRatingEvents([
      { uuid: 'u1', sidPath: 's.sid', ratings, timestamp: 1, source: 'explicit' },
      { uuid: 'u2', sidPath: 's.sid', ratings, timestamp: 2, source: 'explicit' },
      { uuid: 'u3', sidPath: 's.sid', ratings, timestamp: 3, source: 'explicit' },
    ]);
    const results = await listRatingEventsByStatus(['pending'], 2);
    expect(results).toHaveLength(2);
  });

  it('deleteRatingEvent removes the specified event', async () => {
    await enqueueRatingEvents([
      { uuid: 'del-1', sidPath: 'del.sid', ratings, timestamp: 1, source: 'explicit' },
    ]);
    const [event] = await listRatingEventsByStatus(['pending']);
    expect(event?.id).toBeDefined();
    if (!event?.id) return;
    await deleteRatingEvent(event.id);
    const after = await listRatingEventsByStatus(['pending']);
    expect(after).toHaveLength(0);
  });

  it('deleteImplicitEvent removes the specified event', async () => {
    await enqueueImplicitEvents([
      { uuid: 'del-impl-1', sidPath: 'del.sid', action: 'skip', timestamp: 1 },
    ]);
    const [event] = await listImplicitEventsByStatus(['pending']);
    expect(event?.id).toBeDefined();
    if (!event?.id) return;
    await deleteImplicitEvent(event.id);
    const after = await listImplicitEventsByStatus(['pending']);
    expect(after).toHaveLength(0);
  });

  it('listImplicitEventCountByStatus returns correct counts', async () => {
    await enqueueImplicitEvents([
      { uuid: 'ic-1', sidPath: 's.sid', action: 'play', timestamp: 1 },
      { uuid: 'ic-2', sidPath: 's.sid', action: 'skip', timestamp: 2 },
    ]);
    const counts = await listImplicitEventCountByStatus();
    expect(counts.pending).toBe(2);
    expect(counts.synced).toBe(0);
  });

  it('enqueues multiple rating events and all are stored', async () => {
    await enqueueRatingEvents([
      { uuid: 'multi-1', sidPath: 's.sid', ratings, timestamp: 1, source: 'explicit' },
      { uuid: 'multi-2', sidPath: 's.sid', ratings, timestamp: 2, source: 'explicit' },
    ]);
    const events = await listRatingEventsByStatus(['pending']);
    expect(events).toHaveLength(2);
  });

  it('enqueues multiple implicit events and all are stored', async () => {
    await enqueueImplicitEvents([
      { uuid: 'imp-1', sidPath: 's.sid', action: 'play', timestamp: 1 },
      { uuid: 'imp-2', sidPath: 's.sid', action: 'skip', timestamp: 2 },
    ]);
    const events = await listImplicitEventsByStatus(['pending']);
    expect(events).toHaveLength(2);
  });

  it('rating events default to pending status', async () => {
    await enqueueRatingEvents([{ uuid: 'def-1', sidPath: 's.sid', ratings, timestamp: 1, source: 'explicit' }]);
    const [event] = await listRatingEventsByStatus(['pending']);
    expect(event?.syncStatus).toBe('pending');
    expect(event?.attempts).toBe(0);
  });

  it('listImplicitEventsByStatus respects limit', async () => {
    await enqueueImplicitEvents([
      { uuid: 'lim-1', sidPath: 's.sid', action: 'play', timestamp: 1 },
      { uuid: 'lim-2', sidPath: 's.sid', action: 'skip', timestamp: 2 },
      { uuid: 'lim-3', sidPath: 's.sid', action: 'like', timestamp: 3 },
    ]);
    const results = await listImplicitEventsByStatus(['pending'], 2);
    expect(results).toHaveLength(2);
  });
});
