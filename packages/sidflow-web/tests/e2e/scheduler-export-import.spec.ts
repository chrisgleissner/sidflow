import { expect, test } from '@playwright/test';

/**
 * E2E tests for the classification scheduler and export/import features.
 * 
 * Tests verify:
 * - Scheduler configuration UI is present and functional
 * - Export/import buttons are present and accessible
 * - Form controls interact correctly
 */

test.describe('Classification Scheduler', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the admin panel and wait for it to load
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should display scheduler configuration section in classify tab', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for the scheduler section to be visible
    const schedulerSection = page.getByText('NIGHTLY SCHEDULER');
    await schedulerSection.waitFor({ state: 'visible', timeout: 5000 });

    // Verify scheduler section is present
    await expect(schedulerSection).toBeVisible();

    // Verify scheduler enabled checkbox is present
    const enabledCheckbox = page.getByTestId('scheduler-enabled-checkbox');
    await expect(enabledCheckbox).toBeVisible();

    // Verify time input is present
    const timeInput = page.getByTestId('scheduler-time-input');
    await expect(timeInput).toBeVisible();

    // Verify save button is present
    const saveButton = page.getByTestId('save-scheduler-button');
    await expect(saveButton).toBeVisible();
  });

  test('should toggle scheduler enabled state', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for the checkbox to be visible
    const enabledCheckbox = page.getByTestId('scheduler-enabled-checkbox');
    await enabledCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    
    // Get initial state
    const initialState = await enabledCheckbox.isChecked();
    
    // Toggle the checkbox
    await enabledCheckbox.click();
    
    // Verify state changed
    const newState = await enabledCheckbox.isChecked();
    expect(newState).toBe(!initialState);
    
    // Toggle back
    await enabledCheckbox.click();
    expect(await enabledCheckbox.isChecked()).toBe(initialState);
  });

  test('should enable time input when scheduler is enabled', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    const enabledCheckbox = page.getByTestId('scheduler-enabled-checkbox');
    const timeInput = page.getByTestId('scheduler-time-input');
    
    // Wait for checkbox to be visible
    await enabledCheckbox.waitFor({ state: 'visible', timeout: 5000 });

    // Ensure scheduler is disabled first
    if (await enabledCheckbox.isChecked()) {
      await enabledCheckbox.click();
    }

    // Verify time input is disabled
    await expect(timeInput).toBeDisabled();

    // Enable scheduler
    await enabledCheckbox.click();

    // Verify time input is enabled
    await expect(timeInput).toBeEnabled();
  });

  test('should display preserve WAV checkbox', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for the preserve WAV checkbox to be visible
    const preserveWavCheckbox = page.getByTestId('preserve-wav-checkbox');
    await preserveWavCheckbox.waitFor({ state: 'visible', timeout: 5000 });
    
    // Verify preserve WAV checkbox is present
    await expect(preserveWavCheckbox).toBeVisible();
  });
});

test.describe('Classification Export/Import', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the admin panel and wait for it to load
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
  });

  test('should display export/import section in classify tab', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for export section to be visible
    const exportSection = page.getByText('EXPORT / IMPORT CLASSIFICATIONS');
    await exportSection.waitFor({ state: 'visible', timeout: 5000 });

    // Verify export/import section is present
    await expect(exportSection).toBeVisible();

    // Verify export button is present
    const exportButton = page.getByTestId('export-classifications-button');
    await expect(exportButton).toBeVisible();

    // Verify import button is present
    const importButton = page.getByTestId('import-classifications-button');
    await expect(importButton).toBeVisible();
  });

  test('should have functional export button', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for export button to be visible
    const exportButton = page.getByTestId('export-classifications-button');
    await exportButton.waitFor({ state: 'visible', timeout: 5000 });
    
    // Verify export button is enabled and clickable
    await expect(exportButton).toBeEnabled();
    
    // Button should have correct text
    await expect(exportButton).toHaveText('Export Classifications');
  });

  test('should have functional import button', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for import button to be visible
    const importButton = page.getByTestId('import-classifications-button');
    await importButton.waitFor({ state: 'visible', timeout: 5000 });
    
    // Verify import button is enabled and clickable
    await expect(importButton).toBeEnabled();
    
    // Button should have correct text
    await expect(importButton).toHaveText('Import Classifications');
  });

  test('should have hidden file input for import', async ({ page }) => {
    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for import button to be visible (file input is sibling)
    const importButton = page.getByTestId('import-classifications-button');
    await importButton.waitFor({ state: 'visible', timeout: 5000 });

    // Verify file input is present but hidden
    const fileInput = page.getByTestId('import-file-input');
    await expect(fileInput).toBeAttached();
    
    // File input should accept JSON files
    await expect(fileInput).toHaveAttribute('accept', '.json');
  });
});

test.describe('Classify Tab Integration', () => {
  test('should show all classification sections', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for classify content to load
    const classifyTitle = page.getByText('CLASSIFY');
    await classifyTitle.waitFor({ state: 'visible', timeout: 5000 });

    // Verify main sections are present
    await expect(classifyTitle).toBeVisible();
    await expect(page.getByText('WHAT CLASSIFICATION DOES')).toBeVisible();
    await expect(page.getByText('NIGHTLY SCHEDULER')).toBeVisible();
    await expect(page.getByText('EXPORT / IMPORT CLASSIFICATIONS')).toBeVisible();
  });

  test('should have start classification button', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for start button to be visible
    const startButton = page.getByTestId('start-classify-button');
    await startButton.waitFor({ state: 'visible', timeout: 5000 });

    // Verify start button is present
    await expect(startButton).toBeVisible();
  });

  test('should have force rebuild checkbox', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Click the Classify tab
    const classifyTab = page.getByRole('tab', { name: /classify/i });
    if (await classifyTab.isVisible()) {
      await classifyTab.click();
    }

    // Wait for force rebuild checkbox to be visible
    const forceRebuildCheckbox = page.getByTestId('force-rebuild-checkbox');
    await forceRebuildCheckbox.waitFor({ state: 'visible', timeout: 5000 });

    // Verify force rebuild checkbox is present
    await expect(forceRebuildCheckbox).toBeVisible();
  });
});
