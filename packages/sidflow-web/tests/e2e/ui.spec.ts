import { test, expect } from '@playwright/test';

test.describe('Status Display', () => {
  test('should show and clear status messages', async ({ page }) => {
    await page.goto('/');
    
    // Trigger an action that shows status
    const sidPathInput = page.locator('#sid-path');
    await sidPathInput.fill('/test/path/music.sid');
    
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    
    // Status should be visible
    await expect(page.getByText(/playback started successfully/i)).toBeVisible({ timeout: 10000 });
    
    // Click clear button
    const clearButton = page.getByRole('button', { name: /×/i });
    await clearButton.click();
    
    // Status should be gone
    await expect(page.getByText(/playback started successfully/i)).not.toBeVisible();
  });

  test('should display error messages differently', async ({ page }) => {
    await page.goto('/');
    
    // Trigger an error
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    
    // Error should be visible with different styling
    const errorAlert = page.locator('[role="alert"]').filter({ hasText: /please enter a sid file path/i });
    await expect(errorAlert).toBeVisible();
  });
});

test.describe('Queue View', () => {
  test('should add tracks to queue when played', async ({ page }) => {
    await page.goto('/');
    
    // Play first track
    const sidPathInput = page.locator('#sid-path');
    await sidPathInput.fill('/test/track1.sid');
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    await expect(page.getByText(/playback started successfully/i)).toBeVisible({ timeout: 10000 });
    
    // Verify track is in queue
    await expect(page.getByText('/test/track1.sid')).toBeVisible();
    
    // Clear status
    const clearButton = page.getByRole('button', { name: /×/i });
    await clearButton.click();
    
    // Play second track
    await sidPathInput.fill('/test/track2.sid');
    await playButton.click();
    await expect(page.getByText(/playback started successfully/i)).toBeVisible({ timeout: 10000 });
    
    // Both tracks should be in queue
    await expect(page.getByText('/test/track1.sid')).toBeVisible();
    await expect(page.getByText('/test/track2.sid')).toBeVisible();
  });

  test('should show queue heading', async ({ page }) => {
    await page.goto('/');
    
    // Queue section should be visible
    await expect(page.getByRole('heading', { name: /recently played/i })).toBeVisible();
  });
});

test.describe('UI Layout', () => {
  test('should have proper page structure', async ({ page }) => {
    await page.goto('/');
    
    // Main heading
    await expect(page.getByRole('heading', { name: 'SIDFlow Control Panel' })).toBeVisible();
    
    // Description
    await expect(page.getByText(/local web interface/i)).toBeVisible();
    
    // Play controls card
    await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();
    
    // Rating panel card
    await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();
    
    // Queue view
    await expect(page.getByRole('heading', { name: /recently played/i })).toBeVisible();
  });

  test('should be responsive', async ({ page }) => {
    await page.goto('/');
    
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    // All sections should still be visible
    await expect(page.getByRole('heading', { name: 'SIDFlow Control Panel' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /rate track/i })).toBeVisible();
  });
});
