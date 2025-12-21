/**
 * Shared test utilities for e2e tests.
 * Provides deterministic waiting patterns that avoid flaky waitForTimeout calls.
 */

import type { Page } from '@playwright/test';

/**
 * Wait for the page to be ready for keyboard shortcuts.
 * This is more reliable than a fixed timeout because it waits for
 * the actual condition (document focused and no spinners).
 */
export async function waitForKeyboardReady(page: Page): Promise<void> {
  // Wait for any loading spinners to disappear
  await page.waitForFunction(() => {
    return document.querySelector('.animate-spin') === null;
  }, { timeout: 5000 }).catch(() => {});
  
  // Ensure document body is focused and ready for keyboard events
  await page.waitForFunction(() => {
    return document.readyState === 'complete' && 
           document.body !== null &&
           !document.querySelector('[data-loading="true"]');
  }, { timeout: 5000 }).catch(() => {});
}

/**
 * Wait for UI to settle after an action (e.g., after clicking a dropdown).
 * Waits for React/Next.js hydration to complete and spinners to disappear.
 */
export async function waitForUISettle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    // No spinners
    const hasSpinner = document.querySelector('.animate-spin') !== null;
    // No pending transitions
    const hasTransition = document.querySelector('[data-state="opening"]') !== null ||
                          document.querySelector('[data-state="closing"]') !== null;
    return !hasSpinner && !hasTransition;
  }, { timeout: 5000 }).catch(() => {});
}

/**
 * Wait for a theme change to complete.
 * More reliable than waiting a fixed time after clicking a theme option.
 */
export async function waitForThemeApplied(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const html = document.documentElement;
    // Theme is applied when either data-theme attribute exists or dark class is applied
    return html.hasAttribute('data-theme') || 
           html.classList.contains('dark') ||
           html.classList.contains('light');
  }, { timeout: 5000 }).catch(() => {});
}

/**
 * Wait for loading to complete (no spinners, no skeleton loaders).
 */
export async function waitForLoadingComplete(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const spinner = document.querySelector('.animate-spin');
    const skeleton = document.querySelector('.animate-pulse');
    return spinner === null && skeleton === null;
  }, { timeout: 10000 }).catch(() => {});
}

/**
 * Navigate to a URL and wait for it to be fully ready.
 * More reliable than just using waitUntil: 'domcontentloaded'.
 */
export async function navigateAndWaitReady(
  page: Page, 
  url: string, 
  options: { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? 60_000;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await waitForLoadingComplete(page);
}
