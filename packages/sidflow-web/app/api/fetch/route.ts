/**
 * Fetch API endpoint - synchronizes HVSC via sidflow-fetch CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCli } from '@/lib/cli-executor';
import { FetchRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import {
  beginFetchTracking,
  completeFetchTracking,
  failFetchTracking,
  getFetchProgressSnapshot,
  ingestFetchStdout,
  ingestFetchStderr,
} from '@/lib/fetch-progress-store';
import type { FetchProgressSnapshot } from '@/lib/types/fetch-progress';
import { formatCliLogs } from '@/lib/cli-logs';

export async function POST(request: NextRequest) {
  let trackingStarted = false;
  try {
    const body = await request.json();
    const validatedData = FetchRequestSchema.parse(body);

    const args: string[] = [];
    if (validatedData.configPath) {
      args.push('--config', validatedData.configPath);
    }
    if (validatedData.remoteBaseUrl) {
      args.push('--remote', validatedData.remoteBaseUrl);
    }
    if (validatedData.hvscVersionPath) {
      args.push('--version-file', validatedData.hvscVersionPath);
    }

    trackingStarted = beginFetchTracking();
    if (!trackingStarted) {
      const snapshot = getFetchProgressSnapshot();
      const response: ApiResponse = {
        success: false,
        error: 'Fetch already running',
        details: 'A fetch operation is currently in progress. Please wait for it to finish.',
        logs: snapshot.logs.join('\n'),
        progress: snapshot,
      };
      return NextResponse.json(response, { status: 409 });
    }

    const result = await executeCli('sidflow-fetch', args, {
      timeout: 600000, // 10 minutes for HVSC sync (can be long-running)
      onStdout: ingestFetchStdout,
      onStderr: ingestFetchStderr,
    });
    const logs = formatCliLogs('sidflow-fetch', result.stdout, result.stderr);

    if (result.success) {
      completeFetchTracking();
      const snapshot = getFetchProgressSnapshot();
      console.info('[api/fetch] sidflow-fetch completed', {
        exitCode: result.exitCode,
      });

      const response: ApiResponse<{ output: string; logs: string; progress: FetchProgressSnapshot }> = {
        success: true,
        data: {
          output: result.stdout,
          logs,
          progress: snapshot,
        },
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      failFetchTracking(result.stderr?.trim() || result.stdout?.trim() || 'Fetch command failed');
      const snapshot = getFetchProgressSnapshot();
      console.error('[api/fetch] sidflow-fetch failed', {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      const response: ApiResponse = {
        success: false,
        error: 'Fetch command failed',
        details: result.stderr?.trim() || result.stdout?.trim() || 'Unknown fetch error',
        logs,
        progress: snapshot,
      };
      return NextResponse.json(response, { status: 500 });
    }
  } catch (error) {
    if (trackingStarted) {
      failFetchTracking(error instanceof Error ? error.message : String(error));
    }
    if (error instanceof ZodError) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation error',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }

    const snapshot = trackingStarted ? getFetchProgressSnapshot() : undefined;
    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      ...(snapshot ? { progress: snapshot, logs: snapshot.logs.join('\n') } : {}),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
