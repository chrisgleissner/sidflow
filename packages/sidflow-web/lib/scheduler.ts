/**
 * Nightly scheduler for running fetch + classify pipeline
 * 
 * Features:
 * - Runs at configurable time (default 6am UTC)
 * - Skips if fetch or classify already running
 * - Uses preferences from .sidflow-preferences.json
 */

import { getWebPreferences, type SchedulerConfig } from './preferences-store';
import { isFetchRunning } from './fetch-progress-store';
import { getClassifyProgressSnapshot } from './classify-progress-store';

let schedulerTimeoutId: NodeJS.Timeout | null = null;
let isSchedulerActive = false;
let lastScheduledRun: Date | null = null;
let nextScheduledRun: Date | null = null;

/**
 * Parses a time string in HH:MM format
 */
function parseTimeString(time: string): { hours: number; minutes: number } {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.warn(`[scheduler] Invalid time format: ${time}, using default 06:00`);
    return { hours: 6, minutes: 0 };
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    console.warn(`[scheduler] Invalid time values: ${time}, using default 06:00`);
    return { hours: 6, minutes: 0 };
  }
  return { hours, minutes };
}

/**
 * Calculates the next run time based on current time and scheduler config
 */
export function calculateNextRunTime(config: SchedulerConfig, now: Date = new Date()): Date {
  const { hours, minutes } = parseTimeString(config.time);
  
  // Only support UTC timezone for now. If a non-UTC timezone is provided, throw an error.
  // For proper timezone support, use a library like 'luxon' or 'date-fns-tz'.
  const nextRun = new Date(now);
  
  if (config.timezone !== 'UTC') {
    throw new Error(
      `[scheduler] Only 'UTC' timezone is supported. Received '${config.timezone}'. ` +
      "Please set your scheduler timezone to 'UTC'. " +
      "For proper timezone support, use a library like 'luxon' or 'date-fns-tz'."
    );
  }

  nextRun.setUTCHours(hours, minutes, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (nextRun.getTime() <= now.getTime()) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }
  return nextRun;
}

/**
 * Gets the milliseconds until the next scheduled run
 */
export function getMillisUntilNextRun(config: SchedulerConfig, now: Date = new Date()): number {
  const nextRun = calculateNextRunTime(config, now);
  return Math.max(0, nextRun.getTime() - now.getTime());
}

/**
 * Checks if the pipeline (fetch or classify) is currently running
 */
export function isPipelineRunning(): boolean {
  const fetchRunning = isFetchRunning();
  const classifySnapshot = getClassifyProgressSnapshot();
  const classifyRunning = classifySnapshot.isActive;
  
  return fetchRunning || classifyRunning;
}

/**
 * Callback type for when the scheduler triggers a run
 */
export type SchedulerCallback = () => Promise<void>;

let schedulerCallback: SchedulerCallback | null = null;

/**
 * Schedules the next run of the fetch + classify pipeline
 */
async function scheduleNextRun(): Promise<void> {
  const prefs = await getWebPreferences();
  const config = prefs.scheduler;
  
  if (!config?.enabled) {
    console.log('[scheduler] Scheduler is disabled');
    isSchedulerActive = false;
    nextScheduledRun = null;
    return;
  }
  
  const now = new Date();
  const millisUntilRun = getMillisUntilNextRun(config, now);
  nextScheduledRun = calculateNextRunTime(config, now);
  
  console.log(`[scheduler] Next run scheduled for ${nextScheduledRun.toISOString()} (in ${Math.round(millisUntilRun / 1000 / 60)} minutes)`);
  
  if (schedulerTimeoutId) {
    clearTimeout(schedulerTimeoutId);
  }
  
  schedulerTimeoutId = setTimeout(async () => {
    await executeScheduledRun();
  }, millisUntilRun);
  
  isSchedulerActive = true;
}

/**
 * Executes the scheduled fetch + classify pipeline
 */
async function executeScheduledRun(): Promise<void> {
  console.log('[scheduler] Executing scheduled run...');
  lastScheduledRun = new Date();
  
  // Check if already running
  if (isPipelineRunning()) {
    console.log('[scheduler] Pipeline already running, skipping scheduled run');
    // Schedule the next run
    await scheduleNextRun();
    return;
  }
  
  try {
    if (schedulerCallback) {
      await schedulerCallback();
    } else {
      console.warn('[scheduler] No callback registered for scheduled runs');
    }
  } catch (error) {
    console.error('[scheduler] Error during scheduled run:', error);
  }
  
  // Schedule the next run
  await scheduleNextRun();
}

/**
 * Starts the scheduler with the provided callback
 * The callback will be called when it's time to run fetch + classify
 */
export async function startScheduler(callback: SchedulerCallback): Promise<void> {
  schedulerCallback = callback;
  await scheduleNextRun();
}

/**
 * Stops the scheduler
 */
export function stopScheduler(): void {
  if (schedulerTimeoutId) {
    clearTimeout(schedulerTimeoutId);
    schedulerTimeoutId = null;
  }
  isSchedulerActive = false;
  schedulerCallback = null;
  nextScheduledRun = null;
  console.log('[scheduler] Scheduler stopped');
}

/**
 * Restarts the scheduler (e.g., when preferences change)
 */
export async function restartScheduler(): Promise<void> {
  if (schedulerCallback) {
    const callback = schedulerCallback;
    stopScheduler();
    await startScheduler(callback);
  }
}

/**
 * Gets the current scheduler status
 */
export function getSchedulerStatus(): {
  isActive: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  isPipelineRunning: boolean;
} {
  return {
    isActive: isSchedulerActive,
    lastRun: lastScheduledRun,
    nextRun: nextScheduledRun,
    isPipelineRunning: isPipelineRunning(),
  };
}

