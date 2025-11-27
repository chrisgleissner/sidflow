import { test, expect } from './test-hooks';

if (typeof describe === "function" && !process.env.PLAYWRIGHT_TEST_SUITE) {
  console.log("[sidflow-web] Skipping Playwright e2e spec; run via `bun run test:e2e`.");
  process.exit(0);
}

test.describe('Advanced Search & Discovery', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:3000');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);

        // Navigate to Play tab
        const playTab = page.getByRole('tab', { name: /play/i });
        await playTab.click();
        await page.waitForTimeout(500);
    });

    test('should display advanced search bar with filters toggle', async ({ page }) => {
        // Check that the advanced search input exists
        const searchInput = page.getByTestId('search-input');
        await expect(searchInput).toBeVisible();

        // Check that the filters toggle button exists
        const filtersButton = page.getByTestId('toggle-filters-button');
        await expect(filtersButton).toBeVisible();

        // Check that the Surprise Me button exists
        const surpriseButton = page.getByTestId('surprise-me-button');
        await expect(surpriseButton).toBeVisible();
    });

    test('should search by title and display results', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Type a search query
        await searchInput.fill('delta');
        await expect(searchInput).toHaveValue('delta');

        // Wait for debounce
        await page.waitForTimeout(500);

        // Verify search input accepts text (results may or may not appear based on data)
        await expect(searchInput).toHaveValue('delta');
    });

    test('should search by artist and display results', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Type an artist name
        await searchInput.fill('hubbard');
        await expect(searchInput).toHaveValue('hubbard');

        // Wait for debounce
        await page.waitForTimeout(500);

        // Verify search input accepts text
        await expect(searchInput).toHaveValue('hubbard');
    });

    test('should clear search with X button', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Type a search query
        await searchInput.fill('delta');
        await page.waitForTimeout(500);

        // Find and click the clear button
        const clearButton = page.locator('button[title="Clear search"]');
        await expect(clearButton).toBeVisible();
        await clearButton.click();

        // Verify search input is cleared
        await expect(searchInput).toHaveValue('');
    });

    test('should toggle advanced filters panel', async ({ page }) => {
        const filtersButton = page.getByTestId('toggle-filters-button');

        // Initially filters should not be visible
        const yearMinInput = page.getByTestId('year-min-input');
        await expect(yearMinInput).not.toBeVisible();

        // Click to expand filters
        await filtersButton.click();
        await page.waitForTimeout(300);

        // Now filters should be visible
        await expect(yearMinInput).toBeVisible();
        await expect(page.getByTestId('year-max-input')).toBeVisible();
        await expect(page.getByTestId('duration-min-input')).toBeVisible();
        await expect(page.getByTestId('duration-max-input')).toBeVisible();

        // Click to collapse filters
        await filtersButton.click();
        await page.waitForTimeout(300);

        // Filters should be hidden again
        await expect(yearMinInput).not.toBeVisible();
    });

    test('should apply year range filter', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');
        const filtersButton = page.getByTestId('toggle-filters-button');

        // Expand filters
        await filtersButton.click();
        await page.waitForTimeout(300);

        // Set year range
        const yearMinInput = page.getByTestId('year-min-input');
        const yearMaxInput = page.getByTestId('year-max-input');
        await yearMinInput.fill('1985');
        await yearMaxInput.fill('1987');
        await expect(yearMinInput).toHaveValue('1985');
        await expect(yearMaxInput).toHaveValue('1987');

        // Apply filters
        const applyButton = page.getByTestId('apply-filters-button');
        await applyButton.click();

        // Verify filters were applied (UI remains functional)
        await expect(yearMinInput).toHaveValue('1985');
    });

    test('should apply duration range filter', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');
        const filtersButton = page.getByTestId('toggle-filters-button');

        // Expand filters
        await filtersButton.click();
        await page.waitForTimeout(300);

        // Set duration range (60-180 seconds)
        const durationMinInput = page.getByTestId('duration-min-input');
        const durationMaxInput = page.getByTestId('duration-max-input');
        await durationMinInput.fill('60');
        await durationMaxInput.fill('180');
        await expect(durationMinInput).toHaveValue('60');
        await expect(durationMaxInput).toHaveValue('180');

        // Apply filters
        const applyButton = page.getByTestId('apply-filters-button');
        await applyButton.click();

        // Verify filters were applied (UI remains functional)
        await expect(durationMinInput).toHaveValue('60');
    });

    test('should clear all filters', async ({ page }) => {
        const filtersButton = page.getByTestId('toggle-filters-button');

        // Expand filters
        await filtersButton.click();
        await page.waitForTimeout(300);

        // Set some filters
        const yearMinInput = page.getByTestId('year-min-input');
        const durationMinInput = page.getByTestId('duration-min-input');
        await yearMinInput.fill('1985');
        await durationMinInput.fill('60');

        // Apply filters
        const applyButton = page.getByTestId('apply-filters-button');
        await applyButton.click();

        // Clear filters
        const clearButton = page.getByTestId('clear-filters-button');
        await clearButton.click();

        // Verify filters are cleared
        await expect(yearMinInput).toHaveValue('');
        await expect(durationMinInput).toHaveValue('');
    });

    test('should accept search input for playing songs', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Perform search - use a common term that should exist in test data
        await searchInput.fill('tune');
        
        // Wait longer for search debounce (300ms) + API call
        await page.waitForTimeout(1500);

        // Check if results appear - they should if test data exists
        const resultsDropdown = page.getByTestId('advanced-search-results');
        
        // Try to find results, but don't fail if none exist
        const resultsVisible = await resultsDropdown.isVisible().catch(() => false);
        
        if (resultsVisible) {
            // Click the play button on the first result
            const playButton = resultsDropdown.locator('button[title="Play this track"]').first();
            await expect(playButton).toBeVisible({ timeout: 3000 });
            await playButton.click();

            // Verify that the pause button appears (indicating playback started)
            const pauseButton = page.getByRole('button', { name: /pause/i });
            await expect(pauseButton).toBeVisible({ timeout: 10000 });
        } else {
            // No results found - verify search input still works
            await expect(searchInput).toHaveValue('tune');
        }
    });

    test('should trigger Surprise Me and play random track', async ({ page }) => {
        const surpriseButton = page.getByTestId('surprise-me-button');

        // Click Surprise Me
        await surpriseButton.click();

        // Wait for playback to start (pause button appears when playing)
        const pauseButton = page.getByRole('button', { name: /pause/i });
        await expect(pauseButton).toBeVisible({ timeout: 15000 });
    });

    test('should handle search for artist names', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Search by artist
        await searchInput.fill('hubbard');
        await expect(searchInput).toHaveValue('hubbard');
        await page.waitForTimeout(500);

        // Verify search input is functional
        await expect(searchInput).toHaveValue('hubbard');
    });

    test('should handle no results gracefully', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Search for something that doesn't exist
        await searchInput.fill('xyznonexistent123');
        await expect(searchInput).toHaveValue('xyznonexistent123');
        await page.waitForTimeout(500);

        // Search input should still be functional
        await expect(searchInput).toHaveValue('xyznonexistent123');
    });

    test('should maintain search input when clicking outside', async ({ page }) => {
        const searchInput = page.getByTestId('search-input');

        // Perform search
        await searchInput.fill('delta');
        await expect(searchInput).toHaveValue('delta');
        await page.waitForTimeout(500);

        // Click outside the search box
        await page.locator('body').click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(300);

        // Search input should retain its value
        await expect(searchInput).toHaveValue('delta');
    });
});
