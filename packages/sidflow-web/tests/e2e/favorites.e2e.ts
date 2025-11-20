import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const SAMPLE_FAVORITES = [
  'C64Music/MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid',
  'C64Music/MUSICIANS/S/Szepatowski_Brian/Superman_Pt02_Theme.sid',
];

const favoritesFixturesInstalled = new WeakMap<BrowserContext, { favorites: string[] }>();

async function installFavoritesFixtures(page: Page): Promise<void> {
  const context = page.context();
  if (favoritesFixturesInstalled.has(context)) {
    return;
  }
  const state = { favorites: [] as string[] };
  favoritesFixturesInstalled.set(context, state);

  await context.route('**/api/favorites', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { favorites: state.favorites } }),
      });
      return;
    }

    if (method === 'POST' || method === 'DELETE') {
      const raw = request.postData();
      let payload: { sid_path?: string } = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }
      const sidPath = payload.sid_path;
      if (!sidPath) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'sid_path required' }),
        });
        return;
      }
      if (method === 'POST' && !state.favorites.includes(sidPath)) {
        state.favorites.push(sidPath);
      }
      if (method === 'DELETE') {
        state.favorites = state.favorites.filter((entry) => entry !== sidPath);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { favorites: state.favorites } }),
      });
      return;
    }

    await route.fallback();
  });
}

async function ensureFavorites(page: Page, desired: string[]): Promise<void> {
  const state = favoritesFixturesInstalled.get(page.context());
  if (!state) {
    throw new Error('Favorites fixtures not installed');
  }
  state.favorites = [...desired];
}

async function waitForFavoritesRefresh(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/favorites') && resp.request().method() === 'GET',
    { timeout: TIMEOUTS.PAGE_LOAD }
  ).catch(() => {});
  await responsePromise;
  await page
    .waitForSelector('text=Loading favorites...', {
      state: 'hidden',
      timeout: TIMEOUTS.LOADING_STATE,
    })
    .catch(() => {});
}

async function openFavoritesTab(
  page: Parameters<typeof test>[0]['page'],
  options: { reload?: boolean } = {}
): Promise<void> {
  const attemptToOpen = async () => {
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/favorites') && resp.request().method() === 'GET',
      { timeout: TIMEOUTS.PAGE_LOAD }
    ).catch(() => {});
    await page.locator('[data-testid="tab-favorites"]').click();
    await Promise.any([
      page.waitForSelector('text=Loading favorites...', { timeout: TIMEOUTS.ELEMENT_QUICK }),
      page.waitForSelector('text=No favorites yet', { timeout: TIMEOUTS.ELEMENT_QUICK }),
    ]).catch(() => {});
    await responsePromise;
    await page
      .waitForSelector('text=Loading favorites...', {
        state: 'hidden',
        timeout: TIMEOUTS.LOADING_STATE,
      })
      .catch(() => {});
  };

  if (options.reload) {
    await page.locator('[data-testid="tab-play"]').click();
    await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await attemptToOpen();
      return;
    } catch {
      if (attempt === 1) {
        throw new Error('Favorites tab failed to load after retry');
      }
      await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);
    }
  }
}

// Timeout constants for consistent test behavior
const TIMEOUTS = {
  TEST: 45000,          // Overall test timeout
  PAGE_LOAD: 30000,     // Page navigation timeout
  ELEMENT_VISIBLE: 10000, // Wait for element to be visible
  ELEMENT_QUICK: 5000,  // Quick element checks
  LOADING_STATE: 45000, // Wait for loading states to complete (server under load)
  HMR_SETTLE: 500,      // Let HMR/hot-reload settle
} as const;

