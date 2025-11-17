import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  __resetFeedbackStorageForTests,
  listImplicitEventsByStatus,
  listRatingEventsByStatus,
} from '@/lib/feedback/storage';
import { __flushFeedbackWorkerForTests, recordImplicitFeedback, recordRatingFeedback } from '@/lib/feedback/worker';
import type { TagRatings } from '@sidflow/common';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const ratings: TagRatings = { e: 5, m: 4, c: 3 };

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

describe('feedback worker', () => {
  it('persists rating feedback via background flush', async () => {
    recordRatingFeedback({ sidPath: 'song.sid', ratings });
    await __flushFeedbackWorkerForTests();
    const events = await listRatingEventsByStatus(['pending']);
    expect(events).toHaveLength(1);
    expect(events[0]?.sidPath).toBe('song.sid');
    expect(events[0]?.source).toBe('explicit');
  });

  it('persists implicit feedback via background flush', async () => {
    recordImplicitFeedback({ sidPath: 'song.sid', action: 'play' });
    await __flushFeedbackWorkerForTests();
    const events = await listImplicitEventsByStatus(['pending']);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('play');
  });

  it('assigns uuids when not provided', async () => {
    recordRatingFeedback({ sidPath: 'song.sid', ratings });
    await __flushFeedbackWorkerForTests();
    const events = await listRatingEventsByStatus(['pending']);
    expect(events[0]?.uuid).toMatch(/[a-z0-9-]{8,}/);
  });
});
