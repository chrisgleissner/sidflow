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
 * - Shorter timeouts where appropriate
 * - Consolidated tests where possible
 */

// Helper to navigate to admin classify tab efficiently
async function gotoClassifyTab(page: import('@playwright/test').Page) {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  const classifyTab = page.getByRole('tab', { name: /classify/i });
  await expect(classifyTab).toBeVisible({ timeout: 5000 });
  await classifyTab.click();
}

test.describe('Classification Scheduler', () => {
  test('should display all scheduler UI elements', async ({ page }) => {
    await gotoClassifyTab(page);

    // Wait for the scheduler section to be visible
    const schedulerSection = page.getByText('NIGHTLY SCHEDULER');
    await expect(schedulerSection).toBeVisible({ timeout: 5000 });

    // Verify all scheduler elements in one test for efficiency
    await expect(page.getByTestId('scheduler-enabled-checkbox')).toBeVisible();
    await expect(page.getByTestId('scheduler-time-input')).toBeVisible();
    await expect(page.getByTestId('save-scheduler-button')).toBeVisible();
    await expect(page.getByTestId('preserve-wav-checkbox')).toBeVisible();
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
    await expect(page.getByText('EXPORT / IMPORT CLASSIFICATIONS')).toBeVisible({ timeout: 5000 });
    
    const exportButton = page.getByTestId('export-classifications-button');
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toHaveText('Export Classifications');
    
    const importButton = page.getByTestId('import-classifications-button');
    await expect(importButton).toBeVisible();
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

    // Verify all main sections are present
    await expect(page.getByText('CLASSIFY')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('WHAT CLASSIFICATION DOES')).toBeVisible();
    await expect(page.getByText('NIGHTLY SCHEDULER')).toBeVisible();
    await expect(page.getByText('EXPORT / IMPORT CLASSIFICATIONS')).toBeVisible();
    
    // Verify buttons
    await expect(page.getByTestId('start-classify-button')).toBeVisible();
    await expect(page.getByTestId('force-rebuild-checkbox')).toBeVisible();
  });
});
