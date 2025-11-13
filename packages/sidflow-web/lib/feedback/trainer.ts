import * as tf from '@tensorflow/tfjs';
import type { LayersModel, Tensor } from '@tensorflow/tfjs';
import type { TagRatings } from '@sidflow/common';
import { listRatingEventsForTraining, storeModelSnapshot, type RatingEventRecord } from '@/lib/feedback/storage';
import { FEATURE_KEYS } from '@/lib/feedback/features';
import { fetchGlobalModelManifest } from '@/lib/feedback/global-model';

export interface FeedbackTrainerConfig {
  enabled: boolean;
  iterationBudget: number;
  maxCpuFraction: number;
  sampleLimit: number;
}

export interface TrainingSnapshotInfo {
  modelVersion: string;
  samples: number;
  durationMs: number;
}

interface InternalConfig extends FeedbackTrainerConfig {
  cooldownMs: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: InternalConfig = {
  enabled: false,
  iterationBudget: 200,
  maxCpuFraction: 0.05,
  sampleLimit: 512,
  cooldownMs: 60_000,
  retryDelayMs: 15_000,
};

function safeNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return numeric;
}

function extractFeatureVector(record: RatingEventRecord): number[] | null {
  const metadataFeatures = (record.metadata as { features?: Record<string, unknown> } | null)?.features;
  if (!metadataFeatures) {
    return null;
  }
  const vector = FEATURE_KEYS.map((key) => safeNumber(metadataFeatures[key], 0));
  const hasSignal = vector.some((value) => Math.abs(value) > 0);
  return hasSignal ? vector : null;
}

function extractLabelVector(ratings: TagRatings): number[] {
  return [safeNumber(ratings.e, 3), safeNumber(ratings.m, 3), safeNumber(ratings.c, 3)];
}

export class FeedbackTrainer {
  private config: InternalConfig = { ...DEFAULT_CONFIG };
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private cpuSamples: Array<{ duration: number; window: number }> = [];
  private lastCompletedAt = 0;
  private cooldownUntil = 0;
  private baseModelVersion: string | null = null;
  private onSnapshot?: (info: TrainingSnapshotInfo) => void;

  constructor(options?: { onSnapshot?: (info: TrainingSnapshotInfo) => void }) {
    this.onSnapshot = options?.onSnapshot;
  }

  updateConfig(patch: Partial<FeedbackTrainerConfig>): void {
    this.config = { ...this.config, ...patch };
    if (!this.config.enabled) {
      this.cancelScheduled();
    } else {
      this.schedule(5_000);
    }
  }

  notifyPendingWork(reason: string = 'pending-update'): void {
    if (!this.config.enabled) {
      return;
    }
    if (performance && typeof performance.mark === 'function') {
      try {
        performance.mark(`feedback-trainer:${reason}`);
      } catch {
        // ignore
      }
    }
    this.schedule(3_000);
  }

  stop(): void {
    this.cancelScheduled();
  }

