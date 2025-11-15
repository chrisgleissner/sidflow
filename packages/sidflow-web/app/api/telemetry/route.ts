import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  anonymizeTelemetryEvent,
  type TelemetryEvent,
} from '@/lib/server/anonymize';

/**
 * Telemetry ingestion endpoint with anonymization.
 * Anonymizes PII (session IDs, file paths, user agents) before processing.
 * Currently logs anonymized events in development and discards in production.
 */
export async function POST(request: NextRequest) {
  try {
    // Consume body to avoid hanging connections
    const text = await request.text();

    if (!text) {
      return new NextResponse(null, { status: 202 });
    }

    try {
      const payload: TelemetryEvent = JSON.parse(text);
      const userAgent = request.headers.get('user-agent');

      // Anonymize the event before any processing
      const anonymizedEvent = anonymizeTelemetryEvent(payload, userAgent);

      if (process.env.NODE_ENV === 'development') {
        console.debug(
          '[Telemetry API] received anonymized event',
          anonymizedEvent.type ?? 'unknown',
          anonymizedEvent
        );
      }

      // In production, anonymized events could be:
      // - Sent to analytics service (e.g., Plausible, PostHog)
      // - Written to log aggregation (e.g., Datadog, CloudWatch)
      // - Stored in time-series database (e.g., InfluxDB, TimescaleDB)
      // For now, we just acknowledge receipt

      // Example: await sendToAnalytics(anonymizedEvent);
    } catch (parseError) {
      // Ignore parse errors - telemetry must be fire-and-forget
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Telemetry API] received non-JSON payload');
      }
    }
  } catch (error) {
    // Never fail hard - telemetry errors should not affect the app
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Telemetry API] error processing event:', error);
    }
    return new NextResponse(null, { status: 202 });
  }

  return new NextResponse(null, { status: 202 });
}

export async function GET() {
    return NextResponse.json({ success: true }, { status: 200 });
}
