/**
 * Render matrix validation
 * Based on doc/plans/scale/plan.md Render Matrix
 */

export type RenderLocation = 'server' | 'client';
export type RenderTime = 'prepared' | 'realtime';
export type RenderTechnology = 'wasm' | 'sidplayfp-cli' | 'ultimate64';
export type RenderTarget = 'wav-m4a-flac' | 'playback-only';

export interface RenderMode {
  readonly location: RenderLocation;
  readonly time: RenderTime;
  readonly technology: RenderTechnology;
  readonly target: RenderTarget;
}

export interface RenderMatrixEntry {
  readonly location: RenderLocation;
  readonly time: RenderTime;
  readonly technology: RenderTechnology;
  readonly target: RenderTarget;
  readonly typicalUse: string;
  readonly status: 'mvp' | 'future';
}

/**
 * Render matrix defining supported combinations
 * Based on doc/plans/scale/plan.md
 */
export const RENDER_MATRIX: readonly RenderMatrixEntry[] = [
  // Server prepared renders
  {
    location: 'server',
    time: 'prepared',
    technology: 'sidplayfp-cli',
    target: 'wav-m4a-flac',
    typicalUse: 'Batch classify conversions to cache',
    status: 'mvp',
  },
  {
    location: 'server',
    time: 'prepared',
    technology: 'wasm',
    target: 'wav-m4a-flac',
    typicalUse: 'Portable render where CLI unavailable',
    status: 'mvp',
  },
  {
    location: 'server',
    time: 'prepared',
    technology: 'ultimate64',
    target: 'wav-m4a-flac',
    typicalUse: 'Hardware-authentic captures',
    status: 'mvp',
  },
  // Server real-time renders
  {
    location: 'server',
    time: 'realtime',
    technology: 'ultimate64',
    target: 'wav-m4a-flac',
    typicalUse: 'Hardware-authentic live streams',
    status: 'mvp',
  },
  // Client real-time playback
  {
    location: 'client',
    time: 'realtime',
    technology: 'wasm',
    target: 'playback-only',
    typicalUse: 'Default playback',
    status: 'mvp',
  },
  {
    location: 'client',
    time: 'realtime',
    technology: 'sidplayfp-cli',
    target: 'playback-only',
    typicalUse: 'Optional local playback',
    status: 'future',
  },
  {
    location: 'client',
    time: 'realtime',
    technology: 'ultimate64',
    target: 'playback-only',
    typicalUse: 'Local hardware playback',
    status: 'mvp',
  },
] as const;

export interface RenderModeValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly suggestedAlternatives?: RenderMode[];
}

/**
 * Validate a render mode against the render matrix
 */
export function validateRenderMode(mode: RenderMode): RenderModeValidationResult {
  // Check if exact match exists in matrix
  const exactMatch = RENDER_MATRIX.find(
    (entry) =>
      entry.location === mode.location &&
      entry.time === mode.time &&
      entry.technology === mode.technology &&
      entry.target === mode.target
  );

  if (exactMatch) {
    if (exactMatch.status === 'mvp') {
      return { valid: true };
    } else {
      return {
        valid: false,
        reason: `Render mode combination is planned but not yet implemented (status: ${exactMatch.status})`,
        suggestedAlternatives: getSuggestedAlternatives(mode),
      };
    }
  }

  // No match found - invalid combination
  return {
    valid: false,
    reason: 'Unsupported render mode combination',
    suggestedAlternatives: getSuggestedAlternatives(mode),
  };
}

/**
 * Get suggested alternative render modes
 */
function getSuggestedAlternatives(mode: RenderMode): RenderMode[] {
  const alternatives: RenderMode[] = [];

  // Find similar modes in the matrix
  const similarModes = RENDER_MATRIX.filter(
    (entry) =>
      entry.status === 'mvp' &&
      (entry.location === mode.location ||
        entry.technology === mode.technology ||
        entry.target === mode.target)
  );

  for (const entry of similarModes) {
    alternatives.push({
      location: entry.location,
      time: entry.time,
      technology: entry.technology,
      target: entry.target,
    });
  }

  return alternatives;
}

/**
 * Get all supported render modes with MVP status
 */
export function getSupportedRenderModes(): RenderMode[] {
  return RENDER_MATRIX.filter((entry) => entry.status === 'mvp').map((entry) => ({
    location: entry.location,
    time: entry.time,
    technology: entry.technology,
    target: entry.target,
  }));
}

/**
 * Get render modes by location
 */
export function getRenderModesByLocation(location: RenderLocation): RenderMatrixEntry[] {
  return RENDER_MATRIX.filter((entry) => entry.location === location && entry.status === 'mvp');
}

/**
 * Get render modes by technology
 */
export function getRenderModesByTechnology(technology: RenderTechnology): RenderMatrixEntry[] {
  return RENDER_MATRIX.filter(
    (entry) => entry.technology === technology && entry.status === 'mvp'
  );
}

/**
 * Check if a technology is available for a specific location and time
 */
export function isTechnologyAvailable(
  technology: RenderTechnology,
  location: RenderLocation,
  time: RenderTime
): boolean {
  return RENDER_MATRIX.some(
    (entry) =>
      entry.technology === technology &&
      entry.location === location &&
      entry.time === time &&
      entry.status === 'mvp'
  );
}
