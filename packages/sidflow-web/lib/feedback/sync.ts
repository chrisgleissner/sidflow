import type { FeedbackAction, TagRatings } from '@sidflow/common';
import {
  listImplicitEventCountByStatus,
  listImplicitEventsByStatus,
  listRatingEventCountByStatus,
  listRatingEventsByStatus,
  updateImplicitEvent,
  updateRatingEvent,
  type FeedbackSyncStatus,
  type ImplicitFeedbackRecord,
  type RatingEventRecord,
} from '@/lib/feedback/storage';

const SYNC_ENDPOINT = '/api/feedback/sync';
const DEFAULT_BATCH_SIZE = 50;
const MIN_CADENCE_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface FeedbackSyncConfig {
  enabled: boolean;
  cadenceMs: number;
  maxBatchSize: number;
}

export interface FeedbackSyncSummary {
  timestamp: number;
  uploadedRatings: number;
  uploadedImplicit: number;
  pendingRatings: number;
  pendingImplicit: number;
  success: boolean;
  error?: string;
}

const DEFAULT_CONFIG: FeedbackSyncConfig = {
  enabled: false,
  cadenceMs: MIN_CADENCE_MS,
  maxBatchSize: DEFAULT_BATCH_SIZE,
};

interface RatingPayload {
  uuid: string;
  sidPath: string;
  songIndex: number | null;
  ratings: TagRatings;
  source: 'explicit' | 'implicit';
  timestamp: number;
  modelVersion?: string | null;
  metadata?: Record<string, unknown> | null;
  attempts: number;
}

interface ImplicitPayload {
  uuid: string;
  sidPath: string;
  songIndex: number | null;
  action: FeedbackAction;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
  attempts: number;
}

interface SyncPayload {
  submittedAt: string;
  baseModelVersion: string | null;
  ratings: RatingPayload[];
  implicit: ImplicitPayload[];
}

function isOnline(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true;
  }
  return navigator.onLine;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      timer = null;
      reject(new Error(message));
    }, timeoutMs);
    promise
      .then((value) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve(value);
      })
      .catch((error) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        reject(error);
      });
  });
}

async function markRecords(
  records: Array<RatingEventRecord | ImplicitFeedbackRecord>,
  status: FeedbackSyncStatus,
  error?: string
): Promise<void> {
  const tasks = records.map((record) => {
    const attempts = status === 'processing' ? (record.attempts ?? 0) + 1 : record.attempts ?? 0;
    const mutated = {
      ...record,
      syncStatus: status,
      attempts,
      lastError: error,
      lastAttemptAt: Date.now(),
    } satisfies Partial<RatingEventRecord> & Partial<ImplicitFeedbackRecord>;
    Object.assign(record, {
      syncStatus: status,
      attempts,
      lastError: error,
      lastAttemptAt: mutated.lastAttemptAt,
    });
    if ('ratings' in mutated) {
      return updateRatingEvent(mutated as RatingEventRecord);
    }
    return updateImplicitEvent(mutated as ImplicitFeedbackRecord);
  });
  await Promise.all(tasks);
}

function buildPayload(
  ratings: RatingEventRecord[],
  implicit: ImplicitFeedbackRecord[],
  baseModelVersion: string | null,
  submittedAt: number
): SyncPayload {
  const ratingPayload: RatingPayload[] = ratings.map((record) => ({
    uuid: record.uuid,
    sidPath: record.sidPath,
    songIndex: record.songIndex ?? null,
    ratings: record.ratings,
    source: record.source,
    timestamp: record.timestamp,
    modelVersion: record.modelVersion ?? null,
    metadata: record.metadata ?? null,
    attempts: record.attempts,
  }));

  const implicitPayload: ImplicitPayload[] = implicit.map((record) => ({
    uuid: record.uuid,
    sidPath: record.sidPath,
    songIndex: record.songIndex ?? null,
    action: record.action,
    timestamp: record.timestamp,
    metadata: record.metadata ?? null,
    attempts: record.attempts,
  }));

  return {
    submittedAt: new Date(submittedAt).toISOString(),
    baseModelVersion,
    ratings: ratingPayload,
    implicit: implicitPayload,
  };
}

export class FeedbackSync {
  private config: FeedbackSyncConfig = { ...DEFAULT_CONFIG };
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private baseModelVersion: string | null = null;
  private listeners = new Set<(summary: FeedbackSyncSummary) => void>();

