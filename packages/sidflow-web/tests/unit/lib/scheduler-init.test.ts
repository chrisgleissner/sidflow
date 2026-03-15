import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runScheduledPipeline } from '@/lib/server/scheduler-init';
import { getJobOrchestrator } from '@/lib/server/jobs';
import { resetServerEnvCacheForTests } from '@/lib/server-env';

describe('scheduler-init durable jobs', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;
  let originalPrefsPath: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-scheduler-init-'));
    await mkdir(path.join(tempRoot, 'data', 'jobs'), { recursive: true });

    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    originalPrefsPath = process.env.SIDFLOW_PREFS_PATH;

    process.env.SIDFLOW_ROOT = tempRoot;
    process.env.SIDFLOW_PREFS_PATH = path.join(tempRoot, '.prefs.json');
    await writeFile(
      process.env.SIDFLOW_PREFS_PATH,
      JSON.stringify({
        scheduler: { enabled: true, time: '06:00', timezone: 'UTC' },
        renderPrefs: { preserveWav: false, enableFlac: false, enableM4a: false },
      }, null, 2),
      'utf8',
    );
    resetServerEnvCacheForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) {
      delete process.env.SIDFLOW_ROOT;
    } else {
      process.env.SIDFLOW_ROOT = originalSidflowRoot;
    }
    if (originalPrefsPath === undefined) {
      delete process.env.SIDFLOW_PREFS_PATH;
    } else {
      process.env.SIDFLOW_PREFS_PATH = originalPrefsPath;
    }
    resetServerEnvCacheForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('queues fetch and classify jobs instead of calling internal HTTP routes', async () => {
    await runScheduledPipeline();

    const orchestrator = await getJobOrchestrator();
    const jobs = orchestrator.listJobs();
    expect(jobs.map((job) => job.type).sort()).toEqual(['classify', 'fetch']);

    const classifyJob = jobs.find((job) => job.type === 'classify');
    expect(classifyJob?.params).toMatchObject({
      skipAlreadyClassified: true,
      deleteWavAfterClassification: true,
    });
  });
});