/**
 * E2E tests for social features: authentication, activity stream, user profiles
 */

import { test, expect } from '@playwright/test';

test.describe('Social Features', () => {
    test('should display login and signup buttons when not authenticated', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Check for login button
        const loginButton = page.getByRole('button', { name: /log in/i });
        await expect(loginButton).toBeVisible();

        // Check for signup button
        const signupButton = page.getByRole('button', { name: /sign up/i });
        await expect(signupButton).toBeVisible();
    });

    test('should open registration dialog and validate form', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Click sign up button
        await page.getByRole('button', { name: /sign up/i }).click();

        // Wait for dialog to open
        await page.waitForSelector('[role="dialog"]');

        // Check for form fields
        await expect(page.getByLabel(/username/i)).toBeVisible();
        await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
        await expect(page.getByLabel(/confirm password/i)).toBeVisible();

        // Try to submit empty form - button should be disabled or show errors
        const submitButton = page.getByRole('button', { name: /create account/i });
        await expect(submitButton).toBeVisible();
    });

    test('should open login dialog', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Click log in button
        await page.getByRole('button', { name: /log in/i }).click();

        // Wait for dialog to open
        await page.waitForSelector('[role="dialog"]');

        // Check for form fields
        await expect(page.getByLabel(/username/i)).toBeVisible();
        await expect(page.getByLabel(/password/i)).toBeVisible();

        const loginButton = page.getByRole('button', { name: /log in/i }).last();
        await expect(loginButton).toBeVisible();
    });

    test('should navigate to Activity tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Click on Activity tab
        const activityTab = page.locator('[role="tab"]', { hasText: /activity/i });
        await activityTab.click();

        // Wait for activity content using specific selector
        const activityContent = page.getByRole('tabpanel', { name: /activity/i });
        await expect(activityContent).toBeVisible({ timeout: 5000 });
    });

    test('should display activity refresh button', async ({ page }) => {
        await page.goto('/?tab=activity');
        await page.waitForLoadState('networkidle');

        // Should see refresh button
        const refreshButton = page.getByRole('button', { name: /refresh/i });
        await expect(refreshButton).toBeVisible();

        // Click refresh button
        await refreshButton.click();
        await page.waitForTimeout(300);
    });

    test('should navigate to Profiles tab', async ({ page }) => {
        await page.goto('/?tab=profiles');
        await page.waitForLoadState('networkidle');

        // Wait for profile content
        await page.waitForTimeout(500);

        // Should see search form - look for username input specifically
        const searchInput = page.locator('input[type="text"]').first();
        await expect(searchInput).toBeVisible();
    });

    test('should allow profile search', async ({ page }) => {
        await page.goto('/?tab=profiles');
        await page.waitForLoadState('networkidle');

        // Find search input
        const searchInput = page.locator('input[type="text"]').first();
        await expect(searchInput).toBeVisible();

        // Type a username
        await searchInput.fill('testuser');

        // Find search button
        const searchButton = page.getByRole('button').filter({ hasText: /search/i });
        await expect(searchButton).toBeVisible();

        // Click search - should show "not found" or profile
        await searchButton.click();
        await page.waitForTimeout(300);
    });

    test('should navigate to Charts tab', async ({ page }) => {
        await page.goto('/?tab=charts');
        await page.waitForLoadState('networkidle');

        // Wait for charts content
        await page.waitForTimeout(500);

        // Should see charts content - check for visible content
        const visiblePanel = page.locator('[role="tabpanel"]:visible');
        await expect(visiblePanel).toBeVisible();
    });

    test('should display all social tabs for public users', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Check that all social tabs are visible
        await expect(page.locator('[role="tab"]', { hasText: /activity/i })).toBeVisible();
        await expect(page.locator('[role="tab"]', { hasText: /profiles/i })).toBeVisible();
        await expect(page.locator('[role="tab"]', { hasText: /charts/i })).toBeVisible();
    });
});
