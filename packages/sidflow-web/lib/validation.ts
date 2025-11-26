/**
 * Zod schemas for API request validation
 */
import { z } from 'zod';
import type { FetchProgressSnapshot } from './types/fetch-progress';
import type { ClassifyProgressSnapshot } from './types/classify-progress';

// Play endpoint schema
export const PlayRequestSchema = z.object({
  sid_path: z.string().min(1, 'SID path is required'),
  preset: z.enum(['quiet', 'ambient', 'energetic', 'dark', 'bright', 'complex']).optional(),
});

export type PlayRequest = z.infer<typeof PlayRequestSchema>;

// Rate endpoint schema
export const RateRequestSchema = z.object({
  sid_path: z.string().min(1, 'SID path is required'),
  ratings: z.object({
    e: z.number().min(1).max(5).int(),
    m: z.number().min(1).max(5).int(),
    c: z.number().min(1).max(5).int(),
    p: z.number().min(1).max(5).int(),
  }),
});

export type RateRequest = z.infer<typeof RateRequestSchema>;

// Classify endpoint schema
export const ClassifyRequestSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, 'Path must not be empty')
    .optional(),
  forceRebuild: z.boolean().optional(),
});

export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

// Fetch endpoint schema
export const FetchRequestSchema = z.object({
  configPath: z.string().optional(),
  remoteBaseUrl: z.string().url().optional(),
  hvscVersionPath: z.string().optional(),
});

export type FetchRequest = z.infer<typeof FetchRequestSchema>;

// Train endpoint schema
export const TrainRequestSchema = z.object({
  configPath: z.string().optional(),
  epochs: z.number().int().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  evaluate: z.boolean().optional(),
  force: z.boolean().optional(),
});

export type TrainRequest = z.infer<typeof TrainRequestSchema>;

export const RateControlRequestSchema = z.object({
  action: z.enum(['pause', 'resume', 'stop', 'seek']),
  positionSeconds: z.number().nonnegative().optional(),
});

export type RateControlRequest = z.infer<typeof RateControlRequestSchema>;

// Generic API response types
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: string;
  logs?: string;
  progress?: FetchProgressSnapshot | ClassifyProgressSnapshot;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
