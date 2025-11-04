import { test, expect } from '@playwright/test';

test('homepage loads with correct title', async ({ page }) => {
  await page.goto('/');
  
  await expect(page).toHaveTitle(/SIDFlow Control Panel/);
  
  await expect(page.getByRole('heading', { name: 'SIDFlow Control Panel' })).toBeVisible();
  
  await expect(page.getByText(/Local web interface for orchestrating SID/)).toBeVisible();
});