  updateConfig(patch: Partial<FeedbackSyncConfig>): void {
    this.config = {
      ...this.config,
      ...patch,
    };
    this.config.cadenceMs = Math.max(this.config.cadenceMs, MIN_CADENCE_MS);
    if (!this.config.enabled) {
      this.cancelScheduled();
    } else {
      this.schedule(5_000);
    }
  }

  setBaseModelVersion(version: string | null): void {
    this.baseModelVersion = version;
  }

  notifyPendingWork(): void {
    if (!this.config.enabled) {
      return;
    }
    this.schedule(2_500);
  }

  stop(): void {
    this.cancelScheduled();
  }

  subscribe(listener: (summary: FeedbackSyncSummary) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(summary: FeedbackSyncSummary): void {
    for (const listener of this.listeners) {
      try {
        listener(summary);
      } catch (error) {
        console.warn('[FeedbackSync] Listener failed', error);
      }
    }
  }

  private cancelScheduled(): void {
    if (this.scheduled) {
      clearTimeout(this.scheduled);
      this.scheduled = null;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.config.enabled) {
      return;
    }
    if (this.scheduled) {
      clearTimeout(this.scheduled);
    }
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      void this.runOnce();
    }, Math.max(delayMs, 0));
  }

  private async runOnce(): Promise<void> {
    if (!this.config.enabled || this.running) {
      return;
    }
    if (!isOnline()) {
      this.schedule(this.config.cadenceMs);
      return;
    }

    this.running = true;
    const attemptStarted = Date.now();
    let uploadedRatings = 0;
    let uploadedImplicit = 0;
    let error: string | undefined;

    try {
      const [ratings, implicit] = await Promise.all([
        listRatingEventsByStatus(['pending', 'failed'], this.config.maxBatchSize),
        listImplicitEventsByStatus(['pending', 'failed'], this.config.maxBatchSize),
      ]);

      if (ratings.length === 0 && implicit.length === 0) {
        await this.refreshCounts(attemptStarted, true);
        this.schedule(this.config.cadenceMs);
        return;
      }

      await Promise.all([
        markRecords(ratings, 'processing'),
        markRecords(implicit, 'processing'),
      ]);

      const payload = buildPayload(ratings, implicit, this.baseModelVersion, attemptStarted);
      const response = await withTimeout(
        fetch(SYNC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        REQUEST_TIMEOUT_MS,
        'Feedback sync request timed out'
      );

      if (!response.ok) {
        error = `Sync failed with status ${response.status}`;
        throw new Error(error);
      }

      uploadedRatings = ratings.length;
      uploadedImplicit = implicit.length;
      await Promise.all([
        markRecords(ratings, 'synced'),
        markRecords(implicit, 'synced'),
      ]);
      await this.refreshCounts(attemptStarted, true, uploadedRatings, uploadedImplicit);
      this.schedule(5_000);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await this.handleFailure(error, attemptStarted);
    } finally {
      this.running = false;
    }
  }

  private async handleFailure(error: string, timestamp: number): Promise<void> {
    console.warn('[FeedbackSync] Upload failed', error);
    await Promise.all([
      this.markProcessingAs('failed', error),
    ]);
    await this.refreshCounts(timestamp, false, 0, 0, error);
    this.schedule(this.config.cadenceMs);
  }

  private async markProcessingAs(status: FeedbackSyncStatus, error?: string): Promise<void> {
    const [ratings, implicit] = await Promise.all([
      listRatingEventsByStatus(['processing']),
      listImplicitEventsByStatus(['processing']),
    ]);
    if (ratings.length === 0 && implicit.length === 0) {
      return;
    }
    await Promise.all([
      markRecords(ratings, status, error),
      markRecords(implicit, status, error),
    ]);
  }

  private async refreshCounts(
    timestamp: number,
    success: boolean,
    uploadedRatings: number = 0,
    uploadedImplicit: number = 0,
    error?: string
  ): Promise<void> {
    const [ratingCounts, implicitCounts] = await Promise.all([
      listRatingEventCountByStatus(),
      listImplicitEventCountByStatus(),
    ]);
    const summary: FeedbackSyncSummary = {
      timestamp,
      uploadedRatings,
      uploadedImplicit,
      pendingRatings: ratingCounts.pending,
      pendingImplicit: implicitCounts.pending,
      success,
      error,
    };
    this.emit(summary);
  }
}
