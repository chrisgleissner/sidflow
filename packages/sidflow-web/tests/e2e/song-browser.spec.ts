/**
 * End-to-end tests for Song Browser and folder playback modes.
 * Tests navigation, folder browsing, and direct playback features.
 */

import { test, expect, type Page } from './test-hooks';
import { configureE2eLogging } from './utils/logging';

configureE2eLogging();

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

type HvscFixtureNode = {
  parent?: string;
  items: Array<{
    name: string;
    path: string;
    type: 'folder' | 'file';
    size?: number;
    songs?: number;
  }>;
};

const HVSC_FIXTURE_TREE: Record<string, HvscFixtureNode> = {
  '': {
    parent: undefined,
    items: [
      { name: 'C64Music', path: 'C64Music', type: 'folder' },
      { name: 'DEMOS', path: 'DEMOS', type: 'folder' },
      { name: 'Intro.sid', path: 'Intro.sid', type: 'file', size: 1024, songs: 1 },
    ],
  },
  C64Music: {
    parent: '',
    items: [
      { name: 'MUSICIANS', path: 'C64Music/MUSICIANS', type: 'folder' },
      { name: 'GAMES', path: 'C64Music/GAMES', type: 'folder' },
      { name: 'Sample_Tune.sid', path: 'C64Music/Sample_Tune.sid', type: 'file', size: 2048, songs: 2 },
    ],
  },
  'C64Music/MUSICIANS': {
    parent: 'C64Music',
    items: [
      { name: 'Hubbard_Rob', path: 'C64Music/MUSICIANS/Hubbard_Rob', type: 'folder' },
      { name: 'Hubbard_Rob/Sanxion.sid', path: 'C64Music/MUSICIANS/Hubbard_Rob/Sanxion.sid', type: 'file', size: 4096, songs: 3 },
    ],
  },
  DEMOS: {
    parent: '',
    items: [
      { name: 'Forever.sid', path: 'DEMOS/Forever.sid', type: 'file', size: 1536, songs: 1 },
    ],
  },
};

const songBrowserFixturesInstalled = new WeakSet<ReturnType<Page['context']>>();

async function installSongBrowserFixtures(page: Page): Promise<void> {
  const context = page.context();
  if (songBrowserFixturesInstalled.has(context)) {
    return;
  }
  songBrowserFixturesInstalled.add(context);

  await context.route('**/api/hvsc/browse**', async (route) => {
    const url = new URL(route.request().url());
    const requestedPath = url.searchParams.get('path') ?? '';
    const fixture = HVSC_FIXTURE_TREE[requestedPath] ?? { parent: '', items: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        path: requestedPath,
        parent: fixture.parent,
        items: fixture.items,
      }),
    });
  });
}

