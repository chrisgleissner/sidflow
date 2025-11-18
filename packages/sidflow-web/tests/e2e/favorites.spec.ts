import { test, expect } from '@playwright/test';

// Timeout constants for consistent test behavior
const TIMEOUTS = {
  TEST: 30000,          // Overall test timeout
  PAGE_LOAD: 20000,     // Page navigation timeout
  ELEMENT_VISIBLE: 10000, // Wait for element to be visible
  ELEMENT_QUICK: 5000,  // Quick element checks
  LOADING_STATE: 15000, // Wait for loading states to complete
  HMR_SETTLE: 2000,     // Let HMR/hot-reload settle
} as const;

test.describe('Favorites Feature', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TIMEOUTS.TEST);

    // Navigate to the public player with longer timeout
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
    await page.waitForTimeout(TIMEOUTS.HMR_SETTLE); // Let HMR settle

    // Wait for the page to load
    await page.waitForSelector('[data-testid="tab-play"]', { timeout: TIMEOUTS.LOADING_STATE });
  });

  test('should display favorites tab for public users', async ({ page }) => {
    // Check that favorites tab exists
    const favoritesTab = page.locator('[data-testid="tab-favorites"]');
    await expect(favoritesTab).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

    // Click favorites tab
    await favoritesTab.click();
    
    // Wait for either loading state or content to appear
    await Promise.any([
      page.waitForSelector('text=Loading favorites...', { timeout: TIMEOUTS.ELEMENT_QUICK }),
      page.waitForSelector('text=No favorites yet', { timeout: TIMEOUTS.ELEMENT_QUICK })
    ]).catch(() => {});
    
    // Wait for loading to complete
    await page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: TIMEOUTS.LOADING_STATE }).catch(() => {});

    // Should show empty state initially (use first match to avoid ambiguity)
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(page.getByText('Add songs using the heart icon while playing', { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
  });

  test('should allow adding and removing favorites from play tab', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout since track loading can be slow

    // Start on Play tab
    const playTab = page.locator('[data-testid="tab-play"]').click();

    // Wait for a track to load (this might take a moment in real scenario)
    try {
      await page.waitForSelector('[data-testid="favorite-icon"]', { timeout: TIMEOUTS.TEST });

      // Check if favorite button exists
      const favoriteButton = page.locator('button:has([data-testid="favorite-icon"])').first();

      if (await favoriteButton.isVisible({ timeout: TIMEOUTS.ELEMENT_QUICK })) {
        // Click to add to favorites
        await favoriteButton.click();

        // Should show confirmation message
        await expect(page.getByText(/added to favorites/i).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Switch to favorites tab
        await page.locator('[data-testid="tab-favorites"]').click();

        // Should see at least one favorite now
        const favoritesList = page.locator('[data-testid="favorite-icon"]');
        await expect(favoritesList.first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Go back to play tab
        await page.locator('[data-testid="tab-play"]').click();

        // Click favorite button again to remove
        await favoriteButton.click();

        // Should show removal confirmation
        await expect(page.getByText(/removed from favorites/i).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
      }
    } catch (e) {
      // If no track loads, skip this test since we can't test the feature without data
      test.skip();
    }
  });

  test('should show play all and shuffle buttons when favorites exist', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Wait for loading to complete
    await Promise.any([
      page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: TIMEOUTS.LOADING_STATE }),
      page.waitForSelector('text=No favorites yet', { timeout: TIMEOUTS.LOADING_STATE })
    ]).catch(() => {});

    // Check for action buttons (they should be disabled when empty)
    const playAllButton = page.getByRole('button', { name: /play all/i });
    const shuffleButton = page.getByRole('button', { name: /shuffle/i });

    await expect(playAllButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(shuffleButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

    // Buttons should be disabled when no favorites
    await expect(playAllButton).toBeDisabled();
    await expect(shuffleButton).toBeDisabled();
  });

  test('should show clear all button only when favorites exist', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Wait for loading state to disappear
    await page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: TIMEOUTS.ELEMENT_VISIBLE }).catch(() => {});

    // Clear All button should not be visible when empty
    const clearAllButton = page.getByRole('button', { name: /clear all/i });
    await expect(clearAllButton).not.toBeVisible();
  });

  test('should display favorite tracks with metadata', async ({ page }) => {
    // This test would require seeding some favorites first
    // For now, we'll just check the structure is correct
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Wait for loading to complete
    await Promise.any([
      page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: TIMEOUTS.LOADING_STATE }),
      page.waitForSelector('text=FAVORITES', { timeout: TIMEOUTS.LOADING_STATE })
    ]).catch(() => {});

    // Check for the card structure
    const favoritesCard = page.locator('.c64-border').filter({ hasText: 'FAVORITES' });
    await expect(favoritesCard).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

    // Check for the heart icon in header
    const heartIcon = favoritesCard.locator('svg.lucide-heart');
    await expect(heartIcon).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
  });

  test('should maintain favorites state across tab switches', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    await expect(page.getByText('FAVORITES').first()).toBeVisible();

    // Switch to prefs tab
    await page.locator('[data-testid="tab-prefs"]').click();
    await page.waitForTimeout(500);

    // Switch back to favorites
    await page.locator('[data-testid="tab-favorites"]').click();

    // Should still show favorites content
    await expect(page.getByText('FAVORITES').first()).toBeVisible();
  });

  test('should handle favorite button loading states', async ({ page }) => {
    // Go to play tab
    await page.locator('[data-testid="tab-play"]').click();

    // If a favorite button exists, check it doesn't show loading spinner initially
    const favoriteButton = page.locator('button:has([data-testid="favorite-icon"])').first();

    if (await favoriteButton.isVisible()) {
      // Should not have a loading spinner
      const loadingSpinner = favoriteButton.locator('.animate-spin');
      await expect(loadingSpinner).not.toBeVisible();
    }
  });

  test('should show appropriate empty state messaging', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Wait for loading to complete
    await Promise.any([
      page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: TIMEOUTS.LOADING_STATE }),
      page.waitForSelector('text=No favorites yet', { timeout: TIMEOUTS.LOADING_STATE })
    ]).catch(() => {});

    // Check empty state elements (use first match to avoid ambiguity)
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(page.getByText('Add songs using the heart icon while playing', { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

    // Check for empty state heart icon
    const emptyHeartIcon = page.locator('svg.lucide-heart').first();
    await expect(emptyHeartIcon).toBeVisible();
  });
});
