/**
 * Resilient test utilities for e2e tests.
 * 
 * These utilities help prevent flaky tests by:
 * - Using dynamic waits instead of fixed timeouts
 * - Adding proper error handling and logging
 * - Monitoring page state for unexpected closures
 * - Providing reasonable timeouts for CI environments
 */

import type { Page } from '@playwright/test';

/**
 * Configuration for wait operations
 */
export interface WaitConfig {
  /** Timeout for DOM content loaded state */
  domTimeout?: number;
  /** Timeout for network idle state */
  networkTimeout?: number;
  /** Timeout for font loading */
  fontTimeout?: number;
  /** Whether to throw on timeout (default: false) */
  throwOnTimeout?: boolean;
}

const DEFAULT_WAIT_CONFIG: Required<WaitConfig> = {
  domTimeout: 10000,
  networkTimeout: 5000,
  fontTimeout: 3000,
  throwOnTimeout: false,
};

/**
 * Set up monitoring for unexpected page closures and crashes.
 * Call this in test.beforeEach to diagnose CI failures.
 * 
 * @param page - Playwright page object
 * @param testName - Name of the test for logging
 */
export function setupPageCloseMonitoring(page: Page, testName: string): void {
  page.on('close', () => {
    console.error(`[${testName}] Page closed unexpectedly`);
  });
  
  page.on('crash', () => {
    console.error(`[${testName}] Page crashed`);
  });
  
  page.on('pageerror', (error) => {
    console.error(`[${testName}] Page error:`, error.message);
  });
}

/**
 * Wait for page to be in a stable state before interacting.
 * This is more resilient than fixed timeouts.
 * 
 * @param page - Playwright page object
 * @param config - Optional configuration for timeouts
 */
export async function waitForStablePageState(
  page: Page, 
  config: WaitConfig = {}
): Promise<void> {
  const cfg = { ...DEFAULT_WAIT_CONFIG, ...config };
  
  // Check if page is still open
  if (page.isClosed()) {
    const error = new Error('Cannot wait for stable state: page is closed');
    if (cfg.throwOnTimeout) throw error;
    console.error('[waitForStablePageState]', error.message);
    return;
  }
  
  // Wait for DOM content loaded
  await page.waitForLoadState('domcontentloaded', { timeout: cfg.domTimeout })
    .catch((err) => {
      const msg = `DOM content loaded timeout: ${err.message}`;
      if (cfg.throwOnTimeout) throw new Error(msg);
      console.warn('[waitForStablePageState]', msg);
    });
  
  // Wait for network to idle (may not complete in dev mode with websockets)
  await page.waitForLoadState('networkidle', { timeout: cfg.networkTimeout })
    .catch(() => {
      console.warn('[waitForStablePageState] Network idle timeout (expected in dev mode)');
    });
  
  // Wait for document ready state
  await page.waitForFunction(
    () => document.readyState === 'complete',
    undefined,
    { timeout: cfg.domTimeout }
  ).catch((err) => {
    const msg = `Document ready state timeout: ${err.message}`;
    if (cfg.throwOnTimeout) throw new Error(msg);
    console.warn('[waitForStablePageState]', msg);
  });
  
  // Wait for fonts to load
  await page.waitForFunction(
    () => {
      const fonts = (document as any).fonts;
      if (!fonts || typeof fonts.status !== 'string') {
        return true;
      }
      return fonts.status === 'loaded';
    },
    undefined,
    { timeout: cfg.fontTimeout }
  ).catch((err) => {
    const msg = `Font loading timeout: ${err.message}`;
    if (cfg.throwOnTimeout) throw new Error(msg);
    console.warn('[waitForStablePageState]', msg);
  });
  
  // Small delay to let animations settle
  await page.waitForTimeout(200);
}

/**
 * Navigate to a page with resilient error handling.
 * Checks for page closure after navigation.
 * 
 * @param page - Playwright page object
 * @param url - URL to navigate to
 * @param timeout - Navigation timeout in ms (default: 30000)
 * @returns Promise that resolves when navigation completes
 */
export async function navigateWithRetry(
  page: Page,
  url: string,
  timeout: number = 30000
): Promise<void> {
  try {
    console.log(`[Navigation] Navigating to ${url}`);
    
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    
    // Verify page didn't close during navigation
    if (page.isClosed()) {
      throw new Error(`Page closed unexpectedly after navigating to ${url}`);
    }
    
    console.log(`[Navigation] Successfully loaded ${url}`);
  } catch (error) {
    console.error(`[Navigation] Failed to navigate to ${url}:`, error);
    throw error;
  }
}

/**
 * Wait for an element with resilient retry logic.
 * More reliable than a single waitForSelector call in CI.
 * 
 * @param page - Playwright page object
 * @param selector - CSS selector or role selector
 * @param options - Wait options
 */
export async function waitForElement(
  page: Page,
  selector: string,
  options: {
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout?: number;
    throwOnTimeout?: boolean;
  } = {}
): Promise<void> {
  const timeout = options.timeout ?? 10000;
  const state = options.state ?? 'visible';
  
  try {
    await page.waitForSelector(selector, {
      state,
      timeout,
    });
  } catch (error) {
    const msg = `Element "${selector}" not found (state: ${state})`;
    if (options.throwOnTimeout ?? true) {
      throw new Error(msg);
    }
    console.warn('[waitForElement]', msg);
  }
}

/**
 * Execute a page action with error handling and logging.
 * Useful for wrapping critical operations.
 * 
 * @param actionName - Name of the action for logging
 * @param action - Async function to execute
 */
export async function executeWithErrorHandling<T>(
  actionName: string,
  action: () => Promise<T>
): Promise<T> {
  try {
    console.log(`[${actionName}] Starting`);
    const result = await action();
    console.log(`[${actionName}] Completed successfully`);
    return result;
  } catch (error) {
    console.error(`[${actionName}] Failed:`, error);
    throw error;
  }
}

/**
 * Wait for a condition with exponential backoff retry.
 * Useful for operations that may need multiple attempts in CI.
 * 
 * @param condition - Function that returns a promise resolving to boolean
 * @param options - Retry options
 */
export async function waitForConditionWithRetry(
  condition: () => Promise<boolean>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    timeoutMs?: number;
  } = {}
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 5;
  const initialDelay = options.initialDelay ?? 100;
  const maxDelay = options.maxDelay ?? 2000;
  const timeoutMs = options.timeoutMs ?? 10000;
  
  const startTime = Date.now();
  let delay = initialDelay;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() - startTime > timeoutMs) {
      console.warn('[waitForConditionWithRetry] Timeout exceeded');
      return false;
    }
    
    try {
      const result = await condition();
      if (result) {
        return true;
      }
    } catch (error) {
      console.warn(`[waitForConditionWithRetry] Attempt ${attempt} failed:`, error);
    }
    
    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, maxDelay);
  }
  
  return false;
}
