import { describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

const executeCli = mock(async () => ({
  success: true,
  stdout: JSON.stringify({ mode: 'SID Music', intensity: 24 }),
  stderr: '',
  exitCode: 0,
}));

mock.module('@/lib/cli-executor', () => ({
  executeCli,
}));

const { POST } = await import('@/app/api/play/c64u-led/route');

function buildRequest(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/play/c64u-led', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('/api/play/c64u-led', () => {
  test('returns parsed snapshot from the CLI', async () => {
    executeCli.mockResolvedValueOnce({
      success: true,
      stdout: JSON.stringify({ mode: 'SID Music', autoSidMode: 'Enabled', intensity: 21 }),
      stderr: '',
      exitCode: 0,
    });

    const response = await POST(buildRequest({ c64uHost: 'c64u.local' }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.mode).toBe('SID Music');
    expect(executeCli).toHaveBeenCalledWith('sidflow-play', ['c64u-led', '--c64u-host', 'c64u.local'], {
      timeout: 15000,
      env: undefined,
    });
  });

  test('passes password through the environment and patch flags through argv', async () => {
    executeCli.mockResolvedValueOnce({
      success: true,
      stdout: JSON.stringify({ mode: 'SID Music', pattern: 'SingleColor', intensity: 25 }),
      stderr: '',
      exitCode: 0,
    });

    const response = await POST(
      buildRequest({
        c64uHost: '192.168.0.64',
        c64uHttps: true,
        c64uPassword: 'secret',
        mode: 'SID Music',
        autoSidMode: 'Enabled',
        pattern: 'SingleColor',
        intensity: 25,
        fixedColor: 'Indigo',
      }),
    );

    expect(response.status).toBe(200);
    expect(executeCli).toHaveBeenCalledWith(
      'sidflow-play',
      [
        'c64u-led',
        '--c64u-host',
        '192.168.0.64',
        '--c64u-https',
        '--mode',
        'SID Music',
        '--auto-sid-mode',
        'Enabled',
        '--pattern',
        'SingleColor',
        '--intensity',
        '25',
        '--fixed-color',
        'Indigo',
      ],
      {
        timeout: 15000,
        env: { SIDFLOW_C64U_PASSWORD: 'secret' },
      },
    );
  });

  test('maps CLI validation failures to 400', async () => {
    executeCli.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: 'Error: intensity must be between 0 and 31',
      exitCode: 1,
    });

    const response = await POST(buildRequest({ intensity: 99 }));
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to execute C64U LED command');
  });
});