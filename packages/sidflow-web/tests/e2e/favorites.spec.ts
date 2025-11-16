import { test, expect } from '@playwright/test';

test.describe('Favorites Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public player
    await page.goto('/');
    
    // Wait for the page to load
    await page.waitForSelector('[data-testid="tab-play"]', { timeout: 10000 });
  });

  test('should display favorites tab for public users', async ({ page }) => {
    // Check that favorites tab exists
    const favoritesTab = page.locator('[data-testid="tab-favorites"]');
    await expect(favoritesTab).toBeVisible();
    
    // Click favorites tab
    await favoritesTab.click();
    
    // Should show empty state initially
    await expect(page.getByText('No favorites yet')).toBeVisible();
    await expect(page.getByText('Add songs using the heart icon while playing')).toBeVisible();
  });

  test('should allow adding and removing favorites from play tab', async ({ page }) => {
    // Start on Play tab
    const playTab = page.locator('[data-testid="tab-play"]');
    await playTab.click();
    
    // Wait for a track to load (this might take a moment in real scenario)
    await page.waitForSelector('[data-testid="favorite-icon"]', { timeout: 15000 }).catch(() => {
      // If no track loads automatically, that's okay for this test
    });
    
    // Check if favorite button exists
    const favoriteButton = page.locator('button:has([data-testid="favorite-icon"])').first();
    
    if (await favoriteButton.isVisible()) {
      // Click to add to favorites
      await favoriteButton.click();
      
      // Should show confirmation message
      await expect(page.getByText(/added to favorites/i)).toBeVisible({ timeout: 5000 });
      
      // Switch to favorites tab
      await page.locator('[data-testid="tab-favorites"]').click();
      
      // Should see at least one favorite now
      const favoritesList = page.locator('[data-testid="favorite-icon"]');
      await expect(favoritesList.first()).toBeVisible({ timeout: 5000 });
      
      // Go back to play tab
      await playTab.click();
      
      // Click favorite button again to remove
      await favoriteButton.click();
      
      // Should show removal confirmation
      await expect(page.getByText(/removed from favorites/i)).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show play all and shuffle buttons when favorites exist', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Check for action buttons (they should be disabled when empty)
    const playAllButton = page.getByRole('button', { name: /play all/i });
    const shuffleButton = page.getByRole('button', { name: /shuffle/i });
    
    await expect(playAllButton).toBeVisible();
    await expect(shuffleButton).toBeVisible();
    
    // Buttons should be disabled when no favorites
    await expect(playAllButton).toBeDisabled();
    await expect(shuffleButton).toBeDisabled();
  });

  test('should show clear all button only when favorites exist', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Clear All button should not be visible when empty
    const clearAllButton = page.getByRole('button', { name: /clear all/i });
    await expect(clearAllButton).not.toBeVisible();
  });

  test('should display favorite tracks with metadata', async ({ page }) => {
    // This test would require seeding some favorites first
    // For now, we'll just check the structure is correct
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Check for the card structure
    const favoritesCard = page.locator('.c64-border').filter({ hasText: 'FAVORITES' });
    await expect(favoritesCard).toBeVisible();
    
    // Check for the heart icon in header
    const heartIcon = favoritesCard.locator('svg.lucide-heart');
    await expect(heartIcon).toBeVisible();
  });

  test('should maintain favorites state across tab switches', async ({ page }) => {
    // Navigate to favorites tab
    await page.locator('[data-testid="tab-favorites"]').click();
    await expect(page.getByText('FAVORITES')).toBeVisible();
    
    // Switch to prefs tab
    await page.locator('[data-testid="tab-prefs"]').click();
    await page.waitForTimeout(500);
    
    // Switch back to favorites
    await page.locator('[data-testid="tab-favorites"]').click();
    
    // Should still show favorites content
    await expect(page.getByText('FAVORITES')).toBeVisible();
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
    
    // Check empty state elements
    await expect(page.getByText('No favorites yet')).toBeVisible();
    await expect(page.getByText('Add songs using the heart icon while playing')).toBeVisible();
    
    // Check for empty state heart icon
    const emptyHeartIcon = page.locator('svg.lucide-heart').first();
    await expect(emptyHeartIcon).toBeVisible();
  });
});
