import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { configureE2eLogging } from './utils/logging';
import {
  installPlayTabRoutes,
  STATION_NAME,
  STATION_TRACK_TITLES,
  COMMUNITY_AVERAGE_RATING,
  PERSONAL_RATING_VALUE,
} from './utils/play-tab-fixture';

configureE2eLogging();

const isPlaywrightRunner = Boolean(process.env.PLAYWRIGHT_TEST);

if (!isPlaywrightRunner) {
  console.warn('[sidflow-web] Skipping Play tab personalization e2e spec; run via `bun run test:e2e`.');
} else {
  const initScriptsInstalled = new WeakSet<BrowserContext>();

  async function ensurePlayTabInitScripts(page: Page): Promise<void> {
    const context = page.context();
    if (initScriptsInstalled.has(context)) {
      return;
    }
    initScriptsInstalled.add(context);

    await context.addInitScript(
      ({ personalRating, sidPaths }: { personalRating: number; sidPaths: string[] }) => {
        try {
          window.localStorage.removeItem('sidflow.preferences');
        } catch {
          // ignore storage errors in headless environments
        }

        try {
          const ratings = sidPaths.reduce<Record<string, { rating: number; timestamp: string }>>((acc, sidPath) => {
            acc[sidPath] = {
              rating: personalRating,
              timestamp: new Date().toISOString(),
            };
            return acc;
          }, {});
          window.localStorage.setItem('sidflow-personal-ratings', JSON.stringify(ratings));
        } catch {
          // ignore storage errors
        }

        (window as unknown as { __sidflowQueueCleared?: Promise<unknown> }).__sidflowQueueCleared = new Promise((resolve) => {
          try {
            const request = indexedDB.deleteDatabase('sidflow-local');
            request.onsuccess = request.onerror = request.onblocked = () => resolve(null);
          } catch {
            resolve(null);
          }
        });
      },
      {
        personalRating: PERSONAL_RATING_VALUE,
        sidPaths: ['/virtual/playlist-track-1.sid', '/virtual/playlist-track-2.sid'],
      }
    );
  }

  async function waitForQueueReset(page: Page) {
    await page.evaluate(() => (window as { __sidflowQueueCleared?: Promise<unknown> }).__sidflowQueueCleared);
  }

  async function bootstrapPlayTab(page: Page) {
    await page.goto('/?tab=play');
    await waitForQueueReset(page);
    await expect(page.getByRole('heading', { name: /play sid music/i })).toBeVisible({ timeout: 15000 });

    const playButton = page.getByRole('button', { name: /play next track/i });
    await expect(playButton).toBeEnabled({ timeout: 60000 });
    await playButton.click();

    // Wait for pause button to appear (may start disabled)
    const pauseButton = page.getByRole('button', { name: /pause playback/i });
    await expect(pauseButton).toBeVisible({ timeout: 30000 });

    // Wait for it to become enabled (player ready)
    // In CI this can take longer due to WASM/audio initialization
    await expect(pauseButton).toBeEnabled({ timeout: 90000 });
  }

  test.describe.serial('PlayTab Personalized Features', () => {
    test.beforeEach(async ({ page }) => {
      await installPlayTabRoutes(page);
      await ensurePlayTabInitScripts(page);
    });

    test('creates personalized station from the current song', async ({ page }) => {
      test.setTimeout(90000); // Increase timeout for CI environment
      await bootstrapPlayTab(page);

      const stationButton = page.getByRole('button', { name: /start station/i });
      await expect(stationButton).toBeVisible({ timeout: 15000 });
      await stationButton.click();
      await page.waitForTimeout(2000); // Wait for station to load

      await expect(page.getByText(`Playing: ${STATION_NAME}`)).toBeVisible({ timeout: 30000 });
      for (const title of STATION_TRACK_TITLES) {
        await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
      }
    });

    test('displays personal and community ratings for the song in play', async ({ page }) => {
      test.setTimeout(90000); // Increase timeout for CI environment
      await bootstrapPlayTab(page);

      await expect(page.getByText(`You rated: ${PERSONAL_RATING_VALUE}/5`)).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(`${COMMUNITY_AVERAGE_RATING.toFixed(1)}/5`)).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(/Trending/i)).toBeVisible();
    });
  });
}
