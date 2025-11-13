import type { TagRatings } from '@sidflow/common';
import type { FeedbackAction } from '@sidflow/common';
import {
  enqueueImplicitEvents,
  enqueueRatingEvents,
  type ImplicitEventInsert,
  type RatingEventInsert,
} from '@/lib/feedback/storage';
import { emitFeedbackEvent } from '@/lib/feedback/events';

const DEFAULT_FLUSH_DELAY_MS = 500;
const MAX_BATCH_SIZE = 25;

export interface RatingFeedbackInput {
  sidPath: string;
  songIndex?: number | null;
  ratings: TagRatings;
  source?: 'explicit' | 'implicit';
  timestamp?: number;
  modelVersion?: string | null;
  metadata?: Record<string, unknown> | null;
  uuid?: string;
}

export interface ImplicitFeedbackInput {
  sidPath: string;
  songIndex?: number | null;
  action: FeedbackAction;
  timestamp?: number;
  metadata?: Record<string, unknown> | null;
  uuid?: string;
}

interface QueueState<T> {
  buffer: T[];
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fb-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

class FeedbackWorker {
  private ratingQueue: QueueState<RatingFeedbackInput> = { buffer: [] };
  private implicitQueue: QueueState<ImplicitFeedbackInput> = { buffer: [] };
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
  }

  enqueueRating(event: RatingFeedbackInput): void {
    this.ratingQueue.buffer.push({ ...event });
    this.scheduleFlush();
  }

  enqueueImplicit(event: ImplicitFeedbackInput): void {
    this.implicitQueue.buffer.push({ ...event });
    this.scheduleFlush();
  }

  private scheduleFlush(delay: number = DEFAULT_FLUSH_DELAY_MS): void {
    if (!this.started) {
      this.started = true;
    }
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.isFlushing) {
      return;
    }
    this.isFlushing = true;
    try {
      await this.processQueue(this.ratingQueue, mapRatingInput, async (records) => {
        await enqueueRatingEvents(records);
      });
      await this.processQueue(this.implicitQueue, mapImplicitInput, async (records) => {
        await enqueueImplicitEvents(records);
      });
    } catch (error) {
      console.warn('[FeedbackWorker] Failed to flush feedback queue', error);
      this.scheduleFlush(DEFAULT_FLUSH_DELAY_MS * 2);
    } finally {
      this.isFlushing = false;
    }
    if (this.ratingQueue.buffer.length > 0 || this.implicitQueue.buffer.length > 0) {
      this.scheduleFlush(DEFAULT_FLUSH_DELAY_MS);
    }
  }

  private async processQueue<TInput, TInsert>(
    queue: QueueState<TInput>,
    mapper: (input: TInput) => TInsert,
  persist: (records: TInsert[]) => Promise<unknown>,
  ): Promise<void> {
    while (queue.buffer.length > 0) {
      const batch = queue.buffer.splice(0, MAX_BATCH_SIZE);
      try {
        await persist(batch.map(mapper));
      } catch (error) {
        queue.buffer = [...batch, ...queue.buffer];
        throw error;
      }
    }
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

function mapRatingInput(input: RatingFeedbackInput): RatingEventInsert {
  return {
    uuid: input.uuid ?? generateUuid(),
    sidPath: input.sidPath,
    songIndex: input.songIndex ?? null,
    ratings: input.ratings,
    source: input.source ?? 'explicit',
    timestamp: input.timestamp ?? Date.now(),
    modelVersion: input.modelVersion ?? null,
    metadata: input.metadata ?? null,
  };
}

function mapImplicitInput(input: ImplicitFeedbackInput): ImplicitEventInsert {
  return {
    uuid: input.uuid ?? generateUuid(),
    sidPath: input.sidPath,
    songIndex: input.songIndex ?? null,
    action: input.action,
    timestamp: input.timestamp ?? Date.now(),
    metadata: input.metadata ?? null,
  };
}

const worker = new FeedbackWorker();

export function recordRatingFeedback(event: RatingFeedbackInput): void {
  worker.start();
  worker.enqueueRating(event);
  emitFeedbackEvent('rating');
}

export function recordImplicitFeedback(event: ImplicitFeedbackInput): void {
  worker.start();
  worker.enqueueImplicit(event);
  emitFeedbackEvent('implicit');
}

export async function __flushFeedbackWorkerForTests(): Promise<void> {
  await worker.flushNow();
}
