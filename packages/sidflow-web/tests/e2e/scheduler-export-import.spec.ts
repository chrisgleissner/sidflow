import { expect, test } from '@playwright/test';

/**
 * E2E tests for the classification scheduler and export/import features.
 * 
 * Tests verify:
 * - Scheduler configuration UI is present and functional
 * - Export/import buttons are present and accessible
 * - Form controls interact correctly
 * 
 * Optimized for fast execution:
 * - Uses domcontentloaded instead of networkidle
 * - Waits for loading spinners to disappear
 * - Consolidated tests where possible
 */

// Helper to navigate to admin classify tab efficiently
async function gotoClassifyTab(page: import('@playwright/test').Page) {
  await page.goto('/admin?tab=classify', { waitUntil: 'domcontentloaded' });
  // Wait for page to be ready - wait for any loading spinners to disappear
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10000 }).catch(() => {});
  // Wait for the classify tab content to be visible
  await page.waitForSelector('[data-testid="scheduler-enabled-checkbox"]', { timeout: 10000 });
}

test.describe('Classification Scheduler', () => {
  test('should display all scheduler UI elements', async ({ page }) => {
    await gotoClassifyTab(page);

    // Verify all scheduler elements in one test for efficiency
    // The gotoClassifyTab helper already waits for the checkbox, so these should be fast
    await expect(page.getByTestId('scheduler-enabled-checkbox')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('scheduler-time-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('save-scheduler-button')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('preserve-wav-checkbox')).toBeVisible({ timeout: 5000 });
  });

  test('should toggle scheduler enabled state', async ({ page }) => {
    await gotoClassifyTab(page);

    const enabledCheckbox = page.getByTestId('scheduler-enabled-checkbox');
    await expect(enabledCheckbox).toBeVisible({ timeout: 5000 });
    
    const initialState = await enabledCheckbox.isChecked();
    await enabledCheckbox.click();
    expect(await enabledCheckbox.isChecked()).toBe(!initialState);
    
    // Toggle back
    await enabledCheckbox.click();
    expect(await enabledCheckbox.isChecked()).toBe(initialState);
  });

  test('should enable time input when scheduler is enabled', async ({ page }) => {
    await gotoClassifyTab(page);

    const enabledCheckbox = page.getByTestId('scheduler-enabled-checkbox');
    const timeInput = page.getByTestId('scheduler-time-input');
    
    await expect(enabledCheckbox).toBeVisible({ timeout: 5000 });

    // Ensure scheduler is disabled first
    if (await enabledCheckbox.isChecked()) {
      await enabledCheckbox.click();
    }

    await expect(timeInput).toBeDisabled();
    await enabledCheckbox.click();
    await expect(timeInput).toBeEnabled();
  });
});

test.describe('Classification Export/Import', () => {
  test('should display all export/import UI elements', async ({ page }) => {
    await gotoClassifyTab(page);

    // Verify all export/import elements in one test for efficiency
    const exportButton = page.getByTestId('export-classifications-button');
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toHaveText('Export Classifications');
    
    const importButton = page.getByTestId('import-classifications-button');
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await expect(importButton).toBeEnabled();
    await expect(importButton).toHaveText('Import Classifications');
    
    // Verify file input
    const fileInput = page.getByTestId('import-file-input');
    await expect(fileInput).toBeAttached();
    await expect(fileInput).toHaveAttribute('accept', '.json');
  });
});

test.describe('Classify Tab Integration', () => {
  test('should show all classification sections and buttons', async ({ page }) => {
    await gotoClassifyTab(page);

    // Verify buttons exist (the scheduler checkbox was already checked in gotoClassifyTab)
    await expect(page.getByTestId('start-classify-button')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('force-rebuild-checkbox')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('export-classifications-button')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('import-classifications-button')).toBeVisible({ timeout: 5000 });
  });
});
