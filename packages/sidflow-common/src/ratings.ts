export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const DEFAULT_RATING = 3;

export interface TagRatings {
  s: number;
  m: number;
  c: number;
}

export const DEFAULT_RATINGS: TagRatings = {
  s: DEFAULT_RATING,
  m: DEFAULT_RATING,
  c: DEFAULT_RATING
} as const;

export function clampRating(value: number): number {
  if (Number.isNaN(value)) {
    return DEFAULT_RATING;
  }
  return Math.min(RATING_MAX, Math.max(RATING_MIN, value));
}
