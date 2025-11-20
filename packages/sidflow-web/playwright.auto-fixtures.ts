/**
 * Auto-fixtures that apply to all E2E tests
 * Enables automatic coverage collection without modifying test files
 */
import { test as base } from '@playwright/test';
import { startCoverage, stopCoverage } from './tests/e2e/helpers/coverage';

export const test = base.extend({
  // Override the page fixture to automatically enable coverage
  page: async ({ page }, use, testInfo) => {
    // Start coverage before test
    try {
      await startCoverage(page);
    } catch (error) {
      console.warn(`[Coverage] Failed to start for ${testInfo.title}:`, error);
    }
    
    // Run the test
    await use(page);
    
    // Stop coverage after test
    try {
      await stopCoverage(page);
    } catch (error) {
      console.warn(`[Coverage] Failed to stop for ${testInfo.title}:`, error);
    }
  },
});

// Re-export expect
export { expect } from '@playwright/test';
