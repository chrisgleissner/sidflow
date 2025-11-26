/**
 * Classify API endpoint - triggers classification via sidflow-classify CLI
 */
import { NextRequest, NextResponse } from 'next/server';
import { ClassifyRequestSchema, type ApiResponse } from '@/lib/validation';
import { ZodError } from 'zod';
import { describeCliFailure, describeCliSuccess } from '@/lib/cli-logs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';
import {
  beginClassifyProgress,
  completeClassifyProgress,
  failClassifyProgress,
  getClassifyProgressSnapshot,
  ingestClassifyStdout,
  pauseClassifyProgress,
} from '@/lib/classify-progress-store';
import { runClassificationProcess } from '@/lib/classify-runner';
import { resolveSidCollectionContext, buildCliEnvOverrides } from '@/lib/sid-collection';
import { getWebPreferences } from '@/lib/preferences-store';
import type { RenderTechnology } from '@sidflow/common';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = ClassifyRequestSchema.parse(body);

    const config = await getSidflowConfig();
    const root = getRepoRoot();
    const collection = await resolveSidCollectionContext();
    const prefs = await getWebPreferences();
    
    const requestedPath = validatedData.path?.trim();
    const classificationPath = requestedPath
      ? path.isAbsolute(requestedPath)
        ? path.normalize(requestedPath)
        : path.resolve(collection.hvscRoot, requestedPath)
      : collection.collectionRoot;
    await fs.stat(classificationPath);
    const threads = config.threads && config.threads > 0 ? config.threads : os.cpus().length;
    
    // Resolve engine preferences
    const preferredEngines: RenderTechnology[] = [];
    if (prefs.preferredEngines && prefs.preferredEngines.length > 0) {
      preferredEngines.push(...prefs.preferredEngines);
    } else if (config.render?.preferredEngines && config.render.preferredEngines.length > 0) {
      preferredEngines.push(...config.render.preferredEngines);
    }
    // Always append wasm as fallback
    if (!preferredEngines.includes('wasm')) {
      preferredEngines.push('wasm');
    }

    // Determine which engine description to show
    let engineDescription: string;
    if (prefs.renderEngine && prefs.renderEngine !== 'wasm') {
      engineDescription = prefs.renderEngine;
      console.log(`[engine-order] Forced engine from preferences: ${prefs.renderEngine}`);
    } else if (preferredEngines.length > 0) {
      engineDescription = preferredEngines.join(' → ');
      console.log(`[engine-order] Preferred engine order: ${engineDescription}`);
    } else {
      engineDescription = 'wasm';
      console.log(`[engine-order] Using default WASM engine`);
    }
    
    beginClassifyProgress(threads, engineDescription);
    console.log('[engine-order] Classification starting');

  const command = 'sidflow-classify';
  const cliArgs: string[] = [];
  
  // Note: sidflow-classify CLI currently uses render engines from config.render.preferredEngines
  // The --engine and --prefer flags are not yet implemented in the CLI
  // Engine preferences are logged above but passed via config file, not CLI args
  
    const cliEnv = {
      ...buildCliEnvOverrides(collection),
      SIDFLOW_SID_BASE_PATH: classificationPath,
    };
    const { result, reason } = await runClassificationProcess({
      command,
      args: cliArgs,
      cwd: root,
      env: cliEnv,
      onStdout: ingestClassifyStdout,
      onStderr: (chunk) => console.error('[classify stderr]', chunk),
    });

    if (reason === 'paused') {
      pauseClassifyProgress('Classification paused by user');
      const response: ApiResponse<{ paused: true; progress: ReturnType<typeof getClassifyProgressSnapshot> }> = {
        success: true,
        data: {
          paused: true,
          progress: getClassifyProgressSnapshot(),
        },
      };
      return NextResponse.json(response, { status: 200 });
    }

    if (result.success) {
      const { logs } = describeCliSuccess(command, result);
      completeClassifyProgress('Classification completed successfully');
      const response: ApiResponse<{ output: string; logs: string; progress: ReturnType<typeof getClassifyProgressSnapshot> }> = {
        success: true,
        data: {
          output: result.stdout,
          logs,
          progress: getClassifyProgressSnapshot(),
        },
      };
      return NextResponse.json(response, { status: 200 });
    } else {
      const { details, logs } = describeCliFailure(command, result);
      failClassifyProgress(details);
      const response: ApiResponse = {
        success: false,
        error: 'Classification command failed',
        details,
        logs,
        progress: getClassifyProgressSnapshot(),
      };
      return NextResponse.json(response, { status: 500 });
    }
  } catch (error) {
    if (error instanceof ZodError) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation error',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
      return NextResponse.json(response, { status: 400 });
    }

    failClassifyProgress(error instanceof Error ? error.message : String(error));
    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
      progress: getClassifyProgressSnapshot(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
