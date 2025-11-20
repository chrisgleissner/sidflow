/**
 * Custom Playwright fixtures that enable coverage collection
 * This automatically applies to ALL E2E tests without modification
 */
import { test as base, expect } from '@playwright/test';
import { startCoverage, stopCoverage } from './e2e/helpers/coverage';

// Extend the base test with automatic coverage collection
export const test = base.extend({
  page: async ({ page }, use) => {
    // Start coverage collection before each test
    await startCoverage(page).catch(() => {
      // Silently ignore if coverage fails to start
      console.warn('[Coverage] Failed to start coverage for page');
    });
    
    // Run the actual test
    await use(page);
    
    // Stop coverage collection after each test
    await stopCoverage(page).catch(() => {
      // Silently ignore if coverage fails to stop
      console.warn('[Coverage] Failed to stop coverage for page');
    });
  },
});

export { expect };
