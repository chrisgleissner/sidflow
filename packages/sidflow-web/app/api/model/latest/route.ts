/**
 * Global Model API endpoint - serves the latest trained model manifest
 * for client-side TensorFlow.js fine-tuning.
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathExists } from '@sidflow/common';
import type { ApiResponse } from '@/lib/validation';

interface ModelMetadata {
  modelVersion: string;
  featureSetVersion?: string;
  createdAt?: string;
  trainedAt?: string;
  architecture?: Record<string, unknown>;
  samples?: number;
}

interface FeatureStats {
  means?: Record<string, number>;
  stds?: Record<string, number>;
  featureNames?: string[];
  version?: string;
}

interface ModelTopology {
  modelTopology?: Record<string, unknown>;
  weightsManifest?: Array<Record<string, unknown>>;
  format?: string;
  generatedBy?: string;
  convertedBy?: string | null;
}

interface GlobalModelManifestData {
  modelVersion: string;
  featureStats?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  modelTopology?: Record<string, unknown> | null;
  weightSpecs?: Array<Record<string, unknown>> | null;
  weightDataBase64?: string | null;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const resolvedPath = await resolveModelRoot();
  const manifest = resolvedPath ? await loadModelManifest(resolvedPath) : null;

  if (!manifest) {
    console.warn('[Model API] Falling back to stub manifest', { resolvedPath });
  }

  const responsePayload: ApiResponse<GlobalModelManifestData> = {
    success: true,
    data: manifest ?? buildStubManifest(),
  };

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=60',
    },
  });
}

async function resolveModelRoot(): Promise<string | null> {
  const candidates = [
    process.env.SIDFLOW_MODEL_PATH,
    join(process.cwd(), 'data', 'model'),
    join(process.cwd(), '..', 'data', 'model'),
    join(process.cwd(), '..', '..', 'data', 'model'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = resolve(candidate);
    if (await pathExists(normalized)) {
      return normalized;
    }
  }
  return null;
}

async function loadModelManifest(modelPath: string): Promise<GlobalModelManifestData | null> {
  try {
    const metadata = await readJson<ModelMetadata>(join(modelPath, 'model-metadata.json'));
    if (!metadata) {
      return null;
    }

    const featureStats = await readJson<FeatureStats>(join(modelPath, 'feature-stats.json'));

    const modelJson = await readJson<ModelTopology>(join(modelPath, 'model', 'model.json'));
    let weightSpecs: Array<Record<string, unknown>> | null = null;
    let weightDataBase64: string | null = null;

    if (modelJson?.weightsManifest && modelJson.weightsManifest.length > 0) {
      const manifest = modelJson.weightsManifest[0];
      if (manifest.weights) {
        weightSpecs = manifest.weights as Array<Record<string, unknown>>;
      }
      if (manifest.paths && Array.isArray(manifest.paths) && manifest.paths.length > 0) {
        const weightsPath = join(modelPath, 'model', manifest.paths[0] as string);
        if (await pathExists(weightsPath)) {
          const weightsBuffer = await readFile(weightsPath);
          weightDataBase64 = weightsBuffer.toString('base64');
        }
      }
    }

    return {
      modelVersion: metadata.modelVersion,
  featureStats: featureStats ? (featureStats as Record<string, unknown>) : null,
      metadata: {
        featureSetVersion: metadata.featureSetVersion,
        createdAt: metadata.createdAt,
        trainedAt: metadata.trainedAt,
        architecture: metadata.architecture,
        samples: metadata.samples,
      },
      modelTopology: modelJson?.modelTopology ?? null,
      weightSpecs,
      weightDataBase64,
    } satisfies GlobalModelManifestData;
  } catch (error) {
    console.warn('[Model API] Unable to read model manifest', { modelPath, error });
    return null;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

function buildStubManifest(): GlobalModelManifestData {
  return {
    modelVersion: 'stub',
    featureStats: null,
    metadata: {
      featureSetVersion: 'stub',
      createdAt: new Date(0).toISOString(),
      trainedAt: new Date(0).toISOString(),
      architecture: { note: 'stub model manifest for tests' },
      samples: 0,
    },
    modelTopology: null,
    weightSpecs: null,
    weightDataBase64: null,
  };
}
