import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import 'fake-indexeddb/auto';

const trainerInstances: StubTrainer[] = [];
const syncInstances: StubSync[] = [];

class StubTrainer {
  public updateConfigCalls: Array<Partial<Record<string, unknown>>> = [];
  public notifyCalls: string[] = [];
  public stopped = false;
  public onSnapshot: ((info: unknown) => void) | null;

  constructor(options?: { onSnapshot?: (info: unknown) => void }) {
    this.onSnapshot = options?.onSnapshot ?? null;
    trainerInstances.push(this);
  }

  updateConfig(config: Partial<Record<string, unknown>>): void {
    this.updateConfigCalls.push(config);
  }

  notifyPendingWork(reason: string = ''): void {
    this.notifyCalls.push(reason);
  }

  stop(): void {
    this.stopped = true;
  }
}

class StubSync {
  public updateConfigCalls: Array<Partial<Record<string, unknown>>> = [];
  public notifyCount = 0;
  public stopped = false;
  public baseVersion: string | null = null;
  public listener: ((summary: unknown) => void) | null = null;

  constructor() {
    syncInstances.push(this);
  }

  updateConfig(config: Partial<Record<string, unknown>>): void {
    this.updateConfigCalls.push(config);
  }

  notifyPendingWork(): void {
    this.notifyCount += 1;
  }

  stop(): void {
    this.stopped = true;
  }

  setBaseModelVersion(version: string | null): void {
    this.baseVersion = version;
  }

  subscribe(listener: (summary: unknown) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }
}

mock.module('@/lib/feedback/trainer', () => ({
  FeedbackTrainer: StubTrainer,
}));

mock.module('@/lib/feedback/sync', () => ({
  FeedbackSync: StubSync,
}));

mock.module('@/lib/feedback/global-model', () => ({
  fetchGlobalModelManifest: async () => ({
    modelVersion: 'global-test',
    manifestHash: 'hash',
  }),
}));

const runtimeModule = await import('@/lib/feedback/runtime');
const {
  updateFeedbackRuntimePreferences,
  triggerFeedbackTraining,
  triggerFeedbackSync,
  getFeedbackRuntimeState,
  destroyFeedbackRuntime,
  __resetFeedbackRuntimeForTests,
} = runtimeModule;

const { DEFAULT_BROWSER_PREFERENCES } = await import('@/lib/preferences/schema');
const { emitFeedbackEvent } = await import('@/lib/feedback/events');

describe('feedback runtime', () => {
  beforeAll(() => {
    if (typeof globalThis.window === 'undefined') {
      (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
    }
    if (typeof globalThis.navigator === 'undefined') {
      (globalThis as unknown as { navigator: { onLine: boolean } }).navigator = { onLine: true };
    }
  });

  beforeEach(() => {
    trainerInstances.length = 0;
    syncInstances.length = 0;
    __resetFeedbackRuntimeForTests();
  });

  afterEach(() => {
    destroyFeedbackRuntime();
  });

  afterAll(() => {
    mock.restore();
  });

  function clonePreferences() {
    return structuredClone(DEFAULT_BROWSER_PREFERENCES);
  }

  it('does not queue training when disabled', () => {
    const prefs = clonePreferences();
    prefs.training.enabled = false;
    updateFeedbackRuntimePreferences(prefs);

    emitFeedbackEvent('rating');

    const trainer = trainerInstances[0];
    expect(trainer?.notifyCalls ?? []).toEqual([]);
  });

  it('queues training when enabled', () => {
    const prefs = clonePreferences();
    prefs.training.enabled = true;
    updateFeedbackRuntimePreferences(prefs);

    emitFeedbackEvent('rating');

    const trainer = trainerInstances[0];
    expect(trainer?.notifyCalls).toContain('feedback');
  });

  it('manual training respects preference toggle', () => {
    const prefs = clonePreferences();
    prefs.training.enabled = false;
    updateFeedbackRuntimePreferences(prefs);

    triggerFeedbackTraining('manual');
    expect(trainerInstances[0]?.notifyCalls ?? []).toEqual([]);

    prefs.training.enabled = true;
    updateFeedbackRuntimePreferences(prefs);
    triggerFeedbackTraining('manual');

    expect(trainerInstances[0]?.notifyCalls).toContain('manual');
  });

  it('sync scheduler only fires when uploads allowed', () => {
    const prefs = clonePreferences();
    prefs.training.allowUpload = false;
    updateFeedbackRuntimePreferences(prefs);

    emitFeedbackEvent('implicit');
    triggerFeedbackSync();
    expect(syncInstances[0]?.notifyCount ?? 0).toBe(0);

    prefs.training.allowUpload = true;
    updateFeedbackRuntimePreferences(prefs);
    emitFeedbackEvent('rating');
    triggerFeedbackSync();

    expect(syncInstances[0]?.notifyCount ?? 0).toBeGreaterThan(0);
  });

  it('exposes runtime state with defaults when disabled', () => {
    const state = getFeedbackRuntimeState();
    expect(state.trainingEnabled).toBe(false);
    expect(state.uploadingEnabled).toBe(false);
  });
});
