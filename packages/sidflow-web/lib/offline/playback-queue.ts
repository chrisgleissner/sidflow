import {
  deletePlaybackQueueRecord,
  enqueuePlaybackQueueRecord,
  getPlaybackQueueRecords,
  type PlaybackQueueKind,
  type PlaybackQueueRecord,
  updatePlaybackQueueRecord,
} from '@/lib/preferences/storage';

function createPayload(kind: PlaybackQueueKind, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    kind,
  };
}

export async function enqueuePlaylistRebuild(preset: string | null): Promise<void> {
  const existing = await getPlaybackQueueRecords();
  const alreadyQueued = existing.find((record) => record.kind === 'rebuild-playlist');
  if (alreadyQueued) {
    alreadyQueued.payload = createPayload('rebuild-playlist', { preset });
    alreadyQueued.status = 'pending';
    await updatePlaybackQueueRecord(alreadyQueued);
    return;
  }
  await enqueuePlaybackQueueRecord({
    kind: 'rebuild-playlist',
    payload: createPayload('rebuild-playlist', { preset }),
  });
}

export async function enqueuePlayNext(): Promise<void> {
  await enqueuePlaybackQueueRecord({
    kind: 'play-next',
    payload: createPayload('play-next', {}),
  });
}

export async function countPendingPlaybackRequests(): Promise<number> {
  const records = await getPlaybackQueueRecords();
  const pending = records.filter((record) => record.status === 'pending' || record.status === 'failed');
  console.debug(
    '[PlaybackQueue] Pending count computed',
    JSON.stringify({
      total: records.length,
      pending: pending.map((record) => ({
        id: record.id ?? null,
        kind: record.kind,
        status: record.status,
        attempts: record.attempts,
        lastError: record.lastError ?? null,
      })),
    })
  );
  return pending.length;
}

export async function flushPlaybackQueue(
  handler: (record: PlaybackQueueRecord) => Promise<void>
): Promise<void> {
  const records = await getPlaybackQueueRecords();
  const pending = records
    .filter((record) => record.status === 'pending' || record.status === 'failed')
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  if (pending.length > 0) {
    console.debug('[PlaybackQueue] Flushing queued actions', pending);
  }
  for (const record of pending) {
    record.status = 'pending';
    try {
      await handler(record);
      if (typeof record.id === 'number') {
        console.debug('[PlaybackQueue] Removing processed action', record);
        await deletePlaybackQueueRecord(record.id);
      }
    } catch (error) {
      record.status = 'failed';
      record.attempts += 1;
      record.lastError = error instanceof Error ? error.message : String(error);
      record.lastAttemptAt = Date.now();
      console.warn('[PlaybackQueue] Action failed during flush', {
        record,
        error: error instanceof Error ? error.message : String(error),
      });
      await updatePlaybackQueueRecord(record);
    }
  }
}
