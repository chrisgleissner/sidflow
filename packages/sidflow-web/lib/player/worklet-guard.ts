export type WorkletGuardOutcome =
  | 'paused'
  | 'ended'
  | 'error'
  | 'stopped'
  | 'loading'
  | 'ready'
  | 'teardown';

export interface WorkletGuardSample {
  readonly avgFrameDurationMs: number;
  readonly worstFrameDurationMs: number;
  readonly overBudgetFrameCount: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly timestampMs: number;
  readonly warningBudgetMs: number;
}

export interface WorkletGuardResult {
  readonly outcome: WorkletGuardOutcome;
  readonly durationMs: number;
  readonly totalFrames: number;
  readonly avgFrameDurationMs: number;
  readonly worstFrameDurationMs: number;
  readonly overBudgetFrameCount: number;
  readonly warningCount: number;
  readonly lastWarning: WorkletGuardSample | null;
  readonly warningBudgetMs: number;
}

export interface WorkletGuardOptions {
  readonly sampleFrameCount?: number;
  readonly warningBudgetMs?: number;
  readonly idealFrameDurationMs?: number;
  readonly raf?: (callback: FrameRequestCallback) => number;
  readonly cancelRaf?: (handle: number) => void;
  readonly now?: () => number;
  readonly onWarning?: (sample: WorkletGuardSample) => void;
}

/**
 * Monitors requestAnimationFrame deltas to detect main-thread stalls while the worklet plays.
 */
export class WorkletGuard {
  private readonly sampleFrameCount: number;
  private readonly warningBudgetMs: number;
  private readonly idealFrameDurationMs: number;
  private readonly raf: ((callback: FrameRequestCallback) => number) | null;
  private readonly cancelRaf: ((handle: number) => void) | null;
  private readonly now: () => number;
  private readonly onWarning?: (sample: WorkletGuardSample) => void;

  private rafHandle: number | null = null;
  private lastFrameTimestamp: number | null = null;
  private startTimestamp: number | null = null;
  private running = false;

  private totalFrames = 0;
  private totalDuration = 0;
  private worstFrameDuration = 0;
  private overBudgetFrames = 0;
  private warningCount = 0;
  private lastWarning: WorkletGuardSample | null = null;

  private sampleFrames = 0;
  private sampleDuration = 0;
  private sampleWorst = 0;
  private sampleOverBudget = 0;

  constructor(options: WorkletGuardOptions = {}) {
    this.sampleFrameCount = options.sampleFrameCount ? Math.max(1, options.sampleFrameCount) : 120;
    this.warningBudgetMs = options.warningBudgetMs ?? 2;
    this.idealFrameDurationMs = options.idealFrameDurationMs ?? 1000 / 60;

    if (options.raf) {
      this.raf = options.raf;
      this.cancelRaf = options.cancelRaf ?? (() => undefined);
    } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.raf = window.requestAnimationFrame.bind(window);
      this.cancelRaf = window.cancelAnimationFrame?.bind(window) ?? null;
    } else if (typeof globalThis.requestAnimationFrame === 'function') {
      this.raf = globalThis.requestAnimationFrame.bind(globalThis);
      this.cancelRaf = globalThis.cancelAnimationFrame
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : null;
    } else {
      this.raf = null;
      this.cancelRaf = null;
    }

    if (options.now) {
      this.now = options.now;
    } else if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      this.now = () => performance.now();
    } else {
      this.now = () => Date.now();
    }

    this.onWarning = options.onWarning;
  }

  isSupported(): boolean {
    return this.raf !== null;
  }

  start(): void {
    if (!this.isSupported()) {
      return;
    }

    if (this.running) {
      this.stop('teardown');
    }

    this.running = true;
    this.lastFrameTimestamp = null;
    this.startTimestamp = this.now();
    this.totalFrames = 0;
    this.totalDuration = 0;
    this.worstFrameDuration = 0;
    this.overBudgetFrames = 0;
    this.warningCount = 0;
    this.lastWarning = null;
    this.sampleFrames = 0;
    this.sampleDuration = 0;
    this.sampleWorst = 0;
    this.sampleOverBudget = 0;

    this.scheduleNextFrame();
  }

  stop(outcome: WorkletGuardOutcome): WorkletGuardResult | null {
    if (!this.running) {
      return null;
    }

    if (this.rafHandle !== null && this.cancelRaf) {
      this.cancelRaf(this.rafHandle);
    }

    const elapsed = this.now();

    const totalFrames = this.totalFrames;
    const avgFrameDurationMs = totalFrames > 0 ? this.totalDuration / totalFrames : 0;
    const durationMs = this.startTimestamp !== null ? elapsed - this.startTimestamp : 0;

    this.running = false;
    this.rafHandle = null;
    this.lastFrameTimestamp = null;

    return {
      outcome,
      durationMs,
      totalFrames,
      avgFrameDurationMs,
      worstFrameDurationMs: this.worstFrameDuration,
      overBudgetFrameCount: this.overBudgetFrames,
      warningCount: this.warningCount,
      lastWarning: this.lastWarning,
      warningBudgetMs: this.warningBudgetMs,
    };
  }

  private scheduleNextFrame(): void {
    if (!this.running || !this.raf) {
      return;
    }
    this.rafHandle = this.raf((timestamp) => {
      this.handleFrame(timestamp);
    });
  }

  private handleFrame(timestamp: number): void {
    if (!this.running) {
      return;
    }

    if (this.lastFrameTimestamp === null) {
      this.lastFrameTimestamp = timestamp;
      this.scheduleNextFrame();
      return;
    }

    const delta = timestamp - this.lastFrameTimestamp;
    this.lastFrameTimestamp = timestamp;

    this.totalFrames += 1;
    this.totalDuration += delta;
    this.worstFrameDuration = Math.max(this.worstFrameDuration, delta);

    const overBudgetThreshold = this.idealFrameDurationMs + this.warningBudgetMs;
    if (delta > overBudgetThreshold) {
      this.overBudgetFrames += 1;
      this.sampleOverBudget += 1;
    }

    this.sampleFrames += 1;
    this.sampleDuration += delta;
    this.sampleWorst = Math.max(this.sampleWorst, delta);

    if (this.sampleFrames >= this.sampleFrameCount) {
      this.evaluateSample(timestamp);
    }

    this.scheduleNextFrame();
  }

  private evaluateSample(timestamp: number): void {
    if (this.sampleFrames === 0) {
      return;
    }

    const avgFrameDurationMs = this.sampleDuration / this.sampleFrames;
    const sample: WorkletGuardSample = {
      avgFrameDurationMs,
      worstFrameDurationMs: this.sampleWorst,
      overBudgetFrameCount: this.sampleOverBudget,
      frameCount: this.sampleFrames,
      durationMs: this.sampleDuration,
      timestampMs: timestamp,
      warningBudgetMs: this.warningBudgetMs,
    };

    if (avgFrameDurationMs - this.idealFrameDurationMs > this.warningBudgetMs) {
      this.warningCount += 1;
      this.lastWarning = sample;
      if (this.onWarning) {
        this.onWarning(sample);
      }
    }

    this.sampleFrames = 0;
    this.sampleDuration = 0;
    this.sampleWorst = 0;
    this.sampleOverBudget = 0;
  }
}
