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
  return records.filter((record) => record.status === 'pending' || record.status === 'failed').length;
}

export async function flushPlaybackQueue(
  handler: (record: PlaybackQueueRecord) => Promise<void>
): Promise<void> {
  const records = await getPlaybackQueueRecords();
  const pending = records
    .filter((record) => record.status === 'pending' || record.status === 'failed')
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  for (const record of pending) {
    record.status = 'pending';
    try {
      await handler(record);
      if (typeof record.id === 'number') {
        await deletePlaybackQueueRecord(record.id);
      }
    } catch (error) {
      record.status = 'failed';
      record.attempts += 1;
      record.lastError = error instanceof Error ? error.message : String(error);
      record.lastAttemptAt = Date.now();
      await updatePlaybackQueueRecord(record);
    }
  }
}
