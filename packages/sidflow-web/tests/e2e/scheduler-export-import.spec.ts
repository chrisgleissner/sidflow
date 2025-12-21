import { expect, test, type Page } from '@playwright/test';

/**
 * E2E tests for the classification scheduler and export/import features.
 * 
 * Tests verify:
 * - Scheduler configuration UI is present and functional
 * - Export/import buttons are present and accessible
 * - Form controls interact correctly
 * - Progress counters display correctly
 * 
 * Optimized for fast execution:
 * - Uses domcontentloaded instead of networkidle
 * - Waits for loading spinners to disappear
 * - Consolidated tests where possible
 */

// Admin authentication setup
const ADMIN_USER = process.env.SIDFLOW_ADMIN_USER ?? 'ops';
const ADMIN_PASSWORD = process.env.SIDFLOW_ADMIN_PASSWORD ?? 'test-pass-123';
const ADMIN_AUTH_HEADER = `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64')}`;
const adminRouteConfigured = new WeakSet<Page>();

async function ensureAdminSession(page: Page): Promise<void> {
  if (adminRouteConfigured.has(page)) {
    return;
  }

  await page.context().setExtraHTTPHeaders({
    Authorization: ADMIN_AUTH_HEADER,
    authorization: ADMIN_AUTH_HEADER,
  });

  await page.context().setHTTPCredentials({
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
  });

  adminRouteConfigured.add(page);
}

// Helper to navigate to admin classify tab efficiently
async function gotoClassifyTab(page: Page) {
  await ensureAdminSession(page);
  await page.goto('/admin?tab=classify', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Wait for page to be ready - wait for any loading spinners to disappear
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10000 }).catch(() => {});
  // Wait for the classify tab content to be visible (scope to tabpanel to avoid strict-mode collisions)
  const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });
  await classifyPanel.getByTestId('scheduler-enabled-checkbox').waitFor({ state: 'visible', timeout: 10000 });
}

test.describe('Classification Scheduler', () => {
  test.describe.configure({ timeout: 90_000 });
  test('should display all scheduler UI elements', async ({ page }) => {
    test.setTimeout(90_000);
    await gotoClassifyTab(page);
    const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });

    // Verify all scheduler elements in one test for efficiency
    // The gotoClassifyTab helper already waits for the checkbox, so these should be fast
    await expect(classifyPanel.getByTestId('scheduler-enabled-checkbox')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('scheduler-time-input')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('save-scheduler-button')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('preserve-wav-checkbox')).toBeVisible({ timeout: 5000 });
  });

  test('should toggle scheduler enabled state', async ({ page }) => {
    test.setTimeout(90_000);
    await gotoClassifyTab(page);
    const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });

    const enabledCheckbox = classifyPanel.getByTestId('scheduler-enabled-checkbox');
    await expect(enabledCheckbox).toBeVisible({ timeout: 5000 });
    
    const initialState = await enabledCheckbox.isChecked();
    
    // Click and wait for state to change
    await enabledCheckbox.click();
    await page.waitForFunction(
      (expected: boolean) => {
        const checkbox = document.querySelector('[data-testid="scheduler-enabled-checkbox"]') as HTMLInputElement;
        return checkbox && checkbox.checked === expected;
      },
      !initialState,
      { timeout: 5000 }
    );
    expect(await enabledCheckbox.isChecked()).toBe(!initialState);
    
    // Toggle back and wait for state to change
    await enabledCheckbox.click();
    await page.waitForFunction(
      (expected: boolean) => {
        const checkbox = document.querySelector('[data-testid="scheduler-enabled-checkbox"]') as HTMLInputElement;
        return checkbox && checkbox.checked === expected;
      },
      initialState,
      { timeout: 5000 }
    );
    expect(await enabledCheckbox.isChecked()).toBe(initialState);
  });

  test('should enable time input when scheduler is enabled', async ({ page }) => {
    test.setTimeout(90_000);
    await gotoClassifyTab(page);
    const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });

    const enabledCheckbox = classifyPanel.getByTestId('scheduler-enabled-checkbox');
    const timeInput = classifyPanel.getByTestId('scheduler-time-input');
    
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
  test.describe.configure({ timeout: 90_000 });
  test('should display all export/import UI elements', async ({ page }) => {
    test.setTimeout(90_000);
    await gotoClassifyTab(page);
    const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });

    // Verify all export/import elements in one test for efficiency
    const exportButton = classifyPanel.getByTestId('export-classifications-button');
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    // Note: Button may be disabled if classification is running - just check visibility
    await expect(exportButton).toHaveText(/Export/);
    
    const importButton = classifyPanel.getByTestId('import-classifications-button');
    await expect(importButton).toBeVisible({ timeout: 5000 });
    // Import button can be used even when export is disabled
    await expect(importButton).toHaveText(/Import/);
    
    // Verify file input
    const fileInput = classifyPanel.getByTestId('import-file-input');
    await expect(fileInput).toBeAttached();
    await expect(fileInput).toHaveAttribute('accept', '.json');
  });
});

test.describe('Classify Tab Integration', () => {
  test('should show all classification sections and buttons', async ({ page }) => {
    await gotoClassifyTab(page);
    const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });

    // Verify buttons exist (the scheduler checkbox was already checked in gotoClassifyTab)
    await expect(classifyPanel.getByTestId('start-classify-button')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('force-rebuild-checkbox')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('export-classifications-button')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('import-classifications-button')).toBeVisible({ timeout: 5000 });
  });

  test('should display progress counters (Rendered, Cached, Extracted, Remaining)', async ({ page }) => {
    await gotoClassifyTab(page);
    const classifyPanel = page.getByRole('tabpanel', { name: /classify/i });

    // Verify all counter elements are visible
    const renderedLocator = classifyPanel.getByTestId('classify-rendered-count');
    const cachedLocator = classifyPanel.getByTestId('classify-cached-count');
    const extractedLocator = classifyPanel.getByTestId('classify-extracted-count');
    const remainingLocator = classifyPanel.getByTestId('classify-remaining-count');

    await expect(renderedLocator).toBeVisible({ timeout: 5000 });
    await expect(cachedLocator).toBeVisible({ timeout: 5000 });
    await expect(extractedLocator).toBeVisible({ timeout: 5000 });
    await expect(remainingLocator).toBeVisible({ timeout: 5000 });

    // Verify phase label and percent are visible
    await expect(classifyPanel.getByTestId('classify-phase-label')).toBeVisible({ timeout: 5000 });
    await expect(classifyPanel.getByTestId('classify-percent')).toBeVisible({ timeout: 5000 });

    // Verify counters show numeric values (0 initially)
    const renderedCount = await renderedLocator.textContent();
    const cachedCount = await cachedLocator.textContent();
    const extractedCount = await extractedLocator.textContent();
    const remainingCount = await remainingLocator.textContent();

    // All counters should be numeric
    expect(Number(renderedCount)).toBeGreaterThanOrEqual(0);
    expect(Number(cachedCount)).toBeGreaterThanOrEqual(0);
    expect(Number(extractedCount)).toBeGreaterThanOrEqual(0);
    expect(Number(remainingCount)).toBeGreaterThanOrEqual(0);
  });
});
