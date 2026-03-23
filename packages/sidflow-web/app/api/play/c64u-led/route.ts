import { NextRequest, NextResponse } from 'next/server';

import { executeCli } from '@/lib/cli-executor';

interface C64ULedRequestBody {
  configPath?: string;
  c64uHost?: string;
  c64uPassword?: string;
  c64uHttps?: boolean;
  mode?: string;
  autoSidMode?: string;
  pattern?: string;
  intensity?: number;
  fixedColor?: string;
}

function buildCliArgs(body: C64ULedRequestBody): string[] {
  const args = ['c64u-led'];

  if (typeof body.configPath === 'string' && body.configPath.trim().length > 0) {
    args.push('--config', body.configPath.trim());
  }
  if (typeof body.c64uHost === 'string' && body.c64uHost.trim().length > 0) {
    args.push('--c64u-host', body.c64uHost.trim());
  }
  if (body.c64uHttps === true) {
    args.push('--c64u-https');
  }
  if (typeof body.mode === 'string' && body.mode.trim().length > 0) {
    args.push('--mode', body.mode.trim());
  }
  if (typeof body.autoSidMode === 'string' && body.autoSidMode.trim().length > 0) {
    args.push('--auto-sid-mode', body.autoSidMode.trim());
  }
  if (typeof body.pattern === 'string' && body.pattern.trim().length > 0) {
    args.push('--pattern', body.pattern.trim());
  }
  if (typeof body.intensity === 'number' && Number.isFinite(body.intensity)) {
    args.push('--intensity', String(Math.round(body.intensity)));
  }
  if (typeof body.fixedColor === 'string' && body.fixedColor.trim().length > 0) {
    args.push('--fixed-color', body.fixedColor.trim());
  }

  return args;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as C64ULedRequestBody;
    const result = await executeCli('sidflow-play', buildCliArgs(body), {
      timeout: 15000,
      env:
        typeof body.c64uPassword === 'string' && body.c64uPassword.length > 0
          ? { SIDFLOW_C64U_PASSWORD: body.c64uPassword }
          : undefined,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to execute C64U LED command',
          details: result.stderr || result.stdout || `exit code ${result.exitCode}`,
        },
        { status: result.exitCode === 1 ? 400 : 500 },
      );
    }

    try {
      return NextResponse.json({
        success: true,
        data: JSON.parse(result.stdout),
      });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'C64U LED command returned invalid JSON',
          details: error instanceof Error ? error.message : String(error),
          logs: result.stdout,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute C64U LED command',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}