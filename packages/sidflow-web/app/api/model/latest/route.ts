/**
 * Global Model API endpoint - serves the latest trained model manifest
 * for client-side TensorFlow.js fine-tuning.
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  try {
    // Model path is conventionally data/model relative to project root
    const modelPath = process.env.SIDFLOW_MODEL_PATH ?? join(process.cwd(), 'data/model');

    // Load model metadata
    const metadataPath = join(modelPath, 'model-metadata.json');
    const metadataContent = await readFile(metadataPath, 'utf-8');
    const metadata: ModelMetadata = JSON.parse(metadataContent);

    // Load feature stats
    let featureStats: FeatureStats | null = null;
    try {
      const featureStatsPath = join(modelPath, 'feature-stats.json');
      const featureStatsContent = await readFile(featureStatsPath, 'utf-8');
      featureStats = JSON.parse(featureStatsContent) as FeatureStats;
    } catch (error) {
      console.warn('[Model API] Feature stats not found, continuing without them', error);
    }

    // Load model topology
    let modelTopology: ModelTopology | null = null;
    let weightSpecs: Array<Record<string, unknown>> | null = null;
    let weightDataBase64: string | null = null;

    try {
      const modelJsonPath = join(modelPath, 'model', 'model.json');
      const modelJsonContent = await readFile(modelJsonPath, 'utf-8');
      const modelJson: ModelTopology = JSON.parse(modelJsonContent);
      modelTopology = modelJson;

      // Extract weight specs from the manifest
      if (modelJson.weightsManifest && modelJson.weightsManifest.length > 0) {
        const manifest = modelJson.weightsManifest[0];
        if (manifest.weights) {
          weightSpecs = manifest.weights as Array<Record<string, unknown>>;
        }

        // Load weight data and encode as base64
        if (manifest.paths && Array.isArray(manifest.paths) && manifest.paths.length > 0) {
          const weightsPath = join(modelPath, 'model', manifest.paths[0] as string);
          const weightsBuffer = await readFile(weightsPath);
          weightDataBase64 = weightsBuffer.toString('base64');
        }
      }
    } catch (error) {
      console.warn('[Model API] Model topology not found, continuing without it', error);
    }

    const responseData: GlobalModelManifestData = {
      modelVersion: metadata.modelVersion,
      featureStats: featureStats ?? null,
      metadata: {
        featureSetVersion: metadata.featureSetVersion,
        createdAt: metadata.createdAt,
        trainedAt: metadata.trainedAt,
        architecture: metadata.architecture,
        samples: metadata.samples,
      },
      modelTopology: modelTopology?.modelTopology ?? null,
      weightSpecs: weightSpecs ?? null,
      weightDataBase64: weightDataBase64 ?? null,
    };

    const response: ApiResponse<GlobalModelManifestData> = {
      success: true,
      data: responseData,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[Model API] Failed to load model manifest', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load model manifest',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
