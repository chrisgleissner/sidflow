import { test, expect } from '@playwright/test';

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
    const searchInput = page.getByTestId('advanced-search-input');
    await expect(searchInput).toBeVisible();
    
    // Check that the filters toggle button exists
    const filtersButton = page.getByTestId('toggle-filters-button');
    await expect(filtersButton).toBeVisible();
    
    // Check that the Surprise Me button exists
    const surpriseButton = page.getByTestId('surprise-me-button');
    await expect(surpriseButton).toBeVisible();
  });

  test('should search by title and display results', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Type a search query
    await searchInput.fill('delta');
    
    // Wait for debounce and results
    await page.waitForTimeout(500);
    
    // Check if results dropdown appears
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
    
    // Verify that results contain the search term
    await expect(resultsDropdown).toContainText('delta', { ignoreCase: true });
  });

  test('should search by artist and display results', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Type an artist name
    await searchInput.fill('hubbard');
    
    // Wait for debounce and results
    await page.waitForTimeout(500);
    
    // Check if results dropdown appears
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
    
    // Verify that results contain the artist name
    await expect(resultsDropdown).toContainText('hubbard', { ignoreCase: true });
  });

  test('should clear search with X button', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Type a search query
    await searchInput.fill('delta');
    await page.waitForTimeout(500);
    
    // Find and click the clear button
    const clearButton = page.locator('button[title="Clear search"]');
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    
    // Verify search input is cleared
    await expect(searchInput).toHaveValue('');
    
    // Verify results dropdown is hidden
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).not.toBeVisible();
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
    const searchInput = page.getByTestId('advanced-search-input');
    const filtersButton = page.getByTestId('toggle-filters-button');
    
    // Expand filters
    await filtersButton.click();
    await page.waitForTimeout(300);
    
    // Set year range
    const yearMinInput = page.getByTestId('year-min-input');
    const yearMaxInput = page.getByTestId('year-max-input');
    await yearMinInput.fill('1985');
    await yearMaxInput.fill('1987');
    
    // Apply filters
    const applyButton = page.getByTestId('apply-filters-button');
    await applyButton.click();
    
    // Perform search
    await searchInput.fill('sid');
    await page.waitForTimeout(500);
    
    // Results should be filtered (we can't easily verify the years in E2E,
    // but we can check that results appear)
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
  });

  test('should apply duration range filter', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    const filtersButton = page.getByTestId('toggle-filters-button');
    
    // Expand filters
    await filtersButton.click();
    await page.waitForTimeout(300);
    
    // Set duration range (60-180 seconds)
    const durationMinInput = page.getByTestId('duration-min-input');
    const durationMaxInput = page.getByTestId('duration-max-input');
    await durationMinInput.fill('60');
    await durationMaxInput.fill('180');
    
    // Apply filters
    const applyButton = page.getByTestId('apply-filters-button');
    await applyButton.click();
    
    // Perform search
    await searchInput.fill('sid');
    await page.waitForTimeout(500);
    
    // Results should be filtered
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
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

  test('should play track from search results', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Perform search
    await searchInput.fill('delta');
    await page.waitForTimeout(500);
    
    // Wait for results
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
    
    // Click the play button on the first result
    const playButton = resultsDropdown.locator('button[title="Play this track"]').first();
    await expect(playButton).toBeVisible();
    await playButton.click();
    
    // Wait a moment for playback to start
    await page.waitForTimeout(1000);
    
    // Verify that the pause button appears (indicating playback started)
    const pauseButton = page.getByRole('button', { name: /pause/i });
    await expect(pauseButton).toBeVisible({ timeout: 10000 });
  });

  test('should trigger Surprise Me and play random track', async ({ page }) => {
    const surpriseButton = page.getByTestId('surprise-me-button');
    
    // Click Surprise Me
    await surpriseButton.click();
    
    // Wait for playback to start
    await page.waitForTimeout(2000);
    
    // Verify that the pause button appears (indicating playback started)
    const pauseButton = page.getByRole('button', { name: /pause/i });
    await expect(pauseButton).toBeVisible({ timeout: 10000 });
  });

  test('should show match badges in search results', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Search by artist
    await searchInput.fill('hubbard');
    await page.waitForTimeout(500);
    
    // Check results
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
    
    // Verify that match badges are shown (e.g., "artist", "title", "path")
    const matchBadge = resultsDropdown.locator('span.text-xs').first();
    await expect(matchBadge).toBeVisible();
  });

  test('should handle no results gracefully', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Search for something that doesn't exist
    await searchInput.fill('xyznonexistent123');
    await page.waitForTimeout(500);
    
    // Results dropdown should not appear
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).not.toBeVisible();
    
    // Status message should indicate no results
    // (This would require checking the status area, which may vary by implementation)
  });

  test('should close results when clicking outside', async ({ page }) => {
    const searchInput = page.getByTestId('advanced-search-input');
    
    // Perform search
    await searchInput.fill('delta');
    await page.waitForTimeout(500);
    
    // Wait for results
    const resultsDropdown = page.getByTestId('advanced-search-results');
    await expect(resultsDropdown).toBeVisible({ timeout: 5000 });
    
    // Click outside the search box
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    
    // Results should be hidden
    await expect(resultsDropdown).not.toBeVisible();
  });
});
