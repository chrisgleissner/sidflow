import path from 'node:path';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { appendCanonicalJsonLines, ensureDir, logFeedbackBatch, type JsonValue } from '@sidflow/common';

interface FeedbackSyncPayload {
  submittedAt?: string;
  baseModelVersion?: string | null;
  ratings?: Array<Record<string, unknown>>;
  implicit?: Array<Record<string, unknown>>;
}

interface NormalizedRatingPayload {
  uuid: string;
  sidPath: string;
  songIndex: number | null;
  timestamp: number;
  ratings: Record<string, unknown>;
  source: string;
  modelVersion: string | null;
  metadata: Record<string, unknown> | null;
}

interface NormalizedImplicitPayload {
  uuid: string;
  sidPath: string;
  songIndex: number | null;
  timestamp: number;
  action: 'play' | 'play_complete' | 'like' | 'dislike' | 'skip' | 'skip_early' | 'skip_late' | 'replay';
  metadata: Record<string, unknown> | null;
}

const VALID_ACTIONS = new Set<NormalizedImplicitPayload['action']>(['play', 'play_complete', 'like', 'dislike', 'skip', 'skip_early', 'skip_late', 'replay']);

function normalizeUuid(value: unknown, prefix: string, index: number): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return `${prefix}-${Date.now()}-${index}`;
}

function normalizeSongIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeRatings(payload: FeedbackSyncPayload, fallbackTimestamp: number): NormalizedRatingPayload[] {
  return (payload.ratings ?? []).flatMap((entry, index) => {
    const sidPath = typeof entry.sidPath === 'string' ? entry.sidPath : null;
    const ratings = normalizeObject(entry.ratings);
    if (!sidPath || !ratings) {
      return [];
    }
    return [{
      uuid: normalizeUuid(entry.uuid, 'rating', index),
      sidPath,
      songIndex: normalizeSongIndex(entry.songIndex),
      timestamp: normalizeTimestamp(entry.timestamp, fallbackTimestamp),
      ratings,
      source: typeof entry.source === 'string' ? entry.source : 'explicit',
      modelVersion: typeof entry.modelVersion === 'string' ? entry.modelVersion : null,
      metadata: normalizeObject(entry.metadata),
    }];
  });
}

function normalizeImplicit(payload: FeedbackSyncPayload, fallbackTimestamp: number): NormalizedImplicitPayload[] {
  return (payload.implicit ?? []).flatMap((entry, index) => {
    const sidPath = typeof entry.sidPath === 'string' ? entry.sidPath : null;
    const action = typeof entry.action === 'string' && VALID_ACTIONS.has(entry.action as NormalizedImplicitPayload['action'])
      ? entry.action as NormalizedImplicitPayload['action']
      : null;
    if (!sidPath || !action) {
      return [];
    }
    return [{
      uuid: normalizeUuid(entry.uuid, 'implicit', index),
      sidPath,
      songIndex: normalizeSongIndex(entry.songIndex),
      timestamp: normalizeTimestamp(entry.timestamp, fallbackTimestamp),
      action,
      metadata: normalizeObject(entry.metadata),
    }];
  });
}

async function persistRawSyncBatch(
  payload: FeedbackSyncPayload,
  ratings: NormalizedRatingPayload[],
  implicit: NormalizedImplicitPayload[],
): Promise<string> {
  // Validate submittedAt: fall back to now() if absent or unparsable to prevent NaN paths.
  const parsedSubmittedAt = typeof payload.submittedAt === 'string' ? Date.parse(payload.submittedAt) : NaN;
  const submittedAt = Number.isFinite(parsedSubmittedAt) ? new Date(parsedSubmittedAt) : new Date();
  // Compute a single ISO string for all records in this batch so timestamps are consistent.
  const submittedAtIso = payload.submittedAt ?? submittedAt.toISOString();
  const year = String(submittedAt.getUTCFullYear());
  const month = String(submittedAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(submittedAt.getUTCDate()).padStart(2, '0');
  const dir = path.join(process.cwd(), 'data', 'feedback-sync', year, month, day);
  await ensureDir(dir);
  const filePath = path.join(dir, 'events.jsonl');
  const records = [
    ...ratings.map((entry) => ({ kind: 'rating', submittedAt: submittedAtIso, baseModelVersion: payload.baseModelVersion ?? null, ...entry })),
    ...implicit.map((entry) => ({ kind: 'implicit', submittedAt: submittedAtIso, baseModelVersion: payload.baseModelVersion ?? null, ...entry })),
  ];
  if (records.length > 0) {
    await appendCanonicalJsonLines(filePath, records as unknown as JsonValue[], { details: { phase: 'feedback-sync', count: records.length } });
  }
  return filePath;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as FeedbackSyncPayload;
    const fallbackTimestamp = Date.now();
    const ratings = normalizeRatings(payload, fallbackTimestamp);
    const implicit = normalizeImplicit(payload, fallbackTimestamp);
    const rawPath = await persistRawSyncBatch(payload, ratings, implicit);
    await logFeedbackBatch(
      path.join(process.cwd(), 'data', 'feedback'),
      implicit.map((entry) => ({
        sidPath: entry.sidPath,
        songIndex: entry.songIndex ?? undefined,
        action: entry.action,
        timestamp: new Date(entry.timestamp),
        uuid: entry.uuid,
      })),
    );
    if (process.env.NODE_ENV === 'development') {
      const ratingCount = ratings.length;
      const implicitCount = implicit.length;
      console.debug('[Feedback Sync API] received payload', ratingCount, implicitCount, payload.baseModelVersion ?? 'unknown');
    }
    return NextResponse.json({ success: true, stored: { ratings: ratings.length, implicit: implicit.length }, rawPath });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ success: true });
}
