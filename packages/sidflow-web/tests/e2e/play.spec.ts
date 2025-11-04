import { test, expect } from '@playwright/test';

test.describe('Play Workflow', () => {
  test('should play a SID file successfully', async ({ page }) => {
    await page.goto('/');
    
    // Fill in SID path
    const sidPathInput = page.locator('#sid-path');
    await sidPathInput.fill('/test/path/music.sid');
    
    // Click play button
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    
    // Check for success status
    await expect(page.getByText(/playback started successfully/i)).toBeVisible({ timeout: 10000 });
    
    // Verify track was added to queue
    await expect(page.getByText('/test/path/music.sid')).toBeVisible();
  });

  test('should play with mood preset', async ({ page }) => {
    await page.goto('/');
    
    // Fill in SID path
    const sidPathInput = page.locator('#sid-path');
    await sidPathInput.fill('/test/energetic.sid');
    
    // Select mood preset
    await page.locator('#mood-preset').click();
    await page.getByRole('option', { name: /energetic/i }).click();
    
    // Click play button
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    
    // Check for success
    await expect(page.getByText(/playback started successfully/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show error when SID path is empty', async ({ page }) => {
    await page.goto('/');
    
    // Click play without entering path
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    
    // Should show error
    await expect(page.getByText(/please enter a sid file path/i)).toBeVisible();
  });

  test('should disable controls while playing', async ({ page }) => {
    await page.goto('/');
    
    // Fill in SID path
    const sidPathInput = page.locator('#sid-path');
    await sidPathInput.fill('/test/path/music.sid');
    
    // Click play button
    const playButton = page.getByRole('button', { name: /play/i });
    await playButton.click();
    
    // Button should be disabled and show loading state
    await expect(playButton).toBeDisabled();
    await expect(page.getByRole('button', { name: /playing/i })).toBeVisible();
  });

  test('should test all mood presets', async ({ page }) => {
    await page.goto('/');
    
    const presets = ['quiet', 'ambient', 'energetic', 'dark', 'bright', 'complex'];
    
    for (const preset of presets) {
      // Fill in SID path
      const sidPathInput = page.locator('#sid-path');
      await sidPathInput.fill(`/test/${preset}.sid`);
      
      // Select mood preset
      await page.locator('#mood-preset').click();
      await page.getByRole('option', { name: new RegExp(preset, 'i') }).click();
      
      // Click play button
      const playButton = page.getByRole('button', { name: /play/i });
      await playButton.click();
      
      // Wait for success (with timeout)
      await expect(page.getByText(/playback started successfully/i)).toBeVisible({ timeout: 10000 });
      
      // Clear status for next iteration
      const clearButton = page.getByRole('button', { name: /×/i });
      if (await clearButton.isVisible()) {
        await clearButton.click();
      }
    }
  });
});
