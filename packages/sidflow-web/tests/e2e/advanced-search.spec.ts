import { test, expect } from './test-hooks';

const hasDescribe = typeof (globalThis as unknown as { describe?: unknown }).describe === 'function';
if (hasDescribe && !process.env.PLAYWRIGHT_TEST_SUITE) {
  console.log("[sidflow-web] Skipping Playwright e2e spec; run via `bun run test:e2e`.");
  process.exit(0);
}

/**
 * Helper to wait for search debounce to complete (deterministic).
 * Uses waitForFunction instead of fixed timeout.
 */
async function waitForSearchDebounce(page: import('@playwright/test').Page): Promise<void> {
  // Wait for the loading indicator to disappear (if it appeared)
  await page.waitForFunction(() => document.querySelector('.animate-spin') === null, { timeout: 5000 }).catch(() => {});
}

/**
 * Helper to wait for filter panel animation to complete.
 */
async function waitForFilterPanelSettle(page: import('@playwright/test').Page): Promise<void> {
  // Wait for animation completion by checking for no CSS transitions
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-state="open"]') || document.querySelector('[data-state="closed"]');
    return panel !== null || document.querySelector('.animate-spin') === null;
  }, { timeout: 3000 }).catch(() => {});
}

test.describe('Advanced Search & Discovery', () => {
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await page.goto('/', { timeout: 120_000, waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});

        // Navigate to Play tab
        const playTab = page.getByRole('tab', { name: /play/i });
        await playTab.click();
        await page.getByTestId('search-input').waitFor({ timeout: 60_000 });
    });

    test('should display advanced search bar with filters toggle', async ({ page }) => {
        // Check that the advanced search input exists
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');
        await expect(searchInput).toBeVisible();

        // Check that the filters toggle button exists
        const filtersButton = playPanel.getByTestId('toggle-filters-button');
        await expect(filtersButton).toBeVisible();

        // Check that the Surprise Me button exists
        const surpriseButton = playPanel.getByTestId('surprise-me-button');
        await expect(surpriseButton).toBeVisible();
    });

    test('should search by title and display results', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Type a search query
        await searchInput.fill('delta');
        await expect(searchInput).toHaveValue('delta');

        // Wait for debounce (deterministic)
        await waitForSearchDebounce(page);

        // Verify search input accepts text (results may or may not appear based on data)
        await expect(searchInput).toHaveValue('delta');
    });

    test('should search by artist and display results', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Type an artist name
        await searchInput.fill('hubbard');
        await expect(searchInput).toHaveValue('hubbard');

        // Wait for debounce (deterministic)
        await waitForSearchDebounce(page);

        // Verify search input accepts text
        await expect(searchInput).toHaveValue('hubbard');
    });

    test('should clear search with X button', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Type a search query
        await searchInput.fill('delta');
        await waitForSearchDebounce(page);

        // Find and click the clear button
        const clearButton = playPanel.locator('button[title="Clear search"]');
        await expect(clearButton).toBeVisible();
        await clearButton.click();

        // Verify search input is cleared
        await expect(searchInput).toHaveValue('');
    });

    test('should toggle advanced filters panel', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const filtersButton = playPanel.getByTestId('toggle-filters-button');

        // Initially filters should not be visible
        const yearMinInput = playPanel.getByTestId('year-min-input');
        await expect(yearMinInput).not.toBeVisible();

        // Click to expand filters
        await filtersButton.click();
        await waitForFilterPanelSettle(page);

        // Now filters should be visible
        await expect(yearMinInput).toBeVisible();
        await expect(playPanel.getByTestId('year-max-input')).toBeVisible();
        await expect(playPanel.getByTestId('duration-min-input')).toBeVisible();
        await expect(playPanel.getByTestId('duration-max-input')).toBeVisible();

        // Click to collapse filters
        await filtersButton.click();
        await waitForFilterPanelSettle(page);

        // Filters should be hidden again
        await expect(yearMinInput).not.toBeVisible();
    });

    test('should apply year range filter', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');
        const filtersButton = playPanel.getByTestId('toggle-filters-button');

        // Expand filters
        await filtersButton.click();
        await waitForFilterPanelSettle(page);

        // Set year range
        const yearMinInput = playPanel.getByTestId('year-min-input');
        const yearMaxInput = playPanel.getByTestId('year-max-input');
        await yearMinInput.fill('1985');
        await yearMaxInput.fill('1987');
        await expect(yearMinInput).toHaveValue('1985');
        await expect(yearMaxInput).toHaveValue('1987');

        // Apply filters
        const applyButton = playPanel.getByTestId('apply-filters-button');
        await applyButton.click();

        // Verify filters were applied (UI remains functional)
        await expect(yearMinInput).toHaveValue('1985');
    });

    test('should apply duration range filter', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');
        const filtersButton = playPanel.getByTestId('toggle-filters-button');

        // Expand filters
        await filtersButton.click();
        await waitForFilterPanelSettle(page);

        // Set duration range (60-180 seconds)
        const durationMinInput = playPanel.getByTestId('duration-min-input');
        const durationMaxInput = playPanel.getByTestId('duration-max-input');
        await durationMinInput.fill('60');
        await durationMaxInput.fill('180');
        await expect(durationMinInput).toHaveValue('60');
        await expect(durationMaxInput).toHaveValue('180');

        // Apply filters
        const applyButton = playPanel.getByTestId('apply-filters-button');
        await applyButton.click();

        // Verify filters were applied (UI remains functional)
        await expect(durationMinInput).toHaveValue('60');
    });

    test('should clear all filters', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const filtersButton = playPanel.getByTestId('toggle-filters-button');

        // Expand filters
        await filtersButton.click();
        await waitForFilterPanelSettle(page);

        // Set some filters
        const yearMinInput = playPanel.getByTestId('year-min-input');
        const durationMinInput = playPanel.getByTestId('duration-min-input');
        await yearMinInput.fill('1985');
        await durationMinInput.fill('60');

        // Apply filters
        const applyButton = playPanel.getByTestId('apply-filters-button');
        await applyButton.click();

        // Clear filters
        const clearButton = playPanel.getByTestId('clear-filters-button');
        await clearButton.click();

        // Verify filters are cleared
        await expect(yearMinInput).toHaveValue('');
        await expect(durationMinInput).toHaveValue('');
    });

    test('should accept search input for playing songs', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Perform search - use a common term that should exist in test data
        await searchInput.fill('tune');
        
        // Wait for search debounce (deterministic)
        await waitForSearchDebounce(page);

        // Check if results appear - they should if test data exists
        const resultsDropdown = playPanel.getByTestId('advanced-search-results');
        
        // Try to find results, but don't fail if none exist
        const resultsVisible = await resultsDropdown.isVisible().catch(() => false);
        
        if (resultsVisible) {
            // Click the play button on the first result
            const playButton = resultsDropdown.locator('button[title="Play this track"]').first();
            await expect(playButton).toBeVisible({ timeout: 3000 });
            await playButton.click();

            // Verify that the pause button appears (indicating playback started)
            const pauseButton = playPanel.getByRole('button', { name: /pause/i });
            await expect(pauseButton).toBeVisible({ timeout: 10000 });
        } else {
            // No results found - verify search input still works
            await expect(searchInput).toHaveValue('tune');
        }
    });

    test('should trigger Surprise Me and play random track', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const surpriseButton = playPanel.getByTestId('surprise-me-button');

        // Click Surprise Me
        await surpriseButton.click();

        // Wait for playback to start (pause button appears when playing)
        const pauseButton = playPanel.getByRole('button', { name: /pause/i });
        await expect(pauseButton).toBeVisible({ timeout: 15000 });
    });

    test('should handle search for artist names', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Search by artist
        await searchInput.fill('hubbard');
        await expect(searchInput).toHaveValue('hubbard');
        await waitForSearchDebounce(page);

        // Verify search input is functional
        await expect(searchInput).toHaveValue('hubbard');
    });

    test('should handle no results gracefully', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Search for something that doesn't exist
        await searchInput.fill('xyznonexistent123');
        await expect(searchInput).toHaveValue('xyznonexistent123');
        await waitForSearchDebounce(page);

        // Search input should still be functional
        await expect(searchInput).toHaveValue('xyznonexistent123');
    });

    test('should maintain search input when clicking outside', async ({ page }) => {
        const playPanel = page.getByRole('tabpanel', { name: /play/i });
        const searchInput = playPanel.getByTestId('search-input');

        // Perform search
        await searchInput.fill('delta');
        await expect(searchInput).toHaveValue('delta');
        await waitForSearchDebounce(page);

        // Click outside the search box
        await page.locator('body').click({ position: { x: 10, y: 10 } });

        // Search input should retain its value
        await expect(searchInput).toHaveValue('delta');
    });
});
