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

/**
 * Check if fonts are loaded.
 * Centralized utility to avoid inconsistent font checking patterns.
 * 
 * @returns true if fonts are loaded or Font API is not available
 */
export function checkFontsLoaded(): boolean {
  const fonts = (document as any).fonts;
  if (!fonts || typeof fonts.status !== 'string') {
    return true; // Fonts API not available, assume loaded
  }
  return fonts.status === 'loaded';
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
  
  // Wait for fonts to load using centralized check
  await page.waitForFunction(
    checkFontsLoaded,
    undefined,
    { timeout: cfg.fontTimeout }
  ).catch((err) => {
    const msg = `Font loading timeout: ${err.message}`;
    if (cfg.throwOnTimeout) throw new Error(msg);
    console.warn('[waitForStablePageState]', msg);
  });
}

/**
 * Navigate to a page with error context and page closure detection.
 * Provides diagnostic logging for navigation failures.
 * 
 * @param page - Playwright page object
 * @param url - URL to navigate to
 * @param timeout - Navigation timeout in ms (default: 30000)
 * @returns Promise that resolves when navigation completes
 */
export async function navigateWithErrorContext(
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