  private cancelScheduled(): void {
    if (this.scheduled) {
      clearTimeout(this.scheduled);
      this.scheduled = null;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.config.enabled) {
      return;
    }
    const now = Date.now();
    if (now < this.cooldownUntil) {
      const remaining = Math.max(0, this.cooldownUntil - now);
      delayMs = Math.max(delayMs, remaining);
    }
    if (this.scheduled) {
      const dueAt = (this as { scheduledDueAt?: number }).scheduledDueAt ?? 0;
      if (dueAt - now <= delayMs) {
        return;
      }
      clearTimeout(this.scheduled);
    }
    (this as { scheduledDueAt?: number }).scheduledDueAt = now + delayMs;
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      (this as { scheduledDueAt?: number }).scheduledDueAt = undefined;
      void this.runOnce();
    }, delayMs);
  }

  private getCpuAverage(): number {
    if (this.cpuSamples.length === 0) {
      return 0;
    }
    const totals = this.cpuSamples.reduce(
      (acc, sample) => {
        acc.duration += sample.duration;
        acc.window += sample.window;
        return acc;
      },
      { duration: 0, window: 0 }
    );
    if (totals.window <= 0) {
      return 0;
    }
    return totals.duration / totals.window;
  }

  private recordCpuSample(durationMs: number): void {
    if (!Number.isFinite(durationMs)) {
      return;
    }
    const now = performance.now();
    const window = this.lastCompletedAt > 0 ? Math.max(now - this.lastCompletedAt, durationMs) : Math.max(durationMs, 1);
    this.cpuSamples.push({ duration: durationMs, window });
    if (this.cpuSamples.length > 10) {
      this.cpuSamples.shift();
    }
    this.lastCompletedAt = now;
  }

  private async ensureBaseVersion(): Promise<string> {
    if (this.baseModelVersion) {
      return this.baseModelVersion;
    }
    try {
      const manifest = await fetchGlobalModelManifest();
      this.baseModelVersion = manifest.modelVersion;
    } catch (error) {
      console.warn('[FeedbackTrainer] Failed to fetch global model manifest', error);
      this.baseModelVersion = 'unknown';
    }
    return this.baseModelVersion;
  }

  private async runOnce(): Promise<void> {
    if (!this.config.enabled || this.running) {
      return;
    }
    const now = Date.now();
    if (now < this.cooldownUntil) {
      this.schedule(this.cooldownUntil - now);
      return;
    }
    if (this.getCpuAverage() > this.config.maxCpuFraction) {
      this.cooldownUntil = now + this.config.cooldownMs;
      this.schedule(this.config.cooldownMs);
      return;
    }

    this.running = true;
    const start = performance.now();
    let xs: Tensor | null = null;
    let ys: Tensor | null = null;
    let model: LayersModel | null = null;

    try {
      await tf.ready();
      const records = await listRatingEventsForTraining(undefined, this.config.sampleLimit);
      const vectors: number[][] = [];
      const labels: number[][] = [];

      for (const record of records) {
        const featureVector = extractFeatureVector(record);
        if (!featureVector) {
          continue;
        }
        vectors.push(featureVector);
        labels.push(extractLabelVector(record.ratings));
        if (vectors.length >= this.config.sampleLimit) {
          break;
        }
      }

      if (vectors.length < Math.min(8, this.config.sampleLimit / 4)) {
        return;
      }

      xs = tf.tensor2d(vectors, [vectors.length, FEATURE_KEYS.length]);
      ys = tf.tensor2d(labels, [labels.length, 3]);

      model = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [FEATURE_KEYS.length], units: 32, activation: 'relu', kernelInitializer: 'heNormal' }),
          tf.layers.dropout({ rate: 0.1 }),
          tf.layers.dense({ units: 16, activation: 'relu', kernelInitializer: 'heNormal' }),
          tf.layers.dense({ units: 3, activation: 'linear' }),
        ],
      });
      model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError', metrics: ['mae'] });

      const epochs = Math.max(1, Math.min(10, Math.floor(this.config.iterationBudget / Math.max(vectors.length, 1))));
      const batchSize = Math.min(32, Math.max(8, Math.round(vectors.length / 8)));

      const history = await model.fit(xs, ys, {
        epochs,
        batchSize,
        shuffle: true,
        verbose: 0,
      });

      const baseVersion = await this.ensureBaseVersion();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const modelVersion = `${baseVersion}-local-${timestamp}`;

      let savedArtifacts: tf.io.ModelArtifacts | null = null;
      await model.save(
        tf.io.withSaveHandler(async (artifacts: tf.io.ModelArtifacts) => {
          savedArtifacts = artifacts;
          return {
            modelArtifactsInfo: {
              dateSaved: new Date(),
              modelTopologyType: 'JSON',
              modelTopologyBytes: artifacts.modelTopology ? JSON.stringify(artifacts.modelTopology).length : 0,
              weightDataBytes: artifacts.weightData ? artifacts.weightData.byteLength : 0,
            },
          } satisfies tf.io.SaveResult;
        })
      );

      const weightData = savedArtifacts?.weightData ?? null;
      if (!weightData) {
        throw new Error('Training completed but weight data unavailable');
      }

      await storeModelSnapshot({
        modelVersion,
        weights: weightData,
        metadata: {
          samples: vectors.length,
          epochs,
          batchSize,
          loss: history.history.loss?.at(-1) ?? null,
          mae: history.history.mae?.at(-1) ?? null,
          trainedAt: new Date().toISOString(),
          baseVersion,
        },
      });

      this.onSnapshot?.({
        modelVersion,
        samples: vectors.length,
        durationMs: performance.now() - start,
      });
    } catch (error) {
      console.warn('[FeedbackTrainer] Training run failed', error);
      this.cooldownUntil = Date.now() + this.config.retryDelayMs;
    } finally {
      if (xs) {
        xs.dispose();
      }
      if (ys) {
        ys.dispose();
      }
      if (model) {
        model.dispose();
      }
      const duration = performance.now() - start;
      this.recordCpuSample(duration);
      this.running = false;
    }
  }
}
