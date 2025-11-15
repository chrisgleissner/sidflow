import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences } from '@/lib/preferences/schema';
import { fetchGlobalModelManifest } from '@/lib/feedback/global-model';
import { readLatestModelSnapshot, type ModelSnapshotRecord } from '@/lib/feedback/storage';
import { subscribeFeedbackEvents } from '@/lib/feedback/events';
import { FeedbackTrainer, type TrainingSnapshotInfo } from '@/lib/feedback/trainer';
import { FeedbackSync, type FeedbackSyncSummary } from '@/lib/feedback/sync';

export interface FeedbackRuntimeState {
  trainingEnabled: boolean;
  uploadingEnabled: boolean;
  baseModelVersion: string | null;
  localModelVersion: string | null;
  lastTraining: TrainingSnapshotInfo | null;
  lastSync: FeedbackSyncSummary | null;
}

const INITIAL_STATE: FeedbackRuntimeState = {
  trainingEnabled: false,
  uploadingEnabled: false,
  baseModelVersion: null,
  localModelVersion: null,
  lastTraining: null,
  lastSync: null,
};

class FeedbackRuntime {
  private state: FeedbackRuntimeState = { ...INITIAL_STATE };
  private preferences: BrowserPreferences = DEFAULT_BROWSER_PREFERENCES;
  private readonly trainer: FeedbackTrainer;
  private readonly sync: FeedbackSync;
  private listeners = new Set<(state: FeedbackRuntimeState) => void>();
  private unsubscribeFeedback: (() => void) | null = null;
  private bootstrapPromise: Promise<void> | null = null;

  constructor() {
    this.trainer = createTrainer({
      onSnapshot: (info) => {
        this.setState({
          lastTraining: info,
          localModelVersion: info.modelVersion,
          baseModelVersion: info.baseModelVersion ?? this.state.baseModelVersion,
        });
        if (info.baseModelVersion) {
          this.sync.setBaseModelVersion(info.baseModelVersion);
        }
        this.sync.notifyPendingWork();
      },
    });
    this.sync = createSync();
    this.sync.subscribe((summary) => {
      this.setState({ lastSync: summary });
    });

    if (typeof window !== 'undefined') {
      this.unsubscribeFeedback = subscribeFeedbackEvents(() => {
        if (this.preferences.training.enabled) {
          this.trainer.notifyPendingWork('feedback');
        }
        if (this.preferences.training.allowUpload) {
          this.sync.notifyPendingWork();
        }
      });
      void this.bootstrap();
    }
  }

  destroy(): void {
    this.trainer.stop();
    this.sync.stop();
    if (this.unsubscribeFeedback) {
      this.unsubscribeFeedback();
      this.unsubscribeFeedback = null;
    }
    this.listeners.clear();
  }

  updatePreferences(preferences: BrowserPreferences): void {
    this.preferences = preferences;
    this.trainer.updateConfig({
      enabled: preferences.training.enabled,
      iterationBudget: preferences.training.iterationBudget,
      maxCpuFraction: 0.05,
      sampleLimit: 512,
    });
    this.sync.updateConfig({
      enabled: preferences.training.allowUpload,
      cadenceMs: Math.max(preferences.training.syncCadenceMinutes, 5) * 60 * 1000,
      maxBatchSize: 50,
    });
    this.setState({
      trainingEnabled: preferences.training.enabled,
      uploadingEnabled: preferences.training.allowUpload,
    });
    if (preferences.training.enabled) {
      this.trainer.notifyPendingWork('preferences');
    }
    if (preferences.training.allowUpload) {
      this.sync.notifyPendingWork();
    }
  }

  subscribe(listener: (state: FeedbackRuntimeState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): FeedbackRuntimeState {
    return this.state;
  }

  requestTrainingRun(reason: string = 'manual'): void {
    if (!this.preferences.training.enabled) {
      return;
    }
    this.trainer.notifyPendingWork(reason);
  }

  requestSyncUpload(): void {
    if (!this.preferences.training.allowUpload) {
      return;
    }
    this.sync.notifyPendingWork();
  }

  private setState(patch: Partial<FeedbackRuntimeState>): void {
    const next = { ...this.state, ...patch } satisfies FeedbackRuntimeState;
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch (error) {
        console.warn('[FeedbackRuntime] Listener failed', error);
      }
    }
  }

