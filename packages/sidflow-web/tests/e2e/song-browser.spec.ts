/**
 * End-to-end tests for Song Browser and folder playback modes.
 * Tests navigation, folder browsing, and direct playback features.
 */

import { test, expect, type Page } from '@playwright/test';
import { configureE2eLogging } from './utils/logging';

configureE2eLogging();

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

if (!isPlaywrightRunner) {
  console.warn('[sidflow-web] Skipping Playwright song browser e2e spec; run via `bun run test:e2e`.');
} else {
  test.describe('Song Browser', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');
    });

    test('displays song browser component', async ({ page }) => {
      // Navigate to Play tab
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(500);

      // Check for song browser heading
      const browserHeading = page.getByText(/SID COLLECTION BROWSER/i);
      await expect(browserHeading).toBeVisible();
    });

    test('shows breadcrumb navigation', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(500);

      // Look for Collection breadcrumb
      const collectionBreadcrumb = page.getByRole('button', { name: 'Collection' });
      await expect(collectionBreadcrumb).toBeVisible();
    });

    test('displays folders and files when available', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(1000);

      // Check if either folders or files section is visible
      // (actual content depends on local SID collection being configured)
      const hasFolders = await page.getByText(/Folders \(\d+\)/i).count() > 0;
      const hasFiles = await page.getByText(/SID Files \(\d+\)/i).count() > 0;
      const isEmpty = await page.getByText(/This folder is empty/i).count() > 0;
      const hasError = await page.getByText(/not configured/i).count() > 0;

      // At least one of these should be true
      expect(hasFolders || hasFiles || isEmpty || hasError).toBeTruthy();
    });

    test('navigates to folder when clicked', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(1000);

      // Try to click first folder if available
      const firstFolder = page.locator('button:has-text("MUSICIANS"), button:has-text("DEMOS"), button:has-text("GAMES")').first();
      const folderCount = await firstFolder.count();

      if (folderCount > 0) {
        const folderName = await firstFolder.textContent();
        await firstFolder.click();
        await page.waitForTimeout(500);

        // Breadcrumb should update
        const breadcrumb = page.getByRole('button', { name: folderName || '' });
        await expect(breadcrumb).toBeVisible();
      } else {
        // If no folders, test passes (local collection not configured)
        console.log('No folders found - local SID collection may not be configured');
      }
    });

    test('shows folder action buttons', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(1000);

      // Look for any folder with action buttons
      const folderContainer = page.locator('[class*="border-border"]').first();
      const hasListButton = await folderContainer.locator('button[title*="Play all songs in this folder"]').count() > 0;
      const hasPlayButton = await folderContainer.locator('button[title*="Play all songs in this folder and subfolders"]').count() > 0;
      const hasShuffleButton = await folderContainer.locator('button[title*="Shuffle"]').count() > 0;

      // If folders exist, they should have action buttons
      const foldersExist = await page.getByText(/Folders \(\d+\)/i).count() > 0;
      if (foldersExist) {
        expect(hasListButton || hasPlayButton || hasShuffleButton).toBeTruthy();
      }
    });

    test('shows file play buttons', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(1000);

      // Look for SID files
      const fileSection = page.getByText(/SID Files \(\d+\)/i);
      const filesExist = await fileSection.count() > 0;

      if (filesExist) {
        // Check for play buttons on files
        const playButton = page.locator('button[title^="Play"]').first();
        await expect(playButton).toBeVisible();
      }
    });
  });

  test.describe('Volume Control', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(500);
    });

    test('volume slider is visible', async ({ page }) => {
      const volumeSlider = page.locator('input[aria-label="Volume control"]');
      await expect(volumeSlider).toBeVisible();
    });

    test('volume slider has correct range', async ({ page }) => {
      const volumeSlider = page.locator('input[aria-label="Volume control"]');
      const min = await volumeSlider.getAttribute('aria-valuemin');
      const max = await volumeSlider.getAttribute('aria-valuemax');

      expect(min).toBe('0');
      expect(max).toBe('100');
    });

    test('volume icon changes based on volume level', async ({ page }) => {
      // Check for volume icon
      const volumeIcon = page.locator('svg.lucide-volume-2, svg.lucide-volume-x').first();
      await expect(volumeIcon).toBeVisible();
    });

    test('volume slider starts at 100%', async ({ page }) => {
      const volumeSlider = page.locator('input[aria-label="Volume control"]');
      const currentValue = await volumeSlider.getAttribute('aria-valuenow');

      // Default volume should be 100%
      expect(currentValue).toBe('100');
    });
  });

  test.describe('Playback Mode Display', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(500);
    });

    test('shows default mood station mode', async ({ page }) => {
      // Check for mood preset selector
      const presetSelector = page.getByRole('combobox');
      await expect(presetSelector).toBeVisible();

      // Default mode should be visible in UI
      const upcomingCard = page.locator('text=/Upcoming Tracks/i').first();
      await expect(upcomingCard).toBeVisible();
    });

    test('displays upcoming tracks section', async ({ page }) => {
      const upcomingSection = page.getByText(/Upcoming Tracks/i);
      await expect(upcomingSection).toBeVisible();

      // Should show either tracks or a placeholder
      const hasPlaceholder = await page.getByText(/Playlist generated/i).count() > 0;
      const hasTracks = await page.locator('text=/#\\d+ •/i').count() > 0;

      expect(hasPlaceholder || hasTracks).toBeTruthy();
    });

    test('shows played tracks section', async ({ page }) => {
      const playedSection = page.getByText(/Played Tracks/i);
      await expect(playedSection).toBeVisible();
    });
  });

  test.describe('Play Controls', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:3000');
      await page.waitForLoadState('networkidle');
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForTimeout(500);
    });

    test('displays playback control buttons', async ({ page }) => {
      // Previous button
      const previousButton = page.getByRole('button', { name: /previous track/i });
      await expect(previousButton).toBeVisible();

      // Play/Pause button
      const playPauseButton = page.locator('button[aria-label*="playback"]').first();
      await expect(playPauseButton).toBeVisible();

      // Next button
      const nextButton = page.getByRole('button', { name: /next track/i });
      await expect(nextButton).toBeVisible();
    });

    test('shows progress slider', async ({ page }) => {
      const progressSlider = page.locator('input[type="range"]').first();
      await expect(progressSlider).toBeVisible();
    });

    test('displays time indicators', async ({ page }) => {
      // Look for time format (MM:SS or HH:MM:SS)
      const timeDisplay = page.locator('span').filter({ hasText: /\d{1,2}:\d{2}/ }).first();
      await expect(timeDisplay).toBeVisible();
    });
  });
}
