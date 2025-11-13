import type { FeedbackAction, TagRatings } from '@sidflow/common';
import { recordImplicitFeedback, recordRatingFeedback } from '@/lib/feedback/worker';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { extractTrackFeatures } from '@/lib/feedback/features';

interface BaseContext {
  track: RateTrackInfo | null;
  sessionId?: string | null;
  pipeline?: string | null;
  modelVersion?: string | null;
  timestamp?: number;
}

export interface RecordRatingOptions extends BaseContext {
  ratings: TagRatings;
  source?: 'explicit' | 'implicit';
  metadata?: Record<string, unknown> | null;
}

export interface RecordImplicitOptions extends BaseContext {
  action: FeedbackAction;
  metadata?: Record<string, unknown> | null;
}

function buildCommonMetadata(context: BaseContext): Record<string, unknown> {
  if (!context.track) {
    return {};
  }
  const { track } = context;
  return {
    sessionId: context.sessionId ?? undefined,
    pipeline: context.pipeline ?? undefined,
    track: {
      sidPath: track.sidPath,
      relativePath: track.relativePath,
      filename: track.filename,
      selectedSong: track.selectedSong,
      durationSeconds: track.durationSeconds,
    },
    features: extractTrackFeatures(track),
  } satisfies Record<string, unknown>;
}

export function recordExplicitRating(options: RecordRatingOptions): void {
  const { track, ratings } = options;
  if (!track) {
    return;
  }
  const baseMetadata = buildCommonMetadata(options);
  const metadata = {
    ...baseMetadata,
    ...options.metadata,
  };
  recordRatingFeedback({
    sidPath: track.sidPath,
    songIndex: track.selectedSong ?? null,
    ratings,
    source: options.source ?? 'explicit',
    modelVersion: options.modelVersion ?? null,
    metadata,
    timestamp: options.timestamp,
  });
}

export function recordImplicitAction(options: RecordImplicitOptions): void {
  const { track } = options;
  if (!track) {
    return;
  }
  const baseMetadata = buildCommonMetadata(options);
  const metadata = {
    ...baseMetadata,
    ...options.metadata,
  };
  recordImplicitFeedback({
    sidPath: track.sidPath,
    songIndex: track.selectedSong ?? null,
    action: options.action,
    metadata,
    timestamp: options.timestamp,
  });
}
