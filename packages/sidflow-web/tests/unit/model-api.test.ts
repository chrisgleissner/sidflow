/**
 * Unit tests for Model API endpoint
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { GET } from '@/app/api/model/latest/route';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { resetConfigCache } from '@sidflow/common';

describe('Model API - GET /api/model/latest', () => {
  let tmpDir: string;
  let modelPath: string;

  beforeAll(async () => {
    // Create temporary test model directory
    tmpDir = join(tmpdir(), `model-api-test-${randomBytes(8).toString('hex')}`);
    modelPath = join(tmpDir, 'model');
    await mkdir(modelPath, { recursive: true });
    await mkdir(join(modelPath, 'model'), { recursive: true });

    // Create mock model metadata
    const metadata = {
      modelVersion: '1.0.0-test',
      featureSetVersion: '2025-11-13',
      createdAt: '2025-11-13T00:00:00.000Z',
      trainedAt: '2025-11-13T01:00:00.000Z',
      architecture: {
        inputDim: 8,
        hiddenLayers: [32, 16],
        outputDim: 3,
        activation: 'tanh',
      },
      samples: 100,
    };
    await writeFile(join(modelPath, 'model-metadata.json'), JSON.stringify(metadata, null, 2));

    // Create mock feature stats
    const featureStats = {
      means: {
        energy: 0.5,
        rms: 0.2,
        spectralCentroid: 2000,
        spectralRolloff: 0,
        zeroCrossingRate: 0,
        bpm: 120,
        confidence: 0,
        duration: 0,
      },
      stds: {
        energy: 0.3,
        rms: 0.1,
        spectralCentroid: 300,
        spectralRolloff: 1,
        zeroCrossingRate: 1,
        bpm: 20,
        confidence: 1,
        duration: 1,
      },
      featureNames: ['energy', 'rms', 'spectralCentroid', 'spectralRolloff', 'zeroCrossingRate', 'bpm', 'confidence', 'duration'],
      version: '2025-11-13',
    };
    await writeFile(join(modelPath, 'feature-stats.json'), JSON.stringify(featureStats, null, 2));

    // Create mock model topology
    const modelTopology = {
      modelTopology: {
        class_name: 'Sequential',
        config: {
          name: 'test_model',
          layers: [
            {
              class_name: 'Dense',
              config: { units: 32, activation: 'relu', batch_input_shape: [null, 8] },
            },
          ],
        },
      },
      weightsManifest: [
        {
          paths: ['weights.bin'],
          weights: [
            { name: 'dense/kernel', shape: [8, 32], dtype: 'float32' },
            { name: 'dense/bias', shape: [32], dtype: 'float32' },
          ],
        },
      ],
      format: 'layers-model',
      generatedBy: 'test',
      convertedBy: null,
    };
    await writeFile(join(modelPath, 'model', 'model.json'), JSON.stringify(modelTopology));

    // Create mock weights file (empty for testing)
    const mockWeights = Buffer.alloc(1024, 0);
    await writeFile(join(modelPath, 'model', 'weights.bin'), mockWeights);

    // Set environment variable to point to test model path
    process.env.SIDFLOW_MODEL_PATH = modelPath;
  });

  afterAll(async () => {
    resetConfigCache();
    delete process.env.SIDFLOW_MODEL_PATH;
    // Clean up temporary directory
    await import('node:fs/promises').then(async (fs) => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  });

  test('should return model manifest with metadata', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.modelVersion).toBe('1.0.0-test');
    expect(data.data.metadata).toBeDefined();
    expect(data.data.metadata.featureSetVersion).toBe('2025-11-13');
    expect(data.data.metadata.samples).toBe(100);
  });

  test('should include feature stats', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.data.featureStats).toBeDefined();
    expect(data.data.featureStats.means).toBeDefined();
    expect(data.data.featureStats.stds).toBeDefined();
    expect(data.data.featureStats.featureNames).toBeArray();
    expect(data.data.featureStats.featureNames).toHaveLength(8);
  });

  test('should include model topology', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.data.modelTopology).toBeDefined();
    expect(data.data.modelTopology.class_name).toBe('Sequential');
  });

  test('should include weight specs', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.data.weightSpecs).toBeDefined();
    expect(data.data.weightSpecs).toBeArray();
    expect(data.data.weightSpecs.length).toBeGreaterThan(0);
    expect(data.data.weightSpecs[0].name).toBe('dense/kernel');
  });

  test('should include base64-encoded weight data', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.data.weightDataBase64).toBeDefined();
    expect(typeof data.data.weightDataBase64).toBe('string');
    expect(data.data.weightDataBase64.length).toBeGreaterThan(0);
  });

  test('should set appropriate cache headers', async () => {
    const response = await GET();
    const cacheControl = response.headers.get('Cache-Control');
    expect(cacheControl).toBe('private, max-age=60');
  });

  test('should handle missing feature stats gracefully', async () => {
    // Remove feature stats file temporarily
    const featureStatsPath = join(modelPath, 'feature-stats.json');
    const { rename } = await import('node:fs/promises');
    await rename(featureStatsPath, `${featureStatsPath}.bak`);

    try {
      const response = await GET();
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.featureStats).toBeNull();
    } finally {
      // Restore feature stats
      await rename(`${featureStatsPath}.bak`, featureStatsPath);
    }
  });

  test('should handle missing model topology gracefully', async () => {
    // Remove model.json temporarily
    const modelJsonPath = join(modelPath, 'model', 'model.json');
    const { rename } = await import('node:fs/promises');
    await rename(modelJsonPath, `${modelJsonPath}.bak`);

    try {
      const response = await GET();
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.modelTopology).toBeNull();
      expect(data.data.weightSpecs).toBeNull();
      expect(data.data.weightDataBase64).toBeNull();
    } finally {
      // Restore model.json
      await rename(`${modelJsonPath}.bak`, modelJsonPath);
    }
  });

  test('should return stub manifest if model metadata is missing', async () => {
    // Remove metadata temporarily
    const metadataPath = join(modelPath, 'model-metadata.json');
    const { rename } = await import('node:fs/promises');
    await rename(metadataPath, `${metadataPath}.bak`);

    try {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.modelVersion).toBe('stub');
      expect(data.data.featureStats).toBeNull();
    } finally {
      // Restore metadata
      await rename(`${metadataPath}.bak`, metadataPath);
    }
  });
});
