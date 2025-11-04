import { test, expect } from '@playwright/test';

test.describe('Rating Workflow', () => {
  test('should submit rating successfully', async ({ page }) => {
    await page.goto('/');
    
    // Fill in SID path
    const sidPathInput = page.locator('#rate-path');
    await sidPathInput.fill('/test/path/music.sid');
    
    // Adjust sliders (they default to 3, so we change some)
    // Energy slider
    const energySlider = page.locator('label:has-text("Energy:") + div').locator('[role="slider"]');
    await energySlider.focus();
    await energySlider.press('ArrowRight');
    await energySlider.press('ArrowRight'); // Set to 5
    
    // Mood slider
    const moodSlider = page.locator('label:has-text("Mood:") + div').locator('[role="slider"]');
    await moodSlider.focus();
    await moodSlider.press('ArrowLeft'); // Set to 2
    
    // Submit rating
    const submitButton = page.getByRole('button', { name: /submit rating/i });
    await submitButton.click();
    
    // Check for success
    await expect(page.getByText(/rating submitted successfully/i)).toBeVisible({ timeout: 10000 });
    
    // Verify form was reset
    await expect(sidPathInput).toHaveValue('');
  });

  test('should show error when path is empty', async ({ page }) => {
    await page.goto('/');
    
    // Try to submit without path
    const submitButton = page.getByRole('button', { name: /submit rating/i });
    await submitButton.click();
    
    // Should show error
    await expect(page.getByText(/please enter a sid file path/i)).toBeVisible();
  });

  test('should disable controls while submitting', async ({ page }) => {
    await page.goto('/');
    
    // Fill in SID path
    const sidPathInput = page.locator('#rate-path');
    await sidPathInput.fill('/test/path/music.sid');
    
    // Submit rating
    const submitButton = page.getByRole('button', { name: /submit rating/i });
    await submitButton.click();
    
    // Controls should be disabled
    await expect(submitButton).toBeDisabled();
    await expect(page.getByRole('button', { name: /submitting/i })).toBeVisible();
  });

  test('should display all rating dimensions', async ({ page }) => {
    await page.goto('/');
    
    // Verify all rating dimensions are present
    await expect(page.getByText(/energy:/i)).toBeVisible();
    await expect(page.getByText(/mood:/i)).toBeVisible();
    await expect(page.getByText(/complexity:/i)).toBeVisible();
    await expect(page.getByText(/preference:/i)).toBeVisible();
  });

  test('should show initial slider values', async ({ page }) => {
    await page.goto('/');
    
    // All sliders should default to 3
    await expect(page.getByText('Energy: 3')).toBeVisible();
    await expect(page.getByText('Mood: 3')).toBeVisible();
    await expect(page.getByText('Complexity: 3')).toBeVisible();
    await expect(page.getByText('Preference: 3')).toBeVisible();
  });

  test('should allow adjusting all sliders', async ({ page }) => {
    await page.goto('/');
    
    // Adjust each slider
    const energySlider = page.locator('label:has-text("Energy:") + div').locator('[role="slider"]');
    await energySlider.focus();
    await energySlider.press('End'); // Set to max (5)
    await expect(page.getByText('Energy: 5')).toBeVisible();
    
    const moodSlider = page.locator('label:has-text("Mood:") + div').locator('[role="slider"]');
    await moodSlider.focus();
    await moodSlider.press('Home'); // Set to min (1)
    await expect(page.getByText('Mood: 1')).toBeVisible();
    
    const complexitySlider = page.locator('label:has-text("Complexity:") + div').locator('[role="slider"]');
    await complexitySlider.focus();
    await complexitySlider.press('ArrowRight');
    await complexitySlider.press('ArrowRight'); // Set to 5
    await expect(page.getByText('Complexity: 5')).toBeVisible();
    
    const preferenceSlider = page.locator('label:has-text("Preference:") + div').locator('[role="slider"]');
    await preferenceSlider.focus();
    await preferenceSlider.press('ArrowLeft');
    await preferenceSlider.press('ArrowLeft'); // Set to 1
    await expect(page.getByText('Preference: 1')).toBeVisible();
  });
});