test.describe('Favorites Feature', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TIMEOUTS.TEST);
    await installFavoritesFixtures(page);
    await ensureFavorites(page, []);

    // Navigate to the public player with longer timeout
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
    await page.waitForTimeout(TIMEOUTS.HMR_SETTLE); // Let HMR settle

    // Wait for the page to load
    await page.waitForSelector('[data-testid="tab-play"]', { timeout: TIMEOUTS.LOADING_STATE });
  });

  test('should display favorites tab for public users', async ({ page, request }) => {
    await ensureFavorites(page, []);
    // Open favorites tab (handles loading states)
    await openFavoritesTab(page);

    // Should show empty state initially (use first match to avoid ambiguity)
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(page.getByText('Add songs using the heart icon while playing', { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
  });

  test('should reflect favorites when entries are added or removed', async ({ page, request }) => {
    const samplePath = SAMPLE_FAVORITES[0];
    await ensureFavorites(page, []);

    await openFavoritesTab(page);
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

    await ensureFavorites(page, [samplePath]);
    await openFavoritesTab(page, { reload: true });
    await expect(page.getByText('FAVORITES').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(page.getByText('Play All').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

    await ensureFavorites(page, []);
    await openFavoritesTab(page, { reload: true });
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
  });

  test('should show play all and shuffle buttons when favorites exist', async ({ page, request }) => {
    await ensureFavorites(page, [SAMPLE_FAVORITES[0]]);

    await openFavoritesTab(page, { reload: true });

    // Check for action buttons (they should be disabled when empty)
    const playAllButton = page.getByRole('button', { name: /play all/i });
    const shuffleButton = page.getByRole('button', { name: /shuffle/i });

    await expect(playAllButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(shuffleButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

    // Buttons should be enabled when favorites exist
    await expect(playAllButton).toBeEnabled();
    await expect(shuffleButton).toBeEnabled();
  });

  test('should show clear all button only when favorites exist', async ({ page, request }) => {
    await ensureFavorites(page, []);
    await openFavoritesTab(page);
    await expect(page.getByRole('button', { name: /clear all/i })).not.toBeVisible();

    await ensureFavorites(page, [SAMPLE_FAVORITES[0], SAMPLE_FAVORITES[1]]);
    await openFavoritesTab(page, { reload: true });
    await expect(page.getByRole('button', { name: /clear all/i })).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
  });

  test('should display favorite tracks with metadata', async ({ page, request }) => {
    await ensureFavorites(page, SAMPLE_FAVORITES);
    await openFavoritesTab(page, { reload: true });

    // Check for the card structure
    const favoritesCard = page.locator('.c64-border').filter({ hasText: 'FAVORITES' });
    await expect(favoritesCard).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

    // Check for the heart icon in header (limit to header icon)
    const heartIcon = favoritesCard.locator('svg.lucide-heart').first();
    await expect(heartIcon).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

    for (const sidPath of SAMPLE_FAVORITES) {
      await expect(page.getByText(sidPath).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    }
  });

  test('should maintain favorites state across tab switches', async ({ page, request }) => {
    await ensureFavorites(page, []);
    // Navigate to favorites tab
    await openFavoritesTab(page);
    await expect(page.getByText('FAVORITES').first()).toBeVisible();

    // Switch to prefs tab
    await page.locator('[data-testid="tab-prefs"]').click();
    await page.waitForTimeout(500);

    // Switch back to favorites
    await openFavoritesTab(page);

    // Should still show favorites content
    await expect(page.getByText('FAVORITES').first()).toBeVisible();
  });

  test('should handle favorite button loading states', async ({ page, request }) => {
    await ensureFavorites(page, []);
    // Go to play tab
    await page.locator('[data-testid="tab-play"]').click();

    // If a favorite button exists, check it doesn't show loading spinner initially
    const favoriteButton = page.locator('button:has([data-testid="favorite-icon"])').first();

    if (await favoriteButton.isVisible()) {
      // Should not have a loading spinner
      const loadingSpinner = favoriteButton.locator('.animate-spin');
      await expect(loadingSpinner).not.toBeVisible();
    }
  });

  test('should show appropriate empty state messaging', async ({ page, request }) => {
    await ensureFavorites(page, []);
    // Navigate to favorites tab
    await openFavoritesTab(page, { reload: true });

    // Check empty state elements (use first match to avoid ambiguity)
    await expect(page.getByText('No favorites yet').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    await expect(page.getByText('Add songs using the heart icon while playing', { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

    // Check for empty state heart icon
    const emptyHeartIcon = page.locator('svg.lucide-heart').first();
    await expect(emptyHeartIcon).toBeVisible();
  });
});
