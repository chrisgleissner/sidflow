/**
 * Server-side scheduler initialization
 * 
 * This module is imported by API routes that need the scheduler to be active.
 * The scheduler starts when this module is first loaded.
 */

import { startScheduler, stopScheduler, getSchedulerStatus } from '@/lib/scheduler';
import { getWebPreferences } from '@/lib/preferences-store';

let schedulerInitialized = false;

/**
 * Pipeline callback that triggers fetch + classify
 */
async function runScheduledPipeline(): Promise<void> {
  console.log('[scheduler-init] Starting scheduled pipeline run...');
  
  try {
    const prefs = await getWebPreferences();
    const renderPrefs = prefs.renderPrefs ?? { preserveWav: true, enableFlac: false, enableM4a: false };
    
    // First run fetch
    console.log('[scheduler-init] Step 1: Running fetch...');
    const fetchResponse = await fetch(`${getBaseUrl()}/api/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    
    if (!fetchResponse.ok) {
      const result = await fetchResponse.json();
      console.error('[scheduler-init] Fetch failed:', result.error);
      // Continue to classify even if fetch fails - may have local SID files
    } else {
      console.log('[scheduler-init] Fetch completed successfully');
    }
    
    // Then run classify with skip-already-classified and render preferences
    console.log('[scheduler-init] Step 2: Running classify...');
    const classifyResponse = await fetch(`${getBaseUrl()}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skipAlreadyClassified: true,
        deleteWavAfterClassification: !renderPrefs.preserveWav,
      }),
    });
    
    if (!classifyResponse.ok) {
      const result = await classifyResponse.json();
      console.error('[scheduler-init] Classify failed:', result.error);
    } else {
      console.log('[scheduler-init] Classify completed successfully');
    }
    
    console.log('[scheduler-init] Scheduled pipeline run completed');
  } catch (error) {
    console.error('[scheduler-init] Error in scheduled pipeline:', error);
  }
}

/**
 * Gets the base URL for internal API calls
 */
function getBaseUrl(): string {
  // Support configurable base URL for different environments
  if (process.env.SIDFLOW_BASE_URL) {
    return process.env.SIDFLOW_BASE_URL;
  }
  // Default to localhost with configurable port
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || 'localhost';
  return `http://${host}:${port}`;
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
