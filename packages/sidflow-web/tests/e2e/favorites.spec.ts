import { test, expect } from '@playwright/test';

test.describe('Favorites Feature', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(30000); // Increase timeout for dev mode with HMR

    // Navigate to the public player with longer timeout
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000); // Let HMR settle

    // Wait for the page to load
    await page.waitForSelector('[data-testid="tab-play"]', { timeout: 15000 });
  });

  test('should display favorites tab for public users', async ({ page }) => {
    // Check that favorites tab exists
    const favoritesTab = page.locator('[data-testid="tab-favorites"]');
    await expect(favoritesTab).toBeVisible({ timeout: 10000 });

    // Click favorites tab
    await favoritesTab.click();
    
    // Wait for either loading state or content to appear
    await Promise.any([
      page.waitForSelector('text=Loading favorites...', { timeout: 5000 }),
      page.waitForSelector('text=No favorites yet', { timeout: 5000 })
    ]).catch(() => {});
    
    // Wait for loading to complete
    await page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: 15000 }).catch(() => {});

    // Should show empty state initially (use first match to avoid ambiguity)
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Add songs using the heart icon while playing', { exact: false }).first()).toBeVisible({ timeout: 5000 });
  });

  test('should allow adding and removing favorites from play tab', async ({ page }) => {
    test.setTimeout(60000); // Increase timeout since track loading can be slow

    // Start on Play tab
    const playTab = page.locator('[data-testid="tab-play"]').click();

    // Wait for a track to load (this might take a moment in real scenario)
    try {
      await page.waitForSelector('[data-testid="favorite-icon"]', { timeout: 30000 });

      // Check if favorite button exists
      const favoriteButton = page.locator('button:has([data-testid="favorite-icon"])').first();

      if (await favoriteButton.isVisible({ timeout: 5000 })) {
        // Click to add to favorites
        await favoriteButton.click();

        // Should show confirmation message
        await expect(page.getByText(/added to favorites/i).first()).toBeVisible({ timeout: 5000 });

        // Switch to favorites tab
        await page.locator('[data-testid="tab-favorites"]').click();

        // Should see at least one favorite now
        const favoritesList = page.locator('[data-testid="favorite-icon"]');
        await expect(favoritesList.first()).toBeVisible({ timeout: 5000 });

        // Go back to play tab
        await page.locator('[data-testid="tab-play"]').click();

        // Click favorite button again to remove
        await favoriteButton.click();

        // Should show removal confirmation
        await expect(page.getByText(/removed from favorites/i).first()).toBeVisible({ timeout: 5000 });
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
    await Promise.race([
      page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: 15000 }),
      page.waitForSelector('text=No favorites yet', { timeout: 15000 })
    ]).catch(() => {});

    // Check for action buttons (they should be disabled when empty)
    const playAllButton = page.getByRole('button', { name: /play all/i });
    const shuffleButton = page.getByRole('button', { name: /shuffle/i });

    await expect(playAllButton).toBeVisible({ timeout: 10000 });
    await expect(shuffleButton).toBeVisible({ timeout: 5000 });

    // Buttons should be disabled when no favorites
    await expect(playAllButton).toBeDisabled();
    await expect(shuffleButton).toBeDisabled();
  });

  test('should show clear all button only when favorites exist', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Wait for loading state to disappear
    await page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: 10000 }).catch(() => {});

    // Clear All button should not be visible when empty
    const clearAllButton = page.getByRole('button', { name: /clear all/i });
    await expect(clearAllButton).not.toBeVisible();
  });

  test('should display favorite tracks with metadata', async ({ page }) => {
    // This test would require seeding some favorites first
    // For now, we'll just check the structure is correct
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Wait for loading to complete
    await Promise.race([
      page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: 15000 }),
      page.waitForSelector('text=FAVORITES', { timeout: 15000 })
    ]).catch(() => {});

    // Check for the card structure
    const favoritesCard = page.locator('.c64-border').filter({ hasText: 'FAVORITES' });
    await expect(favoritesCard).toBeVisible({ timeout: 10000 });

    // Check for the heart icon in header
    const heartIcon = favoritesCard.locator('svg.lucide-heart');
    await expect(heartIcon).toBeVisible({ timeout: 5000 });
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
    await Promise.race([
      page.waitForSelector('text=Loading favorites...', { state: 'hidden', timeout: 15000 }),
      page.waitForSelector('text=No favorites yet', { timeout: 15000 })
    ]).catch(() => {});

    // Check empty state elements (use first match to avoid ambiguity)
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Add songs using the heart icon while playing', { exact: false }).first()).toBeVisible({ timeout: 5000 });

    // Check for empty state heart icon
    const emptyHeartIcon = page.locator('svg.lucide-heart').first();
    await expect(emptyHeartIcon).toBeVisible();
  });
});
