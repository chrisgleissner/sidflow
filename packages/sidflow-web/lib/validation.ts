/**
 * Zod schemas for API request validation
 */
import { z } from 'zod';

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
  path: z.string().min(1, 'Path is required'),
});

export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

// Generic API response types
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