  private async bootstrap(): Promise<void> {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }
    this.bootstrapPromise = (async () => {
      await Promise.all([this.resolveBaseModelVersion(), this.loadLatestSnapshot()]);
    })();
    try {
      await this.bootstrapPromise;
    } finally {
      this.bootstrapPromise = null;
    }
  }

  private async resolveBaseModelVersion(): Promise<void> {
    try {
      const manifest = await fetchGlobalModelManifest();
      this.sync.setBaseModelVersion(manifest.modelVersion);
      this.setState({ baseModelVersion: manifest.modelVersion });
    } catch (error) {
      console.warn('[FeedbackRuntime] Failed to resolve base model manifest', error);
    }
  }

  private async loadLatestSnapshot(): Promise<void> {
    try {
      const snapshot = await readLatestModelSnapshot();
      if (snapshot) {
        this.applySnapshot(snapshot);
      }
    } catch (error) {
      console.warn('[FeedbackRuntime] Failed to load latest model snapshot', error);
    }
  }

  private applySnapshot(snapshot: ModelSnapshotRecord): void {
    const baseVersion = typeof snapshot.metadata?.baseVersion === 'string' ? snapshot.metadata.baseVersion : null;
    if (baseVersion) {
      this.sync.setBaseModelVersion(baseVersion);
      this.setState({ baseModelVersion: baseVersion });
    }
    const lastTraining: TrainingSnapshotInfo = {
      modelVersion: snapshot.modelVersion,
      baseModelVersion: baseVersion,
      samples: Number(snapshot.metadata?.samples ?? 0),
      durationMs: Number(snapshot.metadata?.durationMs ?? 0),
      timestamp: snapshot.createdAt,
    };
    this.setState({
      localModelVersion: snapshot.modelVersion,
      lastTraining,
    });
  }
}

let runtimeInstance: FeedbackRuntime | null = null;
type FeedbackTrainerFactory = (options?: ConstructorParameters<typeof FeedbackTrainer>[0]) => FeedbackTrainer;
type FeedbackSyncFactory = () => FeedbackSync;

let createTrainer: FeedbackTrainerFactory = (options) => new FeedbackTrainer(options);
let createSync: FeedbackSyncFactory = () => new FeedbackSync();

function ensureRuntime(): FeedbackRuntime | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!runtimeInstance) {
    runtimeInstance = new FeedbackRuntime();
  }
  return runtimeInstance;
}

export function updateFeedbackRuntimePreferences(preferences: BrowserPreferences): void {
  ensureRuntime()?.updatePreferences(preferences);
}

export function subscribeFeedbackRuntime(listener: (state: FeedbackRuntimeState) => void): () => void {
  const runtime = ensureRuntime();
  if (!runtime) {
    listener(INITIAL_STATE);
    return () => {};
  }
  return runtime.subscribe(listener);
}

export function getFeedbackRuntimeState(): FeedbackRuntimeState {
  return ensureRuntime()?.getState() ?? INITIAL_STATE;
}

export function destroyFeedbackRuntime(): void {
  if (runtimeInstance) {
    runtimeInstance.destroy();
    runtimeInstance = null;
  }
}

export function triggerFeedbackTraining(reason?: string): void {
  ensureRuntime()?.requestTrainingRun(reason);
}

export function triggerFeedbackSync(): void {
  ensureRuntime()?.requestSyncUpload();
}

export function __setFeedbackRuntimeFactoriesForTests(factories: {
  trainer?: FeedbackTrainerFactory;
  sync?: FeedbackSyncFactory;
}): void {
  if (factories.trainer) {
    createTrainer = factories.trainer;
  }
  if (factories.sync) {
    createSync = factories.sync;
  }
}

export function __resetFeedbackRuntimeForTests(): void {
  destroyFeedbackRuntime();
  createTrainer = (options) => new FeedbackTrainer(options);
  createSync = () => new FeedbackSync();
}
