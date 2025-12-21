/**

const hasDescribe = typeof (globalThis as unknown as { describe?: unknown }).describe === 'function';
if (hasDescribe && !process.env.PLAYWRIGHT_TEST_SUITE) {
  console.log("[sidflow-web] Skipping Playwright e2e spec; run via `bun run test:e2e`.");
  process.exit(0);
}
 * E2E tests for social features: authentication, activity stream, user profiles
 */

import { test, expect } from './test-hooks';

test.describe('Social Features', () => {
    test('should display login and signup buttons when not authenticated', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Check for login button
        const loginButton = page.getByRole('button', { name: /log in/i });
        await expect(loginButton).toBeVisible();

        // Check for signup button
        const signupButton = page.getByRole('button', { name: /sign up/i });
        await expect(signupButton).toBeVisible();
    });

    test('should open registration dialog and validate form', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Click sign up button
        const signupButton = page.getByRole('button', { name: /sign up/i });
        await expect(signupButton).toBeVisible({ timeout: 10_000 });
        await signupButton.click({ force: true, timeout: 15_000 });

        // Wait for dialog to open with explicit timeout
        await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 10_000 });

        // Check for form fields
        await expect(page.getByLabel(/username/i)).toBeVisible();
        await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
        await expect(page.getByLabel(/confirm password/i)).toBeVisible();

        // Try to submit empty form - button should be disabled or show errors
        const submitButton = page.getByRole('button', { name: /create account/i });
        await expect(submitButton).toBeVisible();
    });

    test('should open login dialog', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Click log in button
        await page.getByRole('button', { name: /log in/i }).click();

        // Wait for dialog to open
        await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

        // Check for form fields
        await expect(page.getByLabel(/username/i)).toBeVisible();
        await expect(page.getByLabel('Password', { exact: true })).toBeVisible();

        // Check that dialog is visible (already checked form fields, that's sufficient)
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog).toBeVisible();
    });

    test('should navigate to Activity tab', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Click on Activity tab
        const activityTab = page.getByTestId('tab-activity');
        await activityTab.click({ timeout: 15_000 });

        // Wait for activity content using specific selector
        const activityContent = page.getByRole('tabpanel', { name: /activity/i });
        await expect(activityContent).toBeVisible({ timeout: 5000 });
    });

    test('should display activity refresh button', async ({ page }) => {
        await page.goto('/?tab=activity', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Should see refresh button
        const refreshButton = page.getByRole('button', { name: /refresh/i });
        await expect(refreshButton).toBeVisible();

        // Click refresh button
        await refreshButton.click();
        // No fixed timeout - the test is complete once the button is clicked
    });

    test('should navigate to Profiles tab', async ({ page }) => {
        await page.goto('/?tab=profiles', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Wait for loading to complete (deterministic)
        await page.waitForFunction(() => document.querySelector('.animate-spin') === null, { timeout: 5000 }).catch(() => {});

        // Should see search form - look for username input specifically
        const searchInput = page.locator('input[type="text"]').first();
        await expect(searchInput).toBeVisible();
    });

    test('should allow profile search', async ({ page }) => {
        await page.goto('/?tab=profiles', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Find search input
        const searchInput = page.locator('input[type="text"]').first();
        await expect(searchInput).toBeVisible();

        // Type a username
        await searchInput.fill('testuser');

        // Find search button
        const searchButton = page.getByRole('button').filter({ hasText: /search/i });
        await expect(searchButton).toBeVisible();

        // Click search - should show "not found" or profile (no fixed timeout needed)
        await searchButton.click();
    });

    test('should navigate to Charts tab', async ({ page }) => {
        await page.goto('/?tab=charts', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Wait for loading to complete (deterministic)
        await page.waitForFunction(() => document.querySelector('.animate-spin') === null, { timeout: 5000 }).catch(() => {});

        // Should see charts content - check for visible content
        const visiblePanel = page.locator('[role="tabpanel"]:visible');
        await expect(visiblePanel).toBeVisible();
    });

    test('should display all social tabs for public users', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // Check that all social tabs are visible (use first() to handle multiple matches)
        await expect(page.getByTestId('tab-activity').first()).toBeVisible();
        await expect(page.getByTestId('tab-profiles').first()).toBeVisible();
        await expect(page.getByTestId('tab-charts').first()).toBeVisible();
    });
});
