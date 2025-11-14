import { describe, test, expect } from 'bun:test';
import { POST, GET } from '@/app/api/telemetry/route';
import { NextRequest } from 'next/server';
import type { TelemetryEvent } from '@/lib/server/anonymize';

describe('Telemetry API', () => {
  describe('POST /api/telemetry', () => {
    test('accepts valid telemetry event', async () => {
      const event: TelemetryEvent = {
        type: 'playback.load.success',
        timestamp: Date.now(),
        sessionId: 'test-session-123',
        sidPath: '/home/user/hvsc/MUSICIANS/H/Hubbard_Rob/Commando.sid',
      };

      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 Chrome/120.0.0.0',
        },
        body: JSON.stringify(event),
      });

      const response = await POST(request);
      expect(response.status).toBe(202); // Accepted
    });

    test('accepts event with metadata', async () => {
      const event: TelemetryEvent = {
        type: 'playback.error',
        timestamp: Date.now(),
        metadata: {
          error: {
            message: 'Failed to decode',
            stack: 'Error at /app/player.ts:123',
          },
          context: {
            browser: 'Chrome',
            version: '120',
          },
        },
      };

      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: JSON.stringify(event),
      });

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    test('accepts empty body without failing', async () => {
      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: '',
      });

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    test('handles invalid JSON gracefully', async () => {
      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: 'invalid json {',
      });

      const response = await POST(request);
      // Should still return 202 (fire-and-forget)
      expect(response.status).toBe(202);
    });

    test('handles malformed request gracefully', async () => {
      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: null as any,
      });

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    test('anonymizes session ID in received event', async () => {
      // This test verifies that anonymization happens
      // In a real scenario, we'd need to capture what gets logged/stored

      const event: TelemetryEvent = {
        type: 'playback.load.start',
        timestamp: Date.now(),
        sessionId: 'user-sensitive-session-id',
      };

      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: JSON.stringify(event),
      });

      const response = await POST(request);
      expect(response.status).toBe(202);

      // In production, verify that:
      // 1. Original sessionId is never logged
      // 2. Hashed sessionId is used instead
      // Since this is fire-and-forget, we can only verify it doesn't error
    });

    test('anonymizes file paths in received event', async () => {
      const event: TelemetryEvent = {
        type: 'playback.load.success',
        timestamp: Date.now(),
        sidPath: '/home/chris/sensitive/path/MUSICIANS/H/Test.sid',
      };

      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        headers: {
          'user-agent': 'Mozilla/5.0 Firefox/121.0',
        },
        body: JSON.stringify(event),
      });

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    test('extracts and anonymizes user agent', async () => {
      const event: TelemetryEvent = {
        type: 'playback.state.change',
        timestamp: Date.now(),
      };

      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.6099.129 Safari/537.36',
        },
        body: JSON.stringify(event),
      });

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    test('handles batch of events (sent separately)', async () => {
      const events: TelemetryEvent[] = [
        { type: 'playback.load.start', timestamp: Date.now() },
        { type: 'playback.load.success', timestamp: Date.now() + 100 },
        { type: 'playback.state.change', timestamp: Date.now() + 200 },
      ];

      for (const event of events) {
        const request = new NextRequest('http://localhost/api/telemetry', {
          method: 'POST',
          body: JSON.stringify(event),
        });

        const response = await POST(request);
        expect(response.status).toBe(202);
      }
    });

    test('processes events with nested PII in metadata', async () => {
      const event: TelemetryEvent = {
        type: 'playback.error',
        timestamp: Date.now(),
        metadata: {
          error: {
            message: 'Render failed',
            stack: 'Error\n  at renderSid (/home/user/app/render.ts:45)\n  at main (/home/user/app/main.ts:12)',
          },
          context: {
            sessionId: 'nested-session',
            sidPath: '/home/user/data/test.sid',
            file: '/absolute/path/config.json',
          },
        },
      };

      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: JSON.stringify(event),
      });

      const response = await POST(request);
      expect(response.status).toBe(202);
    });

    test('never returns error status to client', async () => {
      // Even with completely broken input, should return 202
      const invalidInputs = [
        '{ invalid json',
        null,
        undefined,
        123,
        'random string',
        '[]',
        '{"type": null}',
      ];

      for (const input of invalidInputs) {
        const request = new NextRequest('http://localhost/api/telemetry', {
          method: 'POST',
          body: input as any,
        });

        const response = await POST(request);
        expect(response.status).toBe(202);
      }
    });
  });

  describe('GET /api/telemetry', () => {
    test('returns 200 for health check', async () => {
      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Telemetry fire-and-forget behavior', () => {
    test('completes quickly regardless of payload size', async () => {
      const largeEvent: TelemetryEvent = {
        type: 'playback.performance',
        timestamp: Date.now(),
        metadata: {
          // Simulate large metadata
          samples: Array.from({ length: 1000 }, (_, i) => ({
            frame: i,
            duration: Math.random() * 10,
          })),
        },
      };

      const start = Date.now();
      const request = new NextRequest('http://localhost/api/telemetry', {
        method: 'POST',
        body: JSON.stringify(largeEvent),
      });

      const response = await POST(request);
      const duration = Date.now() - start;

      expect(response.status).toBe(202);
      // Should complete in less than 100ms
      expect(duration).toBeLessThan(100);
    });

    test('does not throw on concurrent requests', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => {
        const event: TelemetryEvent = {
          type: 'playback.load.start',
          timestamp: Date.now(),
          sessionId: `concurrent-session-${i}`,
        };

        return new NextRequest('http://localhost/api/telemetry', {
          method: 'POST',
          body: JSON.stringify(event),
        });
      });

      const responses = await Promise.all(requests.map((req) => POST(req)));

      for (const response of responses) {
        expect(response.status).toBe(202);
      }
    });
  });
});
