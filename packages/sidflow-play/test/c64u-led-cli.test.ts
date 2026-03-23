import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Writable } from 'node:stream';

import { runC64ULedCli } from '../src/c64u-led-cli.js';

function createCaptureStream(): { stream: Writable; read: () => string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }),
    read: () => chunks.join(''),
  };
}

const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if ((init?.method ?? 'GET') === 'GET' && url.includes('/v1/configs/LED%20Strip%20Settings')) {
    return new Response(
      JSON.stringify({
        items: {
          'LedStrip Mode': { current: 'SID Music' },
          'LedStrip Auto SID Mode': { current: 'Enabled' },
          'LedStrip Pattern': { current: 'SingleColor' },
          'Strip Intensity': { current: 23 },
          'Fixed Color': { current: 'Indigo' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  if (url.includes('/v1/configs/LED%20Strip%20Settings/')) {
    return new Response(JSON.stringify({ errors: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'unexpected request' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
});

describe('runC64ULedCli', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = originalFetch;
  });

  test('reads the current C64U LED snapshot', async () => {
    globalThis.fetch = fetchMock as typeof fetch;
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const exitCode = await runC64ULedCli(['--c64u-host', 'c64u.local'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      loadConfig: async () => ({
        sidPath: '/tmp/hvsc',
        audioCachePath: '/tmp/audio',
        tagsPath: '/tmp/tags',
      }),
      env: {},
    });

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe('');
    const payload = JSON.parse(stdout.read()) as { settings: { intensity: number; mode: string } };
    expect(payload.settings.mode).toBe('SID Music');
    expect(payload.settings.intensity).toBe(23);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('updates selected LED settings and forwards password from env', async () => {
    globalThis.fetch = fetchMock as typeof fetch;
    const stdout = createCaptureStream();
    const stderr = createCaptureStream();

    const exitCode = await runC64ULedCli(
      [
        '--c64u-host',
        'c64u.local',
        '--mode',
        'Fixed Color',
        '--pattern',
        'Right to Left',
        '--intensity',
        '19',
        '--fixed-color',
        'Azure',
      ],
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
        loadConfig: async () => ({
          sidPath: '/tmp/hvsc',
          audioCachePath: '/tmp/audio',
          tagsPath: '/tmp/tags',
        }),
        env: { SIDFLOW_C64U_PASSWORD: 'secret' },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe('');

    const requests = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
    }));

    expect(requests.some((request) => request.url.includes('LedStrip%20Mode') && request.method === 'PUT')).toBe(true);
    expect(requests.some((request) => request.url.includes('LedStrip%20Pattern') && request.method === 'PUT')).toBe(true);
    expect(requests.some((request) => request.url.includes('Strip%20Intensity') && request.method === 'PUT')).toBe(true);
    expect(requests.some((request) => request.url.includes('Fixed%20Color') && request.method === 'PUT')).toBe(true);
    expect(requests.every((request) => request.headers?.['X-Password'] === 'secret')).toBe(true);
  });
});