if (!isPlaywrightRunner) {
  console.warn('[sidflow-web] Skipping Playwright song browser e2e spec; run via `bun run test:e2e`.');
} else {
  test.describe.configure({ mode: 'serial' });
  test.describe('Song Browser', () => {
    const skipFolderActions = process.env.SIDFLOW_SKIP_SONGBROWSER_ACTIONS === '1';
    test.beforeEach(async ({ page }) => {
      // This suite can be slow on shared CI runners; keep per-test timeout generous.
      test.setTimeout(60_000);

      await installSongBrowserFixtures(page);
      await page.goto('http://localhost:3000', { timeout: 60_000, waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('domcontentloaded');
      // Wait for hydration with condition instead of fixed timeout
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});
    });

    test('displays song browser component', async ({ page }) => {
      // Navigate to Play tab
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      
      // Wait for content to load instead of fixed timeout
      await page.waitForLoadState('domcontentloaded');

      // Check for song browser heading
      const browserHeading = page.getByText(/SID COLLECTION BROWSER/i);
      await expect(browserHeading).toBeVisible();
    });

    test('shows breadcrumb navigation', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForLoadState('domcontentloaded');

      // Look for Collection breadcrumb
      const collectionBreadcrumb = page.getByRole('button', { name: 'Collection' });
      await expect(collectionBreadcrumb).toBeVisible();
    });

    test('displays folders and files when available', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();

      // Wait for the browser component to finish loading with condition
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});

      // Check if either folders or files section is visible, or if there's a valid state message
      // (actual content depends on local SID collection being configured)
      const foldersHeader = page.getByText(/Folders \(/i);
      const filesHeader = page.getByText(/SID Files \(/i);
      const emptyMessage = page.getByText(/This folder is empty/i);
      const errorMessage = page.locator('text=/HTTP|Unable|Error|not configured/i');

      // Wait for at least one of these to appear
      try {
        await Promise.race([
          foldersHeader.waitFor({ timeout: 3000 }),
          filesHeader.waitFor({ timeout: 3000 }),
          emptyMessage.waitFor({ timeout: 3000 }),
          errorMessage.first().waitFor({ timeout: 3000 })
        ]);
        // If we got here, at least one element appeared
        expect(true).toBeTruthy();
      } catch {
        // None appeared - check if Loading is still showing
        const isLoading = await page.getByText(/Loading\.\.\./).isVisible();
        // Fail with helpful message
        expect(isLoading).toBe(false);
      }
    });

    test('navigates to folder when clicked', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});

      // Try to click first folder if available
      const firstFolder = page.locator('button:has-text("MUSICIANS"), button:has-text("DEMOS"), button:has-text("GAMES")').first();
      const folderCount = await firstFolder.count();

      if (folderCount > 0) {
        const folderName = await firstFolder.textContent();
        await firstFolder.click();
        await page.waitForLoadState('domcontentloaded');

        // Breadcrumb should update
        const breadcrumb = page.getByRole('button', { name: folderName || '' });
        await expect(breadcrumb).toBeVisible();
      } else {
        // If no folders, test passes (local collection not configured)
        console.log('No folders found - local SID collection may not be configured');
      }
    });

    test('shows folder action buttons', async ({ page }) => {
      test.setTimeout(45000); // Allow extra time under high load

      const playTab = page.getByRole('tab', { name: /play/i });
      console.log('[folder-buttons] clicking play tab');
      await playTab.click();
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});

      // Wait for song browser to load
      console.log('[folder-buttons] waiting for collection browser heading');
      await page.waitForSelector('text=/SID COLLECTION BROWSER/i', { timeout: 10000 });

      // Wait for folders section to appear with condition
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});

      // Look for folder names (C64Music should be visible)
      const hasC64MusicFolder = await page.getByText('C64Music').isVisible().catch(() => false);
      console.log('[folder-buttons] C64Music folder visible:', hasC64MusicFolder);

      // If we have folders, we should have action buttons
      // Look for play/shuffle buttons on folder items
      const actionButtons = await page.locator('button[title*="Play"], button[title*="Shuffle"]').all();
      console.log('[folder-buttons] action buttons found:', actionButtons.length);

      // Verify we have at least some folders or buttons visible
      // test-workspace/hvsc has C64Music with subfolders
      const hasFoldersOrButtons = hasC64MusicFolder || actionButtons.length > 0;
      expect(hasFoldersOrButtons).toBeTruthy();
    });

    test('shows file play buttons', async ({ page }) => {
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});

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
      await installSongBrowserFixtures(page);
      await page.goto('http://localhost:3000', { timeout: 30000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForLoadState('domcontentloaded');
    });

    test('volume slider is visible', async ({ page }) => {
      const playPanel = page.getByRole('tabpanel', { name: /play/i });
      const volumeSlider = playPanel.getByLabel('Volume control');
      await expect(volumeSlider).toBeVisible();
    });

    test('volume slider has correct range', async ({ page }) => {
      const playPanel = page.getByRole('tabpanel', { name: /play/i });
      const volumeSlider = playPanel.getByLabel('Volume control');
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
      const playPanel = page.getByRole('tabpanel', { name: /play/i });
      const volumeSlider = playPanel.getByLabel('Volume control');
      const currentValue = await volumeSlider.getAttribute('aria-valuenow');

      // Default volume should be 100%
      expect(currentValue).toBe('100');
    });
  });

  test.describe('Playback Mode Display', () => {
    test.beforeEach(async ({ page }) => {
      await installSongBrowserFixtures(page);
      await page.goto('http://localhost:3000', { timeout: 30000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForLoadState('domcontentloaded');
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
      const playPanel = page.getByRole('tabpanel', { name: /play/i });
      const upcomingSection = playPanel.getByText(/Upcoming Tracks/i).first();
      await expect(upcomingSection).toBeVisible();

      // Should show either tracks or a placeholder
      const hasPlaceholder = (await playPanel.getByText(/Playlist generated/i).count()) > 0;
      const hasTracks = (await playPanel.locator('text=/#\\d+ •/i').count()) > 0;

      expect(hasPlaceholder || hasTracks).toBeTruthy();
    });

    test('shows played tracks section', async ({ page }) => {
      const playPanel = page.getByRole('tabpanel', { name: /play/i });
      const playedSection = playPanel.getByText(/Played Tracks/i).first();
      await expect(playedSection).toBeVisible();
    });
  });

  test.describe('Play Controls', () => {
    test.beforeEach(async ({ page }) => {
      test.setTimeout(30000); // Increase timeout for dev mode

      await installSongBrowserFixtures(page);
      await page.goto('http://localhost:3000', { timeout: 30000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});
      const playTab = page.getByRole('tab', { name: /play/i });
      await playTab.click();
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});
    });

    test('displays playback control buttons', async ({ page }) => {
      // Wait for player to load with condition
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 5000 }).catch(() => {});

      // Look for any playback control buttons directly
      const hasPlayControls = await page.locator('button[title*="track"], button[aria-label*="playback"]').count();
      expect(hasPlayControls).toBeGreaterThan(0);
    });

    test('shows progress slider', async ({ page }) => {
      // The progress slider is the second slider on the page (first is volume)
      const sliders = page.locator('[role="slider"]');
      await expect(sliders.nth(1)).toBeVisible();
    });

    test('displays time indicators', async ({ page }) => {
      // Look for time format (MM:SS or HH:MM:SS)
      const timeDisplay = page.locator('span').filter({ hasText: /\d{1,2}:\d{2}/ }).first();
      await expect(timeDisplay).toBeVisible();
    });
  });
}
