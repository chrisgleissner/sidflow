import crypto from 'crypto';

/**
 * Anonymization utilities for telemetry data.
 * Ensures PII is not collected or stored.
 */

/**
 * Hash a session ID to make it anonymous but still trackable within a session.
 */
export function anonymizeSessionId(sessionId: string): string {
  if (!sessionId) return '';

  // Use SHA-256 to hash the session ID
  const hash = crypto.createHash('sha256');
  hash.update(sessionId);
  return hash.digest('hex').substring(0, 16); // Truncate for brevity
}

/**
 * Anonymize a file path by:
 * 1. Removing username/home directory components
 * 2. Keeping only relative path from known markers (MUSICIANS, DEMOS, GAMES)
 * 3. Hashing the full path if no markers found
 */
export function anonymizeFilePath(filePath: string): string {
  if (!filePath) return '';

  // Normalize path separators (handle Windows backslashes)
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Common HVSC folder markers
  const markers = ['MUSICIANS', 'DEMOS', 'GAMES', 'C64Music'];

  // Try to find a marker in the path
  for (const marker of markers) {
    const index = normalizedPath.indexOf(`/${marker}/`);
    if (index !== -1) {
      // Return path from marker onwards
      return normalizedPath.substring(index + 1);
    }
  }

  // No marker found - hash the full path
  const hash = crypto.createHash('sha256');
  hash.update(filePath);
  return `hashed_${hash.digest('hex').substring(0, 12)}`;
}

/**
 * Extract and anonymize user agent information.
 * Keep browser family and version, remove detailed build numbers and platform details.
 */
export function anonymizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'unknown';

  // Extract major browser info (Chrome, Firefox, Safari, Edge)
  const browserMatch = userAgent.match(
    /(Chrome|Firefox|Safari|Edge)\/(\d+)/
  );

  if (browserMatch) {
    const [, browser, version] = browserMatch;
    return `${browser}/${version}`;
  }

  // Fallback to generic browser type
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';

  return 'other';
}

/**
 * Anonymize an entire telemetry event payload.
 */
export interface TelemetryEvent {
  type: string;
  timestamp: number;
  sessionId?: string;
  sidPath?: string;
  metadata?: Record<string, unknown>;
  userAgent?: string;
}

export function anonymizeTelemetryEvent(
  event: TelemetryEvent,
  userAgent: string | null
): TelemetryEvent {
  const anonymized: TelemetryEvent = {
    ...event,
  };

  // Anonymize session ID if present
  if (anonymized.sessionId) {
    anonymized.sessionId = anonymizeSessionId(anonymized.sessionId);
  }

  // Anonymize file paths if present
  if (anonymized.sidPath) {
    anonymized.sidPath = anonymizeFilePath(anonymized.sidPath);
  }

  // Add anonymized user agent
  anonymized.userAgent = anonymizeUserAgent(userAgent);

  // Recursively anonymize metadata
  if (anonymized.metadata) {
    anonymized.metadata = anonymizeMetadata(anonymized.metadata);
  }

  return anonymized;
}

/**
 * Recursively anonymize metadata object.
 */
function anonymizeMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const anonymized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Skip null/undefined
    if (value === null || value === undefined) {
      anonymized[key] = value;
      continue;
    }

    // Anonymize known PII fields
    if (key === 'sessionId' && typeof value === 'string') {
      anonymized[key] = anonymizeSessionId(value);
    } else if (
      (key === 'sidPath' || key === 'path' || key === 'file') &&
      typeof value === 'string'
    ) {
      anonymized[key] = anonymizeFilePath(value);
    } else if (key === 'userAgent' && typeof value === 'string') {
      anonymized[key] = anonymizeUserAgent(value);
    } else if (key === 'stack' && typeof value === 'string') {
      // Remove file paths from stack traces
      anonymized[key] = value.replace(/\/[^\s)]+/g, '<path>');
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // Recursively anonymize nested objects
      anonymized[key] = anonymizeMetadata(value as Record<string, unknown>);
    } else {
      // Keep primitive values as-is
      anonymized[key] = value;
    }
  }

  return anonymized;
}
