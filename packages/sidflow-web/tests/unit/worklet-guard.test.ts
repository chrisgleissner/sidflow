import { describe, expect, it } from 'bun:test';
import { WorkletGuard, type WorkletGuardSample } from '@/lib/player/worklet-guard';

type Scheduler = {
  raf: (callback: FrameRequestCallback) => number;
  cancelRaf: (handle: number) => void;
  step: () => number;
  flush: (frames: number) => void;
  now: () => number;
  pending: () => number;
};

function createScheduler(frameDurations: number[]): Scheduler {
  let currentTime = 0;
  let handleCounter = 0;
  const queue: Array<{ id: number; callback: FrameRequestCallback }> = [];

  const raf = (callback: FrameRequestCallback) => {
    const id = ++handleCounter;
    queue.push({ id, callback });
    return id;
  };

  const cancelRaf = (handle: number) => {
    const index = queue.findIndex((entry) => entry.id === handle);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  };

  const step = () => {
    if (queue.length === 0) {
      throw new Error('No frames scheduled');
    }
    const entry = queue.shift()!;
    const duration = frameDurations.shift() ?? frameDurations[frameDurations.length - 1] ?? 16.67;
    currentTime += duration;
    entry.callback(currentTime);
    return currentTime;
  };

  const flush = (frames: number) => {
    for (let i = 0; i < frames; i += 1) {
      if (queue.length === 0) {
        break;
      }
      step();
    }
  };

  return {
    raf,
    cancelRaf,
    step,
    flush,
    now: () => currentTime,
    pending: () => queue.length,
  } satisfies Scheduler;
}

describe('WorkletGuard', () => {
  it('emits warnings when average frame duration exceeds budget', () => {
    const scheduler = createScheduler([20, 21, 22, 16, 16, 16]);
    const warnings: WorkletGuardSample[] = [];
    const guard = new WorkletGuard({
      sampleFrameCount: 3,
      warningBudgetMs: 2,
      idealFrameDurationMs: 16,
      raf: scheduler.raf,
      cancelRaf: scheduler.cancelRaf,
      now: scheduler.now,
      onWarning: (sample) => {
        warnings.push(sample);
      },
    });

  guard.start();
  scheduler.flush(4);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.avgFrameDurationMs).toBeGreaterThan(18);
    expect(warnings[0]?.overBudgetFrameCount).toBeGreaterThan(0);

  const result = guard.stop('paused');
  expect(result).not.toBeNull();
  expect(result?.warningCount).toBe(1);
  expect(result?.totalFrames).toBeGreaterThanOrEqual(3);
  });

  it('records summary stats on stop', () => {
    const scheduler = createScheduler([16, 17, 18, 19, 20, 21]);
    const guard = new WorkletGuard({
      sampleFrameCount: 4,
      warningBudgetMs: 2,
      idealFrameDurationMs: 16,
      raf: scheduler.raf,
      cancelRaf: scheduler.cancelRaf,
      now: scheduler.now,
    });

  guard.start();
  scheduler.flush(6);

    const result = guard.stop('ended');
    expect(result).not.toBeNull();
  expect(result?.totalFrames).toBe(5);
    expect(result?.avgFrameDurationMs).toBeGreaterThan(17);
  expect(result?.worstFrameDurationMs).toBeGreaterThanOrEqual(20);
    expect(result?.warningBudgetMs).toBe(2);
  });
});
