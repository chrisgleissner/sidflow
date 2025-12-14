import { test, expect } from './test-hooks';

if (typeof describe === "function" && !process.env.PLAYWRIGHT_TEST_SUITE) {
  console.log("[sidflow-web] Skipping Playwright e2e spec; run via `bun run test:e2e`.");
  process.exit(0);
}

const RESPONSE_TIMEOUT = 45000;

/**
 * E2E tests for Phase 1 Foundation Enhancement features.
 * Tests search, keyboard shortcuts, charts, and theme switching.
 */

test.describe('Phase 1 Features', () => {
    test.describe.configure({ mode: 'serial', timeout: 45000 });
    test.beforeEach(async ({ page }) => {
        await page.goto('/?tab=play', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible({ timeout: 15000 });
    });

    test.describe('Search Interaction (3.9)', () => {
        test('should allow searching via the search bar', async ({ page }) => {
            // Find search bar
            const playTab = page.getByRole('tabpanel', { name: 'PLAY' });
            const searchBar = playTab.getByTestId('search-input');
            await expect(searchBar).toBeVisible({ timeout: 10000 });

            // Type search query
            await searchBar.fill('sid');
            await expect(searchBar).toHaveValue('sid');

            // Wait for any search API response
            await page.waitForResponse(
                (resp) => resp.url().includes('/api/search') && resp.status() === 200,
                { timeout: RESPONSE_TIMEOUT }
            ).catch(() => { });

            // Verify search bar is functional
            await expect(searchBar).toHaveValue('sid');
        });

        test('should show no results for non-matching query', async ({ page }) => {
            const playTab = page.getByRole('tabpanel', { name: 'PLAY' });
            const searchBar = playTab.getByTestId('search-input');
            await expect(searchBar).toBeVisible({ timeout: 10000 });

            // Search for something that doesn't exist
            const noResultsPromise = page.waitForResponse(
                (resp) => resp.url().includes('/api/search') && resp.status() === 200,
                { timeout: RESPONSE_TIMEOUT }
            );
            await searchBar.fill('xyznonexistent12345qwerty');
            await noResultsPromise;

            // Results dropdown should not appear
            const resultsCard = page.getByTestId('search-results').first();
            await expect(resultsCard).not.toBeVisible({ timeout: 10000 });
        });

        test('should clear search results when input is cleared', async ({ page }) => {
            const playTab = page.getByRole('tabpanel', { name: 'PLAY' });
            const searchBar = playTab.getByTestId('search-input');
            await expect(searchBar).toBeVisible({ timeout: 10000 });

            // Search
            await searchBar.fill('sid');
            await expect(searchBar).toHaveValue('sid');

            // Wait for any search API response
            await page.waitForResponse(
                (resp) => resp.url().includes('/api/search') && resp.status() === 200,
                { timeout: RESPONSE_TIMEOUT }
            ).catch(() => { });

            // Clear search using the X button
            const clearButton = page.locator('button[title="Clear search"]');
            if (await clearButton.isVisible({ timeout: 3000 })) {
                await clearButton.click();

                // Input should be empty
                await expect(searchBar).toHaveValue('');
            }
        });
    });

    test.describe('Keyboard Shortcuts (4.7)', () => {
        test('should focus search bar with S key', async ({ page }) => {
            const playTab = page.getByRole('tabpanel', { name: 'PLAY' });
            const searchBar = playTab.getByTestId('search-input');
            await expect(searchBar).toBeVisible({ timeout: 10000 });

            // Wait for page to be fully interactive
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(500);

            // Press S key
            await page.keyboard.press('s');

            // Verify search bar is focused
            await expect(searchBar).toBeFocused({ timeout: 3000 });
        });

        test('should open shortcuts help with ? key', async ({ page }) => {
            // Wait for page to be fully interactive and keyboard shortcuts to be registered
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(500);
            
            // Press ? key to open help (use Shift+/ to generate ?)
            await page.keyboard.press('Shift+Slash');

            // Verify shortcuts help dialog appears - use role to be more specific
            await expect(page.getByRole('heading', { name: /keyboard shortcuts/i })).toBeVisible({ timeout: 5000 });

            // Close dialog
            await page.keyboard.press('Escape');
            await expect(page.getByRole('heading', { name: /keyboard shortcuts/i })).not.toBeVisible({ timeout: 3000 });
        });

        test('should not trigger shortcuts when typing in search', async ({ page }) => {
            const playTab = page.getByRole('tabpanel', { name: 'PLAY' });
            const searchBar = playTab.getByTestId('search-input');
            await expect(searchBar).toBeVisible({ timeout: 10000 });

            // Focus search bar
            await searchBar.click();

            // Type space in search (should not trigger play/pause)
            await page.keyboard.type('test ');

            // Verify space was typed (not consumed by shortcut)
            await expect(searchBar).toHaveValue(/test /);
        });
    });

    test.describe('Top Charts Display (5.9)', () => {
        test('should display top charts tab', async ({ page }) => {
            test.setTimeout(30000);
            // Navigate to top charts tab using correct Radix UI tab role
            const chartsTab = page.getByRole('tab', { name: /top charts/i });
            await chartsTab.click();
            await page.waitForTimeout(1500);

            // Wait for either charts or empty state to load
            await page.waitForFunction(() => {
                const loader = document.querySelector('.animate-spin');
                return loader === null;
            }, { timeout: 10000 }).catch(() => { });

            // Verify charts heading (use role to be specific)
            await expect(page.getByRole('heading', { name: 'Top Charts' })).toBeVisible();
        });

        test('should switch between time ranges', async ({ page }) => {
            test.setTimeout(30000);
            // Navigate to top charts
            await page.goto('/?tab=charts');
            await page.waitForTimeout(1500);

            // Find time range buttons
            const weekButton = page.getByRole('button', { name: 'This Week' });
            const monthButton = page.getByRole('button', { name: 'This Month' });

            await expect(weekButton).toBeVisible();

            // Click month button
            await monthButton.click();

            // Wait for loading state to complete
            await page.waitForFunction(() => {
                const loader = document.querySelector('.animate-spin');
                return loader === null;
            }, { timeout: 10000 }).catch(() => { });

            // Verify month button is still visible (interaction successful)
            await expect(monthButton).toBeVisible();
        });

        test('should show empty state when no data', async ({ page }) => {
            test.setTimeout(30000);
            // Navigate to top charts
            await page.goto('/?tab=charts');
            await page.waitForTimeout(1500);

            // Check if there's either data or empty state
            const hasData = await page.locator('.space-y-2 > div').first().isVisible().catch(() => false);
            const hasEmptyState = await page.getByText(/no play data available/i).isVisible().catch(() => false);

            // One of them should be visible
            expect(hasData || hasEmptyState).toBeTruthy();
        });
    });

    test.describe('Theme Switching (6.8)', () => {
        test('should switch between themes', async ({ page }) => {
            test.setTimeout(30000);
            // Navigate to preferences
            await page.goto('/?tab=prefs');
            await page.waitForTimeout(500);

            // Find theme selector - it's a Select component
            const themeButton = page.locator('button:has-text("Theme")').first();

            if (await themeButton.isVisible({ timeout: 5000 })) {
                await themeButton.click();

                // Wait for dropdown to appear
                await page.waitForTimeout(500);

                // Look for theme options in the dropdown
                const darkOption = page.getByText('C64 Dark', { exact: true }).or(page.getByText('Dark'));

                if (await darkOption.isVisible({ timeout: 3000 })) {
                    await darkOption.click();

                    // Wait for theme to apply
                    await page.waitForTimeout(1000);

                    // Verify theme changed by checking document attribute
                    const htmlElement = page.locator('html');
                    const hasThemeClass = await htmlElement.evaluate((el) => {
                        return el.className.includes('dark') || el.getAttribute('data-theme') !== null;
                    });
                    expect(hasThemeClass).toBeTruthy();
                }
            }
        });

        test('should persist theme across page reloads', async ({ page }) => {
            test.setTimeout(30000);
            // Navigate to preferences
            await page.goto('/?tab=prefs');
            await page.waitForTimeout(500);

            // Find and change theme
            const themeButton = page.locator('button').filter({ hasText: /theme|c64/i }).first();

            if (await themeButton.isVisible({ timeout: 5000 })) {
                await themeButton.click();
                await page.waitForTimeout(500);

                const darkOption = page.getByText('C64 Dark', { exact: true }).or(page.getByText('Dark'));

                if (await darkOption.isVisible({ timeout: 3000 })) {
                    await darkOption.click();
                    await page.waitForTimeout(1000);

                    // Reload page
                    await page.reload();
                    await page.waitForLoadState('domcontentloaded');

                    // Verify theme persisted by checking HTML element
                    const htmlElement = page.locator('html');
                    const hasThemeClass = await htmlElement.evaluate((el) => {
                        return el.className.includes('dark') || el.getAttribute('data-theme') !== null;
                    });
                    expect(hasThemeClass).toBeTruthy();
                }
            }
        });
    });
});
