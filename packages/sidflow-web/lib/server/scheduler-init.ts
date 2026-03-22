/**
 * Server-side scheduler initialization
 * 
 * This module is imported by API routes that need the scheduler to be active.
 * The scheduler starts when this module is first loaded.
 */

import { startScheduler, stopScheduler, getSchedulerStatus } from '@/lib/scheduler';
import { getWebPreferences } from '@/lib/preferences-store';
import { findLatestJobByType, getJobOrchestrator } from '@/lib/server/jobs';

let schedulerInitialized = false;

/**
 * Pipeline callback that triggers fetch + classify
 */
export async function runScheduledPipeline(): Promise<void> {
  console.log('[scheduler-init] Starting scheduled pipeline run...');
  
  try {
    const prefs = await getWebPreferences();
    const renderPrefs = prefs.renderPrefs ?? { preserveWav: true, enableFlac: false, enableM4a: false };

    const orchestrator = await getJobOrchestrator();
    const jobs = orchestrator.listJobs();
    const activeFetch = findLatestJobByType(jobs, 'fetch', ['pending', 'running', 'paused']);
    const activeClassify = findLatestJobByType(jobs, 'classify', ['pending', 'running', 'paused']);
    const activeTrain = findLatestJobByType(jobs, 'train', ['pending', 'running', 'paused']);

    if (!activeFetch) {
      const fetchJob = await orchestrator.createJob('fetch', {});
      console.log('[scheduler-init] Queued fetch job', { jobId: fetchJob.id });
    } else {
      console.log('[scheduler-init] Reusing active fetch job', { jobId: activeFetch.id });
    }

    if (!activeClassify) {
      const classifyJob = await orchestrator.createJob('classify', {
        skipAlreadyClassified: true,
        deleteWavAfterClassification: !renderPrefs.preserveWav,
      });
      console.log('[scheduler-init] Queued classify job', { jobId: classifyJob.id });
    } else {
      console.log('[scheduler-init] Reusing active classify job', { jobId: activeClassify.id });
    }

    if (prefs.training?.enabled) {
      if (!activeTrain) {
        const trainJob = await orchestrator.createJob('train', {
          auto: true,
        });
        console.log('[scheduler-init] Queued automatic train job', { jobId: trainJob.id });
      } else {
        console.log('[scheduler-init] Reusing active train job', { jobId: activeTrain.id });
      }
    }
    
    console.log('[scheduler-init] Scheduled pipeline run completed');
  } catch (error) {
    console.error('[scheduler-init] Error in scheduled pipeline:', error);
  }
}

/**
 * Initialize the scheduler if not already initialized
 * This is called by API routes that need the scheduler to be active
 */
export async function ensureSchedulerInitialized(): Promise<void> {
  if (schedulerInitialized) {
    return;
  }
  
  schedulerInitialized = true;
  
  try {
    const prefs = await getWebPreferences();
    
    if (prefs.scheduler?.enabled) {
      console.log('[scheduler-init] Starting scheduler with config:', prefs.scheduler);
      await startScheduler(runScheduledPipeline);
    } else {
      console.log('[scheduler-init] Scheduler is disabled');
    }
  } catch (error) {
    console.error('[scheduler-init] Failed to initialize scheduler:', error);
    schedulerInitialized = false;
  }
}

/**
 * Reinitialize the scheduler with updated preferences
 * Called when scheduler preferences are changed
 */
export async function reinitializeScheduler(): Promise<void> {
  console.log('[scheduler-init] Reinitializing scheduler...');
  schedulerInitialized = false;
  stopScheduler();
  await ensureSchedulerInitialized();
}

/**
 * Get current scheduler state
 */
export function getSchedulerState(): ReturnType<typeof getSchedulerStatus> {
  return getSchedulerStatus();
}
